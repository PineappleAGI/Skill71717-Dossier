/* Skill71717 — Mode 1 Evidence Synthesis (PRISMA-style client flow).
   Talks to the local mode1-server.py /api/* proxy for real literature APIs. */
(function () {
  "use strict";

  var STEPS = [
    { n: 1, action: "Ask your question", name: "Question Intake" },
    { n: 2, action: "See the restatement", name: "Restatement" },
    { n: 3, action: "Search & rank", name: "Search & Rank" },
    { n: 4, action: "Extract the data", name: "Extracted Evidence Table" },
    { n: 5, action: "Weigh the evidence", name: "Synthesis" },
    { n: 6, action: "Read the briefing", name: "The Briefing" },
  ];

  var STOP = {
    the: 1, and: 1, for: 1, with: 1, that: 1, this: 1, from: 1, are: 1,
    was: 1, were: 1, have: 1, has: 1, had: 1, not: 1, but: 1, you: 1,
    your: 1, what: 1, does: 1, did: 1, how: 1, why: 1, who: 1, when: 1,
    about: 1, into: 1, than: 1, then: 1, them: 1, they: 1, their: 1,
    there: 1, been: 1, being: 1, will: 1, would: 1, could: 1, should: 1,
    can: 1, may: 1, might: 1, also: 1, more: 1, most: 1, some: 1, such: 1,
    only: 1, just: 1, over: 1, after: 1, before: 1, between: 1, among: 1,
    using: 1, used: 1, use: 1, versus: 1, vs: 1, find: 1, out: 1, want: 1,
    evidence: 1, study: 1, studies: 1, review: 1, effect: 1, effects: 1,
    is: 1, its: 1, into: 1, long: 1, term: 1, "long-term": 1, specifically: 1,
    safe: 1, safety: 1, healthy: 1, health: 1, people: 1, person: 1,
    clinical: 1, medical: 1, whether: 1, associated: 1, compared: 1,
  };

  var POSITIVE = [
    "significantly reduced", "significantly improved", "decreased risk",
    "lower risk", "reduced risk", "improved", "effective", "benefit",
    "beneficial", "protective", "associated with lower", "safe and",
    "well tolerated", "no significant adverse",
  ];
  var NEGATIVE = [
    "no significant", "not significantly", "no effect", "no benefit",
    "increased risk", "higher risk", "harm", "adverse", "not associated",
    "failed to", "did not improve", "ineffective", "insufficient evidence",
  ];
  var GAP_PHRASES = [
    "insufficient evidence", "limited evidence", "further research",
    "not enough evidence", "uncertain", "inconclusive",
  ];

  function emptyState() {
    return {
      step: 1,
      question: "",
      situation: "",
      activeQuestion: "",
      scope: null,
      papers: [],
      included: [],
      excluded: [],
      extracted: [],
      synthesis: { supporting: [], contradicting: [], gaps: [] },
      verdict: null,
      visibleLimit: 18,
      screenLogs: [],
      searchGen: 0,
      searching: false,
      searchStartedAt: 0,
      query: "",
      concepts: [],
      central: "",
      restatement: "",
      meaning: "",
    };
  }

  var state = emptyState();

  var SYNONYMS = {
    "fish oil": ["fish oil", "omega-3", "omega 3", "n-3"],
    "omega-3": ["omega-3", "omega 3", "fish oil"],
    "kidney transplant": ["kidney transplant", "renal transplant", "renal transplantation", "kidney transplantation"],
    "renal transplant": ["kidney transplant", "renal transplant"],
    "intermittent fasting": ["intermittent fasting", "time-restricted eating", "time restricted eating"],
    "time-restricted eating": ["intermittent fasting", "time-restricted eating"],
    "cardiovascular": ["cardiovascular", "cardiac", "heart"],
    "type 2 diabetes": ["type 2 diabetes", "type 2 diabetes mellitus", "t2dm"],
  };

  function synonyms(concept) {
    var key = String(concept || "").toLowerCase();
    var extra = SYNONYMS[key];
    if (extra && extra.length) return extra;
    return [key];
  }

  function uniqueStrings(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (s) {
      var k = String(s || "").toLowerCase().trim();
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push(k);
    });
    return out;
  }

  function extractConcepts(question, situation) {
    var raw = ((question || "") + " " + (situation || "")).toLowerCase();
    var concepts = [];
    var remaining = raw;
    Object.keys(SYNONYMS)
      .sort(function (a, b) { return b.length - a.length; })
      .forEach(function (key) {
        if (remaining.indexOf(key) !== -1) {
          concepts.push(key);
          remaining = remaining.split(key).join(" ");
        }
      });
    var toks = contentTokens(remaining);
    var i = 0;
    while (i < toks.length) {
      if (i + 1 < toks.length) {
        var bigram = toks[i] + " " + toks[i + 1];
        if (raw.indexOf(bigram) !== -1) {
          concepts.push(bigram);
          i += 2;
          continue;
        }
      }
      if (toks[i].length >= 4) concepts.push(toks[i]);
      i += 1;
    }
    return uniqueStrings(concepts).slice(0, 6);
  }

  function pickCentral(concepts, situation) {
    if (!concepts.length) return "";
    if (situation) {
      var sit = extractConcepts(situation, "");
      var i;
      for (i = 0; i < sit.length; i++) {
        if (concepts.indexOf(sit[i]) !== -1) return sit[i];
      }
    }
    var condition = /transplant|cancer|diabetes|disease|kidney|renal|heart|cardio|liver|pregnan|child|syndrome|failure|infection|obesity|asthma|stroke/;
    var j;
    for (j = 0; j < concepts.length; j++) {
      if (condition.test(concepts[j])) return concepts[j];
    }
    var best = concepts[0];
    concepts.forEach(function (c) {
      if (c.length > best.length) best = c;
    });
    return best;
  }

  function quoteTerm(term) {
    var t = String(term || "").trim();
    if (!t) return "";
    if (/\s/.test(t)) return '"' + t + '"';
    return t;
  }

  function orGroup(concept) {
    var parts = uniqueStrings(synonyms(concept)).map(quoteTerm).filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0];
    return "(" + parts.join(" OR ") + ")";
  }

  function buildBooleanQuery(question, situation) {
    var concepts = extractConcepts(question, situation);
    var central = pickCentral(concepts, situation);
    var groups = concepts.map(orGroup).filter(Boolean);
    var query;
    if (!groups.length) {
      query = (question || "").trim();
    } else if (groups.length === 1) {
      query = groups[0];
    } else if (central) {
      var center = orGroup(central);
      var rest = concepts.filter(function (c) { return c !== central; }).map(orGroup).filter(Boolean);
      query = rest.length ? center + " AND (" + rest.join(" OR ") + ")" : center;
    } else {
      query = "(" + groups.join(" OR ") + ")";
    }
    return { query: query, concepts: concepts, central: central };
  }

  function prettyList(arr) {
    var items = (arr || []).filter(Boolean);
    if (!items.length) return "";
    if (items.length === 1) return items[0];
    if (items.length === 2) return items[0] + " and " + items[1];
    return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
  }

  function buildRestatement(question, situation, correction) {
    var meaning = (correction || "").trim() || (question || "").trim();
    var sit = (situation || "").trim();
    var bundle = buildBooleanQuery(meaning, sit);
    var concepts = bundle.concepts;
    var central = bundle.central;
    var others = concepts.filter(function (c) { return c !== central; });
    var body;
    if (others.length && central) {
      body = "You want evidence on how " + prettyList(others) + " relates to " +
        central + (sit ? ", specifically for " + sit : "") + ".";
    } else if (central) {
      body = "You want published evidence about " + central +
        (sit ? ", in the situation of " + sit : "") + ".";
    } else {
      body = "You want published evidence that answers: “" + meaning.replace(/\?+$/, "") + "”.";
    }
    return {
      text: body,
      meaning: meaning,
      concepts: concepts,
      central: central,
      query: bundle.query,
    };
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function tokens(s) {
    return String(s || "")
      .toLowerCase()
      .match(/[a-z][a-z0-9-]{2,}/g) || [];
  }
  function contentTokens(s) {
    var seen = {};
    var out = [];
    tokens(s).forEach(function (t) {
      if (STOP[t] || seen[t]) return;
      seen[t] = 1;
      out.push(t);
    });
    return out;
  }

  function apiGet(path, params) {
    var qs = new URLSearchParams(params || {}).toString();
    var url = "/api/" + path + (qs ? "?" + qs : "");
    return fetch(url).then(function (r) {
      return r.json().then(function (body) {
        if (!body || !body.ok) {
          throw new Error((body && body.error) || ("API error " + r.status));
        }
        return body.data;
      });
    });
  }

  function setStatus(msg) {
    var el = $("#m1-status");
    if (el) el.textContent = msg || "";
  }

  var SEARCH_STEPS = [
    { match: /pubmed/i, label: "PubMed" },
    { match: /europe pmc/i, label: "Europe PMC" },
    { match: /clinicaltrials/i, label: "ClinicalTrials.gov" },
    { match: /openalex/i, label: "OpenAlex" },
    { match: /web search|publisher/i, label: "Publisher pages" },
    { match: /rank/i, label: "Rank results" },
    { match: /full text|open-access|unpaywall/i, label: "Fill in extra details" },
  ];
  var searchClock = null;

  function showSearchLive(on) {
    var bar = $("#m1-search-live");
    if (bar) bar.hidden = !on;
    document.body.classList.toggle("m1-searching", !!on);
    if (!on) {
      var t = $("#m1-search-elapsed");
      if (t) t.textContent = "";
    }
  }

  function elapsedSearchSecs() {
    if (!state.searchStartedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - state.searchStartedAt) / 1000));
  }

  function updateElapsed() {
    var n = elapsedSearchSecs();
    var live = $("#m1-search-elapsed");
    if (live) live.textContent = n + "s";
    var panel = $(".m1-search-elapsed");
    if (panel) panel.textContent = "Elapsed: " + n + " second" + (n === 1 ? "" : "s");
  }

  function startSearchClock() {
    if (searchClock) clearInterval(searchClock);
    updateElapsed();
    searchClock = setInterval(function () {
      if (!state.searching) {
        clearInterval(searchClock);
        searchClock = null;
        return;
      }
      updateElapsed();
    }, 1000);
  }

  function stopSearchClock() {
    if (searchClock) {
      clearInterval(searchClock);
      searchClock = null;
    }
  }

  function searchProgressHTML() {
    var logs = state.screenLogs || [];
    var last = logs.length ? logs[logs.length - 1] : "Starting search…";
    var reached = -1;
    SEARCH_STEPS.forEach(function (s, i) {
      logs.forEach(function (line) {
        if (s.match.test(line)) reached = Math.max(reached, i);
      });
    });
    var items = SEARCH_STEPS.map(function (s, i) {
      var cls = i < reached ? "is-done" : i === reached ? "is-now" : "";
      var mark = i < reached ? "✓" : i === reached ? "●" : "○";
      return '<li class="' + cls + '"><span class="m1-search-mark">' + mark + "</span>" +
        escapeHtml(s.label) + "</li>";
    }).join("");
    var n = elapsedSearchSecs();
    return (
      '<div class="m1-search-panel" role="status">' +
      "<h3>Searching live databases</h3>" +
      "<p>This usually takes 20–60 seconds. The page is working — it is not stuck or broken.</p>" +
      '<p class="m1-search-now">' + escapeHtml(last) + "</p>" +
      '<p class="m1-search-elapsed">Elapsed: ' + n + " second" + (n === 1 ? "" : "s") + "</p>" +
      '<ul class="m1-search-steps">' + items + "</ul>" +
      "</div>"
    );
  }

  function setStep(n) {
    state.step = n;
    $all("[data-m1-section]").forEach(function (sec) {
      var sn = parseInt(sec.getAttribute("data-m1-section"), 10);
      if (sn === 1) {
        sec.hidden = false;
        return;
      }
      sec.hidden = sn > n;
    });
    $all(".m1-step").forEach(function (el) {
      var sn = parseInt(el.getAttribute("data-step"), 10);
      el.classList.toggle("is-current", sn === n);
      el.classList.toggle("is-done", sn < n);
    });
    var current = STEPS.filter(function (s) { return s.n === n; })[0];
    $all(".m1-sticky-tip").forEach(function (el) {
      el.textContent = current ? current.action : "";
    });
  }

  function renderStepper() {
    var ol = $("#m1-steps");
    if (!ol) return;
    ol.innerHTML = STEPS.map(function (s) {
      return (
        '<li class="m1-step" data-step="' + s.n + '" title="' +
        escapeHtml(s.action + " — " + s.name) + '">' +
        '<span class="m1-step-num">' + s.n + "</span>" +
        '<span class="m1-step-text">' +
        '<span class="m1-step-action">' + escapeHtml(s.action) + "</span>" +
        '<span class="m1-step-name">' + escapeHtml(s.name) + "</span>" +
        "</span></li>"
      );
    }).join("");
    $all(".m1-step", ol).forEach(function (el) {
      el.addEventListener("click", function () {
        var sn = parseInt(el.getAttribute("data-step"), 10);
        if (sn <= state.step) {
          var target = $('[data-m1-section="' + sn + '"]');
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
  }

  function bindStickyStepper() {
    var host = $("#m1-stepper");
    var sentinel = $("#m1-stepper-sentinel");
    if (!host || !sentinel) return;
    function onScroll() {
      var past = sentinel.getBoundingClientRect().bottom < 0;
      document.body.classList.toggle("m1-stepper-sticky", past);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function paperHref(p) {
    if (!p) return "";
    return p.url || doiUrl(p.doi) || pubmedUrl(p.pmid) || "";
  }

  function sourceLinkHTML(url) {
    if (!url) return '<span class="m1-muted">No URL returned by the source database</span>';
    return (
      '<div class="card-url">' +
      '<a class="card-url-text" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(url) + "</a>" +
      '<button type="button" class="copy-btn" data-copy="' + escapeHtml(url) + '">Copy link</button>' +
      "</div>"
    );
  }

  function bindCopy(root) {
    $all(".copy-btn", root || document).forEach(function (btn) {
      if (btn.getAttribute("data-bound")) return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var url = btn.getAttribute("data-copy") || "";
        var original = btn.textContent;
        function ok() {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = original; }, 1200);
        }
        function fallback() {
          try {
            var ta = document.createElement("textarea");
            ta.value = url;
            ta.setAttribute("readonly", "");
            ta.style.position = "fixed";
            ta.style.left = "-9999px";
            document.body.appendChild(ta);
            ta.select();
            var copied = document.execCommand("copy");
            document.body.removeChild(ta);
            if (copied) { ok(); return; }
          } catch (err) {}
          btn.textContent = "Select & copy manually";
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(ok).catch(fallback);
        } else {
          fallback();
        }
      });
    });
  }

  function pubmedUrl(pmid) {
    return pmid ? "https://pubmed.ncbi.nlm.nih.gov/" + pmid + "/" : "";
  }
  function doiUrl(doi) {
    if (!doi) return "";
    doi = String(doi).replace(/^https?:\/\/doi\.org\//i, "");
    return "https://doi.org/" + doi;
  }

  function webSearchTerms(concepts, question) {
    var parts = (concepts || []).slice(0, 4).map(function (c) {
      return /\s/.test(c) ? '"' + c + '"' : c;
    });
    return parts.length ? parts.join(" ") : String(question || "").trim();
  }

  function isWebOnly(p) {
    var apis = (p && p.sourceApis) || [];
    var others = apis.filter(function (s) {
      return s !== "web_search" && s !== "unpaywall";
    });
    return apis.indexOf("web_search") !== -1 && others.length === 0;
  }

  function webSourceHTML(p) {
    if (!p) return "";
    var bits = [];
    if (isWebOnly(p)) {
      bits.push('<span class="m1-source-web">Found via web search</span>');
    }
    if (p.paywalled) {
      bits.push(
        '<span class="m1-tiny">' +
        escapeHtml(p.paywallNote || "Full text not available to review (paywalled). Abstract page linked.") +
        "</span>"
      );
    }
    return bits.length ? '<div class="m1-web-note">' + bits.join(" ") + "</div>" : "";
  }

  function searchBundle(question, situation) {
    return buildBooleanQuery(question, situation);
  }

  function volumeLabel(count) {
    if (count < 20) return "thin";
    if (count < 200) return "moderate";
    return "substantial";
  }

  function suggestFromTranslation(original, situation, translation) {
    var mesh = [];
    var re = /"([^"]+)"\[MeSH Terms\]/g;
    var m;
    while ((m = re.exec(translation || "")) !== null) {
      if (mesh.indexOf(m[1]) === -1) mesh.push(m[1]);
    }
    var sit = (situation || "").trim();
    if (mesh.length >= 2) {
      var q = "What does the evidence say about " + mesh[0] + " and " + mesh[1];
      if (sit) q += ", in the context of " + sit;
      return q + "?";
    }
    if (mesh.length === 1 && sit) {
      return "What does the evidence say about " + mesh[0] + " in the context of " + sit + "?";
    }
    if (sit) {
      return original.replace(/\?+\s*$/, "") + " — specifically in the context of " + sit + "?";
    }
    return original;
  }

  function looksMedical(q) {
    return /patient|disease|symptom|treatment|drug|diet|cancer|heart|cardio|diabetes|clinical|trial|fasting|nutrition|blood|risk|therapy|dose|vaccine|pregnancy|child/i.test(q);
  }
  function looksIntervention(q) {
    return /treatment|drug|therapy|trial|intervention|fasting|diet|supplement|medication|dose|vaccine|surgery/i.test(q);
  }

  function normalizePubmedSummary(id, rec, abstract) {
    rec = rec || {};
    var authors = (rec.authors || []).map(function (a) { return a.name; }).filter(Boolean);
    var doi = "";
    var pmcid = "";
    (rec.articleids || []).forEach(function (a) {
      if (a.idtype === "doi") doi = a.value;
      if (a.idtype === "pmc" || a.idtype === "pmcid") pmcid = String(a.value || "").replace(/^PMC/i, "PMC");
    });
    if (pmcid && pmcid.indexOf("PMC") !== 0) pmcid = "PMC" + pmcid;
    var year = parseInt(String(rec.pubdate || "").slice(0, 4), 10) || null;
    var url = doiUrl(doi) || pubmedUrl(id);
    return {
      id: "pmid:" + id,
      pmid: id,
      doi: doi,
      pmcid: pmcid,
      title: rec.title || "",
      authors: authors,
      year: year,
      venue: rec.source || rec.fulljournalname || "",
      pubTypes: rec.pubtype || [],
      abstract: abstract || "",
      url: url,
      sourceApis: ["pubmed"],
    };
  }

  function normalizeEpmc(r) {
    var pmid = r.pmid || "";
    var doi = r.doi || "";
    var url = doiUrl(doi) || (pmid ? pubmedUrl(pmid) : "") || (r.fullTextUrlList && r.fullTextUrlList.fullTextUrl && r.fullTextUrlList.fullTextUrl[0] && r.fullTextUrlList.fullTextUrl[0].url) || "";
    var authors = [];
    if (r.authorString) {
      authors = r.authorString.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return {
      id: pmid ? "pmid:" + pmid : doi ? "doi:" + doi : "epmc:" + (r.id || ""),
      pmid: pmid,
      doi: doi,
      pmcid: r.pmcid || "",
      title: r.title || "",
      authors: authors,
      year: r.pubYear ? parseInt(r.pubYear, 10) : null,
      venue: r.journalTitle || r.bookTitle || "",
      pubTypes: [].concat(r.pubTypeList && r.pubTypeList.pubType ? r.pubTypeList.pubType : []).concat(r.pubType || []),
      abstract: r.abstractText || "",
      url: url,
      sourceApis: ["europepmc"],
    };
  }

  function normalizeOpenAlex(w) {
    var doi = (w.doi || "").replace(/^https?:\/\/doi\.org\//i, "");
    var authors = (w.authorships || []).map(function (a) {
      return a.author && a.author.display_name;
    }).filter(Boolean);
    var pmid = "";
    var pmcid = "";
    var ids = w.ids || {};
    if (ids.pmid) pmid = String(ids.pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, "").replace(/\/$/, "");
    if (ids.pmcid) {
      pmcid = String(ids.pmcid).replace(/^https?:\/\/www\.ncbi\.nlm\.nih\.gov\/pmc\/articles\//i, "").replace(/\/$/, "");
      if (pmcid && pmcid.indexOf("PMC") !== 0) pmcid = "PMC" + pmcid;
    }
    return {
      id: pmid ? "pmid:" + pmid : w.id ? "openalex:" + w.id.split("/").pop() : "doi:" + doi,
      pmid: pmid,
      doi: doi,
      pmcid: pmcid,
      title: w.display_name || w.title || "",
      authors: authors,
      year: w.publication_year || null,
      venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || "",
      pubTypes: w.type ? [w.type] : [],
      abstract: "",
      url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || "",
      sourceApis: ["openalex"],
    };
  }

  function mergePapers(list) {
    var byKey = {};
    var order = [];
    list.forEach(function (p) {
      if (!p || !p.title) return;
      var key = p.pmid ? "pmid:" + p.pmid : p.doi ? "doi:" + p.doi.toLowerCase() : "t:" + p.title.toLowerCase().slice(0, 80);
      if (!byKey[key]) {
        byKey[key] = p;
        order.push(key);
        return;
      }
      var cur = byKey[key];
      if (!cur.abstract && p.abstract) cur.abstract = p.abstract;
      if (!cur.doi && p.doi) cur.doi = p.doi;
      if (!cur.url && p.url) cur.url = p.url;
      if (!cur.pmid && p.pmid) cur.pmid = p.pmid;
      if (!cur.pmcid && p.pmcid) cur.pmcid = p.pmcid;
      if (!cur.fullTextSnippet && p.fullTextSnippet) cur.fullTextSnippet = p.fullTextSnippet;
      if (!cur.venue && p.venue) cur.venue = p.venue;
      if (p.paywalled && cur.paywalled == null) cur.paywalled = p.paywalled;
      if (p.paywallNote && !cur.paywallNote) cur.paywallNote = p.paywallNote;
      if (p.foundViaWeb && !(cur.sourceApis || []).filter(function (s) {
        return s !== "web_search" && s !== "unpaywall";
      }).length) {
        cur.foundViaWeb = true;
      }
      (p.sourceApis || []).forEach(function (s) {
        if (cur.sourceApis.indexOf(s) === -1) cur.sourceApis.push(s);
      });
    });
    return order.map(function (k) { return byKey[k]; });
  }

  function rankPaper(paper, concepts, central) {
    var title = (paper.title || "").toLowerCase();
    var abs = (paper.abstract || "").toLowerCase();
    var blob = title + " " + abs;
    var hitList = [];
    var titleHits = 0;
    (concepts || []).forEach(function (c) {
      var matched = synonyms(c).some(function (s) {
        return blob.indexOf(s.toLowerCase()) !== -1;
      });
      if (matched) hitList.push(c);
      if (synonyms(c).some(function (s) { return title.indexOf(s.toLowerCase()) !== -1; })) {
        titleHits += 1;
      }
    });
    var hits = hitList.length;
    var type = studyType(paper.pubTypes);
    var typeBoost = type === "RCT" ? 3 : type === "review" ? 2.2 : type === "observational" ? 1 : type === "case series" ? -1 : 0;
    var recency = paper.year ? Math.max(0, Number(paper.year) - 1990) / 40 : 0;
    var score = hits * 10 + titleHits * 4 + typeBoost + recency;
    var nConcepts = (concepts || []).length;
    var tier = "unrelated";
    if (hits >= 2 || (hits >= 1 && nConcepts <= 1)) tier = "core";
    else if (hits === 1) tier = "related";
    return {
      score: score,
      tier: tier,
      hits: hits,
      hitList: hitList,
      typeBoost: typeBoost,
    };
  }

  function studyType(pubTypes) {
    var blob = (pubTypes || []).join(" ").toLowerCase();
    if (/meta-analysis|randomized|randomised|clinical trial|controlled trial/.test(blob)) return "RCT";
    if (/systematic review/.test(blob)) return "review";
    if (/\breview\b/.test(blob)) return "review";
    if (/cohort|observational|case-control|cross-sectional/.test(blob)) return "observational";
    if (/case reports|case series|case report/.test(blob)) return "case series";
    if (/article|journal-article/.test(blob)) return "observational";
    return "";
  }

  function qualityFlag(type) {
    if (type === "RCT") return "strong";
    if (type === "observational" || type === "review") return "moderate";
    if (type === "case series") return "weak";
    return "weak";
  }

  function sampleSize(abstract) {
    return extractPopulation(abstract).n;
  }

  function extractPopulation(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return { pop: "", n: null };
    var n = null;
    var nm = t.match(/\b[nN]\s*=\s*([0-9]{1,7})\b/);
    if (nm) n = parseInt(nm[1], 10);
    if (n == null) {
      nm = t.match(/\ba total of\s+([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{2,7})\b/i);
      if (nm) n = parseInt(nm[1].replace(/,/g, ""), 10);
    }
    if (n == null) {
      nm = t.match(/\b([0-9]{1,3}(?:,[0-9]{3})*|[0-9]{2,7})\s+(patients|participants|adults|subjects|children|men|women|mice|rats|volunteers)\b/i);
      if (nm) n = parseInt(nm[1].replace(/,/g, ""), 10);
    }
    var patterns = [
      /\b(?:enrolled|included|recruited|randomized|randomised|studied)\s+[^.!?]{0,40}?\b(?:patients|participants|adults|children|women|men|volunteers|mice|rats)[^.!?]{0,90}/i,
      /\b\d[\d,]*\s+(?:patients|participants|adults|children|subjects|volunteers)\s+(?:with|who|aged)[^.!?]{0,90}/i,
      /\b(?:patients|adults|children|women|men|participants|healthy volunteers)\s+(?:with|who had|undergoing)\s+[^.!?]{6,100}/i,
      /\b(?:kidney|renal|liver|heart|lung)\s+transplant(?:ation)?\s+(?:recipients|patients)[^.!?]{0,60}/i,
      /\b(?:mice|rats|rabbits|healthy volunteers)\b[^.!?]{0,70}/i,
      /\baged?\s+\d{1,3}\s*(?:to|-|–)\s*\d{1,3}\s*(?:years|yrs)\b[^.!?]{0,50}/i,
      /\bin\s+(?:a\s+)?(?:cohort|population|sample)\s+of\s+[^.!?]{6,90}/i,
    ];
    var pop = "";
    var i;
    for (i = 0; i < patterns.length; i++) {
      var m = t.match(patterns[i]);
      if (m && m[0]) {
        pop = m[0].replace(/\s+/g, " ").trim();
        if (pop.length > 180) pop = pop.slice(0, 177) + "…";
        break;
      }
    }
    if (n != null && pop && pop.indexOf(String(n)) === -1) {
      pop = "n=" + n + "; " + pop;
    } else if (n != null && !pop) {
      pop = "n=" + n;
    }
    return { pop: pop, n: n };
  }

  function sniffPico(text, question) {
    var t = String(text || "");
    var pop = extractPopulation(t).pop;
    var qTok = contentTokens(question);
    var inter = qTok.slice(0, 4).join(" ");
    var outc = "";
    var om = t.match(/\b(mortality|cardiovascular|weight|glucose|blood pressure|safety|adverse|survival|pain|risk)[^.;]{0,40}/i);
    if (om) outc = om[0];
    return { population: pop, intervention: inter, outcome: outc };
  }

  function effectDirection(abstract, question) {
    var t = String(abstract || "").toLowerCase();
    if (!t) return { dir: "unclear", note: "No abstract returned" };
    var pos = 0;
    var neg = 0;
    var gap = 0;
    POSITIVE.forEach(function (p) { if (t.indexOf(p) !== -1) pos += 1; });
    NEGATIVE.forEach(function (p) { if (t.indexOf(p) !== -1) neg += 1; });
    GAP_PHRASES.forEach(function (p) { if (t.indexOf(p) !== -1) gap += 1; });
    if (gap && pos + neg === 0) return { dir: "gap", note: "Abstract flags limited or insufficient evidence" };
    if (pos > neg) return { dir: "supports", note: "Beneficial / protective language in abstract" };
    if (neg > pos) return { dir: "contradicts", note: "Null, harmful, or non-significant language in abstract" };
    return { dir: "unclear", note: "Mixed or non-directional abstract language" };
  }

  function extractRow(paper, question) {
    var type = studyType(paper.pubTypes);
    var blob = [paper.title, paper.abstract, paper.fullTextSnippet].filter(Boolean).join(" ");
    var pico = sniffPico(blob, question);
    var eff = effectDirection(paper.abstract, question);
    var n = extractPopulation(blob).n;
    var first = (paper.authors && paper.authors[0]) || "Authors unavailable";
    var last = first.split(" ").pop();
    var pop = (pico.population || "").trim();
    return {
      paper: paper,
      study: last + (paper.year ? " " + paper.year : ""),
      population: pop || "Not specified in abstract",
      intervention: pico.intervention || "Not specified in abstract",
      outcome: pico.outcome || "Not specified in abstract",
      effect: eff.dir,
      effectNote: eff.note,
      studyType: type || "Not reported",
      sampleSize: n,
      quality: qualityFlag(type),
      relevance: paper.tier || paper.relevance,
    };
  }

  function beginUnderstanding() {
    var q = ($("#m1-question") || {}).value || "";
    var sit = ($("#m1-situation") || {}).value || "";
    q = q.trim();
    if (!q) {
      setStatus("Enter a question first.");
      return;
    }
    state.question = q;
    state.situation = sit.trim();
    var understood = buildRestatement(q, state.situation, "");
    state.restatement = understood.text;
    state.meaning = understood.meaning;
    state.concepts = understood.concepts;
    state.central = understood.central;
    state.query = understood.query;
    setStep(2);
    setStatus("");
    renderUnderstanding();
    startSearch({ scroll: false });
    var host = $("#m1-understand");
    if (host) host.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderUnderstanding() {
    var el = $("#m1-understand-body");
    if (!el) return;
    el.innerHTML =
      '<p class="m1-restate-kicker">Here’s what I understand you’re asking</p>' +
      '<p class="m1-restate">' + escapeHtml(state.restatement) + "</p>" +
      '<p class="m1-lead">Search already started from this reading. If it’s wrong, type what you meant and rerun.</p>' +
      '<label class="m1-label" for="m1-correction">Not quite — here’s what I actually mean</label>' +
      '<textarea id="m1-correction" rows="3" placeholder="Rewrite the question in your own words, then click Use my correction to rerun."></textarea>' +
      '<div class="m1-actions">' +
      '<button type="button" class="btn btn-primary" id="m1-understand-fix">Use my correction</button>' +
      "</div>";
    $("#m1-understand-fix").addEventListener("click", function () {
      var fix = (($("#m1-correction") || {}).value || "").trim();
      if (!fix) {
        setStatus("Type what you actually mean, then click Use my correction.");
        return;
      }
      confirmUnderstanding(fix);
    });
  }

  function confirmUnderstanding(correction) {
    var understood = buildRestatement(state.question, state.situation, correction);
    state.restatement = understood.text;
    state.meaning = understood.meaning;
    state.concepts = understood.concepts;
    state.central = understood.central;
    state.query = understood.query;
    setStatus("");
    renderUnderstanding();
    startSearch();
  }

  function startSearch(opts) {
    if (!(state.query || "").trim()) {
      state.query = buildBooleanQuery(state.meaning || state.question, state.situation).query;
    }
    state.activeQuestion = state.meaning || state.question;
    runFullReview(opts);
  }

  function escapeRegex(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function matchTerms(concepts) {
    var terms = [];
    (concepts || []).forEach(function (c) {
      synonyms(c).forEach(function (s) {
        if (s && terms.indexOf(s.toLowerCase()) === -1) terms.push(s);
      });
    });
    return terms.sort(function (a, b) { return b.length - a.length; });
  }

  function highlightSnippet(text, concepts) {
    var raw = String(text || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    var terms = matchTerms(concepts);
    var low = raw.toLowerCase();
    var idx = -1;
    var i;
    for (i = 0; i < terms.length; i++) {
      idx = low.indexOf(terms[i].toLowerCase());
      if (idx !== -1) break;
    }
    var start = 0;
    var end = Math.min(raw.length, 240);
    if (idx >= 0) {
      start = Math.max(0, idx - 70);
      end = Math.min(raw.length, idx + 170);
    }
    var slice = (start > 0 ? "…" : "") + raw.slice(start, end) + (end < raw.length ? "…" : "");
    var escaped = escapeHtml(slice);
    terms.forEach(function (term) {
      var re = new RegExp("(" + escapeRegex(escapeHtml(term)) + ")", "gi");
      escaped = escaped.replace(re, "<mark>$1</mark>");
    });
    return escaped;
  }

  function paperCard(p) {
    var type = studyType(p.pubTypes) || "Study";
    var why = (p.hitList && p.hitList.length)
      ? "Matches: " + p.hitList.join(", ")
      : "Matches: none of the core concepts in title or abstract";
    var snip = highlightSnippet(p.abstract || p.fullTextSnippet || "", state.concepts);
    var href = paperHref(p);
    var title = escapeHtml(p.title);
    var titleHtml = href
      ? '<a class="m1-card-title-link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' +
        title + "</a>"
      : title;
    return (
      '<article class="m1-card m1-hit-' + escapeHtml(p.tier || "related") + '">' +
      '<div class="m1-card-meta">' +
      '<span class="m1-tier">' + escapeHtml(p.tier || "related") + "</span>" +
      '<span class="m1-card-type">' + escapeHtml(type) +
      (p.year ? " · " + escapeHtml(String(p.year)) : "") + "</span>" +
      "</div>" +
      '<h3 class="m1-card-title">' + titleHtml + "</h3>" +
      '<p class="m1-card-why">' + escapeHtml(why) + "</p>" +
      (snip ? '<p class="m1-card-snip">' + snip + "</p>" : '<p class="m1-card-snip m1-muted">No abstract snippet returned.</p>') +
      sourceLinkHTML(href) +
      webSourceHTML(p) +
      "</article>"
    );
  }

  function renderScreen(statusLines) {
    var el = $("#m1-screen-body");
    if (!el) return;
    state.screenLogs = statusLines || state.screenLogs || [];
    var ranked = state.papers || [];
    var core = ranked.filter(function (p) { return p.tier === "core"; });
    var related = ranked.filter(function (p) { return p.tier === "related"; });
    var unrelated = ranked.filter(function (p) { return p.tier === "unrelated"; });
    var grouped = core.concat(related, unrelated);
    var shown = grouped.slice(0, state.visibleLimit);
    var more = grouped.length - shown.length;
    var shownCore = shown.filter(function (p) { return p.tier === "core"; });
    var shownRelated = shown.filter(function (p) { return p.tier === "related"; });
    var shownTail = shown.filter(function (p) { return p.tier === "unrelated"; });
    var moreBtn = more > 0
      ? '<button type="button" class="btn" id="m1-show-more-screen">Show more results (' +
        more + " more)</button>"
      : "";
    function block(title, items, total, cls) {
      if (!items.length) return "";
      return (
        '<section class="m1-tier-block ' + cls + '"><h3>' + title +
        ' <span class="m1-muted">(' + items.length +
        (items.length !== total ? " of " + total : "") + ")</span></h3>" +
        items.map(paperCard).join("") +
        "</section>"
      );
    }
    var searching = !!state.searching;
    var progress = searching ? searchProgressHTML() : "";
    var counts = (!searching || shown.length)
      ? '<p class="m1-lead"><strong>' + ranked.length + "</strong> records — " +
        "<strong>" + core.length + "</strong> core, <strong>" + related.length +
        "</strong> related, <strong>" + unrelated.length +
        "</strong> lower-ranked. Grouped by match strength, not raw score.</p>"
      : "";
    var results = shown.length
      ? block("Core matches", shownCore, core.length, "is-core") +
        block("Related matches", shownRelated, related.length, "is-related") +
        block("Lower-ranked / zero overlap", shownTail, unrelated.length, "is-tail")
      : (searching ? "" : "<p>No records returned.</p>");
    el.innerHTML =
      progress +
      '<ul class="m1-status-log">' + state.screenLogs.map(function (s) {
        return "<li>" + escapeHtml(s) + "</li>";
      }).join("") + "</ul>" +
      (state.query
        ? '<p class="m1-query">Search used: <code>' + escapeHtml(state.query) + "</code></p>"
        : "") +
      counts +
      results +
      '<div class="m1-actions">' + moreBtn + "</div>";
    bindCopy(el);
    var btn = $("#m1-show-more-screen");
    if (btn) btn.addEventListener("click", showMoreResults);
  }

  function showMoreResults() {
    state.visibleLimit = Math.min((state.papers || []).length, state.visibleLimit + 20);
    renderScreen();
    renderExtractTable();
  }

  function looksLikeTrialQuestion(q) {
    return looksIntervention(q);
  }

  function runFullReview(opts) {
    opts = opts || {};
    var gen = (state.searchGen || 0) + 1;
    state.searchGen = gen;
    state.activeQuestion = (state.activeQuestion || state.meaning || state.question).trim();
    state.searching = true;
    state.searchStartedAt = Date.now();
    state.papers = [];
    state.included = [];
    state.excluded = [];
    showSearchLive(true);
    startSearchClock();
    setStep(3);
    if (opts.scroll !== false) {
      var host = $("#m1-screen");
      if (host) host.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    var logs = [];
    function stale() {
      return gen !== state.searchGen;
    }
    function log(msg) {
      if (stale()) return;
      logs.push(msg);
      setStatus(msg);
      renderScreen(logs);
    }
    var term = (state.query || "").trim();
    if (!term) {
      var bundle = searchBundle(state.activeQuestion, state.situation);
      term = bundle.query;
      state.query = bundle.query;
      if (!state.concepts.length) {
        state.concepts = bundle.concepts;
        state.central = bundle.central;
      }
    }
    state.visibleLimit = 18;
    var papers = [];

    log("Searching PubMed…");
    apiGet("pubmed/search", { q: term, retmax: "50" })
      .then(function (data) {
        if (stale()) return Promise.reject({ stale: true });
        var er = (data && data.esearchresult) || {};
        var ids = er.idlist || [];
        log("PubMed returned " + (er.count || "0") + " hits; retrieving details for " + ids.length + "…");
        var sumP = ids.length ? apiGet("pubmed/summary", { ids: ids.join(",") }) : Promise.resolve({ result: { uids: [] } });
        var absP = ids.length ? apiGet("pubmed/abstracts", { ids: ids.slice(0, 50).join(",") }) : Promise.resolve({});
        return Promise.all([ids, sumP, absP]);
      })
      .then(function (triple) {
        if (stale()) return Promise.reject({ stale: true });
        var ids = triple[0];
        var summary = triple[1] || {};
        var abstracts = triple[2] || {};
        ids.forEach(function (id) {
          papers.push(normalizePubmedSummary(id, (summary.result || {})[id], abstracts[id] || ""));
        });
        log("Searching Europe PMC…");
        return apiGet("europepmc/search", { q: term, pageSize: "50", resultType: "core" });
      })
      .then(function (epmc) {
        if (stale()) return Promise.reject({ stale: true });
        ((epmc.resultList && epmc.resultList.result) || []).forEach(function (r) {
          papers.push(normalizeEpmc(r));
        });
        if (!looksLikeTrialQuestion(term)) return { studies: [], totalCount: 0 };
        log("Checking ClinicalTrials.gov…");
        return apiGet("trials/search", { q: term, pageSize: "15" }).catch(function () {
          return { studies: [], totalCount: 0 };
        });
      })
      .then(function (trials) {
        if (stale()) return Promise.reject({ stale: true });
        (trials.studies || []).forEach(function (st) {
          var proto = st.protocolSection || {};
          var idMod = proto.identificationModule || {};
          var nct = idMod.nctId || "";
          var title = idMod.briefTitle || idMod.officialTitle || "";
          if (!title) return;
          papers.push({
            id: nct ? "nct:" + nct : "trial:" + title.slice(0, 40),
            pmid: "",
            doi: "",
            title: title,
            authors: [],
            year: null,
            venue: "ClinicalTrials.gov",
            pubTypes: ["Clinical Trial Registration"],
            abstract: (proto.descriptionModule && proto.descriptionModule.briefSummary) || "",
            url: nct ? "https://clinicaltrials.gov/study/" + nct : "",
            sourceApis: ["clinicaltrials.gov"],
          });
        });
        var mergedPreview = mergePapers(papers);
        var medical = looksMedical(term);
        if (medical && mergedPreview.length >= 40) return null;
        log("Searching OpenAlex (broader scholarly index)…");
        return apiGet("openalex/search", { q: term, per_page: "30" }).catch(function () { return null; });
      })
      .then(function (oa) {
        if (stale()) return Promise.reject({ stale: true });
        if (oa && oa.results) {
          oa.results.forEach(function (w) { papers.push(normalizeOpenAlex(w)); });
        }
        log("Supplementary web search for ScienceDirect and other publisher pages…");
        return apiGet("websearch", {
          q: webSearchTerms(state.concepts, state.activeQuestion),
          max: "8",
        }).catch(function () {
          return { results: [], queries: [] };
        });
      })
      .then(function (web) {
        if (stale()) return Promise.reject({ stale: true });
        var added = 0;
        ((web && web.results) || []).forEach(function (p) {
          if (!p || !p.title) return;
          if (!p.sourceApis || !p.sourceApis.length) p.sourceApis = ["web_search"];
          papers.push(p);
          added += 1;
        });
        if (added) {
          log("Web search added " + added + " records from visible search/abstract pages (not the Elsevier API).");
        } else {
          log("Web search returned no extra publisher pages.");
        }
        var merged = mergePapers(papers).filter(function (p) {
          return p.title && !/^contributes evidence/i.test(p.title);
        });
        log("Ranking " + merged.length + " results…");
        merged.forEach(function (p) {
          var rel = rankPaper(p, state.concepts, state.central);
          p.tier = rel.tier;
          p.rankScore = rel.score;
          p.hitList = rel.hitList;
          p.relevance = rel.tier;
          p.relevanceScore = rel.score;
        });
        merged.sort(function (a, b) {
          var order = { core: 0, related: 1, unrelated: 2 };
          var td = (order[a.tier] || 0) - (order[b.tier] || 0);
          if (td) return td;
          return (b.rankScore || 0) - (a.rankScore || 0);
        });
        state.papers = merged;
        state.included = merged.filter(function (p) { return p.tier !== "unrelated"; });
        state.excluded = merged.filter(function (p) { return p.tier === "unrelated"; });
        renderScreen(logs);
        log("Checking open-access links…");
        return enrichUnpaywall(state.included.slice(0, 15));
      })
      .then(function () {
        if (stale()) return Promise.reject({ stale: true });
        log("Checking open full text for extra details…");
        return fillMissingPopulations(state.included.slice(0, 12));
      })
      .then(function () {
        if (stale()) return;
        state.searching = false;
        stopSearchClock();
        showSearchLive(false);
        renderScreen(logs);
        buildExtract();
        buildSynthesis();
        buildVerdict();
        setStatus("");
      })
      .catch(function (err) {
        if (err && err.stale) return;
        state.searching = false;
        stopSearchClock();
        showSearchLive(false);
        setStatus("Full review failed: " + (err.message || err));
        var el = $("#m1-screen-body");
        if (el) {
          el.insertAdjacentHTML(
            "afterbegin",
            '<div class="m1-search-panel" role="alert"><h3>Search failed</h3><p>' +
            escapeHtml(err.message || String(err)) +
            "</p><p>The page is not still loading. Try Use my correction, or Ask a new question.</p></div>"
          );
        }
      });
  }

  function enrichUnpaywall(papers) {
    var jobs = papers.filter(function (p) { return p.doi; }).map(function (p) {
      return apiGet("unpaywall", { doi: p.doi }).then(function (u) {
        var best = u.best_oa_location || {};
        var oa = best.url_for_pdf || best.url || (u.oa_locations && u.oa_locations[0] && u.oa_locations[0].url);
        if (oa) p.url = oa;
        p.openAccess = !!u.is_oa;
        if (u.is_oa) {
          p.paywalled = false;
          p.fullTextAvailable = true;
          p.paywallNote = "";
        }
      }).catch(function () {});
    });
    return Promise.all(jobs);
  }

  function fillMissingPopulations(papers) {
    var jobs = [];
    (papers || []).forEach(function (p) {
      var already = extractPopulation((p.title || "") + " " + (p.abstract || "")).pop;
      if (already || !p.pmcid || jobs.length >= 8) return;
      jobs.push(
        apiGet("europepmc/fulltext", { pmcid: p.pmcid }).then(function (d) {
          if (d && d.text) p.fullTextSnippet = d.text;
        }).catch(function () {})
      );
    });
    if (jobs.length) setStatus("Checking open full text for population details…");
    return Promise.all(jobs);
  }

  function rowHTML(row, i) {
    var p = row.paper;
    var href = paperHref(p);
    var title = escapeHtml(p.title);
    var titleHtml = href
      ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + title + "</a>"
      : title;
    return (
      "<tr id=\"m1-row-" + i + "\" class=\"m1-hit-" + escapeHtml(p.tier || "related") + "\">" +
      "<td><span class=\"m1-tier\">" + escapeHtml(p.tier || "related") + "</span><br><strong>" +
      escapeHtml(row.study) + "</strong><br><span class=\"m1-tiny\">" +
      titleHtml + "</span>" + sourceLinkHTML(href) + "</td>" +
      "<td>" + escapeHtml(row.population) + "</td>" +
      "<td>" + escapeHtml(row.intervention) + "</td>" +
      "<td>" + escapeHtml(row.outcome) + "</td>" +
      "<td><span class=\"m1-dir m1-dir-" + escapeHtml(row.effect) + "\">" +
      escapeHtml(row.effect) + "</span><br><span class=\"m1-tiny\">" +
      escapeHtml(row.effectNote) + "</span></td>" +
      "<td>" + escapeHtml(row.studyType) + "</td>" +
      "<td>" + (row.sampleSize != null ? escapeHtml(String(row.sampleSize)) : "Not reported") + "</td>" +
      "<td><span class=\"badge strength-" + escapeHtml(row.quality) + "\">" +
      escapeHtml(row.quality) + "</span>" + webSourceHTML(p) + "</td>" +
      "</tr>"
    );
  }

  function buildExtract() {
    setStep(4);
    state.extracted = (state.papers || []).map(function (p) {
      return extractRow(p, state.activeQuestion);
    });
    renderExtractTable();
  }

  function renderExtractTable() {
    var el = $("#m1-extract-body");
    if (!el) return;
    var all = state.extracted || [];
    var shown = all.slice(0, state.visibleLimit);
    var more = all.length - shown.length;
    var rows = shown.map(rowHTML).join("");
    var moreBtn = more > 0
      ? '<button type="button" class="btn" id="m1-show-more-table">Show more results (' +
        more + " more)</button>"
      : "";
    el.innerHTML =
      '<p class="m1-hint">Showing ' + shown.length + " of " + all.length +
      " ranked records. Core and related stay visible; zero-overlap rows sit at the bottom of the same list. " +
      "Rows tagged <em>found via web search</em> came from a supplementary publisher-page sweep (not PubMed / Europe PMC / OpenAlex). " +
      "Paywalled full text is never invented — the abstract page is linked instead.</p>" +
      '<div class="m1-table-wrap"><table class="m1-table">' +
      "<thead><tr><th>Study</th><th>Population</th><th>Intervention / exposure</th>" +
      "<th>Outcome</th><th>Effect direction</th><th>Study type</th><th>n</th><th>Quality</th></tr></thead>" +
      "<tbody>" + (rows || "<tr><td colspan=\"8\">No papers returned.</td></tr>") +
      "</tbody></table></div>" +
      '<div class="m1-actions">' + moreBtn + "</div>";
    bindCopy(el);
    var btn = $("#m1-show-more-table");
    if (btn) btn.addEventListener("click", showMoreResults);
  }

  function synthEntry(row, i) {
    return (
      '<li class="m1-synth-item"><a href="#m1-row-' + i + '">' +
      escapeHtml(row.study) + "</a> — " + escapeHtml(row.paper.title) +
      sourceLinkHTML(paperHref(row.paper)) +
      '<p class="m1-tiny">' + escapeHtml(row.effectNote) + "</p></li>"
    );
  }

  function buildSynthesis() {
    setStep(5);
    var supporting = [];
    var contradicting = [];
    var gaps = [];
    state.extracted.forEach(function (row, i) {
      if (row.paper && row.paper.tier === "unrelated") return;
      if (row.effect === "supports") supporting.push({ row: row, i: i });
      else if (row.effect === "contradicts") contradicting.push({ row: row, i: i });
      else gaps.push({ row: row, i: i });
    });
    state.synthesis = { supporting: supporting, contradicting: contradicting, gaps: gaps };
    var el = $("#m1-synth-body");
    if (!el) return;
    function block(title, items, cls) {
      return (
        '<section class="m1-synth-block ' + cls + '"><h3>' + title + "</h3>" +
        (items.length
          ? "<ul>" + items.map(function (x) { return synthEntry(x.row, x.i); }).join("") + "</ul>"
          : "<p class=\"m1-muted\">None in this first extract.</p>") +
        "</section>"
      );
    }
    el.innerHTML =
      '<p class="m1-footnote">This is a simplified <strong>direction-of-effect synthesis</strong> — a real systematic-review technique used when studies are too different to pool statistically. Grouping comes from language in each paper’s abstract, not from a meta-analytic model. <span class="m1-tip" title="Direction-of-effect synthesis counts whether each study’s result points for, against, or is unclear, instead of combining numbers into one pooled estimate.">?</span></p>' +
      block("Evidence supporting", supporting, "is-support") +
      block("Evidence contradicting / limiting", contradicting, "is-contra") +
      block("Open questions / evidence gaps", gaps, "is-gap");
    bindCopy(el);
  }

  function unwrapSynth(list) {
    return (list || []).map(function (x) { return x.row || x; });
  }

  function authorsLine(paper) {
    var a = (paper && paper.authors) || [];
    if (typeof a === "string") return a || "Authors not listed";
    var names = a.filter(Boolean);
    if (!names.length) return "Authors not listed";
    if (names.length > 8) return names.slice(0, 8).join(", ") + ", et al.";
    return names.join(", ");
  }

  function lastNameFromRow(row) {
    var paper = (row && row.paper) || {};
    var authors = paper.authors || [];
    var first = String(authors[0] || "").replace(/,.*$/, "").trim();
    if (/^authors unavailable$/i.test(first)) first = "";
    if (!first) {
      return String((row && row.study) || "The authors").replace(/\s+\d{4}$/, "") || "The authors";
    }
    var parts = first.split(/\s+/);
    var last = parts[parts.length - 1];
    if (parts.length >= 2 && /^[A-Za-z]{1,3}\.?$/.test(last)) {
      return parts[0];
    }
    return last || first;
  }

  function venueYear(row) {
    var paper = (row && row.paper) || {};
    var venue = String(paper.venue || "").trim();
    var year = paper.year || "";
    if (venue && !/^journal$/i.test(venue) && !/^doi\.org$/i.test(venue) && !/^https?:/i.test(venue)) {
      return year ? venue + ", " + year : venue;
    }
    return year || "n.d.";
  }

  var GENERIC_TOPIC = {
    adult: 1, adults: 1, young: 1, year: 1, years: 1, associated: 1,
    outcome: 1, outcomes: 1, intake: 1, source: 1, high: 1, worse: 1,
    long: 1, term: 1, among: 1, risk: 1, factor: 1, factors: 1,
    disease: 1, diseases: 1, related: 1, using: 1, based: 1,
    patient: 1, patients: 1, human: 1, people: 1, person: 1,
    health: 1, clinical: 1, aged: 1, student: 1, students: 1,
    college: 1, vs: 1, versus: 1,
  };

  function distinctiveTerms(question) {
    return contentTokens(question).filter(function (t) {
      return t.length >= 3 && !GENERIC_TOPIC[t];
    });
  }

  function topicScore(row, question) {
    var paper = (row && row.paper) || {};
    var title = String(paper.title || "").toLowerCase();
    var abs = stripTags(paper.abstract || "").toLowerCase();
    var score = 0;
    distinctiveTerms(question).forEach(function (t) {
      if (title.indexOf(t) !== -1) score += t.length >= 5 ? 6 : 4;
      else if (abs.indexOf(t) !== -1) score += 2;
    });
    if (row.effect === "supports" || row.effect === "contradicts") score += 1;
    if (!paper.authors || !paper.authors.length) score -= 3;
    if (stripTags(paper.abstract).length < 80) score -= 6;
    return score;
  }

  function hasQuote(row) {
    return stripTags(((row && row.paper) || {}).abstract).length >= 80;
  }

  function rankedForArticle(s, c, onTopic, question, n) {
    var pool = uniqueRows(s.concat(c, onTopic), 80);
    pool.sort(function (a, b) {
      return topicScore(b, question) - topicScore(a, question);
    });
    return pool.slice(0, n);
  }

  function pickWalk(s, c, onTopic, question) {
    var ranked = rankedForArticle(s, c, onTopic, question, 20);
    var close = ranked.filter(function (r) {
      return topicScore(r, question) >= 4 && hasQuote(r);
    });
    if (close.length) return close.slice(0, 3);
    return ranked.filter(hasQuote).slice(0, 3);
  }

  function tidyQuestion(q) {
    q = String(q || "").replace(/\s+/g, " ").trim().replace(/\?+$/, "");
    var m = q.match(/^In\s+[^,]{3,80},\s+(.*)$/i);
    if (m && m[1].length > 24) q = m[1];
    if (!q) return "What did this literature scan find?";
    q = q.charAt(0).toUpperCase() + q.slice(1);
    return /[?]$/.test(q) ? q : q + "?";
  }

  function displayQuestion() {
    var seed = readDossierSeed();
    var original = (seed.originalTopic || "").trim();
    if (original) return original;
    var typed = (state.question || "").trim();
    var active = (state.activeQuestion || seed.topic || "").trim();
    if (typed && (!active || typed.length <= active.length + 10)) return typed;
    return active || typed;
  }

  function articleHeadline(question, s, c) {
    var q = tidyQuestion(question);
    if (s.length > c.length + 1) return q.replace(/\?+$/, "") + "? Several studies here lean “not clearly worse.”";
    if (c.length > s.length + 1) return q.replace(/\?+$/, "") + "? Several studies here point to risk or limits.";
    if (!s.length && !c.length) return q.replace(/\?+$/, "") + "? Related papers showed up, but none clearly answer yes or no.";
    return q.replace(/\?+$/, "") + "? The studies here do not agree.";
  }

  function displayName(row) {
    var name = lastNameFromRow(row);
    if (!name || /^(the authors|unavailable|a paper)$/i.test(name)) return "";
    return name;
  }

  function citeInline(row) {
    var name = displayName(row);
    var vy = venueYear(row);
    return name ? name + " (" + vy + ")" : "A " + (vy || "paper");
  }

  function stanceLabel(row) {
    if (row.effect === "supports") return "More reassuring on your question";
    if (row.effect === "contradicts") return "More cautious on your question";
    return "Related, not a clear yes or no";
  }

  function paperGist(row, maxChars) {
    return firstSentences(((row.paper || {}).abstract) || "", maxChars || 220);
  }

  function ledeCite(row) {
    var gist = paperGist(row, 160);
    var cite = citeInline(row);
    if (!gist) return cite + " is in this set.";
    if (row.effect === "supports") return cite + " is one of the more reassuring reads: " + gist;
    if (row.effect === "contradicts") return cite + " is more cautious: " + gist;
    return cite + " looked at a nearby question: " + gist;
  }

  function doiHref(paper) {
    if (paper && paper.doi) return doiUrl(paper.doi);
    return paperHref(paper);
  }

  function stripTags(s) {
    return String(s || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
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

  function uniqueRows(list, n) {
    var seen = {};
    var out = [];
    (list || []).forEach(function (row) {
      if (out.length >= n) return;
      var key = (((row && row.paper) || {}).title || "").toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(row);
    });
    return out;
  }

  function paperWalkHtml(row, index) {
    var paper = row.paper || {};
    var href = paperHref(paper);
    var title = href
      ? '<a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(paper.title || "Untitled") + "</a>"
      : escapeHtml(paper.title || "Untitled");
    var doi = doiHref(paper);
    var doiLine = doi
      ? '<p class="m1-article-doi"><a href="' + escapeHtml(doi) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(doi) + "</a></p>"
      : "";
    var gist = paperGist(row, 280);
    var nBit = row.sampleSize != null ? " · n=" + row.sampleSize : "";
    var who = row.population && row.population !== "Not specified in abstract"
      ? "<p>Who was studied: " + escapeHtml(row.population) + "</p>"
      : "";
    return (
      '<section class="m1-article-block">' +
      '<p class="m1-article-stance">Paper ' + (index + 1) + " · " + escapeHtml(stanceLabel(row)) + "</p>" +
      '<h3 class="m1-article-paperhed">' + title + "</h3>" +
      '<p class="m1-paper-meta">' + escapeHtml(authorsLine(paper)) + " · " +
      escapeHtml(venueYear(row)) + " · " + escapeHtml(row.studyType || "study") + nBit + "</p>" +
      doiLine +
      who +
      (gist ? "<p>" + escapeHtml(gist) + "</p>" : "<p>This database record did not include a usable abstract.</p>") +
      "</section>"
    );
  }

  function buildArticleModel() {
    var question = displayQuestion();
    var s = unwrapSynth(state.synthesis.supporting);
    var c = unwrapSynth(state.synthesis.contradicting);
    var g = unwrapSynth(state.synthesis.gaps);
    var onTopic = (state.extracted || []).filter(function (r) {
      return r.paper && r.paper.tier !== "unrelated";
    });
    var walk = pickWalk(s, c, onTopic, question);
    var closeN = walk.filter(function (r) { return topicScore(r, question) >= 4; }).length;
    var headline = articleHeadline(question, s, c);
    var plainAnswer;
    if (!onTopic.length) {
      plainAnswer = "Short answer: this scan did not retrieve papers we can use to answer you.";
    } else if (closeN === 0) {
      plainAnswer = "Short answer: we did not find a clear head-to-head on your question. Most papers are nearby, not a direct test of the choice you asked about.";
    } else if (s.length > c.length + 1) {
      plainAnswer = "Short answer: more of the closer papers sound reassuring than alarming. That is not permission to ignore context, and it is not a diet prescription.";
    } else if (c.length > s.length + 1) {
      plainAnswer = "Short answer: more of the closer papers sound cautious than reassuring. That is a map of the abstracts, not a rule for one person.";
    } else {
      plainAnswer = "Short answer: the papers do not agree. Some sound reassuring, some sound cautious, and this scan cannot settle it.";
    }
    var ledeParas = [];
    ledeParas.push(
      "People ask this because the everyday choice feels simple, while the long-term evidence is not. Here is what this scan of published abstracts actually turned up."
    );
    if (walk[0]) ledeParas.push(ledeCite(walk[0]));
    if (walk[1]) ledeParas.push(ledeCite(walk[1]));
    if (closeN < 2) {
      ledeParas.push(
        "A lot of what came back is only nearby. That helps you see the landscape. It does not give a clean yes-or-no on the exact comparison you asked."
      );
    } else if (s.length && c.length) {
      ledeParas.push(
        "So this is not only a reassuring story, and not only a warning. The same literature can look calm in one paper and cautious in another."
      );
    }
    ledeParas.push("Below are the closer papers, in plain language. None of this is medical advice.");
    var conclusion = [plainAnswer];
    conclusion.push(
      "This briefing used " + s.length + " papers that sounded supportive, " +
      c.length + " that sounded cautious, and " + g.length +
      " that were mixed or nearby. Counts come from abstract wording, not from pooling statistics."
    );
    conclusion.push(
      "If you need a decision for a real person, that is a clinician’s job. It requires the full papers — methods, funding, and bias — not this scan of abstracts."
    );
    var refs = rankedForArticle(onTopic, g, [], question, 10);
    var coreN = (state.papers || []).filter(function (p) { return p.tier === "core"; }).length;
    var relN = (state.papers || []).filter(function (p) { return p.tier === "related"; }).length;
    var tailN = (state.papers || []).filter(function (p) { return p.tier === "unrelated"; }).length;
    var paragraph =
      "Retrieved " + (state.papers || []).length + " unique records (" + coreN +
      " core, " + relN + " related, " + tailN + " lower-ranked). " + plainAnswer;
    return {
      question: tidyQuestion(question),
      headline: headline,
      plainAnswer: plainAnswer,
      ledeParas: ledeParas,
      walk: walk,
      conclusion: conclusion.join(" "),
      refs: refs,
      supporting: s,
      contradicting: c,
      gaps: g,
      paragraph: paragraph,
    };
  }

  function renderArticleHtml(model) {
    var blocks = (model.walk || []).map(function (row, i) {
      return paperWalkHtml(row, i);
    }).join("");
    var lede = (model.ledeParas || []).map(function (p) {
      return "<p>" + escapeHtml(p) + "</p>";
    }).join("");
    var refs = (model.refs || []).map(function (row) {
      var paper = row.paper || {};
      var href = paperHref(paper);
      var venue = paper.venue && !/^journal$|^doi\.org$/i.test(paper.venue) ? paper.venue : "";
      var line = authorsLine(paper) + " (" + (paper.year || "n.d.") + "). " +
        (paper.title || "Untitled") + (venue ? ". " + venue : "");
      var link = href
        ? ' <a href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(href) + "</a>"
        : "";
      return "<li>" + escapeHtml(line) + link + "</li>";
    }).join("");
    return (
      '<article class="m1-article">' +
      '<p class="m1-article-kicker">Plain-language briefing</p>' +
      '<h3 class="m1-article-hed">' + escapeHtml(model.headline) + "</h3>" +
      '<p class="m1-article-answer">' + escapeHtml(model.plainAnswer) + "</p>" +
      '<div class="m1-article-lede">' + lede + "</div>" +
      blocks +
      "<h3>Bottom line</h3>" +
      "<p>" + escapeHtml(model.conclusion) + "</p>" +
      '<p class="m1-article-note">This page is a reading of retrieved abstracts. It is not a diagnosis, a diet plan, or medical advice.</p>' +
      "<h3>Sources</h3>" +
      '<ol class="m1-article-refs">' + refs + "</ol>" +
      "</article>"
    );
  }

  function buildVerdict() {
    setStep(6);
    var onTopic = state.extracted.filter(function (r) {
      return r.paper && r.paper.tier !== "unrelated";
    });
    var s = unwrapSynth(state.synthesis.supporting);
    var c = unwrapSynth(state.synthesis.contradicting);
    var strong = onTopic.filter(function (r) { return r.quality === "strong"; }).length;
    var confidence = "Too little evidence to conclude";
    if (onTopic.length >= 12 && s.length >= 6 && c.length === 0 && strong >= 4) {
      confidence = "Reasonably well-supported";
    } else if (onTopic.length >= 3 && (s.length + c.length) >= 2) {
      confidence = "Suggestive, not conclusive";
    }
    var model = buildArticleModel();
    state.verdict = {
      paragraph: model.paragraph,
      confidence: confidence,
      article: model,
    };
    var el = $("#m1-verdict-body");
    if (!el) return;
    var blogHtml = "";
    if (typeof window.renderMode1BlogPost === "function") {
      blogHtml = window.renderMode1BlogPost({
        question: displayQuestion(),
        extracted: state.extracted,
        synthesis: state.synthesis,
        verdict: state.verdict,
      }) || "";
    }
    el.innerHTML =
      '<p class="m1-confidence">How sure is this scan? <strong>' + escapeHtml(confidence) + "</strong></p>" +
      renderArticleHtml(model) +
      blogHtml;
    var pdfBtn = $("#m1-blog-pdf");
    if (pdfBtn && typeof window.downloadMode1BlogPdf === "function") {
      pdfBtn.addEventListener("click", function () {
        var label = pdfBtn.textContent;
        pdfBtn.disabled = true;
        var result = window.downloadMode1BlogPdf({
          question: displayQuestion(),
          extracted: state.extracted,
          synthesis: state.synthesis,
          verdict: state.verdict,
        });
        Promise.resolve(result).then(function (info) {
          pdfBtn.disabled = false;
          var saved = info && info.ok && info.data && info.data.filename;
          pdfBtn.textContent = saved ? "Saved to Downloads" : label;
          if (saved) {
            setTimeout(function () { pdfBtn.textContent = label; }, 2500);
          }
        }).catch(function () {
          pdfBtn.disabled = false;
          pdfBtn.textContent = label;
        });
      });
    }
  }

  function askNewQuestion() {
    document.body.classList.remove("m1-searching");
    stopSearchClock();
    showSearchLive(false);
    state = emptyState();
    ["m1-understand-body", "m1-screen-body", "m1-extract-body", "m1-synth-body", "m1-verdict-body"].forEach(function (id) {
      var el = $("#" + id);
      if (el) el.innerHTML = "";
    });
    $all(".m1-submitted-q").forEach(function (el) {
      el.hidden = true;
    });
    var q = $("#m1-question");
    var sit = $("#m1-situation");
    if (q) q.value = "";
    if (sit) sit.value = "";
    setStatus("");
    setStep(1);
    var host = $("#m1-intake-sec");
    if (host) host.scrollIntoView({ behavior: "smooth", block: "start" });
    if (q) q.focus();
  }

  function bindNewQuestion() {
    var btn = $("#m1-new-question");
    if (!btn) return;
    btn.addEventListener("click", function (ev) {
      ev.preventDefault();
      askNewQuestion();
    });
  }

  function bindExampleChips(root) {
    (root || document).addEventListener("click", function (ev) {
      var btn = ev.target.closest("[data-fill]");
      if (!btn || !(root || document).contains(btn)) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && sel.toString() && btn.contains(sel.anchorNode)) return;
      ev.preventDefault();
      var text = (btn.getAttribute("data-insert") || btn.textContent || "").trim();
      var field = $(btn.getAttribute("data-fill") || "#m1-question");
      if (!field || !text) return;
      field.value = text;
      field.focus();
      if (typeof field.setSelectionRange === "function") {
        var end = field.value.length;
        field.setSelectionRange(end, end);
      }
      if (btn.getAttribute("data-scroll-to") || btn.classList.contains("m1-inspire-card")) {
        field.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }

  function bindInspiration() {
    var toggle = $("#m1-inspire-toggle");
    var panel = $("#m1-inspire-panel");
    if (toggle && panel) {
      toggle.addEventListener("click", function () {
        var open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
        toggle.classList.toggle("is-open", open);
      });
    }
    $all(".m1-inspire-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var cat = tab.getAttribute("data-cat");
        $all(".m1-inspire-tab").forEach(function (t) {
          t.setAttribute("aria-selected", t === tab ? "true" : "false");
        });
        $all(".m1-inspire-pane").forEach(function (pane) {
          pane.hidden = pane.getAttribute("data-cat") !== cat;
        });
      });
    });
  }

  function bindIntake() {
    var form = $("#m1-intake");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      beginUnderstanding();
    });
    bindExampleChips($("#m1-intake-sec") || form);
    bindInspiration();
  }

  function readDossierSeed() {
    var node = $("#dossier-data");
    if (!node) return { topic: "", originalTopic: "", discipline: "" };
    try {
      var data = JSON.parse(node.textContent || "{}");
      return {
        topic: String(data.topic || "").trim(),
        originalTopic: String(data.original_topic || "").trim(),
        discipline: String(data.discipline || "").trim(),
      };
    } catch (e) {
      return { topic: "", originalTopic: "", discipline: "" };
    }
  }

  function bootFromIntake() {
    var seed = readDossierSeed();
    var q = $("#m1-question");
    var sit = $("#m1-situation");
    if (q && seed.topic && !String(q.value || "").trim()) q.value = seed.topic;
    if (sit && seed.discipline && !String(sit.value || "").trim()) sit.value = seed.discipline;
    if (q && String(q.value || "").trim()) {
      beginUnderstanding();
    }
  }

  function boot() {
    if (!$("#m1-root")) return;
    renderStepper();
    bindStickyStepper();
    bindIntake();
    bindNewQuestion();
    setStep(1);
    bootFromIntake();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
