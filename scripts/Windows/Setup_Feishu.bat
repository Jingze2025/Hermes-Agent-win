@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

:: ============================================================
:: HermesUSB - Feishu / Lark Gateway Setup
::
:: Interactive wizard to configure Feishu/Lark bot
:: credentials (scan QR code or manual input).
:: ============================================================

:: --- Resolve USB_ROOT ---
pushd "%~dp0..\.."
set "USB_ROOT=%CD%"
popd

echo.
echo ============================================================
echo   HermesUSB - Feishu / Lark Gateway Setup
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
set "PYTHONUTF8=1"
set "TMP=%USB_ROOT%\tmp"
set "TEMP=%USB_ROOT%\tmp"
set "PATH=%PYTHON_RUNTIME_DIR%;%PYTHON_RUNTIME_DIR%\Scripts;%PATH%"
set "PYTHONPATH=%USB_ROOT%\hermes-agent;%PYTHONPATH%"

:: Ensure required dirs exist
if not exist "%USB_ROOT%\data\home" mkdir "%USB_ROOT%\data\home"
if not exist "%USB_ROOT%\tmp" mkdir "%USB_ROOT%\tmp"
if not exist "%USB_ROOT%\pip_cache" mkdir "%USB_ROOT%\pip_cache"

echo [OK] Python: %PYTHON_RUNTIME_DIR%\python.exe
echo [OK] Data:   %USB_ROOT%\data
echo.

:: --- Launch Feishu Gateway Setup ---
"%PYTHON_RUNTIME_DIR%\python.exe" -c "import sys; from hermes_cli.gateway import _setup_feishu; _setup_feishu()"

set "EXIT_CODE=!errorlevel!"

echo.
echo Feishu Setup exited with code !EXIT_CODE!
pause

endlocal
exit /b %EXIT_CODE%
