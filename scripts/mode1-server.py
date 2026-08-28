#!/usr/bin/env python3
"""
Serve the Mode 1 dossier over HTTP and proxy public evidence APIs.

Browser pages opened as file:// cannot call PubMed/Europe PMC (CORS / opaque
origin). This local server is part of the skill — no MCP, no extra accounts.

Usage:
  python scripts/mode1-server.py --port 8767
  python scripts/mode1-server.py --html example/dossier.html --port 8767
  python scripts/mode1-server.py --html dossier.html --port 8767 --no-open
  python scripts/mode1-server.py --stop

Live intake: start with no --html so `/` is the question form (opens once).
After generate: `--html FILE --no-open` hot-reloads a running server. If the
waiting tab is still polling `/ready`, it becomes the dossier. If that tab was
closed, the reload opens the browser once so the dossier is visible.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import signal
import sys
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
import re

SKILL_ROOT = Path(__file__).resolve().parent.parent
PID_FILE = SKILL_ROOT / ".mode1-server.pid"
INTAKE_PID_FILE = SKILL_ROOT / ".intake-server.pid"
SERVING_FILE = SKILL_ROOT / ".mode1-serving"
READY_AT_FILE = SKILL_ROOT / ".mode1-last-ready"
INTAKE_OUT = SKILL_ROOT / ".research-materials"
READY_IDLE_SECS = 8.0
sys.path.insert(0, str(Path(__file__).resolve().parent))
import evidence_apis as apis  # noqa: E402


def _intake_mod():
    path = Path(__file__).resolve().parent / "intake-server.py"
    spec = importlib.util.spec_from_file_location("pineapple_intake", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _json_ok(payload: object) -> bytes:
    return json.dumps({"ok": True, "data": payload}, ensure_ascii=False).encode("utf-8")


def _json_err(message: str, status: int = 502) -> tuple[int, bytes]:
    body = json.dumps({"ok": False, "error": message}, ensure_ascii=False).encode("utf-8")
    return status, body


def _set_serving_html(path: Path | None) -> None:
    if path is None:
        try:
            SERVING_FILE.unlink(missing_ok=True)
        except OSError:
            pass
        return
    SERVING_FILE.write_text(str(path.resolve()) + "\n", encoding="utf-8")


def _serving_html() -> Path | None:
    if not SERVING_FILE.is_file():
        return None
    try:
        raw = SERVING_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_file() else None


def _mark_ready_poll() -> None:
    try:
        READY_AT_FILE.write_text(str(time.time()), encoding="utf-8")
    except OSError:
        pass


def _waiting_tab_alive() -> bool:
    if not READY_AT_FILE.is_file():
        return False
    try:
        last = float(READY_AT_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return False
    return (time.time() - last) < READY_IDLE_SECS


def _open_browser(url: str) -> None:
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _dossier_ready() -> dict:
    html = _serving_html()
    if html is None:
        return {"dossier": False}
    sub = INTAKE_OUT / "raw_submission.json"
    try:
        if sub.is_file() and html.stat().st_mtime + 0.05 < sub.stat().st_mtime:
            return {"dossier": False, "path": str(html)}
    except OSError:
        return {"dossier": False}
    return {"dossier": True, "path": str(html)}


class Handler(BaseHTTPRequestHandler):
    intake = None

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _intake(self):
        if Handler.intake is None:
            Handler.intake = _intake_mod()
        return Handler.intake

    def _clear_ready_flag(self) -> None:
        ready = INTAKE_OUT / "RAW_SUBMISSION_READY"
        try:
            ready.unlink(missing_ok=True)
        except OSError:
            pass

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
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Filename")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        q = {k: v[0] if v else "" for k, v in parse_qs(parsed.query).items()}

        if path in ("/", "/index.html", "/dossier.html"):
            html_path = _serving_html()
            if html_path is not None and _dossier_ready().get("dossier"):
                self._send(200, html_path.read_bytes())
                return
            self._send(200, self._intake()._form_html().encode("utf-8"))
            return
        if path in ("/ask", "/intake"):
            self._clear_ready_flag()
            self._send(200, self._intake()._form_html().encode("utf-8"))
            return
        if path == "/ready":
            _mark_ready_poll()
            self._send(200, json.dumps(_dossier_ready()).encode("utf-8"), "application/json")
            return
        if path == "/health":
            payload = {"ok": True, **_dossier_ready()}
            self._send(200, json.dumps(payload).encode("utf-8"), "application/json")
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

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/submit":
            self._handle_intake_submit()
            return
        if parsed.path not in ("/api/blog-pdf", "/api/save-file"):
            self._send(404, b"Not found")
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        max_bytes = 8_000_000 if parsed.path == "/api/save-file" else 2_000_000
        if length < 8 or length > max_bytes:
            status, body = _json_err("invalid file size", 400)
            self._send(status, body, "application/json; charset=utf-8")
            return
        payload = self.rfile.read(length)
        if payload.startswith(b"%PDF"):
            ext, fallback = ".pdf", "literature-scan.pdf"
        elif payload.startswith(b"\x89PNG"):
            ext, fallback = ".png", "question-map.png"
        else:
            status, body = _json_err("unsupported file", 400)
            self._send(status, body, "application/json; charset=utf-8")
            return
        raw_name = self.headers.get("X-Filename") or fallback
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip("-")[:80]
        if not name.lower().endswith(ext):
            name = (name or Path(fallback).stem) + ext
        dest_dir = Path.home() / "Downloads"
        if not dest_dir.is_dir():
            served = _serving_html()
            dest_dir = served.parent if served is not None else INTAKE_OUT
        dest = dest_dir / name
        n = 1
        stem = dest.stem
        while dest.exists():
            dest = dest_dir / f"{stem}-{n}{ext}"
            n += 1
        dest.write_bytes(payload)
        self._send(200, _json_ok({"path": str(dest), "filename": dest.name}), "application/json; charset=utf-8")

    def _handle_intake_submit(self) -> None:
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        body = self.rfile.read(length) if length else b""
        intake = self._intake()
        try:
            request = intake._parse_form(body)
        except ValueError as exc:
            msg = f"<h1>Invalid form</h1><p>{exc}</p>".encode("utf-8")
            self._send(400, msg)
            return
        INTAKE_OUT.mkdir(parents=True, exist_ok=True)
        out_path = INTAKE_OUT / "raw_submission.json"
        out_path.write_text(json.dumps(request, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (INTAKE_OUT / "RAW_SUBMISSION_READY").write_text("1\n", encoding="utf-8")
        _set_serving_html(None)
        self._send(200, intake._confirm_html().encode("utf-8"))

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
            sort = (q.get("sort") or "relevance_score:desc").strip()
            return 200, _json_ok(
                apis.openalex_search(term, per_page=min(per_page, 50), sort=sort)
            )
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


def _stop_pid_file(pid_file: Path) -> bool:
    if not pid_file.is_file():
        return False
    try:
        pid = int(pid_file.read_text(encoding="utf-8").strip())
        os.kill(pid, signal.SIGTERM)
    except (ValueError, ProcessLookupError, PermissionError):
        pass
    try:
        pid_file.unlink(missing_ok=True)
    except OSError:
        pass
    return True


def _pid_is_alive(pid_file: Path) -> bool:
    if not pid_file.is_file():
        return False
    try:
        pid = int(pid_file.read_text(encoding="utf-8").strip())
        os.kill(pid, 0)
        return True
    except (ValueError, ProcessLookupError, PermissionError, OSError):
        return False


def _stop_existing() -> bool:
    return _stop_pid_file(PID_FILE)


def _clear_stale_submission(out_dir: Path) -> None:
    for name in ("raw_submission.json", "RAW_SUBMISSION_READY", "request.json", "REQUEST_READY"):
        p = out_dir / name
        if p.exists():
            try:
                p.unlink()
            except OSError:
                pass


def main() -> int:
    global INTAKE_OUT
    parser = argparse.ArgumentParser(description="Mode 1 evidence-synthesis server")
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--html", type=Path, default=None, help="Dossier HTML. Omit to serve the question form.")
    parser.add_argument("--out", type=Path, default=INTAKE_OUT)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--stop", action="store_true")
    args = parser.parse_args()

    INTAKE_OUT = args.out.resolve()

    if args.stop:
        print("stopped" if _stop_existing() else "not running")
        return 0

    html_path = args.html.resolve() if args.html is not None else None
    if html_path is not None and not html_path.is_file():
        print(f"html not found: {html_path}", file=sys.stderr)
        return 2

    # Same port: swap form/dossier. Reopen only if the waiting tab is gone.
    if _pid_is_alive(PID_FILE):
        if html_path is None:
            _set_serving_html(None)
            _clear_stale_submission(INTAKE_OUT)
            print("reloaded question form")
        else:
            _set_serving_html(html_path)
            print(f"reloaded {html_path}")
        url = f"http://127.0.0.1:{args.port}/"
        if html_path is not None and not _waiting_tab_alive():
            _open_browser(url)
            print("opened browser — no waiting tab")
        else:
            print("mode1 already listening — not opening a browser")
        return 0

    _stop_existing()
    _stop_pid_file(INTAKE_PID_FILE)
    INTAKE_OUT.mkdir(parents=True, exist_ok=True)

    if html_path is None:
        _set_serving_html(None)
        _clear_stale_submission(INTAKE_OUT)
        serving_note = "question form"
    else:
        _set_serving_html(html_path)
        serving_note = str(html_path)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    PID_FILE.write_text(str(os.getpid()), encoding="utf-8")
    url = f"http://127.0.0.1:{args.port}/"
    print(f"mode1 listening on {url}")
    print(f"serving {serving_note}")
    if not args.no_open:
        _open_browser(url)
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
