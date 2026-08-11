#!/usr/bin/env python3
"""
Generate a self-contained research dossier HTML for Skill Dossier.

Usage:
  python scripts/generate-dossier.py <harvest.json> <enrichment.json> <output.html> [--no-open]
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

# Display order for sectioned materials (blurb = one short line)
TRACK_SECTIONS = [
    ("key_reference", "Key references", "Must-read, highly cited starters."),
    ("research", "Research papers", "Peer-reviewed journal or conference work."),
    ("industry", "Industry reports", "Company / lab tech notes and blogs."),
    ("thesis", "Theses", "PhD or Master’s dissertations."),
    ("preprint", "Preprints", "Early drafts (e.g. arXiv), not yet peer-reviewed."),
]


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


def _resolve_track(m: dict, enr: dict | None) -> str:
    enr = enr or {}
    track = (enr.get("track") or m.get("track") or "").strip().lower()
    if track in {"key_reference", "research", "industry", "thesis", "preprint"}:
        return track
    mtype = (m.get("type") or "").lower()
    if mtype in {"thesis", "dissertation"}:
        return "thesis"
    if mtype == "preprint":
        return "preprint"
    if mtype in {"web", "industry"}:
        return "industry"
    return "research"


def _render_material(m: dict, enr: dict | None) -> str:
    enr = enr or {}
    score = enr.get("relevance_score", "—")
    mtype = m.get("type") or "journal"
    track = _resolve_track(m, enr)
    badges = [
        f'<span class="badge track-{_esc(track)}">{_esc(track.replace("_", " "))}</span>',
        f'<span class="badge type-{_esc(mtype)}">{_esc(mtype)}</span>',
    ]
    if m.get("open_access"):
        badges.append('<span class="badge oa">Open access</span>')
    if m.get("year"):
        badges.append(f'<span class="badge">{_esc(m.get("year"))}</span>')
    if m.get("citation_count") is not None:
        badges.append(f'<span class="badge">{_esc(m.get("citation_count"))} cites</span>')
    if m.get("venue"):
        badges.append(f'<span class="badge">{_esc(m.get("venue"))}</span>')
    if m.get("organization"):
        badges.append(f'<span class="badge">{_esc(m.get("organization"))}</span>')

    authors = ", ".join(m.get("authors") or []) or "Authors unavailable"
    url = m.get("url") or (f"https://doi.org/{m['doi']}" if m.get("doi") else "#")
    title_html = f'<a href="{_esc(url)}" target="_blank" rel="noopener noreferrer">{_esc(m.get("title"))}</a>'

    desc = enr.get("short_description") or (m.get("abstract") or "")[:280] or "No description yet."
    rationale = enr.get("relevance_rationale") or ""
    best_for = enr.get("best_for") or ""
    limitations = enr.get("limitations") or ""
    claims = enr.get("key_claims") or []
    claims_html = ""
    if claims:
        claims_html = "<ul>" + "".join(f"<li>{_esc(c)}</li>" for c in claims) + "</ul>"

    extra_bits = []
    if rationale:
        extra_bits.append(f"<p><strong>Why it matters:</strong> {_esc(rationale)}</p>")
    if best_for:
        extra_bits.append(f"<p><strong>Best for:</strong> {_esc(best_for)}</p>")
    if limitations:
        extra_bits.append(f"<p><strong>Limitations:</strong> {_esc(limitations)}</p>")
    if claims:
        extra_bits.append(f"<p><strong>Key claims:</strong></p>{claims_html}")
    extra = f'<div class="desc-secondary">{"".join(extra_bits)}</div>' if extra_bits else ""

    doi_line = ""
    if m.get("doi"):
        doi_line = (
            f'<div class="byline">DOI: <a href="https://doi.org/{_esc(m["doi"])}" '
            f'target="_blank" rel="noopener noreferrer">{_esc(m["doi"])}</a></div>'
        )

    return f"""
<article class="material" data-id="{_esc(m.get('id'))}" data-track="{_esc(track)}">
  <div class="material-head">
    <h3>{title_html}</h3>
    <span class="relevance" title="Relevance score">{_esc(score)}</span>
  </div>
  <div class="badges">{''.join(badges)}</div>
  <p class="byline">{_esc(authors)}</p>
  {doi_line}
  <p class="desc">{_esc(desc)}</p>
  {extra}
</article>
"""


def _sort_materials(materials: list[dict], enr_map: dict[str, dict]) -> list[dict]:
    return sorted(
        materials,
        key=lambda m: -(enr_map.get(m.get("id"), {}).get("relevance_score") or 0),
    )


def _sectioned_materials_html(materials: list[dict], enr_map: dict[str, dict], enabled_tracks: set[str]) -> str:
    by_track: dict[str, list[dict]] = {k: [] for k, _, _ in TRACK_SECTIONS}
    for m in materials:
        track = _resolve_track(m, enr_map.get(m.get("id")))
        if track not in by_track:
            track = "research"
        if enabled_tracks and track not in enabled_tracks:
            # Still show if harvest included it; enabled_tracks empty means show all
            pass
        by_track.setdefault(track, []).append(m)

    parts: list[str] = []
    for track_id, title, blurb in TRACK_SECTIONS:
        if enabled_tracks and track_id not in enabled_tracks:
            # Hide empty optional tracks when user disabled them and nothing landed there
            items = by_track.get(track_id) or []
            if not items:
                continue
        items = _sort_materials(by_track.get(track_id) or [], enr_map)
        if not items:
            continue
        cards = "\n".join(_render_material(m, enr_map.get(m.get("id"))) for m in items)
        parts.append(
            f"""
<section class="material-section" data-track="{_esc(track_id)}">
  <div class="section-heading">
    <h2>{_esc(title)}</h2>
    <p class="section-blurb">{_esc(blurb)}</p>
  </div>
  {cards}
</section>
"""
        )
    if not parts:
        return "<p>No materials in harvest.</p>"
    return "\n".join(parts)


def generate(harvest: dict, enrichment: dict) -> str:
    request = harvest.get("request") or enrichment.get("request") or {}
    materials = list(harvest.get("materials") or [])
    enr_map = _by_id(enrichment)

    # Optional web/industry materials appended only in enrichment
    for extra in enrichment.get("web_materials") or []:
        if not isinstance(extra, dict) or not extra.get("id"):
            continue
        if any(m.get("id") == extra["id"] for m in materials):
            continue
        materials.append(extra)

    enabled = set(request.get("material_tracks") or [])
    # Backward compat: derive from source_types if material_tracks absent
    if not enabled:
        st = set(request.get("source_types") or [])
        if st:
            if "journal" in st or "dataset" in st or "standard" in st:
                enabled.add("research")
            if "preprint" in st:
                enabled.add("preprint")
            if "web" in st:
                enabled.add("industry")
            enabled.update({"key_reference", "thesis"})  # show if present
        else:
            enabled = {t for t, _, _ in TRACK_SECTIONS}

    years = [m.get("year") for m in materials if m.get("year")]
    year_span = f"{min(years)}–{max(years)}" if years else "—"
    oa_n = sum(1 for m in materials if m.get("open_access"))
    oa_pct = int(round(100 * oa_n / len(materials))) if materials else 0
    venues: dict[str, int] = {}
    for m in materials:
        v = m.get("venue") or m.get("organization")
        if v:
            venues[v] = venues.get(v, 0) + 1
    top_venues = ", ".join(
        v for v, _ in sorted(venues.items(), key=lambda kv: -kv[1])[:4]
    ) or "—"

    topic = request.get("topic") or "Research topic"
    gaps = enrichment.get("coverage_gaps") or []
    next_q = enrichment.get("suggested_next_queries") or []

    materials_html = _sectioned_materials_html(materials, enr_map, enabled)

    gaps_html = (
        "<ul>" + "".join(f"<li>{_esc(g)}</li>" for g in gaps) + "</ul>" if gaps else "<p>None noted.</p>"
    )
    next_html = (
        "<ul>" + "".join(f"<li>{_esc(q)}</li>" for q in next_q) + "</ul>" if next_q else "<p>None noted.</p>"
    )

    ordered_for_bib = _sort_materials(materials, enr_map)
    bib = "\n\n".join(_to_bibtex(m) for m in ordered_for_bib)
    generated = datetime.now().strftime("%Y-%m-%d")

    filters = []
    if request.get("discipline"):
        filters.append(f"Field: {request['discipline']}")
    if request.get("year_from") or request.get("year_to"):
        filters.append(f"Years: {request.get('year_from')}–{request.get('year_to')}")
    # audience / material_tracks intentionally not shown as chips

    chips = "".join(f'<span class="chip"><strong>{_esc(c)}</strong></span>' for c in filters)

    guide_rows = "".join(
        f"<tr><th scope=\"row\">{_esc(title)}</th><td>{_esc(blurb)}</td></tr>"
        for _, title, blurb in TRACK_SECTIONS
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

    css = _load_css()
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
</head>
<body>
  <div class="shell">
    <div class="topbar">
      <div class="brand">
        <span class="brand-mark">Skill Dossier</span>
        <span class="brand-sub">Research Materials</span>
      </div>
    </div>

    <header class="hero">
      <h1>{_esc(topic)}</h1>
      <div class="meta-row">{chips}<span class="chip">Generated <strong>{_esc(generated)}</strong></span></div>
      <div class="stats">
        <div class="stat"><div class="n">{len(materials)}</div><div class="l">Materials</div></div>
        <div class="stat"><div class="n">{_esc(year_span)}</div><div class="l">Year span</div></div>
        <div class="stat"><div class="n">{oa_pct}%</div><div class="l">Open access</div></div>
        <div class="stat"><div class="n" style="font-size:1rem;padding-top:0.35rem">{_esc(top_venues)}</div><div class="l">Top venues</div></div>
      </div>
    </header>

    {guide_table}

    <div class="layout">
      <main>
        {materials_html}
      </main>
      <aside>
        <section class="panel">
          <h2>What's missing from this list</h2>
          {gaps_html}
        </section>
        <section class="panel">
          <h2>Searches to try next</h2>
          {next_html}
        </section>
        <section class="panel">
          <h2>BibTeX</h2>
          <pre class="bibtex">{_esc(bib)}</pre>
        </section>
      </aside>
    </div>
  </div>
</body>
</html>
"""


def main() -> int:
    args = [a for a in sys.argv[1:] if a != "--no-open"]
    no_open = "--no-open" in sys.argv[1:]
    if len(args) < 3:
        print(
            "Usage: python scripts/generate-dossier.py <harvest.json> <enrichment.json> <output.html> [--no-open]",
            file=sys.stderr,
        )
        return 2

    harvest_path = Path(args[0])
    enrichment_path = Path(args[1])
    output_path = Path(args[2])

    harvest = json.loads(harvest_path.read_text(encoding="utf-8"))
    enrichment = json.loads(enrichment_path.read_text(encoding="utf-8"))
    html_doc = generate(harvest, enrichment)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_doc, encoding="utf-8")
    print(f"wrote {output_path.resolve()}")
    if not no_open:
        _open_html(output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
