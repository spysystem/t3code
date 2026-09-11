# Run with Windows PowerShell: Invoke-Pester scripts/publish-spy-desktop.Tests.ps1
# Command shims exercise the release flow without building or contacting GitHub.
$publisherSource = Join-Path $PSScriptRoot 'publish-spy-desktop.ps1'

Describe 'Public desktop release' {
    function git {
        $global:LASTEXITCODE = 0
        switch ($args[0]) {
            'status' {
                if ($global:spyPublishscenario -eq 'dirty' -or ($global:spyPublishscenario -eq 'changed' -and $global:spyPublishbuilt)) {
                    ' M source.ts'
                }
            }
            'rev-parse' { '1234567890abcdef1234567890abcdef12345678' }
            'ls-remote' {
                if ($global:spyPublishscenario -eq 'existing') { '1234567890abcdef1234567890abcdef12345678 refs/tags/spy-v0.0.40-spy.1' }
                foreach ($tag in $global:spyPublishTags) { "1234567890abcdef1234567890abcdef12345678`trefs/tags/$tag" }
            }
            default { throw "Unexpected git command: $args" }
        }
    }

    function gh {
        $global:LASTEXITCODE = 0
        switch ($args[0]) {
            'auth' { if ($global:spyPublishscenario -eq 'unauthenticated') { $global:LASTEXITCODE = 1 } }
            'api' {
                if ($args[1] -eq 'repos/spysystem/t3code/releases?per_page=100') {
                    if ($args -notcontains '--paginate') { throw 'Release lookup must include all pages.' }
                    if ($global:spyPublishscenario -eq 'lookup-failed') { $global:LASTEXITCODE = 1 }
                    else { $global:spyPublishReleases }
                }
                elseif ($global:spyPublishscenario -eq 'unpushed') { 'different-commit' }
                else { '1234567890abcdef1234567890abcdef12345678' }
            }
            'release' {
                $global:spyPublishevents += $args[1]
                if ($args[1] -eq 'create') {
                    $global:spyPublishCreatedTag = $args[2]
                    # Only the two exact artifacts and checksum may be uploaded.
                    $args[3] | Should Be $global:spyPublishinstaller
                    $args[4] | Should Be $global:spyPublishAppImage
                    $args[5] | Should Be (Join-Path $global:spyPublishoutputDirectory 'SHA256SUMS.txt')
                    ($args -contains '--draft') | Should Be $true
                    $args[7] | Should Be 'spysystem/t3code'
                    $args[9] | Should Be '1234567890abcdef1234567890abcdef12345678'
                    if ($global:spyPublishscenario -eq 'upload-failed') { $global:LASTEXITCODE = 1 }
                }
            }
            default { throw "Unexpected gh command: $args" }
        }
    }

    function node {
        $global:LASTEXITCODE = 0
        if ($global:spyPublishscenario -eq 'resolver-failed') {
            $global:LASTEXITCODE = 1
        } else {
            "base_version=$global:spyPublishBaseVersion"
        }
    }

    function cmd.exe {
        $global:spyPublishevents += 'build'
        $global:spyPublishbuilt = $true
        $env:T3CODE_DESKTOP_SKIP_BUILD | Should Be 'false'
        $env:T3CODE_DESKTOP_ARCH | Should Be 'x64'
        [string]$env:T3CODE_DESKTOP_UPDATE_REPOSITORY | Should Be ''
        [string]$env:GITHUB_REPOSITORY | Should Be ''
        $global:spyPublishoutputDirectory = $env:T3CODE_DESKTOP_OUTPUT_DIR
        $global:spyPublishinstaller = Join-Path $global:spyPublishoutputDirectory "T3-Code-$env:T3CODE_DESKTOP_VERSION-x64.exe"
        Test-Path -LiteralPath $global:spyPublishinstaller | Should Be $false
        if ($global:spyPublishscenario -ne 'missing-installer') {
            [IO.File]::WriteAllText($global:spyPublishinstaller, 'installer fixture')
        }
        $global:LASTEXITCODE = 0
        if ($global:spyPublishscenario -eq 'build-failed') { $global:LASTEXITCODE = 1 }
    }

    function wsl.exe {
        $global:LASTEXITCODE = 0
        if ($global:spyPublishscenario -eq 'wsl-unavailable') {
            $global:LASTEXITCODE = 1
            return
        }
        if ($args[3] -eq 'wslpath') { return $args[6] }
        $args[3] | Should Be 'bash'
        $args[4] | Should Be '--login'
        $args[7] | Should Be '1234567890abcdef1234567890abcdef12345678'
        $args[8] | Should Be $env:T3CODE_DESKTOP_VERSION
        $args[9] | Should Be $env:T3CODE_DESKTOP_OUTPUT_DIR
        $global:spyPublishWslArguments = $args
        $global:spyPublishevents += 'linux-build'
        $global:spyPublishoutputDirectory = $env:T3CODE_DESKTOP_OUTPUT_DIR
        $config = Get-Content -LiteralPath "$global:spyPublishoutputDirectory/linux-build.env"
        $config.Count | Should Be 4
        ($config -join "`n") | Should Not Match 'private configuration fixture'
        $env:T3CODE_CLERK_JWT_TEMPLATE | Should Be 'relay-fixture'
        $global:spyPublishAppImage = Join-Path $global:spyPublishoutputDirectory "T3-Code-$env:T3CODE_DESKTOP_VERSION-x86_64.AppImage"
        if ($global:spyPublishscenario -ne 'missing-appimage') {
            [IO.File]::WriteAllText($global:spyPublishAppImage, 'AppImage fixture')
        }
        if ($global:spyPublishscenario -eq 'linux-build-failed') { $global:LASTEXITCODE = 1 }
    }

    BeforeEach {
        $global:spyPublishscenario = 'success'
        $global:spyPublishBaseVersion = '0.0.41'
        $global:spyPublishevents = @()
        $global:spyPublishbuilt = $false
        $global:spyPublishTags = @()
        $global:spyPublishReleases = @()
        $fixture = Join-Path $TestDrive ([guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path "$fixture/scripts", "$fixture/.t3", "$fixture/apps/server" -Force > $null
        Copy-Item -LiteralPath $publisherSource -Destination "$fixture/scripts/publish-spy-desktop.ps1"
        Set-Content -LiteralPath "$fixture/.env" -Value @(
            'T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_fixture',
            'T3CODE_CLERK_JWT_TEMPLATE=relay-fixture',
            'T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=client-fixture',
            'T3CODE_RELAY_URL=https://relay.example.com',
            'T3CODE_DEV_AUTH_TOKEN=private configuration fixture')
        Set-Content -LiteralPath "$fixture/.t3/build-desktop-win.cmd" -Value '@exit /b 99'
        Set-Content -LiteralPath "$fixture/apps/server/package.json" -Value '{"version":"0.0.40"}'
        $global:spyPublishpublisher = "$fixture/scripts/publish-spy-desktop.ps1"
    }

    It 'uploads both artifacts and matching checksums before publishing' {
        & $global:spyPublishpublisher -Version '0.0.40-spy.1'
        ($global:spyPublishevents -join ',') | Should Be 'linux-build,build,create,edit'
        $checksums = Get-Content -LiteralPath "$global:spyPublishoutputDirectory/SHA256SUMS.txt"
        $checksums.Count | Should Be 2
        $index = 0
        foreach ($artifact in @($global:spyPublishinstaller, $global:spyPublishAppImage)) {
            $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
            $checksums[$index++] | Should Be "$hash  $([IO.Path]::GetFileName($artifact))"
        }
        (Get-Content -LiteralPath "$global:spyPublishoutputDirectory/release-notes.md" -Raw) | Should Not Match 'private configuration fixture'
    }

    It 'rejects invalid versions before doing any work' {
        { & $global:spyPublishpublisher -Version 'invalid-version' } | Should Throw
        $global:spyPublishevents.Count | Should Be 0
    }

    It 'publishes even when the optional Get-FileHash cmdlet cannot load' {
        function Get-FileHash { throw 'Get-FileHash is unavailable in the build shell.' }
        & $global:spyPublishpublisher -Version '0.0.40-spy.1'
        ($global:spyPublishevents -join ',') | Should Be 'linux-build,build,create,edit'
    }

    It 'automatically publishes the first version for the current upstream base' {
        & $global:spyPublishpublisher
        $global:spyPublishCreatedTag | Should Be 'spy-v0.0.41-spy.1'
        ($global:spyPublishevents -join ',') | Should Be 'linux-build,build,create,edit'
    }

    It 'increments numerically across release drafts and tags without releases' {
        $global:spyPublishReleases = @('spy-v0.0.41-spy.9', 'spy-v0.0.41-spy.10')
        $global:spyPublishTags = @('spy-v0.0.41-spy.12', 'v0.0.41', 'spy-v0.0.39-spy.80', 'spy-v0.0.41-spy.invalid')
        & $global:spyPublishpublisher
        $global:spyPublishCreatedTag | Should Be 'spy-v0.0.41-spy.13'
        [IO.Path]::GetFileName($global:spyPublishinstaller) | Should Be 'T3-Code-0.0.41-spy.13-x64.exe'
    }

    It 'previews a draft-reserved version without requiring clean source or build configuration' {
        $global:spyPublishscenario = 'dirty'
        $global:spyPublishReleases = @('spy-v0.0.41-spy.3')
        Remove-Item -LiteralPath "$fixture/.env"
        & $global:spyPublishpublisher -NextVersion | Should Be '0.0.41-spy.4'
        $global:spyPublishevents.Count | Should Be 0
    }

    It 'starts at one again after the upstream version changes' {
        $global:spyPublishReleases = @('spy-v0.0.41-spy.99')
        $global:spyPublishBaseVersion = '0.0.42'
        & $global:spyPublishpublisher -NextVersion | Should Be '0.0.42-spy.1'
    }

    It 'preserves an explicit version override' {
        $global:spyPublishReleases = @('spy-v0.0.40-spy.2')
        & $global:spyPublishpublisher -Version '0.0.40-spy.7'
        $global:spyPublishCreatedTag | Should Be 'spy-v0.0.40-spy.7'
    }

    It 'rejects an explicit version reserved by a draft' {
        $global:spyPublishReleases = @('spy-v0.0.40-spy.2')
        { & $global:spyPublishpublisher -Version '0.0.40-spy.2' } | Should Throw 'already exists'
        $global:spyPublishevents.Count | Should Be 0
    }

    It 'does not guess a version when the GitHub lookup fails' {
        $global:spyPublishscenario = 'lookup-failed'
        { & $global:spyPublishpublisher } | Should Throw 'gh failed with exit code 1'
        $global:spyPublishevents.Count | Should Be 0
    }

    It 'reports an unsupported upstream version instead of producing an invalid installer version' {
        $global:spyPublishBaseVersion = 'not-a-version'
        { & $global:spyPublishpublisher -NextVersion } | Should Throw 'Supply -Version explicitly'
    }

    It 'stops before building when the upstream version resolver fails' {
        $global:spyPublishscenario = 'resolver-failed'
        { & $global:spyPublishpublisher } | Should Throw 'node failed with exit code 1'
        $global:spyPublishevents.Count | Should Be 0
    }

    foreach ($failure in @('dirty', 'unpushed', 'existing', 'unauthenticated')) {
        It "rejects $failure source or credentials before building" {
            $global:spyPublishscenario = $failure
            $reason = @{
                dirty = 'Commit or set aside local changes'
                unpushed = 'Push this commit'
                existing = 'already exists'
                unauthenticated = 'gh failed with exit code 1'
            }[$failure]
            { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw $reason
            $global:spyPublishevents.Count | Should Be 0
        }
    }

    foreach ($failure in @('build-failed', 'missing-installer', 'changed')) {
        It "does not upload when $failure" {
            $global:spyPublishscenario = $failure
            $reason = @{
                'build-failed' = 'cmd.exe failed with exit code 1'
                'missing-installer' = 'Build did not produce the expected installer'
                changed = 'Commit or set aside local changes'
            }[$failure]
            { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw $reason
            ($global:spyPublishevents -join ',') | Should Be 'linux-build,build'
        }
    }

    It 'keeps the release unpublished if upload fails' {
        $global:spyPublishscenario = 'upload-failed'
        { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw 'gh failed with exit code 1'
        ($global:spyPublishevents -join ',') | Should Be 'linux-build,build,create'
    }

    It 'restores ambient build settings after failure' {
        $original = $env:T3CODE_DESKTOP_SKIP_BUILD
        try {
            $env:T3CODE_DESKTOP_SKIP_BUILD = 'true'
            $global:spyPublishscenario = 'build-failed'
            { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw 'cmd.exe failed with exit code 1'
            $env:T3CODE_DESKTOP_SKIP_BUILD | Should Be 'true'
        }
        finally { $env:T3CODE_DESKTOP_SKIP_BUILD = $original }
    }

    foreach ($failure in @('wsl-unavailable', 'linux-build-failed', 'missing-appimage')) {
        It "does not build Windows or publish when $failure" {
            $global:spyPublishscenario = $failure
            { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw
            ($global:spyPublishevents -contains 'build') | Should Be $false
            ($global:spyPublishevents -contains 'create') | Should Be $false
        }
    }

    It 'accepts a configured WSL distribution and Linux checkout path with spaces' {
        & $global:spyPublishpublisher -Version '0.0.40-spy.1' -WslDistribution 'Ubuntu' -LinuxBuildDirectory "/home/builder/release checkout's files"
        $global:spyPublishWslArguments[1] | Should Be 'Ubuntu'
        $global:spyPublishWslArguments[10] | Should Be "/home/builder/release checkout's files"
    }

    It 'stops before building if Connect configuration is incomplete' {
        Set-Content -LiteralPath "$fixture/.env" -Value 'T3CODE_CLERK_PUBLISHABLE_KEY=pk_live_fixture'
        { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw 'Expected exactly one nonempty'
        $global:spyPublishevents.Count | Should Be 0
    }

    It 'restores ambient Connect settings after publishing' {
        $original = $env:T3CODE_CLERK_JWT_TEMPLATE
        try {
            $env:T3CODE_CLERK_JWT_TEMPLATE = 'ambient-setting'
            & $global:spyPublishpublisher -Version '0.0.40-spy.1'
            $env:T3CODE_CLERK_JWT_TEMPLATE | Should Be 'ambient-setting'
        }
        finally { $env:T3CODE_CLERK_JWT_TEMPLATE = $original }
    }

    It 'rejects a concurrent release from the same Windows checkout' {
        $lock = [IO.File]::Open("$fixture/.t3/spy-desktop-release.lock", 'OpenOrCreate', 'ReadWrite', 'None')
        try {
            { & $global:spyPublishpublisher -Version '0.0.40-spy.1' } | Should Throw
            $global:spyPublishevents.Count | Should Be 0
        }
        finally { $lock.Dispose() }
    }
}
