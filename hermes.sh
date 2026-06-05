#!/usr/bin/env bash
# ============================================================
# HermesUSB - Root Launcher for macOS (arm64 / x86_64)
# 便携版：自动探测架构，使用内嵌 Python Runtime
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_ROOT="$SCRIPT_DIR"

# ============================================================
# 1. 探测架构：arm64 / x86_64
# ============================================================
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64)
    RUNTIME_DIR="$USB_ROOT/python_runtime_mac_arm64"
    ;;
  x86_64)
    RUNTIME_DIR="$USB_ROOT/python_runtime_mac_x86_64"
    ;;
  *)
    echo "[HermesUSB] 不支持的架构：$ARCH" >&2
    exit 1
    ;;
esac

# ============================================================
# 2. 验证 Python Runtime 存在
# ============================================================
PYTHON_EXE="$RUNTIME_DIR/bin/python3"
if [ ! -x "$PYTHON_EXE" ]; then
  echo "[HermesUSB] 未找到 $PYTHON_EXE" >&2
  echo "[HermesUSB] 当前架构 $ARCH 对应的 Python Runtime 缺失。" >&2
  # 兜底回退：如果是 arm64 上跑 x86_64 或反过来，检查对方是否能通过 Rosetta 2 跑
  if [ "$ARCH" = "arm64" ] && [ -x "$USB_ROOT/python_runtime_mac_x86_64/bin/python3" ]; then
    echo "[HermesUSB] 尝试用 Rosetta 2 运行 x86_64 版本..." >&2
    PYTHON_EXE="$USB_ROOT/python_runtime_mac_x86_64/bin/python3"
  else
    exit 1
  fi
fi

# ============================================================
# 3. 首次运行检测：解压 node_modules（如果存在 tarball 且还没解压）
# ============================================================
if [ ! -d "$USB_ROOT/node_modules" ] && [ -f "$USB_ROOT/node_modules.tar.gz" ]; then
  echo "[HermesUSB] 首次运行，正在解压 node_modules..."
  tar -xzf "$USB_ROOT/node_modules.tar.gz" -C "$USB_ROOT"
  echo "[HermesUSB] node_modules 解压完成"
fi

# ============================================================
# 4. 设置隔离环境变量
# ============================================================
export HERMES_HOME="$USB_ROOT/data"
export HOME="$USB_ROOT/data/home"
export XDG_CONFIG_HOME="$USB_ROOT/data"

# 确保关键目录存在
mkdir -p "$USB_ROOT/data/home"
mkdir -p "$USB_ROOT/data"

# ============================================================
# 5. 启动 Hermes
# ============================================================
exec "$PYTHON_EXE" -m hermes_cli.main "$@"
