# Hermes-Agent-win (京择 AGI)

这是一个轻量级、便携式的本地 AI Agent 运行网关与 WebUI 控制面板。支持通过 USB 随插随用（也可以直接用于Windows、MAC系统），并集成了多模型接入、长期记忆管理、资料库、笔记以及可视化的控制台。
代码中同步上传了抖音博主安杰的webUI产物（非源码），方便大家挑选使用。
---

## 🌟 项目特点

* 🚀 **一键启动**：无需复杂的环境配置，双击对应的 `.bat` 批处理文件即可一键拉起本地网关与 Web 服务。
* 🎨 **Candyland 蜜糖配色**：经过深度重构的 UI 界面，提供温馨甜美的粉色系（Candyland）现代渐变视觉体验。
* 📂 **模块化架构**：
  * `server/`：基于 Node.js 实现的 AI 代理运行时、会话管理以及终端调用工具。
  * `webui/` / `web-dist/`：美化版的前端操作面板，提供聊天交互、工作空间文件管理及系统配置。
  * `data/`：本地运行时持久化数据（已通过 `.gitignore` 自动隔离敏感密钥和本地缓存）。
* 🛠️ **多模型支持**：预设 OpenRouter、OpenAI、Anthropic Claude、Google Gemini、DeepSeek、智谱 AI、通义千问等主流大模型通道。

---

## 💻 快速开始

### 运行要求
* 本地已安装 [Node.js](https://nodejs.org/)（建议 v18+）。

### 启动步骤
根据您的需求，在 Windows 环境下双击运行根目录下的启动脚本：

* **京择 AGI 标准启动**：双击 运行 `京择AGI一键启动.bat`。
* **安杰版 UI 启动**：双击 运行 `安杰版UI一键启动.bat`。

启动成功后，控制台会提示 WebUI 的访问链接（默认一般为 `http://127.0.0.1:5174`），在浏览器中打开即可开始使用。

---

## 📦 项目结构

```text
├── data/                  # 本地配置与运行时数据模板
├── server/                # 网关及 API 服务服务端代码
├── webui/                 # WebUI 前端源码
├── web-dist/              # 编译打包后的静态 WebUI 资源
├── scripts/               # Windows / Mac / Linux 各平台的启动与配置脚本
├── .gitignore             # Git 忽略规则（已过滤环境包与隐私数据）
└── README.md              # 项目说明文档
```

---

## 🔒 隐私与安全性说明

本项目已配置完善的 `.gitignore` 规则，上传到 GitHub 时会自动过滤以下文件：
* 本地生成的 `.env` 密钥文件。
* 本地 SQLite 状态数据库 (`state.db`) 与会话历史。
* 笨重的本地 `node_modules` 依赖以及内置 Python 运行时环境。
