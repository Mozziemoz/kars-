@echo off
rem KARS setup for Windows: installs Node.js and Claude Code if missing, asks you to sign in to Claude once, then starts KARS.
rem Put this file in the same folder as kars.html and kars-server.mjs, then double-click it.
cd /d "%~dp0"
title KARS setup

where node >nul 2>nul
if errorlevel 1 (
  echo Installing Node.js...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  if errorlevel 1 (echo Could not install Node.js automatically. Install it from https://nodejs.org, then run this file again. & pause & exit /b 1)
  set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm"
)

where claude >nul 2>nul
if errorlevel 1 (
  echo Installing Claude Code...
  call npm install -g @anthropic-ai/claude-code
  set "PATH=%PATH%;%APPDATA%\npm"
)
where claude >nul 2>nul
if errorlevel 1 (echo Claude Code did not install. Close this window, open a new one, and run this file again. & pause & exit /b 1)

if not exist "%USERPROFILE%\.kars-signed-in" (
  echo.
  echo Claude Code will open now. Sign in with your Claude account, then type /exit to come back here.
  pause
  call claude
  echo done> "%USERPROFILE%\.kars-signed-in"
)

echo Starting KARS...
node kars-server.mjs
pause
