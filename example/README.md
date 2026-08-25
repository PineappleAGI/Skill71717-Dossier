# Example fixture — Skill71717

Offline demo of Pineapple 71717 for the topic:

> Multimodal world models and video generation for planning — Sora-class video models used as simulators vs. generative media only

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

Or open [`dossier.html`](dossier.html) if it is already up to date.

## What's inside

| File | Role |
|---|---|
| `request.json` | Sample topic + material tracks |
| `harvest.json` | Mixed tracks: key references, research, industry, thesis, preprints |
| `enrichment.json` | Relevance scores and descriptions |
| `claims.json` | Cached stance classifications (supporting / contradicting / test / background) plus related debate rooms |
| `dossier.html` | Generated HTML dossier (Evidence Synthesis + Debate Arena) |
| `older-version/` | Snapshot of the prior build with Live debate + Belief Timeline |

Seed “commonly misunderstood” rooms live in `../data/seed-debates.json` (product-wide, not this topic). Three of those rooms ship with harvested for/against cards; the rest are coming-soon tiles.

## Ask the assistant

```text
Run Pineapple 71717 on the example request
```
