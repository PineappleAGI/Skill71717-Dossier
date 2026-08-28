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
REPO_URL = "https://github.com/PineappleAGI/Skill71717-Dossier"

# Epistemic role toward the research question (primary dossier sections).
# Blurbs are overridden from request.stance_definitions when present.
STANCE_SECTIONS = [
    (
        "supports",
        "Evidence supporting",
        "Papers whose findings or arguments back the research question as framed.",
    ),
    (
        "contradicts",
        "Evidence contradicting / limiting",
        "Papers whose findings or arguments cut against the research question as framed.",
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
MODE1_JS_PATH = SKILL_ROOT / "scripts" / "mode1-flow.js"
MODE1_BLOG_JS_PATH = SKILL_ROOT / "scripts" / "mode1-blog.js"
FOCUS_JS_PATH = SKILL_ROOT / "scripts" / "desktop-focus.js"
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


def _desktop_focus_js() -> str:
    return FOCUS_JS_PATH.read_text(encoding="utf-8") if FOCUS_JS_PATH.is_file() else ""


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
    parts: list[str] = []
    for path in (MODE1_JS_PATH, MODE1_BLOG_JS_PATH):
        if path.is_file():
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(p for p in parts if p)


def _article_title(material: dict) -> str:
    title = re.sub(r"\s+", " ", (material.get("title") or "Untitled").strip())
    title = re.sub(r"<[^>]+>", "", title)
    if len(title) > 72:
        title = title[:69] + "…"
    return title


def _article_cite(material: dict) -> str:
    title = _article_title(material)
    year = material.get("year")
    return f"{title} ({year})" if year else title


def _pick_beats(
    shown: list[dict],
    claims_by_id: dict[str, dict],
    stance: str,
    limit: int = 2,
) -> list[tuple[dict, dict]]:
    ranked: list[tuple[int, dict, dict]] = []
    for material in shown:
        claim = _claim_entry(claims_by_id, material.get("id"))
        if (claim.get("stance") or "").strip().lower() != stance:
            continue
        if not (claim.get("one_line_claim") or "").strip():
            continue
        rel = (claim.get("relevance") or "").strip().lower()
        rank = 3 if rel == "high" else 2 if rel == "medium" else 1
        rank = rank * 100 + int(claim.get("confidence") or 0)
        ranked.append((rank, material, claim))
    ranked.sort(key=lambda item: item[0], reverse=True)
    return [(material, claim) for _rank, material, claim in ranked[:limit]]


def _as_article_sentence(line: str) -> str:
    line = (line or "").strip().rstrip(".")
    if not line:
        return ""
    match = re.match(
        r"^(shows|compares|surveys|reviews|argues|asks|describes|evaluates|puts|runs|gives|treats)\s+(.+)$",
        line,
        flags=re.I,
    )
    if match:
        return f"It {match.group(1).lower()} {match.group(2)}."
    return line + "."


def _weave_beats(items: list[tuple[dict, dict]], opener: str) -> str:
    sentences: list[str] = [opener]
    hooks = ("Look at", "Then jump to")
    for i, (material, claim) in enumerate(items):
        line = (claim.get("one_line_claim") or "").strip()
        if not line:
            continue
        hook = hooks[i] if i < len(hooks) else "And"
        sentences.append(f"{hook} {_article_cite(material)}. {_as_article_sentence(line)}")
    return " ".join(sentences)


def _share_summary(
    topic: str,
    original_topic: str,
    shown: list[dict],
    claims_by_id: dict[str, dict],
    enrichment: dict,
    dropped: int,
) -> dict:
    """Magazine-style article: everyday question, scientific question, pro, con, gaps."""
    asked = (original_topic or "").strip()
    interpreted = (topic or "").strip()

    def _pretty_q(q: str) -> str:
        q = re.sub(r"\bchatgpt\b", "ChatGPT", q, flags=re.I)
        q = re.sub(r"\bclaude\b", "Claude", q, flags=re.I)
        q = q.strip()
        if q and not q.endswith("?"):
            q += "?"
        if q:
            q = q[0].upper() + q[1:]
        return q

    headline = _pretty_q(asked) or interpreted or "A short article"

    paras: list[str] = []
    asked_key = asked.rstrip("?").lower()
    interpreted_key = interpreted.rstrip("?").lower()
    q_asked = _pretty_q(asked)
    if asked and interpreted and asked_key != interpreted_key:
        paras.append(
            f"Here it is, the question everyone actually types: {q_asked} "
            "Short. Punchy. The kind of thing you fire at a friend and then argue about over dinner. "
            f"Underneath that spark is a real scientific fight: {interpreted}"
        )
    else:
        q = interpreted or q_asked
        paras.append(
            f"Here is the question that kicked this whole thing off: {q} "
            "Everyday enough to ask out loud. Sharp enough that researchers will chase it."
        )

    counts = {"supports": 0, "contradicts": 0, "test_condition": 0, "neutral": 0}
    for material in shown:
        stance = (_claim_entry(claims_by_id, material.get("id")).get("stance") or "neutral").strip().lower()
        counts[stance if stance in counts else "neutral"] += 1

    n = len(shown)
    if n:
        lean = ""
        if counts["contradicts"] > counts["supports"] + 1:
            lean = " Plot twist: the papers that complicate a clean yes currently have the louder stack."
        elif counts["supports"] > counts["contradicts"] + 1:
            lean = " Early scoreboard: more of the closer papers lean yes — not a blowout, but a real lean."
        elif counts["supports"] or counts["contradicts"]:
            lean = " And it is a genuine scrap: the closer papers split, which is exactly why the question is fun."
        aside = f" (we threw out {dropped} that wandered off into the weeds)" if dropped else ""
        paras.append(
            f"Good news: {n} source{'s' if n != 1 else ''} actually speak to it{aside}.{lean}"
        )

    pro = _pick_beats(shown, claims_by_id, "supports")
    if pro:
        paras.append(_weave_beats(pro, "Want the yes case? Here is the fun part."))
    con = _pick_beats(shown, claims_by_id, "contradicts")
    if con:
        paras.append(_weave_beats(con, "Now the comeback — and it has energy."))
    methods = _pick_beats(shown, claims_by_id, "test_condition", limit=1)
    if methods and not pro and not con:
        paras.append(
            _weave_beats(methods, "The hunt is still on how to keep score, not who lifts the trophy.")
        )

    gaps = [str(g).strip().rstrip(".") for g in (enrichment.get("coverage_gaps") or []) if str(g).strip()]
    if gaps:
        gaps = [
            re.sub(r"\bin this scan\b", "here", re.sub(r"\bharvested\s+", "", g, flags=re.I), flags=re.I)
            for g in gaps
        ]
        first = gaps[0][0].lower() + gaps[0][1:] if gaps[0] and gaps[0][0].isupper() else gaps[0]
        extra = f" {gaps[1]}." if len(gaps) > 1 else ""
        paras.append(
            f"The cliffhanger is what nobody has nailed yet: {first}.{extra} "
            "That is not a dead end — it is the next dare. Go read the papers. Then pick a side, loudly, and stay curious."
        )
    else:
        paras.append(
            "This is the map. The papers are the adventure. Go read them — then pick a side and stay curious."
        )
    return {"headline": headline, "paras": paras}


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
    stance_blurbs: dict | None = None,
) -> str:
    by_stance: dict[str, list[dict]] = {k: [] for k, _, _ in STANCE_SECTIONS}
    for m in materials:
        stance = (_claim_entry(claims_by_id, m.get("id")).get("stance") or "neutral").strip().lower()
        if stance not in by_stance:
            stance = "neutral"
        by_stance[stance].append(m)

    overrides = stance_blurbs or {}
    parts: list[str] = []
    for stance_id, title, blurb in STANCE_SECTIONS:
        if isinstance(overrides.get(stance_id), str) and overrides[stance_id].strip():
            blurb = overrides[stance_id].strip()
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


TRACK_LABELS = {
    "key_reference": "Key references",
    "research": "research",
    "industry": "industry",
    "thesis": "theses",
    "preprint": "preprints",
}


def _tracks_label(request: dict) -> str:
    tracks = request.get("material_tracks") or []
    names = [TRACK_LABELS.get(str(t), str(t).replace("_", " ")) for t in tracks]
    return " · ".join(names)


def _chip(strong: str, label: str) -> str:
    return (
        f'<span class="chip"><strong>{_esc(strong)}</strong> {_esc(label)}</span>'
    )


def _restatement_html(topic: str, original_topic: str, request: dict, generated: str) -> str:
    topic = (topic or "").strip()
    original = (original_topic or "").strip()
    heading = f"<h1>{_esc(topic)}</h1>"
    if original and original != topic:
        question = (
            f'<p class="hero-typed"><span class="hero-kicker">You typed</span>{_esc(original)}</p>'
            f'<div class="hero-interpreted">'
            f'<p class="hero-kicker hero-kicker-interpreted">Interpreted as</p>'
            f"{heading}</div>"
        )
    else:
        question = f'<div class="hero-interpreted">{heading}</div>'

    chips: list[str] = []
    if request.get("discipline"):
        chips.append(_chip("Field", str(request["discipline"])))
    year_from = request.get("year_from")
    year_to = request.get("year_to")
    if year_from or year_to:
        chips.append(_chip("Years searched", f"{year_from or '—'}–{year_to or '—'}"))
    tracks = _tracks_label(request)
    if tracks:
        chips.append(_chip("Tracks", tracks))
    chips.append(_chip("Generated", generated))
    return f"""
<header class="hero" id="restatement" data-m1-section="1">
  {question}
  <div class="meta-row">{"".join(chips)}</div>
</header>
"""


def _simple_material_card(m: dict, enr: dict | None = None) -> str:
    enr = enr or {}
    url = m.get("url") or (f"https://doi.org/{m['doi']}" if m.get("doi") else "")
    title = m.get("title") or "Untitled"
    title_html = (
        f'<a href="{_esc(url)}" target="_blank" rel="noopener noreferrer">{_esc(title)}</a>'
        if url
        else _esc(title)
    )
    authors = ", ".join(m.get("authors") or []) or "Authors unavailable"
    year = m.get("year") or ""
    byline = _esc(authors) if not year else f"{_esc(authors)} · {_esc(year)}"
    desc = (
        (enr.get("short_description") or "").strip()
        or _first_sentences(m.get("abstract") or "", 280)
        or "No description harvested."
    )
    return f"""
<article class="material" data-id="{_esc(m.get('id'))}">
  <div class="material-head">
    <h3>{title_html}</h3>
  </div>
  <p class="byline">{byline}</p>
  <p class="claim">{_esc(desc)}</p>
</article>
"""


def _key_refs_html(materials: list[dict], enr_map: dict[str, dict]) -> str:
    keyed = [m for m in materials if (m.get("track") or "") == "key_reference"]
    pool = keyed or _sort_materials(materials, enr_map)[:7]
    if not pool:
        return '<p class="m1-empty">No key-reference track items in this harvest.</p>'
    extra = max(0, len(pool) - 2)
    cards = "\n".join(_simple_material_card(m, enr_map.get(m.get("id"))) for m in pool)
    more = (
        f'<div class="m1-list-meta">'
        f'<button type="button" class="btn m1-synth-more" data-expand="keyRef">Show {extra} more</button>'
        f'<span class="m1-list-count">Showing 2 of {len(pool)} papers</span>'
        f"</div>"
        if extra
        else f'<p class="m1-list-count">Showing {len(pool)} of {len(pool)} papers</p>'
    )
    return (
        f'<div class="m1-keyref-stack{" is-collapsed" if extra else ""}" data-col="keyRef">'
        f"{cards}</div>{more}"
    )


def _empty_track_html(shown: list[dict], request: dict) -> str:
    tracks = [str(t) for t in (request.get("material_tracks") or [])]
    if "thesis" not in tracks:
        return ""
    if any((m.get("track") or "") == "thesis" for m in shown):
        return ""
    return (
        '<p class="m1-empty"><strong>No thesis-track results</strong> '
        "Nothing in the dissertation queries matched this question. "
        "Broaden the year range or drop the track.</p>"
    )


def _footer_html() -> str:
    return f"""
<footer class="m1-site-footer">
  <div class="m1-site-footer-row">
    <p class="m1-site-footer-brand">Built by The Pineapple Project</p>
    <p class="m1-site-footer-copy">Fusing all minds like individual berries in a pineapple into an organic whole. At the speed of thought. Every project we vibe-code is serialized — this one is Pineapple 71717.</p>
    <a class="m1-site-footer-x" href="{_esc(REPO_URL)}" target="_blank" rel="noopener noreferrer">Pineapple 71717 on GitHub</a>
    <a class="m1-site-footer-x" href="https://x.com/AnanasCosmo" target="_blank" rel="noopener noreferrer">The Pineapple Project on X · @AnanasCosmo</a>
  </div>
</footer>
"""


def _jump_nav_html() -> str:
    return """
<nav class="m1-jump" aria-label="Jump to">
  <span class="m1-jump-kicker">Jump to</span>
  <a href="#evidence">The evidence</a>
  <span class="m1-jump-dot" aria-hidden="true">·</span>
  <a href="#confidence">How confident is this?</a>
  <span class="m1-jump-dot" aria-hidden="true">·</span>
  <a href="#related">Related papers</a>
  <span class="m1-jump-dot" aria-hidden="true">·</span>
  <a href="#briefing">What's missing</a>
  <span class="m1-jump-dot" aria-hidden="true">·</span>
  <a href="#concept-map">How this question maps</a>
</nav>
"""


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
    """Hero question block above the Mode 1 flow."""
    topic = (topic or "").strip()
    original = (original_topic or "").strip()
    heading = f"<h1>{_esc(topic)}</h1>"
    if original and original != topic:
        return (
            '<p class="hero-typed">'
            '<span class="hero-kicker">You typed</span>'
            f"{_esc(original)}</p>"
            '<p class="hero-kicker hero-kicker-interpreted">Interpreted as</p>'
            + heading
        )
    return heading


def _mode1_html(
    topic: str = "",
    situation: str = "",
    restatement_html: str = "",
    classification_html: str = "",
    briefing_main: str = "",
    briefing_side: str = "",
) -> str:
    topic = (topic or "").strip()
    situation = (situation or "").strip()
    return """
<div id="m1-root" class="m1-root">
  <textarea id="m1-question" name="question" hidden>""" + _esc(topic) + """</textarea>
  <input id="m1-situation" name="situation" type="hidden" value=\"""" + _esc(situation) + """\" />

  <div id="m1-stepper-sentinel"></div>
  <div id="m1-stepper-slot">
  <div id="m1-stepper" class="m1-stepper">
    <div class="m1-stepper-head">
      <p class="m1-prisma"><strong>Follows PRISMA</strong>, the reporting standard for systematic reviews</p>
      <a class="btn btn-primary m1-new-q" id="m1-new-q" href="/ask">Ask another question</a>
    </div>
    <ol id="m1-steps" class="m1-steps"></ol>
  </div>
  </div>

  """ + (restatement_html or "") + """

  <section class="m1-section m1-blog-lead" id="essay">
    <div class="m1-sec-head is-plain">
      <h2>The article</h2>
      <button type="button" class="m1-collapse-btn" data-collapse="essay">Hide</button>
    </div>
    <div id="m1-blog-sec" data-collapse-panel="essay">
      <div id="m1-blog-body"></div>
    </div>
  </section>

  """ + _jump_nav_html() + """

  <section class="m1-section" data-m1-section="2" id="evidence" hidden>
    <div class="m1-sec-head">
      <h2>The evidence</h2>
      <button type="button" class="m1-collapse-btn" data-collapse="evidence">Hide</button>
    </div>
    <div data-collapse-panel="evidence">
      <div class="m1-behind" id="m1-behind">
        <p class="m1-behind-kicker">The work behind this step</p>
        <ol class="m1-behind-flow" id="m1-behind-flow" aria-label="PRISMA work behind the results"></ol>
      </div>
      <div class="m1-search-live" id="m1-search-live" hidden>
        <span class="m1-spinner" aria-hidden="true"></span>
        <div class="m1-search-live-copy">
          <p class="m1-search-live-title">Working — querying live databases. This is not frozen.</p>
          <p class="m1-search-live-msg" id="m1-status" aria-live="polite"></p>
        </div>
        <p class="m1-search-live-time" id="m1-search-elapsed"></p>
      </div>
      <div class="m1-kpis" id="m1-kpis"></div>
      <div id="m1-results-body"></div>
    </div>
  </section>

  <section class="m1-section" id="confidence" hidden>
    <div class="m1-sec-head is-gold">
      <h2>How confident is this?</h2>
      <button type="button" class="m1-collapse-btn" data-collapse="confidence">Hide</button>
    </div>
    <div id="m1-confidence-body" data-collapse-panel="confidence"></div>
  </section>

  <section class="m1-section" id="related" hidden>
    <div class="m1-sec-head is-gold">
      <h2>Related papers in this field</h2>
      <button type="button" class="m1-collapse-btn" data-collapse="related">Hide</button>
    </div>
    <div id="m1-related-body" data-collapse-panel="related"></div>
  </section>

  <section class="m1-section" data-m1-section="3" id="briefing" hidden>
    <div class="m1-sec-head is-ink">
      <h2>Briefing and what's missing</h2>
      <button type="button" class="m1-collapse-btn" data-collapse="briefing">Hide</button>
    </div>
    <div data-collapse-panel="briefing">
      <p class="m1-briefing-lede" id="m1-briefing-lede"></p>
      <div class="m1-briefing-grid">
        <div>
          """ + (classification_html or "") + """
          """ + (briefing_main or "") + """
          <div id="m1-verdict-body"></div>
        </div>
        <div class="m1-briefing-side">
          """ + (briefing_side or "") + """
        </div>
      </div>
    </div>
  </section>

  <section class="m1-section" id="concept-map">
    <div class="m1-sec-head">
      <h2>How this question maps</h2>
      <button type="button" class="m1-collapse-btn" data-collapse="concepts">Hide</button>
    </div>
    <div data-collapse-panel="concepts">
      <p class="m1-concept-intro">The interpreted question sits in the centre. Each gold node is a term from the question; green nodes are related phrases that show up in titles and abstracts that mention that term. Size is how many records use it. Labels wrap so the full phrase stays visible — a vocabulary map, not an embedding and not a finding.</p>
      <div class="m1-cmap-actions">
        <button type="button" class="btn btn-primary" id="m1-cmap-download" disabled>Download map</button>
      </div>
      <div id="m1-concept-body">
        <div class="m1-cmap m1-cmap-pending" role="status" aria-live="polite">
          <div class="m1-cmap-spinner" aria-hidden="true"></div>
          <p class="m1-cmap-pending-label">Mapping this question against the scan…</p>
          <p class="m1-cmap-pending-hint">The map fills in after titles and abstracts are in.</p>
        </div>
      </div>
    </div>
  </section>
</div>
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

    stance_defs = request.get("stance_definitions") if isinstance(request, dict) else None
    stance_blurbs = {}
    if isinstance(stance_defs, dict):
        if stance_defs.get("supports"):
            stance_blurbs["supports"] = str(stance_defs["supports"])
        if stance_defs.get("contradicts"):
            stance_blurbs["contradicts"] = str(stance_defs["contradicts"])

    generated = datetime.now().strftime("%Y-%m-%d")
    gaps_html = (
        "<ul>" + "".join(f"<li>{_esc(g)}</li>" for g in gaps) + "</ul>" if gaps else "<p>None noted.</p>"
    )
    next_html = (
        "<ul>" + "".join(f"<li>{_esc(q)}</li>" for q in next_q) + "</ul>" if next_q else "<p>None noted.</p>"
    )
    ordered_for_bib = _sort_by_strength(shown, claims_by_id) if has_claims else _sort_materials(shown, enr_map)
    bib = "\n\n".join(_to_bibtex(m) for m in ordered_for_bib)

    classification_html = _render_classification(enrichment)
    restatement_html = _restatement_html(topic, original_topic, request, generated)
    key_refs = _key_refs_html(shown, enr_map)
    briefing_main = f"""
          <h2>Key references</h2>
          <p class="m1-col-blurb">Canonical starting points for this question.</p>
          {key_refs}
          <h2>BibTeX</h2>
          <pre class="bibtex">{_esc(bib)}</pre>
"""
    briefing_side = f"""
          <section class="panel">
            <h2>What's missing from this list</h2>
            {gaps_html}
          </section>
          <section class="panel">
            <h2>Searches to try next</h2>
            {next_html}
          </section>
          {_empty_track_html(shown, request)}
"""
    mode1_html = _mode1_html(
        topic,
        str(request.get("discipline") or ""),
        restatement_html,
        classification_html,
        briefing_main,
        briefing_side,
    )

    payload = {
        "topic": topic,
        "original_topic": original_topic,
        "discipline": request.get("discipline") or "",
        "year_from": request.get("year_from"),
        "year_to": request.get("year_to"),
        "gaps": gaps,
        "next_queries": next_q,
        "support_blurb": stance_blurbs.get("supports") or "",
        "contra_blurb": stance_blurbs.get("contradicts") or "",
        "share_summary": _share_summary(
            topic, original_topic, shown, claims_by_id, enrichment, dropped
        ),
    }
    payload_json = json.dumps(payload, ensure_ascii=False).replace("</", "<\\/")

    css = _load_css()
    js = _load_js()
    focus_js = _desktop_focus_js()
    return f"""<!DOCTYPE html>
<html lang="en" data-m1-theme="press">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{_esc(topic)} — Research Dossier</title>
  <script>
{focus_js}
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;650;700&family=Source+Sans+3:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <style>
{css}
  </style>
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="brand">
        <a class="brand-mark" href="{_esc(REPO_URL)}" target="_blank" rel="noopener noreferrer">Pineapple 71717</a>
        <span class="brand-sub">Research Dossier</span>
      </div>
      <span class="m1-stamp" aria-hidden="true">Built by<br>The Pineapple Project<br>Nº 71717</span>
    </div>

    {mode1_html}
    {_footer_html()}
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
