@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

:: ============================================================
:: HermesUSB - Start Pro WebUI (安杰版UI)
::
:: Node.js + Express + Socket.IO web panel on port 5174
:: ============================================================

:: --- Resolve USB_ROOT ---
pushd "%~dp0..\.."
set "USB_ROOT=%CD%"
popd

:: --- Set environment variables for data isolation ---
set "HERMES_HOME=%USB_ROOT%\data"
set "HOME=%USB_ROOT%\data\home"
set "XDG_CONFIG_HOME=%USB_ROOT%\data"
set "XDG_DATA_HOME=%USB_ROOT%\data"
set "TMPDIR=%USB_ROOT%\tmp"
set "PYTHONDONTWRITEBYTECODE=1"
set "PATH=%USB_ROOT%\python_runtime;%PATH%"

:: Ensure dirs exist
if not exist "%USB_ROOT%\data" mkdir "%USB_ROOT%\data"
if not exist "%USB_ROOT%\data\home" mkdir "%USB_ROOT%\data\home"
if not exist "%USB_ROOT%\tmp" mkdir "%USB_ROOT%\tmp"

:: Load .env if it exists
if exist "%HERMES_HOME%\.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%HERMES_HOME%\.env") do (
        if not "%%b"=="" set "%%a=%%b"
    )
)

cd /d "%USB_ROOT%\server"

echo ========================================
echo   Hermes Pro WebUI - 安杰版UI
echo ========================================
echo   USB Root: %USB_ROOT%
echo   Port: %PORT%
echo ========================================

:: Auto-kill port 5174 if already in use
set "DEFAULT_PORT=5174"
if "%PORT%"=="" set "PORT=%DEFAULT_PORT%"

echo Checking port %PORT%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%" ^| findstr LISTENING') do (
    if not "%%a"=="" (
        echo Killing process %%a on port %PORT%...
        taskkill /F /PID %%a >nul 2>&1
    )
)

echo Starting Node.js server...
node index.js

set "EXIT_CODE=!errorlevel!"
echo.
echo Pro WebUI exited with code !EXIT_CODE!
pause

endlocal
exit /b %EXIT_CODE%
