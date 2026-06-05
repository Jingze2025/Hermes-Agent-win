#!/usr/bin/env bash
# ============================================================
# HermesUSB - Web UI Launcher for macOS (arm64 / x86_64)
# 一键启动 Hermes Web 面板（Node + Express + Socket.IO）
#
# 用法:
#   ./hermes-web.sh              # 默认端口 5174，自动打开浏览器
#   PORT=6000 ./hermes-web.sh    # 自定义端口
#   ./hermes-web.sh --no-open    # 不自动打开浏览器
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USB_ROOT="$SCRIPT_DIR"

# --- 颜色输出 ---
info()  { printf '\033[0;36m[INFO]\033[0m %s\n' "$1"; }
ok()    { printf '\033[0;32m[OK]\033[0m %s\n' "$1"; }
warn()  { printf '\033[0;33m[WARN]\033[0m %s\n' "$1"; }
error() { printf '\033[0;31m[ERROR]\033[0m %s\n' "$1" >&2; }

# --- 参数 ---
OPEN_BROWSER=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_BROWSER=0 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
  esac
done

# ============================================================
# 1. 架构检测 → 选择嵌入 Python Runtime（与 hermes.sh 保持一致）
# ============================================================
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) RUNTIME_DIR="$USB_ROOT/python_runtime_mac_arm64" ;;
  x86_64)        RUNTIME_DIR="$USB_ROOT/python_runtime_mac_x86_64" ;;
  *) error "不支持的架构：$ARCH"; exit 1 ;;
esac

if [ ! -x "$RUNTIME_DIR/bin/python3" ]; then
  if [ "$ARCH" = "arm64" ] && [ -x "$USB_ROOT/python_runtime_mac_x86_64/bin/python3" ]; then
    warn "未找到 arm64 runtime，回退到 Rosetta 运行 x86_64 版本"
    RUNTIME_DIR="$USB_ROOT/python_runtime_mac_x86_64"
  else
    error "未找到 $RUNTIME_DIR/bin/python3，Python Runtime 缺失"
    exit 1
  fi
fi

# ============================================================
# 2. Node 检查
# ============================================================
if ! command -v node >/dev/null 2>&1; then
  error "未找到 node，请先安装 Node.js >= 18.18"
  exit 1
fi
NODE_VER="$(node --version)"
ok "Node $NODE_VER"

# ============================================================
# 3. 首次运行：解压 node_modules（如有 tarball）
# ============================================================
if [ ! -d "$USB_ROOT/node_modules" ] && [ -f "$USB_ROOT/node_modules.tar.gz" ]; then
  info "首次运行，正在解压 node_modules..."
  tar -xzf "$USB_ROOT/node_modules.tar.gz" -C "$USB_ROOT"
  ok "node_modules 解压完成"
fi
if [ ! -d "$USB_ROOT/node_modules" ]; then
  error "未找到 node_modules，请先在项目根目录运行 npm install"
  exit 1
fi
if [ ! -d "$USB_ROOT/web-dist" ]; then
  warn "未找到 web-dist，前端资源缺失，可能是未构建；服务器仍会启动（仅 API 可用）"
fi

# ============================================================
# 4. 隔离环境变量（与 hermes.sh 对齐，并把 runtime bin 加入 PATH，
#    让 server 里的 execFile('hermes', ...) 能命中 U 盘自带的 CLI）
# ============================================================
export HERMES_HOME="$USB_ROOT/data"
export HOME="$USB_ROOT/data/home"
export XDG_CONFIG_HOME="$USB_ROOT/data"
export XDG_DATA_HOME="$USB_ROOT/data"
export TMPDIR="$USB_ROOT/tmp"
export PYTHONDONTWRITEBYTECODE=1
export PATH="$RUNTIME_DIR/bin:$PATH"

mkdir -p "$HERMES_HOME/home" "$TMPDIR"

# 加载 .env（容忍带空格/引号的值）
if [ -f "$HERMES_HOME/.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$HERMES_HOME/.env"
  set +a
fi

PORT="${PORT:-5174}"
export PORT

# ============================================================
# 5. 端口检查
# ============================================================
if lsof -iTCP:"$PORT" -sTCP:LISTEN -nP >/dev/null 2>&1; then
  PID="$(lsof -iTCP:"$PORT" -sTCP:LISTEN -nP -t | head -n1)"
  warn "端口 $PORT 已被进程 $PID 占用"
  warn "可运行: kill $PID  再重试，或 PORT=5175 $0"
  exit 1
fi

# ============================================================
# 6. 启动 Web 服务，并按需打开浏览器
# ============================================================
URL="http://127.0.0.1:$PORT"
ok "启动 Hermes Web UI：$URL"
echo "------------------------------------------------------------"

if [ "$OPEN_BROWSER" = "1" ]; then
  (
    # 轮询端口，服务起来后再打开浏览器，最多等 20 秒
    for _ in $(seq 1 40); do
      if curl -sSf -o /dev/null "$URL" 2>/dev/null; then
        open "$URL" >/dev/null 2>&1 || true
        exit 0
      fi
      sleep 0.5
    done
  ) &
fi

cd "$USB_ROOT"
exec node server/index.js
