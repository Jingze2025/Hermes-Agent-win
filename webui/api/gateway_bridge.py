import asyncio
import os
import time
import json
import uuid
import logging
from pathlib import Path
from typing import Optional, Any

from .chat_handler import _sessions_dir, _load_session, _save_session, _usb_root

logger = logging.getLogger(__name__)

async def handle_gateway_message(event: Any) -> Optional[str]:
    """
    Handle a message from an external platform (called from GatewayRunner).
    Maps the sender to a persistent WebUI session and returns the AI response.
    """
    source = event.source
    platform = source.platform.value
    sender_id = source.chat_id
    text = event.text or ""
    
    # 1. Resolve Session ID (persistent per platform/sender)
    safe_sender = sender_id.replace(":", "_").replace("@", "_")
    session_id = f"gw_{platform}_{safe_sender}"
    
    # 2. Load or Create Session
    session = _load_session(session_id)
    if not session:
        session = {
            "id": session_id,
            "title": f"微信会话 ({sender_id[:8]})",
            "model": "auto",
            "provider": "auto",
            "messages": [],
            "created_at": time.time(),
            "updated_at": time.time(),
            "metadata": {
                "origin": platform,
                "sender": sender_id
            }
        }
        logger.info(f"Created new bridge session: {session_id}")
    
    # 3. Append User message
    session["messages"].append({
        "role": "user",
        "content": text,
        "timestamp": time.time()
    })
    session["updated_at"] = time.time()
    _save_session(session)
    
    # 4. Invoke Agent (Headless, in thread pool to avoid blocking event loop)
    try:
        loop = asyncio.get_running_loop()
        reply = await loop.run_in_executor(None, _run_headless_agent, session, text)
        
        # 5. Append Assistant reply
        session["messages"].append({
            "role": "assistant",
            "content": reply,
            "timestamp": time.time()
        })
        session["updated_at"] = time.time()
        _save_session(session)
        
        return reply
    except Exception as e:
        logger.error(f"Bridge Agent Error: {e}")
        return f"⚠️ [Hermes] 发生错误: {str(e)}"

def _run_headless_agent(session: dict, user_message: str) -> str:
    """Invokes AIAgent without streaming to get a direct response."""
    import sys
    usb_root = _usb_root()
    hermes_agent_dir = str(usb_root / "hermes-agent")
    if hermes_agent_dir not in sys.path:
        sys.path.insert(0, hermes_agent_dir)

    from run_agent import AIAgent
    from .config_handler import read_config, read_env

    config = read_config()
    env = read_env(masked=False)

    # Ensure environment consistency
    os.environ["HERMES_HOME"] = str(usb_root / "data")
    os.environ["HOME"] = str(usb_root / "data" / "home")

    model_cfg = config.get("model", {})
    if isinstance(model_cfg, str):
        model_cfg = {"default": model_cfg}

    # Priority: Session Model > Global Model
    provider = session.get("provider") or model_cfg.get("provider", "zai")
    model = session.get("model") or model_cfg.get("default") or model_cfg.get("model") or "glm-4.5-air"
    base_url = model_cfg.get("base_url", "")

    # Resolve API key and base_url using presets
    from .config_handler import PROVIDER_PRESETS
    preset = PROVIDER_PRESETS.get(provider, {})
    if not base_url or provider != model_cfg.get("provider"):
        base_url = preset.get("base_url", "")

    api_key = ""
    env_key = preset.get("env_key")
    if env_key:
        api_key = env.get(env_key)
    
    # Fallback/Legacy resolution
    if not api_key:
        if provider in ("zai", "zhipu", "zhipuai"):
            if not base_url: base_url = "https://api.z.ai/api/paas/v4"
            api_key = env.get("ZAI_API_KEY") or env.get("ZHIPU_API_KEY") or env.get("ZHIPUAI_API_KEY")
        elif provider == "openrouter":
            api_key = env.get("OPENROUTER_API_KEY")
            if not base_url: base_url = "https://openrouter.ai/api/v1"
    
    if not api_key:
        raise ValueError(f"未找到服务商 {provider} 的 API Key，请在 WebUI 模型配置页面设置。")

    # Identity Prompt
    identity_prompt = (
        "你是由京择信息技术（潍坊）有限公司开发的“京择AGI-Hermes”智能助手。\n"
        "你当前正通过微信网关对外提供服务。对话已同步至 WebUI。\n"
        "请以简明、专业、准确的方式回答用户的提问。"
    )

    # Initialize Agent
    agent = AIAgent(
        model=model,
        api_key=api_key,
        base_url=base_url,
        provider=provider,
        quiet_mode=True,
        ephemeral_system_prompt=identity_prompt,
        skip_memory=False,
    )

    # Format History (extract last N messages for context)
    # WebUI sessions can be long, so we limit context for the headless check
    msgs = []
    for m in session.get("messages", [])[-20:]:  # Last 10 turns
        if m["role"] in ("user", "assistant"):
            msgs.append({"role": m["role"], "content": m["content"]})

    # Run
    # Note: run_conversation takes the NEW user_message as the first arg, 
    # but the history should NOT include the new message again if it's already there?
    # Actually, if we already appended it to session['messages'], we should pass msgs[:-1] as history.
    history = msgs[:-1]
    
    try:
        result = agent.run_conversation(user_message, conversation_history=history)
        if isinstance(result, dict):
            return result.get("final_response") or result.get("error") or "No response from agent."
        return str(result)
    finally:
        # Cleanup agent resources
        if hasattr(agent, "close"):
            agent.close()
