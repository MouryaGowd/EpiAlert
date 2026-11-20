@echo off
setlocal EnableExtensions
title EpiAlert

rem EpiAlert launcher for Windows. Needs Node.js 20 or newer.
rem   start.bat              install (first run only), build, start the server, open the browser
rem   start.bat test         run the automated tests
rem   start.bat experiments  regenerate the paper results (CSV, JSON, SVG)
rem   set PORT=4000 before running to use another port

cd /d "%~dp0functions" || (echo Could not find the functions folder next to this file. & pause & exit /b 1)

where node >nul 2>nul
if errorlevel 1 goto :nonode
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)"
if errorlevel 1 goto :oldnode

if not exist "node_modules\typescript" (
  echo Installing dependencies. First run only, needs internet access.
  call npm install
  if errorlevel 1 goto :fail
)

if /i "%~1"=="test" (
  call npm test
  goto :done
)
if /i "%~1"=="experiments" (
  call npm run experiments
  goto :done
)

if not defined PORT set PORT=3000
echo.
echo Building...
call npm run build
if errorlevel 1 goto :fail

echo.
echo Starting EpiAlert on http://localhost:%PORT%
echo Demo admin phone: +919999999999
echo Press Ctrl+C or close this window to stop.
start "" /min cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:%PORT%"
node lib\src\server.js
goto :done

:nonode
echo.
echo Node.js was not found.
echo Install the LTS version from https://nodejs.org then run this file again.
start "" https://nodejs.org/en/download
pause
exit /b 1

:oldnode
echo.
echo Node.js 20 or newer is required. This computer has:
node --version
echo Install the current LTS from https://nodejs.org then run this file again.
pause
exit /b 1

:fail
echo.
echo A step failed. Read the messages above.
pause
exit /b 1

:done
if errorlevel 1 (
  echo.
  echo Finished with errors.
  pause
  exit /b 1
)
echo.
pause
exit /b 0
