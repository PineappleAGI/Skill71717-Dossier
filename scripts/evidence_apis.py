#!/usr/bin/env python3
"""Thin public-API clients for Mode 1 (PubMed, Europe PMC, trials, OpenAlex, Unpaywall)."""

from __future__ import annotations

import html as html_lib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any

USER_AGENT = "Pineapple71717-Mode1/1.0 (https://github.com/KingHenryZ/Skill-Dossier; mailto:{email})"
NCBI = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
TRIALS = "https://clinicaltrials.gov/api/v2/studies"
OPENALEX = "https://api.openalex.org/works"
UNPAYWALL = "https://api.unpaywall.org/v2"


def _email() -> str:
    return os.environ.get("RESEARCH_CONTACT_EMAIL", "research@example.edu")


def _headers(accept: str = "application/json") -> dict[str, str]:
    return {
        "User-Agent": USER_AGENT.format(email=_email()),
        "Accept": accept,
    }


def _get(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=_headers("*/*"))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code in (429, 503):
            time.sleep(2.0)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        raise


def _get_json(url: str, timeout: int = 30) -> Any:
    return json.loads(_get(url, timeout=timeout).decode("utf-8"))


def pubmed_search(term: str, retmax: int = 20) -> dict:
    params = {
        "db": "pubmed",
        "term": term,
        "retmax": str(retmax),
        "retmode": "json",
        "sort": "relevance",
        "tool": "pineapple71717",
        "email": _email(),
    }
    url = f"{NCBI}/esearch.fcgi?" + urllib.parse.urlencode(params)
    data = _get_json(url)
    time.sleep(0.35)
    return data


def pubmed_summary(ids: list[str]) -> dict:
    if not ids:
        return {"result": {"uids": []}}
    params = {
        "db": "pubmed",
        "id": ",".join(ids),
        "retmode": "json",
        "tool": "pineapple71717",
        "email": _email(),
    }
    url = f"{NCBI}/esummary.fcgi?" + urllib.parse.urlencode(params)
    data = _get_json(url)
    time.sleep(0.35)
    return data


def pubmed_abstracts(ids: list[str]) -> dict[str, str]:
    """Return {pmid: abstract} from efetch XML. Missing abstracts omitted."""
    out: dict[str, str] = {}
    if not ids:
        return out
    params = {
        "db": "pubmed",
        "id": ",".join(ids),
        "retmode": "xml",
        "rettype": "abstract",
        "tool": "pineapple71717",
        "email": _email(),
    }
    url = f"{NCBI}/efetch.fcgi?" + urllib.parse.urlencode(params)
    raw = _get(url)
    time.sleep(0.35)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return out
    for article in root.findall(".//PubmedArticle"):
        pmid_el = article.find(".//PMID")
        pmid = (pmid_el.text or "").strip() if pmid_el is not None else ""
        parts = []
        for block in article.findall(".//Abstract/AbstractText"):
            label = block.attrib.get("Label") or block.attrib.get("NlmCategory") or ""
            text = "".join(block.itertext()).strip()
            if not text:
                continue
            parts.append(f"{label}: {text}" if label else text)
        if pmid and parts:
            out[pmid] = " ".join(parts)
    return out


def europepmc_search(query: str, page_size: int = 20, result_type: str = "lite") -> dict:
    params = {
        "query": query,
        "format": "json",
        "pageSize": str(page_size),
        "resultType": result_type,
    }
    url = f"{EPMC}/search?" + urllib.parse.urlencode(params)
    return _get_json(url)


def europepmc_fulltext(pmcid: str) -> dict:
    """OA full-text XML from Europe PMC. Returns a short plain-text snippet, never a paywalled PDF."""
    pmcid = (pmcid or "").strip().upper()
    if pmcid.startswith("PMCID:"):
        pmcid = pmcid.split(":", 1)[1]
    if pmcid and not pmcid.startswith("PMC"):
        pmcid = "PMC" + pmcid
    if not re.match(r"PMC\d+$", pmcid):
        return {"pmcid": pmcid, "text": ""}
    url = f"{EPMC}/{urllib.parse.quote(pmcid)}/fullTextXML"
    try:
        raw = _get(url, timeout=20)
    except Exception:
        return {"pmcid": pmcid, "text": ""}
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return {"pmcid": pmcid, "text": ""}
    parts: list[str] = []
    for el in root.iter():
        local = (el.tag.split("}")[-1] if "}" in el.tag else el.tag).lower()
        if local not in ("abstract", "p"):
            continue
        text = " ".join("".join(el.itertext()).split())
        if len(text) > 40:
            parts.append(text)
    return {"pmcid": pmcid, "text": " ".join(parts)[:12000]}


def trials_search(term: str, page_size: int = 10) -> dict:
    params = {
        "query.term": term,
        "pageSize": str(page_size),
        "countTotal": "true",
    }
    url = f"{TRIALS}?" + urllib.parse.urlencode(params)
    return _get_json(url)


_OPENALEX_SORTS = {
    "relevance_score:desc",
    "cited_by_count:desc",
    "publication_date:desc",
}


def openalex_search(query: str, per_page: int = 20, sort: str = "relevance_score:desc") -> dict:
    if sort not in _OPENALEX_SORTS:
        sort = "relevance_score:desc"
    params = {
        "search": query,
        "per_page": str(per_page),
        "sort": sort,
        "mailto": _email(),
    }
    url = f"{OPENALEX}?" + urllib.parse.urlencode(params)
    return _get_json(url)


def unpaywall_lookup(doi: str) -> dict:
    doi = doi.strip().replace("https://doi.org/", "").replace("http://doi.org/", "")
    url = f"{UNPAYWALL}/{urllib.parse.quote(doi)}?email=" + urllib.parse.quote(_email())
    return _get_json(url)


# --- Supplementary web search (no Elsevier API; visible snippets only) ---

DDG_HTML = "https://html.duckduckgo.com/html/"
DDG_LITE = "https://lite.duckduckgo.com/lite/"
CROSSREF = "https://api.crossref.org/works"

SKIP_HOSTS = (
    "pubmed.ncbi.nlm.nih.gov",
    "ncbi.nlm.nih.gov",
    "europepmc.org",
    "clinicaltrials.gov",
    "openalex.org",
    "wikipedia.org",
    "reddit.com",
    "youtube.com",
    "facebook.com",
    "twitter.com",
    "x.com",
    "quora.com",
    "pinterest.com",
    "tiktok.com",
    "duckduckgo.com",
)

PAYWALL_HOSTS = (
    "sciencedirect.com",
    "elsevier.com",
    "linkinghub.elsevier.com",
    "onlinelibrary.wiley.com",
    "link.springer.com",
    "springer.com",
    "nature.com",
    "tandfonline.com",
    "academic.oup.com",
    "jamanetwork.com",
    "nejm.org",
    "thelancet.com",
    "cell.com",
    "ieee.org",
)

PUBLISHER_HINTS = (
    "sciencedirect.com",
    "elsevier.com",
    "linkinghub.elsevier.com",
    "doi.org",
    "onlinelibrary.wiley.com",
    "link.springer.com",
    "nature.com",
    "tandfonline.com",
    "academic.oup.com",
    "mdpi.com",
    "frontiersin.org",
    "plos.org",
    "biomedcentral.com",
    "sagepub.com",
    "karger.com",
    "lww.com",
    "ovid.com",
)


def _html_headers() -> dict[str, str]:
    return {
        "User-Agent": (
            "Mozilla/5.0 (compatible; Pineapple71717-Mode1/1.0; "
            "+https://github.com/KingHenryZ/Skill-Dossier)"
        ),
        "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }


def _get_html(url: str, timeout: int = 18) -> str:
    req = urllib.request.Request(url, headers=_html_headers())
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read(1_500_000)
        ctype = (resp.headers.get("Content-Type") or "").lower()
        if "pdf" in ctype:
            return ""
        charset = "utf-8"
        m = re.search(r"charset=([\w-]+)", ctype)
        if m:
            charset = m.group(1)
        return raw.decode(charset, errors="replace")


def _host(url: str) -> str:
    try:
        return urllib.parse.urlparse(url).netloc.lower().lstrip("www.")
    except Exception:
        return ""


def _skip_url(url: str) -> bool:
    if not url or not url.startswith("http"):
        return True
    low = url.lower()
    if any(x in low for x in (".pdf", "sci-hub", "/pdf?")):
        return True
    host = _host(url)
    return any(host == s or host.endswith("." + s) for s in SKIP_HOSTS)


def _unwrap_ddg(href: str) -> str:
    href = html_lib.unescape(href or "").strip()
    if href.startswith("//"):
        href = "https:" + href
    parsed = urllib.parse.urlparse(href)
    qs = urllib.parse.parse_qs(parsed.query)
    if qs.get("uddg"):
        return urllib.parse.unquote(qs["uddg"][0])
    return href


def _strip_tags(blob: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", blob or "")
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _ddg_html_results(query: str, timeout: int = 6) -> list[dict]:
    url = DDG_HTML + "?" + urllib.parse.urlencode({"q": query})
    page = _get_html(url, timeout=timeout)
    if "anomaly.js" in page or "cc=botnet" in page:
        return []
    out: list[dict] = []
    seen = set()
    for block in re.finditer(
        r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>'
        r'.*?(?:class="result__snippet"[^>]*>(.*?)</(?:a|span|td)>)?',
        page,
        re.I | re.S,
    ):
        href = _unwrap_ddg(block.group(1))
        if _skip_url(href) or href in seen:
            continue
        seen.add(href)
        out.append(
            {
                "title": _strip_tags(block.group(2)),
                "url": href,
                "snippet": _strip_tags(block.group(3) or ""),
            }
        )
    if out:
        return out
    for m in re.finditer(
        r'<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        page,
        re.I | re.S,
    ):
        href = _unwrap_ddg(m.group(1))
        if _skip_url(href) or href in seen:
            continue
        seen.add(href)
        out.append({"title": _strip_tags(m.group(2)), "url": href, "snippet": ""})
    return out


def _ddg_lite_results(query: str, timeout: int = 6) -> list[dict]:
    url = DDG_LITE + "?" + urllib.parse.urlencode({"q": query})
    page = _get_html(url, timeout=timeout)
    if "anomaly.js" in page or "cc=botnet" in page:
        return []
    out: list[dict] = []
    seen = set()
    for m in re.finditer(
        r'<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
        page,
        re.I | re.S,
    ):
        href = _unwrap_ddg(m.group(1))
        if _skip_url(href) or href in seen:
            continue
        if "duckduckgo.com" in href:
            continue
        seen.add(href)
        out.append({"title": _strip_tags(m.group(2)), "url": href, "snippet": ""})
    return out


def duckduckgo_search(query: str, timeout: int = 6) -> list[dict]:
    try:
        hits = _ddg_html_results(query, timeout=timeout)
        if hits:
            return hits
    except Exception:
        hits = []
    try:
        return _ddg_lite_results(query, timeout=timeout)
    except Exception:
        return hits


def _meta_map(page: str) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for m in re.finditer(r"<meta\b([^>]*)>", page or "", re.I):
        tag = m.group(1)
        km = re.search(r'(?:name|property|itemprop)\s*=\s*["\']([^"\']+)["\']', tag, re.I)
        cm = re.search(r'content\s*=\s*["\']([^"\']*)["\']', tag, re.I)
        if not km or not cm:
            continue
        key = km.group(1).strip().lower()
        found.setdefault(key, []).append(html_lib.unescape(cm.group(1)).strip())
    return found


def _first_meta(meta: dict[str, list[str]], *keys: str) -> str:
    for k in keys:
        for v in meta.get(k.lower()) or []:
            if v:
                return v
    return ""


def _jsonld_article(page: str) -> dict:
    for m in re.finditer(
        r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        page or "",
        re.I | re.S,
    ):
        raw = m.group(1).strip()
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        stack = data if isinstance(data, list) else [data]
        for item in stack:
            if not isinstance(item, dict):
                continue
            types = item.get("@type") or ""
            if isinstance(types, list):
                types = " ".join(str(t) for t in types)
            if re.search(r"ScholarlyArticle|Article|MedicalScholarlyArticle", str(types), re.I):
                return item
    return {}


def _year_from(text: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", text or "")
    return int(m.group(0)) if m else None


def _looks_paywalled(url: str, page: str) -> bool:
    host = _host(url)
    low = (page or "").lower()
    if re.search(r"isaccessibleforfree[\"']?\s*:\s*true", low):
        return False
    if any(host == h or host.endswith("." + h) for h in PAYWALL_HOSTS):
        return True
    if re.search(r"get access|purchase pdf|institutional login", low):
        return True
    return False


def _enrich_landing(hit: dict, timeout: int = 4) -> dict:
    title = (hit.get("title") or "").strip()
    snippet = (hit.get("snippet") or "").strip()
    url = hit.get("url") or ""
    authors: list[str] = []
    venue = ""
    doi = ""
    year = _year_from(title + " " + snippet)
    page = ""
    try:
        page = _get_html(url, timeout=timeout)
    except Exception:
        page = ""
    if page:
        meta = _meta_map(page)
        ld = _jsonld_article(page)
        title = _first_meta(meta, "citation_title", "dc.title", "og:title") or title
        snippet_page = _first_meta(
            meta,
            "citation_abstract",
            "dc.description",
            "description",
            "og:description",
            "abstract",
        )
        if ld.get("name"):
            title = str(ld.get("name")) or title
        desc = ld.get("description") or ld.get("abstract")
        if isinstance(desc, str) and len(desc) > len(snippet_page or ""):
            snippet_page = desc
        if snippet_page and (
            len(snippet_page) >= 80
            and "sciencedirect.com | science" not in snippet_page.lower()
        ):
            snippet = snippet_page
        venue = _first_meta(meta, "citation_journal_title", "citation_journal", "og:site_name")
        if isinstance(ld.get("isPartOf"), dict):
            venue = venue or str(ld["isPartOf"].get("name") or "")
        doi = _first_meta(meta, "citation_doi", "dc.identifier")
        ident = ld.get("identifier")
        if not doi and isinstance(ident, str) and "10." in ident:
            doi = ident
        doi = re.sub(r"^https?://(dx\.)?doi\.org/", "", doi, flags=re.I).strip()
        authors = [a for a in (meta.get("citation_author") or []) if a][:12]
        if not authors:
            raw_auth = ld.get("author")
            if isinstance(raw_auth, list):
                for a in raw_auth:
                    if isinstance(a, dict) and a.get("name"):
                        authors.append(str(a["name"]))
                    elif isinstance(a, str):
                        authors.append(a)
            elif isinstance(raw_auth, dict) and raw_auth.get("name"):
                authors.append(str(raw_auth["name"]))
        date = _first_meta(meta, "citation_publication_date", "citation_date", "dc.date")
        year = _year_from(date) or year
        if isinstance(ld.get("datePublished"), str):
            year = _year_from(ld["datePublished"]) or year
    if not venue:
        host = _host(url)
        if "sciencedirect" in host or "elsevier" in host or "linkinghub" in host:
            venue = "ScienceDirect / Elsevier"
        elif host:
            venue = host
    abstract = (snippet or "").strip()
    if len(abstract) > 1800:
        abstract = abstract[:1800].rsplit(" ", 1)[0] + "…"
    paywalled = _looks_paywalled(url, page)
    paper_id = f"doi:{doi.lower()}" if doi else "web:" + re.sub(r"[^a-z0-9]+", "-", title.lower())[:48]
    return {
        "id": paper_id,
        "pmid": "",
        "doi": doi,
        "title": title,
        "authors": authors,
        "year": year,
        "venue": venue,
        "pubTypes": ["Journal article"],
        "abstract": abstract,
        "url": url,
        "sourceApis": ["web_search"],
        "foundViaWeb": True,
        "paywalled": paywalled,
        "fullTextAvailable": not paywalled,
        "paywallNote": (
            "Full text not available to review (paywalled). Abstract page linked."
            if paywalled
            else ""
        ),
    }


def _record_key(paper: dict) -> str:
    doi = re.sub(r"\.pub\d+$", "", (paper.get("doi") or "").lower().strip())
    if doi:
        return "doi:" + doi
    return "t:" + re.sub(r"\s+", " ", (paper.get("title") or "").lower())[:80]


def _title_term_hits(title: str, terms: str) -> int:
    toks = re.findall(r"[a-z][a-z0-9-]{3,}", (terms or "").lower())
    blob = (title or "").lower()
    seen = set()
    hits = 0
    for tok in toks:
        if tok in seen:
            continue
        seen.add(tok)
        if tok in blob:
            hits += 1
    return hits


def _elsevier_relevant(title: str, terms: str) -> bool:
    blob = (title or "").lower()
    phrases = [p.strip().lower() for p in re.findall(r'"([^"]+)"', terms or "") if p.strip()]
    if phrases:
        return sum(1 for p in phrases if p in blob) >= 1
    return _title_term_hits(title, terms) >= 2


def _prefer_publisher(hit: dict) -> int:
    host = _host(hit.get("url") or "")
    if "sciencedirect" in host or "elsevier" in host or "linkinghub" in host:
        return 0
    if any(h in host for h in PUBLISHER_HINTS):
        return 1
    return 2


def _crossref_items(params: dict[str, str]) -> list[dict]:
    q = dict(params)
    q["mailto"] = _email()
    url = CROSSREF + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return []
    time.sleep(0.2)
    return ((data.get("message") or {}).get("items") or [])


def _crossref_paper(item: dict) -> dict:
    doi = str(item.get("DOI") or "").strip()
    title = html_lib.unescape(" ".join(item.get("title") or [])).strip()
    authors: list[str] = []
    for a in item.get("author") or []:
        if not isinstance(a, dict):
            continue
        name = " ".join(p for p in (a.get("given"), a.get("family")) if p)
        if name:
            authors.append(name)
    venue = ""
    containers = item.get("container-title") or []
    if containers:
        venue = html_lib.unescape(str(containers[0]))
    year = None
    for key in ("published-print", "published-online", "published"):
        parts = ((item.get(key) or {}).get("date-parts") or [[None]])[0]
        if parts and parts[0]:
            try:
                year = int(parts[0])
            except (TypeError, ValueError):
                year = None
            break
    abstract = _strip_tags(item.get("abstract") or "")
    url = item.get("URL") or ""
    if doi:
        url = url or f"https://doi.org/{doi}"
    if doi.lower().startswith("10.1016"):
        venue = venue or "ScienceDirect / Elsevier"
        if "sciencedirect.com" not in (url or "").lower():
            url = f"https://doi.org/{doi}"
    licenses = item.get("license") or []
    oa_license = any(
        "creativecommons.org" in str((lic or {}).get("URL") or "").lower()
        for lic in licenses
        if isinstance(lic, dict)
    )
    paywalled = not oa_license
    return {
        "id": f"doi:{doi.lower()}" if doi else "web:" + re.sub(r"[^a-z0-9]+", "-", title.lower())[:48],
        "pmid": "",
        "doi": doi,
        "title": title,
        "authors": authors[:12],
        "year": year,
        "venue": venue or _host(url) or "Web search",
        "pubTypes": ["Journal article"],
        "abstract": abstract[:1800],
        "url": url,
        "sourceApis": ["web_search"],
        "foundViaWeb": True,
        "paywalled": paywalled,
        "fullTextAvailable": not paywalled,
        "paywallNote": (
            "Full text not available to review (paywalled). Abstract page linked."
            if paywalled
            else ""
        ),
    }


def web_literature_sweep(terms: str, max_results: int = 8, budget_s: float = 8.0) -> dict:
    """Supplementary sweep for ScienceDirect/Elsevier and other publisher pages.

    Tries a public web search first. If that is blocked, falls back to CrossRef
    (not the Elsevier API) so ScienceDirect-hosted DOIs still surface. Only
    visible title/author/venue/abstract metadata is kept — never paywalled full text.
    Hard-capped by budget_s so a blocked DuckDuckGo/publisher crawl cannot stall Mode 1.
    """
    terms = (terms or "").strip()
    if not terms:
        return {"results": [], "queries": []}
    cap = max(1, min(max_results, 10))
    queries = [f"{terms} site:sciencedirect.com", terms]
    raw: list[dict] = []
    seen_url = set()
    deadline = time.monotonic() + max(2.0, budget_s)

    def leftover() -> float:
        return deadline - time.monotonic()

    for q in queries:
        if leftover() < 1.5:
            break
        time.sleep(0.15)
        try:
            hits = duckduckgo_search(q, timeout=min(5, max(2, int(leftover()))))
        except Exception:
            hits = []
        for hit in hits:
            url = hit.get("url") or ""
            if url in seen_url or _skip_url(url):
                continue
            seen_url.add(url)
            raw.append(hit)
    raw.sort(key=_prefer_publisher)
    papers: list[dict] = []
    seen_key: set[str] = set()
    for hit in raw[:cap]:
        if leftover() < 1.2:
            break
        try:
            paper = _enrich_landing(hit, timeout=min(4, max(2, int(leftover()))))
        except Exception:
            title = (hit.get("title") or "").strip()
            if not title:
                continue
            paper = {
                "id": "web:" + re.sub(r"[^a-z0-9]+", "-", title.lower())[:48],
                "pmid": "",
                "doi": "",
                "title": title,
                "authors": [],
                "year": None,
                "venue": (
                    "ScienceDirect / Elsevier"
                    if "sciencedirect" in _host(hit.get("url") or "")
                    else (_host(hit.get("url") or "") or "Web search")
                ),
                "pubTypes": ["Journal article"],
                "abstract": (hit.get("snippet") or "").strip(),
                "url": hit.get("url") or "",
                "sourceApis": ["web_search"],
                "foundViaWeb": True,
                "paywalled": True,
                "fullTextAvailable": False,
                "paywallNote": "Full text not available to review (paywalled). Abstract page linked.",
            }
        key = _record_key(paper)
        if not paper.get("title") or key in seen_key:
            continue
        seen_key.add(key)
        papers.append(paper)

    cr_queries = [
        ("biblio", {"query.bibliographic": terms, "rows": "8"}),
        (
            "elsevier",
            {
                "query.title": terms.replace('"', ""),
                "filter": "prefix:10.1016,type:journal-article",
                "rows": "8",
            },
        ),
    ]
    queries.append("crossref:" + terms)
    for kind, params in cr_queries:
        if leftover() < 1.0:
            break
        for item in _crossref_items(params):
            paper = _crossref_paper(item)
            key = _record_key(paper)
            if not paper.get("title") or key in seen_key:
                continue
            if kind == "elsevier" and not _elsevier_relevant(paper.get("title") or "", terms):
                continue
            seen_key.add(key)
            papers.append(paper)
            if len(papers) >= cap + 4:
                break
        if len(papers) >= cap + 4:
            break

    return {"results": papers[:cap], "queries": queries}
