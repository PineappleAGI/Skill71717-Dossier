/* Skill71717 — Mode 1 Evidence Synthesis (PRISMA-style client flow).
   Talks to the local mode1-server.py /api/* proxy for real literature APIs. */
(function () {
  "use strict";

  var STEPS = [
    { n: 1, action: "The question", name: "Restatement · PICO" },
    { n: 2, action: "Results", name: "Screening → Synthesis" },
    { n: 3, action: "Briefing", name: "Interpretation" },
  ];

  var PIPELINE = [
    {
      id: "search",
      label: "Search",
      prisma: "Identification",
      hint: "Query PubMed, Europe PMC, ClinicalTrials.gov, and OpenAlex.",
    },
    {
      id: "screen",
      label: "Screen & rank",
      prisma: "Screening",
      hint: "Keep papers on the question; drop off-topic hits.",
    },
    {
      id: "extract",
      label: "Extract",
      prisma: "Data extraction",
      hint: "Code population, direction, and quality from abstracts.",
    },
    {
      id: "evaluate",
      label: "Evaluate",
      prisma: "Synthesis",
      hint: "Weigh supporting vs contradicting evidence by study quality.",
    },
  ];
  var PIPE_ORDER = { search: 0, screen: 1, extract: 2, evaluate: 3, done: 4 };

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
      viewStep: 1,
      question: "",
      situation: "",
      activeQuestion: "",
      scope: null,
      papers: [],
      included: [],
      excluded: [],
      extracted: [],
      synthesis: { supporting: [], contradicting: [], gaps: [] },
      relatedPopular: [],
      verdict: null,
      screenLogs: [],
      pipelineStage: "",
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
  var STACK_PREVIEW = 3;
  var RANK_PREVIEW = 9;
  var EXTRACT_PREVIEW = 6;

  var SYNONYMS = {
    "fish oil": ["fish oil", "omega-3", "omega 3", "n-3"],
    "omega-3": ["omega-3", "omega 3", "fish oil"],
    "kidney transplant": ["kidney transplant", "renal transplant", "renal transplantation", "kidney transplantation"],
    "renal transplant": ["kidney transplant", "renal transplant"],
    "intermittent fasting": ["intermittent fasting", "time-restricted eating", "time restricted eating"],
    "time-restricted eating": ["intermittent fasting", "time-restricted eating"],
    "cardiovascular": ["cardiovascular", "cardiac", "heart"],
    "type 2 diabetes": ["type 2 diabetes", "type 2 diabetes mellitus", "t2dm"],
    egg: ["egg", "eggs", "egg intake", "egg consumption"],
    eggs: ["egg", "eggs", "egg intake"],
    "high egg": ["high egg", "egg", "eggs", "egg intake", "egg consumption"],
    meat: ["meat", "red meat", "processed meat"],
    fish: ["fish", "seafood"],
    "young adults": ["young adults", "young adult", "college-aged"],
    protein: ["protein", "protein source"],
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

  function apiGet(path, params, opts) {
    opts = opts || {};
    var qs = new URLSearchParams(params || {}).toString();
    var url = "/api/" + path + (qs ? "?" + qs : "");
    var ctrl = null;
    var timer = null;
    if (opts.timeoutMs && typeof AbortController === "function") {
      ctrl = new AbortController();
      timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs);
    }
    return fetch(url, ctrl ? { signal: ctrl.signal } : {}).then(function (r) {
      return r.json().then(function (body) {
        if (!body || !body.ok) {
          throw new Error((body && body.error) || ("API error " + r.status));
        }
        return body.data;
      });
    }).then(function (data) {
      if (timer) clearTimeout(timer);
      return data;
    }, function (err) {
      if (timer) clearTimeout(timer);
      throw err;
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

  function fitStickySlot() {
    var host = $("#m1-stepper");
    var slot = $("#m1-stepper-slot");
    if (!host || !slot) return;
    if (!document.body.classList.contains("m1-stepper-sticky")) {
      slot.style.height = "";
      return;
    }
    slot.style.height = host.offsetHeight + "px";
    $all("[data-m1-section]").forEach(function (sec) {
      sec.style.scrollMarginTop = (host.offsetHeight + 12) + "px";
    });
  }

  function showSearchLive(on) {
    var bar = $("#m1-search-live");
    if (bar) bar.hidden = !on;
    document.body.classList.toggle("m1-searching", !!on);
    if (!on) {
      var t = $("#m1-search-elapsed");
      if (t) t.textContent = "";
    }
    fitStickySlot();
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
    syncViewStep();
    updatePipelineUI();
  }

  function viewportStep() {
    var host = $("#m1-stepper");
    var sticky = document.body.classList.contains("m1-stepper-sticky");
    var offset = (host && sticky) ? host.offsetHeight + 12 : 96;
    var line = Math.max(offset, window.innerHeight * 0.42);
    var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    var bottom = scrollY + window.innerHeight;
    var docH = document.documentElement.scrollHeight || 0;
    if (docH && bottom >= docH - 32) return state.step || 1;
    var best = 0;
    $all("[data-m1-section]").forEach(function (sec) {
      var sn = parseInt(sec.getAttribute("data-m1-section"), 10);
      if (sn > state.step || sec.hidden) return;
      if (sec.getBoundingClientRect().top <= line) best = sn;
    });
    if (!best) return 1;
    return best;
  }

  function paintStepHighlight(viewN) {
    $all(".m1-step").forEach(function (el) {
      var sn = parseInt(el.getAttribute("data-step"), 10);
      var current = sn === viewN;
      el.classList.toggle("is-current", current);
      el.classList.toggle("is-done", sn < viewN);
      el.classList.toggle("is-locked", sn > state.step);
      if (current) el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");
    });
  }

  function syncViewStep() {
    var n = viewportStep();
    state.viewStep = n;
    paintStepHighlight(n);
    updateStickyTip();
  }

  function updateStickyTip() {
    var n = state.viewStep || state.step;
    var current = STEPS.filter(function (s) { return s.n === n; })[0];
    $all(".m1-sticky-tip").forEach(function (el) {
      if (!current) {
        el.textContent = "";
        return;
      }
      if (document.body.classList.contains("m1-searching") && current.n === 2) {
        var now = PIPELINE.filter(function (p) { return p.id === state.pipelineStage; })[0];
        el.textContent = now
          ? current.action + " · " + now.label + "…"
          : current.action;
        return;
      }
      el.textContent = "Viewing: " + current.name;
    });
  }

  function pipelineHint(p) {
    var harvested = (state.papers || []).length;
    var coreN = (state.included || []).length;
    var extractedN = (state.extracted || []).length;
    var supporting = (state.synthesis && state.synthesis.supporting) || [];
    var contradicting = (state.synthesis && state.synthesis.contradicting) || [];
    if (state.pipelineStage !== "done") return p.hint;
    if (p.id === "search" && harvested) {
      var from = readDossierSeed().static ? "the saved harvest" : "live databases";
      return harvested + " unique record" + (harvested === 1 ? "" : "s") + " from " + from + ".";
    }
    if (p.id === "screen" && harvested) {
      var dropped = Math.max(0, harvested - coreN);
      return coreN + " core kept" + (dropped ? "; " + dropped + " off-topic dropped." : ".");
    }
    if (p.id === "extract" && extractedN) {
      return extractedN + " abstract" + (extractedN === 1 ? "" : "s") + " coded for population, direction, and quality.";
    }
    if (p.id === "evaluate") {
      return supporting.length + " supporting vs " + contradicting.length +
        " contradicting abstracts, then quality-weighted.";
    }
    return p.hint;
  }

  function renderKpis() {
    var host = $("#m1-kpis");
    if (!host) return;
    var harvested = (state.papers || []).length;
    var coreN = (state.included || []).length;
    var extractedN = (state.extracted || []).length;
    var supporting = (state.synthesis && state.synthesis.supporting) || [];
    var contradicting = (state.synthesis && state.synthesis.contradicting) || [];
    var weighed = supporting.length + contradicting.length;
    var items = [
      { n: harvested || "—", l: "Records found" },
      { n: coreN || "—", l: "Screened in" },
      { n: extractedN || "—", l: "Abstracts extracted" },
      { n: weighed || "—", l: "Weighed" },
    ];
    host.innerHTML = items.map(function (k) {
      return '<div class="m1-kpi"><div class="n">' + escapeHtml(String(k.n)) +
        '</div><div class="l">' + escapeHtml(k.l) + "</div></div>";
    }).join("");
  }

  function renderBehindFlow() {
    var host = $("#m1-behind-flow");
    if (!host) return;
    host.innerHTML = PIPELINE.map(function (p, i) {
      return (
        (i ? '<li class="m1-pipe-sep" aria-hidden="true">→</li>' : "") +
        '<li class="m1-pipe" data-pipe="' + p.id + '">' +
        '<span class="m1-pipe-label">' + escapeHtml(p.label) + "</span>" +
        '<span class="m1-pipe-prisma">' + escapeHtml(p.prisma) + "</span>" +
        '<span class="m1-pipe-hint">' + escapeHtml(pipelineHint(p)) + "</span>" +
        "</li>"
      );
    }).join("");
  }

  function setPipeline(id) {
    state.pipelineStage = id || "";
    updatePipelineUI();
  }

  function updatePipelineUI() {
    var stage = state.pipelineStage;
    var idx = PIPE_ORDER.hasOwnProperty(stage) ? PIPE_ORDER[stage] : -1;
    $all(".m1-pipe[data-pipe]").forEach(function (el) {
      var pid = el.getAttribute("data-pipe");
      var i = PIPE_ORDER[pid];
      el.classList.toggle("is-now", stage !== "done" && i === idx);
      el.classList.toggle("is-done", stage === "done" || (idx >= 0 && i < idx));
      var hint = el.querySelector(".m1-pipe-hint");
      var spec = PIPELINE.filter(function (p) { return p.id === pid; })[0];
      if (hint && spec) hint.textContent = pipelineHint(spec);
    });
    renderKpis();
    updateStickyTip();
  }

  function advancePipelineFromLog(msg) {
    var line = String(msg || "");
    if (/keeping |core match|widely cited/i.test(line)) {
      setPipeline("screen");
      return;
    }
    if (/pubmed|europe pmc|clinicaltrials|openalex|web search|publisher/i.test(line)) {
      if ((PIPE_ORDER[state.pipelineStage] || 0) > 0) return;
      setPipeline("search");
    }
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
          var map = { 1: "#restatement", 2: "#evidence", 3: "#briefing" };
          var target = $(map[sn] || ('[data-m1-section="' + sn + '"]'));
          if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    renderBehindFlow();
    updatePipelineUI();
  }

  function bindStickyStepper() {
    var host = $("#m1-stepper");
    var sentinel = $("#m1-stepper-sentinel");
    if (!host || !sentinel) return;
    function applySticky(past) {
      var was = document.body.classList.contains("m1-stepper-sticky");
      if (past === was) return;
      if (past) {
        document.body.classList.add("m1-stepper-sticky");
        window.requestAnimationFrame(fitStickySlot);
      } else {
        document.body.classList.remove("m1-stepper-sticky");
        fitStickySlot();
      }
    }
    function onScroll() {
      applySticky(sentinel.getBoundingClientRect().bottom < 0);
      syncViewStep();
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
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

  function citeLinkHTML(href, cite) {
    var c = escapeHtml(cite);
    return href
      ? '<a class="arena-cite" href="' + escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">' + c + "</a>"
      : '<span class="arena-cite">' + c + "</span>";
  }

  function titleLinkHTML(href, title) {
    var t = escapeHtml(title || "Untitled");
    return href
      ? '<a class="m1-evidence-title-link" href="' + escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">' + t + "</a>"
      : "<strong>" + t + "</strong>";
  }

  function openPaperHTML(href) {
    if (!href) return "";
    return (
      '<a class="arena-open" href="' + escapeHtml(href) +
      '" target="_blank" rel="noopener noreferrer">Open paper →</a>'
    );
  }

  function unspecified(s) {
    var t = String(s || "").trim();
    if (!t || /^not specified/i.test(t) || /^not reported/i.test(t)) return "";
    return t;
  }

  function parseAbstractSections(text) {
    var raw = String(text || "").replace(/\s+/g, " ").trim();
    var background = "";
    var objective = "";
    if (!raw) return { background: background, objective: objective };
    var heading =
      "background|introduction|objective|objectives|aim|aims|purpose|purposes|" +
      "methods|method|materials and methods|results|result|findings|conclusion|conclusions|discussion";
    var re = new RegExp("(?:^|[.!?\\s])(" + heading + ")\\s*[:.\\u2014\\u2013-]\\s+", "gi");
    var hits = [];
    var m;
    while ((m = re.exec(raw))) {
      hits.push({
        label: m[1].toLowerCase(),
        contentStart: m.index + m[0].length,
        headingStart: m.index,
      });
    }
    function kind(label) {
      if (label === "background" || label === "introduction") return "background";
      if (/^(objective|objectives|aim|aims|purpose|purposes)$/.test(label)) return "objective";
      return "";
    }
    var i;
    for (i = 0; i < hits.length; i++) {
      var key = kind(hits[i].label);
      if (!key) continue;
      var nextStart = i + 1 < hits.length ? hits[i + 1].headingStart : raw.length;
      var chunk = raw.slice(hits[i].contentStart, nextStart).trim();
      if (key === "background" && !background) background = chunk;
      if (key === "objective" && !objective) objective = chunk;
    }
    if (!objective) {
      var aim =
        raw.match(/\b(?:the\s+)?(?:aim|aims|objective|objectives|purpose)\s+(?:of\s+(?:the|this)\s+(?:study|review|paper|work)\s+)?(?:was|were|is|are)\s+to\s+[^.?]{12,240}[.?]?/i) ||
        raw.match(/\bwe\s+(?:aimed|sought|intended)\s+to\s+[^.?]{12,240}[.?]?/i) ||
        raw.match(/\bthis\s+(?:study|review|paper)\s+(?:aimed|aims|sought)\s+to\s+[^.?]{12,240}[.?]?/i);
      if (aim) objective = aim[0];
    }
    if (!background) {
      var lead = firstSentences(raw, 240);
      if (lead && (!objective || objective.indexOf(lead.slice(0, 36)) === -1)) background = lead;
    }
    return {
      background: firstSentences(background, 280),
      objective: firstSentences(objective, 220),
    };
  }

  function aimRow(label, value) {
    var v = unspecified(value);
    if (!v) return "";
    return "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(v) + "</dd></div>";
  }

  function splitSentences(text) {
    var t = String(text || "").replace(/\s+/g, " ").trim();
    if (!t) return [];
    var out = [];
    var re = /[^.!?]+[.!?]+|[^.!?]+$/g;
    var m;
    while ((m = re.exec(t))) out.push(m[0].trim());
    return out.filter(Boolean);
  }

  function clipPhrase(s, maxChars) {
    var t = stripTags(s);
    if (!t) return "";
    if (t.length <= maxChars) return t;
    var cut = t.slice(0, maxChars);
    var m = cut.match(/^(.*?[.!?])(\s|$)/);
    if (m && m[1].length > 50) return m[1];
    return cut.replace(/\s+\S*$/, "") + "…";
  }

  function questionTerms() {
    var q = state.activeQuestion || state.meaning || state.question || "";
    var terms = distinctiveTerms(q).slice();
    (state.concepts || []).forEach(function (c) {
      conceptNeedles(c).forEach(function (s) {
        var k = String(s || "").toLowerCase().trim();
        if (k.length >= 4 && terms.indexOf(k) === -1 && !GENERIC_TOPIC[k]) terms.push(k);
      });
    });
    return terms.sort(function (a, b) { return b.length - a.length; });
  }

  function sentenceScore(sent, terms) {
    var low = String(sent || "").toLowerCase();
    var n = 0;
    (terms || []).forEach(function (t) {
      if (t && low.indexOf(t) !== -1) n += t.length >= 5 ? 2 : 1;
    });
    return n;
  }

  function questionRelevantAims(paper) {
    paper = paper || {};
    var q = state.activeQuestion || state.meaning || state.question || "";
    var blob = stripTags(((paper.abstract || "") + " " + (paper.fullTextSnippet || "")).trim());
    var cacheKey = q + "\n" + blob;
    if (paper._sumKey === cacheKey && paper._sum) return paper._sum;
    var parsed = parseAbstractSections(blob);
    var terms = questionTerms();
    var scored = splitSentences(blob).map(function (s) {
      return { s: s, n: sentenceScore(s, terms) };
    }).filter(function (x) { return x.n > 0; }).sort(function (a, b) { return b.n - a.n; });
    var background = scored[0] ? clipPhrase(scored[0].s, 150) : clipPhrase(parsed.background, 140);
    var objective = "";
    if (parsed.objective && sentenceScore(parsed.objective, terms) > 0) {
      objective = clipPhrase(parsed.objective, 130);
    } else if (scored[1]) {
      objective = clipPhrase(scored[1].s, 130);
    } else {
      objective = clipPhrase(parsed.objective, 120);
    }
    if (objective && background && objective.slice(0, 40) === background.slice(0, 40)) objective = "";
    paper._sum = { background: background, objective: objective };
    paper._sumKey = cacheKey;
    paper.background = background;
    paper.objective = objective;
    return paper._sum;
  }

  function aimBlockHTML(paper) {
    var aims = questionRelevantAims(paper);
    var rows = aimRow("Background", aims.background) + aimRow("Objective", aims.objective);
    if (!rows) return "";
    return '<dl class="m1-pico m1-aim">' + rows + "</dl>";
  }

  function cardsForCol(colId) {
    if (colId === "core") {
      return (state.papers || []).filter(function (p) { return p.tier === "core"; }).map(paperCard).join("");
    }
    if (colId === "related") {
      return (state.papers || []).filter(function (p) { return p.tier === "related"; }).map(paperCard).join("");
    }
    if (colId === "tail") {
      return (state.papers || []).filter(function (p) { return p.tier === "unrelated"; }).map(paperCard).join("");
    }
    if (colId === "extract") {
      return (state.extracted || []).map(extractCardHTML).join("");
    }
    if (colId === "support") {
      return sortSynthItems(state.synthesis.supporting).map(function (x) {
        return synthCardHTML(x, "for");
      }).join("");
    }
    if (colId === "against") {
      return sortSynthItems(state.synthesis.contradicting).map(function (x) {
        return synthCardHTML(x, "against");
      }).join("");
    }
    if (colId === "gap") {
      return sortSynthItems(state.synthesis.gaps).map(function (x) {
        return synthCardHTML(x, "gap");
      }).join("");
    }
    if (colId === "popular") {
      return (state.relatedPopular || []).map(popularCardHTML).join("");
    }
    return "";
  }

  function bindCollapsedMore(root) {
    $all(".m1-synth-more, .m1-show-all", root).forEach(function (btn) {
      if (btn.getAttribute("data-bound")) return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function () {
        var col = btn.getAttribute("data-expand");
        var stack = (root || document).querySelector('[data-col="' + col + '"]');
        if (stack) {
          var html = cardsForCol(col);
          if (html) stack.innerHTML = html;
          stack.classList.remove("is-collapsed");
        }
        if (btn.parentNode) btn.parentNode.removeChild(btn);
      });
    });
  }

  function collapsedColumn(title, headingClass, items, colId, emptyLabel, toCard, preview, stackClass) {
    preview = preview == null ? STACK_PREVIEW : preview;
    var extra = Math.max(0, items.length - preview);
    var body = items.length
      ? items.slice(0, preview).map(toCard).join("")
      : '<p class="arena-empty">' + escapeHtml(emptyLabel || "None yet.") + "</p>";
    var more = extra
      ? '<button type="button" class="btn m1-synth-more" data-expand="' + colId +
        '">Show ' + extra + " more</button>"
      : "";
    var stack = stackClass || "arena-stack m1-synth-stack";
    return (
      "<section>" +
      '<h3 class="' + headingClass + '">' + escapeHtml(title) +
      " <span>" + items.length + "</span></h3>" +
      '<div class="' + stack + (extra ? " is-collapsed" : "") +
      '" data-col="' + colId + '">' + body + "</div>" +
      more +
      "</section>"
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
      abstract: invertAbstract(w.abstract_inverted_index),
      url: w.doi || (w.primary_location && w.primary_location.landing_page_url) || "",
      citationCount: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
      sourceApis: ["openalex"],
    };
  }

  function invertAbstract(idx) {
    if (!idx || typeof idx !== "object") return "";
    var slots = [];
    Object.keys(idx).forEach(function (word) {
      (idx[word] || []).forEach(function (i) {
        slots[i] = word;
      });
    });
    return slots.filter(Boolean).join(" ");
  }

  function paperKey(p) {
    if (!p) return "";
    if (p.pmid) return "pmid:" + String(p.pmid);
    var doi = String(p.doi || "").toLowerCase().replace(/^https?:\/\/doi\.org\//i, "");
    if (doi) return "doi:" + doi;
    return "t:" + String(p.title || "").toLowerCase().replace(/\s+/g, " ").slice(0, 80);
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
      if (p.citationCount != null && (cur.citationCount == null || p.citationCount > cur.citationCount)) {
        cur.citationCount = p.citationCount;
      }
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

  function conceptNeedles(c) {
    var out = synonyms(c).slice();
    String(c || "").toLowerCase().split(/\s+/).forEach(function (tok) {
      if (tok.length >= 4 && !GENERIC_TOPIC[tok] && out.indexOf(tok) === -1) out.push(tok);
    });
    return out;
  }

  function rankPaper(paper, concepts, central) {
    var title = (paper.title || "").toLowerCase();
    var abs = (paper.abstract || "").toLowerCase();
    var blob = title + " " + abs;
    var hitList = [];
    var titleHits = 0;
    (concepts || []).forEach(function (c) {
      var needles = conceptNeedles(c);
      var matched = needles.some(function (s) {
        return blob.indexOf(s.toLowerCase()) !== -1;
      });
      if (matched) hitList.push(c);
      if (needles.some(function (s) { return title.indexOf(s.toLowerCase()) !== -1; })) {
        titleHits += 1;
      }
    });
    var hits = hitList.length;
    var type = studyType(paper.pubTypes);
    var typeBoost = type === "RCT" ? 3 : type === "review" ? 2.2 : type === "observational" ? 1 : type === "case series" ? -1 : 0;
    var recency = paper.year ? Math.max(0, Number(paper.year) - 1990) / 40 : 0;
    var score = hits * 10 + titleHits * 4 + typeBoost + recency;
    var weakHit = {
      adults: 1, adult: 1, intake: 1, source: 1, young: 1, high: 1, people: 1,
      cardiovascular: 1, cardiac: 1, heart: 1, protein: 1, health: 1, nutrition: 1,
      diet: 1, dietary: 1, risk: 1, outcome: 1, outcomes: 1,
    };
    var strongHits = hitList.filter(function (c) {
      var k = String(c || "").toLowerCase();
      return k && !weakHit[k] && !GENERIC_TOPIC[k];
    });
    var specificInTitle = strongHits.some(function (c) {
      return conceptNeedles(c).some(function (s) {
        return s && title.indexOf(s.toLowerCase()) !== -1;
      });
    });
    var tier = "unrelated";
    if (specificInTitle) tier = "core";
    else if (strongHits.length >= 2 || hits >= 2) tier = "related";
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
    if (paper.stance === "supports" || paper.stance === "contradicts") {
      eff = { dir: paper.stance, note: paper.oneLineClaim || eff.note };
    } else if (paper.stance) {
      eff = { dir: "unclear", note: paper.oneLineClaim || eff.note };
    }
    var n = extractPopulation(blob).n;
    var first = (paper.authors && paper.authors[0]) || "Authors unavailable";
    var last = first.split(" ").pop();
    var pop = (pico.population || "").trim();
    var aims = questionRelevantAims(paper);
    var quality = qualityFlag(type);
    if (paper.quality === "strong" || paper.quality === "moderate" || paper.quality === "weak") {
      quality = paper.quality;
    }
    return {
      paper: paper,
      study: last + (paper.year ? " " + paper.year : ""),
      population: pop || "Not specified in abstract",
      intervention: pico.intervention || "Not specified in abstract",
      outcome: pico.outcome || "Not specified in abstract",
      background: aims.background,
      objective: aims.objective,
      effect: eff.dir,
      effectNote: eff.note,
      studyType: type || "Not reported",
      sampleSize: n,
      quality: quality,
      relevance: paper.tier || paper.relevance,
    };
  }

  function beginUnderstanding(opts) {
    opts = opts || {};
    var q = ($("#m1-question") || {}).value || "";
    var sit = ($("#m1-situation") || {}).value || "";
    q = q.trim();
    if (!q) {
      setStatus("No research question was seeded from the form.");
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
    setStep(1);
    setStatus("");
    renderUnderstanding();
    paintConceptMap();
    startSearch({ scroll: false });
    setStep(2);
    if (opts.scroll) {
      var host = $("#m1-understand");
      if (host) host.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function renderUnderstanding() {
    var el = $("#m1-understand-body");
    if (!el) return;
    el.innerHTML =
      '<p class="m1-restate-kicker">Here’s what I understand you’re asking</p>' +
      '<p class="m1-restate">' + escapeHtml(state.restatement) + "</p>" +
      '<p class="m1-lead">Search already started from this reading.</p>';
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
    var href = paperHref(p);
    var bits = [escapeHtml(type)];
    if (p.year) bits.push(escapeHtml(String(p.year)));
    var cite = shortCiteRow({ paper: p, study: "" });
    return (
      '<article class="m1-evidence-card side-for">' +
      '<p class="arena-claim">' + titleLinkHTML(href, p.title) + "</p>" +
      '<p class="m1-evidence-bits">' + bits.join(" · ") + "</p>" +
      aimBlockHTML(p) +
      '<div class="arena-card-foot">' +
      citeLinkHTML(href, cite) +
      "</div>" +
      openPaperHTML(href) +
      webSourceHTML(p) +
      "</article>"
    );
  }

  var GENERIC_DISCIPLINE = {
    epidemiology: 1, medicine: 1, medical: 1, science: 1, sciences: 1,
    research: 1, studies: 1, study: 1, health: 1, public: 1, clinical: 1,
    biology: 1, engineering: 1, computer: 1, learning: 1,
  };
  var POPULAR_SKIP = {
    protein: 1, energy: 1, model: 1, data: 1, system: 1, analysis: 1,
  };

  function populationTerm(t) {
    return /college|student|adult|aged|young|child|pediatric|elderly/.test(String(t || ""));
  }

  function popularFocusTerms() {
    return distinctiveTerms(state.activeQuestion || state.question).filter(function (t) {
      return !POPULAR_SKIP[t] && !GENERIC_DISCIPLINE[t] && !populationTerm(t);
    });
  }

  function popularQuery() {
    var terms = popularFocusTerms();
    if (terms[0]) {
      var phrase = synonyms(terms[0]).filter(function (s) { return /\s/.test(s); })[0];
      if (phrase) terms[0] = phrase;
    }
    if (!terms.length && state.central) terms = [state.central];
    return terms.slice(0, 3).join(" ").trim();
  }

  function isFlagshipVenue(venue) {
    var v = String(venue || "").toLowerCase().replace(/[:.].*$/, "").trim();
    if (!v) return false;
    var names = [
      "new england journal of medicine",
      "the lancet",
      "lancet",
      "jama internal medicine",
      "jama cardiology",
      "jama",
      "british medical journal",
      "bmj",
      "nature medicine",
      "nature reviews",
      "nature",
      "science",
      "cell metabolism",
      "circulation",
      "european heart journal",
      "annals of internal medicine",
      "plos medicine",
      "american journal of clinical nutrition",
      "neurips",
      "nature machine intelligence",
    ];
    return names.some(function (n) {
      if (v === n) return true;
      if (v.indexOf(n + " ") === 0 || v.indexOf(n + ",") === 0) return true;
      if (n.length >= 12 && v.indexOf(n) !== -1) return true;
      return false;
    });
  }

  function popularScore(p) {
    var cites = p.citationCount || 0;
    var bonus = 0;
    if (isFlagshipVenue(p.venue)) bonus += 5000;
    if ((p.year || 0) >= 2018) bonus += 200;
    return cites + bonus;
  }

  function isTopicalPopular(p) {
    var title = String(p.title || "").toLowerCase();
    var q = String(state.activeQuestion || state.question || "").toLowerCase();
    var terms = popularFocusTerms();
    var must = terms[0];
    var hasMust = false;
    if (must) {
      hasMust = synonyms(must).concat([must]).some(function (s) {
        var tok = String(s).split(/\s+/)[0];
        return tok.length >= 3 && title.indexOf(tok) !== -1;
      });
    }
    var healthQ = /cardiovascular|cardiac|heart|coronary|stroke|cholesterol/.test(q);
    var healthT = /cardiovascular|cardiac|heart|coronary|stroke|cholesterol|diabetes|mortality/.test(title);
    if (healthQ && !healthT) return false;
    if (hasMust) return true;
    return terms.filter(function (t) { return title.indexOf(t) !== -1; }).length >= 2;
  }

  function popularWhy(p) {
    if (isFlagshipVenue(p.venue)) return "Major journal in this field";
    if ((p.citationCount || 0) >= 1000) return "Widely cited in this field";
    return "Highly cited on this topic";
  }

  function formatCount(n) {
    if (n == null || isNaN(n)) return "";
    return Number(n).toLocaleString("en-US");
  }

  function skipPopularType(p) {
    var types = (p.pubTypes || []).join(" ");
    return /paratext|erratum|peer-review|peer review/i.test(types);
  }

  function ingestOpenAlex(oa, seen, out) {
    ((oa && oa.results) || []).forEach(function (w) {
      var p = normalizeOpenAlex(w);
      if (!p.title || skipPopularType(p)) return;
      var k = paperKey(p);
      if (!k || seen[k]) return;
      seen[k] = 1;
      p.popularWhy = popularWhy(p);
      out.push(p);
    });
  }

  function fetchPopularPapers() {
    var q = popularQuery();
    if (!q) {
      state.relatedPopular = [];
      return Promise.resolve([]);
    }
    var extraQ = popularFocusTerms().slice(1, 4).join(" ");
    var jobs = [apiGet("openalex/search", { q: q, per_page: "50", sort: "relevance_score:desc" })];
    if (extraQ && extraQ !== q) {
      jobs.push(apiGet("openalex/search", {
        q: extraQ,
        per_page: "40",
        sort: "relevance_score:desc",
      }));
    }
    return Promise.all(jobs).then(function (results) {
      var seen = {};
      var out = [];
      results.forEach(function (oa) { ingestOpenAlex(oa, seen, out); });
      var topical = out.filter(isTopicalPopular);
      topical.sort(function (a, b) { return popularScore(b) - popularScore(a); });
      state.relatedPopular = topical.slice(0, 12);
      return state.relatedPopular;
    });
  }

  function popularCardHTML(p) {
    var href = paperHref(p);
    var bits = [];
    if (p.venue) bits.push(escapeHtml(p.venue));
    if (p.year) bits.push(escapeHtml(String(p.year)));
    var cites = formatCount(p.citationCount);
    if (cites) bits.push(cites + " citations");
    var abs = String(p.abstract || "").replace(/\s+/g, " ").trim();
    var snippet = "";
    if (abs) {
      if (abs.length > 220) abs = abs.slice(0, 217) + "…";
      snippet = '<p class="m1-evidence-pop">' + escapeHtml(abs) + "</p>";
    }
    return (
      '<article class="m1-evidence-card m1-related-card">' +
      '<p class="m1-related-why">' + escapeHtml(p.popularWhy || popularWhy(p)) + "</p>" +
      '<p class="arena-claim">' + titleLinkHTML(href, p.title) + "</p>" +
      (bits.length ? '<p class="m1-evidence-bits">' + bits.join(" · ") + "</p>" : "") +
      snippet +
      '<div class="arena-card-foot">' +
      citeLinkHTML(href, shortCiteRow({ paper: p, study: "" })) +
      "</div>" +
      openPaperHTML(href) +
      "</article>"
    );
  }

  function relatedPapersHTML() {
    var items = state.relatedPopular || [];
    if (!items.length) {
      return '<p class="m1-footnote">No widely cited field papers were returned for this scan.</p>';
    }
    var extra = Math.max(0, items.length - 6);
    var more = extra
      ? '<div class="m1-list-meta"><button type="button" class="btn m1-synth-more" data-expand="popular">Show ' +
        Math.min(6, extra) + ' more</button>' +
        (extra > 6
          ? '<button type="button" class="m1-show-all" data-expand="popular">Show all ' +
            items.length + "</button>"
          : "") +
        '<span class="m1-list-count">Showing 6 of ' + items.length + " papers</span></div>"
      : '<p class="m1-list-count">Showing ' + items.length + " of " + items.length + " papers</p>";
    return (
      '<p class="m1-footnote">Widely cited work from major journals in the same research area. Citation counts come from OpenAlex. These are not a direct test of the question.</p>' +
      '<div class="m1-related-grid' + (extra ? " is-collapsed" : "") +
      '" data-col="popular">' +
      items.map(popularCardHTML).join("") +
      "</div>" + more
    );
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
    paintConceptMap();
    state.papers = [];
    state.included = [];
    state.excluded = [];
    state.relatedPopular = [];
    showSearchLive(true);
    setPipeline("search");
    startSearchClock();
    var shouldScroll = opts.scroll !== false;
    var logs = [];
    function stale() {
      return gen !== state.searchGen;
    }
    function log(msg) {
      if (stale()) return;
      logs.push(msg);
      state.screenLogs = logs.slice();
      setStatus(msg);
      advancePipelineFromLog(msg);
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
        if (mergePapers(papers).length >= 40) {
          return { results: [], queries: [], skipped: true };
        }
        log("Supplementary web search for ScienceDirect and other publisher pages…");
        return apiGet("websearch", {
          q: webSearchTerms(state.concepts, state.activeQuestion),
          max: "8",
        }, { timeoutMs: 8000 }).catch(function () {
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
        if (web && web.skipped) {
          log("Skipping publisher-page sweep — already have enough indexed papers.");
        } else if (added) {
          log("Web search added " + added + " records from visible search/abstract pages (not the Elsevier API).");
        } else {
          log("Web search returned no extra publisher pages.");
        }
        var merged = mergePapers(papers).filter(function (p) {
          return p.title && !/^contributes evidence/i.test(p.title);
        });
        log("Keeping " + merged.filter(function (p) { return p.tier === "core"; }).length +
          " core matches…");
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
        state.included = merged.filter(function (p) { return p.tier === "core"; });
        state.excluded = merged.filter(function (p) { return p.tier !== "core"; });
        log("Looking up widely cited papers in this field…");
        return fetchPopularPapers().catch(function () {
          state.relatedPopular = [];
        });
      })
      .then(function () {
        if (stale()) return Promise.reject({ stale: true });
        state.searching = false;
        stopSearchClock();
        showSearchLive(false);
        finishResults();
        setStatus("");
        if (shouldScroll) {
          var resultsHost = $("#evidence") || $("#m1-results");
          if (resultsHost) resultsHost.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        return enrichUnpaywall(state.included.slice(0, 15));
      })
      .then(function () {
        if (stale()) return Promise.reject({ stale: true });
        return fillMissingPopulations(state.included.slice(0, 12));
      })
      .then(function () {
        if (stale()) return;
        finishResults();
      })
      .catch(function (err) {
        if (err && err.stale) return;
        state.searching = false;
        stopSearchClock();
        showSearchLive(false);
        setStatus("Full review failed: " + (err.message || err));
        setStep(2);
        var el = $("#m1-results-body");
        if (el) {
          el.innerHTML =
            '<div class="m1-search-panel" role="alert"><h3>Search failed</h3><p>' +
            escapeHtml(err.message || String(err)) +
            "</p><p>The page is not still loading. Reload to try the search again.</p></div>";
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
    return Promise.all(jobs);
  }

  function dirLabel(dir) {
    if (dir === "supports") return "Supports";
    if (dir === "contradicts") return "Contradicts";
    if (dir === "gap") return "Open question";
    return "Unclear";
  }

  function picoRow(label, value) {
    var v = unspecified(value);
    if (!v) return "";
    return (
      "<div><dt>" + escapeHtml(label) + "</dt><dd>" + escapeHtml(v) + "</dd></div>"
    );
  }

  function extractCardHTML(row, i) {
    var p = row.paper || {};
    var href = paperHref(p);
    var dir = row.effect || "unclear";
    var side = dir === "supports" ? "for" : dir === "contradicts" ? "against" : "gap";
    var pico = picoRow("Who", row.population) +
      picoRow("Exposure", row.intervention) +
      picoRow("Outcome", row.outcome);
    var bits = [];
    var type = unspecified(row.studyType);
    if (type) bits.push(escapeHtml(type));
    if (row.sampleSize != null) bits.push("n=" + escapeHtml(String(row.sampleSize)));
    return (
      '<article class="m1-evidence-card side-' + side + '" id="m1-row-' + i + '">' +
      '<p class="arena-claim">' + titleLinkHTML(href, p.title) + "</p>" +
      aimBlockHTML(p) +
      (pico ? '<dl class="m1-pico">' + pico + "</dl>" : "") +
      (bits.length ? '<p class="m1-evidence-bits">' + bits.join(" · ") + "</p>" : "") +
      '<div class="arena-card-foot">' +
      '<span class="m1-dir m1-dir-' + escapeHtml(dir) + '">' + escapeHtml(dirLabel(dir)) + "</span>" +
      '<span class="badge strength-' + escapeHtml(row.quality || "weak") + '">' +
      escapeHtml(row.quality || "weak") + "</span>" +
      citeLinkHTML(href, shortCiteRow(row)) +
      "</div>" +
      openPaperHTML(href) +
      webSourceHTML(p) +
      "</article>"
    );
  }

  function finishResults() {
    setPipeline("extract");
    state.extracted = (state.papers || []).filter(function (p) {
      return p.tier === "core";
    }).map(function (p) {
      return extractRow(p, state.activeQuestion);
    });
    setPipeline("evaluate");
    var supporting = [];
    var contradicting = [];
    var gaps = [];
    state.extracted.forEach(function (row, i) {
      if (!row.paper || row.paper.tier !== "core") return;
      if (row.effect === "supports") supporting.push({ row: row, i: i });
      else if (row.effect === "contradicts") contradicting.push({ row: row, i: i });
      else gaps.push({ row: row, i: i });
    });
    state.synthesis = { supporting: supporting, contradicting: contradicting, gaps: gaps };
    setPipeline("done");
    renderResults();
    buildVerdict();
  }

  function behindTheResultsHTML() {
    return (
      '<p class="m1-behind-inline">' +
      "<strong>Behind “See the results.”</strong> " +
      PIPELINE.map(function (p, i) {
        return (i ? '<span class="m1-behind-inline-sep" aria-hidden="true"> → </span>' : "") +
          '<span class="m1-behind-inline-item"><strong>' + escapeHtml(p.label) +
          "</strong> (" + escapeHtml(p.prisma) + "): " + escapeHtml(pipelineHint(p)) + "</span>";
      }).join("") +
      "</p>"
    );
  }

  function renderResults() {
    var el = $("#m1-results-body");
    if (!el) return;
    var supporting = state.synthesis.supporting || [];
    var contradicting = state.synthesis.contradicting || [];
    var coreN = (state.included || []).length;
    var sw = supporting.reduce(function (n, x) { return n + synthWeight(x.row); }, 0);
    var cw = contradicting.reduce(function (n, x) { return n + synthWeight(x.row); }, 0);
    var pct = synthPercents([sw, cw]);
    var queryLine = state.query
      ? '<p class="m1-query">Kept ' + coreN + " core paper" + (coreN === 1 ? "" : "s") +
        ". Search used: <code>" + escapeHtml(state.query) + "</code></p>"
      : "";
    if (!coreN) {
      el.innerHTML = queryLine + "<p>No core matches for this question.</p>";
      paintRelated();
      paintConceptMap();
      return;
    }
    var seed = readDossierSeed();
    el.innerHTML =
      queryLine +
      '<p class="m1-footnote">A simplified <strong>direction-of-effect synthesis</strong> — the technique used when studies are too different to pool statistically. Grouped by what each abstract implies, then weighted by study quality. Papers whose abstracts are unclear on direction are left off this bar.</p>' +
      '<div class="arena-bar-wrap m1-synth-bar-wrap">' +
      '<div class="arena-bar" role="img" aria-label="Supporting ' + pct[0] +
      " percent, contradicting " + pct[1] + ' percent">' +
      '<span class="arena-bar-for" style="width:' + pct[0] + '%"></span>' +
      '<span class="arena-bar-against" style="width:' + pct[1] + '%"></span>' +
      "</div>" +
      '<p class="arena-bar-legend m1-synth-legend">' +
      '<span class="for">Supporting — weighted ' + pct[0] + "%</span>" +
      '<span class="against">Contradicting — weighted ' + pct[1] + "%</span>" +
      "</p></div>" +
      '<div class="m1-synth-cols">' +
      synthColumnHTML("Evidence supporting", "for", "for", supporting, "support", seed.supportBlurb) +
      synthColumnHTML("Evidence contradicting", "against", "against", contradicting, "against", seed.contraBlurb) +
      "</div>";
    bindCopy(el);
    bindCollapsedMore(el);
    paintRelated();
    paintConceptMap();
  }

  var QUALITY_W = { strong: 3, moderate: 2, weak: 1 };

  function synthWeight(row) {
    return QUALITY_W[(row && row.quality) || ""] || 1;
  }

  function sortSynthItems(items) {
    return (items || []).slice().sort(function (a, b) {
      return synthWeight(b.row) - synthWeight(a.row);
    });
  }

  function shortCiteRow(row) {
    var paper = (row && row.paper) || {};
    var authors = paper.authors || [];
    var n = typeof authors === "string" ? 1 : authors.length;
    var name = lastNameFromRow(row);
    var etal = n > 1 ? " et al." : "";
    var year = paper.year || "";
    return name + etal + (year ? ", " + year : "");
  }

  function synthCardHTML(item, side) {
    var row = item.row || {};
    var paper = row.paper || {};
    var href = paperHref(paper);
    var strength = row.quality || "weak";
    var cite = escapeHtml(shortCiteRow(row));
    var citeHtml = href
      ? '<a class="arena-cite" href="' + escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">' + cite + "</a>"
      : '<span class="arena-cite">' + cite + "</span>";
    var title = paper.title || "Untitled";
    var titleHtml = href
      ? '<a class="m1-evidence-title-link" href="' + escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">' + escapeHtml(title) + "</a>"
      : "<strong>" + escapeHtml(title) + "</strong>";
    var openHtml = href
      ? '<a class="arena-open" href="' + escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">Open paper →</a>'
      : "";
    var bits = [];
    if (row.studyType && row.studyType !== "Not reported") bits.push(escapeHtml(row.studyType));
    if (row.sampleSize != null) bits.push("n=" + escapeHtml(String(row.sampleSize)));
    var metaBits = bits.length
      ? '<p class="m1-evidence-bits">' + bits.join(" · ") + "</p>"
      : "";
    var pop = row.population && row.population !== "Not specified in abstract"
      ? '<p class="m1-evidence-pop">' + escapeHtml(row.population) + "</p>"
      : "";
    return (
      '<article class="m1-evidence-card side-' + side + '">' +
      '<p class="arena-claim">' + titleHtml + "</p>" +
      metaBits +
      aimBlockHTML(paper) +
      pop +
      '<div class="arena-card-foot">' +
      '<span class="badge strength-' + escapeHtml(strength) + '">' +
      escapeHtml(strength) + "</span>" +
      citeHtml +
      "</div>" +
      openHtml +
      "</article>"
    );
  }

  function synthColumnHTML(title, headingClass, side, items, colId, blurb) {
    var sorted = sortSynthItems(items);
    var html = collapsedColumn(
      title,
      headingClass,
      sorted,
      colId,
      "None in this first extract.",
      function (x) { return synthCardHTML(x, side); },
      3
    );
    if (blurb) {
      html = html.replace(
        "</h3>",
        "</h3><p class=\"m1-col-blurb\">" + escapeHtml(blurb) + "</p>"
      );
    }
    return html;
  }

  function synthPercents(weights) {
    var tot = 0;
    var i;
    for (i = 0; i < weights.length; i++) tot += weights[i];
    if (tot <= 0) return weights.map(function () { return 0; });
    var floors = weights.map(function (w) { return Math.floor((w / tot) * 100); });
    var rem = 100;
    for (i = 0; i < floors.length; i++) rem -= floors[i];
    var order = weights.map(function (w, idx) {
      return { i: idx, frac: (w / tot) * 100 - floors[idx] };
    }).sort(function (a, b) { return b.frac - a.frac; });
    for (i = 0; i < rem; i++) floors[order[i].i] += 1;
    return floors;
  }

  function unwrapSynth(list) {
    return (list || []).map(function (x) { return x.row || x; });
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

  var GENERIC_TOPIC = {
    adult: 1, adults: 1, young: 1, year: 1, years: 1, associated: 1,
    outcome: 1, outcomes: 1, intake: 1, source: 1, high: 1, worse: 1,
    long: 1, term: 1, among: 1, risk: 1, factor: 1, factors: 1,
    disease: 1, diseases: 1, related: 1, using: 1, based: 1,
    patient: 1, patients: 1, human: 1, people: 1, person: 1,
    health: 1, clinical: 1, aged: 1, student: 1, students: 1,
    college: 1, vs: 1, versus: 1, "college-aged": 1, "young-adult": 1,
    "young-adults": 1,
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

  function buildArticleModel() {
    var question = displayQuestion();
    var s = unwrapSynth(state.synthesis.supporting);
    var c = unwrapSynth(state.synthesis.contradicting);
    var g = unwrapSynth(state.synthesis.gaps);
    var onTopic = (state.extracted || []).filter(function (r) {
      return r.paper && r.paper.tier !== "unrelated";
    });
    var closeN = onTopic.filter(function (r) { return topicScore(r, question) >= 4; }).length;
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
    var ledeParas = [
      "This is a scan of published abstracts — not a pooled analysis, and not medical advice.",
    ];
    if (closeN < 2) {
      ledeParas.push("Most of what came back is nearby literature, not a direct test of the comparison you asked.");
    } else if (s.length && c.length) {
      ledeParas.push("The closer papers do not all point the same way.");
    }
    var conclusion = plainAnswer +
      " If you need a decision for a real person, that is a clinician’s job and requires the full papers.";
    var coreN = (state.included || []).length;
    var paragraph = "Kept " + coreN + " core papers for this question. " + plainAnswer;
    return {
      question: tidyQuestion(question),
      headline: headline,
      plainAnswer: plainAnswer,
      ledeParas: ledeParas,
      conclusion: conclusion,
      supporting: s,
      contradicting: c,
      gaps: g,
      paragraph: paragraph,
    };
  }

  function renderArticleHtml(model) {
    var lede = (model.ledeParas || []).map(function (p) {
      return "<p>" + escapeHtml(p) + "</p>";
    }).join("");
    return (
      '<article class="m1-article">' +
      '<p class="m1-article-kicker">Plain-language briefing</p>' +
      '<h3 class="m1-article-hed">' + escapeHtml(model.headline) + "</h3>" +
      '<p class="m1-article-answer">' + escapeHtml(model.plainAnswer) + "</p>" +
      '<div class="m1-article-lede">' + lede + "</div>" +
      "<h3>Bottom line</h3>" +
      "<p>" + escapeHtml(model.conclusion) + "</p>" +
      '<p class="m1-article-note">This page is a reading of retrieved abstracts. It is not a diagnosis, a diet plan, or medical advice.</p>' +
      "</article>"
    );
  }

  function bindBlogExports() {
    function wire(id, runner, busyLabel) {
      var btn = $(id);
      if (!btn || typeof runner !== "function") return;
      btn.addEventListener("click", function () {
        var label = btn.textContent;
        btn.disabled = true;
        btn.textContent = busyLabel;
        Promise.resolve(runner({ question: displayQuestion() })).then(function (info) {
          btn.disabled = false;
          var saved = info && info.ok && info.data && (info.data.filename || info.data.copied);
          btn.textContent = saved ? (info.data.copied ? "Copied" : "Saved") : label;
          setTimeout(function () { btn.textContent = label; }, 2200);
        }).catch(function () {
          btn.disabled = false;
          btn.textContent = label;
        });
      });
    }
    wire("#m1-blog-pdf", window.downloadMode1BlogPdf, "Building PDF…");
    wire("#m1-blog-image-full", window.downloadMode1BlogFullImage, "Building image…");
    wire("#m1-blog-copy-byline", window.copyMode1BlogText, "Copying…");
  }

  function renderLeadBlog() {
    var el = $("#m1-blog-body");
    if (!el || typeof window.renderMode1BlogPost !== "function") return;
    el.innerHTML = window.renderMode1BlogPost({
      question: displayQuestion() || ($("#m1-question") || {}).value || "",
    }) || "";
    bindBlogExports();
  }

  function buildVerdict() {
    setStep(3);
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
    var lede = $("#m1-briefing-lede");
    if (lede) lede.textContent = model.paragraph || "";
    var conf = $("#m1-confidence-body");
    if (conf) {
      conf.innerHTML = bayesGraphHTML();
      var confSec = $("#confidence");
      if (confSec) confSec.hidden = false;
    }
    if (!el) return;
    el.innerHTML = renderArticleHtml(model);
    paintRelated();
    paintConceptMap();
  }

  var MAP_STOP = {
    doi: 1, pmid: 1, pmc: 1, http: 1, https: 1, www: 1, copyright: 1,
    license: 1, supplementary: 1, appendix: 1, university: 1, journal: 1,
    however: 1, therefore: 1, including: 1, based: 1, using: 1, used: 1,
    results: 1, methods: 1, method: 1, conclusion: 1, conclusions: 1,
    background: 1, objective: 1, objectives: 1, purpose: 1, authors: 1,
    author: 1, abstract: 1, introduction: 1, discussion: 1, analysis: 1,
    data: 1, model: 1, models: 1, paper: 1, papers: 1, article: 1,
    trial: 1, trials: 1, random: 1, randomized: 1, participants: 1,
    patients: 1, patient: 1, years: 1, year: 1, age: 1, high: 1, low: 1,
    risk: 1, total: 1, group: 1, groups: 1, level: 1, levels: 1,
    association: 1, associated: 1, interval: 1, confidence: 1,
    prospective: 1, cohort: 1, statistically: 1, significant: 1,
    significantly: 1, relative: 1, hazard: 1, odds: 1, ratio: 1,
    findings: 1, finding: 1, suggest: 1, suggests: 1, suggested: 1,
    showed: 1, shown: 1, lower: 1, higher: 1, increased: 1,
    decreased: 1, among: 1, related: 1, relationship: 1, factors: 1,
    factor: 1, include: 1, included: 1, furthermore: 1, moreover: 1,
    these: 1, those: 1, both: 1, other: 1, others: 1, also: 1,
    each: 1, same: 1, such: 1, well: 1, many: 1, several: 1,
    recommend: 1, recommended: 1, spline: 1, cubic: 1, restricted: 1,
    proportional: 1, hazards: 1, regression: 1, multivariate: 1,
    univariate: 1, adjusted: 1, adjustment: 1, estimate: 1,
    estimates: 1, respectively: 1, overall: 1, according: 1,
    consumption: 1, intake: 1, disease: 1, diseases: 1, diet: 1,
    dietary: 1, food: 1, foods: 1, number: 1, numbers: 1,
    associations: 1, processed: 1, united: 1, states: 1, females: 1,
    aged: 1, controlled: 1, reduces: 1, reduce: 1, affects: 1,
    affecting: 1, interventions: 1, conducted: 1, across: 1,
    species: 1, adults: 1, clinicaltrials: 1, annual: 1,
    percentage: 1, changes: 1, exceed: 1, exceeds: 1,
    beneficial: 1, potential: 1, median: 1, benefits: 1,
    "auto-regressive": 1, integrated: 1, moving: 1,
  };

  var MAP_TAIL_STOP = {
    recommend: 1, recommended: 1, reduces: 1, reduce: 1, exceed: 1,
    exceeds: 1, affects: 1, affecting: 1, conducted: 1, across: 1,
    including: 1, using: 1, based: 1, aged: 1, changes: 1,
    trials: 1, trial: 1,
  };

  function mapPaperBlobs() {
    var papers = (state.included && state.included.length)
      ? state.included
      : (state.papers || []);
    return papers.map(function (p) {
      return ((p.title || "") + " " + (p.abstract || "")).toLowerCase();
    }).filter(Boolean);
  }

  function mapTermHits(term, blobs) {
    var needles = synonyms(term).map(function (s) { return String(s).toLowerCase(); });
    var n = 0;
    blobs.forEach(function (b) {
      if (needles.some(function (s) { return s && b.indexOf(s) !== -1; })) n += 1;
    });
    return n;
  }

  function mapBlocked(concepts) {
    var blocked = {};
    (concepts || []).forEach(function (c) {
      synonyms(c).forEach(function (s) { blocked[String(s).toLowerCase()] = 1; });
      tokens(c).forEach(function (t) { blocked[t] = 1; });
    });
    Object.keys(MAP_STOP).forEach(function (k) { blocked[k] = 1; });
    Object.keys(STOP).forEach(function (k) { blocked[k] = 1; });
    return blocked;
  }

  function mapOrderedTokens(blob) {
    return tokens(blob).filter(function (t) {
      return t.length >= 4 && !STOP[t];
    });
  }

  function mapPhraseOk(phrase, blocked) {
    if (!phrase || (blocked && blocked[phrase]) || MAP_STOP[phrase]) return false;
    var parts = String(phrase).split(/\s+/);
    if (parts.length === 1) return phrase.length >= 6 && !MAP_STOP[phrase];
    if (parts.some(function (p) { return MAP_TAIL_STOP[p]; })) return false;
    return parts.some(function (p) { return !MAP_STOP[p]; });
  }

  function mapPhraseCounts(blobs, blocked) {
    var uni = {};
    var bi = {};
    var tri = {};
    blobs.forEach(function (b) {
      var toks = mapOrderedTokens(b);
      var seen = {};
      function add(obj, phrase) {
        if (!mapPhraseOk(phrase, blocked) || seen[phrase]) return;
        seen[phrase] = 1;
        obj[phrase] = (obj[phrase] || 0) + 1;
      }
      var i;
      toks.forEach(function (t) { add(uni, t); });
      for (i = 0; i < toks.length - 1; i++) {
        var bg = toks[i] + " " + toks[i + 1];
        if (b.indexOf(bg) !== -1) add(bi, bg);
      }
      for (i = 0; i < toks.length - 2; i++) {
        var tg = toks[i] + " " + toks[i + 1] + " " + toks[i + 2];
        if (b.indexOf(tg) !== -1) add(tri, tg);
      }
    });
    return { uni: uni, bi: bi, tri: tri };
  }

  function mapTopPhrases(blobs, blocked, limit) {
    var counts = mapPhraseCounts(blobs, blocked);
    function top(obj, minN, n) {
      return Object.keys(obj)
        .filter(function (k) { return obj[k] >= minN; })
        .sort(function (a, b) { return obj[b] - obj[a] || a.localeCompare(b); })
        .slice(0, n)
        .map(function (k) { return { term: k, hits: obj[k], kind: "literature" }; });
    }
    var minN = blobs.length >= 6 ? 2 : 1;
    var usedWord = {};
    var usedExact = {};
    var out = [];
    top(counts.tri, minN, 8).concat(top(counts.bi, minN, 10)).forEach(function (x) {
      if (usedExact[x.term]) return;
      usedExact[x.term] = 1;
      out.push(x);
      String(x.term).split(/\s+/).forEach(function (p) { usedWord[p] = 1; });
    });
    top(counts.uni, minN, 14).forEach(function (x) {
      if (usedExact[x.term] || usedWord[x.term]) return;
      usedExact[x.term] = 1;
      out.push(x);
    });
    out = out.filter(function (x) {
      return !out.some(function (y) {
        return y.term !== x.term && y.term.indexOf(x.term) !== -1;
      });
    });
    return out.slice(0, limit);
  }

  function mapConceptBranches(blobs, concepts) {
    var matchingN = {};
    var scored = [];
    (concepts || []).forEach(function (concept) {
      var blocked = mapBlocked([concept]);
      var matching = blobs.filter(function (b) {
        return synonyms(concept).some(function (s) {
          return s && b.indexOf(String(s).toLowerCase()) !== -1;
        });
      });
      matchingN[concept] = matching.length;
      mapTopPhrases(matching, blocked, 12).forEach(function (x) {
        scored.push({
          concept: concept,
          term: x.term,
          hits: x.hits,
          share: matching.length ? x.hits / matching.length : 0,
        });
      });
    });
    scored.sort(function (a, b) {
      return (b.share - a.share) || (b.hits - a.hits) || a.term.localeCompare(b.term);
    });
    var usedTerm = {};
    var byConcept = {};
    (concepts || []).forEach(function (c) {
      byConcept[c] = { concept: c, hits: matchingN[c] || 0, related: [] };
    });
    scored.forEach(function (row) {
      if (usedTerm[row.term]) return;
      var bucket = byConcept[row.concept];
      if (!bucket || bucket.related.length >= 4) return;
      usedTerm[row.term] = 1;
      bucket.related.push({
        term: row.term,
        hits: row.hits,
        kind: "literature",
        parent: row.concept,
      });
    });
    return (concepts || []).map(function (c) { return byConcept[c]; });
  }

  function mapWrap(text, maxChars, maxLines) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (test.length <= maxChars) line = test;
      else {
        if (line) lines.push(line);
        line = w;
      }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var last = lines[maxLines - 1];
      lines[maxLines - 1] = last.replace(/[.,;:]*$/, "") + "…";
    }
    return lines;
  }

  function mapNodeRadius(hits, maxHits, kind) {
    var t = maxHits > 0 ? hits / maxHits : 0;
    if (kind === "literature") return 9 + t * 11;
    return 15 + t * 14;
  }

  function mapLabelAnchor(angle) {
    var c = Math.cos(angle);
    if (c > 0.42) return "start";
    if (c < -0.42) return "end";
    return "middle";
  }

  function mapTextSVG(x, y, lines, opts) {
    opts = opts || {};
    var size = opts.size || 11;
    var weight = opts.weight || 600;
    var fill = opts.fill || "#1a2332";
    var anchor = opts.anchor || "middle";
    var lh = opts.lh || 13;
    var startY = y;
    if (anchor === "middle" && Math.sin(opts.angle || 0) < -0.35) {
      startY = y - (lines.length - 1) * lh;
    }
    var tspans = lines.map(function (ln, i) {
      return '<tspan x="' + x.toFixed(1) + '" dy="' + (i ? lh : 0) + '">' +
        escapeHtml(ln) + "</tspan>";
    }).join("");
    return (
      '<text x="' + x.toFixed(1) + '" y="' + startY.toFixed(1) +
      '" text-anchor="' + anchor + '" fill="' + fill +
      '" font-family="Source Sans 3, Helvetica Neue, Arial, sans-serif" font-size="' +
      size + '" font-weight="' + weight + '">' +
      tspans + "</text>"
    );
  }

  function conceptMapHTML() {
    var concepts = (state.concepts || []).slice(0, 8);
    var blobs = mapPaperBlobs();
    var branches = mapConceptBranches(blobs, concepts);
    var qNodes = branches.map(function (br) {
      return {
        term: br.concept,
        hits: br.hits || mapTermHits(br.concept, blobs),
        kind: "question",
        related: br.related || [],
      };
    });
    var maxHits = 1;
    qNodes.forEach(function (n) {
      if (n.hits > maxHits) maxHits = n.hits;
      n.related.forEach(function (r) {
        if (r.hits > maxHits) maxHits = r.hits;
      });
    });
    var W = 1280;
    var H = 920;
    var cx = W / 2;
    var cy = H / 2;
    var innerR = 215;
    var outerR = 355;
    var q = displayQuestion() || state.activeQuestion || "The research question";
    var qLines = mapWrap(q, 30, 5);
    var nQ = qNodes.length || 1;
    var placedQ = qNodes.map(function (item, i) {
      var a = (2 * Math.PI * i) / nQ - Math.PI / 2;
      return {
        item: item,
        angle: a,
        x: cx + innerR * Math.cos(a),
        y: cy + innerR * Math.sin(a),
      };
    });
    var placedR = [];
    placedQ.forEach(function (parent) {
      var rel = parent.item.related || [];
      var m = rel.length;
      if (!m) return;
      var spread = m === 1 ? 0 : Math.min(0.52, 0.22 + m * 0.05);
      rel.forEach(function (item, k) {
        var a = parent.angle + (k - (m - 1) / 2) * spread;
        placedR.push({
          item: item,
          parent: parent,
          angle: a,
          x: cx + outerR * Math.cos(a),
          y: cy + outerR * Math.sin(a),
        });
      });
    });
    function nodeSVG(placed, fill, stroke, fromX, fromY) {
      var item = placed.item;
      var r = mapNodeRadius(item.hits, maxHits, item.kind);
      var lines = mapWrap(item.term, item.kind === "question" ? 14 : 16, 3);
      var title = item.term + " · " + item.hits + " record" + (item.hits === 1 ? "" : "s") +
        (item.kind === "question"
          ? " (from the question)"
          : " (related to “" + (item.parent || "") + "”)");
      var pad = r + 12;
      var lx = placed.x + Math.cos(placed.angle) * pad;
      var ly = placed.y + Math.sin(placed.angle) * pad;
      var label = mapTextSVG(lx, ly, lines, {
        size: item.kind === "question" ? 12 : 11,
        weight: item.kind === "question" ? 700 : 600,
        anchor: mapLabelAnchor(placed.angle),
        angle: placed.angle,
        lh: item.kind === "question" ? 14 : 13,
      });
      return (
        '<g class="m1-cmap-node is-' + item.kind + '">' +
        '<line x1="' + fromX.toFixed(1) + '" y1="' + fromY.toFixed(1) +
        '" x2="' + placed.x.toFixed(1) + '" y2="' + placed.y.toFixed(1) +
        '" stroke="' + stroke + '" stroke-opacity="0.4" stroke-width="' +
        (item.kind === "question" ? "1.6" : "1.15") + '"></line>' +
        '<circle cx="' + placed.x.toFixed(1) + '" cy="' + placed.y.toFixed(1) +
        '" r="' + r + '" fill="' + fill + '" stroke="' + stroke +
        '" stroke-width="1.5"><title>' + escapeHtml(title) + "</title></circle>" +
        label + "</g>"
      );
    }
    var qFill = "#f3ead2";
    var qStroke = "#c4a35a";
    var lFill = "#e6f0ea";
    var lStroke = "#2f6f4e";
    var hubH = 42 + qLines.length * 16;
    var hubY = cy - hubH / 2;
    var hubText = qLines.map(function (ln, i) {
      return '<tspan x="' + cx + '" dy="' + (i ? 16 : 0) + '">' + escapeHtml(ln) + "</tspan>";
    }).join("");
    if (!qNodes.length) {
      return '<p class="m1-empty">No concepts extracted from this question yet.</p>';
    }
    var glossary = placedQ.map(function (p) {
      var rel = p.item.related || [];
      var chips = rel.length
        ? rel.map(function (r) {
            return '<span class="m1-cmap-chip" title="' + escapeHtml(r.term) +
              " · " + r.hits + ' records">' + escapeHtml(r.term) + "</span>";
          }).join("")
        : '<span class="m1-cmap-chip is-empty">thin in this scan</span>';
      return (
        '<div class="m1-cmap-row">' +
        '<span class="m1-cmap-qterm">' + escapeHtml(p.item.term) + "</span>" +
        '<span class="m1-cmap-arrow" aria-hidden="true">→</span>' +
        '<span class="m1-cmap-chips">' + chips + "</span></div>"
      );
    }).join("");
    return (
      '<div class="m1-cmap">' +
      '<p class="m1-cmap-legend">' +
      '<span class="m1-cmap-key is-question">In the question</span>' +
      '<span class="m1-cmap-key is-literature">Related terms in the papers</span>' +
      '<span class="m1-cmap-count">' + blobs.length + " record" +
      (blobs.length === 1 ? "" : "s") + " counted</span></p>" +
      '<svg class="m1-cmap-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
      W + " " + H +
      '" role="img" aria-label="Concept map: each question term with related phrases from the scan.">' +
      placedR.map(function (p) {
        return nodeSVG(p, lFill, lStroke, p.parent.x, p.parent.y);
      }).join("") +
      placedQ.map(function (p) { return nodeSVG(p, qFill, qStroke, cx, cy); }).join("") +
      '<rect x="' + (cx - 148) + '" y="' + hubY + '" width="296" height="' + hubH +
      '" rx="12" fill="#fff" stroke="#1a2332" stroke-width="2"></rect>' +
      '<text x="' + cx + '" y="' + (hubY + 18) +
      '" text-anchor="middle" fill="#3d4a5c" font-size="10" font-weight="700" letter-spacing="0.08em">THE QUESTION</text>' +
      '<text x="' + cx + '" y="' + (hubY + 36) +
      '" text-anchor="middle" fill="#1a2332" font-size="13" font-weight="650" font-family="Fraunces, Georgia, serif">' +
      hubText + "</text></svg>" +
      '<div class="m1-cmap-glossary" aria-label="Question terms and related vocabulary">' +
      glossary + "</div></div>"
    );
  }

  function conceptMapPendingHTML() {
    return (
      '<div class="m1-cmap m1-cmap-pending" role="status" aria-live="polite">' +
      '<div class="m1-cmap-spinner" aria-hidden="true"></div>' +
      '<p class="m1-cmap-pending-label">Mapping this question against the scan…</p>' +
      '<p class="m1-cmap-pending-hint">The map fills in after titles and abstracts are in.</p></div>'
    );
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
    if (typeof fetch === "function") {
      fetch("/api/save-file", {
        method: "POST",
        headers: { "Content-Type": blob.type || "application/octet-stream", "X-Filename": filename },
        body: blob,
      }).catch(function () {});
    }
  }

  function setMapDownloadReady(ready) {
    var btn = $("#m1-cmap-download");
    if (!btn) return;
    btn.disabled = !ready;
  }

  function downloadConceptMap() {
    var svg = document.querySelector("#m1-concept-body .m1-cmap-svg");
    if (!svg) return;
    var box = svg.viewBox && svg.viewBox.baseVal;
    var w = (box && box.width) || svg.clientWidth || 1280;
    var h = (box && box.height) || svg.clientHeight || 920;
    var clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(w));
    clone.setAttribute("height", String(h));
    var style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = 'text,tspan{font-family:"Source Sans 3","Helvetica Neue",Arial,sans-serif}';
    clone.insertBefore(style, clone.firstChild);
    var xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      new XMLSerializer().serializeToString(clone);
    var svgBlob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
    var url = URL.createObjectURL(svgBlob);
    var img = new Image();
    img.onload = function () {
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(w * 2);
      canvas.height = Math.round(h * 2);
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function (blob) {
        if (!blob) {
          triggerBlobDownload(svgBlob, "question-map.svg");
          return;
        }
        triggerBlobDownload(blob, "question-map.png");
      }, "image/png");
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      triggerBlobDownload(svgBlob, "question-map.svg");
    };
    img.src = url;
  }

  function bindMapDownload() {
    var btn = $("#m1-cmap-download");
    if (!btn || btn.getAttribute("data-bound")) return;
    btn.setAttribute("data-bound", "1");
    btn.addEventListener("click", downloadConceptMap);
  }

  function paintConceptMap() {
    var host = $("#m1-concept-body");
    if (!host) return;
    var sec = $("#concept-map");
    if (sec) sec.hidden = false;
    var blobs = mapPaperBlobs();
    if (!blobs.length) {
      setMapDownloadReady(false);
      host.innerHTML = state.pipelineStage === "done"
        ? '<div class="m1-cmap m1-cmap-pending"><p class="m1-cmap-pending-label">No titles or abstracts to map yet.</p></div>'
        : conceptMapPendingHTML();
      return;
    }
    host.innerHTML = conceptMapHTML();
    setMapDownloadReady(!!host.querySelector(".m1-cmap-svg"));
  }

  function paintRelated() {
    var relatedHost = $("#m1-related-body");
    if (relatedHost) {
      relatedHost.innerHTML = relatedPapersHTML();
      bindCollapsedMore(relatedHost);
      var relatedSec = $("#related");
      if (relatedSec) relatedSec.hidden = false;
    }
  }

  function bindCollapseToggles() {
    $all(".m1-collapse-btn").forEach(function (btn) {
      if (btn.getAttribute("data-bound")) return;
      btn.setAttribute("data-bound", "1");
      btn.addEventListener("click", function () {
        var key = btn.getAttribute("data-collapse");
        var panel = $('[data-collapse-panel="' + key + '"]');
        if (!panel) return;
        var hidden = panel.hasAttribute("hidden");
        if (hidden) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
        btn.textContent = hidden ? "Hide" : "Show";
      });
    });
  }

  function logGamma(z) {
    var p = [
      0.99999999999980993, 676.5203681218851, -1259.1392167224028,
      771.32342877765313, -176.61502916214059, 12.507343278686905,
      -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (z < 0.5) {
      return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
    }
    z -= 1;
    var x = p[0];
    var i;
    for (i = 1; i < 9; i++) x += p[i] / (z + i);
    var t = z + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  function betaPdf(x, a, b) {
    if (x <= 0 || x >= 1) return 0;
    return Math.exp(
      logGamma(a + b) - logGamma(a) - logGamma(b) +
      (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x)
    );
  }

  function betaCdf(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var n = 240;
    var i;
    var s = 0;
    var step = x / n;
    for (i = 1; i <= n; i++) {
      s += betaPdf((i - 0.5) * step, a, b);
    }
    return Math.min(1, s * step);
  }

  function betaQuantile(p, a, b) {
    var lo = 0;
    var hi = 1;
    var k;
    var mid;
    for (k = 0; k < 48; k++) {
      mid = (lo + hi) / 2;
      if (betaCdf(mid, a, b) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function bayesModel() {
    var supporting = state.synthesis.supporting || [];
    var contradicting = state.synthesis.contradicting || [];
    var sw = supporting.reduce(function (n, x) { return n + synthWeight(x.row); }, 0);
    var cw = contradicting.reduce(function (n, x) { return n + synthWeight(x.row); }, 0);
    var a = 1 + sw;
    var b = 1 + cw;
    var mean = a / (a + b);
    return {
      a: a,
      b: b,
      sw: sw,
      cw: cw,
      mean: mean,
      lo: betaQuantile(0.025, a, b),
      hi: betaQuantile(0.975, a, b),
    };
  }

  function bayesZoomWindow(m) {
    var i;
    var peak = 0;
    var ys = [];
    for (i = 1; i < 200; i++) {
      var x = i / 200;
      var y = betaPdf(x, m.a, m.b);
      ys.push({ x: x, y: y });
      if (y > peak) peak = y;
    }
    if (peak <= 0) peak = 1;
    var thresh = peak * 0.05;
    var lo = 0;
    var hi = 1;
    for (i = 0; i < ys.length; i++) {
      if (ys[i].y >= thresh) { lo = ys[i].x; break; }
    }
    for (i = ys.length - 1; i >= 0; i--) {
      if (ys[i].y >= thresh) { hi = ys[i].x; break; }
    }
    lo = Math.min(lo, m.lo);
    hi = Math.max(hi, m.hi);
    var pad = Math.max(0.03, (hi - lo) * 0.22);
    lo = Math.max(0, lo - pad);
    hi = Math.min(1, hi + pad);
    if (hi - lo < 0.28) {
      var mid = (lo + hi) / 2;
      lo = Math.max(0, mid - 0.14);
      hi = Math.min(1, mid + 0.14);
      if (hi - lo < 0.28) {
        if (lo <= 0) hi = Math.min(1, 0.28);
        if (hi >= 1) lo = Math.max(0, 0.72);
      }
    }
    return { lo: lo, hi: hi, peak: peak };
  }

  function bayesTicks(x0, x1) {
    var span = x1 - x0;
    var step = span > 0.8 ? 0.25 : span > 0.45 ? 0.1 : 0.05;
    var start = Math.ceil(x0 / step) * step;
    var ticks = [];
    var t;
    for (t = start; t <= x1 + 1e-9; t += step) {
      ticks.push(Math.round(t * 100) / 100);
    }
    if (ticks[0] === undefined || Math.abs(ticks[0] - x0) > step * 0.4) {
      ticks.unshift(x0);
    }
    if (Math.abs(ticks[ticks.length - 1] - x1) > step * 0.4) {
      ticks.push(x1);
    }
    return ticks;
  }

  function bayesGraphHTML() {
    var m = bayesModel();
    var zoom = bayesZoomWindow(m);
    var x0 = zoom.lo;
    var x1 = zoom.hi;
    var span = Math.max(0.08, x1 - x0);
    var W = 900;
    var H = 420;
    var padL = 44;
    var padR = 20;
    var padT = 18;
    var padB = 56;
    var plotW = W - padL - padR;
    var plotH = H - padT - padB;
    var xs = [];
    var i;
    var n = 180;
    var visPeak = 0;
    for (i = 0; i <= n; i++) {
      var x = x0 + (i / n) * span;
      x = Math.min(0.999, Math.max(0.001, x));
      var y = betaPdf(x, m.a, m.b);
      xs.push({ x: x, y: y });
      if (y > visPeak) visPeak = y;
    }
    if (visPeak <= 0) visPeak = zoom.peak || 1;
    function X(p) { return padL + ((p - x0) / span) * plotW; }
    function Y(v) { return padT + plotH - (v / visPeak) * plotH * 0.92; }
    var line = xs.map(function (pt, idx) {
      return (idx ? "L" : "M") + X(pt.x).toFixed(1) + " " + Y(pt.y).toFixed(1);
    }).join(" ");
    var band = xs.filter(function (pt) { return pt.x >= m.lo && pt.x <= m.hi; });
    var area = "";
    if (band.length) {
      area = "M" + X(band[0].x).toFixed(1) + " " + Y(0).toFixed(1) + " " +
        band.map(function (pt) {
          return "L" + X(pt.x).toFixed(1) + " " + Y(pt.y).toFixed(1);
        }).join(" ") +
        " L" + X(band[band.length - 1].x).toFixed(1) + " " + Y(0).toFixed(1) + " Z";
    }
    var ticks = bayesTicks(x0, x1).map(function (t) {
      return (
        '<line x1="' + X(t).toFixed(1) + '" y1="' + (padT + plotH) +
        '" x2="' + X(t).toFixed(1) + '" y2="' + (padT + plotH + 6) +
        '" stroke="#3d4a5c" />' +
        '<text x="' + X(t).toFixed(1) + '" y="' + (padT + plotH + 22) +
        '" text-anchor="middle" fill="#3d4a5c" font-size="14">' +
        Math.round(t * 100) + "%</text>"
      );
    }).join("");
    var meanPct = Math.round(m.mean * 100);
    var loPct = Math.round(m.lo * 100);
    var hiPct = Math.round(m.hi * 100);
    var showHalf = 0.5 >= x0 && 0.5 <= x1;
    var barX = function (p) { return padL + ((p - x0) / span) * plotW; };
    var diamond = barX(m.mean);
    var barY = 32;
    return (
      '<section class="m1-bayes" aria-label="Bayesian posterior for scan direction">' +
      "<h3>Posterior confidence</h3>" +
      '<p class="m1-footnote">A Beta posterior of the chance this scan’s quality-weighted abstracts lean supporting, with a uniform prior — the density-plus-credible-interval figure researchers put on slides. It is <strong>not</strong> a pooled effect size or a clinical posterior.</p>' +
      '<svg class="m1-bayes-svg" viewBox="0 0 ' + W + " " + H +
      '" role="img" aria-label="Posterior density. Mean ' + meanPct +
      " percent, 95 percent credible interval " + loPct + " to " + hiPct + ' percent.">' +
      '<rect x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + plotH +
      '" fill="#fff" stroke="#ddd8ce"></rect>' +
      (area ? '<path d="' + area + '" fill="#c4a35a" fill-opacity="0.32"></path>' : "") +
      '<path d="' + line + '" fill="none" stroke="#2f6f4e" stroke-width="3.2"></path>' +
      '<line x1="' + X(m.mean).toFixed(1) + '" y1="' + padT + '" x2="' +
      X(m.mean).toFixed(1) + '" y2="' + (padT + plotH) +
      '" stroke="#2f6f4e" stroke-width="2"></line>' +
      (showHalf
        ? '<line x1="' + X(0.5).toFixed(1) + '" y1="' + padT + '" x2="' +
          X(0.5).toFixed(1) + '" y2="' + (padT + plotH) +
          '" stroke="#3d4a5c" stroke-dasharray="5 5" stroke-opacity="0.45"></line>'
        : "") +
      ticks +
      '<text x="' + (padL + plotW / 2) + '" y="' + (H - 8) +
      '" text-anchor="middle" fill="#3d4a5c" font-size="14">P(scan leans supporting)</text>' +
      "</svg>" +
      '<svg class="m1-bayes-interval" viewBox="0 0 ' + W + ' 64" role="img" aria-label="95 percent credible interval">' +
      '<line x1="' + padL + '" y1="' + barY + '" x2="' + (padL + plotW) +
      '" y2="' + barY + '" stroke="#ddd8ce" stroke-width="8" stroke-linecap="round"></line>' +
      '<line x1="' + barX(m.lo).toFixed(1) + '" y1="' + barY + '" x2="' + barX(m.hi).toFixed(1) +
      '" y2="' + barY + '" stroke="#2f6f4e" stroke-width="8" stroke-linecap="round"></line>' +
      '<polygon points="' + diamond.toFixed(1) + ',' + (barY - 14) + " " +
      (diamond + 11).toFixed(1) + "," + barY + " " + diamond.toFixed(1) + "," +
      (barY + 14) + " " + (diamond - 11).toFixed(1) + "," + barY +
      '" fill="#1a2332"></polygon>' +
      '<text x="' + padL + '" y="58" fill="#3d4a5c" font-size="13">' +
      Math.round(x0 * 100) + "%</text>" +
      '<text x="' + (padL + plotW) + '" y="58" text-anchor="end" fill="#3d4a5c" font-size="13">' +
      Math.round(x1 * 100) + "%</text>" +
      '<text x="' + diamond.toFixed(1) + '" y="14" text-anchor="middle" fill="#1a2332" font-size="14">' +
      meanPct + "% · 95% CrI " + loPct + "–" + hiPct + "%</text>" +
      "</svg>" +
      '<p class="m1-bayes-stats">Prior Beta(1,1). Posterior Beta(' +
      (Math.round(m.a * 10) / 10) + ", " + (Math.round(m.b * 10) / 10) +
      "). Quality-weighted votes: supporting " + m.sw + ", contradicting " + m.cw +
      ". Axis is zoomed to the posterior mass. Dashed line is 50% (equipoise) when it falls in view. Shaded band is the 95% credible interval.</p>" +
      "</section>"
    );
  }

  function renderUnderstandingStatic() {
    var el = $("#m1-understand-body");
    if (!el) return;
    el.innerHTML =
      '<p class="m1-restate-kicker">Here’s what I understand you’re asking</p>' +
      '<p class="m1-restate">' + escapeHtml(state.restatement) + "</p>" +
      '<p class="m1-lead">Saved example — this page does not search live databases.</p>';
  }

  function applyStaticSnapshot(seed) {
    var q = (($("#m1-question") || {}).value || seed.topic || "").trim();
    var sit = (($("#m1-situation") || {}).value || seed.discipline || "").trim();
    state.question = q;
    state.situation = sit;
    var understood = buildRestatement(q, state.situation, "");
    state.restatement = understood.text;
    state.meaning = understood.meaning;
    state.concepts = understood.concepts;
    state.central = understood.central;
    state.query = "Saved harvest (static example)";
    state.activeQuestion = understood.meaning || q;
    state.searching = false;
    var papers = (seed.papers || []).map(function (p) {
      var copy = {};
      Object.keys(p || {}).forEach(function (k) { copy[k] = p[k]; });
      copy.tier = copy.tier || "related";
      copy.relevance = copy.tier;
      copy.sourceApis = copy.sourceApis || ["harvest"];
      copy.pubTypes = copy.pubTypes || [];
      return copy;
    });
    state.papers = papers;
    state.included = papers.filter(function (p) { return p.tier === "core"; });
    if (!state.included.length) state.included = papers.slice();
    state.excluded = papers.filter(function (p) { return p.tier !== "core"; });
    state.relatedPopular = [];
    var ask = $("#m1-new-q");
    if (ask) ask.hidden = true;
    showSearchLive(false);
    setStep(1);
    setStatus("");
    renderUnderstandingStatic();
    paintConceptMap();
    setStep(2);
    finishResults();
  }

  function bootFromSeed() {
    var seed = readDossierSeed();
    var q = $("#m1-question");
    var sit = $("#m1-situation");
    if (q && seed.topic && !String(q.value || "").trim()) q.value = seed.topic;
    if (sit && seed.discipline && !String(sit.value || "").trim()) sit.value = seed.discipline;
    renderLeadBlog();
    if (seed.static) {
      applyStaticSnapshot(seed);
      return;
    }
    if (q && String(q.value || "").trim()) {
      beginUnderstanding({ scroll: false });
    }
  }

  function boot() {
    if (!$("#m1-root")) return;
    bindCollapseToggles();
    bindMapDownload();
    bindCollapsedMore(document);
    renderStepper();
    bindStickyStepper();
    setStep(1);
    bootFromSeed();
  }

  function emptyDossierSeed() {
    return {
      topic: "",
      originalTopic: "",
      discipline: "",
      supportBlurb: "",
      contraBlurb: "",
      static: false,
      papers: [],
    };
  }

  function readDossierSeed() {
    var node = $("#dossier-data");
    if (!node) return emptyDossierSeed();
    try {
      var data = JSON.parse(node.textContent || "{}");
      return {
        topic: String(data.topic || "").trim(),
        originalTopic: String(data.original_topic || "").trim(),
        discipline: String(data.discipline || "").trim(),
        supportBlurb: String(data.support_blurb || "").trim(),
        contraBlurb: String(data.contra_blurb || "").trim(),
        static: !!data.static,
        papers: Array.isArray(data.papers) ? data.papers : [],
      };
    } catch (e) {
      return emptyDossierSeed();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
