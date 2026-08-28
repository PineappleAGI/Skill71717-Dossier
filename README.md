# Skill71717: Pineapple Research Materials

A downloadable agent skill for **anyone who wants to research specific topics** (students, researchers, etc.). You type a question in a small local form; the skill harvests scholarly sources from public academic APIs, sorts them by how they speak to the question (supports / contradicts / test conditions / background), and builds **one self-contained HTML dossier** served in your browser.

> Point it at a research question. You get an article you can share, the evidence for and against, what’s missing, and the papers behind it — triage for a literature review, not a finished bibliography.


<img width="1056" height="791" alt="Screenshot 2026-08-28 at 12 44 11" src="https://github.com/user-attachments/assets/d9170136-d4dc-4136-beaf-67d6868351ec" />
<img width="1035" height="857" alt="Screenshot 2026-08-28 at 12 44 35" src="https://github.com/user-attachments/assets/b4ec723a-3da2-45fb-904d-1f67093a332c" />

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

The example is based on **Is ChatGPT better than Claude?** Open `example/dossier.html` in your browser to see a finished page (no live APIs).

### Then: run a live research scan

**In Cursor:**

```text
Run Pineapple 71717 research materials
```

**In Claude Code:**

```text
/pineapple-research-materials
```

Then sit back. The assistant will:

1. Open one local page at **http://127.0.0.1:8767/** — the question form
2. Wait while you enter a question and filters (year range, what to include, max results) and click **Start harvest**
3. Rewrite a chatty question into a searchable scientific one (you still see both on the page)
4. Harvest candidates from OpenAlex, arXiv, CrossRef, and Semantic Scholar
5. Label each paper’s stance toward the question, drop off-topic items, and note gaps
6. Generate a timestamped HTML dossier under `.research-materials/`
7. Turn that same browser tab into the finished dossier

Keep the waiting tab open if you can. If you close it after submit, the dossier reopens once when it is ready. **Ask another question** on the page stays in the same tab.

---

## What's In The Dossier

| Section | What you'll find |
|---|---|
| **You typed / Interpreted as** | Everyday wording, the scientific question, field, years, tracks |
| **The article** | A short shareable piece: the question, the yes case, the no case, what’s missing. **Copy article**, **Download as Image**, **Download PDF** |
| **The evidence** | Supporting vs contradicting / limiting papers, with a PRISMA-style pipeline behind the results |
| **How confident is this?** | A simple read of how split the closer evidence is |
| **Related papers** | Nearby highly cited work |
| **Briefing** | Key references, BibTeX, gaps, searches to try next |
| **How this question maps** | Terms from the question and related phrases in the harvested titles/abstracts, with **Download map** |

This is triage from titles and abstracts, not a finished systematic review. Verify primary sources before you cite.

---

## License

MIT — see [LICENSE](LICENSE).

---

## The Pineapple Project Team

Made by:

- **Henry Zou** — [@HenryZou on LinkedIn](https://www.linkedin.com/in/cunhanzou/)
- **Jenny Zheng** — [@JennyZheng on LinkedIn](https://www.linkedin.com/in/jenzheny/)

> In the coming era of AGI, building solutions becomes a collective process akin to a pineapple, where technical and non-technical contributors fuse like individual berries into a unified, organic whole. This partnership mirrors the 8 & 13 dual spirals of the Fibonacci sequence, intertwining creative human intent with AI-driven structural analysis to assemble a perfect, high-resolution context for building at the speed of thought.
