@echo off
rem Puts a KARS icon on your desktop. Double-click it to start KARS in its own window.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\KARS.lnk');$s.TargetPath='%~dp0start-kars.bat';$s.WorkingDirectory='%~dp0';$s.WindowStyle=7;$s.IconLocation='%SystemRoot%\System32\imageres.dll,76';$s.Description='KARS manga translator';$s.Save()"
if errorlevel 1 (echo Could not make the shortcut. & pause & exit /b 1)
echo Done: KARS is on your desktop.
pause
