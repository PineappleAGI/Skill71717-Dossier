#!/usr/bin/env python3
"""
Local intake form for Skill Dossier.

Serves a professional topic form. On submit, writes request.json to the
output directory so the agent can continue the harvest pipeline.

Usage:
  python scripts/intake-server.py [--port 8765] [--out .research-materials]
  python scripts/intake-server.py --stop
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

SKILL_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = SKILL_ROOT / ".research-materials"
PID_FILE = SKILL_ROOT / ".intake-server.pid"
CSS_PATH = SKILL_ROOT / "visualization-base.css"


def _load_css() -> str:
    if CSS_PATH.is_file():
        return CSS_PATH.read_text(encoding="utf-8")
    return "body{font-family:system-ui,sans-serif;padding:2rem;}"


def _form_html() -> str:
    css = _load_css()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Skill Dossier — Research Intake</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>{css}</style>
</head>
<body>
  <div class="intake-card">
    <div class="brand" style="margin-bottom:0.75rem">
      <span class="brand-mark">Skill Dossier</span>
      <span class="brand-sub">Research Materials</span>
    </div>
    <h1>What are you researching?</h1>
    <p class="lede">Enter a topic and filters. On submit, this page writes a request file for your assistant, which will harvest scholarly sources and build a dossier.</p>
    <form method="POST" action="/submit">
      <div class="field">
        <label for="topic">Research topic <span class="hint">Required — be specific enough for a lit review</span></label>
        <textarea id="topic" name="topic" required placeholder="e.g. Evaluation benchmarks for retrieval-augmented generation in scientific QA"></textarea>
      </div>
      <div class="field">
        <label for="discipline">Discipline / field <span class="hint">Optional</span></label>
        <input type="text" id="discipline" name="discipline" placeholder="e.g. NLP, HCI, computational biology" />
      </div>
      <div class="row-2">
        <div class="field">
          <label for="year_from">Year from</label>
          <input type="number" id="year_from" name="year_from" min="1900" max="2100" value="2020" />
        </div>
        <div class="field">
          <label for="year_to">Year to</label>
          <input type="number" id="year_to" name="year_to" min="1900" max="2100" value="{datetime.now().year}" />
        </div>
      </div>
      <div class="field">
        <label>What to include</label>
        <div class="checks">
          <label><input type="checkbox" name="material_tracks" value="key_reference" checked /> Key / highly recognized references</label>
          <label><input type="checkbox" name="material_tracks" value="research" checked /> Research papers (peer-reviewed)</label>
          <label><input type="checkbox" name="material_tracks" value="industry" checked /> Industry reports</label>
          <label><input type="checkbox" name="material_tracks" value="thesis" checked /> Theses</label>
          <label><input type="checkbox" name="material_tracks" value="preprint" checked /> Preprints (e.g. arXiv)</label>
        </div>
      </div>
      <div class="row-2">
        <div class="field">
          <label for="max_results">Max results</label>
          <input type="number" id="max_results" name="max_results" min="5" max="50" value="50" />
        </div>
        <div class="field">
          <label for="audience">Writing tone <span class="hint">Guides descriptions; not shown on the dossier</span></label>
          <select id="audience" name="audience">
            <option value="lit_review">Literature review</option>
            <option value="thesis">Thesis / dissertation</option>
            <option value="coursework">Coursework</option>
            <option value="industry">Industry brief</option>
          </select>
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-primary" type="submit">Start harvest</button>
      </div>
    </form>
  </div>
</body>
</html>
"""


def _confirm_html() -> str:
    css = _load_css()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Submitted — Skill Dossier</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;700&family=Source+Sans+3:wght@400;600;700&display=swap" rel="stylesheet" />
  <style>{css}</style>
</head>
<body>
  <div class="intake-card confirm">
    <div class="brand" style="justify-content:center;margin-bottom:0.75rem">
      <span class="brand-mark">Skill Dossier</span>
    </div>
    <h1>Request submitted</h1>
    <p class="lede">Your topic was saved to <code>request.json</code>. Return to Cursor or Claude — the assistant will harvest sources and open the dossier when ready. You can close this tab.</p>
  </div>
</body>
</html>
"""


def _parse_form(body: bytes) -> dict:
    raw = parse_qs(body.decode("utf-8", errors="replace"), keep_blank_values=True)

    def one(key: str, default: str = "") -> str:
        vals = raw.get(key, [default])
        return (vals[0] if vals else default).strip()

    material_tracks = [v for v in raw.get("material_tracks", []) if v]
    if not material_tracks:
        material_tracks = [
            "key_reference",
            "research",
            "industry",
            "thesis",
            "preprint",
        ]

    year_from = one("year_from", "2020")
    year_to = one("year_to", str(datetime.now().year))
    max_results = one("max_results", "50")

    try:
        yf = int(year_from)
    except ValueError:
        yf = 2020
    try:
        yt = int(year_to)
    except ValueError:
        yt = datetime.now().year
    try:
        mx = max(5, min(50, int(max_results)))
    except ValueError:
        mx = 50

    topic = one("topic")
    if not topic:
        raise ValueError("topic is required")

    return {
        "topic": topic,
        "discipline": one("discipline"),
        "year_from": yf,
        "year_to": yt,
        "material_tracks": material_tracks,
        "max_results": mx,
        "audience": one("audience", "lit_review"),
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "skill": "skill-dossier",
    }


class Handler(BaseHTTPRequestHandler):
    out_dir: Path = DEFAULT_OUT

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[intake] " + (fmt % args) + "\n")

    def _send(self, code: int, body: bytes, content_type: str = "text/html; charset=utf-8") -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path in ("/", "/index.html", "/intake"):
            self._send(200, _form_html().encode("utf-8"))
            return
        if self.path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
            return
        if self.path == "/status":
            req = self.out_dir / "request.json"
            payload = json.dumps({"ready": req.is_file(), "path": str(req)}).encode("utf-8")
            self._send(200, payload, "application/json")
            return
        self._send(404, b"Not found")

    def do_POST(self) -> None:
        if self.path != "/submit":
            self._send(404, b"Not found")
            return
        length = int(self.headers.get("Content-Length", "0") or "0")
        body = self.rfile.read(length) if length else b""
        try:
            request = _parse_form(body)
        except ValueError as exc:
            msg = f"<h1>Invalid form</h1><p>{exc}</p>".encode("utf-8")
            self._send(400, msg)
            return

        self.out_dir.mkdir(parents=True, exist_ok=True)
        out_path = self.out_dir / "request.json"
        out_path.write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        # Signal file for agents that prefer a simple existence check
        (self.out_dir / "REQUEST_READY").write_text("1\n", encoding="utf-8")
        self._send(200, _confirm_html().encode("utf-8"))


def _stop_existing() -> bool:
    if not PID_FILE.is_file():
        return False
    try:
        pid = int(PID_FILE.read_text(encoding="utf-8").strip())
        os.kill(pid, signal.SIGTERM)
    except (ValueError, ProcessLookupError, PermissionError):
        pass
    try:
        PID_FILE.unlink(missing_ok=True)
    except OSError:
        pass
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Skill Dossier research intake server")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--stop", action="store_true", help="Stop a previously started intake server")
    args = parser.parse_args()

    if args.stop:
        stopped = _stop_existing()
        print("stopped" if stopped else "not running")
        return 0

    _stop_existing()
    out_dir = args.out.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    # Clear stale request so the agent waits for a fresh submit
    for name in ("request.json", "REQUEST_READY"):
        p = out_dir / name
        if p.exists():
            p.unlink()

    Handler.out_dir = out_dir
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")

    url = f"http://127.0.0.1:{args.port}/"
    print(f"intake listening on {url}")
    print(f"will write request to {out_dir / 'request.json'}")
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        PID_FILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
