@echo off
setlocal enabledelayedexpansion

:: Get current directory (U-disk root)
set "USB_ROOT=%~dp0"
:: Remove trailing backslash if present
if "%USB_ROOT:~-1%"=="\" set "USB_ROOT=%USB_ROOT:~0,-1%"

:: Set core isolation environment variables
set "HERMES_HOME=%USB_ROOT%\data"
set "HOME=%USB_ROOT%\data\home"
set "XDG_CONFIG_HOME=%USB_ROOT%\data"
set "PYTHONUTF8=1"

:: Expand PATH to include portable python (but skip Scripts to avoid broken .exe wrappers)
set "PATH=%USB_ROOT%\python_runtime;%PATH%"

:: Set PYTHONPATH to find the agent source
set "PYTHONPATH=%USB_ROOT%\hermes-agent;%PYTHONPATH%"

:: Ensure directories exist
if not exist "%USB_ROOT%\data" mkdir "%USB_ROOT%\data"
if not exist "%USB_ROOT%\data\home" mkdir "%USB_ROOT%\data\home"

:: Switch to USB drive and directory
cd /d "%USB_ROOT%"

:: Setup Command Aliases for portability
doskey hermes=python -m hermes_cli.main $*
doskey chat=python -m hermes_cli.main chat $*

echo ============================================================
echo   HermesUSB - Dedicated Console (Portable Env)
echo ============================================================
echo   Isolation:  %HERMES_HOME%
echo   Python:     %USB_ROOT%\python_runtime
echo.
echo   Quick Commands:
echo     - hermes chat
echo     - hermes setup
echo     - hermes gateway run
echo ============================================================

:: Keep the environment and open CMD
endlocal & set "HERMES_HOME=%HERMES_HOME%" & set "HOME=%HOME%" & set "XDG_CONFIG_HOME=%XDG_CONFIG_HOME%" & set "PYTHONUTF8=1" & set "PATH=%PATH%" & set "PYTHONPATH=%PYTHONPATH%" & cmd /k
