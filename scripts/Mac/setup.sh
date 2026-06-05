#!/usr/bin/env bash
# ============================================================
# HermesUSB - First Time Setup for macOS
#
# 功能: 在 macOS 上初始化 U 盘环境，安装依赖
# ============================================================

set -e

# --- 路径解析 ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HERMES_AGENT_DIR="${USB_ROOT}/hermes-agent"

# --- 颜色输出 ---
info()  { echo -e "\033[0;36m[INFO]\033[0m $1"; }
ok()    { echo -e "\033[0;32m[OK]\033[0m $1"; }
warn()  { echo -e "\033[0;33m[WARN]\033[0m $1"; }
error() { echo -e "\033[0;31m[ERROR]\033[0m $1" >&2; }

echo "============================================================"
echo "  ⚕ HermesUSB Setup (macOS)"
echo "============================================================"
echo "  USB Root: $USB_ROOT"
echo ""

# --- Step 1: 检查 Python 3.11+ ---
info "检查系统 Python 环境..."
if ! command -v python3 &>/dev/null; then
    error "未找到 Python 3！请先访问 https://www.python.org/ 下载并安装。"
    exit 1
fi

PY_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
if [[ $(echo "$PY_VERSION < 3.11" | bc -l) -eq 1 ]]; then
    error "Python 版本过低 ($PY_VERSION)，需要 3.11+。"
    exit 1
fi
ok "Python $PY_VERSION 检查通过。"

# --- Step 2: 创建虚拟环境 (隔离到 U 盘) ---
VENV_DIR="${USB_ROOT}/venv_mac"
if [ -d "$VENV_DIR" ]; then
    info "虚拟环境 $VENV_DIR 已存在，准备更新..."
else
    info "正在 U 盘创建虚拟环境 (venv_mac)..."
    python3 -m venv "$VENV_DIR"
fi
ok "虚拟环境准备就绪。"

# --- Step 3: 安装依赖 ---
info "正在安装依赖 (这可能需要几分钟)..."
source "$VENV_DIR/bin/activate"

# 确保 pip 是最新的
pip install --upgrade pip setuptools wheel

# 安装 hermes-agent 及其依赖
if [ -d "$HERMES_AGENT_DIR" ]; then
    cd "$HERMES_AGENT_DIR"
    pip install -e ".[all]" || pip install -e "."
else
    error "未找到 hermes-agent 源码目录！请检查 U 盘完整性。"
    exit 1
fi

# --- Step 4: 创建必要的目录 ---
mkdir -p "${USB_ROOT}/data/home" "${USB_ROOT}/tmp" "${USB_ROOT}/data/skills"

# --- Step 5: 初始化配置文件 ---
if [ ! -f "${USB_ROOT}/data/.env" ]; then
    if [ -f "${HERMES_AGENT_DIR}/.env.example" ]; then
        cp "${HERMES_AGENT_DIR}/.env.example" "${USB_ROOT}/data/.env"
        info "已创建默认 .env 模板，请在 data/.env 中配置您的 API Key。"
    fi
fi

echo ""
ok "============================================================"
ok "  🎉 Setup Complete!"
ok "============================================================"
echo "  下一步:"
echo "  1. 编辑 data/.env 填入您的 API Key。"
echo "  2. 运行 scripts/Mac/start_hermes.sh 开始使用。"
echo ""
