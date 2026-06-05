"""
Process handler for HermesUSB WebUI.
Manages starting/stopping/restarting the Hermes Agent process.
"""
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional
from .license_handler import verify_license


# Global reference to the managed Hermes process
_hermes_process: Optional[subprocess.Popen] = None
_hermes_start_time: Optional[float] = None


def _usb_root() -> Path:
    return Path(os.environ.get("USB_ROOT", str(Path(__file__).parent.parent.parent)))


def _python_runtime() -> Path:
    return _usb_root() / "python_runtime"


def _hermes_exe() -> Optional[Path]:
    """Find the hermes executable."""
    runtime = _python_runtime()
    exe = runtime / "Scripts" / "hermes.exe"
    return exe if exe.exists() else None


def _venv_python() -> Optional[Path]:
    """Find the embedded python executable."""
    runtime = _python_runtime()
    py = runtime / "python.exe"
    return py if py.exists() else None


def _build_env() -> dict:
    """Build environment variables for the Hermes process."""
    usb_root = _usb_root()
    env = os.environ.copy()
    env["HERMES_HOME"] = str(usb_root / "data")
    env["HOME"] = str(usb_root / "data" / "home")
    env["XDG_CONFIG_HOME"] = str(usb_root / "data")
    env["XDG_DATA_HOME"] = str(usb_root / "data")
    env["TMPDIR"] = str(usb_root / "tmp")
    env["PIP_CACHE_DIR"] = str(usb_root / "pip_cache")
    env["PYTHONDONTWRITEBYTECODE"] = "1"

    # Inject embedded python into PATH
    runtime = _python_runtime()
    env["PATH"] = str(runtime) + os.pathsep + str(runtime / "Scripts") + os.pathsep + env.get("PATH", "")

    # Data isolation variables (CRITICAL)
    env["HERMES_HOME"] = str(usb_root / "data")
    env["HOME"] = str(usb_root / "data" / "home")
    env["XDG_CONFIG_HOME"] = str(usb_root / "data")
    env["XDG_DATA_HOME"] = str(usb_root / "data")
    env["TMP"] = str(usb_root / "tmp")
    env["TEMP"] = str(usb_root / "tmp")
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    
    # Add hermes-agent to PYTHONPATH to ensure portability (vs absolute paths in editable install)
    env["PYTHONPATH"] = str(usb_root / "hermes-agent") + os.pathsep + env.get("PYTHONPATH", "")

    # Load .env
    env_file = usb_root / "data" / ".env"
    if env_file.exists():
        try:
            env_content = env_file.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            env_content = env_file.read_text(encoding="gbk", errors="replace")
            
        for line in env_content.splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()

    return env


def get_status() -> dict:
    """Get current Hermes process status."""
    global _hermes_process, _hermes_start_time

    hermes_exe = _hermes_exe()
    venv_ok = _venv_python() is not None

    status = {
        "installed": hermes_exe is not None,
        "venv_ok": venv_ok,
        "running": False,
        "pid": None,
        "uptime": None,
        "usb_root": str(_usb_root()),
        "license": verify_license(),
    }

    if _hermes_process is not None:
        poll = _hermes_process.poll()
        if poll is None:
            # Still running
            status["running"] = True
            status["pid"] = _hermes_process.pid
            if _hermes_start_time:
                status["uptime"] = int(time.time() - _hermes_start_time)
        else:
            # Exited
            _hermes_process = None
            _hermes_start_time = None

    # Robust detection: check system process list using powershell if internal handle is None or stale
    if not status["running"] and sys.platform == "win32":
        try:
            # Use PowerShell to get command line - more stable on Win11 than wmic
            ps_cmd = [
                'powershell', '-NoProfile', '-Command', 
                'Get-CimInstance Win32_Process -Filter "name=\'python.exe\'" | Select-Object CommandLine, ProcessId | ConvertTo-Csv -NoTypeInformation'
            ]
            output = subprocess.check_output(ps_cmd).decode('gbk', errors='ignore')
            
            lines = output.strip().split('\n')
            # Skip header
            for line in lines[1:]:
                line_lower = line.lower()
                if 'hermes_cli' in line_lower and str(_usb_root()).lower() in line_lower:
                    status["running"] = True
                    # "CommandLine","ProcessId"
                    parts = line.strip('"').split('","')
                    if len(parts) >= 2:
                        try:
                            status["pid"] = int(parts[-1].strip('"'))
                        except ValueError:
                            pass
                    break
        except Exception as e:
            # Fallback to simple tasklist check if powershell fails
            try:
                output = subprocess.check_output('tasklist /FI "IMAGENAME eq python.exe" /FO CSV', shell=True).decode('gbk', errors='ignore')
                if 'python.exe' in output and 'hermes' in output.lower():
                     # This is a very weak check but better than nothing
                    status["running"] = True
            except:
                pass


    return status


def start_hermes(mode: str = "gateway") -> dict:
    """Start the Hermes Agent process."""
    global _hermes_process, _hermes_start_time

    if _hermes_process is not None and _hermes_process.poll() is None:
        return {"ok": False, "error": "Hermes 已在运行中", "pid": _hermes_process.pid}

    hermes_exe = _hermes_exe()
    if hermes_exe is None:
        return {"ok": False, "error": "未找到 hermes 可执行文件，请先运行 Setup"}

    # --- License Enforcement ---
    lic = verify_license()
    if not lic["ok"]:
        return {"ok": False, "error": f"授权错误: {lic.get('error', '未知授权错误')}"}

    env = _build_env()
    usb_root = _usb_root()

    # Ensure dirs exist
    (usb_root / "tmp").mkdir(exist_ok=True)
    (usb_root / "data" / "home").mkdir(parents=True, exist_ok=True)
    (usb_root / "data" / "logs").mkdir(parents=True, exist_ok=True)

    runtime = usb_root / "python_runtime"
    python_exe = runtime / "python.exe"

    # Pre-startup cleanup: Delete stale gateway.pid (on Windows it causes WinError 87 during existence check)
    pid_file = usb_root / "data" / "gateway.pid"
    if pid_file.exists():
        try:
            pid_file.unlink()
        except Exception:
            pass

    # Use direct python -m hermes_cli.main for more reliable background tracking
    args = [str(python_exe), "-m", "hermes_cli.main"]
    if mode == "gateway":
        args.append("gateway")
    elif mode == "chat":
        args.append("chat")

    # Redirect output to a file instead of a pipe to prevent Windows pipe buffer overflow/hangs
    runtime_log = usb_root / "data" / "logs" / "agent_runtime.log"
    try:
        log_file_handle = open(runtime_log, "a", encoding="utf-8")
    except Exception:
        log_file_handle = None

    try:
        _hermes_process = subprocess.Popen(
            args,
            env=env,
            cwd=str(usb_root / "data"),
            stdout=log_file_handle if log_file_handle else subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP | 0x08000000) if sys.platform == "win32" else 0,
        )
        _hermes_start_time = time.time()
        return {"ok": True, "pid": _hermes_process.pid, "mode": mode}
    except Exception as e:
        return {"ok": False, "error": f"启动进程失败: {str(e)}"}


def start_visible_hermes(mode: str = "gateway", platform: Optional[str] = None) -> dict:
    """Start Hermes in a visible terminal window (Windows only)."""
    if sys.platform != "win32":
        return {"ok": False, "error": "该功能仅支持 Windows 系统"}

    hermes_exe = _hermes_exe()
    if hermes_exe is None:
        return {"ok": False, "error": "未找到 hermes 可执行文件"}

    # License check
    lic = verify_license()
    if not lic["ok"]:
        return {"ok": False, "error": f"授权错误: {lic.get('error')}"}

    usb_root = _usb_root()
    python_exe = _venv_python()
    runtime = usb_root / "python_runtime"

    # Build the specific command to open a new terminal
    # We pass the HERMES_HOME and other isolation envs
    env = _build_env()
    set_envs = []
    # Only pass essential envs into the CMD shell to avoid command length limits
    essential_keys = ["HERMES_HOME", "HOME", "XDG_CONFIG_HOME", "PYTHONUTF8", "TMP", "TEMP"]
    for k in essential_keys:
        if k in env:
            set_envs.append(f"set {k}={env[k]}")

    # Add runtime to path in the new shell
    set_envs.append(f"set PATH={runtime};{runtime / 'Scripts'};%PATH%")

    # Add hermes-agent to PYTHONPATH in the new shell
    agent_dir = usb_root / "hermes-agent"
    set_envs.append(f"set PYTHONPATH={agent_dir};%PYTHONPATH%")

    # Build the command based on whether we want a general run or a specific platform setup
    if platform == "weixin":
        # Direct call to the WeChat setup flow to ensure QR code appears immediately
        cmd_inner = f'"{python_exe}" -c "import sys; from hermes_cli.gateway import _setup_weixin; _setup_weixin()"'
    elif platform == "feishu":
        # Direct call to the Feishu setup flow (QR scan-to-create or manual credentials)
        cmd_inner = f'"{python_exe}" -c "import sys; from hermes_cli.gateway import _setup_feishu; _setup_feishu()"'
    else:
        # Standard foreground gateway run
        cmd_inner = f'"{python_exe}" -m hermes_cli.main gateway run'
    
    # Create a temporary batch file to avoid quoting issues in 'cmd /k'
    bat_path = usb_root / "data" / "hermes_login.bat"
    bat_content = ["@echo off", "echo --- Hermes Terminal Login ---"]
    bat_content.extend(set_envs)
    bat_content.append(cmd_inner)
    bat_content.append("pause") # Keep window open if it crashes early
    
    try:
        with open(bat_path, "w", encoding="gbk") as f: # Use GBK for Windows Batch compatibility
            f.write("\n".join(bat_content))
            
        full_cmd = f'start "Hermes-Visible-Terminal" cmd /k "{bat_path}"'
        subprocess.Popen(full_cmd, shell=True, cwd=str(usb_root / "data"))
        return {"ok": True, "message": "正在打开终端登录窗口，请稍后扫码..."}
    except Exception as e:
        return {"ok": False, "error": f"启动终端失败: {str(e)}"}


def stop_hermes() -> dict:
    """Stop the Hermes Agent process."""
    global _hermes_process, _hermes_start_time

    status = get_status()
    if _hermes_process is None or _hermes_process.poll() is not None:
        _hermes_process = None
        if status["running"]:
            return {"ok": True, "message": "Hermes 已在运行中", "pid": status.get("pid")}
        return {"ok": True, "message": "Hermes 未在运行"}

    status = get_status()
    pid = status.get("pid")

    try:
        if _hermes_process is not None:
            _hermes_process.terminate()
            try:
                _hermes_process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                _hermes_process.kill()
            _hermes_process = None
            _hermes_start_time = None
        elif pid:
            # Kill orphaned process by PID on Windows
            if sys.platform == "win32":
                subprocess.run(f"taskkill /F /PID {pid}", shell=True, capture_output=True)
            else:
                os.kill(pid, signal.SIGTERM)
        
        _hermes_start_time = None
        return {"ok": True, "message": f"已停止 Hermes (PID: {pid if pid else 'unknown'})"}
    except Exception as e:
        return {"ok": False, "error": f"停止失败: {str(e)}"}


def restart_hermes(mode: str = "gateway") -> dict:
    """Restart the Hermes Agent process."""
    stop_result = stop_hermes()
    time.sleep(1)
    start_result = start_hermes(mode=mode)
    return {
        "ok": start_result["ok"],
        "stop": stop_result,
        "start": start_result,
    }


def read_logs(lines: int = 100) -> list:
    """Read recent lines from the Hermes process output."""
    log_file = _usb_root() / "data" / "logs" / "agent_runtime.log"
    if log_file.exists():
        try:
            all_lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
            return all_lines[-lines:]
        except Exception:
            pass
    return []


def shutdown_all() -> None:
    """Shutdown both the Hermes process and any other associated resources."""
    print("Shutting down all processes...")
    stop_hermes()
