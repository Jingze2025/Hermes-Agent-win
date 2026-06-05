#!/usr/bin/env bash
# ============================================================
# HermesUSB - Start Hermes Agent (CLI Mode) for macOS
#
# 功能: 从 U 盘启动 Hermes Agent 交互式聊天
# 隔离: 所有数据写入 U 盘，零痕迹
# ============================================================

set -e

# --- 路径解析 ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# --- 颜色输出 ---
info()  { echo -e "\033[0;36m[INFO]\033[0m $1"; }
ok()    { echo -e "\033[0;32m[OK]\033[0m $1"; }
warn()  { echo -e "\033[0;33m[WARN]\033[0m $1"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $1" >&2; }

echo ""
echo "============================================================"
echo "  🍬 HermesUSB - Starting Hermes Agent (macOS)"
echo "============================================================"
echo "  USB Root: $USB_ROOT"
echo ""

# --- Step 1: 寻找 Python 环境 ---
PYTHON_EXE=""

# 1. 尝试使用 U 盘自带的便携 Python 运行时 (python_runtime_mac_arm64)
#    优先 python3.12 以兼容 FAT32/exFAT 下 symlink 失效
PYTHON_PORTABLE=""
for candidate in \
    "${USB_ROOT}/python_runtime_mac_arm64/bin/python3.12" \
    "${USB_ROOT}/python_runtime_mac_arm64/bin/python3" \
    "${USB_ROOT}/python_runtime_mac_x86_64/bin/python3.12" \
    "${USB_ROOT}/python_runtime_mac_x86_64/bin/python3"; do
    if [ -x "$candidate" ]; then
        PYTHON_PORTABLE="$candidate"
        break
    fi
done
if [ -n "$PYTHON_PORTABLE" ]; then
    PYTHON_EXE="$PYTHON_PORTABLE"
    ok "使用便携运行时: $PYTHON_PORTABLE"
# 2. 尝试使用 macOS 专用虚拟环境 (setup.sh 创建)
elif [ -x "${USB_ROOT}/venv_mac/bin/python3" ]; then
    PYTHON_EXE="${USB_ROOT}/venv_mac/bin/python3"
elif [ -x "${USB_ROOT}/venv/bin/python3" ]; then
    # 检查是否是 Mac 格式的 venv (防止误用 Windows venv)
    if "${USB_ROOT}/venv/bin/python3" --version &>/dev/null; then
        PYTHON_EXE="${USB_ROOT}/venv/bin/python3"
    fi
fi

# 3. 回退到系统 Python
if [ -z "$PYTHON_EXE" ]; then
    if command -v python3 &>/dev/null; then
        PYTHON_EXE="$(command -v python3)"
        warn "未检测到 U 盘 Python 环境，使用系统 Python: $PYTHON_EXE"
        warn "建议先运行 scripts/Mac/setup.sh 进行初始化。"
    else
        error "未找到 Python 3！请先安装 Python 3.11+"
        exit 1
    fi
fi

PY_VER=$("$PYTHON_EXE" --version 2>&1)
ok "Python: $PYTHON_EXE ($PY_VER)"

# --- Step 2: 设置环境变量 (数据隔离) ---
DATA_DIR="${USB_ROOT}/data"
export HERMES_HOME="$DATA_DIR"
export HOME="${DATA_DIR}/home"
export XDG_CONFIG_HOME="$DATA_DIR"
export XDG_DATA_HOME="$DATA_DIR"
export TMPDIR="${USB_ROOT}/tmp"
export PIP_CACHE_DIR="${USB_ROOT}/pip_cache"
export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="${USB_ROOT}/hermes-agent:$PYTHONPATH"

# 确保目录存在
mkdir -p "${DATA_DIR}/home" "${USB_ROOT}/tmp"

# 加载 .env 环境变量
if [ -f "${DATA_DIR}/.env" ]; then
    export $(grep -v '^#' "${DATA_DIR}/.env" | xargs)
fi

# --- Step 3: 启动 Hermes ---
ok "Starting Hermes Agent..."
echo "------------------------------------------------------------"
echo ""

# 运行 hermes_cli 模块
exec "$PYTHON_EXE" -m hermes_cli.main "$@"
