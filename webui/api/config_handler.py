"""
Config & Env file handler for HermesUSB WebUI.
Reads/writes data/config.yaml and data/.env with secret masking.

Provider presets are loaded from data/providers.json (shared with the new
Hermes Web UI in server/modelConfig.js). If the file is missing or malformed,
a minimal in-code fallback is used so the UI still renders.
"""
import json
import os
from pathlib import Path

import yaml


def _usb_root() -> Path:
    return Path(os.environ.get("USB_ROOT", str(Path(__file__).parent.parent.parent)))


def _data_dir() -> Path:
    return _usb_root() / "data"


# ── config.yaml ──────────────────────────────────────────────────────────────

def read_config() -> dict:
    """Read config.yaml and return as dict."""
    config_path = _data_dir() / "config.yaml"
    if not config_path.exists():
        return {}
    try:
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except UnicodeDecodeError:
            with open(config_path, "r", encoding="gbk", errors="replace") as f:
                data = yaml.safe_load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_config(data: dict) -> None:
    """Write dict to config.yaml."""
    config_path = _data_dir() / "config.yaml"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(data, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


# ── .env ─────────────────────────────────────────────────────────────────────

def read_env(masked: bool = True) -> dict:
    """Read .env file and return as dict. Optionally mask secret values."""
    env_path = _data_dir() / ".env"
    result = {}
    if not env_path.exists():
        return result
    try:
        try:
            env_content = env_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            env_content = env_path.read_text(encoding="gbk", errors="replace")

        for line in env_content.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if masked and value:
                result[key] = _mask_value(key, value)
            else:
                result[key] = value
    except Exception:
        pass
    return result


def read_env_raw() -> str:
    """Read .env file as raw text."""
    env_path = _data_dir() / ".env"
    if not env_path.exists():
        return ""
    try:
        return env_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return env_path.read_text(encoding="gbk", errors="replace")


def write_env(entries: dict) -> None:
    """Write dict entries to .env file, preserving comments."""
    env_path = _data_dir() / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)

    # Read existing lines to preserve comments and order
    existing_lines = []
    if env_path.exists():
        try:
            existing_lines = env_path.read_text(encoding="utf-8").splitlines()
        except UnicodeDecodeError:
            existing_lines = env_path.read_text(encoding="gbk", errors="replace").splitlines()

    # Track which keys we've updated
    updated_keys = set()
    new_lines = []

    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            new_lines.append(line)
            continue
        if "=" in stripped:
            key = stripped.split("=", 1)[0].strip()
            if key in entries:
                value = entries[key]
                if value:  # Only write non-empty values
                    new_lines.append(f"{key}={value}")
                # Skip empty values (effectively delete)
                updated_keys.add(key)
                continue
        new_lines.append(line)

    # Append new keys not already in file
    for key, value in entries.items():
        if key not in updated_keys and value:
            new_lines.append(f"{key}={value}")

    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def update_env_key(key: str, value: str) -> None:
    """Update or add a single key in .env."""
    current = read_env(masked=False)
    current[key] = value
    write_env(current)


def _mask_value(key: str, value: str) -> str:
    """Mask a secret value, showing only first 4 and last 4 chars."""
    if len(value) <= 8:
        return "*" * len(value)
    return value[:4] + "*" * (len(value) - 8) + value[-4:]


# ── Provider presets ─────────────────────────────────────────────────────────
# Shared catalog loaded from data/providers.json. Keeping the exported name
# PROVIDER_PRESETS stable so the rest of the WebUI keeps working.

_FALLBACK_PROVIDERS = {
    "openrouter": {
        "name": "OpenRouter",
        "desc": "全球模型聚合入口",
        "env_key": "OPENROUTER_API_KEY",
        "env_prefix": "sk-or-",
        "base_url": "https://openrouter.ai/api/v1",
        "models": [],
    },
    "openai": {
        "name": "OpenAI 官方",
        "desc": "GPT 系列原生接口",
        "env_key": "OPENAI_API_KEY",
        "env_prefix": "sk-",
        "base_url": "https://api.openai.com/v1",
        "models": [],
    },
    "anthropic": {
        "name": "Anthropic Claude",
        "desc": "Claude 原生接口",
        "env_key": "ANTHROPIC_API_KEY",
        "env_prefix": "sk-ant-",
        "base_url": "",
        "models": [],
    },
    "custom": {
        "name": "自定义 OpenAI 兼容",
        "desc": "任意 OpenAI 协议接口",
        "env_key": "OPENAI_API_KEY",
        "env_prefix": "",
        "base_url": "",
        "models": [],
    },
}


def _load_providers_from_disk() -> dict | None:
    providers_path = _data_dir() / "providers.json"
    if not providers_path.exists():
        return None
    try:
        raw = providers_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raw = providers_path.read_text(encoding="gbk", errors="replace")
    try:
        payload = json.loads(raw.lstrip("\ufeff"))
    except Exception:
        return None
    providers = payload.get("providers") if isinstance(payload, dict) else None
    if not isinstance(providers, dict) or not providers:
        return None
    return providers


def _get_presets() -> dict:
    disk = _load_providers_from_disk()
    return disk if disk else _FALLBACK_PROVIDERS


# Backwards-compat: expose as module-level attribute. Readers that cached it
# at import time will still get the disk-backed catalog on first access via
# the helper, but most UI code calls get_provider_presets() each request.
PROVIDER_PRESETS = _get_presets()


def get_provider_presets() -> dict:
    """Return provider presets, re-reading from disk each call.

    This keeps both UIs in sync: edits to data/providers.json are picked up
    without a server restart.
    """
    return _get_presets()
