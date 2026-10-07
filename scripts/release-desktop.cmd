@echo off
setlocal
rem Build a local test candidate. Publish its exact files only after testing.
rem Usage: release-desktop.cmd [--next-version | VERSION | --publish CANDIDATE_DIRECTORY]
rem Each branch exits outside a parenthesized block: a bare exit /b inside one reports 0.
cd /d "%~dp0.."
if /i "%~1"=="--publish" goto publish
if not "%~2"=="" goto usage
if /i "%~1"=="--next-version" goto next_version
if "%~1"=="" goto build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -Version "%~1"
exit /b %errorlevel%

:publish
if "%~2"=="" goto usage
if not "%~3"=="" goto usage
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -CandidateDirectory "%~2"
exit /b %errorlevel%

:next_version
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -NextVersion
exit /b %errorlevel%

:build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1
exit /b %errorlevel%

:usage
echo Usage: release-desktop.cmd [--next-version ^| VERSION ^| --publish CANDIDATE_DIRECTORY]
exit /b 1
