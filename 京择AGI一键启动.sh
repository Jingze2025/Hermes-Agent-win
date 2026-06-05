#!/usr/bin/env bash
# ============================================================
# 京择AGI WebUI 一键启动 (macOS)
# 启动老版京择AGI配置面板 (端口 8818)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_ROOT="$SCRIPT_DIR"

# 架构检测
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) RUNTIME_DIR="$USB_ROOT/python_runtime_mac_arm64" ;;
  x86_64)        RUNTIME_DIR="$USB_ROOT/python_runtime_mac_x86_64" ;;
  *) echo "[ERROR] 不支持的架构：$ARCH"; exit 1 ;;
esac

# 尝试 python3，如果失败则尝试 python3.12 (兼容 FAT32/exFAT 下 symlink 失效)
PYTHON_EXE=""
for candidate in "$RUNTIME_DIR/bin/python3" "$RUNTIME_DIR/bin/python3.12"; do
  if [ -x "$candidate" ]; then
    PYTHON_EXE="$candidate"
    break
  fi
done
if [ -z "$PYTHON_EXE" ]; then
  if [ "$ARCH" = "arm64" ]; then
    for candidate in "$USB_ROOT/python_runtime_mac_x86_64/bin/python3" "$USB_ROOT/python_runtime_mac_x86_64/bin/python3.12"; do
      if [ -x "$candidate" ]; then
        PYTHON_EXE="$candidate"
        break
      fi
    done
  fi
  if [ -z "$PYTHON_EXE" ]; then
    echo "[ERROR] 未找到可用的 Python Runtime (尝试了 python3 和 python3.12)"
    exit 1
  fi
fi

# 环境隔离
export HERMES_HOME="$USB_ROOT/data"
export HOME="$USB_ROOT/data/home"
export XDG_CONFIG_HOME="$USB_ROOT/data"
export USB_ROOT="$USB_ROOT"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="$USB_ROOT/hermes-agent:$PYTHONPATH"
export PATH="$RUNTIME_DIR/bin:$PATH"

mkdir -p "$USB_ROOT/data/home" "$USB_ROOT/tmp"

# 加载 .env
if [ -f "$USB_ROOT/data/.env" ]; then
  set -a; . "$USB_ROOT/data/.env"; set +a
fi

echo ""
echo "============================================================"
echo "  京择AGI WebUI 一键启动 (macOS)"
echo "============================================================"
echo "  USB Root: $USB_ROOT"
echo "  Python:   $PYTHON_EXE"
echo "  地址:     http://127.0.0.1:8818"
echo ""

# 延迟打开浏览器
(sleep 2 && open "http://127.0.0.1:8818" >/dev/null 2>&1 || true) &

exec "$PYTHON_EXE" "$USB_ROOT/webui/server.py"
