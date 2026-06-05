@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title 安杰版UI - Hermes Agent Web

:: ============================================================
:: 安杰版UI 一键启动 (Windows)
:: Hermes Agent Web 面板（Node + Express + Socket.IO）
:: 默认端口 5174，自动打开浏览器
:: ============================================================

pushd "%~dp0"
set "USB_ROOT=%CD%"

:: 环境变量隔离
set "HERMES_HOME=%USB_ROOT%\data"
set "HOME=%USB_ROOT%\data\home"
set "XDG_CONFIG_HOME=%USB_ROOT%\data"
set "XDG_DATA_HOME=%USB_ROOT%\data"
set "TMPDIR=%USB_ROOT%\tmp"
set "PYTHONDONTWRITEBYTECODE=1"
set "PATH=%USB_ROOT%\python_runtime;%PATH%"

if "%PORT%"=="" set "PORT=5174"

:: 检查 Node
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未找到 node，请先安装 Node.js ^>= 18.18
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node %%v

:: 首次运行：解压 node_modules
if not exist "%USB_ROOT%\node_modules" (
    if exist "%USB_ROOT%\node_modules.tar.gz" (
        echo [INFO] 首次运行，正在解压 node_modules...
        tar -xzf "%USB_ROOT%\node_modules.tar.gz" -C "%USB_ROOT%"
        echo [OK] node_modules 解压完成
    )
)
if not exist "%USB_ROOT%\node_modules" (
    echo [ERROR] 未找到 node_modules，请先运行 npm install
    pause
    exit /b 1
)

:: 加载 .env (from USB_ROOT if HERMES_HOME not yet set)
set "ENV_FILE=%USB_ROOT%\data\.env"
if exist "%HERMES_HOME%\.env" set "ENV_FILE=%HERMES_HOME%\.env"
if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%ENV_FILE%") do (
        if not "%%b"=="" set "%%a=%%b"
    )
)

:: 启动
set "URL=http://127.0.0.1:%PORT%"
echo [OK] 启动安杰版UI：%URL%
echo ------------------------------------------------------------

:: 延迟打开浏览器
start "" /b cmd /c "timeout /t 4 /nobreak >nul && start %URL%"

:: 启动 Node 服务
node "%USB_ROOT%\server\index.js"

popd
endlocal
