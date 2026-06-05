@echo off
echo --- Hermes Terminal Login ---
set HERMES_HOME=E:\hermes_usb\data
set HOME=E:\hermes_usb\data\home
set XDG_CONFIG_HOME=E:\hermes_usb\data
set PYTHONUTF8=1
set TMP=E:\hermes_usb\tmp
set TEMP=E:\hermes_usb\tmp
set PATH=E:\hermes_usb\python_runtime;E:\hermes_usb\python_runtime\Scripts;%PATH%
set PYTHONPATH=E:\hermes_usb\hermes-agent;%PYTHONPATH%
"E:\hermes_usb\python_runtime\python.exe" -c "import sys; from hermes_cli.gateway import _setup_feishu; _setup_feishu()"
pause