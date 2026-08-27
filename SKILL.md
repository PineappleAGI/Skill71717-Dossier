---
name: pineapple-research-materials
description: Skill71717 — Pineapple Research Materials. Harvest scholarly sources, classify each paper's stance toward a research question (supports / contradicts / test conditions / background), drop off-topic items, and generate a single HTML dossier. Use when the user wants literature, papers, a lit-review starter pack, or says Pineapple 71717.
---

# Skill71717: Pineapple Research Materials

Generate a single interactive HTML **research dossier** from a topic: URLs, short descriptions, relevance scores, what’s missing, and searches to try next — for students and professional researchers.

## Core Principles

1. **Hybrid Intake** — A local HTML form captures topic + filters; submit writes `raw_submission.json`. The assistant interprets that into `request.json` before harvest.
2. **Scripted Harvest** — `harvest-sources.py` pulls OpenAlex / arXiv / CrossRef / Semantic Scholar (Python stdlib only).
3. **Claim classification** — `classify-claims.py` calls the Claude API once per uncached paper (title + abstract) and caches stance in `claims.json`.
4. **Single HTML Output** — One self-contained dossier with embedded CSS; Google Fonts are the only external dependency.
5. **Sectioned by epistemic role** — Evidence supporting, contradicting/limiting, test conditions, then collapsed background. Off-topic papers are dropped.
6. **Academic Integrity** — Surface DOI, venue, year, OA; never bypass paywalls; remind users to verify primary sources.

## Non-Negotiable Rules

- **MUST NOT ask setup questions** after the form. Defaults come from the submitted `raw_submission.json` / enriched `request.json`.
- **MUST NOT wait for a follow-up chat** after **Start harvest**. Poll until the form writes `raw_submission.json`, then immediately run Phase 1b → harvest → classify (if possible) → enrich → generate → open. Do not stop after harvest. Do not ask “did you submit?”
- Output MUST be a single `.html` dossier (plus optional font CDN).
- Every dossier MUST embed the full contents of `visualization-base.css`.
- **MUST NOT invent DOIs, URLs, or citation counts.** Only use harvested fields; mark missing data clearly.
- Enrichment `relevance_score` is an integer 0–100 with a one-sentence `relevance_rationale`.
- Prefer publisher/DOI landing pages over bare arXiv links when both exist.
- Industry items MUST have a real verified URL and an organization when known.
- Generate with `generate-dossier.py --no-open`. Open the dossier **once** over HTTP via `scripts/mode1-server.py` (not `file://`).
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
- Tell the user the form opened at `http://127.0.0.1:8765/` and to click **Start harvest**. Say you will pick it up from there — they do not need to message again.
- **Do not end the turn.** Wait for the form:

```bash
python SKILL_ROOT/scripts/wait-for-submission.py RUNTIME_DIR --timeout 600
```

On Cursor, set the Shell `block_until_ms` above the wait timeout (e.g. 610000) so the command is not backgrounded before submit.

- When that exits 0, `RUNTIME_DIR/raw_submission.json` exists. Immediately run Phase 1b (do not harvest yet), then Phases 2–4 in the same run.
- If wait times out, tell the user the form is still at `http://127.0.0.1:8765/` and keep waiting if they still want a dossier.
- If the user pastes a topic in chat instead, you MAY write `request.json` yourself with a sharpened `topic` (and `original_topic` if you rewrote it), sensible defaults (`material_tracks` all five, year_from=2018, year_to=current, max_results=20, audience=lit_review), and skip waiting on the form **and skip Phase 1b** — but still prefer the form when they invoked the skill without a topic.

### `request.json` schema

```json
{
  "topic": "string",
  "original_topic": "optional string — raw form wording if Phase 1b rewrote topic",
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

## Phase 1b — Enrich the raw submission (form path only)

This phase runs **only** after the intake form writes `RUNTIME_DIR/raw_submission.json`. Skip it for chat-pasted topics (you already wrote `request.json`), example mode, replay, and regen.

1. Read `RUNTIME_DIR/raw_submission.json`.
2. **Interpret the question.** Form wording is often chatty, ungrammatical, or missing a population / comparison / outcome. Rewrite it as a single searchable research question (who, exposure, comparison, outcome). Store the form text as `original_topic` and the sharpened question as `topic`. Do **not** paste the raw form sentence into the dossier or the harvest query as-is.
   - Example: *is college student eating lots of eggs vs meat or fish as a source of protein safe for cardiovascular health for the long term?* → `original_topic` stays that sentence; `topic` becomes *In college-aged young adults, is high egg intake as a protein source associated with worse long-term cardiovascular outcomes than protein from meat or fish?*
3. **Discipline:** if blank, generic, or mismatched to the sharpened question, fill in a concise field name a researcher in that area would use (e.g. `nutritional epidemiology`, `NLP`, `energy systems`). Keep the user's text when it is already specific.
4. **Seed queries:** add up to **4** `seed_queries` from the sharpened question. Phrase them like real paper titles in that discipline — noun-heavy scholarly titles, not keyword Boolean soup and not the topic copied four times. These go to OpenAlex as extra recall queries.
5. **Year range:** if `year_from` / `year_to` is missing, inverted, or implausible for the topic, correct it. Keep a reasonable user-chosen window.
6. Optionally add `stance_definitions.supports` / `contradicts` so classification uses this question, not leftover defaults.
7. Write the enriched object as `RUNTIME_DIR/request.json` using the schema above. Preserve `material_tracks`, `max_results`, `audience`, `submitted_at`, and `skill` unless a value is invalid.

Do **not** harvest from `raw_submission.json`. Do **not** ask the user questions. Then continue to Phase 2 **in the same run**.

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

If harvest returns 0 materials, tell the user and offer to broaden years or rephrase the topic — do not fabricate papers. Otherwise continue immediately to Phase 3 (do not wait for the user).

---

## Phase 3 — Claim classification

```bash
python SKILL_ROOT/scripts/classify-claims.py RUNTIME_DIR/harvest.json RUNTIME_DIR --enrichment RUNTIME_DIR/enrichment.json
```

Requires `ANTHROPIC_API_KEY` for papers not already in `claims.json`. Cached items are skipped. Empty or broken abstracts are marked skipped and dropped from the dossier.

If the API key is missing, **skip this phase** and continue to 3b + generate + open. Do not stall the dossier on classification.

Writes `RUNTIME_DIR/claims.json` keyed by paper `id` (`stance`, `confidence`, `evidence_strength`, `one_line_claim`, `relevance`).

Off-topic papers (`relevance == "off_topic"`) are not rendered. Low-relevance papers are shown dimmed.

---

## Phase 3b — Enrichment notes (gaps + inquiry lens)

Read `harvest.json` + `request.json` + `claims.json`. Write `RUNTIME_DIR/enrichment.json`.

### `enrichment.json` schema

```json
{
  "coverage_gaps": ["Plain-language note about what this list is missing"],
  "suggested_next_queries": ["Follow-up search strings a person can paste next"],
  "inquiry_classification": {
    "title": "Research Question Framework",
    "core_inquiry": {"label": "Comparative / Benchmarking", "detail": "Why this lens"},
    "epistemic_rigor": {"label": "Foundational or frontier", "detail": "Evidence mix"},
    "scope_boundary": {"label": "What is in vs out", "detail": "Years, fields, exclusions"}
  },
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

- Write `inquiry_classification` (core inquiry intent, epistemic rigor, scope boundary) so the dossier can show the scan’s lens below the hero.
- Coverage gaps and next queries remain required; per-paper stance comes from `claims.json`, not from invented key_claims.
- Do not keep placeholder lines like “Contributes evidence or framing related to…” — re-run classification instead.
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

Then serve and open **once** over HTTP (Mode 1 cannot run as `file://`):

```bash
python SKILL_ROOT/scripts/mode1-server.py --stop
python SKILL_ROOT/scripts/mode1-server.py --html RUNTIME_DIR/dossier-YYYYMMDD-HHMMSS.html --port 8767
```

The generated page must prefill the interpreted `topic` (and show `original_topic` when it differs). Mode 1 auto-starts the live search from that question.

Tell the user the dossier is at `http://127.0.0.1:8767/`. Do not wait for them to ask you to open it.

Dossier UI contracts:

- The dossier is a single Mode 1 PRISMA flow matching the Claude Design layout. The research question comes from the Phase 1 form (`original_topic` / interpreted `topic`). **Ask another question** sits on the sticky PRISMA bar and opens `http://127.0.0.1:8767/ask`; after submit, wait for a new `raw_submission.json` with `wait-for-submission.py` (it ignores a prior run’s file) and rerun Phase 1b → harvest → generate → serve. Page order: restatement card (You typed / Interpreted as, field/years/tracks chips) → collapsible **A lighter read** blog essay → jump nav → **The evidence** (pipeline + KPIs + two-column supporting/contradicting cards) → **How confident is this?** (Beta posterior) → **Related papers** → **Briefing and what's missing** (pull-quote, inquiry framework, key references, BibTeX, gaps) → **How this question maps** (each question term with related phrases from harvested titles/abstracts) → Pineapple Project footer. The top bar is stacked **Pineapple 71717 / RESEARCH DOSSIER**, a **Print view** / **Reading view** toggle under the wordmark, and a gold **Built by The Pineapple Project Nº 71717** stamp on the right. The toggle sets `data-m1-theme="press"`. The PRISMA bar (**Follows PRISMA** + The question / Results / Briefing) sticks after you scroll past it and highlights the section in view. The essay is about the question itself (not an evidence-count recap), with an editorial photo and/or sketch graph when the topic supports it (captioned as not a study result). Share controls: **Copy article** next to the byline; **Download cover** (1200×630); **Download as Image**; **Download PDF**. Never `window.print()`. Pipeline work behind Results is **Search** → **Screen & rank** → **Extract** → **Evaluate**, live in the evidence section. Restatement has no “Not quite” / “Use my correction” gate. Unclear abstracts are omitted from the bar. Related papers use OpenAlex `cited_by_count`, not news or forum rankings. Search starts as soon as the restatement is shown. Mode 1 does not offer a second question rewrite or a Boolean editor. Serve via `scripts/mode1-server.py`.
- No audience chip; **Generated** is date-only (`YYYY-MM-DD`)
- Confidence is a dot + thin bar, not a large score chip
- Debate Arena is not in this version; a prior snapshot is `example/older-version/`

Example mode may write to `example/dossier.html` or open the committed file.

---

## Phase 5 — Wrap Up

1. `python SKILL_ROOT/scripts/intake-server.py --stop`
2. Chat summary:
   - Topic
   - Counts per stance (supporting / contradicting / test conditions / background; off-topic dropped)
   - Top in-scope materials (title + year + stance + URL)
   - 2–3 “what's missing” notes
   - Path to the dossier HTML
3. Remind: verify primary sources before citing; dossier is triage, not a finished bibliography.

---

## Example Mode (no live APIs)

```text
Run Pineapple 71717 on the example request
```

1. Use `example/request.json`, `example/harvest.json`, `example/enrichment.json`, `example/claims.json`
2. Classify only if claims are missing (`ANTHROPIC_API_KEY` required for uncached papers):

```bash
python scripts/classify-claims.py example/harvest.json example --enrichment example/enrichment.json
```

3. Regenerate (do not hand-edit HTML):

```bash
python scripts/generate-dossier.py example/harvest.json example/enrichment.json example/dossier.html --no-open
python scripts/mode1-server.py --html example/dossier.html --port 8767
```

---

## Tool Mapping

| SKILL.md | Cursor | Claude Code |
|---|---|---|
| Read / Write | Read / Write | Read / Write |
| Shell | Shell | Bash |
| Web search | WebSearch / WebFetch | WebSearch |

## Supporting Files

- `scripts/wait-for-submission.py` — blocks until the form writes `raw_submission.json`
- `scripts/harvest-sources.py`
- `scripts/classify-claims.py`
- `scripts/generate-dossier.py`
- `scripts/mode1-flow.js` — Mode 1 PRISMA client flow (embedded)
- `scripts/mode1-server.py` — local HTTP server + PubMed/Europe PMC/trials/OpenAlex/Unpaywall proxy
- `scripts/evidence_apis.py` — public REST clients used by the Mode 1 server
- `visualization-base.css`
- `example/` — demo fixtures + prebuilt dossier
