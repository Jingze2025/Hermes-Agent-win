"""
Chat handler for HermesUSB WebUI.
Manages sessions and streams responses via OpenAI-compatible API.
Sessions are stored as JSON files in data/sessions/.
"""
import json
import os
import queue
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

# ── Session Storage ──────────────────────────────────────────────────────────

def _usb_root() -> Path:
    return Path(os.environ.get("USB_ROOT", str(Path(__file__).parent.parent.parent)))

def _sessions_dir() -> Path:
    d = _usb_root() / "data" / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d

def _load_session(session_id: str) -> dict:
    """Load a session from disk."""
    path = _sessions_dir() / f"{session_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None

def _save_session(session: dict) -> None:
    """Save a session to disk."""
    path = _sessions_dir() / f"{session['id']}.json"
    path.write_text(json.dumps(session, ensure_ascii=False, indent=2), encoding="utf-8")

def new_session(title: str = "") -> dict:
    """Create a new chat session."""
    from .config_handler import read_config
    config = read_config()
    model = ""
    provider = ""
    if isinstance(config.get("model"), dict):
        model = config["model"].get("default", "")
        provider = config["model"].get("provider", "")

    session = {
        "id": uuid.uuid4().hex[:16],
        "title": title or "新会话",
        "model": model,
        "provider": provider,
        "messages": [],
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    _save_session(session)
    return session

def list_sessions() -> list:
    """List all sessions, sorted by updated_at desc."""
    sessions = []
    for f in _sessions_dir().glob("*.json"):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            sessions.append({
                "id": data["id"],
                "title": data.get("title", "新会话"),
                "model": data.get("model", ""),
                "message_count": len(data.get("messages", [])),
                "created_at": data.get("created_at", 0),
                "updated_at": data.get("updated_at", 0),
            })
        except Exception:
            pass
    sessions.sort(key=lambda s: s.get("updated_at", 0), reverse=True)
    return sessions

def get_session(session_id: str) -> dict:
    """Get a full session with messages."""
    session = _load_session(session_id)
    if session is None:
        return {"error": "会话不存在"}
    return session

def delete_session(session_id: str) -> dict:
    """Delete a session."""
    path = _sessions_dir() / f"{session_id}.json"
    if path.exists():
        path.unlink()
        return {"ok": True, "message": "会话已删除"}
    return {"ok": False, "error": "会话不存在"}

def rename_session(session_id: str, title: str) -> dict:
    """Rename a session."""
    session = _load_session(session_id)
    if not session:
        return {"ok": False, "error": "会话不存在"}
    session["title"] = title[:80]
    _save_session(session)
    return {"ok": True}

def update_session_model(session_id: str, model: str, provider: str) -> dict:
    """Update the model and provider for a specific session."""
    session = _load_session(session_id)
    if not session:
        return {"ok": False, "error": "会话不存在"}
    session["model"] = model
    session["provider"] = provider
    session["updated_at"] = time.time()
    _save_session(session)
    return {"ok": True}

# ── Chat Streaming ───────────────────────────────────────────────────────────

# Active streams: stream_id -> queue.Queue of (event, data) tuples
STREAMS = {}
STREAMS_LOCK = threading.Lock()

def _get_api_client():
    """Create an OpenAI-compatible client from the current config."""
    from .config_handler import read_config, read_env

    config = read_config()
    env = read_env(masked=False)

    model_cfg = config.get("model", {})
    if isinstance(model_cfg, str):
        model_cfg = {"default": model_cfg}

    provider = model_cfg.get("provider", "openrouter")
    model = model_cfg.get("default", "")
    base_url = model_cfg.get("base_url", "")

    # Resolve API key and base_url from provider
    api_key = ""
    if provider == "openrouter":
        api_key = env.get("OPENROUTER_API_KEY", "")
        if not base_url:
            base_url = "https://openrouter.ai/api/v1"
    elif provider == "anthropic":
        api_key = env.get("ANTHROPIC_API_KEY", "")
        if not base_url:
            base_url = "https://api.anthropic.com/v1"
    elif provider == "openai":
        api_key = env.get("OPENAI_API_KEY", "")
        if not base_url:
            base_url = "https://api.openai.com/v1"
    elif provider == "deepseek":
        api_key = env.get("DEEPSEEK_API_KEY", "")
        if not base_url:
            base_url = "https://api.deepseek.com/v1"
    elif provider == "nous":
        api_key = env.get("NOUS_API_KEY", "")
        if not base_url:
            base_url = "https://inference-api.nousresearch.com/v1"
    elif provider in ("zhipu", "zai"):
        api_key = env.get("ZHIPU_API_KEY", "")
        if not base_url:
            base_url = "https://open.bigmodel.cn/api/paas/v4"
    elif provider == "qwen":
        api_key = env.get("DASHSCOPE_API_KEY", "")
        if not base_url:
            base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
    elif provider == "volcengine":
        api_key = env.get("ARK_API_KEY", "")
        if not base_url:
            base_url = "https://ark.cn-beijing.volces.com/api/v3"
    elif provider == "kimi":
        api_key = env.get("MOONSHOT_API_KEY", "")
        if not base_url:
            base_url = "https://api.moonshot.cn/v1"
    elif provider == "minimax":
        api_key = env.get("MINIMAX_API_KEY", "")
        if not base_url:
            base_url = "https://api.minimax.chat/v1"
    elif provider == "ollama":
        api_key = env.get("OLLAMA_API_KEY", "ollama")
        if not base_url:
            base_url = env.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    else:
        # Try generic keys
        api_key = env.get("OPENAI_API_KEY", "") or env.get("API_KEY", "")

    if not api_key:
        return None, None, "未配置 API Key，请先在模型配置页面设置"

    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)
        return client, model, None
    except ImportError:
        return None, None, "openai 库未安装，请运行: pip install openai"
    except Exception as e:
        return None, None, f"创建 API 客户端失败: {e}"


def _generate_title(client, model, user_msg: str) -> str:
    """Generate a short title for a conversation from the first message."""
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "用中文生成一个简短的会话标题（3-8个字），仅返回标题文字，不要加标点或前缀。"},
                {"role": "user", "content": user_msg[:200]},
            ],
            max_tokens=30,
            temperature=0.3,
        )
        title = resp.choices[0].message.content.strip().strip('"\'')
        return title[:40] if title else "新会话"
    except Exception:
        # Fallback: use first N chars of user message
        clean = user_msg.strip().replace('\n', ' ')[:30]
        return clean if clean else "新会话"


def start_chat(session_id: str, message: str) -> dict:
    """Start a chat stream. Returns stream_id for SSE connection."""
    session = _load_session(session_id)
    if not session:
        return {"ok": False, "error": "会话不存在"}

    if not message.strip():
        return {"ok": False, "error": "消息不能为空"}

    # --- License Enforcement ---
    from .license_handler import verify_license
    lic = verify_license()
    if not lic["ok"]:
        return {"ok": False, "error": f"授权无效: {lic.get('error', '请联系正版供应商申请授权')}"}

    # --- Gateway Enforcement Check ---
    # User requested: Ensure the Chat only works if the Gateway is running.
    from .process_handler import get_status
    if not get_status().get("running", False):
        return {"ok": False, "error": "Hermes 已停止，对话已关闭。请先在仪表盘点击【启动 Hermes】！"}

    stream_id = uuid.uuid4().hex[:12]
    q = queue.Queue()

    with STREAMS_LOCK:
        STREAMS[stream_id] = q

    # Add user message to session
    user_msg = {
        "role": "user",
        "content": message,
        "timestamp": time.time(),
    }
    session["messages"].append(user_msg)
    session["updated_at"] = time.time()
    _save_session(session)

    # Start streaming in background thread
    thread = threading.Thread(
        target=_stream_chat,
        args=(session_id, session, stream_id, q, message),
        daemon=True,
    )
    thread.start()

    return {"ok": True, "stream_id": stream_id, "session_id": session_id}


def _stream_chat(session_id: str, session: dict, stream_id: str, q: queue.Queue, user_message: str):
    """Background thread that runs the Hermes Agent and streams response."""
    import sys
    from pathlib import Path

    try:
        # Add hermes-agent to path if not already there
        usb_root = _usb_root()
        hermes_agent_dir = str(usb_root / "hermes-agent")
        if hermes_agent_dir not in sys.path:
            sys.path.insert(0, hermes_agent_dir)

        from run_agent import AIAgent

        from .config_handler import read_config, read_env
        config = read_config()
        env = read_env(masked=False)

        # Ensure HERMES_HOME is set so AIAgent finds SOUL.md and memories
        os.environ["HERMES_HOME"] = str(usb_root / "data")
        os.environ["HOME"] = str(usb_root / "data" / "home")
        
        # Identity Prompt
        identity_prompt = (
            "你是由京择信息技术（潍坊）有限公司开发的“京择AGI-Hermes”智能助手。\n"
            "本系统基于 NousResearch/hermes-agent 进行了深度的U盘化便携增强，旨在提供高效、私密、随插随用的AI体验。\n"
            "你的所有对话记忆、配置和工具操作记录都存储在当前的U盘设备中，不会上传云端或留在主机电脑上。\n"
            "请以专业、高效、友好的态度协助用户完成工作任务。"
        )

        model_cfg = config.get("model", {})
        if isinstance(model_cfg, str):
            model_cfg = {"default": model_cfg}

        # Priority: Session Model > Global Model
        provider = session.get("provider") or model_cfg.get("provider", "openrouter")
        model = session.get("model") or model_cfg.get("default", "")
        base_url = model_cfg.get("base_url", "") # Default base_url from global config

        # If it's a cross-provider switch, we might need to adjust base_url 
        # based on the NEW provider. We'll use the preset logic.
        from .config_handler import PROVIDER_PRESETS
        preset = PROVIDER_PRESETS.get(provider, {})
        if not base_url or provider != model_cfg.get("provider"):
            base_url = preset.get("base_url", "")

        # Resolve API key and base_url
        api_key = ""
        env_key = preset.get("env_key")
        if env_key:
            api_key = env.get(env_key)
        else:
            # Fallback for custom or missing presets
            if provider == "openrouter":
                api_key = env.get("OPENROUTER_API_KEY")
                if not base_url: base_url = "https://openrouter.ai/api/v1"
            elif provider == "openai":
                api_key = env.get("OPENAI_API_KEY")
                if not base_url: base_url = "https://api.openai.com/v1"
            elif provider == "anthropic":
                api_key = env.get("ANTHROPIC_API_KEY")
                if not base_url: base_url = "https://api.anthropic.com/v1"
            elif provider == "deepseek":
                api_key = env.get("DEEPSEEK_API_KEY")
                if not base_url: base_url = "https://api.deepseek.com/v1"
            elif provider == "zhipu":
                api_key = env.get("ZHIPU_API_KEY")
                if not base_url: base_url = "https://open.bigmodel.cn/api/paas/v4"
            elif provider == "qwen":
                api_key = env.get("DASHSCOPE_API_KEY")
                if not base_url: base_url = "https://dashscope.aliyuncs.com/compatible-mode/v1"
            elif provider == "volcengine":
                api_key = env.get("ARK_API_KEY")
                if not base_url: base_url = "https://ark.cn-beijing.volces.com/api/v3"
            elif provider == "kimi":
                api_key = env.get("MOONSHOT_API_KEY")
                if not base_url: base_url = "https://api.moonshot.cn/v1"
            elif provider == "minimax":
                api_key = env.get("MINIMAX_API_KEY")
                if not base_url: base_url = "https://api.minimax.chat/v1"
            elif provider == "ollama":
                api_key = env.get("OLLAMA_API_KEY", "ollama")
                if not base_url: base_url = env.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")
            else:
                api_key = env.get("OPENAI_API_KEY") or env.get("API_KEY")

        if not api_key:
            q.put(("error", {"message": "未配置 API Key，请先在模型配置页面设置"}))
            q.put(("done", {}))
            return

        # Initialize Agent
        agent = AIAgent(
            model=model,
            api_key=api_key,
            base_url=base_url,
            provider=provider,
            quiet_mode=True,
            ephemeral_system_prompt=identity_prompt,
            skip_memory=False,
            skip_context_files=False,
            # Callbacks for WebUI streaming
            stream_delta_callback=lambda delta: q.put(("token", {"text": delta})),
            reasoning_callback=lambda r: q.put(("reasoning", {"text": r})),
            tool_start_callback=lambda name, args: q.put(("tool_start", {"name": name, "args": args})),
            tool_complete_callback=lambda name, result: q.put(("tool_result", {"name": name, "result": str(result)[:2000]})), # Cap result length
        )

        # Build history for AIAgent (must be list of role/content dicts)
        history = []
        # AIAgent expects history without the current user message (it adds it in run_conversation)
        # But we already added the user message to session["messages"] in start_chat.
        # However, AIAgent.run_conversation(user_msg) takes the message as an argument.
        # So we pass the history UP TO the last message.
        for msg in session.get("messages", [])[:-1]:
            history.append({
                "role": msg["role"],
                "content": msg["content"],
            })

        # Run agent
        result = agent.run_conversation(user_message, conversation_history=history)
        
        # Extract the final text response
        full_response = ""
        if isinstance(result, dict):
            full_response = result.get("final_response") or result.get("error") or ""

        # Save assistant response
        if full_response:
            session = _load_session(session_id)
            if session:
                session["messages"].append({
                    "role": "assistant",
                    "content": full_response,
                    "timestamp": time.time(),
                })
                session["updated_at"] = time.time()

                # Generate title if needed
                if len(session["messages"]) == 2 and session.get("title", "").startswith("新会话"):
                    try:
                        # AIAgent doesn't expose a simple title generator easily, 
                        # so we use a small direct call or logic.
                        # For now, let the agent logic do its thing or keep the manual title gen.
                        title = _generate_title(agent.client, agent.model, user_message)
                        session["title"] = title
                        q.put(("title", {"title": title, "session_id": session_id}))
                    except Exception:
                        pass

                _save_session(session)

        q.put(("done", {"session_id": session_id}))

    except Exception as e:
        import traceback
        traceback.print_exc()
        q.put(("error", {"message": f"Agent 运行错误: {e}"}))
        q.put(("done", {}))
    finally:
        def cleanup():
            time.sleep(5)
            with STREAMS_LOCK:
                STREAMS.pop(stream_id, None)
        threading.Thread(target=cleanup, daemon=True).start()


def get_stream_events(stream_id: str):
    """Generator that yields SSE events from a stream queue."""
    with STREAMS_LOCK:
        q = STREAMS.get(stream_id)
    if q is None:
        yield ("error", {"message": "Stream not found"})
        return

    while True:
        try:
            event, data = q.get(timeout=30)
            yield (event, data)
            if event == "done":
                break
        except queue.Empty:
            # Send heartbeat to keep connection alive
            yield ("heartbeat", {})


def cancel_stream(stream_id: str) -> bool:
    """Cancel an active stream."""
    with STREAMS_LOCK:
        q = STREAMS.get(stream_id)
    if q:
        q.put(("done", {"cancelled": True}))
        return True
    return False
