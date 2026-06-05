"""
HermesUSB WebUI -- Main HTTP Server
Thin routing shell that serves static files and JSON API endpoints.
"""
import json
import logging
import os
import sys
import time
import traceback
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Ensure parent is importable
sys.path.insert(0, str(Path(__file__).parent))

from api.config_handler import (
    read_config, write_config, read_env, write_env, update_env_key,
    get_provider_presets, PROVIDER_PRESETS,
)
from api.process_handler import (
    get_status, start_hermes, stop_hermes, restart_hermes, read_logs,
    start_visible_hermes,
)
from api.channels_handler import (
    get_channel_registry, get_configured_channels, get_channel_config,
    save_channel_config, toggle_channel, remove_channel,
)
from api.chat_handler import (
    new_session, list_sessions, get_session as get_chat_session,
    delete_session, rename_session, update_session_model, start_chat, get_stream_events,
    cancel_stream,
)
from api.mounts_handler import (
    get_mounts, add_mounts, remove_mount, toggle_mount, browse_directory,
)

logger = logging.getLogger(__name__)

HOST = os.getenv("HERMES_WEBUI_HOST", "127.0.0.1")
PORT = int(os.getenv("HERMES_WEBUI_PORT", "8818"))
STATIC_DIR = Path(__file__).parent / "static"
USB_ROOT = Path(__file__).parent.parent

# Set USB_ROOT env for handlers
os.environ["USB_ROOT"] = str(USB_ROOT)



MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
}


def _json_response(handler, data, status=200):
    """Send a JSON response."""
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.end_headers()
    handler.wfile.write(body)


def _read_body(handler) -> dict:
    """Read and parse JSON body from request."""
    content_len = int(handler.headers.get("Content-Length", 0))
    if content_len == 0:
        return {}
    raw = handler.rfile.read(content_len)
    try:
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


class HermesWebUIHandler(BaseHTTPRequestHandler):
    server_version = "HermesUSB-WebUI/1.0"

    def _get_skills_list(self):
        """Scan skills directory and return installed skills."""
        skills_dir = Path(os.environ.get("HERMES_HOME", str(USB_ROOT / "data"))) / "skills"
        skills = []
        if skills_dir.is_dir():
            for item in sorted(skills_dir.iterdir()):
                if item.name.startswith('.'):
                    continue
                if item.is_dir():
                    # Look for SKILL.md
                    skill_md = item / "SKILL.md"
                    name = item.name
                    description = ""
                    category = ""
                    if skill_md.exists():
                        try:
                            content = skill_md.read_text(encoding="utf-8", errors="replace")
                            # Parse frontmatter-style description
                            for line in content.split("\n")[:20]:
                                if line.startswith("# "):
                                    name = line[2:].strip()
                                elif "description" in line.lower() and ":" in line:
                                    description = line.split(":", 1)[1].strip().strip('"').strip("'")
                                elif "category" in line.lower() and ":" in line:
                                    category = line.split(":", 1)[1].strip().strip('"').strip("'")
                        except Exception:
                            pass
                    skills.append({
                        "name": name,
                        "description": description,
                        "category": category,
                        "enabled": True,
                        "path": str(item),
                    })
        return {"skills": skills}

    def log_message(self, fmt, *args):
        """Structured logging."""
        duration = round((time.time() - getattr(self, "_t0", time.time())) * 1000, 1)
        print(f"[webui] {self.command} {self.path} {args[1] if len(args) > 1 else '-'} {duration}ms", flush=True)

    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        self._t0 = time.time()
        try:
            parsed = urlparse(self.path)
            path = parsed.path

            # ── API Routes ──
            if path == "/api/status":
                return _json_response(self, get_status())

            if path == "/api/config":
                return _json_response(self, read_config())

            if path == "/api/env":
                return _json_response(self, read_env(masked=True))

            if path == "/api/models/providers":
                return _json_response(self, get_provider_presets())

            if path == "/api/channels":
                return _json_response(self, get_configured_channels())

            if path == "/api/channels/registry":
                return _json_response(self, get_channel_registry())

            if path.startswith("/api/channels/") and path.count("/") == 3:
                channel_id = path.split("/")[3]
                return _json_response(self, get_channel_config(channel_id))

            if path == "/api/logs":
                params = parse_qs(parsed.query)
                n = int(params.get("lines", ["100"])[0])
                return _json_response(self, {"lines": read_logs(n)})

            if path == "/api/mounts":
                return _json_response(self, get_mounts())

            if path == "/api/skills":
                return _json_response(self, self._get_skills_list())

            if path == "/api/mounts/browse":
                params = parse_qs(parsed.query)
                start = params.get("path", [""])[0]
                return _json_response(self, browse_directory(start))

            if path == "/api/env/reveal":
                params = parse_qs(parsed.query)
                key_name = params.get("key", [""])[0]
                if not key_name:
                    return _json_response(self, {"error": "key required"}, 400)
                env_raw = read_env(masked=False)
                return _json_response(self, {"key": key_name, "value": env_raw.get(key_name, "")})

            # ── Chat / Session API (GET) ──
            if path == "/api/sessions":
                return _json_response(self, {"sessions": list_sessions()})

            if path == "/api/session":
                params = parse_qs(parsed.query)
                sid = params.get("id", [""])[0]
                if not sid:
                    return _json_response(self, {"error": "id required"}, 400)
                return _json_response(self, get_chat_session(sid))

            if path == "/api/chat/stream":
                params = parse_qs(parsed.query)
                stream_id = params.get("stream_id", [""])[0]
                if not stream_id:
                    return _json_response(self, {"error": "stream_id required"}, 400)
                # SSE streaming response
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    for event, data in get_stream_events(stream_id):
                        payload = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                        self.wfile.write(payload.encode("utf-8"))
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    pass
                return

            # ── Static Files ──
            if path == "/" or path == "":
                path = "/index.html"

            file_path = STATIC_DIR / path.lstrip("/")
            file_path = file_path.resolve()

            # Security: prevent directory traversal
            if not str(file_path).startswith(str(STATIC_DIR.resolve())):
                self.send_error(403)
                return

            if file_path.is_file():
                ext = file_path.suffix.lower()
                mime = MIME_TYPES.get(ext, "application/octet-stream")
                body = file_path.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mime)
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-cache")
                self.end_headers()
                self.wfile.write(body)
                return

            self.send_error(404)

        except Exception as e:
            traceback.print_exc()
            _json_response(self, {"error": f"Internal server error: {str(e)}"}, 500)

    def do_POST(self):
        self._t0 = time.time()
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            body = _read_body(self)

            if path == "/api/config":
                write_config(body)
                return _json_response(self, {"ok": True, "message": "配置已保存"})

            if path == "/api/env":
                write_env(body)
                return _json_response(self, {"ok": True, "message": "环境变量已保存"})

            if path == "/api/env/key":
                key = body.get("key", "")
                value = body.get("value", "")
                if not key:
                    return _json_response(self, {"ok": False, "error": "key 不能为空"}, 400)
                update_env_key(key, value)
                return _json_response(self, {"ok": True, "message": f"已更新 {key}"})



            if path == "/api/hermes/start":
                mode = body.get("mode", "gateway")
                return _json_response(self, start_hermes(mode))

            if path == "/api/mounts/add":
                paths = body.get("paths", [])
                return _json_response(self, add_mounts(paths))

            if path == "/api/mounts/remove":
                p = body.get("path", "")
                return _json_response(self, remove_mount(p))

            if path == "/api/mounts/toggle":
                p = body.get("path", "")
                enabled = body.get("enabled")
                rw = body.get("rw")
                return _json_response(self, toggle_mount(p, enabled=enabled, rw=rw))

            if path == "/api/hermes/start_visible":
                mode = body.get("mode", "gateway")
                platform = body.get("platform")
                return _json_response(self, start_visible_hermes(mode, platform))

            if path == "/api/hermes/stop":
                return _json_response(self, stop_hermes())

            if path == "/api/hermes/restart":
                mode = body.get("mode", "gateway")
                return _json_response(self, restart_hermes(mode))

            if path.startswith("/api/channels/") and path.count("/") == 3:
                channel_id = path.split("/")[3]
                return _json_response(self, save_channel_config(channel_id, body))

            if path.startswith("/api/channels/") and path.endswith("/toggle"):
                parts = path.split("/")
                channel_id = parts[3]
                enabled = body.get("enabled", False)
                return _json_response(self, toggle_channel(channel_id, enabled))

            if path.startswith("/api/channels/") and path.endswith("/remove"):
                parts = path.split("/")
                channel_id = parts[3]
                return _json_response(self, remove_channel(channel_id))

            # ── Chat / Session API (POST) ──
            if path == "/api/session/new":
                return _json_response(self, new_session(body.get("title", "")))

            if path == "/api/session/delete":
                sid = body.get("id", "")
                if not sid:
                    return _json_response(self, {"ok": False, "error": "id required"}, 400)
                return _json_response(self, delete_session(sid))

            if path == "/api/session/rename":
                sid = body.get("id", "")
                title = body.get("title", "")
                if not sid:
                    return _json_response(self, {"ok": False, "error": "id required"}, 400)
                return _json_response(self, rename_session(sid, title))

            if path == "/api/session/update_model":
                sid = body.get("session_id", "")
                model = body.get("model", "")
                provider = body.get("provider", "")
                if not sid or not model or not provider:
                    return _json_response(self, {"ok": False, "error": "session_id, model and provider required"}, 400)
                return _json_response(self, update_session_model(sid, model, provider))

            if path == "/api/chat/send":
                sid = body.get("session_id", "")
                message = body.get("message", "")
                if not sid or not message:
                    return _json_response(self, {"ok": False, "error": "session_id and message required"}, 400)
                return _json_response(self, start_chat(sid, message))

            if path == "/api/chat/cancel":
                stream_id = body.get("stream_id", "")
                return _json_response(self, {"ok": cancel_stream(stream_id)})

            _json_response(self, {"error": "not found"}, 404)

        except Exception as e:
            traceback.print_exc()
            _json_response(self, {"error": f"Internal server error: {str(e)}"}, 500)

    def do_DELETE(self):
        self.do_POST()


def main():
    print()
    print("  ╔════════════════════════════════════════╗")
    print("  ║     HermesUSB WebUI Configuration      ║")
    print("  ╠════════════════════════════════════════╣")
    print(f"  ║  USB Root:  {str(USB_ROOT):<27}║")
    print(f"  ║  Data Dir:  {str(USB_ROOT / 'data'):<27}║")
    print(f"  ║  Listen:    http://{HOST}:{PORT:<18}║")
    print("  ╚════════════════════════════════════════╝")
    print()

    httpd = ThreadingHTTPServer((HOST, PORT), HermesWebUIHandler)
    print(f"  [OK] WebUI running at http://{HOST}:{PORT}", flush=True)
    print(f"  Open in browser: http://localhost:{PORT}", flush=True)
    print()



    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  [INFO] WebUI shutting down...")
    finally:
        from api.process_handler import shutdown_all
        shutdown_all()
        httpd.server_close()


if __name__ == "__main__":
    main()
