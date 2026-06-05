"""
IM Channels handler for HermesUSB WebUI.
Manages gateway configuration for WeChat, Feishu, WeCom, Telegram, Discord, DingTalk.
"""
from .config_handler import read_config, write_config


# ── Channel Registry ─────────────────────────────────────────────────────────

CHANNEL_REGISTRY = {
    "telegram": {
        "name": "Telegram",
        "icon": "send",
        "desc": "全球最流行的聊天机器人平台",
        "guide": [
            "打开 Telegram，搜索 @BotFather",
            "发送 /newbot 创建新机器人",
            "设置机器人名称和用户名",
            "复制 Bot Token 填入下方",
        ],
        "fields": [
            {"key": "bot_token", "label": "Bot Token", "placeholder": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", "secret": True, "required": True},
        ],
        "config_section": "telegram",
    },
    "discord": {
        "name": "Discord",
        "icon": "hash",
        "desc": "面向社区的聊天平台",
        "guide": [
            "访问 Discord Developer Portal",
            "创建新应用并设置 Bot",
            "开启 Message Content Intent",
            "复制 Bot Token 填入下方",
        ],
        "fields": [
            {"key": "bot_token", "label": "Bot Token", "placeholder": "MTExxxxxxxxx.Gxxxxxx.xxxxxxxx", "secret": True, "required": True},
        ],
        "config_section": "discord",
    },
    "feishu": {
        "name": "飞书",
        "icon": "message-square",
        "desc": "字节跳动企业协作平台",
        "supports_terminal_auth": True,
        "terminal_auth_label": "扫码授权添加机器人",
        "guide": [
            "登录飞书开放平台 open.feishu.cn",
            "创建企业自建应用",
            "开启机器人能力",
            "获取 App ID 和 App Secret",
            "配置事件订阅和权限",
            "将 App ID 和 Secret 填入下方",
        ],
        "fields": [
            {"key": "app_id", "label": "App ID", "placeholder": "cli_xxxxxxxxxxxxxxxx", "required": True},
            {"key": "app_secret", "label": "App Secret", "placeholder": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "secret": True, "required": True},
        ],
        "config_section": "feishu",
    },
    "dingtalk": {
        "name": "钉钉",
        "icon": "message-square",
        "desc": "阿里巴巴企业协作平台",
        "guide": [
            "登录钉钉开放平台 open-dev.dingtalk.com",
            "创建企业内部应用",
            "开启机器人能力",
            "获取 Client ID 和 Client Secret",
            "配置消息接收地址",
            "将 Client ID 和 Secret 填入下方",
        ],
        "fields": [
            {"key": "client_id", "label": "Client ID", "placeholder": "dingxxxxxxxxxxxxxxxxx", "required": True},
            {"key": "client_secret", "label": "Client Secret", "placeholder": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "secret": True, "required": True},
        ],
        "config_section": "dingtalk",
    },
    "weixin": {
        "name": "微信",
        "icon": "message-circle",
        "desc": "个人微信 / 企业微信对接",
        "guide": [
            "微信对接需要使用 Hermes 的微信插件",
            "运行 hermes gateway 后扫码登录",
            "注意：个人微信有封号风险，建议使用小号",
            "企业微信更安全，推荐正式使用",
        ],
        "fields": [],
        "config_section": "weixin",
    },
    "wecom": {
        "name": "企业微信",
        "icon": "briefcase",
        "desc": "企业微信应用消息通道",
        "guide": [
            "登录企业微信管理后台 work.weixin.qq.com",
            "创建自建应用",
            "获取 Corp ID、Agent ID 和 Secret",
            "设置接收消息的 API 地址",
            "将凭证填入下方",
        ],
        "fields": [
            {"key": "corp_id", "label": "Corp ID", "placeholder": "wwxxxxxxxxxxxxxxxx", "required": True},
            {"key": "agent_id", "label": "Agent ID", "placeholder": "1000002", "required": True},
            {"key": "secret", "label": "Secret", "placeholder": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "secret": True, "required": True},
            {"key": "token", "label": "Token", "placeholder": "用于验证消息来源", "required": False},
            {"key": "encoding_aes_key", "label": "EncodingAESKey", "placeholder": "消息加解密密钥", "required": False},
        ],
        "config_section": "wecom",
    },
}


def get_channel_registry() -> dict:
    """Return all supported channel definitions."""
    return CHANNEL_REGISTRY


def get_configured_channels() -> list:
    """Get list of configured channels with their status."""
    config = read_config()
    gateway_cfg = config.get("gateway", {})
    result = []

    for channel_id, reg in CHANNEL_REGISTRY.items():
        section = reg["config_section"]
        channel_config = gateway_cfg.get(section, {})
        is_configured = bool(channel_config)
        is_enabled = channel_config.get("enabled", False) if channel_config else False

        result.append({
            "id": channel_id,
            "name": reg["name"],
            "icon": reg["icon"],
            "desc": reg["desc"],
            "configured": is_configured,
            "enabled": is_enabled,
        })

    return result


def get_channel_config(channel_id: str) -> dict:
    """Get config for a specific channel (with secrets masked)."""
    if channel_id not in CHANNEL_REGISTRY:
        return {"error": f"未知渠道: {channel_id}"}

    reg = CHANNEL_REGISTRY[channel_id]
    config = read_config()
    channel_config = config.get("gateway", {}).get(reg["config_section"], {})

    # Mask secrets
    masked = {}
    secret_fields = {f["key"] for f in reg["fields"] if f.get("secret")}
    for k, v in channel_config.items():
        if k in secret_fields and v:
            masked[k] = v[:4] + "*" * max(0, len(str(v)) - 8) + str(v)[-4:] if len(str(v)) > 8 else "****"
        else:
            masked[k] = v

    return {"config": masked, "registry": reg}


def save_channel_config(channel_id: str, channel_data: dict) -> dict:
    """Save config for a specific channel."""
    if channel_id not in CHANNEL_REGISTRY:
        return {"ok": False, "error": f"未知渠道: {channel_id}"}

    reg = CHANNEL_REGISTRY[channel_id]
    config = read_config()

    if "gateway" not in config:
        config["gateway"] = {}

    # Merge with existing (preserve old values if new ones are masked)
    existing = config["gateway"].get(reg["config_section"], {})
    for k, v in channel_data.items():
        if v and "*" not in str(v):  # Only update if not a masked value
            existing[k] = v

    config["gateway"][reg["config_section"]] = existing
    write_config(config)

    return {"ok": True, "message": f"{reg['name']} 配置已保存"}


def toggle_channel(channel_id: str, enabled: bool) -> dict:
    """Enable or disable a channel."""
    if channel_id not in CHANNEL_REGISTRY:
        return {"ok": False, "error": f"未知渠道: {channel_id}"}

    reg = CHANNEL_REGISTRY[channel_id]
    config = read_config()

    if "gateway" not in config:
        config["gateway"] = {}
    if reg["config_section"] not in config["gateway"]:
        config["gateway"][reg["config_section"]] = {}

    config["gateway"][reg["config_section"]]["enabled"] = enabled
    write_config(config)

    action = "启用" if enabled else "禁用"
    return {"ok": True, "message": f"已{action} {reg['name']}"}


def remove_channel(channel_id: str) -> dict:
    """Remove a channel configuration."""
    if channel_id not in CHANNEL_REGISTRY:
        return {"ok": False, "error": f"未知渠道: {channel_id}"}

    reg = CHANNEL_REGISTRY[channel_id]
    config = read_config()
    gateway = config.get("gateway", {})

    if reg["config_section"] in gateway:
        del gateway[reg["config_section"]]
        config["gateway"] = gateway
        write_config(config)

    return {"ok": True, "message": f"已移除 {reg['name']} 配置"}
