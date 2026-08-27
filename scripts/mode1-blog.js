/* Skill71717 — Mode 1 blog post (opens the dossier) plus print-to-PDF.
   Isolated from the briefing. Reads only extracted Mode 1 fields. */
(function (root) {
  "use strict";

  var DISCLAIMER =
    "A conversation piece, not medical, legal, or financial advice.";

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function unwrap(list) {
    return (list || []).map(function (x) { return x.row || x; });
  }

  function stripTags(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function firstSentences(text, maxChars) {
    var t = stripTags(text);
    if (!t) return "";
    if (t.length <= maxChars) return t;
    var cut = t.slice(0, maxChars);
    var m = cut.match(/^(.*?[.!?])(\s|$)/);
    if (m && m[1].length > 70) return m[1];
    return cut.replace(/\s+\S*$/, "") + "…";
  }

  function lcFirst(s) {
    s = String(s || "");
    if (!s) return "";
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  function paperOf(row) {
    return (row && row.paper) || {};
  }

  function hrefOf(paper) {
    if (!paper) return "";
    if (paper.url) return paper.url;
    if (paper.doi) {
      var d = String(paper.doi).replace(/^https?:\/\/doi\.org\//i, "");
      return "https://doi.org/" + d;
    }
    if (paper.pmid) return "https://pubmed.ncbi.nlm.nih.gov/" + paper.pmid + "/";
    return "";
  }

  function authorsLine(paper) {
    var a = (paper && paper.authors) || [];
    if (typeof a === "string") return a || "";
    var names = a.filter(Boolean);
    if (!names.length) return "";
    if (names.length > 8) return names.slice(0, 8).join(", ") + ", et al.";
    return names.join(", ");
  }

  function lastName(row) {
    var paper = paperOf(row);
    var first = String((paper.authors || [])[0] || "").replace(/,.*$/, "").trim();
    if (/^authors unavailable$/i.test(first)) first = "";
    if (!first) return "";
    var parts = first.split(/\s+/);
    var last = parts[parts.length - 1];
    if (parts.length >= 2 && /^[A-Za-z]{1,3}\.?$/.test(last)) return parts[0];
    return last || first;
  }

  function venueYear(row) {
    var paper = paperOf(row);
    var venue = String(paper.venue || "").trim();
    var year = paper.year || "";
    if (venue && !/^journal$|^doi\.org$/i.test(venue) && !/^https?:/i.test(venue)) {
      return year ? venue + ", " + year : venue;
    }
    return year ? String(year) : "";
  }

  function cite(row) {
    var name = lastName(row);
    var vy = venueYear(row);
    if (name && vy) return name + " (" + vy + ")";
    if (name) return name;
    if (vy) return vy;
    return "";
  }

  function hasAbstract(row) {
    return stripTags(paperOf(row).abstract).length >= 80;
  }

  function titleKey(row) {
    return String(paperOf(row).title || "").toLowerCase();
  }

  function uniqueRows(list) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (row) {
      var k = titleKey(row);
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(row);
    });
    return out;
  }

  function typeRank(row) {
    var t = row.studyType || "";
    if (t === "RCT") return 0;
    if (t === "review") return 1;
    if (t === "observational") return 2;
    return 3;
  }

  function catchHeadline(question) {
    var q = String(question || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
    if (!q) return "What did this scan of the papers find?";

    var pop = "";
    var inM = q.match(/^In\s+([^,]{3,90}),\s+(.*)$/i);
    if (inM && inM[2].length > 24) {
      pop = inM[1]
        .replace(/^college-aged young adults$/i, "college-aged adults")
        .replace(/^young adults$/i, "young adults");
      q = inM[2];
    }

    if (/^is college students?\s+eating\s+/i.test(q)) {
      q = q.replace(/^is college students?\s+eating\s+/i, "Is eating ");
      if (!pop) pop = "college students";
    }

    q = q
      .replace(/\bhigh egg intake\b/gi, "eating a lot of eggs")
      .replace(/\bas a protein source\b/gi, "for protein")
      .replace(/\bas a source of protein\b/gi, "for protein")
      .replace(/\bassociated with worse\b/gi, "worse for")
      .replace(/\blong-term cardiovascular outcomes\b/gi, "long-term heart health")
      .replace(/\bcardiovascular health for the long term\b/gi, "the heart in the long run")
      .replace(/\bsafe for cardiovascular health\b/gi, "safe for the heart")
      .replace(/\bfor the long term\b/gi, "in the long run")
      .replace(/\bthan protein from\b/gi, "than")
      .replace(/\bvs\.?\b/gi, "versus")
      .replace(/\s{2,}/g, " ")
      .trim();

    q = q.replace(
      /\s+versus\s+([^—,.]+?)\s+for protein\s+/i,
      " for protein — versus $1 — "
    );

    if (pop && !new RegExp(pop.split(/\s+/)[0], "i").test(q)) {
      if (/^(is|are|do|does|can|could|should)\b/i.test(q)) {
        q = "For " + pop + ", " + q.charAt(0).toLowerCase() + q.slice(1);
      }
    }

    q = q.charAt(0).toUpperCase() + q.slice(1);
    if (!/\?$/.test(q)) q += "?";
    return q;
  }

  function spokenQuestion(question) {
    var q = String(question || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
    var m = q.match(/^In\s+[^,]{3,80},\s+(.*)$/i);
    if (m && m[1].length > 24) q = m[1];
    if (!q) return "this question";
    q = q.charAt(0).toLowerCase() + q.slice(1);
    if (!/[.!?]$/.test(q)) q += "?";
    return q;
  }

  function aboutCollege(q) {
    return /\bcollege|student|campus|dorm|freshman|undergrad\b/i.test(q);
  }

  function aboutHeart(q) {
    return /\bheart|cardio|cholesterol|cardiovascular\b/i.test(q);
  }

  function aboutEggsMeatFish(q) {
    return /\beggs?\b/i.test(q) && /\bmeat|fish|protein\b/i.test(q);
  }

  function heroCaption() {
    return "Eggs, chicken, and salmon on one tray — the comparison the question keeps staging. Editorial photo, not a study figure.";
  }

  function chartCaption() {
    return "An editorial sketch of how loud each worry feels in a dining line — not a study result, and not numbers from the papers.";
  }

  function sketchBars() {
    return [
      { label: "Cheap and fast", v: 0.90 },
      { label: "Tastes good tonight", v: 0.72 },
      { label: "Sounds like the healthy pick", v: 0.54 },
      { label: "Heart in forty years", v: 0.18 },
    ];
  }

  function heroFigureHtml() {
    var src = root.M1_BLOG_HERO;
    if (!src) return "";
    var w = root.M1_BLOG_HERO_W || 1100;
    var h = root.M1_BLOG_HERO_H || 733;
    return (
      '<figure class="m1-blog-hero">' +
      '<img src="' + src + '" width="' + w + '" height="' + h +
      '" alt="A breakfast tray with fried eggs, roasted chicken, and salmon">' +
      "<figcaption>" + esc(heroCaption()) + "</figcaption>" +
      "</figure>"
    );
  }

  function sketchChartHtml() {
    var bars = sketchBars();
    var rowH = 54;
    var top = 2;
    var w = 640;
    var h = top + bars.length * rowH;
    var barH = 16;
    var svg = bars.map(function (b, i) {
      var y = top + i * rowH;
      var bw = Math.max(10, Math.round(b.v * w));
      return (
        "<g>" +
        '<text x="0" y="' + (y + 13) + '" fill="#3d4a5c" font-size="13" font-family="Source Sans 3, Helvetica, sans-serif">' +
        esc(b.label) + "</text>" +
        '<rect x="0" y="' + (y + 20) + '" width="' + w + '" height="' + barH + '" rx="4" fill="#ece7dc"></rect>' +
        '<rect x="0" y="' + (y + 20) + '" width="' + bw + '" height="' + barH + '" rx="4" fill="#2f6f4e"></rect>' +
        "</g>"
      );
    }).join("");
    return (
      '<figure class="m1-blog-chart-wrap">' +
      '<p class="m1-blog-chart-title">What the dining line actually weighs</p>' +
      '<svg class="m1-blog-chart" viewBox="0 0 ' + w + " " + h +
      '" role="img" aria-label="Editorial sketch of dining-line priorities, not study data">' +
      svg +
      "</svg>" +
      "<figcaption>" + esc(chartCaption()) + "</figcaption>" +
      "</figure>"
    );
  }

  function lightEssay(question, headline) {
    var q = String(question || "") + " " + String(headline || "");
    var paras = [];

    paras.push(
      "Some questions show up with a clipboard. This one usually shows up with a plate. " +
      "You ask a roommate, a parent, or the internet at 11 p.m. — not because you want a lecture, but because tomorrow morning you have to choose something."
    );

    if (aboutCollege(q)) {
      paras.push(
        "College is when eating stops being a family script and starts being improvisation. The dining hall is open. The fridge is a rumor. Eggs are cheap, fast, and always there. Chicken looks like the “serious” option. Fish sounds like the adult in the room. You are not designing a diet so much as surviving a week."
      );
      paras.push(
        "That is why the question nags. Four years of whatever-is-easy can quietly become the next forty years of whatever-is-normal. Nobody is thinking about their arteries in line for breakfast. They are thinking about class, sleep, and whether the hot sauce is out."
      );
    } else {
      paras.push(
        "The question sticks because it lives in repetition. You do the thing once because it is convenient. You do it again because it worked. Only later does it start to sound like a long-term plot."
      );
    }

    if (aboutEggsMeatFish(q) && aboutHeart(q)) {
      paras.push(
        "Eggs have a whole folklore. They are the perfect food, or they are walking cholesterol, depending on who is talking and what year it is. Meat is comfort and suspicion in the same bite. Fish gets a halo it did not ask for. Protein is the alibi that lets the argument into the room."
      );
      paras.push(
        "Then someone says the word heart, and a boring breakfast turns cinematic. As if one food were a villain and another a rescue. Real plates are messier. What else is on the tray. How the rest of the week looks. Whether “lots of eggs” means a careful habit or a three-carton week with no vegetables in sight. The comparison is sneakier than eggs versus fish, as if those were the only two characters in the story."
      );
      paras.push(
        "People want a clean yes or no because the dining line does not offer footnotes. Food culture loves a simple moral: this is safe, that is dangerous, switch and be saved. A lighter way to hold the question is to treat it as a conversation with your future self, not a quiz you have to ace before lunch."
      );
      paras.push(
        "So keep asking it, gently. Notice what you actually reach for when you are tired. Leave room for fish when you want it, eggs when they make the morning possible, and the idea that one protein source is rarely the whole plot. You do not need a verdict. You need a relationship with food that still feels like yours in ten years."
      );
    } else {
      paras.push(
        "The question is dressed as a comparison because comparisons feel actionable. One thing versus another. A better bet. A safer lean. Life rarely holds still long enough for that kind of scoreboard, which is exactly why the question keeps coming back."
      );
      paras.push(
        "A lighter way to live with it: stay curious, stay un-dramatic, and notice what you do when nobody is grading you. You do not need a final answer tonight. You need a way of choosing that you can still respect when the hype moves on."
      );
    }

    return paras;
  }

  function todayLabel() {
    try {
      return new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch (err) {
      return "";
    }
  }

  function buildBlogArticle(ctx) {
    ctx = ctx || {};
    var question = ctx.question || "";
    var headline = catchHeadline(question);
    var qAll = question + " " + headline;
    return {
      headline: headline,
      dek: "A lighter take on a question people actually ask.",
      byline: "Pineapple 71717 · " + (todayLabel() || "a short read"),
      paras: lightEssay(question, headline),
      disclaimer: DISCLAIMER,
      refs: [],
      showHero: aboutEggsMeatFish(qAll) && !!root.M1_BLOG_HERO,
      showChart: aboutEggsMeatFish(qAll) && aboutHeart(qAll),
    };
  }

  function renderRefs(rows) {
    return "<ol>" + rows.map(function (row) {
      var paper = paperOf(row);
      var href = hrefOf(paper);
      var venue = venueYear(row);
      var authors = authorsLine(paper) || "Authors not listed";
      var line = authors + " (" + (paper.year || "n.d.") + "). " +
        (paper.title || "Untitled") + (venue ? ". " + venue : "");
      var link = href
        ? ' <a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(href) + "</a>"
        : "";
      return "<li>" + esc(line) + link + "</li>";
    }).join("") + "</ol>";
  }

  function articleBodyHtml(article) {
    var html =
      '<p class="m1-blog-dek">' + esc(article.dek) + "</p>" +
      '<p class="m1-blog-byline">' +
      '<span class="m1-blog-byline-meta">' + esc(article.byline) + "</span>" +
      '<button type="button" class="m1-blog-copy-inline" id="m1-blog-copy-byline" title="Copy the full essay to paste into Medium, Substack, or any editor">Copy article</button>' +
      "</p>";
    if (article.showHero) html += heroFigureHtml();
    (article.paras || []).forEach(function (p, i) {
      html += "<p>" + esc(p) + "</p>";
      if (i === 1 && article.showChart) html += sketchChartHtml();
    });
    html += '<p class="m1-blog-disclaimer">' + esc(article.disclaimer) + "</p>";
    if (article.refs && article.refs.length) {
      html += "<h3>References</h3>" + renderRefs(article.refs);
    }
    return html;
  }

  function articlePlainText(article) {
    var parts = [article.headline, article.dek, article.byline];
    if (article.showHero) parts.push(heroCaption());
    (article.paras || []).forEach(function (p, i) {
      parts.push(p);
      if (i === 1 && article.showChart) {
        parts.push("What the dining line actually weighs", chartCaption());
      }
    });
    parts.push(article.disclaimer);
    return parts.filter(Boolean).join("\n\n");
  }

  function copyTextFallback(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) {}
      document.body.removeChild(ta);
      if (ok) resolve();
      else reject(new Error("Copy failed"));
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return copyTextFallback(text);
      });
    }
    return copyTextFallback(text);
  }

  function toAscii(s) {
    var t = String(s || "");
    var map = {
      "\u2018": "'", "\u2019": "'", "\u201C": '"', "\u201D": '"',
      "\u2013": "-", "\u2014": "-", "\u2010": "-", "\u2212": "-",
      "\u2026": "...", "\u00A0": " ", "\u00AD": "",
      "\u2264": "<=", "\u2265": ">=", "\u00B5": "u",
      "\u03B1": "alpha", "\u03B2": "beta",
    };
    Object.keys(map).forEach(function (k) {
      t = t.split(k).join(map[k]);
    });
    return t.replace(/[^\x20-\x7E]/g, "?");
  }

  function pdfEscape(s) {
    return toAscii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  }

  function wrapLines(text, fontSize, maxW) {
    var maxChars = Math.max(20, Math.floor(maxW / (fontSize * 0.48)));
    var lines = [];
    String(text || "").split(/\n/).forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean);
      var cur = "";
      function flush() {
        if (cur) {
          lines.push(cur);
          cur = "";
        }
      }
      if (!words.length) {
        lines.push("");
        return;
      }
      words.forEach(function (w) {
        while (w.length > maxChars) {
          flush();
          lines.push(w.slice(0, maxChars));
          w = w.slice(maxChars);
        }
        var next = cur ? cur + " " + w : w;
        if (next.length > maxChars) {
          flush();
          cur = w;
        } else {
          cur = next;
        }
      });
      flush();
    });
    return lines.length ? lines : [""];
  }

  function refLine(row, i) {
    var paper = paperOf(row);
    var href = hrefOf(paper);
    var venue = venueYear(row);
    var authors = authorsLine(paper) || "Authors not listed";
    var line = (i + 1) + ". " + authors + " (" + (paper.year || "n.d.") + "). " +
      (paper.title || "Untitled") + (venue ? ". " + venue : "");
    if (href) line += " " + href;
    return line;
  }

  function slugPdfName(title) {
    var s = toAscii(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    s = s.slice(0, 60) || "literature-scan";
    return s + ".pdf";
  }

  function decodeBase64(b64) {
    var abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var tbl = {};
    for (var i = 0; i < 64; i++) tbl[abc.charAt(i)] = i;
    b64 = String(b64 || "").replace(/[\s=]/g, "");
    var out = [];
    var bits = 0;
    var n = 0;
    for (var j = 0; j < b64.length; j++) {
      var v = tbl[b64.charAt(j)];
      if (v === undefined) continue;
      bits = (bits << 6) | v;
      n += 6;
      if (n >= 8) {
        n -= 8;
        out.push((bits >> n) & 255);
      }
    }
    return new Uint8Array(out);
  }

  function jpegBytesFromHero() {
    var uri = String(root.M1_BLOG_HERO || "");
    var idx = uri.indexOf("base64,");
    if (idx < 0) return null;
    var bytes = decodeBase64(uri.slice(idx + 7));
    return bytes && bytes.length ? bytes : null;
  }

  function strToBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  function concatBytes(parts) {
    var n = 0;
    parts.forEach(function (p) { n += p.length; });
    var out = new Uint8Array(n);
    var o = 0;
    parts.forEach(function (p) {
      out.set(p, o);
      o += p.length;
    });
    return out;
  }

  function buildPdfBytes(article) {
    var pageW = 612;
    var pageH = 792;
    var margin = 54;
    var maxW = pageW - margin * 2;
    var yStart = pageH - margin;
    var yMin = margin + 28;
    var pages = [];
    var y = yStart;
    var cmds = [];
    var jpeg = article.showHero ? jpegBytesFromHero() : null;

    function startPage() {
      cmds = [];
      pages.push(cmds);
      y = yStart;
    }

    function ensure(h) {
      if (y - h < yMin) startPage();
    }

    function gap(h) {
      ensure(h);
      y -= h;
    }

    function addText(text, font, size, leading) {
      wrapLines(text, size, maxW).forEach(function (line) {
        ensure(leading);
        cmds.push(
          "BT /" + font + " " + size + " Tf 1 0 0 1 " + margin.toFixed(2) + " " +
          y.toFixed(2) + " Tm (" + pdfEscape(line) + ") Tj ET"
        );
        y -= leading;
      });
    }

    function drawHero() {
      if (!jpeg) return;
      var natW = root.M1_BLOG_HERO_W || 1100;
      var natH = root.M1_BLOG_HERO_H || 733;
      var imgW = maxW;
      var imgH = imgW * natH / natW;
      if (imgH > 196) {
        imgH = 196;
        imgW = imgH * natW / natH;
      }
      ensure(imgH + 30);
      cmds.push("q");
      cmds.push(
        imgW.toFixed(2) + " 0 0 " + imgH.toFixed(2) + " " +
        margin.toFixed(2) + " " + (y - imgH).toFixed(2) + " cm"
      );
      cmds.push("/Im1 Do");
      cmds.push("Q");
      y -= imgH + 6;
      addText(heroCaption(), "F3", 8, 11);
      gap(10);
    }

    function drawSketchChart() {
      var bars = sketchBars();
      var chartH = 18 + bars.length * 32 + 36;
      ensure(chartH);
      addText("What the dining line actually weighs", "F1", 11, 15);
      gap(2);
      bars.forEach(function (b) {
        ensure(32);
        cmds.push(
          "BT /F2 9 Tf 1 0 0 1 " + margin.toFixed(2) + " " + y.toFixed(2) +
          " Tm (" + pdfEscape(b.label) + ") Tj ET"
        );
        y -= 12;
        var barY = y - 8;
        var barW = Math.max(8, b.v * maxW);
        cmds.push("0.925 0.906 0.863 rg");
        cmds.push(margin.toFixed(2) + " " + barY.toFixed(2) + " " + maxW.toFixed(2) + " 10 re f");
        cmds.push("0.184 0.435 0.306 rg");
        cmds.push(margin.toFixed(2) + " " + barY.toFixed(2) + " " + barW.toFixed(2) + " 10 re f");
        cmds.push("0 0 0 rg");
        y -= 20;
      });
      addText(chartCaption(), "F3", 8, 11);
      gap(10);
    }

    startPage();
    addText(article.headline, "F1", 16, 20);
    gap(6);
    addText(article.dek, "F3", 11, 15);
    addText(article.byline, "F2", 10, 14);
    gap(10);
    drawHero();
    (article.paras || []).forEach(function (p, i) {
      addText(p, "F2", 11, 15);
      gap(8);
      if (i === 1 && article.showChart) drawSketchChart();
    });
    gap(6);
    addText(article.disclaimer, "F2", 9, 13);
    if ((article.refs || []).length) {
      gap(14);
      addText("References", "F1", 13, 18);
      gap(4);
      article.refs.forEach(function (row, i) {
        addText(refLine(row, i), "F2", 9, 12);
        gap(4);
      });
    }

    pages.forEach(function (pageCmds, i) {
      pageCmds.push(
        "BT /F2 8 Tf 1 0 0 1 " + margin.toFixed(2) + " 28 Tm (" +
        pdfEscape("Pineapple 71717  ·  " + (i + 1) + " / " + pages.length) + ") Tj ET"
      );
    });

    var objects = [];
    function addObj(body) {
      objects.push(typeof body === "string" ? strToBytes(body) : body);
      return objects.length;
    }

    addObj("<< /Type /Catalog /Pages 2 0 R >>");
    addObj("PLACEHOLDER_PAGES");
    addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold >>");
    addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>");
    addObj("<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>");

    var imgId = 0;
    if (jpeg) {
      var natW = root.M1_BLOG_HERO_W || 1100;
      var natH = root.M1_BLOG_HERO_H || 733;
      var imgHead = "<< /Type /XObject /Subtype /Image /Width " + natW +
        " /Height " + natH +
        " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " +
        jpeg.length + " >>\nstream\n";
      imgId = addObj(concatBytes([strToBytes(imgHead), jpeg, strToBytes("\nendstream")]));
    }

    var xobj = imgId ? " /XObject << /Im1 " + imgId + " 0 R >>" : "";
    var pageObjIds = [];
    pages.forEach(function (pageCmds) {
      var stream = pageCmds.join("\n");
      if (stream.charAt(stream.length - 1) !== "\n") stream += "\n";
      addObj("<< /Length " + stream.length + " >>\nstream\n" + stream + "endstream");
      var contentId = objects.length;
      addObj(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pageW + " " + pageH + "] " +
        "/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >>" + xobj +
        " >> /Contents " + contentId + " 0 R >>"
      );
      pageObjIds.push(objects.length);
    });
    objects[1] = strToBytes(
      "<< /Type /Pages /Kids [" + pageObjIds.map(function (id) {
        return id + " 0 R";
      }).join(" ") + "] /Count " + pageObjIds.length + " >>"
    );

    var parts = [strToBytes("%PDF-1.4\n")];
    var offsets = [0];
    var pos = parts[0].length;
    objects.forEach(function (body, i) {
      offsets.push(pos);
      var head = strToBytes((i + 1) + " 0 obj\n");
      var tail = strToBytes("\nendobj\n");
      parts.push(head, body, tail);
      pos += head.length + body.length + tail.length;
    });
    var xref = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
    for (var i = 1; i <= objects.length; i++) {
      xref += ("0000000000" + offsets[i]).slice(-10) + " 00000 n \n";
    }
    xref += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" +
      pos + "\n%%EOF\n";
    parts.push(strToBytes(xref));
    return concatBytes(parts);
  }

  function triggerAnchorDownload(bytes, filename) {
    var blob = new Blob([bytes], { type: "application/pdf" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  }

  function savePdfViaServer(bytes, filename) {
    if (typeof fetch !== "function") {
      return Promise.resolve(null);
    }
    return fetch("/api/blog-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "X-Filename": filename,
      },
      body: bytes,
    }).then(function (res) {
      return res.json();
    }).catch(function () {
      return null;
    });
  }

  root.buildMode1BlogArticle = buildBlogArticle;
  root.buildMode1BlogPdfBytes = buildPdfBytes;

  root.renderMode1BlogPost = function (ctx) {
    var article = buildBlogArticle(ctx);
    return (
      '<section class="m1-blog" id="m1-blog-post">' +
      '<p class="m1-blog-kicker">A lighter read</p>' +
      "<h2>" + esc(article.headline) + "</h2>" +
      articleBodyHtml(article) +
      '<div class="m1-blog-actions">' +
      '<button type="button" class="btn btn-primary" id="m1-blog-image">Download cover</button>' +
      '<button type="button" class="btn btn-ghost" id="m1-blog-image-full">Download as Image</button>' +
      '<button type="button" class="btn btn-ghost" id="m1-blog-pdf">Download PDF</button>' +
      '<p class="m1-blog-share-hint">Cover is 1200×630 for LinkedIn and X. Download as Image is a tall PNG of the whole piece.</p>' +
      "</div>" +
      "</section>"
    );
  };

  function slugImageName(title, suffix) {
    var base = slugPdfName(title).replace(/\.pdf$/i, "");
    return base + (suffix ? "-" + suffix : "") + ".png";
  }

  function wrapCanvasText(ctx, text, maxWidth) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width <= maxWidth) {
        line = test;
      } else {
        if (line) lines.push(line);
        line = w;
      }
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawCover(ctx, img, x, y, w, h) {
    if (!img || !img.width) return;
    var ir = img.width / img.height;
    var r = w / h;
    var sx = 0;
    var sy = 0;
    var sw = img.width;
    var sh = img.height;
    if (ir > r) {
      sw = sh * r;
      sx = (img.width - sw) / 2;
    } else {
      sh = sw / r;
      sy = (img.height - sh) / 2;
    }
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 18);
    else ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
    ctx.restore();
  }

  function loadHeroImage() {
    var src = root.M1_BLOG_HERO;
    if (!src) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function drawShareCard(article, img) {
    var W = 1200;
    var H = 630;
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f7f4ef";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2f6f4e";
    ctx.fillRect(0, 0, 10, H);

    var textRight = img ? 690 : 1140;
    ctx.fillStyle = "#c4a35a";
    ctx.font = "700 22px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText("PINEAPPLE 71717", 48, 72);

    ctx.fillStyle = "#1a2332";
    ctx.font = "650 42px Fraunces, Georgia, serif";
    var hed = wrapCanvasText(ctx, article.headline, textRight - 48);
    if (hed.length > 4) {
      hed = hed.slice(0, 4);
      hed[3] = hed[3].replace(/\s+\S*$/, "") + "…";
    }
    var y = 128;
    hed.forEach(function (line) {
      ctx.fillText(line, 48, y);
      y += 50;
    });

    ctx.fillStyle = "#3d4a5c";
    ctx.font = "400 22px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText(article.dek || "", 48, y + 18);
    ctx.font = "600 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText(article.byline || "", 48, y + 52);

    var pull = (article.paras && article.paras[0]) || "";
    if (pull) {
      ctx.font = "italic 20px Fraunces, Georgia, serif";
      ctx.fillStyle = "#1a2332";
      var quotes = wrapCanvasText(ctx, pull, textRight - 48);
      var qy = y + 108;
      quotes.slice(0, 5).forEach(function (line) {
        ctx.fillText(line, 48, qy);
        qy += 28;
      });
    }

    if (img) drawCover(ctx, img, 720, 48, 432, 430);

    ctx.fillStyle = "#e6f0ea";
    ctx.fillRect(0, H - 72, W, 72);
    ctx.fillStyle = "#2f6f4e";
    ctx.font = "600 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText("A lighter read from a literature scan  ·  not medical advice", 48, H - 32);

    return canvas;
  }

  function fillRoundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function drawSketchChart(ctx, x, y, w) {
    var bars = sketchBars();
    var rowH = 52;
    ctx.fillStyle = "#1a2332";
    ctx.font = "650 22px Fraunces, Georgia, serif";
    ctx.fillText("What the dining line actually weighs", x, y + 8);
    y += 28;
    bars.forEach(function (b) {
      ctx.fillStyle = "#3d4a5c";
      ctx.font = "400 16px 'Source Sans 3', 'Helvetica Neue', sans-serif";
      ctx.fillText(b.label, x, y + 14);
      ctx.fillStyle = "#ece7dc";
      fillRoundRect(ctx, x, y + 20, w, 16, 4);
      ctx.fillStyle = "#2f6f4e";
      fillRoundRect(ctx, x, y + 20, Math.max(10, w * b.v), 16, 4);
      y += rowH;
    });
    ctx.fillStyle = "#3d4a5c";
    ctx.font = "italic 14px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    var cap = wrapCanvasText(ctx, chartCaption(), w);
    cap.forEach(function (line) {
      ctx.fillText(line, x, y + 12);
      y += 20;
    });
    return y + 8;
  }

  function drawFullBlog(article, img) {
    var W = 1200;
    var pad = 56;
    var maxW = W - pad * 2;
    var probe = document.createElement("canvas").getContext("2d");
    var y = pad + 8;
    var heroH = 0;
    if (img && article.showHero) {
      heroH = Math.min(480, Math.round(maxW * img.height / img.width));
    }

    probe.font = "650 40px Fraunces, Georgia, serif";
    var hed = wrapCanvasText(probe, article.headline, maxW);
    probe.font = "400 22px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    y += 28 + hed.length * 50 + 28 + 28 + 36;
    if (heroH) y += heroH + 48;
    (article.paras || []).forEach(function (p, i) {
      probe.font = "400 22px 'Source Sans 3', 'Helvetica Neue', sans-serif";
      y += wrapCanvasText(probe, p, maxW).length * 34 + 18;
      if (i === 1 && article.showChart) y += 28 + sketchBars().length * 52 + 80;
    });
    probe.font = "600 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    y += wrapCanvasText(probe, article.disclaimer, maxW - 24).length * 28 + 120;

    var H = Math.ceil(y + pad);
    var canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#f7f4ef";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#2f6f4e";
    ctx.fillRect(0, 0, 10, H);

    var cy = pad;
    ctx.fillStyle = "#c4a35a";
    ctx.font = "700 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText("A LIGHTER READ  ·  PINEAPPLE 71717", pad, cy + 8);
    cy += 36;

    ctx.fillStyle = "#1a2332";
    ctx.font = "650 40px Fraunces, Georgia, serif";
    hed.forEach(function (line) {
      ctx.fillText(line, pad, cy);
      cy += 50;
    });
    cy += 8;
    ctx.fillStyle = "#3d4a5c";
    ctx.font = "400 22px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText(article.dek || "", pad, cy);
    cy += 32;
    ctx.font = "600 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText(article.byline || "", pad, cy);
    cy += 36;

    if (img && article.showHero) {
      drawCover(ctx, img, pad, cy, maxW, heroH);
      cy += heroH + 12;
      ctx.fillStyle = "#3d4a5c";
      ctx.font = "italic 14px 'Source Sans 3', 'Helvetica Neue', sans-serif";
      wrapCanvasText(ctx, heroCaption(), maxW).forEach(function (line) {
        ctx.fillText(line, pad, cy + 12);
        cy += 20;
      });
      cy += 16;
    }

    (article.paras || []).forEach(function (p, i) {
      ctx.fillStyle = "#1a2332";
      ctx.font = "400 22px 'Source Sans 3', 'Helvetica Neue', sans-serif";
      wrapCanvasText(ctx, p, maxW).forEach(function (line) {
        ctx.fillText(line, pad, cy);
        cy += 34;
      });
      cy += 18;
      if (i === 1 && article.showChart) {
        ctx.fillStyle = "#ffffff";
        var chartTop = cy;
        var chartH = 36 + sketchBars().length * 52 + 64;
        fillRoundRect(ctx, pad - 12, chartTop - 8, maxW + 24, chartH, 12);
        cy = drawSketchChart(ctx, pad, cy, maxW);
        cy += 20;
      }
    });

    ctx.fillStyle = "#f3ead2";
    ctx.font = "600 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    var discLines = wrapCanvasText(ctx, article.disclaimer, maxW - 24);
    var boxH = discLines.length * 26 + 28;
    fillRoundRect(ctx, pad - 8, cy, maxW + 16, boxH, 10);
    ctx.fillStyle = "#1a2332";
    ctx.font = "600 18px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    discLines.forEach(function (line) {
      ctx.fillText(line, pad + 12, cy + 28);
      cy += 26;
    });
    cy += 36;
    ctx.fillStyle = "#2f6f4e";
    ctx.font = "600 16px 'Source Sans 3', 'Helvetica Neue', sans-serif";
    ctx.fillText("Full essay from a literature scan  ·  not medical advice", pad, cy + 8);

    return canvas;
  }

  function canvasPngBlob(canvas) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("Could not build the image"));
      }, "image/png");
    });
  }

  function triggerBlobDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 2000);
  }

  root.downloadMode1BlogPdf = function (ctx) {
    var article = buildBlogArticle(ctx);
    var bytes = buildPdfBytes(article);
    var filename = slugPdfName(article.headline);
    triggerAnchorDownload(bytes, filename);
    return savePdfViaServer(bytes, filename);
  };

  root.downloadMode1BlogImage = function (ctx) {
    var article = buildBlogArticle(ctx);
    var fonts = (document.fonts && document.fonts.ready)
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fonts.then(function () {
      return loadHeroImage();
    }).then(function (img) {
      return canvasPngBlob(drawShareCard(article, article.showHero ? img : null));
    }).then(function (blob) {
      triggerBlobDownload(blob, slugImageName(article.headline, "cover"));
      return { ok: true, data: { filename: slugImageName(article.headline, "cover") } };
    });
  };

  root.downloadMode1BlogFullImage = function (ctx) {
    var article = buildBlogArticle(ctx);
    var fonts = (document.fonts && document.fonts.ready)
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fonts.then(function () {
      return loadHeroImage();
    }).then(function (img) {
      return canvasPngBlob(drawFullBlog(article, article.showHero ? img : null));
    }).then(function (blob) {
      triggerBlobDownload(blob, slugImageName(article.headline, "full"));
      return { ok: true, data: { filename: slugImageName(article.headline, "full") } };
    });
  };

  root.copyMode1BlogText = function (ctx) {
    var article = buildBlogArticle(ctx);
    var text = articlePlainText(article);
    return copyText(text).then(function () {
      return { ok: true, data: { copied: true, chars: text.length } };
    });
  };
})(window);
