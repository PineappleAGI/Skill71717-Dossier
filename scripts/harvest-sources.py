#!/usr/bin/env python3
"""
Harvest scholarly materials for Skill71717 (Pineapple Research Materials).

Reads request.json, queries public academic APIs with urllib (stdlib only),
assigns material tracks, writes harvest.json with normalized, deduped records.

Usage:
  python scripts/harvest-sources.py <request.json> [output_dir]

APIs: OpenAlex (primary), arXiv, CrossRef, Semantic Scholar.
Optional: set RESEARCH_CONTACT_EMAIL for polite OpenAlex pooling.

Tracks: key_reference | research | industry | thesis | preprint
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

USER_AGENT = "Pineapple71717-ResearchMaterials/1.0 (https://github.com/PineappleAGI/Skill71717-Dossier; mailto:{email})"

INDUSTRY_HINTS = (
    "openai",
    "deepmind",
    "google deepmind",
    "google research",
    "meta ai",
    "facebook ai",
    "microsoft research",
    "nvidia",
    "wayve",
    "anthropic",
    "apple machine learning",
    "amazon science",
    "baidu research",
    "tencent ai",
    "huawei",
    "salesforce research",
    "adobe research",
)

ALL_TRACKS = ("key_reference", "research", "industry", "thesis", "preprint")


def _email() -> str:
    return os.environ.get("RESEARCH_CONTACT_EMAIL", "research@example.edu")


def _headers() -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT.format(email=_email()),
        "Accept": "application/json",
    }


def _get_json(url: str, timeout: int = 30) -> Any:
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (429, 503):
            time.sleep(2.0)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        raise


def _get_bytes(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT.format(email=_email())}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _norm_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    d = doi.strip()
    d = re.sub(r"^https?://(dx\.)?doi\.org/", "", d, flags=re.I)
    return d.lower() or None


def _authors_from_openalex(authorships: list) -> list[str]:
    names: list[str] = []
    for a in authorships or []:
        author = a.get("author") or {}
        name = author.get("display_name")
        if name:
            names.append(name)
    return names[:12]


def _institutions_blob(authorships: list) -> str:
    parts: list[str] = []
    for a in authorships or []:
        for inst in a.get("institutions") or []:
            name = inst.get("display_name") or ""
            if name:
                parts.append(name)
    return " | ".join(parts).lower()


def _prefer_url(url: str | None, doi: str | None, pdf_fallback: str | None = None) -> str | None:
    """Prefer publisher/DOI landing pages over bare arXiv abs links when DOI exists."""
    if doi:
        doi_url = f"https://doi.org/{doi}"
        if url and "arxiv.org" in url.lower():
            return doi_url
        if not url:
            return doi_url
    if url:
        return url
    return pdf_fallback


def _is_industry_text(*parts: str | None) -> bool:
    blob = " ".join(p for p in parts if p).lower()
    return any(h in blob for h in INDUSTRY_HINTS)


def _reconstruct_abstract(inverted: dict) -> str:
    positions: list[tuple[int, str]] = []
    for word, idxs in inverted.items():
        for i in idxs:
            positions.append((i, word))
    positions.sort(key=lambda x: x[0])
    return " ".join(w for _, w in positions)


def _classify_openalex_type(work: dict) -> str:
    t = (work.get("type") or "").lower()
    if "dissert" in t or "thesis" in t:
        return "thesis"
    if "dataset" in t:
        return "dataset"
    if "preprint" in t or "posted-content" in t:
        return "preprint"
    if "standard" in t:
        return "standard"
    return "journal"


def _openalex_work_to_item(work: dict) -> dict:
    doi = _norm_doi(work.get("doi"))
    abstract_inv = work.get("abstract_inverted_index") or {}
    abstract = _reconstruct_abstract(abstract_inv) if abstract_inv else ""
    primary = work.get("primary_location") or {}
    source = primary.get("source") or {}
    venue = source.get("display_name") or ""
    inst_blob = _institutions_blob(work.get("authorships") or [])
    oa = work.get("open_access") or {}
    oa_url = oa.get("oa_url")
    landing = primary.get("landing_page_url")
    raw_url = oa_url or landing
    if work.get("doi") and str(work["doi"]).startswith("http") and not raw_url:
        raw_url = work["doi"]
    url = _prefer_url(raw_url, doi, work.get("id"))
    mtype = _classify_openalex_type(work)
    org = ""
    if _is_industry_text(venue, inst_blob, (work.get("title") or "")):
        # pick first matching institution-ish token for display
        for h in INDUSTRY_HINTS:
            if h in inst_blob or h in venue.lower():
                org = h.title() if h != "openai" else "OpenAI"
                if h == "deepmind" or h == "google deepmind":
                    org = "Google DeepMind"
                elif h == "nvidia":
                    org = "NVIDIA"
                elif h == "wayve":
                    org = "Wayve"
                elif h == "microsoft research":
                    org = "Microsoft Research"
                break
    return {
        "id": f"openalex:{work.get('id', '').rsplit('/', 1)[-1]}",
        "title": (work.get("title") or "Untitled").strip(),
        "authors": _authors_from_openalex(work.get("authorships") or []),
        "year": work.get("publication_year"),
        "venue": venue,
        "organization": org or None,
        "url": url,
        "doi": doi,
        "type": mtype,
        "open_access": bool(oa.get("is_oa")),
        "citation_count": work.get("cited_by_count") or 0,
        "abstract": abstract[:2000],
        "source_apis": ["openalex"],
        "_inst_blob": inst_blob,
    }


def harvest_openalex(
    topic: str,
    year_from: int,
    year_to: int,
    per_page: int,
    extra_filters: list[str] | None = None,
    sort: str = "relevance_score:desc",
) -> list[dict]:
    filters = [
        f"from_publication_date:{year_from}-01-01",
        f"to_publication_date:{year_to}-12-31",
        "is_paratext:false",
    ]
    if extra_filters:
        filters.extend(extra_filters)
    params = {
        "search": topic,
        "filter": ",".join(filters),
        "per-page": str(min(per_page, 50)),
        "mailto": _email(),
        "sort": sort,
    }
    url = "https://api.openalex.org/works?" + urllib.parse.urlencode(params)
    data = _get_json(url)
    return [_openalex_work_to_item(w) for w in (data.get("results") or [])]


def harvest_arxiv(topic: str, year_from: int, year_to: int, max_results: int) -> list[dict]:
    params = {
        "search_query": f"all:{topic}",
        "start": "0",
        "max_results": str(min(max_results, 50)),
        "sortBy": "relevance",
        "sortOrder": "descending",
    }
    url = "https://export.arxiv.org/api/query?" + urllib.parse.urlencode(params)
    raw = _get_bytes(url)
    root = ET.fromstring(raw)
    ns = {"a": "http://www.w3.org/2005/Atom"}
    out: list[dict] = []
    for entry in root.findall("a:entry", ns):
        title = re.sub(r"\s+", " ", (entry.findtext("a:title", default="", namespaces=ns) or "").strip())
        summary = re.sub(
            r"\s+", " ", (entry.findtext("a:summary", default="", namespaces=ns) or "").strip()
        )
        published = entry.findtext("a:published", default="", namespaces=ns) or ""
        year = int(published[:4]) if re.match(r"\d{4}", published) else None
        if year and (year < year_from or year > year_to):
            continue
        authors = [
            (a.findtext("a:name", default="", namespaces=ns) or "").strip()
            for a in entry.findall("a:author", ns)
        ]
        authors = [a for a in authors if a][:12]
        link = ""
        for l in entry.findall("a:link", ns):
            if l.attrib.get("type") == "text/html" or l.attrib.get("rel") == "alternate":
                link = l.attrib.get("href") or ""
                break
        arxiv_id = (entry.findtext("a:id", default="", namespaces=ns) or "").rsplit("/", 1)[-1]
        doi_el = entry.find("{http://arxiv.org/schemas/atom}doi")
        doi = _norm_doi(doi_el.text if doi_el is not None else None)
        out.append(
            {
                "id": f"arxiv:{arxiv_id}",
                "title": title or "Untitled",
                "authors": authors,
                "year": year,
                "venue": "arXiv",
                "organization": None,
                "url": _prefer_url(link or f"https://arxiv.org/abs/{arxiv_id}", doi),
                "doi": doi,
                "type": "preprint",
                "open_access": True,
                "citation_count": None,
                "abstract": summary[:2000],
                "source_apis": ["arxiv"],
            }
        )
    return out


def harvest_crossref(topic: str, year_from: int, year_to: int, rows: int) -> list[dict]:
    params = {
        "query": topic,
        "rows": str(min(rows, 50)),
        "filter": f"from-pub-date:{year_from},until-pub-date:{year_to}",
        "mailto": _email(),
    }
    url = "https://api.crossref.org/works?" + urllib.parse.urlencode(params)
    data = _get_json(url)
    items = ((data.get("message") or {}).get("items")) or []
    out: list[dict] = []
    for item in items:
        title_list = item.get("title") or ["Untitled"]
        title = title_list[0] if title_list else "Untitled"
        authors = []
        for a in item.get("author") or []:
            name = f"{a.get('given') or ''} {a.get('family') or ''}".strip()
            if name:
                authors.append(name)
        year = None
        issued = (item.get("issued") or {}).get("date-parts") or []
        if issued and issued[0]:
            year = issued[0][0]
        doi = _norm_doi(item.get("DOI"))
        container = item.get("container-title") or []
        venue = container[0] if container else (item.get("publisher") or "")
        ctype = (item.get("type") or "").lower()
        mtype = "thesis" if "dissert" in ctype or "thesis" in ctype else "journal"
        out.append(
            {
                "id": f"crossref:{doi or (item.get('URL') or title)[:48]}",
                "title": title.strip(),
                "authors": authors[:12],
                "year": year,
                "venue": venue,
                "organization": None,
                "url": _prefer_url(item.get("URL"), doi),
                "doi": doi,
                "type": mtype,
                "open_access": False,
                "citation_count": item.get("is-referenced-by-count"),
                "abstract": re.sub(r"<[^>]+>", "", item.get("abstract") or "")[:2000],
                "source_apis": ["crossref"],
            }
        )
    return out


def harvest_semantic_scholar(topic: str, year_from: int, year_to: int, limit: int) -> list[dict]:
    params = {
        "query": topic,
        "limit": str(min(limit, 50)),
        "fields": "title,authors,year,venue,url,externalIds,abstract,citationCount,openAccessPdf,publicationTypes",
        "year": f"{year_from}-{year_to}",
    }
    url = "https://api.semanticscholar.org/graph/v1/paper/search?" + urllib.parse.urlencode(params)
    try:
        data = _get_json(url)
    except Exception:
        return []
    out: list[dict] = []
    for paper in data.get("data") or []:
        authors = [a.get("name") for a in (paper.get("authors") or []) if a.get("name")]
        ext = paper.get("externalIds") or {}
        doi = _norm_doi(ext.get("DOI"))
        pdf = paper.get("openAccessPdf") or {}
        url_paper = _prefer_url(pdf.get("url") or paper.get("url"), doi)
        types = paper.get("publicationTypes") or []
        mtype = "preprint" if any("Preprint" in t for t in types) else "journal"
        venue = paper.get("venue") or ""
        out.append(
            {
                "id": f"s2:{paper.get('paperId')}",
                "title": (paper.get("title") or "Untitled").strip(),
                "authors": authors[:12],
                "year": paper.get("year"),
                "venue": venue,
                "organization": None,
                "url": url_paper,
                "doi": doi,
                "type": mtype,
                "open_access": bool(pdf.get("url")),
                "citation_count": paper.get("citationCount"),
                "abstract": (paper.get("abstract") or "")[:2000],
                "source_apis": ["semantic_scholar"],
            }
        )
    return out


def _merge_key(item: dict) -> str:
    if item.get("doi"):
        return f"doi:{item['doi']}"
    if item.get("id", "").startswith("arxiv:"):
        return item["id"]
    title = re.sub(r"\W+", "", (item.get("title") or "").lower())[:80]
    return f"title:{title}:{item.get('year')}"


def _url_rank(url: str | None) -> int:
    if not url:
        return 0
    u = url.lower()
    if "doi.org" in u:
        return 3
    if "arxiv.org" in u:
        return 1
    return 2


def dedupe_merge(batches: list[list[dict]]) -> list[dict]:
    merged: dict[str, dict] = {}
    order: list[str] = []
    for batch in batches:
        for item in batch:
            key = _merge_key(item)
            if key in merged:
                existing = merged[key]
                if len(item.get("abstract") or "") > len(existing.get("abstract") or ""):
                    existing["abstract"] = item["abstract"]
                if (item.get("citation_count") or 0) > (existing.get("citation_count") or 0):
                    existing["citation_count"] = item["citation_count"]
                if item.get("open_access") and not existing.get("open_access"):
                    existing["open_access"] = True
                if _url_rank(item.get("url")) > _url_rank(existing.get("url")):
                    existing["url"] = item.get("url")
                if item.get("doi") and not existing.get("doi"):
                    existing["doi"] = item["doi"]
                if item.get("venue") and (
                    not existing.get("venue") or existing.get("venue") == "arXiv"
                ):
                    existing["venue"] = item["venue"]
                if item.get("organization") and not existing.get("organization"):
                    existing["organization"] = item["organization"]
                if item.get("type") == "thesis":
                    existing["type"] = "thesis"
                for api in item.get("source_apis") or []:
                    if api not in existing["source_apis"]:
                        existing["source_apis"].append(api)
                if item.get("_inst_blob"):
                    existing["_inst_blob"] = (
                        (existing.get("_inst_blob") or "") + " " + item["_inst_blob"]
                    )
            else:
                merged[key] = dict(item)
                order.append(key)
    return [merged[k] for k in order]


def assign_track(item: dict, cite_threshold: int) -> str:
    title = (item.get("title") or "").lower()
    mtype = (item.get("type") or "").lower()
    venue = (item.get("venue") or "").lower()
    inst = (item.get("_inst_blob") or "").lower()
    org = (item.get("organization") or "").lower()

    if mtype in {"thesis", "dissertation"} or "dissertation" in title or "phd thesis" in title:
        return "thesis"
    if _is_industry_text(venue, inst, org, title) or mtype in {"web", "industry"}:
        return "industry"
    cites = item.get("citation_count")
    if cites is not None and cites >= cite_threshold:
        return "key_reference"
    if mtype == "preprint" or "arxiv" in venue or (item.get("url") or "").find("arxiv.org") >= 0:
        # preprint unless clearly peer-reviewed venue already set
        if mtype == "journal" and venue and venue != "arxiv":
            return "research"
        return "preprint"
    return "research"


def budget_select(materials: list[dict], tracks_enabled: set[str], max_results: int) -> list[dict]:
    """Pick a diverse mix across tracks. Prefer seed_materials (pinned)."""
    shares = {
        "key_reference": 0.20,
        "research": 0.35,
        "industry": 0.20,
        "thesis": 0.15,
        "preprint": 0.10,
    }
    enabled = [t for t in ALL_TRACKS if t in tracks_enabled]
    if not enabled:
        enabled = list(ALL_TRACKS)

    total_share = sum(shares[t] for t in enabled) or 1.0
    quotas = {t: max(1, int(round(max_results * shares[t] / total_share))) for t in enabled}

    by_track: dict[str, list[dict]] = {t: [] for t in ALL_TRACKS}
    for m in materials:
        by_track.setdefault(m.get("track") or "research", []).append(m)

    for t in by_track:
        by_track[t].sort(
            key=lambda x: (
                0 if x.get("pinned") else 1,
                0 if x.get("abstract") else 1,
                -(x.get("citation_count") or 0),
            )
        )

    selected: list[dict] = []
    selected_ids: set[str] = set()

    # Always keep pinned seeds first (within enabled tracks)
    for m in materials:
        if not m.get("pinned"):
            continue
        if (m.get("track") or "research") not in enabled:
            continue
        mid = m.get("id")
        if mid in selected_ids:
            continue
        selected.append(m)
        selected_ids.add(mid)

    for t in enabled:
        for m in by_track.get(t, [])[: quotas.get(t, 0)]:
            mid = m.get("id")
            if mid in selected_ids:
                continue
            if len(selected) >= max_results:
                break
            selected.append(m)
            selected_ids.add(mid)

    if len(selected) < max_results:
        rest = []
        for t in enabled:
            for m in by_track.get(t, []):
                if m.get("id") not in selected_ids:
                    rest.append(m)
        rest.sort(key=lambda x: (0 if x.get("pinned") else 1, -(x.get("citation_count") or 0)))
        for m in rest:
            if len(selected) >= max_results:
                break
            selected.append(m)
            selected_ids.add(m.get("id"))

    return selected[:max_results]


def search_query_from_topic(topic: str) -> str:
    """Use the head of the topic for APIs; long em-dash clauses hurt recall."""
    t = (topic or "").strip()
    for sep in (" — ", " – ", " - ", ":", "|"):
        if sep in t:
            t = t.split(sep, 1)[0].strip()
            break
    # keep a focused phrase
    words = t.split()
    if len(words) > 16:
        t = " ".join(words[:16])
    return t or topic


def _enabled_tracks(request: dict) -> set[str]:
    tracks = request.get("material_tracks")
    if tracks:
        return {t for t in tracks if t in ALL_TRACKS}
    # Backward compat with source_types
    st = set(request.get("source_types") or [])
    enabled = set()
    if not st:
        return set(ALL_TRACKS)
    if "journal" in st or "dataset" in st or "standard" in st:
        enabled.update({"research", "key_reference"})
    if "preprint" in st:
        enabled.add("preprint")
    if "web" in st:
        enabled.add("industry")
    enabled.add("thesis")
    return enabled or set(ALL_TRACKS)


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: python scripts/harvest-sources.py <request.json> [output_dir]",
            file=sys.stderr,
        )
        return 2

    request_path = Path(sys.argv[1]).resolve()
    out_dir = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else request_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    request = json.loads(request_path.read_text(encoding="utf-8"))
    topic = request["topic"]
    query = search_query_from_topic(topic)
    year_from = int(request.get("year_from") or 2020)
    year_to = int(request.get("year_to") or 2026)
    max_results = int(request.get("max_results") or 50)
    tracks_enabled = _enabled_tracks(request)

    budget = max(8, min(50, max_results))
    batches: list[list[dict]] = []
    errors: list[str] = []
    print(f"search query: {query!r}", flush=True)

    # Optional fully-specified materials (demo fixtures / known landmarks).
    seed_materials = request.get("seed_materials") or []
    if isinstance(seed_materials, list) and seed_materials:
        cleaned = []
        for sm in seed_materials:
            if isinstance(sm, dict) and sm.get("title") and sm.get("id"):
                cleaned.append(dict(sm))
        if cleaned:
            print(f"including {len(cleaned)} seed_materials…", flush=True)
            batches.append(cleaned)

    try:
        print("harvesting OpenAlex (relevance)…", flush=True)
        batches.append(harvest_openalex(query, year_from, year_to, budget))
        time.sleep(0.35)
    except Exception as exc:
        errors.append(f"openalex: {exc}")

    # Optional seed queries improve recall for demos / precise lit packs.
    # Do NOT use global cited_by_count sort on a loose topic — it pulls unrelated mega-cited works.
    seed_queries = request.get("seed_queries") or []
    if isinstance(seed_queries, list):
        for i, sq in enumerate(seed_queries[:12]):
            if not isinstance(sq, str) or not sq.strip():
                continue
            try:
                print(f"harvesting OpenAlex (seed {i + 1})…", flush=True)
                batches.append(harvest_openalex(sq.strip(), year_from, year_to, 10))
                time.sleep(0.3)
            except Exception as exc:
                errors.append(f"openalex_seed_{i + 1}: {exc}")

    if "thesis" in tracks_enabled:
        try:
            print("harvesting OpenAlex (theses)…", flush=True)
            # Shorter thesis query tends to recall better than the full phrase
            thesis_q = " ".join(query.split()[:6]) or query
            batches.append(
                harvest_openalex(
                    thesis_q,
                    year_from,
                    year_to,
                    max(8, budget // 2),
                    extra_filters=["type:dissertation"],
                )
            )
            time.sleep(0.35)
        except Exception as exc:
            errors.append(f"openalex_thesis: {exc}")

    if "industry" in tracks_enabled:
        for label, iq in (
            ("industry GAIA-1", "GAIA-1 generative world model autonomous driving"),
            ("industry Cosmos", "Cosmos world foundation model Physical AI NVIDIA"),
            ("industry Genie", "Genie generative interactive environments DeepMind"),
            ("industry Sora simulators", "video generation models as world simulators"),
        ):
            try:
                print(f"harvesting OpenAlex ({label})…", flush=True)
                batches.append(harvest_openalex(iq, year_from, year_to, 8))
                time.sleep(0.35)
            except Exception as exc:
                errors.append(f"openalex_{label}: {exc}")

    if "preprint" in tracks_enabled:
        try:
            print("harvesting arXiv…", flush=True)
            batches.append(harvest_arxiv(query, year_from, year_to, budget))
            time.sleep(0.35)
        except Exception as exc:
            errors.append(f"arxiv: {exc}")

    if "research" in tracks_enabled or "key_reference" in tracks_enabled:
        try:
            print("harvesting CrossRef…", flush=True)
            batches.append(harvest_crossref(query, year_from, year_to, max(8, budget // 2)))
            time.sleep(0.35)
        except Exception as exc:
            errors.append(f"crossref: {exc}")

    try:
        print("harvesting Semantic Scholar…", flush=True)
        batches.append(harvest_semantic_scholar(query, year_from, year_to, budget))
    except Exception as exc:
        errors.append(f"semantic_scholar: {exc}")

    merged = dedupe_merge(batches)
    cites = [m.get("citation_count") or 0 for m in merged if m.get("citation_count")]
    cite_threshold = 200
    if cites:
        cites_sorted = sorted(cites, reverse=True)
        # top-quartile-ish floor, min 50
        idx = max(0, len(cites_sorted) // 5)
        cite_threshold = max(50, cites_sorted[idx] if cites_sorted else 200)

    for m in merged:
        # Honor explicit track on pinned seeds; otherwise assign heuristically
        if m.get("pinned") and m.get("track") in ALL_TRACKS:
            pass
        else:
            m["track"] = assign_track(m, cite_threshold)
        m.pop("_inst_blob", None)

    materials = budget_select(merged, tracks_enabled, max_results)

    # Strip internal-only nulls noise
    for m in materials:
        if not m.get("organization"):
            m.pop("organization", None)

    payload = {
        "request": request,
        "harvested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "count": len(materials),
        "cite_threshold_used": cite_threshold,
        "materials": materials,
        "errors": errors,
        "notes": [
            "Normalized multi-track harvest for Pineapple 71717.",
            "Tracks: key_reference, research, industry, thesis, preprint.",
            "AI enrichment should confirm tracks and may add verified industry URLs.",
        ],
    }

    out_path = out_dir / "harvest.json"
    out_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {out_path} ({len(materials)} materials)", flush=True)
    track_counts: dict[str, int] = {}
    for m in materials:
        track_counts[m.get("track") or "?"] = track_counts.get(m.get("track") or "?", 0) + 1
    print("tracks: " + ", ".join(f"{k}={v}" for k, v in sorted(track_counts.items())), flush=True)
    if errors:
        print("warnings: " + "; ".join(errors), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
