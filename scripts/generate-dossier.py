#!/usr/bin/env python3
"""
Generate a self-contained research dossier HTML for Skill71717.

Usage:
  python scripts/generate-dossier.py <harvest.json> <enrichment.json> <output.html> [--no-open]
  python scripts/generate-dossier.py ... --claims claims.json --no-open

If --claims is omitted, looks for claims.json next to harvest.json.
"""

from __future__ import annotations

import html
import json
import os
import re
import subprocess
import sys
import webbrowser
from datetime import datetime
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
CSS_PATH = SKILL_ROOT / "visualization-base.css"
SEED_DEBATES_PATH = SKILL_ROOT / "data" / "seed-debates.json"

RELATED_BLURBS = {
    "sim-vs-media": "Labs pitch video models as world simulators; critics say they still just generate plausible clips.",
    "can-video-plan": "Some papers treat generated video as a plan; others say planning needs structure the clip never had.",
    "lab-claims": "Company tech notes claim simulator status; peer-reviewed work often treats those claims as unproven.",
    "interactive-worlds": "Action-conditioned next-frame models look like simulators; one-shot generators still aren't worlds you can query.",
    "pixels-or-physics": "Photorealism looks like understanding; planning may only need coarse dynamics.",
    "robots-and-roads": "Driving and robot demos suggest transfer; the leap from video to real control is still contested.",
}

# Epistemic role toward the research question (primary dossier sections)
STANCE_SECTIONS = [
    (
        "supports",
        "Evidence supporting",
        "Papers whose findings or arguments back video models as world simulators for planning.",
    ),
    (
        "contradicts",
        "Evidence contradicting / limiting",
        "Papers that treat video models as media generation, or that undercut simulator claims.",
    ),
    (
        "test_condition",
        "Test conditions",
        "Work that says what would prove or disprove the claim (benchmarks, evaluation methods).",
    ),
    (
        "neutral",
        "Neutral / background",
        "Relevant methods or framing that do not take a side on the question.",
    ),
]

STRENGTH_RANK = {"strong": 3, "moderate": 2, "weak": 1}
UI_JS_PATH = SKILL_ROOT / "scripts" / "dossier-ui.js"


def _open_html(path: Path) -> None:
    resolved = path.resolve()
    if not resolved.is_file():
        return
    try:
        if sys.platform == "darwin":
            subprocess.run(["open", str(resolved)], check=False)
        elif sys.platform == "win32":
            os.startfile(str(resolved))  # type: ignore[attr-defined]
        else:
            webbrowser.open(resolved.as_uri())
    except Exception:
        pass


def _esc(s: object) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def _load_css() -> str:
    return CSS_PATH.read_text(encoding="utf-8") if CSS_PATH.is_file() else ""


def _load_js() -> str:
    return UI_JS_PATH.read_text(encoding="utf-8") if UI_JS_PATH.is_file() else ""


def _by_id(enrichment: dict) -> dict[str, dict]:
    items = enrichment.get("materials") or []
    return {m.get("id"): m for m in items if m.get("id")}


def _bibtex_key(material: dict) -> str:
    authors = material.get("authors") or ["anon"]
    last = re.sub(r"\W+", "", (authors[0].split()[-1] if authors else "anon"))
    year = material.get("year") or "n.d."
    title_words = re.findall(r"[A-Za-z0-9]+", material.get("title") or "work")
    tip = (title_words[0] if title_words else "work").lower()
    return f"{last.lower()}{year}{tip}"


def _to_bibtex(material: dict) -> str:
    key = _bibtex_key(material)
    authors = " and ".join(material.get("authors") or ["Unknown"])
    year = material.get("year") or ""
    title = material.get("title") or "Untitled"
    venue = material.get("venue") or ""
    doi = material.get("doi") or ""
    url = material.get("url") or ""
    entry_type = "article" if material.get("type") == "journal" else "misc"
    lines = [
        f"@{entry_type}{{{key},",
        f"  title = {{{title}}},",
        f"  author = {{{authors}}},",
    ]
    if year:
        lines.append(f"  year = {{{year}}},")
    if venue:
        lines.append(f"  journal = {{{venue}}},")
    if doi:
        lines.append(f"  doi = {{{doi}}},")
    if url:
        lines.append(f"  url = {{{url}}},")
    lines.append("}")
    return "\n".join(lines)


def _claims_map(claims: dict | None) -> dict[str, dict]:
    if not isinstance(claims, dict):
        return {}
    items = claims.get("items") or {}
    return {k: v for k, v in items.items() if isinstance(v, dict)}


def _claim_entry(claims_by_id: dict[str, dict], pid: str | None) -> dict:
    if not pid:
        return {}
    return claims_by_id.get(pid) or {}


def _is_off_topic(claim: dict) -> bool:
    if claim.get("skipped"):
        return True
    return (claim.get("relevance") or "").strip().lower() == "off_topic"


def _confidence_class(conf: int) -> str:
    if conf >= 75:
        return "high"
    if conf >= 50:
        return "mid"
    return "low"


def _confidence_indicator(conf: object) -> str:
    if not isinstance(conf, int):
        return ""
    band = _confidence_class(conf)
    return (
        f'<span class="conf" title="Classifier confidence {conf}">'
        f'<span class="conf-dot conf-{band}" aria-hidden="true"></span>'
        f'<span class="conf-bar" aria-hidden="true"><i style="width:{conf}%"></i></span>'
        f'<span class="visually-hidden">Confidence {conf} percent</span>'
        f"</span>"
    )


def _render_claim_material(m: dict, claim: dict, enr: dict | None) -> str:
    enr = enr or {}
    stance = (claim.get("stance") or "neutral").strip().lower()
    relevance = (claim.get("relevance") or "medium").strip().lower()
    strength = (claim.get("evidence_strength") or "moderate").strip().lower()
    reason = claim.get("evidence_strength_reason") or ""
    one_line = (claim.get("one_line_claim") or "").strip()
    if not one_line:
        one_line = (enr.get("short_description") or (m.get("abstract") or "")[:220] or "No claim extracted.").strip()

    authors = ", ".join(m.get("authors") or []) or "Authors unavailable"
    year = m.get("year") or ""
    url = m.get("url") or (f"https://doi.org/{m['doi']}" if m.get("doi") else "#")
    title_html = f'<a href="{_esc(url)}" target="_blank" rel="noopener noreferrer">{_esc(m.get("title"))}</a>'
    byline = _esc(authors) if not year else f"{_esc(authors)} · {_esc(year)}"

    badges = [
        f'<span class="badge strength-{_esc(strength)}" title="{_esc(reason)}">'
        f"{_esc(strength)} evidence</span>"
    ]
    if reason:
        badges.append(f'<span class="badge strength-reason">{_esc(reason)}</span>')

    extra_class = " is-low" if relevance == "low" else ""
    return f"""
<article class="material stance-{_esc(stance)}{extra_class}" data-id="{_esc(m.get('id'))}" data-stance="{_esc(stance)}">
  <div class="material-head">
    <h3>{title_html}</h3>
    {_confidence_indicator(claim.get("confidence"))}
  </div>
  <p class="byline">{byline}</p>
  <p class="claim">{_esc(one_line)}</p>
  <div class="badges">{''.join(badges)}</div>
</article>
"""


def _sort_by_strength(materials: list[dict], claims_by_id: dict[str, dict]) -> list[dict]:
    def key(m: dict) -> tuple[int, int]:
        c = _claim_entry(claims_by_id, m.get("id"))
        return (
            STRENGTH_RANK.get((c.get("evidence_strength") or "").lower(), 0),
            int(c.get("confidence") or 0),
        )

    return sorted(materials, key=key, reverse=True)


def _verdict_html(shown: list[dict], claims_by_id: dict[str, dict], dropped: int) -> str:
    camps = {k: [] for k, _, _ in STANCE_SECTIONS}
    weights = {k: 0 for k in camps}
    for m in shown:
        c = _claim_entry(claims_by_id, m.get("id"))
        stance = (c.get("stance") or "neutral").strip().lower()
        if stance not in camps:
            stance = "neutral"
        camps[stance].append(c)
        rel = (c.get("relevance") or "medium").lower()
        conf = int(c.get("confidence") or 0)
        w = conf if rel == "high" else (conf * 0.6 if rel == "medium" else conf * 0.3)
        weights[stance] += w

    n = {k: len(v) for k, v in camps.items()}
    total = sum(n.values()) or 1
    lead = camps["supports"] if weights["supports"] >= weights["contradicts"] else camps["contradicts"]
    lead_name = "supporting" if lead is camps["supports"] else "contradicting / limiting"
    gap = abs(weights["supports"] - weights["contradicts"])
    if total == 0:
        body = "No in-scope papers remained after relevance filtering."
    elif n["supports"] and n["contradicts"] and gap < (0.25 * max(weights["supports"] + weights["contradicts"], 1)):
        body = (
            f"The on-topic papers disagree: {n['supports']} support using video models as planning simulators, "
            f"{n['contradicts']} say they are media-only or unproven. Neither side clearly wins on weighted evidence."
        )
    else:
        body = (
            f"{n['supports']} on-topic papers support the simulator-for-planning side versus "
            f"{n['contradicts']} against it. The weight of evidence leans {lead_name}."
        )
    extra = []
    if n["test_condition"]:
        extra.append(f"{n['test_condition']} papers describe how you would test the claim rather than taking a side.")
    if dropped:
        extra.append(f"{dropped} harvested items were dropped because they were off-topic or had empty abstracts.")
    if extra:
        body = body + " " + " ".join(extra)
    return f"""
<section class="verdict panel" aria-label="Verdict">
  <h2>Verdict</h2>
  <p>{_esc(body)}</p>
</section>
"""


def _stance_sections_html(
    materials: list[dict],
    claims_by_id: dict[str, dict],
    enr_map: dict[str, dict],
    next_q: list | None = None,
) -> str:
    by_stance: dict[str, list[dict]] = {k: [] for k, _, _ in STANCE_SECTIONS}
    for m in materials:
        stance = (_claim_entry(claims_by_id, m.get("id")).get("stance") or "neutral").strip().lower()
        if stance not in by_stance:
            stance = "neutral"
        by_stance[stance].append(m)

    parts: list[str] = []
    for stance_id, title, blurb in STANCE_SECTIONS:
        items = _sort_by_strength(by_stance.get(stance_id) or [], claims_by_id)
        cards = "\n".join(
            _render_claim_material(m, _claim_entry(claims_by_id, m.get("id")), enr_map.get(m.get("id")))
            for m in items
        )
        extra = ""
        if stance_id == "test_condition" and next_q:
            extra = (
                '<div class="test-searches"><p class="section-blurb">Searches that would help prove or disprove this:</p><ul>'
                + "".join(f"<li>{_esc(q)}</li>" for q in next_q)
                + "</ul></div>"
            )
        if not items and not extra:
            continue
        count = len(items)
        heading = f"{title} <span class=\"section-count\">{count}</span>"
        if stance_id == "neutral":
            parts.append(
                f"""
<details class="material-section is-collapsed" data-stance="{_esc(stance_id)}">
  <summary class="section-heading">
    <h2>{heading}</h2>
    <p class="section-blurb">{_esc(blurb)}</p>
  </summary>
  {cards}
</details>
"""
            )
        else:
            parts.append(
                f"""
<section class="material-section" data-stance="{_esc(stance_id)}">
  <div class="section-heading">
    <h2>{heading}</h2>
    <p class="section-blurb">{_esc(blurb)}</p>
  </div>
  {cards}
  {extra}
</section>
"""
            )
    if not parts:
        return "<p>No in-scope materials after claim classification.</p>"
    return "\n".join(parts)


def _sort_materials(materials: list[dict], enr_map: dict[str, dict]) -> list[dict]:
    return sorted(
        materials,
        key=lambda m: -(enr_map.get(m.get("id"), {}).get("relevance_score") or 0),
    )


def _classification_axis(axis: dict | None, fallback_label: str = "") -> tuple[str, str]:
    if not isinstance(axis, dict):
        return fallback_label, ""
    label = (axis.get("label") or fallback_label or "").strip()
    detail = (axis.get("detail") or "").strip()
    return label, detail


def _render_classification(enrichment: dict) -> str:
    """Inquiry lens callout directly below the hero banner. Omitted if unset."""
    clf = enrichment.get("inquiry_classification")
    if not isinstance(clf, dict) or not clf:
        return ""

    title = (clf.get("title") or "Research Question Framework").strip()
    axes = [
        ("core_inquiry", "Core inquiry intent"),
        ("epistemic_rigor", "Epistemic rigor"),
        ("scope_boundary", "Scope boundary"),
    ]
    cells: list[str] = []
    for key, heading in axes:
        label, detail = _classification_axis(clf.get(key))
        if not label and not detail:
            continue
        detail_html = f'<p class="inquiry-detail">{_esc(detail)}</p>' if detail else ""
        cells.append(
            f"""
    <div class="inquiry-axis">
      <p class="inquiry-kicker">{_esc(heading)}</p>
      <p class="inquiry-label">{_esc(label)}</p>
      {detail_html}
    </div>"""
        )
    if not cells:
        return ""
    return f"""
<section class="inquiry panel" aria-label="{_esc(title)}">
  <h2>{_esc(title)}</h2>
  <p class="inquiry-lede">Lens used to structure this literature scan — not a finding of the papers themselves.</p>
  <div class="inquiry-grid">
    {"".join(cells)}
  </div>
</section>
"""


def _load_seed_debates() -> dict:
    if not SEED_DEBATES_PATH.is_file():
        return {"papers": [], "rooms": []}
    try:
        data = json.loads(SEED_DEBATES_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"papers": [], "rooms": []}
    if not isinstance(data, dict):
        return {"papers": [], "rooms": []}
    return {
        "papers": [p for p in (data.get("papers") or []) if isinstance(p, dict) and p.get("id")],
        "rooms": [r for r in (data.get("rooms") or []) if isinstance(r, dict) and r.get("id")],
    }


def _paper_payload(m: dict, claim: dict) -> dict:
    return {
        "id": m.get("id"),
        "source": claim.get("source") or "harvest",
        "scope": claim.get("scope") or "main",
        "title": m.get("title") or "Untitled",
        "authors": m.get("authors") or [],
        "year": m.get("year"),
        "venue": m.get("venue") or m.get("organization") or "",
        "url": m.get("url") or (f"https://doi.org/{m['doi']}" if m.get("doi") else ""),
        "doi": m.get("doi") or "",
        "citation_count": m.get("citation_count"),
        "open_access": bool(m.get("open_access")),
        "stance": (claim.get("stance") or "neutral"),
        "relevance": claim.get("relevance") or "medium",
        "evidence_strength": claim.get("evidence_strength") or "moderate",
        "evidence_strength_reason": claim.get("evidence_strength_reason") or "",
        "confidence": claim.get("confidence"),
        "one_line_claim": claim.get("one_line_claim") or "",
    }


def _seed_paper_payload(paper: dict) -> dict:
    """Seed-room papers live only in Debate Arena, not Mode 1 synthesis."""
    url = paper.get("url") or (f"https://doi.org/{paper['doi']}" if paper.get("doi") else "")
    return {
        "id": paper.get("id"),
        "source": paper.get("source") or "seed",
        "scope": paper.get("scope") or "seed",
        "title": paper.get("title") or "Untitled",
        "authors": paper.get("authors") or [],
        "year": paper.get("year"),
        "venue": paper.get("venue") or paper.get("organization") or "",
        "url": url,
        "doi": paper.get("doi") or "",
        "citation_count": paper.get("citation_count"),
        "open_access": bool(paper.get("open_access")),
        "stance": paper.get("stance") or "neutral",
        "relevance": paper.get("relevance") or "high",
        "evidence_strength": paper.get("evidence_strength") or "moderate",
        "evidence_strength_reason": paper.get("evidence_strength_reason") or "",
        "confidence": paper.get("confidence"),
        "one_line_claim": paper.get("one_line_claim") or "",
    }


def _weight(claim: dict) -> float:
    rank = STRENGTH_RANK.get((claim.get("evidence_strength") or "").lower(), 1)
    conf = claim.get("confidence")
    c = (conf / 100.0) if isinstance(conf, int) else 0.5
    return rank * c


def _rooms(
    claims: dict | None,
    shown: list[dict],
    claims_by_id: dict[str, dict],
    topic: str,
    category: str = "Your question",
) -> list[dict]:
    rooms = list((claims or {}).get("rooms") or [])
    if not rooms:
        for_ids = [
            m.get("id")
            for m in shown
            if (_claim_entry(claims_by_id, m.get("id")).get("stance") == "supports")
        ]
        against_ids = [
            m.get("id")
            for m in shown
            if (_claim_entry(claims_by_id, m.get("id")).get("stance") == "contradicts")
        ]
        short = (topic[:72] + "…") if len(topic) > 72 else topic
        rooms = [
            {
                "id": "main-question",
                "title": short,
                "question": topic,
                "for_ids": for_ids,
                "against_ids": against_ids,
            }
        ]
    out: list[dict] = []
    for room in rooms:
        r = dict(room)
        if (r.get("group") or "related") == "common":
            out.append(r)
            continue
        r.setdefault("group", "related")
        r.setdefault("source", "harvest")
        r.setdefault("category", category)
        r.setdefault("status", "ready")
        if not r.get("blurb"):
            r["blurb"] = RELATED_BLURBS.get(r.get("id") or "", r.get("question") or "")
        out.append(r)
    return out


def _merge_seed_rooms(rooms: list[dict], seed_rooms: list[dict]) -> list[dict]:
    seen = {r.get("id") for r in rooms}
    merged = list(rooms)
    for room in seed_rooms:
        rid = room.get("id")
        if not rid or rid in seen:
            continue
        r = dict(room)
        r.setdefault("group", "common")
        r.setdefault("source", "seed")
        merged.append(r)
        seen.add(rid)
    return merged


def _claim_lookup(claims_by_id: dict[str, dict], seed_papers: list[dict]) -> dict[str, dict]:
    lookup = dict(claims_by_id)
    for p in seed_papers:
        pid = p.get("id")
        if pid and pid not in lookup:
            lookup[pid] = p
    return lookup


def _room_is_coming_soon(room: dict) -> bool:
    if (room.get("status") or "") == "coming_soon":
        return True
    if room.get("source") == "seed" and not (room.get("for_ids") or room.get("against_ids")):
        return True
    return False


def _question_guide_html() -> str:
    return """
<div class="qg-wrap">
  <details class="qg-details">
    <summary class="qg-summary">How to ask a good research question</summary>
    <div class="qg-body">

      <div class="qg-examples">
        <div class="qg-ex-pair">
          <div class="qg-vague"><span class="qg-label">Vague</span>"AI world models"</div>
          <div class="qg-better"><span class="qg-label">Better</span>"Are Sora-class video models genuine world simulators, or just generative media?"</div>
        </div>
        <div class="qg-ex-pair">
          <div class="qg-vague"><span class="qg-label">Vague</span>"Intermittent fasting"</div>
          <div class="qg-better"><span class="qg-label">Better</span>"Is intermittent fasting safe for cardiovascular health long-term?"</div>
        </div>
      </div>

      <div class="qg-section-title">The standard framework — PICO</div>
      <div class="qg-pico-note">Borrowed from clinical/health systematic reviews, and useful well beyond medicine.</div>
      <div class="qg-pico">
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">P</div>
          <div class="qg-pico-word">Population</div>
          <div class="qg-pico-desc">The subject or domain in question</div>
          <div class="qg-pico-example">"Sora-class video models"</div>
        </div>
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">I</div>
          <div class="qg-pico-word">Intervention</div>
          <div class="qg-pico-desc">What's being examined or applied</div>
          <div class="qg-pico-example">"used as simulators for planning"</div>
        </div>
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">C</div>
          <div class="qg-pico-word">Comparison</div>
          <div class="qg-pico-desc">Optional — a contrasting condition</div>
          <div class="qg-pico-example">"vs. generative media only"</div>
        </div>
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">O</div>
          <div class="qg-pico-word">Outcome</div>
          <div class="qg-pico-desc">What would count as an answer</div>
          <div class="qg-pico-example">"do they function as genuine world models"</div>
        </div>
      </div>
      <div class="qg-pico-assembled">Put together: <b>"Are Sora-class video models (P) used as simulators for planning (I) genuine world models, or just generative media (C)?"</b></div>

      <div class="qg-section-title">Your question can take a few shapes</div>
      <div class="qg-types">
        <div class="qg-type">
          <div class="qg-type-name">Classification</div>
          <div class="qg-type-desc">Is X better understood as A or B? A real either/or in how the field frames it.</div>
        </div>
        <div class="qg-type">
          <div class="qg-type-name">Comparative / benchmarking</div>
          <div class="qg-type-desc">Does A outperform B at doing Y? A direct head-to-head on the same outcome.</div>
        </div>
        <div class="qg-type">
          <div class="qg-type-name">Causal</div>
          <div class="qg-type-desc">Does X actually cause Y? No opposing "B" needed — the tension is between studies that find an effect and those that don't.</div>
        </div>
        <div class="qg-type">
          <div class="qg-type-name">Descriptive / state-of-evidence</div>
          <div class="qg-type-desc">What does the current evidence say about X? Open-ended, no adversarial pole required.</div>
        </div>
        <div class="qg-type">
          <div class="qg-type-name">Prevalence / scope</div>
          <div class="qg-type-desc">How common or significant is X? Also doesn't need a "vs." — just a clear thing to measure.</div>
        </div>
      </div>

      <div class="qg-footer">
        Whichever shape you use, the tool sorts evidence into <b>supporting</b> and <b>contradicting</b> based on what your question is actually asking — it doesn't require "A vs. B" phrasing.
      </div>

    </div>
  </details>
</div>
"""


def _explainer_html(kind: str, summary: str, body: str) -> str:
    return f"""
<aside class="mode-explainer mode-explainer-static" data-explainer="{_esc(kind)}">
  <p class="explainer-title">{_esc(summary)}</p>
  <p>{body}</p>
</aside>
"""


def _room_tile(room: dict, lookup: dict[str, dict]) -> str:
    for_ids = room.get("for_ids") or []
    against_ids = room.get("against_ids") or []
    coming = _room_is_coming_soon(room)
    for_w = sum(_weight(lookup.get(i) or {}) for i in for_ids)
    against_w = sum(_weight(lookup.get(i) or {}) for i in against_ids)
    tot = for_w + against_w
    heat = 0.0 if tot <= 0 else 1.0 - abs(for_w - against_w) / tot
    if coming:
        heat_label = "Coming soon"
        heat_class = "heat-soon"
        stat = "Evidence cards coming soon"
        enter = "Preview room →"
    else:
        heat_label = "Hottest" if heat >= 0.72 else ("Contested" if heat >= 0.4 else "Lopsided")
        heat_class = f"heat-{int(heat * 10)}"
        stat = f"supports: {len(for_ids)} cards / contradicts: {len(against_ids)} cards"
        enter = "Enter room →"
    seed_mark = (
        '<span class="room-source">Starter topic</span>' if room.get("source") == "seed" else ""
    )
    cat = room.get("category") or ""
    blurb = room.get("blurb") or room.get("question") or ""
    soon_cls = " is-soon" if coming else ""
    return f"""
<button type="button" class="room-tile {heat_class}{soon_cls}" data-enter-room="{_esc(room.get('id'))}">
  <span class="room-tile-meta">
    <span class="room-heat">{_esc(heat_label)}</span>
    {seed_mark}
  </span>
  <span class="room-cat">{_esc(cat)}</span>
  <strong>{_esc(room.get('title'))}</strong>
  <span class="room-q">{_esc(blurb)}</span>
  <span class="room-stat">{_esc(stat)}</span>
  <span class="room-enter">{_esc(enter)}</span>
</button>"""


def _lobby_section(
    title: str,
    lede: str,
    rooms: list[dict],
    lookup: dict[str, dict],
    group_by_category: bool,
) -> str:
    if not rooms:
        return ""
    head = f"""
  <div class="lobby-head">
    <h3 class="lobby-h">{_esc(title)}</h3>
  </div>
  <p class="lobby-lede">{lede}</p>"""
    if not group_by_category:
        tiles = "".join(_room_tile(r, lookup) for r in rooms)
        return f"""
<section class="lobby-section">
  {head}
  <div class="room-grid">{tiles}</div>
</section>"""
    blocks = []
    order: list[str] = []
    buckets: dict[str, list[dict]] = {}
    for room in rooms:
        cat = room.get("category") or "Other"
        if cat not in buckets:
            buckets[cat] = []
            order.append(cat)
        buckets[cat].append(room)
    for cat in order:
        tiles = "".join(_room_tile(r, lookup) for r in buckets[cat])
        blocks.append(
            f"""
<div class="lobby-cat">
  <h4 class="lobby-cat-h">{_esc(cat)}</h4>
  <div class="room-grid">{tiles}</div>
</div>"""
        )
    return f"""
<section class="lobby-section">
  {head}
  {''.join(blocks)}
</section>"""


def _lobby_html(rooms: list[dict], lookup: dict[str, dict]) -> str:
    related = [r for r in rooms if (r.get("group") or "related") != "common"]
    common = [r for r in rooms if (r.get("group") or "") == "common"]
    explainer = _explainer_html(
        "debate",
        "How this view works",
        "This view uses <strong>argument mapping</strong> — also called dialectical reasoning. "
        "It lays out the strongest case <em>for</em> and <em>against</em> a claim side by side, "
        "instead of forcing those arguments to converge on one answer. Some questions are "
        "genuinely contested rather than settled; the point is to see the tension clearly, not to declare a winner.",
    )
    return f"""
<div id="debate-lobby" class="debate-lobby">
  <p class="arena-eyebrow">Pick a room</p>
  <h2>Debate Arena</h2>
  {explainer}
  {_lobby_section(
      "Related to your question",
      "Contested sub-questions inside the same field as the research question in Evidence Synthesis. Same paper set, split into rooms.",
      related,
      lookup,
      False,
  )}
  {_lobby_section(
      "Vexed Questions",
      "Curated everyday claims people take strong stances on, even when the evidence is unsettled. These are <strong>not</strong> about your research question; they are starter examples of contested public beliefs.",
      common,
      lookup,
      True,
  )}
</div>
<div id="debate-room" class="debate-room" hidden></div>
"""


def generate(harvest: dict, enrichment: dict, claims: dict | None = None) -> str:
    request = harvest.get("request") or enrichment.get("request") or {}
    materials = list(harvest.get("materials") or [])
    enr_map = _by_id(enrichment)
    claims_by_id = _claims_map(claims)

    # Optional web/industry materials appended only in enrichment
    for extra in enrichment.get("web_materials") or []:
        if not isinstance(extra, dict) or not extra.get("id"):
            continue
        if any(m.get("id") == extra["id"] for m in materials):
            continue
        materials.append(extra)

    shown: list[dict] = []
    if claims_by_id:
        for m in materials:
            c = _claim_entry(claims_by_id, m.get("id"))
            if c and not _is_off_topic(c):
                shown.append(m)
    dropped = len(materials) - len(shown) if claims_by_id else 0
    has_claims = bool(claims_by_id)

    years = [m.get("year") for m in shown if m.get("year")] or [m.get("year") for m in materials if m.get("year")]
    year_span = f"{min(years)}–{max(years)}" if years else "—"
    oa_n = sum(1 for m in shown if m.get("open_access"))
    oa_pct = int(round(100 * oa_n / len(shown))) if shown else 0

    topic = request.get("topic") or "Research topic"
    gaps = enrichment.get("coverage_gaps") or []
    next_q = enrichment.get("suggested_next_queries") or []

    if has_claims:
        materials_html = _stance_sections_html(shown, claims_by_id, enr_map, next_q)
        verdict_html = _verdict_html(shown, claims_by_id, dropped)
    else:
        materials_html = (
            "<p>No claims.json yet — run <code>scripts/classify-claims.py</code> before generating.</p>"
        )
        verdict_html = ""

    classification_html = _render_classification(enrichment)
    question_guide_html = _question_guide_html()
    synthesis_explainer = _explainer_html(
        "synthesis",
        "Systematic review methodology",
        "This view follows a <strong>systematic review</strong> process: frame a research question, "
        "search the literature, screen sources in or out, classify each paper by its epistemic role "
        "(supporting, contradicting, test conditions, or background), and record what the scan still misses. "
        "The aim is a map of the evidence, not a single narrative.",
    )

    gaps_html = (
        "<ul>" + "".join(f"<li>{_esc(g)}</li>" for g in gaps) + "</ul>" if gaps else "<p>None noted.</p>"
    )
    next_html = (
        "<ul>" + "".join(f"<li>{_esc(q)}</li>" for q in next_q) + "</ul>" if next_q else "<p>None noted.</p>"
    )

    ordered_for_bib = _sort_by_strength(shown, claims_by_id) if has_claims else _sort_materials(shown, enr_map)
    bib = "\n\n".join(_to_bibtex(m) for m in ordered_for_bib)
    generated = datetime.now().strftime("%Y-%m-%d")

    filters = []
    if request.get("discipline"):
        filters.append(f"Field: {request['discipline']}")
    if request.get("year_from") or request.get("year_to"):
        filters.append(f"Years: {request.get('year_from')}–{request.get('year_to')}")

    chips = "".join(f'<span class="chip"><strong>{_esc(c)}</strong></span>' for c in filters)

    guide_rows = "".join(
        f"<tr><th scope=\"row\">{_esc(title)}</th><td>{_esc(blurb)}</td></tr>"
        for _, title, blurb in STANCE_SECTIONS
    )
    guide_table = f"""
<section class="guide panel" aria-label="What each section means">
  <h2>What each section means</h2>
  <table class="guide-table">
    <thead>
      <tr><th scope="col">Section</th><th scope="col">Meaning</th></tr>
    </thead>
    <tbody>
      {guide_rows}
    </tbody>
  </table>
</section>
"""

    discipline = (request.get("discipline") or "").strip()
    related_category = discipline.split("/")[0].strip() if discipline else "Your question"
    seed = _load_seed_debates()
    rooms = _merge_seed_rooms(
        _rooms(claims, shown, claims_by_id, topic, related_category),
        seed.get("rooms") or [],
    )
    lookup = _claim_lookup(claims_by_id, seed.get("papers") or [])
    lobby_html = _lobby_html(rooms, lookup)
    papers = [_paper_payload(m, _claim_entry(claims_by_id, m.get("id"))) for m in shown]
    seen_paper_ids = {p.get("id") for p in papers}
    for sp in seed.get("papers") or []:
        if sp.get("id") not in seen_paper_ids:
            papers.append(_seed_paper_payload(sp))
            seen_paper_ids.add(sp.get("id"))
    payload = {
        "topic": topic,
        "prior": (claims or {}).get("prior", 0.5),
        "papers": papers,
        "rooms": rooms,
        "gaps": gaps,
        "next_queries": next_q,
    }
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    css = _load_css()
    js = _load_js()
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_esc(topic)} — Research Dossier</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;650;700&family=Source+Sans+3:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
{css}
  </style>
  <script>
  window.dossierSetMode = function (mode) {{
    document.body.setAttribute("data-mode", mode);
    document.querySelectorAll(".mode-tab").forEach(function (btn) {{
      var on = btn.getAttribute("data-mode") === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    }});
    document.querySelectorAll(".mode-panel").forEach(function (panel) {{
      panel.hidden = panel.getAttribute("data-mode") !== mode;
    }});
  }};
  </script>
</head>
<body data-mode="synthesis">
  <div class="shell">
    <div class="topbar">
      <div class="brand">
        <span class="brand-mark">Pineapple 71717</span>
        <span class="brand-sub">Research Materials Dossier</span>
      </div>
      <nav class="mode-switcher" role="tablist" aria-label="Dossier modes">
        <button type="button" class="mode-tab is-active" role="tab" aria-selected="true" data-mode="synthesis" onclick="window.dossierSetMode &amp;&amp; window.dossierSetMode('synthesis')">Evidence Synthesis</button>
        <button type="button" class="mode-tab" role="tab" aria-selected="false" data-mode="debate" onclick="window.dossierSetMode &amp;&amp; window.dossierSetMode('debate')">Debate Arena</button>
      </nav>
    </div>

    <header class="hero">
      <h1>{_esc(topic)}</h1>
      <div class="meta-row">{chips}<span class="chip">Generated <strong>{_esc(generated)}</strong></span></div>
      <div class="stats">
        <div class="stat"><div class="n">{len(shown)}</div><div class="l">In scope</div></div>
        <div class="stat"><div class="n">{dropped}</div><div class="l">Off-topic dropped</div></div>
        <div class="stat"><div class="n">{_esc(year_span)}</div><div class="l">Year span</div></div>
        <div class="stat"><div class="n">{oa_pct}%</div><div class="l">Open access</div></div>
      </div>
    </header>

    <div class="mode-panel" data-mode="synthesis">
    {synthesis_explainer}
    {question_guide_html}
    {classification_html}

    {guide_table}

    <div class="layout">
      <main>
        {materials_html}
        {verdict_html}
      </main>
      <aside>
        <section class="panel" id="open-questions">
          <h2>What's missing from this list</h2>
          {gaps_html}
        </section>
        <section class="panel">
          <h2>BibTeX</h2>
          <pre class="bibtex">{_esc(bib)}</pre>
        </section>
      </aside>
    </div>
    </div>

    <div class="mode-panel" data-mode="debate" hidden>
      {lobby_html}
    </div>
  </div>
  <script type="application/json" id="dossier-data">{payload_json}</script>
  <script>
{js}
  </script>
</body>
</html>
"""


def main() -> int:
    raw = sys.argv[1:]
    no_open = "--no-open" in raw
    claims_path: Path | None = None
    args: list[str] = []
    i = 0
    while i < len(raw):
        tok = raw[i]
        if tok == "--no-open":
            i += 1
            continue
        if tok == "--claims" and i + 1 < len(raw):
            claims_path = Path(raw[i + 1])
            i += 2
            continue
        args.append(tok)
        i += 1
    if len(args) < 3:
        print(
            "Usage: python scripts/generate-dossier.py <harvest.json> <enrichment.json> <output.html> "
            "[--claims claims.json] [--no-open]",
            file=sys.stderr,
        )
        return 2

    harvest_path = Path(args[0])
    enrichment_path = Path(args[1])
    output_path = Path(args[2])
    if claims_path is None:
        candidate = harvest_path.parent / "claims.json"
        if candidate.is_file():
            claims_path = candidate

    harvest = json.loads(harvest_path.read_text(encoding="utf-8"))
    enrichment = json.loads(enrichment_path.read_text(encoding="utf-8"))
    claims = json.loads(claims_path.read_text(encoding="utf-8")) if claims_path and claims_path.is_file() else {}
    html_doc = generate(harvest, enrichment, claims)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_doc, encoding="utf-8")
    print(f"wrote {output_path.resolve()}")
    if not no_open:
        _open_html(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
