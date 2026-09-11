[CmdletBinding(DefaultParameterSetName = 'Build')]
param(
    [Parameter(ParameterSetName = 'Build')]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-spy\.(0|[1-9][0-9]*)$')]
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
$repoRoot = Split-Path -Parent $PSScriptRoot

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

function Get-NextVersion {
    param([string[]]$Tags)
    # Fork builds follow upstream main, so use the same target as its nightly releases.
    # Only base_version is used; date/run/sha supply the resolver's required metadata.
    $metadata = Invoke-Checked node @('scripts/resolve-nightly-release.ts',
        '--date', (Get-Date).ToUniversalTime().ToString('yyyyMMdd'), '--run-number', '1',
        '--sha', (Invoke-Checked git @('rev-parse', 'HEAD')).Trim())
    $baseLines = @($metadata | Where-Object { $_ -like 'base_version=*' })
    if ($baseLines.Count -ne 1) { throw 'Upstream nightly resolver did not return one base_version.' }
    $baseVersion = $baseLines[0].Substring('base_version='.Length)
    if ($baseVersion -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
        throw "Cannot choose a release version from upstream nightly target '$baseVersion'. Supply -Version explicitly."
    }
    $pattern = '^spy-v' + [regex]::Escape($baseVersion) + '-spy\.(0|[1-9][0-9]*)$'
    [long]$nextBuild = 1
    foreach ($releaseTag in $Tags) {
        if ($releaseTag -match $pattern) {
            $nextBuild = [Math]::Max($nextBuild, [long]$Matches[1] + 1)
        }
    }
    return "$baseVersion-spy.$nextBuild"
}

function Get-ReservedTags {
    Get-ReleaseTags
    # Even an interrupted local build reserves its version, so installed test
    # candidates never share a version with different bytes built here later.
    $releaseDirectory = Join-Path $repoRoot 'release'
    if (Test-Path -LiteralPath $releaseDirectory) {
        foreach ($directory in Get-ChildItem -LiteralPath $releaseDirectory -Directory) {
            if ($directory.Name -match '^(spy-v\d+\.\d+\.\d+-spy\.\d+)-[0-9a-f]{32}$') {
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

function Publish-Candidate {
    param([string]$Directory)
    $directoryPath = (Resolve-Path -LiteralPath $Directory).Path
    $candidate = Get-Content -LiteralPath (Join-Path $directoryPath 'candidate.json') -Raw | ConvertFrom-Json
    if ($candidate.schemaVersion -ne 1 -or $candidate.repository -ne $repository -or
        $candidate.version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-spy\.(0|[1-9][0-9]*)$' -or
        $candidate.sourceCommit -notmatch '^[0-9a-f]{40}$') {
        throw 'Invalid desktop candidate manifest.'
    }
    $tag = "spy-v$($candidate.version)"
    $names = @("T3-Code-$($candidate.version)-x64.exe", "T3-Code-$($candidate.version)-x86_64.AppImage",
        'SHA256SUMS.txt', 'release-notes.md')
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
    # provided it is still part of the public fork branch, never the current HEAD.
    $comparison = Invoke-Checked gh @('api', "repos/$repository/compare/$($candidate.sourceCommit)...spy%2Fmain", '--jq', '.status')
    if ($comparison.Trim() -notin @('ahead', 'identical')) {
        throw 'Push the candidate source commit to spy/main before publishing; do not rebuild the tested files.'
    }
    if (@(Get-ReleaseTags) -contains $tag) {
        throw "Release or tag $tag already exists. Inspect any interrupted draft before retrying."
    }
    $installer = Join-Path $directoryPath $names[0]
    $appImage = Join-Path $directoryPath $names[1]
    $checksumFile = Join-Path $directoryPath 'SHA256SUMS.txt'
    $notesFile = Join-Path $directoryPath 'release-notes.md'
    Invoke-Checked gh @('release', 'create', $tag, $installer, $appImage, $checksumFile,
        '--repo', $repository, '--target', $candidate.sourceCommit, '--draft', '--title', "T3 Code (SPY) $($candidate.version)",
        '--notes-file', $notesFile)
    Invoke-Checked gh @('release', 'edit', $tag, '--repo', $repository, '--draft=false', '--latest')
    Write-Host "Published tested candidate: https://github.com/$repository/releases/tag/$tag"
}

Push-Location $repoRoot
$buildEnvironment = @{}
$releaseLock = $null
try {
    if ($PSCmdlet.ParameterSetName -eq 'Publish') {
        Publish-Candidate -Directory $CandidateDirectory
        return
    }
    if ($NextVersion) {
        Get-NextVersion -Tags @(Get-ReservedTags)
        return
    }
    if (-not (Test-Path -LiteralPath '.t3/build-desktop-win.cmd' -PathType Leaf)) {
        throw 'Missing .t3/build-desktop-win.cmd. See docs/spy/README.md.'
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
    if (-not $Version) { $Version = Get-NextVersion -Tags $releaseTags }
    $tag = "spy-v$Version"
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
        T3CODE_DESKTOP_UPDATE_REPOSITORY = $null
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
    Write-Host "Building local test candidate $Version from $commit"
    New-Item -ItemType Directory -Path $outputDirectory > $null
    [IO.File]::WriteAllLines((Join-Path $outputDirectory 'linux-build.env'), [string[]]$connectLines)
    $wslRepo = (Invoke-Checked wsl.exe @('--distribution', $WslDistribution, '--exec', 'wslpath', '-a', '-u', $repoRoot)).Trim()
    $wslOutput = (Invoke-Checked wsl.exe @('--distribution', $WslDistribution, '--exec', 'wslpath', '-a', '-u', $outputDirectory)).Trim()
    $linuxArguments = @('--distribution', $WslDistribution, '--exec', 'bash', '--login',
        "$wslRepo/scripts/build-spy-desktop-linux.sh", $wslRepo, $commit, $Version, $wslOutput)
    if ($LinuxBuildDirectory) { $linuxArguments += $LinuxBuildDirectory }
    Invoke-Checked wsl.exe $linuxArguments
    $appImage = Join-Path $outputDirectory "T3-Code-$Version-x86_64.AppImage"
    if (-not (Test-Path -LiteralPath $appImage -PathType Leaf) -or (Get-Item -LiteralPath $appImage).Length -eq 0) {
        throw "Build did not produce the expected AppImage: $appImage"
    }
    Invoke-Checked cmd.exe @('/d', '/c', 'call .t3\build-desktop-win.cmd')

    $installer = Join-Path $outputDirectory "T3-Code-$Version-x64.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf) -or (Get-Item -LiteralPath $installer).Length -eq 0) {
        throw "Build did not produce the expected installer: $installer"
    }
    if ((Get-SourceCommit) -ne $commit) {
        throw 'Source changed during the build. Build again from a clean, committed checkout.'
    }

    $checksumFile = Join-Path $outputDirectory 'SHA256SUMS.txt'
    $checksums = foreach ($artifact in @($installer, $appImage)) {
        "$(Get-ArtifactHash $artifact)  $([IO.Path]::GetFileName($artifact))"
    }
    [IO.File]::WriteAllText($checksumFile, ($checksums -join "`n") + "`n")
    $notesFile = Join-Path $outputDirectory 'release-notes.md'
    $notes = @"
Windows x64 installer and Linux x64 AppImage for the T3 Code fork. Both built from $commit.

Download and run the .exe; no extraction is required. This build is unsigned, so Windows may show a SmartScreen warning. Updates require downloading and installing a newer release.

The Windows installer replaces an existing T3 Code installation and reuses its projects and settings. The Windows app does not support running agents inside WSL.

On Linux, download the .AppImage, mark it executable, and run it. Updates require downloading a newer AppImage. Fedora and CachyOS are intended targets; desktop verification on those distributions is still pending.
"@
    [IO.File]::WriteAllText($notesFile, $notes)

    $candidate = [ordered]@{
        schemaVersion = 1
        repository = $repository
        version = $Version
        sourceCommit = $commit
        builtAt = (Get-Date).ToUniversalTime().ToString('o')
        files = @(
            foreach ($file in @($installer, $appImage, $checksumFile, $notesFile)) {
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
