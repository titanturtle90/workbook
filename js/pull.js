/*
 * Pull to refresh (touch devices): drag the page down from the very top and
 * let go to reload Workbook with the latest version and fresh data.
 * An installed home-screen app has no browser refresh button, so this is it.
 */
(function (global) {
  "use strict";
  const App = global.App;
  const THRESHOLD = 60;   // px of (damped) pull needed to refresh
  const MAX_PULL = 110;
  const RESISTANCE = 0.55;

  const el = document.createElement("div");
  el.className = "ptr";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = App.icon("refresh");
  document.body.appendChild(el);

  let st = null;      // the gesture in progress
  let busy = false;   // refreshing

  const touchDevice = () => global.matchMedia("(pointer: coarse)").matches;
  const overlayOpen = () => App.sheet.isOpen() || App.menu.isOpen() || App.dialogOpen() || (global.Shots && global.Shots.isViewing()) || (global.Bulk && global.Bulk.active);
  const blockedTarget = t => !!(t && t.closest && t.closest(".sheet, .menu, .dialog, .lightbox, .bulkbar, input, textarea, select, [contenteditable='true'], [contenteditable='']"));

  function paint(dist, base, mode) {
    const p = Math.min(1, dist / THRESHOLD);
    el.style.setProperty("--ptr-y", `${base + dist - 44}px`);
    el.style.opacity = String(Math.min(1, dist / 28));
    el.style.setProperty("--ptr-rot", `${Math.round(p * 270)}deg`);
    el.classList.toggle("armed", dist >= THRESHOLD);
    el.classList.toggle("spin", mode === "spin");
  }
  function hide(animated) {
    el.classList.toggle("snap", !!animated);
    el.style.opacity = "0";
    el.classList.remove("armed", "spin");
    setTimeout(() => el.classList.remove("snap"), 260);
  }
  const topbarBottom = () => { const t = document.querySelector(".topbar"); return t && t.offsetParent !== null ? t.getBoundingClientRect().bottom : 0; };

  /** Reloads the app: flushes anything half-typed, checks for a new version, then reloads. */
  App.refresh = async function () {
    if (busy) return;
    busy = true;
    try { sessionStorage.setItem("wb:refreshed", "1"); } catch (e) { /* ignore */ }
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) { /* ignore */ }
    const wait = ms => new Promise(r => setTimeout(r, ms));
    await wait(450); // lets a just-typed note finish saving
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) await Promise.race([reg.update(), wait(2500)]);
    } catch (e) { /* offline or no service worker: a plain reload still works */ }
    global.location.reload();
  };

  document.addEventListener("touchstart", e => {
    st = null;
    if (busy || e.touches.length !== 1 || !touchDevice() || overlayOpen() || blockedTarget(e.target) || global.scrollY > 0) return;
    st = { x: e.touches[0].clientX, y: e.touches[0].clientY, active: false, dist: 0, base: topbarBottom() };
  }, { passive: true });

  document.addEventListener("touchmove", e => {
    if (!st) return;
    const dx = e.touches[0].clientX - st.x, dy = e.touches[0].clientY - st.y;
    if (!st.active) {
      if (dy < -4 || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy))) { st = null; return; } // scrolling up/down the list, or a sideways swipe
      if (dy < 10) return;
      st.active = true;
    }
    if (global.scrollY > 0 || overlayOpen()) { st = null; hide(true); return; }
    st.dist = Math.min(MAX_PULL, Math.max(0, (dy - 10) * RESISTANCE));
    if (e.cancelable) e.preventDefault(); // stop the browser's own bounce / refresh
    el.classList.remove("snap");
    paint(st.dist, st.base, "pull");
  }, { passive: false });

  const end = () => {
    if (!st) return;
    const s = st; st = null;
    if (!s.active) return;
    if (s.dist >= THRESHOLD && !busy) {
      el.classList.add("snap");
      paint(THRESHOLD - 8, s.base, "spin");
      if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) { /* ignore */ } }
      App.refresh();
    } else hide(true);
  };
  document.addEventListener("touchend", end, { passive: true });
  document.addEventListener("touchcancel", () => { if (st && st.active) hide(true); st = null; }, { passive: true });

  // After a refresh, say so.
  try {
    if (sessionStorage.getItem("wb:refreshed")) {
      sessionStorage.removeItem("wb:refreshed");
      setTimeout(() => App.toast("Refreshed"), 700);
    }
  } catch (e) { /* ignore */ }
})(window);
