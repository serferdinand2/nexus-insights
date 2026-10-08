@echo off
REM Build a clean, shareable Nexus Insights installer.
REM Output: dist\Nexus Insights Setup <version>.exe
REM Your own app, API key and match history are not affected or included.

title Building Nexus Insights installer
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo   Node.js was not found on this PC.
    echo   Install it from https://nodejs.org ^(the LTS version^), then run this again.
    echo.
    pause
    exit /b 1
)

node scripts\build-installer.js
if errorlevel 1 (
    echo.
    echo   The build did not finish. Scroll up for the reason.
    pause
    exit /b 1
)

REM Open the dist folder so the installer is right there
explorer "%~dp0dist"
pause
