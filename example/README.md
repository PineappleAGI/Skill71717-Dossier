# Example fixture — Skill71717

Offline demo of Pineapple 71717 for the topic:

> Is ChatGPT better than Claude? — capability, safety, and human-preference comparisons of GPT-4-class models vs Anthropic Claude

## Quick look

Regenerate then open (do not hand-edit the HTML):

```bash
python3 scripts/generate-dossier.py \
  example/harvest.json \
  example/enrichment.json \
  example/dossier.html \
  --no-open

open example/dossier.html
```

Or serve it over HTTP (Mode 1 cannot run as `file://`):

```bash
python3 scripts/mode1-server.py --html example/dossier.html --port 8767
```

## What's inside

| File | Role |
|---|---|
| `request.json` | Sample topic + material tracks |
| `harvest.json` | Mixed tracks: key references, research, industry, thesis, preprints |
| `enrichment.json` | Relevance scores and descriptions |
| `claims.json` | Cached stance classifications (supporting / contradicting / test / background) |
| `dossier.html` | Generated HTML dossier (Mode 1 evidence synthesis) |
| `older-version/` | Snapshot of the prior build with Debate Arena, Live debate, and Belief Timeline |

## Ask the assistant

```text
Run Pineapple 71717 on the example request
```
