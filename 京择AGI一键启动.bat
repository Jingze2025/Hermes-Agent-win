@echo off
chcp 65001 >nul 2>&1
title 京择AGI WebUI

echo.
echo   [京择AGI-Hermes] 正在启动控制台...
echo   页面将自动在浏览器中打开。
echo.
timeout /t 1 /nobreak >nul

call "%~dp0scripts\Windows\Start_WebUI.bat"
