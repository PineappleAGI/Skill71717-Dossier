# Example fixture — Skill71717

Offline demo of Pineapple 71717 for the topic:

> Is ChatGPT better than Claude? — capability, safety, and human-preference comparisons of GPT-4-class models vs Anthropic Claude

## Quick look

`dossier.html` is a **static snapshot** of a finished result. Open it in a browser (a file is fine). It does not search live APIs.

Regenerate then open (do not hand-edit the HTML):

```bash
python3 scripts/generate-dossier.py \
  example/harvest.json \
  example/enrichment.json \
  example/dossier.html \
  --static \
  --no-open

open example/dossier.html
```

## What's inside

| File | Role |
|---|---|
| `request.json` | Sample topic + material tracks |
| `harvest.json` | Mixed tracks: key references, research, industry, thesis, preprints |
| `enrichment.json` | Relevance scores and descriptions |
| `claims.json` | Cached stance classifications (supporting / contradicting / test / background) |
| `dossier.html` | Static snapshot of a finished Mode 1 dossier (no live search) |
| `older-version/` | Snapshot of the prior build with Debate Arena, Live debate, and Belief Timeline |

## Ask the assistant

```text
Run Pineapple 71717 on the example request
```
