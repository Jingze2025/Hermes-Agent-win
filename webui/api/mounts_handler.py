"""
Local directory mounts handler for HermesUSB WebUI.
Manages user-specified local directories that Hermes can access.
Persists to data/local_mounts.json and updates config.yaml terminal.cwd.
"""
import json
import os
import re
import string
from pathlib import Path
from typing import List, Optional

from .config_handler import read_config, write_config

# ── Constants ─────────────────────────────────────────────────────────────────

_WINDOWS_RESERVED_NAMES = frozenset([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
])

# Characters not allowed in Windows path components (but : is ok for drive letter)
_ILLEGAL_CHARS_RE = re.compile(r'[<>"|?*]')


def _usb_root() -> Path:
    return Path(os.environ.get("USB_ROOT", str(Path(__file__).parent.parent.parent)))


def _mounts_file() -> Path:
    return _usb_root() / "data" / "local_mounts.json"


# ── Persistence ───────────────────────────────────────────────────────────────

def _load_mounts() -> List[dict]:
    """Load saved mounts from JSON file."""
    f = _mounts_file()
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_mounts(mounts: List[dict]):
    """Save mounts to JSON file."""
    f = _mounts_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(mounts, ensure_ascii=False, indent=2), encoding="utf-8")


# ── Validation ────────────────────────────────────────────────────────────────

def validate_path(path_str: str) -> Optional[str]:
    """
    Validate a Windows path. Returns error message or None if valid.
    Checks:
    - Not empty
    - No illegal characters (except : for drive letter)
    - No reserved names
    - Path actually exists on disk
    - Is a directory
    """
    if not path_str or not path_str.strip():
        return "路径不能为空"

    path_str = path_str.strip()

    # Normalize separators
    normalized = path_str.replace("/", "\\")

    # Check for illegal characters (skip drive letter colon)
    # Split off drive letter first
    if len(normalized) >= 2 and normalized[1] == ":":
        drive = normalized[:2]
        rest = normalized[2:]
    else:
        drive = ""
        rest = normalized

    if _ILLEGAL_CHARS_RE.search(rest):
        return f"路径包含非法字符: < > \" | ? *"

    # Check each path component for reserved names
    parts = Path(normalized).parts
    for part in parts:
        name_upper = part.upper().split(".")[0]  # CON.txt -> CON
        if name_upper in _WINDOWS_RESERVED_NAMES:
            return f"路径包含 Windows 保留名称: {part}"

    # Check existence
    try:
        p = Path(path_str)
        if not p.exists():
            return f"路径不存在: {path_str}"
        if not p.is_dir():
            return f"路径不是文件夹: {path_str}"
    except (OSError, ValueError) as e:
        return f"路径无效: {str(e)}"

    return None


# ── API Functions ─────────────────────────────────────────────────────────────

def get_mounts() -> dict:
    """Get all configured mount points."""
    mounts = _load_mounts()
    # Verify each mount still exists
    for m in mounts:
        m["exists"] = Path(m["path"]).is_dir() if m.get("path") else False
    return {"mounts": mounts}


def add_mounts(paths: List[str]) -> dict:
    """
    Add multiple directory paths as mount points.
    Validates each path, deduplicates, saves to config.
    Returns result with successes and failures.
    """
    if not paths:
        return {"ok": False, "error": "未提供路径"}

    existing = _load_mounts()
    existing_paths = {m["path"].lower().rstrip("\\") for m in existing}

    added = []
    errors = []

    for raw_path in paths:
        path_str = raw_path.strip().rstrip("\\")
        if not path_str:
            continue

        # Validate
        err = validate_path(path_str)
        if err:
            errors.append({"path": path_str, "error": err})
            continue

        # Resolve to absolute
        try:
            resolved = str(Path(path_str).resolve())
        except (OSError, ValueError):
            errors.append({"path": path_str, "error": "无法解析路径"})
            continue

        # Deduplicate
        if resolved.lower().rstrip("\\") in existing_paths:
            errors.append({"path": path_str, "error": "已存在，跳过重复"})
            continue

        mount_entry = {
            "path": resolved,
            "label": Path(resolved).name or resolved,
            "rw": True,  # Read-write by default
            "enabled": True,
        }
        existing.append(mount_entry)
        existing_paths.add(resolved.lower().rstrip("\\"))
        added.append(mount_entry)

    _save_mounts(existing)

    # Update Hermes config
    _sync_config(existing)

    return {
        "ok": True,
        "added": len(added),
        "errors": errors,
        "message": f"成功添加 {len(added)} 个目录" + (f"，{len(errors)} 个失败" if errors else ""),
    }


def remove_mount(path: str) -> dict:
    """Remove a mount point by path."""
    mounts = _load_mounts()
    normalized = path.lower().rstrip("\\")
    new_mounts = [m for m in mounts if m["path"].lower().rstrip("\\") != normalized]

    if len(new_mounts) == len(mounts):
        return {"ok": False, "error": "未找到该挂载路径"}

    _save_mounts(new_mounts)
    _sync_config(new_mounts)
    return {"ok": True, "message": f"已移除: {path}"}


def toggle_mount(path: str, enabled: bool = None, rw: bool = None) -> dict:
    """Toggle enabled/rw status of a mount."""
    mounts = _load_mounts()
    normalized = path.lower().rstrip("\\")
    found = False

    for m in mounts:
        if m["path"].lower().rstrip("\\") == normalized:
            if enabled is not None:
                m["enabled"] = enabled
            if rw is not None:
                m["rw"] = rw
            found = True
            break

    if not found:
        return {"ok": False, "error": "未找到该挂载路径"}

    _save_mounts(mounts)
    _sync_config(mounts)
    return {"ok": True, "message": "已更新"}


def browse_directory(start_path: str = "") -> dict:
    """
    Browse directories on the local filesystem.
    Returns list of subdirectories at the given path.
    Used for the folder picker UI.
    """
    if not start_path:
        # Return drive letters on Windows
        import string
        drives = []
        for letter in string.ascii_uppercase:
            drive = f"{letter}:\\"
            if Path(drive).exists():
                drives.append({"path": drive, "name": f"{letter}:", "type": "drive"})
        return {"items": drives, "current": ""}

    try:
        p = Path(start_path)
        if not p.exists() or not p.is_dir():
            return {"items": [], "current": start_path, "error": "路径不存在"}

        items = []
        try:
            for child in sorted(p.iterdir()):
                if child.is_dir() and not child.name.startswith("."):
                    try:
                        # Quick access check
                        list(child.iterdir())
                        items.append({
                            "path": str(child),
                            "name": child.name,
                            "type": "folder",
                        })
                    except PermissionError:
                        items.append({
                            "path": str(child),
                            "name": child.name,
                            "type": "folder",
                            "locked": True,
                        })
        except PermissionError:
            return {"items": [], "current": start_path, "error": "无权限访问该目录"}

        parent = str(p.parent) if p.parent != p else ""
        return {"items": items[:100], "current": start_path, "parent": parent}

    except (OSError, ValueError) as e:
        return {"items": [], "current": start_path, "error": str(e)}


# ── Config Sync ───────────────────────────────────────────────────────────────

def _sync_config(mounts: List[dict]):
    """
    Sync mount configuration to Hermes config.yaml.
    Sets terminal.cwd to the first enabled mount (or a common parent).
    Also writes allowed paths info for the agent's system prompt.
    """
    config = read_config()

    enabled_mounts = [m for m in mounts if m.get("enabled")]
    enabled_paths = [m["path"] for m in enabled_mounts]

    # Determine terminal.cwd
    if len(enabled_paths) == 1:
        cwd = enabled_paths[0]
    elif len(enabled_paths) > 1:
        # Find common parent, or use the first path
        try:
            common = os.path.commonpath(enabled_paths)
            # If common is just a drive root (e.g. C:\), use first path instead
            if len(common) <= 3:
                cwd = enabled_paths[0]
            else:
                cwd = common
        except (ValueError, TypeError):
            cwd = enabled_paths[0]
    else:
        cwd = "."

    # Update config
    if "terminal" not in config:
        config["terminal"] = {}
    config["terminal"]["cwd"] = cwd

    # Store the full mount list in config for reference
    config["terminal"]["local_mounts"] = enabled_paths

    write_config(config)
