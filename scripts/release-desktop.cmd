@echo off
setlocal
rem Build and publish the Windows x64 installer and Linux x64 AppImage together.
rem Usage: release-desktop.cmd [--next-version | VERSION]
cd /d "%~dp0.."
if not "%~2"=="" (
  echo Usage: release-desktop.cmd [--next-version ^| VERSION]
  exit /b 1
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
