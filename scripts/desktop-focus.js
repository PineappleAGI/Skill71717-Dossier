/* Skill71717 — keep desktop type readable when the host webview
   reports a layout viewport much wider than the real window.
   Do not re-run that correction when only innerWidth changes:
   that is browser zoom, and fighting it makes zoom-out (and a
   full-page screenshot of the map) look like a no-op. */
(function () {
  "use strict";

  var lastInner = 0;
  var lastOuter = 0;

  function applyDesktopFocus() {
    var inner = window.innerWidth || 0;
    var outer = window.outerWidth || 0;
    var screenW = (window.screen && screen.availWidth) || 0;
    if (
      lastOuter >= 320 &&
      Math.abs(outer - lastOuter) < 24 &&
      Math.abs(inner - lastInner) > 48
    ) {
      lastInner = inner;
      lastOuter = outer;
      return;
    }
    lastInner = inner;
    lastOuter = outer;
    var frame = 0;
    if (outer >= 320 && screenW >= 320) frame = Math.min(outer, screenW);
    else if (outer >= 320) frame = outer;
    else if (screenW >= 320) frame = screenW;
    var scale = 1;
    if (inner >= 640 && frame >= 320 && inner > frame * 1.28) {
      scale = Math.min(4, inner / frame);
    }
    var root = document.documentElement;
    root.style.setProperty("--m1-focus", String(scale));
    if (scale > 1.01) root.setAttribute("data-m1-focus", "boost");
    else root.removeAttribute("data-m1-focus");
  }

  applyDesktopFocus();
  window.addEventListener("resize", applyDesktopFocus);
})();
