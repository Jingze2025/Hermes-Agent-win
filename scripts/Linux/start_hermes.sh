#!/usr/bin/env bash
# ============================================================
# HermesUSB - Linux/macOS 启动脚本
#
# 功能: 从 U 盘启动 Hermes Agent 交互式聊天
# 隔离: 所有数据写入 U 盘，零痕迹
# ============================================================

set -e

# ─── 变量 ───────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ─── 函数 ───────────────────────────────────────────────────
info()  { echo "     $1"; }
ok()    { echo "[OK] $1"; }
warn()  { echo "[WARN] $1"; }
error() { echo "[ERROR] $1" >&2; }

# ─── 检测 U 盘路径 ──────────────────────────────────────────
if [ -n "$HERMES_USB_ROOT" ]; then
    USB_ROOT="$HERMES_USB_ROOT"
    info "使用 HERMES_USB_ROOT: $USB_ROOT"
fi

if [ ! -d "$USB_ROOT" ]; then
    error "USB 目录不存在: $USB_ROOT"
    exit 1
fi

echo ""
echo "============================================================"
echo "  🍬 HermesUSB - Starting Hermes Agent"
echo "============================================================"
echo "  USB Root: $USB_ROOT"
echo ""

# ─── Step 1: 找 Python ─────────────────────────────────────
PYTHON_EXE=""

# 优先用 USB 中的 portable Python
for candidate in \
    "${USB_ROOT}/Linux/python/bin/python3" \
    "${USB_ROOT}/Linux/python/bin/python" \
    "${USB_ROOT}/Mac/python/bin/python3" \
    "${USB_ROOT}/Mac/python/bin/python" \
    "${USB_ROOT}/Linux/python3/bin/python3" \
    "${USB_ROOT}/Mac/python3/bin/python3"; do
    if [ -x "$candidate" ]; then
        PYTHON_EXE="$candidate"
        break
    fi
done

# 回退：系统 Python
if [ -z "$PYTHON_EXE" ]; then
    if command -v python3 &>/dev/null; then
        PYTHON_EXE="$(command -v python3)"
    elif command -v python &>/dev/null; then
        PYTHON_EXE="$(command -v python)"
    else
        error "Python not found!"
        error "Please run setup_first_time.sh first, or install Python 3.10+"
        exit 1
    fi
fi

PY_VER=$("$PYTHON_EXE" --version 2>&1 || echo "unknown")
ok "Python: $PYTHON_EXE ($PY_VER)"

# ─── Step 2: 设置环境变量（隔离） ──────────────────────────
DATA_DIR="${USB_ROOT}/data"
export HERMES_HOME="$DATA_DIR"
export HOME="${DATA_DIR}/home"
export XDG_CONFIG_HOME="$DATA_DIR"
export XDG_DATA_HOME="$DATA_DIR"
export TMPDIR="${USB_ROOT}/tmp"
export PIP_CACHE_DIR="${USB_ROOT}/pip_cache"

# 把 portable Python 放在 PATH 最前面
if [ -d "${USB_ROOT}/Linux/python/bin" ]; then
    export PATH="${USB_ROOT}/Linux/python/bin:$PATH"
elif [ -d "${USB_ROOT}/Mac/python/bin" ]; then
    export PATH="${USB_ROOT}/Mac/python/bin:$PATH"
fi

mkdir -p "${DATA_DIR}/home" "${USB_ROOT}/tmp"

# ─── Step 3: 检查初始化 ───────────────────────────────────
if [ ! -f "${DATA_DIR}/config.yaml" ]; then
    warn "HermesUSB 未初始化，正在引导..."
    echo ""
    "${BASH_SOURCE[0]%/*}/setup_first_time.sh"
    RESULT=$?
    if [ $RESULT -ne 0 ]; then
        error "初始化失败 (code: $RESULT)"
        exit $RESULT
    fi
fi

# ─── Step 4: 启动 Hermes ───────────────────────────────────
ok "Starting Hermes Agent..."
echo ""

DIST_PACKAGES="${DATA_DIR}/dist-packages"
HERMES_MODULE="${DIST_PACKAGES}/hermes_cli/main.py"

if [ -f "$HERMES_MODULE" ]; then
    # 直接用 Python 运行 hermes_cli 模块
    exec "$PYTHON_EXE" -m hermes_cli "$@"
elif command -v hermes &>/dev/null; then
    # 系统 hermes 命令
    exec hermes "$@"
else
    error "Hermes 未安装!"
    error "请运行 ${BASH_SOURCE[0]%/*}/setup_first_time.sh"
    exit 1
fi
