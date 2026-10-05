/*
 * Core: shared helpers, dates, toast, confirm dialog, bottom sheet / side
 * drawer, popover menus and autocomplete. Every module builds on window.App.
 */
(function (global) {
  "use strict";

  const App = {};
  const listeners = new Map();

  // ---------- tiny event bus ----------
  App.on = (evt, fn) => { if (!listeners.has(evt)) listeners.set(evt, new Set()); listeners.get(evt).add(fn); return () => listeners.get(evt).delete(fn); };
  App.emit = (evt, data) => { (listeners.get(evt) || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); };

  // ---------- helpers ----------
  App.esc = str => String(str ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  App.genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  App.icon = (name, cls) => `<svg class="ic ${cls || ""}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  App.plural = (n, word, pl) => `${n} ${n === 1 ? word : (pl || word + "s")}`;
  App.debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.flush = (...a) => { clearTimeout(t); fn(...a); }; return d; };
  App.lsGet = (k, fallback) => { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } };
  App.lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } };
  App.el = html => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  App.isDesktop = () => global.matchMedia("(min-width: 900px)").matches;
  App.initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "?";
  App.hashColor = str => {
    const palette = ["#2a5bd7", "#7149d0", "#0e8a7d", "#c2410c", "#be185d", "#4d7c0f", "#0369a1", "#9333ea", "#b45309", "#475569"];
    let h = 0; for (const ch of String(str || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return palette[h % palette.length];
  };
  App.safeUrl = url => {
    const u = String(url || "").trim();
    if (!u) return "";
    if (/^(https?:|mailto:|tel:|msteams:|slack:|outlook:|onenote:)/i.test(u)) return u;
    if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(u)) return "https://" + u;
    return "";
  };
  App.download = (filename, text, type) => {
    const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  App.copy = async text => {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { /* ignore */ }
      ta.remove(); return ok;
    }
  };

  // ---------- dates (all due dates are local "YYYY-MM-DD" strings) ----------
  App.startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  App.parseDate = s => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  App.toDateStr = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  App.today = () => App.toDateStr(App.startOfToday());
  App.addDays = (days, from) => { const d = from ? App.parseDate(from) : App.startOfToday(); d.setDate(d.getDate() + days); return App.toDateStr(d); };
  App.addMonths = (months, from) => {
    const d = from ? App.parseDate(from) : App.startOfToday();
    const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + months);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last)); return App.toDateStr(d);
  };
  App.daysUntil = s => Math.round((App.parseDate(s) - App.startOfToday()) / 86400000);
  // Next given weekday (0=Sun..6=Sat), strictly after today unless allowToday.
  App.nextWeekday = (dow, allowToday) => {
    const d = App.startOfToday();
    let diff = (dow - d.getDay() + 7) % 7;
    if (diff === 0 && !allowToday) diff = 7;
    d.setDate(d.getDate() + diff); return App.toDateStr(d);
  };
  App.weekStart = from => { const d = from ? App.parseDate(from) : App.startOfToday(); const diff = (d.getDay() + 6) % 7; d.setDate(d.getDate() - diff); return App.toDateStr(d); }; // Monday
  App.fmtDate = s => App.parseDate(s).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  App.fmtDateLong = s => App.parseDate(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  App.fmtIso = iso => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  App.fmtIsoTime = iso => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  App.isoToDateStr = iso => App.toDateStr(new Date(iso));
  App.relDue = s => {
    const n = App.daysUntil(s);
    if (n < -1) return `${-n} days overdue`;
    if (n === -1) return "Yesterday";
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n < 7) return App.parseDate(s).toLocaleDateString(undefined, { weekday: "long" });
    return App.fmtDate(s);
  };
  // For use mid-sentence: "due today", "due Friday", "due Oct 12".
  App.relDueLower = s => { const r = App.relDue(s); return /^(Today|Tomorrow|Yesterday)$/.test(r) ? r.toLowerCase() : r; };
  App.relative = iso => {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 90) return "just now";
    if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
    if (diff < 86400 * 1.5) return `${Math.round(diff / 3600)} hr ago`;
    return `${Math.round(diff / 86400)} days ago`;
  };

  // ---------- sync indicator ----------
  App.setSync = (state, text) => {
    ["syncStatus", "syncStatusM"].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = "brand-sub " + (state || "");
      el.querySelector(".txt").textContent = text;
    });
  };

  // ---------- toast ----------
  const toastEl = document.getElementById("toast");
  const toastMsg = document.getElementById("toastMsg");
  const toastAct = document.getElementById("toastAct");
  let toastTimer = null;
  App.toast = function (msg, action) {
    toastMsg.textContent = msg;
    if (action) {
      toastAct.textContent = action.label;
      toastAct.hidden = false;
      toastAct.onclick = () => { clearTimeout(toastTimer); toastEl.classList.remove("show"); action.onClick(); };
    } else { toastAct.hidden = true; toastAct.onclick = null; }
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), action ? 6000 : 2600);
  };

  // ---------- confirm dialog ----------
  const dialog = document.getElementById("dialog");
  App.dialogOpen = () => dialog.classList.contains("show");
  App.confirm = function ({ title, text, okLabel = "OK", cancelLabel = "Cancel", danger = false }) {
    return new Promise(resolve => {
      document.getElementById("dialogTitle").textContent = title || "Are you sure?";
      document.getElementById("dialogText").textContent = text || "";
      const ok = document.getElementById("dialogOk");
      const cancel = document.getElementById("dialogCancel");
      ok.textContent = okLabel; cancel.textContent = cancelLabel;
      ok.className = "btn " + (danger ? "danger" : "primary");
      const done = v => { dialog.classList.remove("show"); ok.onclick = cancel.onclick = null; document.removeEventListener("keydown", onKey, true); resolve(v); };
      const onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
        if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); done(true); }
      };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
      dialog.onclick = e => { if (e.target === dialog) done(false); };
      document.addEventListener("keydown", onKey, true);
      dialog.classList.add("show");
      setTimeout(() => ok.focus(), 30);
    });
  };

  // ---------- sheet: bottom sheet on phones, right-hand drawer on desktop ----------
  const sheet = document.getElementById("sheet");
  const backdrop = document.getElementById("sheetBackdrop");
  const sheetHead = document.getElementById("sheetHead");
  const sheetBody = document.getElementById("sheetBody");
  const sheetFoot = document.getElementById("sheetFoot");
  let sheetOnClose = null;
  let sheetOpen = false;
  let lastFocus = null;

  App.sheet = {
    open({ title, subtitle, body, foot, tall = false, narrow = false, onClose = null, headExtra = "" }) {
      // Opening a sheet over another one replaces it (fires the old onClose first).
      if (sheetOpen && sheetOnClose) { const cb = sheetOnClose; sheetOnClose = null; cb(); }
      if (!sheetOpen) lastFocus = document.activeElement;
      sheetOnClose = onClose;
      sheetHead.innerHTML = `<div class="grow"><h2>${App.esc(title || "")}</h2>${subtitle ? `<p class="hint">${subtitle}</p>` : ""}</div>${headExtra}<button class="icon-btn sm" type="button" id="sheetClose" aria-label="Close" title="Close (Esc)">${App.icon("x")}</button>`;
      sheetBody.innerHTML = "";
      if (typeof body === "string") sheetBody.innerHTML = body; else if (body) sheetBody.appendChild(body);
      if (foot) { sheetFoot.hidden = false; sheetFoot.innerHTML = ""; if (typeof foot === "string") sheetFoot.innerHTML = foot; else sheetFoot.appendChild(foot); }
      else sheetFoot.hidden = true;
      sheet.classList.toggle("tall", tall);
      sheet.classList.toggle("narrow", narrow);
      sheetBody.scrollTop = 0;
      document.getElementById("sheetClose").onclick = () => App.sheet.close();
      requestAnimationFrame(() => { backdrop.classList.add("show"); sheet.classList.add("show"); document.body.classList.add("sheet-open"); });
      if (!sheetOpen) { sheetOpen = true; history.pushState({ sheet: true }, ""); }
      return { body: sheetBody, foot: sheetFoot, head: sheetHead };
    },
    close(fromPop) {
      if (!sheetOpen) return;
      sheetOpen = false;
      backdrop.classList.remove("show"); sheet.classList.remove("show"); document.body.classList.remove("sheet-open");
      const cb = sheetOnClose; sheetOnClose = null;
      if (cb) cb();
      if (!fromPop && history.state && history.state.sheet) history.back();
      // The sheet only slides off-screen, so drop focus from anything inside it.
      if (sheet.contains(document.activeElement)) document.activeElement.blur();
      if (lastFocus && lastFocus !== document.body && document.contains(lastFocus)) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      App.emit("sheet-closed");
    },
    isOpen: () => sheetOpen,
    body: () => sheetBody,
    setTitle(t) { const h = sheetHead.querySelector("h2"); if (h) h.textContent = t; }
  };
  backdrop.addEventListener("click", () => App.sheet.close());
  window.addEventListener("popstate", () => { if (sheetOpen) App.sheet.close(true); });
  // swipe-down to dismiss (phones)
  (function () {
    let startY = null, dy = 0;
    sheet.addEventListener("touchstart", e => {
      if (App.isDesktop()) { startY = null; return; }
      if (sheetBody.contains(e.target) && (sheetBody.scrollTop > 0 || e.target.closest("input, textarea, select, [contenteditable]"))) { startY = null; return; }
      startY = e.touches[0].clientY; dy = 0; sheet.style.transition = "none";
    }, { passive: true });
    sheet.addEventListener("touchmove", e => { if (startY == null) return; dy = Math.max(0, e.touches[0].clientY - startY); sheet.style.transform = `translateY(${dy}px)`; }, { passive: true });
    sheet.addEventListener("touchend", () => { if (startY == null) return; sheet.style.transition = ""; sheet.style.transform = ""; if (dy > 110) App.sheet.close(); startY = null; });
  })();

  // ---------- popover menu ----------
  const menu = document.getElementById("menu");
  let menuItems = [];
  let menuHl = -1;
  let menuOnClose = null;
  App.menu = {
    /** items: [{label, icon, onClick, on, danger, k}] | {sep:true} | {header:"…"} */
    open(anchor, items, opts) {
      opts = opts || {};
      menuOnClose = opts.onClose || null;
      menuItems = items;
      menuHl = -1;
      menu.innerHTML = items.map((it, i) => {
        if (it.sep) return `<div class="sep"></div>`;
        if (it.header) return `<div class="mh">${App.esc(it.header)}</div>`;
        return `<button type="button" class="mi ${it.on ? "on" : ""} ${it.danger ? "danger" : ""}" data-i="${i}" role="menuitem">${it.icon ? (it.icon.startsWith("<") ? it.icon : App.icon(it.icon, "sm")) : ""}<span>${App.esc(it.label)}</span>${it.on ? `<span class="k">${App.icon("check", "sm")}</span>` : it.k ? `<span class="k">${App.esc(it.k)}</span>` : ""}</button>`;
      }).join("");
      menu.hidden = false;
      let x, y;
      if (anchor && anchor.getBoundingClientRect) {
        const r = anchor.getBoundingClientRect();
        x = r.left; y = r.bottom + 4;
        menu.style.left = "0px"; menu.style.top = "0px";
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        if (x + mw > window.innerWidth - 8) x = Math.max(8, r.right - mw);
        if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 4);
      } else {
        x = (anchor && anchor.x) || window.innerWidth / 2 - 100; y = (anchor && anchor.y) || window.innerHeight / 3;
        const mw = menu.offsetWidth, mh = menu.offsetHeight;
        x = Math.min(x, window.innerWidth - mw - 8); y = Math.min(y, window.innerHeight - mh - 8);
      }
      menu.style.left = x + "px"; menu.style.top = y + "px";
      if (opts.keyboard) App.menu.move(1);
    },
    close() {
      if (menu.hidden) return;
      menu.hidden = true; menuItems = [];
      const cb = menuOnClose; menuOnClose = null; if (cb) cb();
    },
    isOpen: () => !menu.hidden,
    move(delta) {
      const btns = [...menu.querySelectorAll(".mi")];
      if (!btns.length) return;
      const cur = btns.findIndex(b => b.classList.contains("hl"));
      let next = cur + delta;
      if (next < 0) next = btns.length - 1;
      if (next >= btns.length) next = 0;
      btns.forEach(b => b.classList.remove("hl"));
      btns[next].classList.add("hl"); btns[next].scrollIntoView({ block: "nearest" });
      menuHl = Number(btns[next].dataset.i);
    },
    activate() { if (menuHl >= 0) pick(menuHl); }
  };
  function pick(i) {
    const it = menuItems[i];
    App.menu.close();
    if (it && it.onClick) it.onClick();
  }
  menu.addEventListener("click", e => { const b = e.target.closest(".mi"); if (b) pick(Number(b.dataset.i)); });
  document.addEventListener("mousedown", e => { if (!menu.hidden && !menu.contains(e.target)) App.menu.close(); }, true);
  document.addEventListener("touchstart", e => { if (!menu.hidden && !menu.contains(e.target)) App.menu.close(); }, { capture: true, passive: true });
  window.addEventListener("resize", () => App.menu.close());
  document.addEventListener("scroll", () => App.menu.close(), true);

  // ---------- autocomplete on a text input ----------
  /**
   * App.autocomplete(input, { source: q => [{label, sub, value}], onPick: item => {} })
   * Arrow keys + Enter pick; Escape closes. Returns { close }.
   */
  App.autocomplete = function (input, { source, onPick, minChars = 0 }) {
    const wrap = input.closest(".ac") || input.parentElement;
    let list = null, items = [], hl = -1;
    const close = () => { if (list) { list.remove(); list = null; } items = []; hl = -1; };
    const render = () => {
      const q = input.value.trim();
      if (q.length < minChars) { close(); return; }
      items = source(q) || [];
      if (!items.length) { close(); return; }
      if (!list) { list = document.createElement("div"); list.className = "ac-list"; wrap.appendChild(list); }
      if (hl >= items.length) hl = items.length - 1;
      list.innerHTML = items.map((it, i) => `<button type="button" class="ac-item ${i === hl ? "hl" : ""}" data-i="${i}">${it.html || App.esc(it.label)}${it.sub ? `<span class="sub">${App.esc(it.sub)}</span>` : ""}</button>`).join("");
    };
    const choose = i => { const it = items[i]; close(); if (it) onPick(it); };
    input.addEventListener("input", () => { hl = 0; render(); });
    input.addEventListener("focus", () => { hl = -1; render(); });
    input.addEventListener("blur", () => setTimeout(close, 150));
    input.addEventListener("keydown", e => {
      if (!list) { if (e.key === "ArrowDown") { hl = 0; render(); e.preventDefault(); } return; }
      if (e.key === "ArrowDown") { e.preventDefault(); hl = Math.min(items.length - 1, hl + 1); render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); hl = Math.max(0, hl - 1); render(); }
      else if (e.key === "Enter" && hl >= 0) { e.preventDefault(); e.stopPropagation(); choose(hl); }
      else if (e.key === "Tab" && hl >= 0 && input.value.trim()) { choose(hl); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    });
    wrap.addEventListener("mousedown", e => { const b = e.target.closest(".ac-item"); if (b) { e.preventDefault(); choose(Number(b.dataset.i)); } });
    return { close, refresh: render };
  };

  global.App = App;
})(window);
