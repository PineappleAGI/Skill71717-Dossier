/* Skill71717 — Mode 1 blog post (step 6) plus print-to-PDF.
   Isolated from the briefing. Reads only extracted Mode 1 fields. */
(function (root) {
  "use strict";

  var DISCLAIMER =
    "This post is for research interpretation and general education only. It is not medical, legal, or financial advice — verify primary sources before acting on anything here.";

  var MAX_BODY = 6;

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

  function takeaway(s, c, closeN) {
    if (!closeN && !s.length && !c.length) {
      return "Treat headlines about this choice as unfinished until a study actually tests the comparison you care about.";
    }
    if (s.length > c.length) {
      return "If the abstracts sound reassuring, still read who was studied and what was compared before changing a habit.";
    }
    if (c.length > s.length) {
      return "If the abstracts sound cautious, that is a reason to slow down — not a rule for one person.";
    }
    return "Do not pick a side from a single paper. This scan’s abstracts do not speak with one voice.";
  }

  function weave(row) {
    var tag = cite(row);
    var gist = firstSentences(paperOf(row).abstract || "", 200);
    if (!gist && !tag) return "";
    if (tag && gist) return tag + " reports that " + lcFirst(gist);
    return tag || gist;
  }

  function paraFromRows(lead, rows, extra) {
    var bits = (rows || []).map(weave).filter(Boolean);
    if (!bits.length) return "";
    var body = bits.join(" ");
    if (extra) body += " " + extra;
    return lead ? lead + " " + body : body;
  }

  function pickBody(s, c, g) {
    var mech = s.slice().sort(function (a, b) { return typeRank(a) - typeRank(b); });
    var ordered = uniqueRows(mech.concat(c, g.filter(hasAbstract)));
    return ordered.filter(hasAbstract).slice(0, MAX_BODY);
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
    var synth = ctx.synthesis || {};
    var s = unwrap(synth.supporting);
    var c = unwrap(synth.contradicting);
    var g = unwrap(synth.gaps);
    var onTopic = (ctx.extracted || []).filter(function (r) {
      return r.paper && r.paper.tier !== "unrelated";
    });
    var confidence = (ctx.verdict && ctx.verdict.confidence) || "Too little evidence to conclude";
    var question = ctx.question || "";
    var headline = catchHeadline(question);
    var qPlain = spokenQuestion(question);
    var bodyRows = pickBody(s, c, g);
    var sBody = bodyRows.filter(function (r) { return r.effect === "supports"; });
    var cBody = bodyRows.filter(function (r) { return r.effect === "contradicts"; });
    var gBody = bodyRows.filter(function (r) {
      return r.effect !== "supports" && r.effect !== "contradicts";
    });
    var closeN = sBody.length + cBody.length;

    var paras = [];
    paras.push(
      "It starts as an everyday choice, the kind you make in a dining hall rather than a clinic: " +
      qPlain +
      " Protein is protein until someone mentions the heart, and then the same plate becomes a long-term question."
    );
    paras.push(
      "This post is a reading of abstracts from a live literature scan — not a new trial, and not a ruling about any one person. " +
      "The scan’s own confidence label is “" + confidence + ".”"
    );

    if (sBody.length) {
      paras.push(paraFromRows(
        sBody.length && cBody.length
          ? "Some of the abstracts sound more reassuring than alarming."
          : "The abstracts that turned up lean more reassuring than not.",
        sBody
      ));
    }
    if (cBody.length) {
      paras.push(paraFromRows(
        s.length
          ? "That is not the only direction in this set."
          : "The abstracts that turned up lean more cautious than not.",
        cBody
      ));
    }
    if (!sBody.length && !cBody.length) {
      paras.push(
        "What turned up is nearby work, not a clean head-to-head on this exact comparison. " +
        paraFromRows("", gBody.slice(0, 3))
      );
    } else if (gBody.length) {
      paras.push(paraFromRows(
        "A few records sit next to the question without answering it.",
        gBody.slice(0, 2)
      ));
    }

    var limitation = "";
    if (c.length && s.length) {
      limitation = "A real limit: the same scan can look calm in one abstract and cautious in another, so this is not a one-direction literature.";
    } else if (g.length && !closeN) {
      limitation = "A real limit: several records were nearby rather than a direct test of the comparison.";
    } else {
      limitation = "A real limit: this reading uses abstracts and study-type cues, not a full-text appraisal of methods, funding, or bias.";
    }

    paras.push(
      "So where does that leave the question? " +
      takeaway(s, c, closeN) + " " + limitation
    );

    paras = paras.filter(Boolean);

    return {
      headline: headline,
      dek: "A plain-language reading of the abstracts this scan turned up.",
      byline: "Pineapple 71717 · " + (todayLabel() || "literature scan"),
      paras: paras,
      disclaimer: DISCLAIMER,
      refs: uniqueRows(bodyRows.concat(onTopic)),
      confidence: confidence,
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
    return (
      '<p class="m1-blog-dek">' + esc(article.dek) + "</p>" +
      '<p class="m1-blog-byline">' + esc(article.byline) + "</p>" +
      article.paras.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") +
      '<p class="m1-blog-disclaimer">' + esc(article.disclaimer) + "</p>" +
      "<h3>References</h3>" +
      renderRefs(article.refs)
    );
  }

  function printDocument(article) {
    return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\" />" +
      "<title>" + esc(article.headline) + "</title>" +
      "<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />" +
      "<link href=\"https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;700&family=Source+Sans+3:wght@400;600&display=swap\" rel=\"stylesheet\" />" +
      "<style>" +
      "@page { size: letter; margin: 0.9in 0.95in; }" +
      "html,body{margin:0;padding:0;background:#fff;color:#1a2332;}" +
      "body{font-family:'Source Sans 3','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12pt;line-height:1.65;}" +
      "h1{font-family:Fraunces,Georgia,serif;font-size:22pt;line-height:1.25;font-weight:650;letter-spacing:-0.02em;margin:0 0 0.45em;}" +
      "h3{font-family:Fraunces,Georgia,serif;font-size:13pt;margin:1.6em 0 0.4em;}" +
      ".dek{font-size:12.5pt;color:#3d4a5c;margin:0 0 0.35em;}" +
      ".byline{font-size:10pt;color:#3d4a5c;margin:0 0 1.3em;text-transform:none;}" +
      "p{margin:0 0 0.95em;}" +
      ".disclaimer{margin-top:1.3em;padding:0.7em 0.85em;border:1px solid #e4d5a8;background:#f3ead2;font-weight:600;font-size:10.5pt;}" +
      "ol{padding-left:1.2em;font-size:10pt;line-height:1.45;}" +
      "li{margin:0.35em 0;word-break:break-word;}" +
      "a{color:#2f6f4e;}" +
      "</style></head><body>" +
      "<h1>" + esc(article.headline) + "</h1>" +
      '<p class="dek">' + esc(article.dek) + "</p>" +
      '<p class="byline">' + esc(article.byline) + "</p>" +
      article.paras.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("") +
      '<p class="disclaimer">' + esc(article.disclaimer) + "</p>" +
      "<h3>References</h3>" +
      renderRefs(article.refs) +
      "</body></html>";
  }

  function printViaFrame(html) {
    var iframe = document.createElement("iframe");
    iframe.setAttribute("title", "Printable blog");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    var win = iframe.contentWindow;
    function go() {
      try {
        win.focus();
        win.print();
      } catch (err) {}
    }
    if (doc.readyState === "complete") {
      setTimeout(go, 250);
    } else {
      iframe.onload = function () { setTimeout(go, 250); };
    }
    setTimeout(function () {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 120000);
  }

  root.buildMode1BlogArticle = buildBlogArticle;

  root.renderMode1BlogPost = function (ctx) {
    var article = buildBlogArticle(ctx);
    return (
      '<section class="m1-blog" id="m1-blog-post">' +
      '<p class="m1-blog-kicker">As a post</p>' +
      "<h2>" + esc(article.headline) + "</h2>" +
      articleBodyHtml(article) +
      '<div class="m1-blog-actions">' +
      '<button type="button" class="btn btn-primary" id="m1-blog-pdf">Download PDF</button>' +
      "</div>" +
      "</section>"
    );
  };

  root.downloadMode1BlogPdf = function (ctx) {
    var article = buildBlogArticle(ctx);
    printViaFrame(printDocument(article));
  };
})(window);
