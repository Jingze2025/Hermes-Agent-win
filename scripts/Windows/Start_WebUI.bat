@echo off
if "%1"=="SILENT" set "SILENT_MODE=1"
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

:: ============================================================
::  HermesUSB - Start WebUI Configuration Panel
:: ============================================================

:: Resolve USB root (parent of scripts\Windows)
set "USB_ROOT=%~dp0..\.."
pushd "%USB_ROOT%"
set "USB_ROOT=%CD%"
popd

echo.
echo ============================================================
echo   HermesUSB WebUI - Configuration Panel
echo ============================================================
echo   USB Root: %USB_ROOT%
echo.

:: Check python_runtime
if not exist "%USB_ROOT%\python_runtime\python.exe" (
    echo   [ERROR] Portable Python environment not found!
    echo   Please copy the complete package or recreate python_runtime.
    echo.
    pause
    exit /b 1
)

:: No venv activation needed, using embedded python directly
set "PATH=%USB_ROOT%\python_runtime;%USB_ROOT%\python_runtime\Scripts;%PATH%"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONPATH=%USB_ROOT%\hermes-agent;%PYTHONPATH%"

:: Set USB isolation
set "USB_ROOT=%USB_ROOT%"
set "HERMES_HOME=%USB_ROOT%\data"
set "HOME=%USB_ROOT%\data\home"
set "XDG_CONFIG_HOME=%USB_ROOT%\data"
set "TMPDIR=%USB_ROOT%\tmp"
set "PIP_CACHE_DIR=%USB_ROOT%\pip_cache"

:: Ensure dependencies are installed
"%USB_ROOT%\python_runtime\python.exe" -c "import yaml" >nul 2>&1
if errorlevel 1 (
    echo   Installing PyYAML...
    "%USB_ROOT%\python_runtime\python.exe" -m pip install pyyaml --quiet
    echo   [OK] PyYAML installed
)

"%USB_ROOT%\python_runtime\python.exe" -c "import openai" >nul 2>&1
if errorlevel 1 (
    echo   Installing openai library for Chat...
    "%USB_ROOT%\python_runtime\python.exe" -m pip install openai --quiet
    echo   [OK] openai installed
)

:: Create data dirs if missing
if not exist "%USB_ROOT%\data" mkdir "%USB_ROOT%\data"
if not exist "%USB_ROOT%\data\home" mkdir "%USB_ROOT%\data\home"
if not exist "%USB_ROOT%\tmp" mkdir "%USB_ROOT%\tmp"
if not exist "%USB_ROOT%\pip_cache" mkdir "%USB_ROOT%\pip_cache"

echo   Starting WebUI server...
echo   Open in browser: http://localhost:8818
echo.

:: Open browser after a short delay
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8818"

:: Run server
"%USB_ROOT%\python_runtime\python.exe" "%USB_ROOT%\webui\server.py"

if "%SILENT_MODE%"=="1" exit
pause
