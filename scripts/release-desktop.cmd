@echo off
setlocal
rem Build a local test candidate. Publish its exact files only after testing.
rem Usage: release-desktop.cmd [--next-version | VERSION | --publish CANDIDATE_DIRECTORY]
cd /d "%~dp0.."
if /i "%~1"=="--publish" (
  if "%~2"=="" goto usage
  if not "%~3"=="" goto usage
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -CandidateDirectory "%~2"
  exit /b
)
if not "%~2"=="" (
  goto usage
)
if /i "%~1"=="--next-version" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -NextVersion
  exit /b
)
if "%~1"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\publish-spy-desktop.ps1 -Version "%~1"
exit /b %errorlevel%

:usage
echo Usage: release-desktop.cmd [--next-version ^| VERSION ^| --publish CANDIDATE_DIRECTORY]
exit /b 1
