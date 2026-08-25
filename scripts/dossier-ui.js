/* Skill71717 — dossier mode switcher and debate rooms.
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
  }
  window.dossierSetMode = setMode;

  function bindSwitcher() {
    $all(".mode-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setMode(btn.getAttribute("data-mode"));
      });
    });
    var hash = (location.hash || "").replace("#", "");
    if (hash === "debate" || hash === "synthesis") {
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

  function boot() {
    var node = $("#dossier-data");
    if (!node) {
      bindSwitcher();
      return;
    }
    var data = {};
    try {
      data = JSON.parse(node.textContent || "{}");
    } catch (e) {
      data = {};
    }
    bindSwitcher();
    bindDebate(data);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
