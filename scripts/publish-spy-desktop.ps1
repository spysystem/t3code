param(
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-spy\.(0|[1-9][0-9]*)$')]
    [string]$Version,
    [switch]$NextVersion
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
        throw 'Commit or set aside local changes before publishing.'
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

Push-Location $repoRoot
$buildEnvironment = @{}
try {
    if ($NextVersion) {
        Get-NextVersion -Tags @(Get-ReleaseTags)
        return
    }
    if (-not (Test-Path -LiteralPath '.t3/build-desktop-win.cmd' -PathType Leaf)) {
        throw 'Missing .t3/build-desktop-win.cmd. See docs/spy/README.md.'
    }
    if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
        throw 'Missing .env. Copy .env.example before building so T3 Connect is included.'
    }
    $commit = Get-SourceCommit
    Invoke-Checked gh @('auth', 'status', '--hostname', 'github.com')
    $remoteCommit = Invoke-Checked gh @('api', "repos/$repository/commits/spy%2Fmain", '--jq', '.sha')
    if ($remoteCommit.Trim() -ne $commit) {
        throw 'Push this commit to spysystem/t3code spy/main before publishing.'
    }
    $releaseTags = @(Get-ReleaseTags)
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
    foreach ($name in $environment.Keys) {
        $buildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
        [Environment]::SetEnvironmentVariable($name, $environment[$name], 'Process')
    }
    Write-Host "Building $Version from $commit for https://github.com/$repository/releases"
    Invoke-Checked cmd.exe @('/d', '/c', 'call .t3\build-desktop-win.cmd')

    $installer = Join-Path $outputDirectory "T3-Code-$Version-x64.exe"
    if (-not (Test-Path -LiteralPath $installer -PathType Leaf) -or (Get-Item -LiteralPath $installer).Length -eq 0) {
        throw "Build did not produce the expected installer: $installer"
    }
    if ((Get-SourceCommit) -ne $commit) {
        throw 'Source changed during the build. Build again from a clean, committed checkout.'
    }

    $checksumFile = Join-Path $outputDirectory 'SHA256SUMS.txt'
    # Nested Windows build shells may not be able to auto-load Get-FileHash's module.
    $sha256 = [Security.Cryptography.SHA256]::Create()
    $installerStream = [IO.File]::OpenRead($installer)
    try {
        $checksum = [BitConverter]::ToString($sha256.ComputeHash($installerStream)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $installerStream.Dispose()
        $sha256.Dispose()
    }
    [IO.File]::WriteAllText($checksumFile, "$checksum  $([IO.Path]::GetFileName($installer))`n")
    $notesFile = Join-Path $outputDirectory 'release-notes.md'
    $notes = @"
Windows x64 installer for the T3 Code fork. Built from $commit.

Download and run the .exe; no extraction is required. This build is unsigned, so Windows may show a SmartScreen warning. Updates require downloading and installing a newer release.

Installing replaces an existing T3 Code installation and reuses its projects and settings. WSL is not supported in this build.
"@
    [IO.File]::WriteAllText($notesFile, $notes)

    # Draft first: a failed upload must not advertise a release with missing assets.
    Invoke-Checked gh @('release', 'create', $tag, $installer, $checksumFile,
        '--repo', $repository, '--target', $commit, '--draft', '--title', "T3 Code (SPY) $Version",
        '--notes-file', $notesFile)
    Invoke-Checked gh @('release', 'edit', $tag, '--repo', $repository, '--draft=false', '--latest')
    Write-Host "Published: https://github.com/$repository/releases/tag/$tag"
}
finally {
    foreach ($name in $buildEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $buildEnvironment[$name], 'Process')
    }
    Pop-Location
}
