@echo off
cd /d "%~dp0"
echo Starting Server...

:: Check if npm is available
where npm >nul 2>nul
if errorlevel 1 (
    echo npm not found. Please install Node.js.
    exit /b 1
)

:: Start the server and log the output
start /min npm start 



:: Exit the script
exit /b 0
