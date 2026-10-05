/* App: sign-in, routing between views, navigation + badges, settings, boot. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Views = global.Views, Editor = global.Editor;
  const esc = App.esc;

  const VIEW_KEYS = ["tasks", "today", "people", "projects", "done", "review"];
  const NAV = [
    { key: "tasks", label: "Dashboard", icon: "table", kbd: "1" },
    { key: "people", label: "People", icon: "users", kbd: "2" },
    { key: "projects", label: "Projects", icon: "folder", kbd: "3" },
    { key: "done", label: "Done", icon: "archive", kbd: "4" },
    { key: "review", label: "Weekly review", icon: "review", kbd: "5" }
  ];

  // ======================= Router =======================
  const Router = { view: "tasks", params: {} };
  const parseHash = () => {
    const [view, id] = (location.hash || "").replace(/^#\/?/, "").split("/");
    return { view: VIEW_KEYS.includes(view) ? view : null, id: id ? decodeURIComponent(id) : "" };
  };
  Router.go = (view, params) => {
    params = params || {};
    const hash = "#" + view + (params.id ? "/" + encodeURIComponent(params.id) : "");
    Router.pending = params;
    if (location.hash !== hash) location.hash = hash; else Router.render();
  };
  Router.render = () => {
    const { view, id } = parseHash();
    // "Today" is now a view inside the Dashboard; old #today links land there.
    if (view === "today") { Views.tasksState.mode = "today"; history.replaceState(history.state, "", "#tasks"); }
    Router.view = view === "today" ? "tasks" : (view || "tasks");
    Router.params = Object.assign({ id }, Router.pending || {});
    Router.pending = null;
    document.querySelectorAll(".panel").forEach(p => { p.hidden = p.dataset.panel !== Router.view; });
    renderCurrent();
    window.scrollTo({ top: 0 });
    renderNav();
    if (Router.params.focusSearch) { Router.params.focusSearch = false; Views.tasks.focusSearch(document.getElementById("panel-tasks")); }
  };
  Router.toggleTaskMode = () => {
    if (Router.view !== "tasks") { Router.go("tasks"); return; }
    Views.tasks.setMode(document.getElementById("panel-tasks"));
  };
  function renderCurrent() {
    if (!Store.isReady()) return;
    const panel = document.getElementById("panel-" + Router.view);
    try { Views[Router.view].render(panel, Router.params); } catch (e) { console.error(e); panel.innerHTML = `<div class="empty"><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`; }
    global.Shortcuts && global.Shortcuts.reapply();
  }
  window.addEventListener("hashchange", () => { global.Shortcuts && global.Shortcuts.clear(); Router.render(); });
  global.Router = Router;

  // ======================= Navigation =======================
  function counts() {
    const b = Views.todayBuckets();
    const active = [...Store.tasks.values()].filter(Model.isActive);
    const wk = App.weekStart();
    return {
      urgent: b.overdue.length + b.today.length + b.followup.length,
      overdue: b.overdue.length,
      active: active.length,
      doneWeek: [...Store.tasks.values()].filter(t => t.status === "done" && t.completedAt && App.isoToDateStr(t.completedAt) >= wk).length,
      reviewDue: Views.reviewDue()
    };
  }
  function renderNav() {
    if (!Store.isReady()) return;
    const c = counts();
    const cur = Router.view;
    const side = document.getElementById("sideNav");
    const countFor = key => key === "tasks" ? (c.urgent ? `<span class="count ${c.overdue ? "alert" : ""}" title="Overdue, due today, and follow-ups">${c.urgent}</span>` : `<span class="count">${c.active}</span>`)
      : key === "done" ? (c.doneWeek ? `<span class="count">${c.doneWeek}</span>` : "")
      : key === "review" ? (c.reviewDue ? `<span class="count alert">•</span>` : "") : "";
    const projects = [...Store.projects.values()].filter(p => !p.archived)
      .map(p => ({ p, n: [...Store.tasks.values()].filter(t => t.projectId === p.id && Model.isActive(t)).length }))
      .filter(x => x.n).sort((a, b) => b.n - a.n).slice(0, 8);
    side.innerHTML = NAV.map((n, i) => (i === 3 ? `<div class="side-sep"></div>` : "") +
      `<a class="side-item ${cur === n.key ? "active" : ""}" href="#${n.key}">${App.icon(n.icon)}<span>${esc(n.label)}</span>${countFor(n.key)}<kbd>${n.kbd}</kbd></a>`).join("") +
      (projects.length ? `<div class="side-label">Active projects</div>` + projects.map(({ p, n }) => `<a class="side-item side-project ${cur === "projects" && Router.params.id === p.id ? "active" : ""}" href="#projects/${esc(p.id)}"><span class="swatch" style="background:${esc(p.color)}"></span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span><span class="count">${n}</span></a>`).join("") : "");

    const tabs = [NAV[0], NAV[1], NAV[2], NAV[3], { key: "more", label: "More", icon: "more" }];
    const tabActive = cur === "review" ? "more" : cur;
    document.getElementById("tabbar").innerHTML = tabs.map(n => {
      const badge = n.key === "tasks" && c.urgent ? `<span class="badge ${c.overdue ? "" : "soft"}">${c.urgent > 99 ? "99+" : c.urgent}</span>` : n.key === "more" && c.reviewDue ? `<span class="badge soft">1</span>` : "";
      return `<button class="tab ${tabActive === n.key ? "active" : ""}" type="button" data-tab="${n.key}"><span class="ico">${App.icon(n.icon)}${badge}</span>${esc(n.short || n.label)}</button>`;
    }).join("");
    document.title = c.urgent ? `(${c.urgent}) Workbook` : "Workbook";
    try { if (navigator.setAppBadge) { if (c.urgent) navigator.setAppBadge(c.urgent); else navigator.clearAppBadge(); } } catch (e) { /* ignore */ }
  }

  document.getElementById("tabbar").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    if (b.dataset.tab === "more") openMore(); else Router.go(b.dataset.tab);
  });
  function openMore() {
    const c = counts();
    const body = App.el(`<div>
      <button type="button" class="mrow" data-go="review">${App.icon("review")}<div class="grow"><div>Weekly review ${c.reviewDue ? `<span class="pill orange" style="margin-left:6px">Due</span>` : ""}</div><div class="sub">Wins, slips, follow-ups, next week</div></div>${App.icon("right", "sm")}</button>
      <button type="button" class="mrow" data-a="meeting">${App.icon("meeting")}<div class="grow"><div>Meeting mode</div><div class="sub">Capture several asks quickly</div></div>${App.icon("right", "sm")}</button>
      <button type="button" class="mrow" data-a="self">${App.icon("me")}<div class="grow"><div>New self-assigned task</div><div class="sub">Something you're asking of yourself</div></div>${App.icon("right", "sm")}</button>
      <button type="button" class="mrow" data-a="export">${App.icon("download")}<div class="grow"><div>Export &amp; reports</div><div class="sub">Excel, monthly summary, backup</div></div>${App.icon("right", "sm")}</button>
      <button type="button" class="mrow" data-a="settings">${App.icon("settings")}<div class="grow"><div>Settings</div><div class="sub">Theme, capacity, account</div></div>${App.icon("right", "sm")}</button>
    </div>`);
    App.sheet.open({ title: "More", body });
    body.onclick = e => {
      const go = e.target.closest("[data-go]")?.dataset.go;
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (go) { App.sheet.close(); setTimeout(() => Router.go(go), 50); }
      if (a) doAction(a);
    };
  }
  function doAction(a) {
    if (a === "meeting") Editor.meeting();
    else if (a === "self") Editor.quickAdd({ self: true });
    else if (a === "export") global.Exporter.open();
    else if (a === "shortcuts") global.Shortcuts.help();
    else if (a === "settings") Settings.open();
    else if (a === "search") Router.go("tasks", { focusSearch: true });
  }
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-action]"); if (!b) return;
    doAction(b.dataset.action);
  });
  document.getElementById("fab").onclick = () => Editor.quickAdd();

  // Snip → paste: pasting or dropping a screenshot anywhere starts a new task with it attached.
  const appVisible = () => !document.getElementById("shell").hidden && !App.sheet.isOpen() && !App.dialogOpen();
  document.addEventListener("paste", e => {
    if (!appVisible() || (e.target.closest && e.target.closest("input, textarea, [contenteditable=true]"))) return;
    const files = global.Shots.imageFiles(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    Editor.quickAdd({ files });
  });
  let dragDepth = 0;
  document.addEventListener("dragenter", e => { if (appVisible() && global.Shots.hasImage(e.dataTransfer)) { dragDepth++; document.body.classList.add("drop-anywhere"); } });
  document.addEventListener("dragleave", () => { if (dragDepth && --dragDepth === 0) document.body.classList.remove("drop-anywhere"); });
  document.addEventListener("dragover", e => { if (document.body.classList.contains("drop-anywhere")) e.preventDefault(); });
  document.addEventListener("drop", e => {
    if (!document.body.classList.contains("drop-anywhere")) return;
    dragDepth = 0; document.body.classList.remove("drop-anywhere");
    const files = global.Shots.imageFiles(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    Editor.quickAdd({ files });
  });
  document.getElementById("sideNew").onclick = () => Editor.quickAdd();

  // Re-render on data changes (skip while the user is mid-drag on the board).
  App.on("data", () => { if (document.querySelector(".tcard.dragging")) return; renderCurrent(); renderNav(); });
  App.on("data-ready", () => { Router.render(); offerPreviewImport(); });
  // Refresh relative dates when the day rolls over or the app comes back to the foreground.
  let lastDay = App.today();
  document.addEventListener("visibilitychange", () => { if (!document.hidden && App.today() !== lastDay) { lastDay = App.today(); renderCurrent(); renderNav(); } });
  setInterval(() => { if (App.today() !== lastDay) { lastDay = App.today(); renderCurrent(); renderNav(); } }, 60000);
  let wasDesktop = App.isDesktop();
  window.addEventListener("resize", App.debounce(() => { if (App.isDesktop() !== wasDesktop) { wasDesktop = App.isDesktop(); renderCurrent(); } }, 150));

  // ======================= Settings =======================
  const Settings = {};
  Settings.open = () => {
    const theme = App.lsGet("wb:theme", "auto");
    const user = Auth.user;
    const preview = Store.localPreviewData();
    const previewCount = preview.tasks.length;
    const body = App.el(`<div>
      <div class="field"><label>Account</label>
        <div class="row" style="font-size:.9rem">${Store.mode === "local" ? `<span class="pill yellow">Preview</span><span class="grow">Saved on this device only</span>` : `<span class="pill green">Synced</span><span class="grow">${esc(user?.email || "Signed in")}</span>`}
        ${Store.mode === "local" ? (Auth.configured ? `<button type="button" class="btn sm primary" data-signin>Sign in to sync</button>` : "") : `<button type="button" class="btn sm ghost" data-signout>${App.icon("logout", "sm")}Sign out</button>`}</div>
      </div>
      ${Store.mode === "cloud" && previewCount ? `<div class="field mt-16"><label>Preview data on this device</label><div class="row"><span class="grow" style="font-size:.88rem">${App.plural(previewCount, "task")} from preview mode</span><button type="button" class="btn sm" data-import>Import to my account</button></div></div>` : ""}
      <div class="field mt-16"><label>Appearance</label>
        <div class="seg">${[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button type="button" data-theme="${v}" class="${theme === v ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="field mt-16"><label>Dashboard opens on</label>
        <div class="seg">${[["last", "Last used"], ["today", "Today"], ["table", "Table"], ["board", "Board"]].map(([v, l]) => `<button type="button" data-start="${v}" class="${App.lsGet("wb:dashStart", "last") === v ? "on" : ""}">${l}</button>`).join("")}</div>
      </div>
      <div class="field mt-16"><label>Weekly capacity (hours of task work)</label>
        <input class="input" type="number" min="1" max="80" step="1" data-capacity value="${esc(Store.setting("weeklyCapacity", 30))}" style="max-width:140px">
        <span class="muted" style="font-size:.8rem">Used by the weekly review to warn when next week is overloaded.</span>
      </div>
      <div class="mt-16">
        <button type="button" class="mrow" data-a="shortcuts">${App.icon("keyboard")}<div class="grow">Keyboard shortcuts</div>${App.icon("right", "sm")}</button>
        <button type="button" class="mrow" data-a="export">${App.icon("download")}<div class="grow">Export &amp; reports</div>${App.icon("right", "sm")}</button>
      </div>
      <p class="muted mt-16" style="font-size:.75rem">Workbook v1</p>
    </div>`);
    App.sheet.open({ title: "Settings", body, narrow: true });
    body.querySelectorAll("[data-theme]").forEach(b => b.onclick = () => {
      const v = b.dataset.theme; App.lsSet("wb:theme", v);
      if (v === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
      body.querySelectorAll("[data-theme]").forEach(x => x.classList.toggle("on", x === b));
    });
    body.querySelectorAll("[data-start]").forEach(b => b.onclick = () => { App.lsSet("wb:dashStart", b.dataset.start); body.querySelectorAll("[data-start]").forEach(x => x.classList.toggle("on", x === b)); });
    const cap = body.querySelector("[data-capacity]");
    cap.onchange = () => { const n = Math.max(1, Math.min(80, Number(cap.value) || 30)); cap.value = n; Store.setSetting("weeklyCapacity", n); };
    body.querySelectorAll("[data-a]").forEach(b => b.onclick = () => doAction(b.dataset.a));
    const so = body.querySelector("[data-signout]");
    if (so) so.onclick = async () => { if (await App.confirm({ title: "Sign out?", text: "Your tasks stay safe in your account.", okLabel: "Sign out" })) { App.sheet.close(); Auth.signOut(); } };
    const si = body.querySelector("[data-signin]");
    if (si) si.onclick = () => { App.sheet.close(); App.lsSet("wb:mode", ""); Store.stop(); showSignin(); };
    const im = body.querySelector("[data-import]");
    if (im) im.onclick = () => importPreview();
  };
  global.Settings = Settings;

  async function importPreview() {
    const data = Store.localPreviewData();
    if (!data.tasks.length && !data.people.length && !data.projects.length) return;
    for (const img of data.images) { try { await Store.putImage(img); } catch (e) { console.error(e); } }
    await Store.saveMany("people", data.people);
    await Store.saveMany("projects", data.projects);
    await Store.saveMany("tasks", data.tasks);
    Store.clearLocalPreview();
    App.sheet.close();
    App.toast(`Imported ${App.plural(data.tasks.length, "task")} from preview`);
  }
  function offerPreviewImport() {
    if (Store.mode !== "cloud") return;
    const n = Store.localPreviewData().tasks.length;
    if (n) App.toast(`${App.plural(n, "task")} from preview mode found on this device`, { label: "Import", onClick: importPreview });
  }

  // ======================= Auth =======================
  const Auth = { configured: false, user: null };
  const cfg = global.FIREBASE_CONFIG || {};
  Auth.configured = !!(cfg.apiKey && cfg.projectId && typeof firebase !== "undefined");

  Auth.signOut = () => {
    if (Store.mode === "cloud") firebase.auth().signOut();
  };

  function showApp() {
    document.getElementById("signin").hidden = true;
    document.getElementById("shell").hidden = false;
  }
  function startLocal() {
    App.lsSet("wb:mode", "local");
    showApp();
    Store.start({ mode: "local" });
  }
  function showSignin(message) {
    document.getElementById("shell").hidden = true;
    document.getElementById("signin").hidden = false;
    const box = document.getElementById("signinBody");
    if (!Auth.configured) {
      const libMissing = cfg.apiKey && typeof firebase === "undefined";
      box.innerHTML = `
        <button class="btn primary block lg" type="button" data-preview>Try it on this device</button>
        <div class="note">${libMissing
          ? "Couldn't load the sync library (check your connection or network filters). You can still use Workbook on this device."
          : "<b>Sync isn't set up yet.</b> Until a Firebase project is connected (see the README), Workbook saves everything in this browser only. You can import it into your account later."}</div>`;
      box.querySelector("[data-preview]").onclick = startLocal;
      return;
    }
    const savedEmail = App.lsGet("wb:emailForSignIn", "");
    box.innerHTML = `
      <button class="btn ghost block lg" type="button" data-google>${App.icon("google")}Continue with Google</button>
      <div class="or">or get a sign-in link by email</div>
      <form data-email-form>
        <input class="input" type="email" name="email" placeholder="you@company.com" required value="${esc(savedEmail)}" autocomplete="email">
        <button class="btn primary block" type="submit">Email me a sign-in link</button>
      </form>
      ${message ? `<div class="note">${message}</div>` : ""}
      <div class="note">Use the email link if your work computer blocks Google pop-ups. Only you can see your tasks.</div>`;
    box.querySelector("[data-google]").onclick = async () => {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try { await firebase.auth().signInWithPopup(provider); }
      catch (err) {
        if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(err.code)) {
          try { await firebase.auth().signInWithRedirect(provider); } catch (e2) { showSignin(esc(e2.message)); }
        } else if (err.code !== "auth/popup-closed-by-user") showSignin(`Google sign-in didn't work (${esc(err.code || err.message)}). Try the email link instead.`);
      }
    };
    box.querySelector("[data-email-form]").onsubmit = async e => {
      e.preventDefault();
      const email = e.target.email.value.trim();
      const btn = e.target.querySelector("button"); btn.disabled = true; btn.textContent = "Sending…";
      try {
        await firebase.auth().sendSignInLinkToEmail(email, { url: location.origin + location.pathname, handleCodeInApp: true });
        App.lsSet("wb:emailForSignIn", email);
        showSignin(`<b>Check your inbox.</b> We sent a sign-in link to ${esc(email)}. Open it on this device.`);
      } catch (err) {
        showSignin(`Couldn't send the link (${esc(err.code || err.message)}). Is Email link sign-in enabled in Firebase?`);
      }
    };
  }

  async function bootFirebase() {
    try {
      firebase.initializeApp(cfg);
      App.db = firebase.firestore();
      try { App.db.enablePersistence({ synchronizeTabs: true }).catch(() => {}); } catch (e) { /* ignore */ }
    } catch (e) {
      console.error(e);
      Auth.configured = false;
      return showSignin();
    }
    const auth = firebase.auth();
    // Finish an email-link sign-in if we arrived from the link.
    if (auth.isSignInWithEmailLink(location.href)) {
      let email = App.lsGet("wb:emailForSignIn", "");
      if (!email) email = global.prompt("Confirm your email to finish signing in") || "";
      try { await auth.signInWithEmailLink(email, location.href); }
      catch (err) { showSignin(`That sign-in link didn't work (${esc(err.code || err.message)}). Request a new one.`); }
      history.replaceState(null, "", location.pathname + (location.hash || ""));
    }
    try { await auth.getRedirectResult(); } catch (err) { if (err.code) console.warn(err); }
    auth.onAuthStateChanged(user => {
      Auth.user = user;
      if (user) {
        showApp();
        App.setSync("", "Syncing…");
        Store.start({ mode: "cloud", uid: user.uid });
      } else {
        Store.stop();
        showSignin();
      }
    });
  }

  // ======================= Boot =======================
  window.addEventListener("online", () => { if (Store.mode === "cloud") App.setSync("synced", "Synced"); });
  window.addEventListener("offline", () => { if (Store.mode === "cloud") App.setSync("", "Offline · will sync"); });

  if (App.lsGet("wb:mode", "") === "local" && !Auth.configured) startLocal();
  else if (Auth.configured) bootFirebase();
  else showSignin();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})(window);
