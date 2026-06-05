import sys
import os
import ctypes
from pathlib import Path

# Setup paths to import our license handler
USB_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(USB_ROOT / "webui"))

try:
    from api.license_handler import get_volume_serial, generate_license_key
except ImportError:
    print("[错误] 无法加载授权核心模块，请确保 webui/api/license_handler.py 存在。")
    sys.exit(1)

def main():
    print("========================================")
    print("    京择AGI-Hermes 授权制卡工具")
    print("========================================")
    print()
    
    serial = get_volume_serial()
    if serial == "UNKNOWN":
        print("[失败] 无法读取当前 U 盘的硬件码。")
        return

    print(f"当前 U 盘硬件码: {serial}")
    print("----------------------------------------")
    print("说明：本工具将为当前 U 盘生成唯一的 license.key 文件。")
    print("生成后，该 U 盘即可在这台或任何电脑上被逻辑识别为 [正版授权]。")
    print("如果您将文件拷贝到另一个 U 盘，则需要重新运行此工具。")
    print("----------------------------------------")
    print()
    
    confirm = input("确定要为该 U 盘写入授权吗？(Y/N): ")
    if confirm.upper() == 'Y':
        key = generate_license_key(serial)
        data_dir = USB_ROOT / "data"
        data_dir.mkdir(parents=True, exist_ok=True)
        
        license_file = data_dir / "license.key"
        license_file.write_text(key, encoding="utf-8")
        
        print()
        print(f"[成功] 授权文件已生成！")
        print(f"位置: data\\license.key")
        print(f"您可以现在开始分发该 U 盘了。")
    else:
        print("\n[操作已取消]")

if __name__ == "__main__":
    main()
