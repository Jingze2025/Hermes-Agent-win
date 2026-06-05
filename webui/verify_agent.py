import sys
import os
import queue
from pathlib import Path
import threading
import time

# Add hermes-agent to path
usb_root = Path(__file__).parent.parent
hermes_agent_dir = str(usb_root / "hermes-agent")
sys.path.insert(0, hermes_agent_dir)

# Set environment
os.environ["HERMES_HOME"] = str(usb_root / "data")
os.environ["USB_ROOT"] = str(usb_root)

try:
    from run_agent import AIAgent
    
    q = queue.Queue()
    
    def on_token(t): print(f"[TOKEN] {t}")
    def on_reasoning(r): print(f"[REASONING] {r}")
    def on_tool_start(n, a): print(f"[TOOL START] {n} {a}")
    def on_tool_result(n, r): print(f"[TOOL RESULT] {n} {str(r)[:50]}...")

    # Mock config
    model = "deepseek/deepseek-chat"
    api_key = "dummy-key"
    base_url = "https://api.deepseek.com/v1"
    provider = "deepseek"
    
    agent = AIAgent(
        model=model,
        api_key=api_key,
        base_url=base_url,
        provider=provider,
        quiet_mode=True,
        stream_delta_callback=on_token,
        reasoning_callback=on_reasoning,
        tool_start_callback=on_tool_start,
        tool_complete_callback=on_tool_result,
    )
    
    print("Agent initialized successfully")
    print(f"Tools loaded: {len(agent.tools)}")
    
except Exception as e:
    import traceback
    traceback.print_exc()
