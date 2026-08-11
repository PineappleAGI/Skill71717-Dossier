---
name: pineapple-research-materials
description: Skill71717 — Pineapple Research Materials. Open a professional intake form, harvest scholarly and industry sources from academic APIs, enrich with relevance scoring, and generate a single HTML research dossier sectioned by key references, research papers, industry reports, theses, and preprints. Use when the user wants literature, papers, theses, industry reports, a lit-review starter pack, or says Pineapple 71717.
---

# Skill71717: Pineapple Research Materials

Generate a single interactive HTML **research dossier** from a topic: URLs, short descriptions, relevance scores, what’s missing, and searches to try next — for students and professional researchers.

## Core Principles

1. **Hybrid Intake** — A local HTML form captures topic + filters; submit writes `request.json`.
2. **Scripted Harvest** — `harvest-sources.py` pulls OpenAlex / arXiv / CrossRef / Semantic Scholar (Python stdlib only) with **multi-track budgets**.
3. **AI Enrichment** — The assistant scores relevance, writes descriptions, confirms tracks, and notes gaps.
4. **Single HTML Output** — One self-contained dossier with embedded CSS; Google Fonts are the only external dependency.
5. **Sectioned materials** — Key references, Research papers, Industry reports, Theses, Preprints (empty sections omitted).
6. **Academic Integrity** — Surface DOI, venue, year, OA, citations; never bypass paywalls; remind users to verify primary sources.

## Non-Negotiable Rules

- **MUST NOT ask setup questions** after the form. Defaults come from the submitted `request.json`.
- Output MUST be a single `.html` dossier (plus optional font CDN).
- Every dossier MUST embed the full contents of `visualization-base.css`.
- **MUST NOT invent DOIs, URLs, or citation counts.** Only use harvested fields; mark missing data clearly.
- Enrichment `relevance_score` is an integer 0–100 with a one-sentence `relevance_rationale`.
- Prefer publisher/DOI landing pages over bare arXiv links when both exist.
- Industry items MUST have a real verified URL and an organization when known.
- Open the dossier **once** (`generate-dossier.py --no-open`, then `open` / `xdg-open`).
- Stop the intake server when the run finishes: `python scripts/intake-server.py --stop`.
- **Do not hand-edit generated HTML.** Change scripts/fixtures, then regenerate with `generate-dossier.py`.

## Product Positioning

- A literature triage tool spanning academic papers, industry reports, theses, and widely recognized references
- A collaboration aid between advisors and students (shared HTML artifact)
- An educational layer: shows *why* a source was selected, not only that it exists

---

## Phase 0 — Mode Detect

| User intent | Mode |
|---|---|
| "Run Pineapple 71717 on the example" / "use example request" | **example** — skip intake; use `example/request.json` |
| "Run Pineapple 71717" / "find research materials" / topic in chat without form | **live** — start intake server |
| User already provided a completed `request.json` path | **replay** — skip intake |
| Harvest + enrichment exist; "regenerate dossier" | **regen** — skip harvest/enrich |

Resolve `SKILL_ROOT` = directory containing this `SKILL.md`.

Runtime dir (live/replay):

- Prefer `<workspace>/.research-materials/` if the user has a project open
- Else `SKILL_ROOT/.research-materials/`

Example mode uses `SKILL_ROOT/example/` as both input and (optional) output parent.

---

## Phase 1 — Intake (live mode only)

```bash
python SKILL_ROOT/scripts/intake-server.py --port 8765 --out RUNTIME_DIR
```

- Run in background.
- Tell the user the form opened at `http://127.0.0.1:8765/` and to click **Start harvest**.
- Poll until `RUNTIME_DIR/request.json` exists (check every 2s; timeout ~10 minutes).
- If the user pastes a topic in chat instead, you MAY write `request.json` yourself with sensible defaults (`material_tracks` all five, year_from=2018, year_to=current, max_results=20, audience=lit_review) and skip waiting on the form — but still prefer the form when they invoked the skill without a topic.

### `request.json` schema

```json
{
  "topic": "string",
  "discipline": "string",
  "year_from": 2020,
  "year_to": 2026,
  "material_tracks": ["key_reference", "research", "industry", "thesis", "preprint"],
  "max_results": 50,
  "audience": "lit_review",
  "seed_queries": ["optional extra OpenAlex queries for recall"],
  "submitted_at": "ISO-8601",
  "skill": "pineapple-71717"
}
```

`seed_queries` (optional): up to 12 short OpenAlex queries to pull known landmarks / industry reports the main topic phrase might miss.

`seed_materials` (optional): fully specified material objects (`id`, `title`, `track`, `url`, …) that are **pinned** into the harvest so demos and must-cite works are not dropped by API recall.

`material_tracks` values:

| Track | Meaning |
|---|---|
| `key_reference` | Highly cited / widely recognized starting points |
| `research` | Peer-reviewed journal and conference work |
| `industry` | Lab tech reports and company research notes |
| `thesis` | Dissertations |
| `preprint` | Preprints (e.g. arXiv) not filed under another section |

`audience` guides enrichment tone only (`lit_review` | `thesis` | `coursework` | `industry`) — **never shown** on the dossier hero.

---

## Phase 2 — Harvest

```bash
python SKILL_ROOT/scripts/harvest-sources.py RUNTIME_DIR/request.json RUNTIME_DIR
```

Optional: `export RESEARCH_CONTACT_EMAIL=you@university.edu` before harvest.

Produces `RUNTIME_DIR/harvest.json` with `materials[]`:

| Field | Notes |
|---|---|
| `id` | Stable id (`openalex:…`, `arxiv:…`, `web:…`, …) |
| `title`, `authors`, `year`, `venue` | Metadata |
| `organization` | Optional company/lab for industry |
| `url`, `doi` | Prefer DOI/publisher over arXiv when possible |
| `type` | journal / preprint / thesis / dataset / standard / web |
| `track` | key_reference / research / industry / thesis / preprint |
| `open_access`, `citation_count`, `abstract` | May be null |
| `source_apis` | Provenance list |

Harvest already:

- Runs OpenAlex relevance + highly-cited + dissertation queries
- Pulls arXiv when `preprint` enabled
- Assigns `track` via heuristics (thesis type, industry org hints, citation threshold, preprint)

If harvest returns 0 materials, tell the user and offer to broaden years or rephrase the topic — do not fabricate papers.

---

## Phase 3 — AI Enrichment

Read `harvest.json` + `request.json`. Write `RUNTIME_DIR/enrichment.json`.

### `enrichment.json` schema

```json
{
  "coverage_gaps": ["Plain-language note about what this list is missing"],
  "suggested_next_queries": ["Follow-up search strings a person can paste next"],
  "materials": [
    {
      "id": "must match harvest id",
      "track": "research",
      "relevance_score": 86,
      "relevance_rationale": "Why this helps the topic",
      "short_description": "2–3 sentences, plain academic English",
      "key_claims": ["Claim 1", "Claim 2"],
      "limitations": "Scope, method, or recency caveats",
      "best_for": "e.g. Methods section / Related work framing"
    }
  ],
  "web_materials": []
}
```

Optional legacy fields (`research_question_restatement`, `theme_clusters`, `reading_order`) may exist in older fixtures but are **not rendered**.

### Authoring rules

- Score every harvested item; do not drop items silently (low scores are fine).
- Confirm or correct each item’s `track` when harvest is unsure (especially industry vs research).
- For **key_reference**: say why it is canonical (citations, survey status, defines the paradigm).
- For **industry**: require real URL + organization; label tech report / blog / whitepaper in the description when clear.
- For **thesis**: note university when available.
- `short_description` MUST NOT invent experimental results not present in title/abstract.
- Match `audience` tone: coursework → accessible; thesis → method/gap awareness; industry → applicability; lit_review → scholarly survey.
- You may add up to **5** verified industry/web items via `web_materials` (and matching enrichment `materials` entries) with real URLs only — generator merges `web_materials` into the dossier.

---

## Phase 4 — Generate Dossier

Timestamped output:

```bash
python SKILL_ROOT/scripts/generate-dossier.py \
  RUNTIME_DIR/harvest.json \
  RUNTIME_DIR/enrichment.json \
  RUNTIME_DIR/dossier-YYYYMMDD-HHMMSS.html \
  --no-open
```

Then open once:

```bash
open RUNTIME_DIR/dossier-….html          # macOS
xdg-open RUNTIME_DIR/dossier-….html      # Linux
```

Dossier UI contracts:

- Hero shows **topic only** (no restatement lede)
- No Researcher/Quick scan toggle
- No audience chip; **Generated** is date-only (`YYYY-MM-DD`)
- Materials are **sectioned** by track
- Sidebar: **What's missing from this list**, **Searches to try next**, **BibTeX**
- No footer disclaimer block

Example mode may write to `example/dossier.html` or open the committed file.

---

## Phase 5 — Wrap Up

1. `python SKILL_ROOT/scripts/intake-server.py --stop`
2. Chat summary:
   - Topic
   - Counts per track
   - Top materials (title + year + track + relevance + URL)
   - 2–3 “what's missing” notes
   - Path to the dossier HTML
3. Remind: verify primary sources before citing; dossier is triage, not a finished bibliography.

---

## Example Mode (no live APIs)

```text
Run Pineapple 71717 on the example request
```

1. Use `example/request.json`, `example/harvest.json`, `example/enrichment.json`
2. Regenerate (do not hand-edit HTML):

```bash
python scripts/generate-dossier.py example/harvest.json example/enrichment.json example/dossier.html --no-open
open example/dossier.html
```

---

## Tool Mapping

| SKILL.md | Cursor | Claude Code |
|---|---|---|
| Read / Write | Read / Write | Read / Write |
| Shell | Shell | Bash |
| Web search | WebSearch / WebFetch | WebSearch |

## Supporting Files

- `scripts/intake-server.py`
- `scripts/harvest-sources.py`
- `scripts/generate-dossier.py`
- `visualization-base.css`
- `example/` — demo fixtures + prebuilt dossier
