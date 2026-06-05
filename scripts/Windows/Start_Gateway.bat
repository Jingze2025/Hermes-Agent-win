@echo off
chcp 65001 >nul 2>&1
:: ============================================================
:: HermesUSB - Start Gateway Service
::
:: Activates the USB venv, isolates all data to USB,
:: and launches Hermes Gateway (Telegram/Discord/etc).
:: ============================================================
setlocal EnableDelayedExpansion

:: --- Resolve USB_ROOT ---
pushd "%~dp0..\.."
set "USB_ROOT=%CD%"
popd

echo.
echo ============================================================
echo   HermesUSB - Starting Gateway Service
echo ============================================================
echo   USB Root: %USB_ROOT%
echo.

:: --- Check if portable runtime exists ---
set "PYTHON_RUNTIME_DIR=%USB_ROOT%\python_runtime"

if not exist "%PYTHON_RUNTIME_DIR%\python.exe" (
    echo [ERROR] Portable Python environment not found!
    echo Please ensure python_runtime exists on the USB drive.
    pause
    exit /b 1
)

:: --- Set environment variables for data isolation ---
set "HERMES_HOME=%USB_ROOT%\data"
set "HOME=%USB_ROOT%\data\home"
set "XDG_CONFIG_HOME=%USB_ROOT%\data"
set "XDG_DATA_HOME=%USB_ROOT%\data"
set "TMP=%USB_ROOT%\tmp"
set "TEMP=%USB_ROOT%\tmp"
set "PIP_CACHE_DIR=%USB_ROOT%\pip_cache"
set "PYTHONDONTWRITEBYTECODE=1"
set "PYTHONPATH=%USB_ROOT%\hermes-agent;%PYTHONPATH%"

if not exist "%USB_ROOT%\tmp" mkdir "%USB_ROOT%\tmp"
if not exist "%USB_ROOT%\pip_cache" mkdir "%USB_ROOT%\pip_cache"

:: --- Set PATH to embedded python ---
set "PATH=%PYTHON_RUNTIME_DIR%;%PYTHON_RUNTIME_DIR%\Scripts;%PATH%"

:: Load .env if it exists
if exist "%USB_ROOT%\data\.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%USB_ROOT%\data\.env") do (
        set "%%a=%%b" 2>nul
    )
)

echo [OK] Python: %PYTHON_RUNTIME_DIR%\python.exe
echo [OK] Data:   %USB_ROOT%\data
echo.
echo Starting Hermes Gateway...
echo (Press Ctrl+C to stop)
echo.

:: --- Launch Gateway ---
:: Run as Python module to ensure portability (avoiding hardcoded paths in .exe wrappers)
"%PYTHON_RUNTIME_DIR%\python.exe" -m hermes_cli.main gateway %*

set "EXIT_CODE=!errorlevel!"

echo.
echo Gateway exited with code !EXIT_CODE!
pause

endlocal
exit /b %EXIT_CODE%
