import sys
import os
from pathlib import Path

# Add hermes-agent to path
usb_root = Path(__file__).parent.parent
hermes_agent_path = usb_root / "hermes-agent"
sys.path.insert(0, str(hermes_agent_path))

try:
    from run_agent import AIAgent
    print("Successfully imported AIAgent")
    import agent
    print("Successfully imported agent package")
except Exception as e:
    print(f"Import failed: {e}")
    import traceback
    traceback.print_exc()
