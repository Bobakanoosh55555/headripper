@echo off
:: update_players.bat
:: Drag a tournament JSON file onto this batch file to update players.json.
:: Requires update_players.py to be in the same folder as this batch file.
:: Requires Python to be installed and on PATH.

setlocal enabledelayedexpansion

if "%~1"=="" (
    echo No file dropped. Drag a tournament JSON file onto this script.
    pause
    exit /b 1
)

set SCRIPT_DIR=%~dp0
set SCRIPT=%SCRIPT_DIR%update_players.py
set PLAYERS=%SCRIPT_DIR%players.json

echo Processing: %~nx1
python "!SCRIPT!" "%~1" "!PLAYERS!"
if errorlevel 1 (
    echo   ERROR processing %~nx1
)

pause
