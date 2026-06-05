import os
import ctypes
import hashlib
from pathlib import Path

# --- Configuration ---
SALT = "JZ-Hermes-Secret-2026-Security"

def _usb_root() -> Path:
    return Path(os.environ.get("USB_ROOT", str(Path(__file__).parent.parent.parent)))

def get_volume_serial() -> str:
    """Read the Volume Serial Number of the current drive (e.g. D8BD-46A3)."""
    try:
        drive = str(_usb_root().anchor)
        serial = ctypes.c_uint32()
        ctypes.windll.kernel32.GetVolumeInformationW(
            ctypes.c_wchar_p(drive), None, 0, ctypes.byref(serial), None, None, None, 0
        )
        full_hex = hex(serial.value)[2:].upper().zfill(8)
        return f"{full_hex[:4]}-{full_hex[4:]}"
    except Exception:
        return "UNKNOWN"

def generate_license_key(serial: str) -> str:
    """Generate the hashed license key for a given serial number."""
    if not serial or serial == "UNKNOWN":
        return ""
    combined = f"{serial}:{SALT}"
    return hashlib.sha256(combined.encode()).hexdigest().upper()

def verify_license() -> dict:
    """
    Check if the license is valid.
    Returns: {"ok": bool, "serial": str, "error": str}
    """
    license_file = _usb_root() / "data" / "license.key"
    current_serial = get_volume_serial()
    
    if current_serial == "UNKNOWN":
        return {"ok": False, "serial": "UNKNOWN", "error": "无法读取驱动器硬件指纹"}

    if not license_file.exists():
        return {"ok": False, "serial": current_serial, "error": "未找到授权文件 (license.key)"}

    try:
        try:
            stored_key = license_file.read_text(encoding="utf-8").strip()
        except UnicodeDecodeError:
            stored_key = license_file.read_text(encoding="gbk", errors="replace").strip()
        expected_key = generate_license_key(current_serial)
        
        if stored_key == expected_key:
            return {"ok": True, "serial": current_serial}
        else:
            return {"ok": False, "serial": current_serial, "error": "授权无效：硬件指纹不匹配 (该 U 盘可能已被非法复制)"}
    except Exception as e:
        return {"ok": False, "serial": current_serial, "error": f"授权验证失败: {str(e)}"}
