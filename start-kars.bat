@echo off
rem Starts KARS on this PC. Keep this window open while you work; close it to stop KARS.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js is not installed. Get it from https://nodejs.org and run this again. & pause & exit /b 1)
node kars-server.mjs
pause
