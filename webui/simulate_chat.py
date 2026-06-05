import sys
import os
import time
import json
from pathlib import Path

# Add project paths
usb_root = Path(__file__).parent.parent
sys.path.insert(0, str(usb_root / "webui"))
sys.path.insert(0, str(usb_root / "webui" / "api"))
sys.path.insert(0, str(usb_root / "hermes-agent"))

# Set env
os.environ["USB_ROOT"] = str(usb_root)
os.environ["HERMES_HOME"] = str(usb_root / "data")

from api.chat_handler import new_session, start_chat, get_stream_events

def simulate():
    print("--- Simulating New Session ---")
    session = new_session("Test Session")
    sid = session["id"]
    print(f"Session Created: {sid}")

    print("\n--- Starting Chat ---")
    res = start_chat(sid, "Hello, can you list the files in the current directory?")
    if not res["ok"]:
        print(f"Error starting chat: {res.get('error')}")
        return
    
    stream_id = res["stream_id"]
    print(f"Stream Started: {stream_id}")

    print("\n--- Listening to Events ---")
    try:
        start_time = time.time()
        event_count = 0
        for event, data in get_stream_events(stream_id):
            elapsed = time.time() - start_time
            print(f"[{elapsed:5.2f}s] Event: {event:12} | Data: {str(data)[:100]}...")
            event_count += 1
            if event == "done":
                print("\n--- Chat Finished Successfully ---")
                break
            if elapsed > 30 and event_count == 0:
                print("\n--- ERROR: Timeout! No events received for 30 seconds ---")
                break
    except Exception as e:
        print(f"\n--- Exception during event loop: {e} ---")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    simulate()
