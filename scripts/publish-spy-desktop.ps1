[CmdletBinding(DefaultParameterSetName = 'Build')]
param(
    [Parameter(ParameterSetName = 'Build')]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-(spy|nightly\.[0-9]{8}\.[1-9][0-9]*\.spy)\.(0|[1-9][0-9]*)$')]
    [string]$Version,
    [Parameter(ParameterSetName = 'Build')]
    [switch]$NextVersion,
    [Parameter(ParameterSetName = 'Build')]
    [string]$WslDistribution = 'Debian',
    [Parameter(ParameterSetName = 'Build')]
    [string]$LinuxBuildDirectory = '',
    [Parameter(Mandatory, ParameterSetName = 'Publish')]
    [string]$CandidateDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Keep public release content separate from machine-local settings and build logs.
$repository = 'spysystem/t3code'
$packagesRepository = 'spysystem/t3code-packages'
$repoRoot = Split-Path -Parent $PSScriptRoot
# Stable is X.Y.Z-spy.N on upstream's vX.Y.Z. Nightly (Windows only) is <upstream nightly>.spy.N,
# tagged with the bare version because electron-updater finds prereleases by semver tags.
$stableVersionPattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-spy\.(0|[1-9][0-9]*)$'
$nightlyVersionPattern = '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-nightly\.[0-9]{8}\.[1-9][0-9]*\.spy\.(0|[1-9][0-9]*)$'

function Invoke-Checked {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Program failed with exit code $LASTEXITCODE."
    }
}

function Get-SourceCommit {
    $changes = Invoke-Checked git @('status', '--porcelain', '--untracked-files=normal')
    if ($changes) {
        throw 'Commit or set aside local changes before building a test candidate.'
    }
    return (Invoke-Checked git @('rev-parse', 'HEAD')).Trim()
}

function Get-ReleaseTags {
    # Include drafts and tags without releases, so interrupted releases reserve their version.
    Invoke-Checked gh @('api', "repos/$repository/releases?per_page=100", '--paginate', '--jq', '.[].tag_name')
    $refs = Invoke-Checked git @('ls-remote', '--refs', '--tags', "https://github.com/$repository.git")
    foreach ($ref in $refs) {
        if ($ref -match '\srefs/tags/(.+)$') { $Matches[1] }
    }
}

function Get-Channel {
    if ((Invoke-Checked git @('branch', '--show-current')) -eq 'spy/stable') { return 'stable' }
    return 'nightly'
}

function Get-ReleaseTag {
    param([string]$Version)
    if ($Version -match $nightlyVersionPattern) { return $Version }
    return "spy-v$Version"
}

function Get-NextVersion {
    param([string[]]$Tags, [string]$Channel)
    # The version names the upstream release the fork stack sits on.
    $base = (Invoke-Checked git @('merge-base', 'HEAD', 'upstream/main')).Trim()
    $basePattern = if ($Channel -eq 'stable') { '^v(\d+\.\d+\.\d+)$' } else { '^v(\d+\.\d+\.\d+-nightly\.\d{8}\.\d+)$' }
    $baseVersions = @(Invoke-Checked git @('tag', '--points-at', $base) |
        Where-Object { $_ -match $basePattern } | ForEach-Object { $Matches[1] })
    if ($baseVersions.Count -ne 1) {
        throw "Upstream base $base has no $Channel release tag. Fetch upstream tags and rebase onto its latest $Channel release, or supply -Version."
    }
    $prefix = if ($Channel -eq 'stable') { "$($baseVersions[0])-spy." } else { "$($baseVersions[0]).spy." }
    $pattern = '^(spy-v)?' + [regex]::Escape($prefix) + '(0|[1-9][0-9]*)$'
    [long]$nextBuild = 1
    foreach ($releaseTag in $Tags) {
        if ($releaseTag -match $pattern) {
            $nextBuild = [Math]::Max($nextBuild, [long]$Matches[2] + 1)
        }
    }
    return "$prefix$nextBuild"
}

function Get-ReservedTags {
    Get-ReleaseTags
    # Even an interrupted local build reserves its version, so installed test
    # candidates never share a version with different bytes built here later.
    $releaseDirectory = Join-Path $repoRoot 'release'
    if (Test-Path -LiteralPath $releaseDirectory) {
        foreach ($directory in Get-ChildItem -LiteralPath $releaseDirectory -Directory) {
            if ($directory.Name -match '^(spy-v\d+\.\d+\.\d+-spy\.\d+|\d+\.\d+\.\d+-nightly\.\d{8}\.\d+\.spy\.\d+)-[0-9a-f]{32}$') {
                $Matches[1]
            }
        }
    }
}

function Get-ArtifactHash {
    param([string]$Path)
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $stream.Dispose()
        $sha256.Dispose()
    }
}

function Assert-WindowsUpdateFeed {
    param([string]$Manifest, [string]$Installer, [string]$Version)
    # Installed Windows builds download what latest.yml or nightly.yml names, verified by its sha512.
    $sha512 = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($Installer)
    try { $hash = [Convert]::ToBase64String($sha512.ComputeHash($stream)) }
    finally {
        $stream.Dispose()
        $sha512.Dispose()
    }
    $text = (Get-Content -LiteralPath $Manifest -Raw) -replace "`r", ''
    $quotedVersion = "'?" + [regex]::Escape($Version) + "'?"
    if ($text -notmatch "(?m)^version: $quotedVersion$" -or
        $text -notmatch "(?m)^\s*- url: $([regex]::Escape([IO.Path]::GetFileName($Installer)))$" -or
        $text -notmatch "(?m)^\s*sha512: $([regex]::Escape($hash))$") {
        throw "The update feed does not describe the built installer: $Manifest"
    }
}

function Publish-Candidate {
    param([string]$Directory)
    $directoryPath = (Resolve-Path -LiteralPath $Directory).Path
    $candidate = Get-Content -LiteralPath (Join-Path $directoryPath 'candidate.json') -Raw | ConvertFrom-Json
    $nightly = $candidate.version -match $nightlyVersionPattern
    if ($candidate.schemaVersion -ne 1 -or $candidate.repository -ne $repository -or
        -not ($nightly -or $candidate.version -match $stableVersionPattern) -or
        $candidate.sourceCommit -notmatch '^[0-9a-f]{40}$') {
        throw 'Invalid desktop candidate manifest.'
    }
    $tag = Get-ReleaseTag $candidate.version
    $branch = if ($nightly) { 'spy/main' } else { 'spy/stable' }
    $names = if ($nightly) {
        @("T3-Code-$($candidate.version)-x64.exe", "T3-Code-$($candidate.version)-x64.exe.blockmap",
            'nightly.yml', 'SHA256SUMS.txt', 'release-notes.md')
    } else {
        @("T3-Code-$($candidate.version)-x64.exe", "T3-Code-$($candidate.version)-x86_64.AppImage",
            "T3-Code-$($candidate.version)-amd64.deb", "T3-Code-$($candidate.version)-x86_64.rpm",
            "T3-Code-$($candidate.version)-x64.exe.blockmap", 'latest.yml', 'SHA256SUMS.txt', 'release-notes.md')
    }
    if (@($candidate.files).Count -ne $names.Count) { throw 'Candidate file list is incomplete.' }
    foreach ($name in $names) {
        $entries = @($candidate.files | Where-Object { $_.name -ceq $name })
        if ($entries.Count -ne 1) { throw "Candidate must contain exactly one $name." }
        $path = Join-Path $directoryPath $name
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-Item -LiteralPath $path).Length -eq 0) {
            throw "Missing candidate file: $name"
        }
        if ((Get-ArtifactHash $path) -cne $entries[0].sha256) {
            throw "Candidate file changed after building: $name. Build and test a new candidate."
        }
    }
    Invoke-Checked gh @('auth', 'status', '--hostname', 'github.com')
    # The checkout may have advanced since testing. Publish the recorded source,
    # provided it is still part of its channel's public fork branch, never the current HEAD.
    $comparison = Invoke-Checked gh @('api', "repos/$repository/compare/$($candidate.sourceCommit)...$($branch -replace '/', '%2F')", '--jq', '.status')
    if ($comparison.Trim() -notin @('ahead', 'identical')) {
        throw "Push the candidate source commit to $branch before publishing; do not rebuild the tested files."
    }
    if (@(Get-ReleaseTags) -contains $tag) {
        throw "Release or tag $tag already exists. Inspect any interrupted draft before retrying."
    }
    # The blockmap and .yml are the Windows update feed: Stable builds read latest.yml from the
    # release GitHub marks latest, Nightly builds nightly.yml from the newest prerelease.
    $artifacts = @($names[0..($names.Count - 3)] | ForEach-Object { Join-Path $directoryPath $_ })
    $checksumFile = Join-Path $directoryPath 'SHA256SUMS.txt'
    $notesFile = Join-Path $directoryPath 'release-notes.md'
    $title = if ($nightly) { "T3 Code (SPY Nightly) $($candidate.version)" } else { "T3 Code (SPY) $($candidate.version)" }
    Invoke-Checked gh (@('release', 'create', $tag) + $artifacts + @($checksumFile,
        '--repo', $repository, '--target', $candidate.sourceCommit, '--draft', '--title', $title,
        '--notes-file', $notesFile))
    Invoke-Checked gh @('release', 'edit', $tag, '--repo', $repository, '--draft=false',
        $(if ($nightly) { '--prerelease' } else { '--latest' }))
    Write-Host "Published tested candidate: https://github.com/$repository/releases/tag/$tag"
    # The apt and dnf repositories serve only Stable releases.
    if ($nightly) { return }
    # The apt and dnf repositories serve the newest release; rebuild them now.
    $packagesWorkflow = "gh workflow run publish.yml --repo $packagesRepository"
    & gh workflow run publish.yml --repo $packagesRepository
    if ($LASTEXITCODE -ne 0) {
        throw "Release $tag is public, but starting the package repository update failed. Run: $packagesWorkflow"
    }
    Write-Host "Started the package repository update: https://github.com/$packagesRepository/actions"
}

Push-Location $repoRoot
$buildEnvironment = @{}
$releaseLock = $null
try {
    if ($PSCmdlet.ParameterSetName -eq 'Publish') {
        Publish-Candidate -Directory $CandidateDirectory
        return
    }
    # spy/stable builds Stable; every other branch builds Nightly.
    $channel = if (-not $Version) { Get-Channel } elseif ($Version -match $nightlyVersionPattern) { 'nightly' } else { 'stable' }
    if ($NextVersion) {
        Get-NextVersion -Tags @(Get-ReservedTags) -Channel $channel
        return
    }
    if (-not (Test-Path -LiteralPath '.t3/build-desktop-win.cmd' -PathType Leaf)) {
        throw 'Missing .t3/build-desktop-win.cmd. See docs/spy/releasing.md.'
    }
    if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
        throw 'Missing .env. Copy .env.example before building so T3 Connect is included.'
    }
    # Bundles are built in the Windows checkout, so hold this through both builds.
    # The Linux helper also locks its independently shared cache.
    $releaseLock = [IO.File]::Open((Join-Path $repoRoot '.t3/spy-desktop-release.lock'),
        [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $commit = Get-SourceCommit
    Invoke-Checked gh @('auth', 'status', '--hostname', 'github.com')
    $releaseTags = @(Get-ReservedTags)
    if (-not $Version) { $Version = Get-NextVersion -Tags $releaseTags -Channel $channel }
    $tag = Get-ReleaseTag $Version
    if ($releaseTags -contains $tag) {
        throw "Release or tag $tag already exists. Choose a new version; published installers are never overwritten."
    }

    # A fresh output directory prevents an old installer from being uploaded after a bad build.
    $outputDirectory = Join-Path $repoRoot "release/$tag-$([guid]::NewGuid().ToString('N'))"
    $environment = @{
        T3CODE_DESKTOP_VERSION = $Version
        T3CODE_DESKTOP_OUTPUT_DIR = $outputDirectory
        T3CODE_DESKTOP_ARCH = 'x64'
        T3CODE_DESKTOP_SKIP_BUILD = 'false'
        T3CODE_DESKTOP_SIGNED = 'false'
        T3CODE_DESKTOP_MOCK_UPDATES = 'false'
        # Writes the GitHub update feed into the Windows app and emits latest.yml or nightly.yml.
        T3CODE_DESKTOP_UPDATE_REPOSITORY = $repository
        GITHUB_REPOSITORY = $null
    }
    # Use one snapshot of the public Connect settings for both platforms. Never
    # copy the whole .env: it can also contain the reusable development credential.
    $connectKeys = @('T3CODE_CLERK_PUBLISHABLE_KEY', 'T3CODE_CLERK_JWT_TEMPLATE',
        'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID', 'T3CODE_RELAY_URL')
    $connectLines = @()
    foreach ($key in $connectKeys) {
        $lines = @(Get-Content -LiteralPath '.env' | Where-Object { $_ -match "^$key=.+$" })
        if ($lines.Count -ne 1) { throw "Expected exactly one nonempty $key in .env." }
        $connectLines += $lines[0]
        $environment[$key] = $lines[0].Substring($key.Length + 1).Trim().Trim('"', "'")
    }
    foreach ($name in $environment.Keys) {
        $buildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    Write-Host "Building local $channel test candidate $Version from $commit"
    New-Item -ItemType Directory -Path $outputDirectory > $null
    $linuxArtifacts = @()
    if ($channel -eq 'stable') {
        [IO.File]::WriteAllLines((Join-Path $outputDirectory 'linux-build.env'), [string[]]$connectLines)
        $wslRepo = (Invoke-Checked wsl.exe @('--distribution', $WslDistribution, '--exec', 'wslpath', '-a', '-u', $repoRoot)).Trim()
        $wslOutput = (Invoke-Checked wsl.exe @('--distribution', $WslDistribution, '--exec', 'wslpath', '-a', '-u', $outputDirectory)).Trim()
        $linuxArguments = @('--distribution', $WslDistribution, '--exec', 'bash', '--login',
            "$wslRepo/scripts/build-spy-desktop-linux.sh", $wslRepo, $commit, $Version, $wslOutput)
        if ($LinuxBuildDirectory) { $linuxArguments += $LinuxBuildDirectory }
        Invoke-Checked wsl.exe $linuxArguments
        # The .deb and .rpm feed the apt and dnf repositories (spysystem/t3code-packages).
        $linuxArtifacts = @('x86_64.AppImage', 'amd64.deb', 'x86_64.rpm' | ForEach-Object { Join-Path $outputDirectory "T3-Code-$Version-$_" })
        foreach ($artifact in $linuxArtifacts) {
            if (-not (Test-Path -LiteralPath $artifact -PathType Leaf) -or (Get-Item -LiteralPath $artifact).Length -eq 0) {
                throw "Build did not produce the expected $([IO.Path]::GetExtension($artifact).TrimStart('.')): $artifact"
            }
        }
    }
    Invoke-Checked cmd.exe @('/d', '/c', 'call .t3\build-desktop-win.cmd')

    $installer = Join-Path $outputDirectory "T3-Code-$Version-x64.exe"
    $feedName = if ($channel -eq 'stable') { 'latest.yml' } else { 'nightly.yml' }
    $updateFeed = @("$installer.blockmap", (Join-Path $outputDirectory $feedName))
    foreach ($file in @($installer) + $updateFeed) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -eq 0) {
            throw "Build did not produce the expected Windows file: $file"
        }
    }
    Assert-WindowsUpdateFeed -Manifest $updateFeed[1] -Installer $installer -Version $Version
    if ((Get-SourceCommit) -ne $commit) {
        throw 'Source changed during the build. Build again from a clean, committed checkout.'
    }

    $checksumFile = Join-Path $outputDirectory 'SHA256SUMS.txt'
    $checksums = foreach ($artifact in @($installer) + $linuxArtifacts) {
        "$(Get-ArtifactHash $artifact)  $([IO.Path]::GetFileName($artifact))"
    }
    [IO.File]::WriteAllText($checksumFile, ($checksums -join "`n") + "`n")
    $notesFile = Join-Path $outputDirectory 'release-notes.md'
    $notes = if ($channel -eq 'nightly') {
        @"
Nightly Windows x64 installer for the T3 Code fork, built from $commit.

Download and run the .exe; no extraction is required. This build is unsigned, so Windows may show a SmartScreen warning. Installed Nightly builds download later Nightly releases in the app; choose the Stable track under Settings, About to move to the next Stable release.
"@
    } else {
        @"
Windows x64 installer and Linux x64 AppImage, .deb and .rpm for the T3 Code fork. All built from $commit.

Download and run the .exe; no extraction is required. This build is unsigned, so Windows may show a SmartScreen warning. Installed Windows builds download later releases in the app and install them when you restart it.

The Windows installer replaces an existing T3 Code installation and reuses its projects and settings. The Windows app does not support running agents inside WSL.

On Fedora and Linux Mint, install from the package repository at https://spysystem.github.io/t3code-packages/, which also delivers updates through dnf or apt. The attached .deb and .rpm are that repository's packages; installed directly, they receive no updates. On other Linux distributions, download the .AppImage, mark it executable, and run it. Updates require downloading a newer AppImage.

On an Apple Silicon Mac, build and install the latest release from source: ``curl -fsSL https://raw.githubusercontent.com/spysystem/t3code/refs/heads/spy/main/scripts/build-spy-desktop-mac.sh | bash -s -- --install``. See the macOS section of docs/spy/releasing.md for prerequisites.
"@
    }
    [IO.File]::WriteAllText($notesFile, $notes)

    $candidate = [ordered]@{
        schemaVersion = 1
        repository = $repository
        version = $Version
        sourceCommit = $commit
        builtAt = (Get-Date).ToUniversalTime().ToString('o')
        files = @(
            foreach ($file in @($installer) + $linuxArtifacts + $updateFeed + @($checksumFile, $notesFile)) {
                [ordered]@{ name = [IO.Path]::GetFileName($file); sha256 = Get-ArtifactHash $file }
            }
        )
    }
    [IO.File]::WriteAllText((Join-Path $outputDirectory 'candidate.json'), ($candidate | ConvertTo-Json -Depth 4))
    Write-Host "Test installer: $installer"
    Write-Host "Candidate directory: $outputDirectory"
    Write-Host 'Nothing published. After installation and testing, ask to publish this candidate.'
}
finally {
    if ($null -ne $releaseLock) { $releaseLock.Dispose() }
    foreach ($name in $buildEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $buildEnvironment[$name], 'Process')
    }
    Pop-Location
}
