# Skill71717: Pineapple Research Materials

A downloadable agent skill for **anyone who wants to research specific topics** (students, researchers, etc.). You describe a research topic in a small local form; the skill harvests scholarly materials from public academic APIs, the assistant scores relevance and writes short descriptions, and you get **one self-contained HTML dossier** you can open in any browser.

> Point it at a research question. It returns a curated list of papers, preprints, and related links — with URLs, short descriptions, relevance scores, reading order, and coverage gaps — ready for a literature review or course project.

---

## Get It From GitHub

You only do this once.

### Step 1 — Make sure you have Python 3

Open a terminal and type:

```bash
python3 --version
```

If you see something like `Python 3.10.4` you're done. If you see `command not found`, install Python from <https://www.python.org/downloads/> and try again.

**No other tools to install.** No `pip install`, no `npm install`. The skill uses only the Python standard library. Academic APIs are called over HTTPS with `urllib`.

### Step 2 — Download the skill ZIP

1. Open <https://github.com/PineappleAGI/Skill71717-Dossier> in your browser
2. Click the green **Code** button → **Download ZIP**
3. Unzip it somewhere you'll remember (e.g. your Desktop or `~/Documents/`)
4. Open the unzipped `Skill71717-Dossier-main` folder

That folder is the skill.

### Step 3 — Open the skill folder in your editor

**For Cursor users:** open Cursor → **File → Open Folder…** → pick the `Skill71717-Dossier-main` folder. The skill is auto-registered via `.cursor/rules/research-materials.mdc` — nothing else to do.

**For Claude Code users:** copy the folder into your skills directory:

```bash
cp -r Skill71717-Dossier-main ~/.claude/skills/pineapple-research-materials
```

The skill is now available as `/pineapple-research-materials` inside Claude Code.

---

## Use It

### First: try the built-in example

There's a prebuilt dossier already inside `example/`. Run the skill on it first so you can see what the output looks like before starting a live search.

**In Cursor**, open the chat sidebar and paste:

```text
Run Pineapple 71717 on the example request
```

**In Claude Code**, type:

```text
/pineapple-research-materials
Run it on the example request
```

Or open `example/dossier.html` in your browser — that's what a finished run looks like, without calling the live APIs.

### Then: run a live research scan

**In Cursor:**

```text
Run Pineapple 71717 research materials
```

or:

```text
Find research materials on retrieval-augmented generation evaluation
```

**In Claude Code:**

```text
/pineapple-research-materials
```

Then sit back. The assistant will:

1. Start a tiny local intake page in your browser
2. Wait while you enter a topic and filters (year range, what to include, max results)
3. Harvest candidates across tracks from OpenAlex, arXiv, CrossRef, and Semantic Scholar
4. Enrich each item (relevance, short description, track confirmation, limitations)
5. Generate a timestamped HTML dossier under `.research-materials/`
6. Open the dossier in your browser

---

## What's In The Dossier

| Section | What you'll find |
|---|---|
| **Summary** | Topic, filters, material count, year span, open-access %, top venues |
| **Key references** | Widely recognized or highly cited starting points |
| **Research papers** | Peer-reviewed journal and conference work |
| **Industry reports** | Lab tech reports and company research notes |
| **Theses** | Dissertations |
| **Preprints** | Preprints (e.g. arXiv) not filed under another section |
| **What's missing from this list** | Gaps so you know where the pack is thin |
| **Searches to try next** | Follow-up queries for another harvest |
| **BibTeX** | Copy-friendly citations generated from harvested metadata |

Empty material sections are hidden. Each card includes relevance, a short description, why it matters, and limitations when available.

---

## License

MIT — see [LICENSE](LICENSE).

---

## The Pineapple Project Team

Made by:

- **Henry Zou** — [@HenryZou on LinkedIn](https://www.linkedin.com/in/cunhanzou/)
- **Jenny Zheng** — [@JennyZheng on LinkedIn](https://www.linkedin.com/in/jenzheny/)

> In the coming era of AGI, building solutions becomes a collective process akin to a pineapple, where technical and non-technical contributors fuse like individual berries into a unified, organic whole. This partnership mirrors the 8 & 13 dual spirals of the Fibonacci sequence, intertwining creative human intent with AI-driven structural analysis to assemble a perfect, high-resolution context for building at the speed of thought.
