/*
 * Bulk: select several tasks and change them together.
 * Start with the Select button, Ctrl/⌘+click, V on a highlighted task, or a
 * long-press on phones. A bar offers Done, Status, Due, Not until, Project,
 * Priority and Delete; every change can be undone.
 */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Actions = global.Actions, Comp = global.Comp;
  const esc = App.esc;
  const Bulk = { ids: new Set(), active: false };
  const copy = t => JSON.parse(JSON.stringify(t));

  Bulk.has = id => Bulk.active && Bulk.ids.has(id);
  const selected = () => [...Bulk.ids].map(id => Store.tasks.get(id)).filter(Boolean);

  Bulk.start = id => {
    Bulk.active = true;
    document.body.classList.add("selecting");
    if (id) Bulk.ids.add(id);
    App.menu.close();
    paint();
  };
  Bulk.stop = () => {
    if (!Bulk.active) return;
    Bulk.active = false;
    Bulk.ids.clear();
    document.body.classList.remove("selecting");
    paint();
  };
  Bulk.toggle = id => {
    if (!Bulk.active) Bulk.start();
    if (Bulk.ids.has(id)) Bulk.ids.delete(id); else Bulk.ids.add(id);
    paint();
  };
  Bulk.selectAll = () => {
    const panel = document.querySelector(".panel:not([hidden])");
    if (!panel) return;
    const ids = [...new Set([...panel.querySelectorAll("[data-task-id]")].filter(el => el.offsetParent !== null).map(el => el.dataset.taskId))].filter(id => Store.tasks.has(id));
    const allOn = ids.length && ids.every(id => Bulk.ids.has(id));
    ids.forEach(id => allOn ? Bulk.ids.delete(id) : Bulk.ids.add(id));
    paint();
  };

  /** Called first by every task list's click handler. Returns true when the click was a selection. */
  Bulk.handleClick = (e, host) => {
    const id = host.dataset.taskId;
    if (!Bulk.active) {
      if ((e.ctrlKey || e.metaKey) && App.isDesktop()) { e.preventDefault(); Bulk.start(id); return true; }
      return false;
    }
    e.preventDefault(); e.stopPropagation();
    Bulk.toggle(id);
    return true;
  };

  // ---------- bar ----------
  const bar = App.el(`<div class="bulkbar" role="toolbar" aria-label="Selected tasks" hidden>
    <div class="bb-left"><b data-count>0</b><button type="button" class="bb-link" data-b="all">Select all</button></div>
    <div class="bb-acts">
      <button type="button" data-b="done" title="Mark done">${App.icon("check")}<span>Done</span></button>
      <button type="button" data-b="status" title="Status">${App.icon("board")}<span>Status</span></button>
      <button type="button" data-b="due" title="Due date">${App.icon("calendar")}<span>Due</span></button>
      <button type="button" data-b="snooze" title="Not until">${App.icon("moon")}<span>Not until</span></button>
      <button type="button" data-b="project" title="Project">${App.icon("folder")}<span>Project</span></button>
      <button type="button" data-b="priority" title="Priority">${App.icon("flag")}<span>Priority</span></button>
      <button type="button" data-b="delete" class="danger" title="Delete">${App.icon("trash")}<span>Delete</span></button>
    </div>
    <button type="button" class="bb-close" data-b="close" aria-label="Stop selecting" title="Stop selecting (Esc)">${App.icon("x")}</button>
  </div>`);
  document.body.appendChild(bar);

  function paint() {
    // drop ids that no longer exist (deleted, or synced away)
    [...Bulk.ids].forEach(id => { if (!Store.tasks.has(id)) Bulk.ids.delete(id); });
    document.querySelectorAll("[data-task-id]").forEach(el => el.classList.toggle("selected", Bulk.has(el.dataset.taskId)));
    bar.hidden = !Bulk.active;
    const n = Bulk.ids.size;
    bar.querySelector("[data-count]").textContent = n ? `${n} selected` : "Tap tasks to select";
    bar.querySelectorAll(".bb-acts button").forEach(b => { b.disabled = !n; });
  }
  Bulk.paint = paint;

  /** Applies fn to a copy of each selected task, saves them together, and offers Undo. */
  function apply(fn, message) {
    const tasks = selected();
    if (!tasks.length) return;
    const before = tasks.map(copy);
    const after = tasks.map(t => { const c = copy(t); fn(c); return c; });
    Store.saveMany("tasks", after);
    App.toast(message(tasks.length), { label: "Undo", onClick: () => Store.saveMany("tasks", before) });
  }
  const n = (k, word) => `${k} task${k === 1 ? "" : "s"} ${word}`;

  function menuFor(kind, anchor) {
    if (kind === "status") {
      App.menu.open(anchor, [{ header: "Set status" }].concat(Model.STATUSES.filter(s => s.key !== "done").map(s => ({
        label: s.label, icon: `<span class="dot-sw" style="background:${Model.statusDot(s.key)};border-radius:50%"></span>`,
        onClick: () => apply(t => {
          if (t.status === s.key) return;
          const was = Model.status(t.status).label;
          t.status = s.key;
          if (s.key === "cancelled") t.completedAt = new Date().toISOString();
          if (s.key === "waiting") { t.waiting = Object.assign({ personId: "", since: "", followUp: "" }, t.waiting); if (!t.waiting.since) t.waiting.since = App.today(); if (!t.waiting.followUp) t.waiting.followUp = App.addDays(Model.FOLLOW_UP_DAYS); }
          Actions.addLog(t, `Status: ${was} → ${s.label}`, true);
        }, k => `${n(k, "moved")} to ${s.label}`)
      }))));
    } else if (kind === "due") {
      App.menu.open(anchor, [{ header: "Set due date" }].concat(Comp.quickDates().map(d => ({
        label: d.label, k: d.value ? App.fmtDate(d.value) : "", icon: "calendar",
        onClick: () => apply(t => {
          if (t.due && d.value && t.due !== d.value) Actions.addLog(t, `Due date moved: ${App.fmtDate(t.due)} → ${App.fmtDate(d.value)}`, true);
          t.due = d.value;
        }, k => d.value ? `${n(k, "due")} ${App.relDueLower(d.value)}` : `Due date cleared on ${k} task${k === 1 ? "" : "s"}`)
      }))));
    } else if (kind === "snooze") {
      const items = Actions.snoozeChoices().map(c => ({
        label: c.label, k: App.fmtDate(c.value), icon: "moon",
        onClick: () => apply(t => { t.startDate = c.value; Actions.addLog(t, `Not until ${App.fmtDate(c.value)}`, true); }, k => `${n(k, "hidden")} from Today until ${App.fmtDate(c.value)}`)
      }));
      items.push({ sep: true }, { label: "Clear “not until”", icon: "x", onClick: () => apply(t => { t.startDate = ""; }, k => `${n(k, "back")} on Today`) });
      App.menu.open(anchor, [{ header: "Not until (hide from Today)" }].concat(items));
    } else if (kind === "project") {
      const projects = [...Store.projects.values()].filter(p => !p.archived).sort((a, b) => a.name.localeCompare(b.name));
      App.menu.open(anchor, [{ header: "Move to project" }].concat(projects.map(p => ({
        label: p.name, icon: `<span class="dot-sw" style="background:${esc(p.color)}"></span>`,
        onClick: () => apply(t => { t.projectId = p.id; }, k => `${n(k, "moved")} to ${p.name}`)
      })), projects.length ? [{ sep: true }] : [], [{ label: "No project", icon: "x", onClick: () => apply(t => { t.projectId = ""; }, k => `${n(k, "removed")} from projects`) }]));
    } else if (kind === "priority") {
      App.menu.open(anchor, [{ header: "Set priority" }].concat(Model.PRIORITIES.map(p => ({
        label: p.label, icon: "flag", onClick: () => apply(t => { t.priority = p.key; }, k => `${n(k, "set")} to ${p.label} priority`)
      }))));
    }
  }

  bar.addEventListener("click", e => {
    const b = e.target.closest("[data-b]"); if (!b) return;
    const kind = b.dataset.b;
    if (kind === "close") return Bulk.stop();
    if (kind === "all") return Bulk.selectAll();
    if (kind === "done") {
      const tasks = selected().filter(Model.isActive);
      if (!tasks.length) return;
      const before = tasks.map(copy);
      const spawned = tasks.map(t => Actions.complete(t, { quiet: true })).filter(Boolean);
      App.toast(`${n(tasks.length, "done")}${spawned.length ? ` · ${spawned.length} repeating task${spawned.length === 1 ? "" : "s"} scheduled` : ""}`, {
        label: "Undo", onClick: () => { Store.saveMany("tasks", before); spawned.forEach(s => Store.remove("tasks", s.id)); }
      });
      return Bulk.stop();
    }
    if (kind === "delete") { Actions.trash(selected()); return Bulk.stop(); }
    menuFor(kind, b);
  });

  // Keep highlights right after any re-render; leave select mode when changing pages.
  App.on("data", () => { if (Bulk.active) requestAnimationFrame(paint); });
  window.addEventListener("hashchange", () => Bulk.stop());

  // Long-press (phones) starts selecting. Returns a cleanup-free binder used by Comp.bindTasks.
  Bulk.bindLongPress = root => {
    let timer = null, startX = 0, startY = 0, host = null;
    root.addEventListener("touchstart", e => {
      host = e.target.closest("[data-task-id]");
      if (!host || !root.contains(host) || e.touches.length > 1) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        root._longPressed = true;
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) { /* ignore */ } }
        Bulk.toggle(host.dataset.taskId);
      }, 480);
    }, { passive: true });
    const cancel = () => { clearTimeout(timer); timer = null; };
    root.addEventListener("touchmove", e => {
      if (!timer) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > 8 || Math.abs(t.clientY - startY) > 8) cancel();
    }, { passive: true });
    // the finger lifting after a long-press produces one click: swallow just that one
    root.addEventListener("touchend", () => { cancel(); if (root._longPressed) { root._longPressed = false; root._suppressClick = Date.now(); } }, { passive: true });
    root.addEventListener("touchcancel", cancel, { passive: true });
    root.addEventListener("contextmenu", e => { if (root._longPressed || (root._suppressClick && Date.now() - root._suppressClick < 400)) e.preventDefault(); }, true);
  };

  global.Bulk = Bulk;
})(window);
