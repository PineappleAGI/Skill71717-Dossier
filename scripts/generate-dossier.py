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
import base64
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
MODE1_JS_PATH = SKILL_ROOT / "scripts" / "mode1-flow.js"
MODE1_BLOG_JS_PATH = SKILL_ROOT / "scripts" / "mode1-blog.js"
BLOG_HERO_PATH = SKILL_ROOT / "assets" / "blog-hero-proteins.jpg"


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


def _first_sentences(text: str, max_chars: int) -> str:
    t = re.sub(r"\s+", " ", text or "").strip()
    if not t:
        return ""
    if len(t) <= max_chars:
        return t
    cut = t[:max_chars]
    m = re.match(r"^(.*?[.!?])(\s|$)", cut)
    if m and len(m.group(1)) > 70:
        return m.group(1)
    return re.sub(r"\s+\S*$", "", cut) + "…"


_ABSTRACT_HEADINGS = re.compile(
    r"(?:^|[.!?\s])(background|introduction|objective|objectives|aim|aims|purpose|purposes|"
    r"methods?|materials and methods|results?|findings?|conclusions?|discussion)\s*[:.\u2014\u2013-]\s+",
    re.I,
)
_AIM_PATTERNS = (
    re.compile(
        r"\b(?:the\s+)?(?:aim|aims|objective|objectives|purpose)\s+"
        r"(?:of\s+(?:the|this)\s+(?:study|review|paper|work)\s+)?"
        r"(?:was|were|is|are)\s+to\s+[^.?]{12,240}[.?]?",
        re.I,
    ),
    re.compile(r"\bwe\s+(?:aimed|sought|intended)\s+to\s+[^.?]{12,240}[.?]?", re.I),
    re.compile(
        r"\bthis\s+(?:study|review|paper)\s+(?:aimed|aims|sought)\s+to\s+[^.?]{12,240}[.?]?",
        re.I,
    ),
)


def _parse_abstract_sections(text: str) -> tuple[str, str]:
    raw = re.sub(r"\s+", " ", text or "").strip()
    background = ""
    objective = ""
    if not raw:
        return background, objective
    hits = list(_ABSTRACT_HEADINGS.finditer(raw))

    def kind(label: str) -> str:
        lab = label.lower()
        if lab in ("background", "introduction"):
            return "background"
        if lab in ("objective", "objectives", "aim", "aims", "purpose", "purposes"):
            return "objective"
        return ""

    for i, hit in enumerate(hits):
        key = kind(hit.group(1))
        if not key:
            continue
        start = hit.end()
        end = hits[i + 1].start() if i + 1 < len(hits) else len(raw)
        chunk = raw[start:end].strip()
        if key == "background" and not background:
            background = chunk
        if key == "objective" and not objective:
            objective = chunk
    if not objective:
        for pat in _AIM_PATTERNS:
            found = pat.search(raw)
            if found:
                objective = found.group(0)
                break
    if not background:
        lead = _first_sentences(raw, 240)
        if lead and (not objective or objective[:36] not in lead):
            background = lead
    return _first_sentences(background, 280), _first_sentences(objective, 220)


def _aim_html(abstract: str) -> str:
    background, objective = _parse_abstract_sections(abstract)
    bg = background or "Not specified in abstract"
    obj = objective or "Not specified in abstract"
    return (
        '<dl class="m1-pico m1-aim">'
        f"<div><dt>Background</dt><dd>{_esc(bg)}</dd></div>"
        f"<div><dt>Objective</dt><dd>{_esc(obj)}</dd></div>"
        "</dl>"
    )


def _esc(s: object) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def _example_chip(text: str, target: str = "#m1-question") -> str:
    """Clickable, selectable example — never a placeholder attribute."""
    return (
        f'<button type="button" class="m1-ex-chip" data-fill="{_esc(target)}" '
        f'data-insert="{_esc(text)}">{_esc(text)}</button>'
    )


def _inspire_card(question: str, note: str = "") -> str:
    note_html = f'<p class="m1-inspire-note">{_esc(note)}</p>' if note else ""
    return (
        f'<button type="button" class="m1-inspire-card" data-fill="#m1-question" '
        f'data-insert="{_esc(question)}" data-scroll-to="#m1-question">'
        f'<span class="m1-inspire-q">{_esc(question)}</span>{note_html}'
        f'<span class="m1-inspire-hint">Use as a starting point</span>'
        f"</button>"
    )


def _inspire_html() -> str:
    health = (
        _inspire_card(
            "How does drinking coffee after 2:00 PM change the number of hours I stay asleep?",
            "Can be tracked with a notebook or wearable",
        )
        + _inspire_card(
            "Does reducing phone use in the evening improve my morning focus and mood?"
        )
        + _inspire_card(
            "How does adding a short ten-minute walk after meals affect my daily energy levels?"
        )
    )
    home = (
        _inspire_card(
            "Which home appliance uses the most power during the month?",
            "Can be tested with a portable power meter",
        )
        + _inspire_card(
            "Does opening windows for ten minutes each morning change how dusty or stuffy my rooms feel?"
        )
        + _inspire_card(
            "What specific grocery items do I throw away the most each week, and how can I buy less of them?"
        )
    )
    community = (
        _inspire_card(
            "What kinds of birds or insects live in my local park during different seasons?",
            "Can be logged using iNaturalist",
        )
        + _inspire_card(
            "At what exact times of day is traffic loudest on my street, and does it match local rush hours?"
        )
        + _inspire_card(
            "Who lived in my house or neighborhood fifty years ago, and how has the street changed?",
            "Can be researched via regional public library archives",
        )
    )
    big = (
        _inspire_card("Why is there a housing crisis in the Netherlands?")
        + _inspire_card("Does the US or the UK have a better healthcare system?")
    )
    return f"""
<div class="m1-inspire">
  <button type="button" class="m1-inspire-toggle" id="m1-inspire-toggle" aria-expanded="false" aria-controls="m1-inspire-panel">
    Not sure what to ask? Browse ideas
  </button>
  <div class="m1-inspire-panel" id="m1-inspire-panel" hidden>
    <p class="m1-inspire-lede">Wander a bit. Pick a card, then rewrite it into the question that’s actually yours.</p>
    <div class="m1-inspire-tabs" role="tablist" aria-label="Idea categories">
      <button type="button" class="m1-inspire-tab" role="tab" id="m1-tab-health" data-cat="health" aria-selected="true" aria-controls="m1-pane-health">Health &amp; Daily Habits</button>
      <button type="button" class="m1-inspire-tab" role="tab" id="m1-tab-home" data-cat="home" aria-selected="false" aria-controls="m1-pane-home">Home &amp; Energy</button>
      <button type="button" class="m1-inspire-tab" role="tab" id="m1-tab-community" data-cat="community" aria-selected="false" aria-controls="m1-pane-community">Community &amp; Nature</button>
      <button type="button" class="m1-inspire-tab" role="tab" id="m1-tab-big" data-cat="big" aria-selected="false" aria-controls="m1-pane-big">Big Questions</button>
    </div>
    <div class="m1-inspire-panes">
      <div class="m1-inspire-pane" id="m1-pane-health" data-cat="health" role="tabpanel" aria-labelledby="m1-tab-health">
        <div class="m1-inspire-track">{health}</div>
      </div>
      <div class="m1-inspire-pane" id="m1-pane-home" data-cat="home" role="tabpanel" aria-labelledby="m1-tab-home" hidden>
        <div class="m1-inspire-track">{home}</div>
      </div>
      <div class="m1-inspire-pane" id="m1-pane-community" data-cat="community" role="tabpanel" aria-labelledby="m1-tab-community" hidden>
        <div class="m1-inspire-track">{community}</div>
      </div>
      <div class="m1-inspire-pane" id="m1-pane-big" data-cat="big" role="tabpanel" aria-labelledby="m1-tab-big" hidden>
        <div class="m1-inspire-track">{big}</div>
      </div>
    </div>
  </div>
</div>
"""


def _load_css() -> str:
    return CSS_PATH.read_text(encoding="utf-8") if CSS_PATH.is_file() else ""


def _blog_hero_js() -> str:
    if not BLOG_HERO_PATH.is_file():
        return ""
    raw = BLOG_HERO_PATH.read_bytes()
    b64 = base64.b64encode(raw).decode("ascii")
    return (
        "window.M1_BLOG_HERO = 'data:image/jpeg;base64," + b64 + "';\n"
        "window.M1_BLOG_HERO_W = 1100;\n"
        "window.M1_BLOG_HERO_H = 733;\n"
    )


def _load_js() -> str:
    parts: list[str] = [_blog_hero_js()]
    for path in (UI_JS_PATH, MODE1_JS_PATH, MODE1_BLOG_JS_PATH):
        if path.is_file():
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(p for p in parts if p)


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
  {_aim_html(m.get("abstract") or "")}
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
    background, objective = _parse_abstract_sections(m.get("abstract") or "")
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
        "abstract": m.get("abstract") or "",
        "stance": (claim.get("stance") or "neutral"),
        "relevance": claim.get("relevance") or "medium",
        "evidence_strength": claim.get("evidence_strength") or "moderate",
        "evidence_strength_reason": claim.get("evidence_strength_reason") or "",
        "confidence": claim.get("confidence"),
        "one_line_claim": claim.get("one_line_claim") or "",
        "background": background,
        "objective": objective,
    }


def _seed_paper_payload(paper: dict) -> dict:
    """Seed-room papers live only in Debate Arena, not Mode 1 synthesis."""
    url = paper.get("url") or (f"https://doi.org/{paper['doi']}" if paper.get("doi") else "")
    abstract = paper.get("abstract") or ""
    background, objective = _parse_abstract_sections(abstract)
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
        "abstract": abstract,
        "background": background,
        "objective": objective,
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
    sora = "Are Sora-class video models genuine world simulators, or just generative media?"
    fasting = "Is intermittent fasting safe for cardiovascular health long-term?"
    sora_pico = (
        "Are Sora-class video models (P) used as simulators for planning (I) "
        "genuine world models, or just generative media (C)?"
    )
    return f"""
<div class="qg-wrap">
  <details class="qg-details">
    <summary class="qg-summary">How to ask a good research question</summary>
    <div class="qg-body">

      <div class="qg-examples">
        <div class="qg-ex-pair">
          <div class="qg-vague"><span class="qg-label">Vague</span><span class="qg-copy">AI world models</span></div>
          <div class="qg-better"><span class="qg-label">Better</span>{_example_chip(sora)}</div>
        </div>
        <div class="qg-ex-pair">
          <div class="qg-vague"><span class="qg-label">Vague</span><span class="qg-copy">Intermittent fasting</span></div>
          <div class="qg-better"><span class="qg-label">Better</span>{_example_chip(fasting)}</div>
        </div>
      </div>

      <div class="qg-section-title">The standard framework — PICO</div>
      <div class="qg-pico-note">Borrowed from clinical/health systematic reviews, and useful well beyond medicine. Click an example to use it.</div>
      <div class="qg-pico">
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">P</div>
          <div class="qg-pico-word">Population</div>
          <div class="qg-pico-desc">The subject or domain in question</div>
          {_example_chip("Sora-class video models")}
        </div>
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">I</div>
          <div class="qg-pico-word">Intervention</div>
          <div class="qg-pico-desc">What's being examined or applied</div>
          {_example_chip("used as simulators for planning")}
        </div>
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">C</div>
          <div class="qg-pico-word">Comparison</div>
          <div class="qg-pico-desc">Optional — a contrasting condition</div>
          {_example_chip("vs. generative media only")}
        </div>
        <div class="qg-pico-cell">
          <div class="qg-pico-letter">O</div>
          <div class="qg-pico-word">Outcome</div>
          <div class="qg-pico-desc">What would count as an answer</div>
          {_example_chip("do they function as genuine world models")}
        </div>
      </div>
      <div class="qg-pico-assembled">Put together: {_example_chip(sora_pico)}</div>

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


def _question_hero_inner(topic: str, original_topic: str) -> str:
    """Hero question block shared by Evidence Synthesis and Debate Arena."""
    topic = (topic or "").strip()
    original = (original_topic or "").strip()
    if original and original != topic:
        return (
            '<p class="hero-typed">'
            '<span class="hero-kicker">You typed</span>'
            f"{_esc(original)}</p>"
            '<p class="hero-kicker hero-kicker-interpreted">Interpreted as</p>'
            f"<h1>{_esc(topic)}</h1>"
        )
    return f"<h1>{_esc(topic)}</h1>"


def _mode1_html(
    question_guide: str,
    topic: str = "",
    situation: str = "",
    original_topic: str = "",
) -> str:
    topic = (topic or "").strip()
    situation = (situation or "").strip()
    inspire = _inspire_html()
    sit_chips = (
        '<div class="m1-ex-chips" role="list" aria-label="Example situations">'
        + _example_chip("a parent with type 2 diabetes", "#m1-situation")
        + "</div>"
    )
    return """
<div id="m1-root" class="m1-root">
  <div id="m1-stepper-sentinel"></div>
  <div id="m1-stepper" class="m1-stepper">
    <div class="m1-stepper-head">
      <p class="m1-prisma">This follows PRISMA — the standard systematic-review methodology researchers use to answer questions from evidence, not opinion.</p>
      <button type="button" class="btn m1-new-q" id="m1-new-question">Ask a new question</button>
    </div>
    <ol id="m1-steps" class="m1-steps"></ol>
    <p class="m1-sticky-tip"></p>
    <div class="m1-search-live" id="m1-search-live" hidden>
      <span class="m1-spinner" aria-hidden="true"></span>
      <div class="m1-search-live-copy">
        <p class="m1-search-live-title">Working — querying live databases. This is not frozen.</p>
        <p class="m1-search-live-msg" id="m1-status" aria-live="polite"></p>
      </div>
      <p class="m1-search-live-time" id="m1-search-elapsed"></p>
    </div>
  </div>

  <section class="m1-section" data-m1-section="1" id="m1-intake-sec">
    <h2>Question intake</h2>
    <form id="m1-intake">
      <label class="m1-label" for="m1-question">What do you want to find out?</label>
      <textarea id="m1-question" name="question" rows="3" required>""" + _esc(topic) + """</textarea>
""" + question_guide + """
      <label class="m1-label" for="m1-situation">Is this about a specific situation? <span class="m1-hint">(optional — a condition, medication, or context that changes what’s relevant)</span></label>
      <input id="m1-situation" name="situation" type="text" value=\"""" + _esc(situation) + """\" />
      """ + sit_chips + """
      <div class="m1-actions">
        <button type="submit" class="btn btn-primary">Continue</button>
      </div>
    </form>
    """ + inspire + """
  </section>

  <section class="m1-section" data-m1-section="2" id="m1-understand" hidden>
    <h2>What I understood</h2>
    <div id="m1-understand-body"></div>
  </section>

  <section class="m1-section" data-m1-section="3" id="m1-screen" hidden>
    <h2>Search &amp; rank</h2>
    <div id="m1-screen-body"></div>
  </section>

  <section class="m1-section" data-m1-section="4" id="m1-extract" hidden>
    <h2>Extracted evidence</h2>
    <div id="m1-extract-body"></div>
  </section>

  <section class="m1-section" data-m1-section="5" id="m1-synth" hidden>
    <h2>Weigh the evidence</h2>
    <div id="m1-synth-body"></div>
  </section>

  <section class="m1-section" data-m1-section="6" id="m1-verdict" hidden>
    <h2>The briefing</h2>
    <div id="m1-verdict-body"></div>
  </section>
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
    else:
        for m in materials:
            en = enr_map.get(m.get("id")) or {}
            score = en.get("relevance_score")
            if isinstance(score, int) and score < 50:
                continue
            shown.append(m)
    dropped = len(materials) - len(shown)
    has_claims = bool(claims_by_id)

    years = [m.get("year") for m in shown if m.get("year")] or [m.get("year") for m in materials if m.get("year")]
    year_span = f"{min(years)}–{max(years)}" if years else "—"
    oa_n = sum(1 for m in shown if m.get("open_access"))
    oa_pct = int(round(100 * oa_n / len(shown))) if shown else 0

    topic = request.get("topic") or "Research topic"
    original_topic = (request.get("original_topic") or "").strip()
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
    mode1_html = _mode1_html(
        question_guide_html,
        topic,
        str(request.get("discipline") or ""),
        original_topic,
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
        "original_topic": original_topic,
        "discipline": request.get("discipline") or "",
        "prior": (claims or {}).get("prior", 0.5),
        "papers": papers,
        "rooms": rooms,
        "gaps": gaps,
        "next_queries": next_q,
    }
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")
    question_hero = _question_hero_inner(topic, original_topic)

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
      {question_hero}
      <div class="meta-row">{chips}<span class="chip">Generated <strong>{_esc(generated)}</strong></span></div>
      <div class="stats">
        <div class="stat"><div class="n">{len(shown)}</div><div class="l">In scope</div></div>
        <div class="stat"><div class="n">{dropped}</div><div class="l">Off-topic dropped</div></div>
        <div class="stat"><div class="n">{_esc(year_span)}</div><div class="l">Year span</div></div>
        <div class="stat"><div class="n">{oa_pct}%</div><div class="l">Open access</div></div>
      </div>
    </header>

    <div class="mode-panel" data-mode="synthesis">
    {classification_html}
    {mode1_html}
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
