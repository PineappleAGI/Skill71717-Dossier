/* Skill71717 — dossier mode switcher, debate rooms, belief timeline.
   Embedded into generated HTML. Consumes #dossier-data JSON. */
(function () {
  "use strict";

  var STRENGTH = { strong: 3, moderate: 2, weak: 1 };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  function paperWeight(p) {
    var s = STRENGTH[p.evidence_strength] || 1;
    var c = typeof p.confidence === "number" ? p.confidence / 100 : 0.5;
    return s * c;
  }
  function temperature(forW, againstW) {
    var t = forW + againstW;
    if (t <= 0) return 0;
    return 1 - Math.abs(forW - againstW) / t;
  }

  function setMode(mode) {
    document.body.setAttribute("data-mode", mode);
    $all(".mode-tab").forEach(function (btn) {
      var on = btn.getAttribute("data-mode") === mode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $all(".mode-panel").forEach(function (panel) {
      panel.hidden = panel.getAttribute("data-mode") !== mode;
    });
    try {
      history.replaceState(null, "", "#" + mode);
    } catch (e) {}
    if (mode === "belief") {
      window.dispatchEvent(new Event("dossier:belief-show"));
    }
  }
  window.dossierSetMode = setMode;

  function bindSwitcher() {
    $all(".mode-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-mode"));
      });
    });
    var hash = (location.hash || "").replace("#", "");
    if (hash === "debate" || hash === "belief" || hash === "synthesis") {
      setMode(hash);
    } else {
      setMode("synthesis");
    }
  }

  /* ——— Debate Arena ——— */
  function roomWeights(room, byId) {
    var forW = 0;
    var againstW = 0;
    (room.for_ids || []).forEach(function (id) {
      if (byId[id]) forW += paperWeight(byId[id]);
    });
    (room.against_ids || []).forEach(function (id) {
      if (byId[id]) againstW += paperWeight(byId[id]);
    });
    return { forW: forW, againstW: againstW };
  }

  function flipCard(el) {
    el.classList.toggle("is-flipped");
  }

  function shortCite(p) {
    var authors = p.authors || [];
    var first = authors[0] ? authors[0].split(" ").pop() : "Authors unavailable";
    var etal = authors.length > 1 ? " et al." : "";
    var year = p.year || "";
    return first + etal + (year ? ", " + year : "");
  }

  function paperHref(p) {
    if (p.url) return p.url;
    if (p.doi) return "https://doi.org/" + p.doi;
    return "";
  }

  function cardHTML(p, side) {
    var authors = (p.authors || []).join(", ") || "Authors unavailable";
    var year = p.year || "";
    var venue = p.venue || "";
    var source = p.source || "harvest";
    var strength = p.evidence_strength || "moderate";
    var href = paperHref(p);
    var cite = escapeHtml(shortCite(p));
    var citeHtml = href
      ? '<a class="arena-cite" href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">' +
        cite +
        "</a>"
      : '<span class="arena-cite">' + cite + "</span>";
    var titleHtml = href
      ? '<a href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">' +
        escapeHtml(p.title || "Untitled") +
        "</a>"
      : "<strong>" + escapeHtml(p.title || "Untitled") + "</strong>";
    var openHtml = href
      ? '<a class="arena-open" href="' +
        escapeHtml(href) +
        '" target="_blank" rel="noopener noreferrer">Open paper →</a>'
      : "";
    return (
      '<div class="arena-card side-' +
      side +
      " source-" +
      source +
      '" data-id="' +
      escapeHtml(p.id) +
      '" role="button" tabindex="0" aria-label="Flip card">' +
      '<span class="arena-card-inner">' +
      '<span class="arena-face arena-front">' +
      '<span class="arena-claim">' +
      escapeHtml(p.one_line_claim || p.title || "") +
      "</span>" +
      '<span class="arena-card-foot">' +
      '<span class="badge strength-' +
      escapeHtml(strength) +
      '">' +
      escapeHtml(strength) +
      "</span>" +
      citeHtml +
      "</span>" +
      openHtml +
      "</span>" +
      '<span class="arena-face arena-back">' +
      '<span class="arena-kicker">Source</span>' +
      titleHtml +
      "<span>" +
      escapeHtml(authors) +
      (year ? " · " + escapeHtml(String(year)) : "") +
      "</span>" +
      (venue ? "<span>" + escapeHtml(venue) + "</span>" : "") +
      openHtml +
      "</span>" +
      "</span></div>"
    );
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function isComingSoon(room) {
    if ((room.status || "") === "coming_soon") return true;
    var empty = !(room.for_ids || []).length && !(room.against_ids || []).length;
    return room.source === "seed" && empty;
  }

  function renderRoom(data, room) {
    var byId = {};
    (data.papers || []).forEach(function (p) {
      byId[p.id] = p;
    });
    var w = roomWeights(room, byId);
    var forCards = (room.for_ids || [])
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean);
    var againstCards = (room.against_ids || [])
      .map(function (id) {
        return byId[id];
      })
      .filter(Boolean);
    var coming = isComingSoon(room);
    var soonBanner = coming
      ? '<p class="arena-soon">Evidence cards for this starter topic are not harvested yet. The for/against flip mechanic is live in rooms marked Ready — ultra-processed food, solar geoengineering, and nuclear energy.</p>'
      : "";
    var forBody = forCards.length
      ? forCards
          .map(function (p) {
            return cardHTML(p, "for");
          })
          .join("")
      : '<p class="arena-empty">No supporting cards in this room yet.</p>';
    var againstBody = againstCards.length
      ? againstCards
          .map(function (p) {
            return cardHTML(p, "against");
          })
          .join("")
      : '<p class="arena-empty">No contradicting cards in this room yet.</p>';
    var tot = w.forW + w.againstW;
    var forPct = tot > 0 ? Math.round((w.forW / tot) * 100) : 50;
    var againstPct = 100 - forPct;
    var view = $("#debate-room");
    view.innerHTML =
      '<div class="arena-room-head">' +
      '<button type="button" class="arena-back" id="arena-back">← Back to rooms</button>' +
      "<div><p class=\"arena-eyebrow\">" +
      escapeHtml(room.category || "Debate room") +
      "</p><h2>" +
      escapeHtml(room.question || room.title) +
      "</h2><p class=\"arena-q\">" +
      escapeHtml(room.blurb || "") +
      "</p></div>" +
      "</div>" +
      soonBanner +
      '<div class="arena-bar-wrap">' +
      '<div class="arena-bar" role="img" aria-label="For ' +
      forPct +
      " percent, against " +
      againstPct +
      ' percent">' +
      '<span class="arena-bar-for" style="width:' +
      forPct +
      '%"></span>' +
      '<span class="arena-bar-against" style="width:' +
      againstPct +
      '%"></span>' +
      "</div>" +
      '<p class="arena-bar-legend"><span class="for">For — weighted ' +
      forPct +
      '%</span><span class="against">Against — weighted ' +
      againstPct +
      "%</span></p>" +
      "</div>" +
      '<div class="arena-cols">' +
      '<section><h3 class="for">Evidence for <span>' +
      forCards.length +
      '</span></h3><div class="arena-stack">' +
      forBody +
      '<p class="arena-user-slot">User-submitted cards can land here later <code>source: user</code>.</p>' +
      "</div></section>" +
      '<section><h3 class="against">Evidence against <span>' +
      againstCards.length +
      '</span></h3><div class="arena-stack">' +
      againstBody +
      '<p class="arena-user-slot">User-submitted cards can land here later <code>source: user</code>.</p>' +
      "</div></section>" +
      "</div>";
    $("#arena-back").addEventListener("click", function () {
      $("#debate-lobby").hidden = false;
      view.hidden = true;
      view.innerHTML = "";
    });
    $all(".arena-card", view).forEach(function (el) {
      el.addEventListener("click", function (ev) {
        if (ev.target.closest("a")) return;
        flipCard(el);
      });
      el.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        if (ev.target.closest("a")) return;
        ev.preventDefault();
        flipCard(el);
      });
    });
    $("#debate-lobby").hidden = true;
    view.hidden = false;
  }

  function bindDebate(data) {
    $all("[data-enter-room]").forEach(function (tile) {
      tile.addEventListener("click", function () {
        var id = tile.getAttribute("data-enter-room");
        var room = (data.rooms || []).filter(function (r) {
          return r.id === id;
        })[0];
        if (room) renderRoom(data, room);
      });
    });
  }

  /* ——— Belief timeline ——— */
  function signedDelta(p) {
    var w = paperWeight(p);
    if (p.stance === "supports") return w;
    if (p.stance === "contradicts") return -w;
    return 0;
  }

  function logistic(x) {
    return 1 / (1 + Math.exp(-x));
  }

  function beliefAfter(papers, prior, throughIndex) {
    var logodds = Math.log(prior / (1 - prior));
    papers.forEach(function (p, i) {
      if (i > throughIndex) return;
      logodds += signedDelta(p) * 0.35;
    });
    return logistic(logodds);
  }

  function bindBelief(data) {
    var canvas = $("#belief-canvas");
    var readout = $("#belief-readout");
    var claimBox = $("#belief-claim");
    var replay = $("#belief-replay");
    if (!canvas || !canvas.getContext) return;

    var papers = (data.papers || [])
      .filter(function (p) {
        if (p.scope === "seed" || p.source === "seed") return false;
        return p.stance === "supports" || p.stance === "contradicts";
      })
      .slice()
      .sort(function (a, b) {
        return (a.year || 0) - (b.year || 0);
      });
    var prior = typeof data.prior === "number" ? data.prior : 0.5;
    var hover = -1;
    var selected = -1;
    var playUntil = papers.length - 1;
    var anim = null;

    function hitIndex(ev) {
      var rect = canvas.getBoundingClientRect();
      var x = ev.clientX - rect.left;
      var y = ev.clientY - rect.top;
      var hit = -1;
      ptsCache.forEach(function (pt) {
        if (pt.i > playUntil) return;
        var dx = pt.x - x;
        var dy = pt.y - y;
        if (dx * dx + dy * dy < 140) hit = pt.i;
      });
      return hit;
    }

    function showClaim(i) {
      if (!claimBox) return;
      if (i < 0 || !papers[i]) {
        claimBox.innerHTML =
          "<p>Hover or click a node to see how that paper moved the meter.</p>";
        return;
      }
      var p = papers[i];
      var dir = signedDelta(p) > 0 ? "nudged belief up" : "nudged belief down";
      var href = p.url || (p.doi ? "https://doi.org/" + p.doi : "");
      var title = escapeHtml(p.title || "Untitled");
      var titleHtml = href
        ? '<a href="' +
          escapeHtml(href) +
          '" target="_blank" rel="noopener noreferrer">' +
          title +
          "</a>"
        : title;
      var authors = (p.authors || []).join(", ");
      var meta = [];
      if (authors) meta.push(escapeHtml(authors));
      if (p.year) meta.push(escapeHtml(String(p.year)));
      if (p.venue) meta.push(escapeHtml(p.venue));
      var openHtml = href
        ? '<p class="belief-open"><a href="' +
          escapeHtml(href) +
          '" target="_blank" rel="noopener noreferrer">Open paper →</a></p>'
        : "";
      claimBox.innerHTML =
        "<strong>" +
        titleHtml +
        "</strong>" +
        (meta.length ? '<p class="belief-meta">' + meta.join(" · ") + "</p>" : "") +
        "<p>" +
        escapeHtml(p.one_line_claim || "") +
        "</p>" +
        openHtml +
        '<p class="belief-why">' +
        dir +
        " · " +
        escapeHtml(p.evidence_strength || "") +
        " evidence · confidence " +
        escapeHtml(String(p.confidence || "—")) +
        "</p>";
    }

    function draw(until) {
      var ctx = canvas.getContext("2d");
      var dpr = window.devicePixelRatio || 1;
      var cssW = canvas.clientWidth || 720;
      var cssH = 280;
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      var pad = { l: 36, r: 24, t: 28, b: 48 };
      var w = cssW - pad.l - pad.r;
      var h = cssH - pad.t - pad.b;
      var n = Math.max(papers.length - 1, 1);

      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue("--ink-soft") || "#3d4a5c";
      ctx.font = "12px 'Source Sans 3', sans-serif";
      ctx.fillText("media-only", pad.l, 16);
      ctx.textAlign = "right";
      ctx.fillText("simulator", cssW - pad.r, 16);
      ctx.textAlign = "left";

      ctx.strokeStyle = "rgba(26,35,50,0.12)";
      ctx.beginPath();
      ctx.moveTo(pad.l, pad.t + h * 0.5);
      ctx.lineTo(pad.l + w, pad.t + h * 0.5);
      ctx.stroke();

      var pts = [];
      papers.forEach(function (p, i) {
        var b = beliefAfter(papers, prior, Math.min(i, until));
        var x = pad.l + (i / n) * w;
        var y = pad.t + (1 - b) * h;
        pts.push({ x: x, y: y, b: b, p: p, i: i });
      });

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "#2f6f4e";
      ctx.beginPath();
      pts.forEach(function (pt, i) {
        if (i > until) return;
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.stroke();

      pts.forEach(function (pt) {
        if (pt.i > until) return;
        var active = pt.i === hover || pt.i === selected;
        ctx.beginPath();
        ctx.fillStyle = pt.p.stance === "supports" ? "#2f6f4e" : "#9a3412";
        ctx.arc(pt.x, pt.y, active ? 8 : 5.5, 0, Math.PI * 2);
        ctx.fill();
        if (active) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      });

      var last = Math.max(0, Math.min(until, papers.length - 1));
      var bel = papers.length ? beliefAfter(papers, prior, last) : prior;
      if (readout) {
        readout.textContent =
          Math.round(bel * 100) + "% toward “simulators for planning”  ·  prior " + Math.round(prior * 100) + "%";
      }
      return pts;
    }

    var ptsCache = draw(playUntil);

    canvas.addEventListener("mousemove", function (ev) {
      var hit = hitIndex(ev);
      canvas.style.cursor = hit >= 0 ? "pointer" : "default";
      if (hit !== hover) {
        hover = hit;
        ptsCache = draw(playUntil);
        showClaim(hover >= 0 ? hover : selected);
      }
    });

    canvas.addEventListener("mouseleave", function () {
      hover = -1;
      canvas.style.cursor = "default";
      ptsCache = draw(playUntil);
      showClaim(selected);
    });

    canvas.addEventListener("click", function (ev) {
      var hit = hitIndex(ev);
      if (hit < 0) return;
      selected = hit;
      hover = hit;
      ptsCache = draw(playUntil);
      showClaim(selected);
    });

    function play() {
      if (anim) cancelAnimationFrame(anim);
      playUntil = -1;
      function step() {
        playUntil += 1;
        ptsCache = draw(playUntil);
        if (playUntil < papers.length - 1) {
          anim = requestAnimationFrame(function () {
            setTimeout(step, 420);
          });
        }
      }
      step();
    }

    if (replay) replay.addEventListener("click", play);
    window.addEventListener("dossier:belief-show", function () {
      ptsCache = draw(playUntil);
    });
    window.addEventListener("resize", function () {
      ptsCache = draw(playUntil);
    });
  }

  function bindJoinLive() {
    $all("a.join-live-debate, a.mode-live-now").forEach(function (a) {
      a.addEventListener("click", function (ev) {
        var url = a.href;
        var win = window.open(url, "_blank");
        if (win) {
          ev.preventDefault();
          try {
            win.focus();
          } catch (err) {}
        }
      });
    });
  }

  function boot() {
    var node = $("#dossier-data");
    if (!node) {
      bindSwitcher();
      bindJoinLive();
      return;
    }
    var data = {};
    try {
      data = JSON.parse(node.textContent || "{}");
    } catch (e) {
      data = {};
    }
    bindSwitcher();
    bindJoinLive();
    bindDebate(data);
    bindBelief(data);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
