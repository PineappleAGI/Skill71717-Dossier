#!/usr/bin/env python3
"""
Serve the Mode 1 dossier over HTTP and proxy public evidence APIs.

Browser pages opened as file:// cannot call PubMed/Europe PMC (CORS / opaque
origin). This local server is part of the skill — no MCP, no extra accounts.

Usage:
  python scripts/mode1-server.py --html example/dossier.html --port 8766
  python scripts/mode1-server.py --stop
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

SKILL_ROOT = Path(__file__).resolve().parent.parent
PID_FILE = SKILL_ROOT / ".mode1-server.pid"
sys.path.insert(0, str(Path(__file__).resolve().parent))
import evidence_apis as apis  # noqa: E402


def _json_ok(payload: object) -> bytes:
    return json.dumps({"ok": True, "data": payload}, ensure_ascii=False).encode("utf-8")


def _json_err(message: str, status: int = 502) -> tuple[int, bytes]:
    body = json.dumps({"ok": False, "error": message}, ensure_ascii=False).encode("utf-8")
    return status, body


class Handler(BaseHTTPRequestHandler):
    html_path: Path = SKILL_ROOT / "example" / "dossier.html"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type: str = "text/html; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        q = {k: v[0] if v else "" for k, v in parse_qs(parsed.query).items()}

        if path in ("/", "/index.html", "/dossier.html"):
            html = self.html_path.read_bytes() if self.html_path.is_file() else b"<h1>dossier.html missing</h1>"
            self._send(200 if self.html_path.is_file() else 404, html)
            return
        if path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
            return

        if path.startswith("/api/"):
            try:
                status, body = self._api(path, q)
            except Exception as exc:
                traceback.print_exc()
                status, body = _json_err(str(exc) or exc.__class__.__name__)
            self._send(status, body, "application/json; charset=utf-8")
            return

        self._send(404, b"Not found")

    def _api(self, path: str, q: dict[str, str]) -> tuple[int, bytes]:
        term = (q.get("q") or q.get("term") or "").strip()
        if path == "/api/pubmed/search":
            if not term:
                return _json_err("missing q", 400)
            retmax = int(q.get("retmax") or "20")
            return 200, _json_ok(apis.pubmed_search(term, retmax=min(retmax, 100)))
        if path == "/api/pubmed/summary":
            ids = [i for i in (q.get("ids") or "").split(",") if i.strip()]
            return 200, _json_ok(apis.pubmed_summary(ids[:80]))
        if path == "/api/pubmed/abstracts":
            ids = [i for i in (q.get("ids") or "").split(",") if i.strip()]
            return 200, _json_ok(apis.pubmed_abstracts(ids[:50]))
        if path == "/api/europepmc/search":
            if not term:
                return _json_err("missing q", 400)
            page_size = int(q.get("pageSize") or q.get("page_size") or "20")
            rtype = q.get("resultType") or q.get("result_type") or "lite"
            return 200, _json_ok(apis.europepmc_search(term, page_size=min(page_size, 50), result_type=rtype))
        if path == "/api/europepmc/fulltext":
            pmcid = (q.get("pmcid") or q.get("pmc") or "").strip()
            if not pmcid:
                return _json_err("missing pmcid", 400)
            return 200, _json_ok(apis.europepmc_fulltext(pmcid))
        if path == "/api/trials/search":
            if not term:
                return _json_err("missing q", 400)
            page_size = int(q.get("pageSize") or "10")
            return 200, _json_ok(apis.trials_search(term, page_size=min(page_size, 20)))
        if path == "/api/openalex/search":
            if not term:
                return _json_err("missing q", 400)
            per_page = int(q.get("per_page") or "20")
            return 200, _json_ok(apis.openalex_search(term, per_page=min(per_page, 50)))
        if path == "/api/unpaywall":
            doi = (q.get("doi") or "").strip()
            if not doi:
                return _json_err("missing doi", 400)
            return 200, _json_ok(apis.unpaywall_lookup(doi))
        if path == "/api/websearch":
            if not term:
                return _json_err("missing q", 400)
            max_results = int(q.get("max") or q.get("max_results") or "8")
            return 200, _json_ok(apis.web_literature_sweep(term, max_results=min(max_results, 10)))
        return _json_err("unknown endpoint", 404)


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
    parser = argparse.ArgumentParser(description="Mode 1 evidence-synthesis server")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--html", type=Path, default=SKILL_ROOT / "example" / "dossier.html")
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()

    if args.stop:
        print("stopped" if _stop_existing() else "not running")
        return 0

    _stop_existing()
    html_path = args.html.resolve()
    Handler.html_path = html_path
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"mode1 listening on {url}")
    print(f"serving {html_path}")
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
