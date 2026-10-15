@echo off
REM Release a new version of Nexus Insights to GitHub.
REM Bumps the version (1.0.1 -> 1.0.2), builds the installer, uploads it as a
REM GitHub Release, then commits and pushes. Installed copies update from the
REM update button in the top-right corner of the app.
REM Needs a GitHub token in %%APPDATA%%\nexus-insights\github-token.txt

title Releasing Nexus Insights update
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

echo.
echo   This will publish a NEW VERSION that everyone with the app can install.
echo   Close this window now to cancel, or
pause

node scripts\build-installer.js --publish
if errorlevel 1 (
    echo.
    echo   The release did not finish. Scroll up for the reason.
    pause
    exit /b 1
)
pause
