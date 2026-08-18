#!/usr/bin/env python3
"""
Classify harvested papers by epistemic stance toward the research question.

Calls the Claude API once per uncached paper (title + abstract). Results are
written to claims.json beside the harvest so generate-dossier.py can section
by stance. Classification is a batch job, not a page-load call.

Usage:
  python scripts/classify-claims.py <harvest.json> [output_dir]
  python scripts/classify-claims.py example/harvest.json example \\
      --enrichment example/enrichment.json

Env:
  ANTHROPIC_API_KEY   required for uncached papers
  ANTHROPIC_MODEL     default claude-haiku-4-5 (override if needed)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SKILL_ROOT = Path(__file__).resolve().parent.parent
API_URL = "https://api.anthropic.com/v1/messages"
DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
CACHE_NAME = "claims.json"

STANCES = ("supports", "contradicts", "neutral", "test_condition")
RELEVANCE = ("high", "medium", "low", "off_topic")
STRENGTHS = ("strong", "moderate", "weak")

PLACEHOLDER_CLAIM = (
    "contributes evidence or framing related to generative dynamics, planning, or multimodal learning"
)
BROKEN_ABSTRACT_PATTERNS = (
    re.compile(r"see the linked source for details", re.I),
    re.compile(r"^abstract\s*$", re.I),
)

DEFAULT_SUPPORTS = (
    "evidence backing the idea that video generation models function as genuine "
    "world simulators for planning"
)
DEFAULT_CONTRADICTS = (
    "evidence that video generation models are media-generation only, or that "
    "simulator claims don't hold up under testing"
)


def _system_prompt(supports: str, contradicts: str) -> str:
    return f"""You are classifying a research paper's relevance to a specific research question. Given the paper's title and abstract, and the research question, return ONLY valid JSON in this exact shape, no markdown fences, no preamble:
{{
  "stance": "supports" | "contradicts" | "neutral" | "test_condition",
  "confidence": <0-100 integer>,
  "evidence_strength": "strong" | "moderate" | "weak",
  "evidence_strength_reason": "<one short phrase, e.g. 'peer-reviewed, large-scale benchmark' or 'position paper, no independent evaluation'>",
  "one_line_claim": "<a single specific, non-generic sentence stating what this paper actually found or argues, in plain language>",
  "relevance": "high" | "medium" | "low" | "off_topic"
}}

Rules:
- "supports" = {supports}
- "contradicts" = {contradicts}
- "neutral" = relevant background/methods, doesn't take a side
- "test_condition" = describes what WOULD prove or disprove the claim (benchmarks, evaluation methods), rather than making the claim itself
- If the paper is not meaningfully about this research question, set relevance to 'off_topic' regardless of citation count
- one_line_claim must be a REAL claim extracted from the abstract, never a generic sentence like 'contributes evidence related to X.' If the abstract doesn't support a specific claim, say so honestly in the field rather than inventing one."""


def _user_message(question: str, title: str, abstract: str) -> str:
    return (
        f"Research question:\n{question.strip()}\n\n"
        f"Paper title:\n{title.strip()}\n\n"
        f"Abstract:\n{abstract.strip() or '(no abstract provided)'}"
    )


def _strip_html(s: str) -> str:
    return re.sub(r"<[^>]+>", " ", s or "")


def abstract_is_broken(abstract: object) -> bool:
    text = _strip_html("" if abstract is None else str(abstract)).strip()
    if len(text) < 40:
        return True
    return any(p.search(text) for p in BROKEN_ABSTRACT_PATTERNS)


def _placeholder_in_enrichment(enr: dict | None) -> bool:
    if not enr:
        return False
    blob = " ".join(
        [
            str(enr.get("short_description") or ""),
            " ".join(enr.get("key_claims") or []),
        ]
    ).lower()
    return PLACEHOLDER_CLAIM in blob


def _valid_cached(entry: dict | None) -> bool:
    if not isinstance(entry, dict):
        return False
    if entry.get("skipped"):
        return True
    stance = entry.get("stance")
    rel = entry.get("relevance")
    strength = entry.get("evidence_strength")
    conf = entry.get("confidence")
    claim = (entry.get("one_line_claim") or "").strip()
    if stance not in STANCES or rel not in RELEVANCE or strength not in STRENGTHS:
        return False
    if not isinstance(conf, int) or not (0 <= conf <= 100):
        return False
    if not claim or PLACEHOLDER_CLAIM in claim.lower():
        return False
    return True


def _parse_model_json(raw: str) -> dict:
    text = (raw or "").strip()
    text = re.sub(r"^```(?:json)?\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("model response was not JSON")
    data = json.loads(text[start : end + 1])
    stance = str(data.get("stance") or "").strip().lower()
    if stance not in STANCES:
        raise ValueError(f"bad stance: {stance!r}")
    rel = str(data.get("relevance") or "").strip().lower()
    if rel not in RELEVANCE:
        raise ValueError(f"bad relevance: {rel!r}")
    strength = str(data.get("evidence_strength") or "").strip().lower()
    if strength not in STRENGTHS:
        raise ValueError(f"bad evidence_strength: {strength!r}")
    conf = data.get("confidence")
    if isinstance(conf, float) and conf.is_integer():
        conf = int(conf)
    if not isinstance(conf, int):
        raise ValueError("confidence must be an integer")
    conf = max(0, min(100, conf))
    claim = str(data.get("one_line_claim") or "").strip()
    if not claim:
        raise ValueError("missing one_line_claim")
    reason = str(data.get("evidence_strength_reason") or "").strip()
    return {
        "stance": stance,
        "confidence": conf,
        "evidence_strength": strength,
        "evidence_strength_reason": reason or "unspecified",
        "one_line_claim": claim,
        "relevance": rel,
    }


def _claude_classify(
    *,
    api_key: str,
    model: str,
    system: str,
    user: str,
    retries: int = 3,
) -> dict:
    payload = json.dumps(
        {
            "model": model,
            "max_tokens": 400,
            "temperature": 0,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=payload,
        method="POST",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        },
    )
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            parts = body.get("content") or []
            text = "".join(p.get("text") or "" for p in parts if p.get("type") == "text")
            parsed = _parse_model_json(text)
            parsed["model"] = model
            return parsed
        except urllib.error.HTTPError as exc:
            last_err = exc
            if exc.code in (429, 500, 502, 503, 529) and attempt < retries - 1:
                time.sleep(1.5 * (attempt + 1))
                continue
            detail = exc.read().decode("utf-8", errors="replace")[:400]
            raise RuntimeError(f"Claude API HTTP {exc.code}: {detail}") from exc
        except Exception as exc:  # noqa: BLE001 — retry parse/network blips
            last_err = exc
            if attempt < retries - 1:
                time.sleep(1.0 * (attempt + 1))
                continue
            raise
    raise RuntimeError(str(last_err or "classification failed"))


def _load_enrichment_map(path: Path | None) -> dict[str, dict]:
    if not path or not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {m["id"]: m for m in (data.get("materials") or []) if m.get("id")}


def classify_harvest(
    harvest: dict,
    cache: dict,
    *,
    enrichment_map: dict[str, dict],
    api_key: str | None,
    model: str,
    force: bool,
    workers: int,
) -> dict:
    request = harvest.get("request") or {}
    question = (request.get("topic") or "").strip()
    if not question:
        raise SystemExit("harvest.json has no request.topic")

    defs = request.get("stance_definitions") or {}
    supports = (defs.get("supports") or DEFAULT_SUPPORTS).strip()
    contradicts = (defs.get("contradicts") or DEFAULT_CONTRADICTS).strip()
    system = _system_prompt(supports, contradicts)

    cached_q = (cache.get("research_question") or "").strip()
    items: dict[str, dict] = dict(cache.get("items") or {})
    if cached_q and cached_q != question:
        items = {}

    materials = [m for m in (harvest.get("materials") or []) if m.get("id")]
    todo: list[dict] = []
    skipped = 0
    reused = 0

    for m in materials:
        pid = m["id"]
        existing = items.get(pid)
        broken = abstract_is_broken(m.get("abstract"))
        needs = force or not _valid_cached(existing)
        if not needs and _placeholder_in_enrichment(enrichment_map.get(pid)):
            # Cached claim is fine; placeholder in enrichment is not a reason to
            # re-call the API unless the cached claim itself is generic.
            pass
        if broken:
            items[pid] = {
                "skipped": True,
                "skip_reason": "empty_or_broken_abstract",
                "relevance": "off_topic",
            }
            skipped += 1
            continue
        if not needs:
            reused += 1
            continue
        todo.append(m)

    if todo and not api_key:
        raise SystemExit(
            f"{len(todo)} paper(s) need classification. Set ANTHROPIC_API_KEY, "
            "or provide a claims.json cache."
        )

    def _one(m: dict) -> tuple[str, dict]:
        result = _claude_classify(
            api_key=api_key or "",
            model=model,
            system=system,
            user=_user_message(question, str(m.get("title") or ""), str(m.get("abstract") or "")),
        )
        return m["id"], result

    if todo:
        workers = max(1, min(workers, len(todo)))
        print(f"classifying {len(todo)} paper(s) with {model} ({workers} workers)…", file=sys.stderr)
        if workers == 1:
            for m in todo:
                pid, result = _one(m)
                items[pid] = result
                print(f"  {pid} → {result['stance']} / {result['relevance']}", file=sys.stderr)
        else:
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futs = {pool.submit(_one, m): m for m in todo}
                for fut in as_completed(futs):
                    pid, result = fut.result()
                    items[pid] = result
                    print(f"  {pid} → {result['stance']} / {result['relevance']}", file=sys.stderr)

    out_model = model if todo else (cache.get("model") or model)
    return {
        "research_question": question,
        "stance_definitions": {"supports": supports, "contradicts": contradicts},
        "model": out_model,
        "classified_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stats": {
            "harvested": len(materials),
            "classified_now": len(todo),
            "reused_cache": reused,
            "skipped_broken_abstract": skipped,
        },
        "items": items,
        "rooms": cache.get("rooms") or [],
        "prior": cache.get("prior", 0.5),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Classify harvest papers by stance via Claude API")
    parser.add_argument("harvest", type=Path)
    parser.add_argument("output_dir", type=Path, nargs="?", default=None)
    parser.add_argument("--enrichment", type=Path, default=None, help="Used to detect placeholder claims")
    parser.add_argument("--force", action="store_true", help="Reclassify even when cache is valid")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()

    harvest_path = args.harvest
    out_dir = args.output_dir or harvest_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)
    cache_path = out_dir / CACHE_NAME

    harvest = json.loads(harvest_path.read_text(encoding="utf-8"))
    cache: dict[str, Any] = {}
    if cache_path.is_file() and not args.force:
        cache = json.loads(cache_path.read_text(encoding="utf-8"))

    enr_map = _load_enrichment_map(args.enrichment)
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    result = classify_harvest(
        harvest,
        cache,
        enrichment_map=enr_map,
        api_key=api_key,
        model=DEFAULT_MODEL,
        force=args.force,
        workers=args.workers,
    )
    cache_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {cache_path.resolve()}")
    stats = result.get("stats") or {}
    print(
        "harvested={harvested} classified_now={classified_now} "
        "reused_cache={reused_cache} skipped_broken_abstract={skipped_broken_abstract}".format(
            **{k: stats.get(k, 0) for k in ("harvested", "classified_now", "reused_cache", "skipped_broken_abstract")}
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
