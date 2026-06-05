@echo off
set "USB_ROOT=%~dp0"
if "%USB_ROOT:~-1%"=="\" set "USB_ROOT=%USB_ROOT:~0,-1%"
cd /d "%USB_ROOT%"

echo ========================================
echo     京择AGI-Hermes 授权制卡工具
echo ========================================
echo.

set "PY_EXE=python_runtime\python.exe"
set "GEN_SCRIPT=scripts\internal\license_gen.py"

if not exist "%PY_EXE%" (
    echo [ERROR] 未找到 Python 环境。
    pause
    exit /b 1
)

"%PY_EXE%" "%GEN_SCRIPT%"

echo.
pause
exit /b 0
