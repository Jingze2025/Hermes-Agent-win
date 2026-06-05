@echo off
setlocal
pushd "%~dp0"
set "USB_ROOT=%CD%"
set "HERMES_HOME=%USB_ROOT%\data"
set "PYTHONPATH=%USB_ROOT%\hermes-agent;%PYTHONPATH%"
set "PATH=%USB_ROOT%\python_runtime;%PATH%"
"%USB_ROOT%\python_runtime\python.exe" -m hermes_cli.main %*
popd
endlocal
