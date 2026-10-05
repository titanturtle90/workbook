/*
 * Components + Actions: shared task rendering (cards, pills, avatars) and the
 * mutations every view uses (complete, status, step, priority, snooze…).
 */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store;
  const esc = App.esc;

  // ======================= Actions =======================
  const Actions = {};

  Actions.logEntry = (text, auto) => ({ id: App.genId(), at: new Date().toISOString(), text, auto: !!auto });
  Actions.addLog = (t, text, auto) => { t.log = (t.log || []).concat(Actions.logEntry(text, auto)); };

  Actions.save = t => Store.save("tasks", t);
  Actions.get = id => Store.tasks.get(id);
  const copy = t => JSON.parse(JSON.stringify(t));

  Actions.complete = (task, opts) => {
    const before = copy(task);
    const t = copy(task);
    t.status = "done";
    t.completedAt = new Date().toISOString();
    Actions.addLog(t, "Marked done", true);
    let spawned = null;
    if (t.recurrence) {
      spawned = Model.newTask({
        title: t.title, details: t.details, requesterId: t.requesterId, projectId: t.projectId,
        priority: t.priority, tags: (t.tags || []).slice(), links: (t.links || []).slice(), estimate: t.estimate,
        recurrence: t.recurrence, source: t.source, status: "not_started",
        due: Model.nextOccurrence(t),
        steps: (t.steps || []).map(s => ({ id: App.genId(), text: s.text, done: false })),
        log: [Actions.logEntry("Repeating task — created when the previous one was finished", true)]
      });
      t.recurrence = ""; // the finished copy no longer repeats; the new one carries the rule
    }
    Actions.save(t);
    if (spawned) Store.save("tasks", spawned);
    if (!(opts && opts.quiet)) {
      App.toast(spawned ? `Done · next one due ${App.fmtDateLong(spawned.due)}` : "Done — nice work", {
        label: "Undo", onClick: () => { Store.save("tasks", before); if (spawned) Store.remove("tasks", spawned.id); }
      });
    }
    return spawned;
  };

  Actions.reopen = task => {
    const t = copy(task);
    t.status = "in_progress"; t.completedAt = "";
    Actions.addLog(t, "Reopened", true);
    Actions.save(t);
    App.toast("Reopened");
  };

  Actions.setStatus = (task, status) => {
    if (task.status === status) return;
    if (status === "done") return Actions.complete(task);
    const before = copy(task);
    const t = copy(task);
    const was = Model.status(t.status).label;
    t.status = status;
    if (status === "cancelled") t.completedAt = new Date().toISOString();
    else if (before.status === "done" || before.status === "cancelled") t.completedAt = "";
    if (status === "waiting") {
      t.waiting = Object.assign({ personId: "", since: "", followUp: "" }, t.waiting);
      if (!t.waiting.since) t.waiting.since = App.today();
      if (!t.waiting.followUp) t.waiting.followUp = App.addDays(Model.FOLLOW_UP_DAYS);
    }
    Actions.addLog(t, `Status: ${was} → ${Model.status(status).label}`, true);
    Actions.save(t);
    if (status === "waiting" && !t.waiting.personId) {
      App.toast(`Waiting · follow up ${App.fmtDate(t.waiting.followUp)}`, { label: "Who?", onClick: () => global.Editor.open(t.id, { focus: "waiting" }) });
    } else {
      App.toast(`Moved to ${Model.status(status).label}`, { label: "Undo", onClick: () => Store.save("tasks", before) });
    }
  };

  Actions.completeStep = (task, stepId) => {
    const t = copy(task);
    const s = (t.steps || []).find(x => x.id === stepId);
    if (!s) return;
    s.done = !s.done;
    s.doneAt = s.done ? new Date().toISOString() : "";
    if (s.done) Actions.addLog(t, `Step done: ${s.text}`, true);
    if (s.done && (t.status === "new" || t.status === "not_started")) t.status = "in_progress";
    Actions.save(t);
    if (s.done) {
      const next = Model.nextStep(t);
      App.toast(next ? `Next: ${next.text}` : "All steps done", next ? null : { label: "Mark task done", onClick: () => Actions.complete(Store.tasks.get(t.id)) });
    }
  };

  Actions.setPriority = (task, key) => { const t = copy(task); t.priority = key; Actions.save(t); };
  Actions.cyclePriority = task => {
    const order = ["low", "medium", "high"];
    const next = order[(order.indexOf(task.priority) + 1) % order.length];
    Actions.setPriority(task, next);
    App.toast(`Priority: ${Model.priority(next).label}`);
  };
  Actions.setDue = (task, due) => {
    const before = copy(task);
    const t = copy(task);
    t.due = due || "";
    if (before.due && due && before.due !== due) Actions.addLog(t, `Due date moved: ${App.fmtDate(before.due)} → ${App.fmtDate(due)}`, true);
    Actions.save(t);
    App.toast(due ? `Due ${App.relDue(due).toLowerCase()}` : "Due date cleared", { label: "Undo", onClick: () => Store.save("tasks", before) });
  };
  Actions.setFollowUp = (task, date) => {
    const t = copy(task);
    t.waiting = Object.assign({ personId: "", since: App.today(), followUp: "" }, t.waiting, { followUp: date });
    Actions.save(t);
    App.toast(`Follow up ${App.relDue(date).toLowerCase()}`);
  };

  Actions.remove = async task => {
    const ok = await App.confirm({ title: "Delete this task?", text: `"${task.title}" will be permanently deleted.`, okLabel: "Delete", danger: true });
    if (!ok) return false;
    const before = copy(task);
    Store.remove("tasks", task.id);
    App.toast("Task deleted", { label: "Undo", onClick: () => Store.save("tasks", before) });
    global.Shots.cleanupLater((before.shots || []).map(s => s.id));
    return true;
  };

  Actions.duplicate = task => {
    const t = Model.newTask(Object.assign(copy(task), {
      id: App.genId(), title: task.title + " (copy)", status: "not_started", completedAt: "",
      createdAt: new Date().toISOString(), log: [Actions.logEntry("Duplicated", true)],
      steps: (task.steps || []).map(s => ({ id: App.genId(), text: s.text, done: false }))
    }));
    Store.save("tasks", t);
    return t;
  };

  Actions.ensurePerson = name => {
    name = String(name || "").trim();
    if (!name) return "";
    if (/^me$/i.test(name)) return Model.ME;
    const found = [...Store.people.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const p = { id: App.genId(), name, role: "", email: "", notes: "", createdAt: new Date().toISOString() };
    Store.save("people", p);
    return p.id;
  };
  Actions.ensureProject = name => {
    name = String(name || "").trim();
    if (!name) return "";
    const found = [...Store.projects.values()].find(p => p.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const used = new Set([...Store.projects.values()].map(p => p.color));
    const color = Model.PROJECT_COLORS.find(c => !used.has(c)) || Model.PROJECT_COLORS[Store.projects.size % Model.PROJECT_COLORS.length];
    const p = { id: App.genId(), name, color, archived: false, createdAt: new Date().toISOString() };
    Store.save("projects", p);
    return p.id;
  };

  // ---------- menus ----------
  Actions.statusMenu = (anchor, task, opts) => {
    App.menu.open(anchor, [{ header: "Status" }].concat(Model.STATUSES.map((s, i) => ({
      label: s.label, on: task.status === s.key, k: String(i + 1),
      icon: `<span class="dot-sw" style="background:${Model.statusDot(s.key)};border-radius:50%"></span>`,
      onClick: () => Actions.setStatus(Store.tasks.get(task.id), s.key)
    }))), opts);
  };
  Actions.priorityMenu = (anchor, task, opts) => {
    App.menu.open(anchor, [{ header: "Priority" }].concat(Model.PRIORITIES.map(p => ({
      label: p.label, on: task.priority === p.key, icon: "flag",
      onClick: () => Actions.setPriority(Store.tasks.get(task.id), p.key)
    }))), opts);
  };
  Actions.dueMenu = (anchor, task, opts) => {
    const items = Comp.quickDates().map(d => ({ label: d.label, k: d.value ? App.fmtDate(d.value) : "", icon: "calendar", onClick: () => Actions.setDue(Store.tasks.get(task.id), d.value) }));
    items.push({ sep: true }, { label: "Pick a date…", icon: "edit", onClick: () => global.Editor.open(task.id, { focus: "due" }) });
    App.menu.open(anchor, [{ header: "Due date" }].concat(items), opts);
  };
  Actions.moreMenu = (anchor, task, opts) => {
    const active = Model.isActive(task);
    App.menu.open(anchor, [
      { label: "Open", icon: "edit", k: "Enter", onClick: () => global.Editor.open(task.id) },
      active ? { label: "Mark done", icon: "check", k: "X", onClick: () => Actions.complete(Store.tasks.get(task.id)) } : { label: "Reopen", icon: "undo", onClick: () => Actions.reopen(Store.tasks.get(task.id)) },
      { label: "Change status…", icon: "board", k: "S", onClick: () => Actions.statusMenu(anchor, Store.tasks.get(task.id), opts) },
      { label: "Change due date…", icon: "calendar", k: "D", onClick: () => Actions.dueMenu(anchor, Store.tasks.get(task.id), opts) },
      { label: "Cycle priority", icon: "flag", k: "P", onClick: () => Actions.cyclePriority(Store.tasks.get(task.id)) },
      { label: "Duplicate", icon: "copy", onClick: () => { const t = Actions.duplicate(Store.tasks.get(task.id)); App.toast("Duplicated", { label: "Open", onClick: () => global.Editor.open(t.id) }); } },
      { sep: true },
      { label: "Delete", icon: "trash", danger: true, k: "Del", onClick: () => Actions.remove(Store.tasks.get(task.id)) }
    ], opts);
  };

  // ======================= Components =======================
  const Comp = {};

  Comp.quickDates = () => {
    const fri = App.nextWeekday(5, true);
    return [
      { label: "Today", value: App.today() },
      { label: "Tomorrow", value: App.addDays(1) },
      { label: fri === App.today() ? "Next Friday" : "Friday", value: fri === App.today() ? App.addDays(7) : fri },
      { label: "Next Monday", value: App.nextWeekday(1) },
      { label: "In 1 week", value: App.addDays(7) },
      { label: "In 2 weeks", value: App.addDays(14) },
      { label: "No date", value: "" }
    ];
  };

  Comp.avatar = (personId, cls) => {
    if (personId === Model.ME) return `<span class="avatar me ${cls || ""}" title="Self-assigned">${App.icon("me", "xs")}</span>`;
    const p = Model.person(personId);
    if (!p) return "";
    return `<span class="avatar ${cls || ""}" style="background:${App.hashColor(p.name)}" title="${esc(p.name)}">${esc(App.initials(p.name))}</span>`;
  };
  Comp.who = (personId) => {
    if (!personId) return `<span class="muted">—</span>`;
    return `<span class="who">${Comp.avatar(personId)}${esc(Model.personName(personId) || "Unknown")}</span>`;
  };

  Comp.statusPill = (t, clickable) => {
    const s = Model.status(t.status);
    return `<span class="pill ${s.color} ${clickable ? "btnish" : ""}" ${clickable ? `data-act="status" title="Change status (S)"` : ""}>${esc(s.short || s.label)}</span>`;
  };
  Comp.prioPill = (t, clickable) => {
    const p = Model.effPriority(t);
    if (p.key === "low" && !clickable) return "";
    return `<span class="pill ${p.color} ${clickable ? "btnish" : ""}" ${clickable ? `data-act="priority" title="Priority${p.bumped ? " (raised because the due date is close)" : ""}"` : ""}>${App.icon(p.bumped ? "bolt" : "flag")}${esc(p.label)}</span>`;
  };
  Comp.duePill = (t, clickable) => {
    if (!t.due) return clickable ? `<span class="pill gray btnish" data-act="due" title="Set due date (D)">${App.icon("calendar")}Set date</span>` : "";
    const done = !Model.isActive(t);
    return `<span class="pill ${Model.dueTone(t)} ${clickable ? "btnish" : ""}" ${clickable ? `data-act="due" title="Change due date (D)"` : ""}>${App.icon("calendar")}${esc(done ? App.fmtDate(t.due) : App.relDue(t.due))}</span>`;
  };
  Comp.projectPill = projectId => {
    const p = Model.project(projectId);
    if (!p) return "";
    return `<span class="pill" title="Project"><span class="dot-sw" style="background:${esc(p.color)}"></span>${esc(p.name)}</span>`;
  };
  Comp.followPill = t => {
    if (!Model.isWaiting(t) || !t.waiting) return "";
    const who = Model.personName(t.waiting.personId);
    const due = t.waiting.followUp && t.waiting.followUp <= App.today();
    const label = (who ? `On ${who}` : "Waiting") + (t.waiting.followUp ? ` · nudge ${App.relDue(t.waiting.followUp).toLowerCase()}` : "");
    return `<span class="pill ${due ? "red" : "orange"}">${App.icon("hourglass")}${esc(label)}</span>`;
  };
  Comp.extrasPills = t => {
    let h = "";
    const sp = Model.stepProgress(t);
    if (sp.total) h += `<span class="pill gray" title="Steps done">${App.icon("check")}${sp.done}/${sp.total}</span>`;
    if (t.recurrence) h += `<span class="pill gray" title="${esc(Model.recurrence(t.recurrence).label)}">${App.icon("repeat")}</span>`;
    if (t.shots && t.shots.length) h += `<span class="pill gray btnish" data-act="shot" title="View screenshot">${App.icon("image")}${t.shots.length}</span>`;
    if (t.links && t.links.length) h += `<span class="pill gray" title="Links">${App.icon("link")}${t.links.length}</span>`;
    if (t.estimate) h += `<span class="pill gray" title="Estimate">${App.icon("clock")}${esc(fmtHours(t.estimate))}</span>`;
    return h;
  };
  const fmtHours = h => h < 1 ? `${Math.round(h * 60)}m` : `${Number(h.toFixed(1))}h`;
  Comp.fmtHours = fmtHours;
  Comp.tags = t => (t.tags || []).map(tag => `<span class="tag">#${esc(tag)}</span>`).join(" ");

  Comp.nextStepLine = (t, opts) => {
    const n = Model.nextStep(t);
    if (!Model.isActive(t)) return "";
    if (!n) return (opts && opts.hideEmpty) ? "" : `<div class="next none"><span class="arrow">${App.icon("arrow", "xs")}</span>No next step yet</div>`;
    return `<div class="next"><button type="button" class="mini-check" data-act="step" data-step="${esc(n.id)}" title="Mark this step done" aria-label="Mark step done">${App.icon("check")}</button><span>${esc(n.text)}</span></div>`;
  };

  /** A task card for lists. opts: { hideRequester, hideProject, compact } */
  Comp.taskCard = (t, opts) => {
    opts = opts || {};
    const active = Model.isActive(t);
    const prio = Model.effPriority(t);
    return `<div class="tcard ${active ? "" : "done"}" data-task-id="${esc(t.id)}" tabindex="-1" ${opts.draggable ? `draggable="true"` : ""}>
      ${active ? `<span class="prio-bar prio-${prio.key}"></span>` : ""}
      <button type="button" class="check ${active ? "" : "on"}" data-act="toggle" aria-label="${active ? "Mark done" : "Reopen"}" title="${active ? "Mark done (X)" : "Reopen"}">${App.icon("check")}</button>
      <div class="body">
        <div class="title">${esc(t.title || "Untitled")}</div>
        ${Comp.nextStepLine(t)}
        <div class="meta">
          ${opts.hideRequester ? "" : (t.requesterId ? `<span class="who">${Comp.avatar(t.requesterId)}${esc(Model.requesterName(t))}</span>` : "")}
          ${Comp.duePill(t, active)}
          ${active ? Comp.statusPill(t, true) : `<span class="pill green">${App.icon("check")}${esc(t.status === "cancelled" ? "Cancelled" : "Done " + (t.completedAt ? App.fmtIso(t.completedAt) : ""))}</span>`}
          ${active ? Comp.prioPill(t, false) : ""}
          ${opts.hideProject ? "" : Comp.projectPill(t.projectId)}
          ${active ? Comp.followPill(t) : ""}
          ${opts.compact ? "" : Comp.extrasPills(t)}
          ${opts.compact ? "" : Comp.tags(t)}
        </div>
      </div>
    </div>`;
  };

  /** Event delegation for any container holding .tcard / .trow elements. */
  Comp.bindTasks = (root) => {
    if (root._wbBound) return;
    root._wbBound = true;
    root.addEventListener("click", e => {
      const host = e.target.closest("[data-task-id]");
      if (!host || !root.contains(host)) return;
      const t = Store.tasks.get(host.dataset.taskId);
      if (!t) return;
      const actEl = e.target.closest("[data-act]");
      const act = actEl && host.contains(actEl) ? actEl.dataset.act : null;
      if (act) e.stopPropagation();
      if (act === "toggle") { if (Model.isActive(t)) Actions.complete(t); else Actions.reopen(t); return; }
      if (act === "step") { Actions.completeStep(t, actEl.dataset.step); return; }
      if (act === "status") { Actions.statusMenu(actEl, t); return; }
      if (act === "priority") { Actions.priorityMenu(actEl, t); return; }
      if (act === "due") { Actions.dueMenu(actEl, t); return; }
      if (act === "more") { Actions.moreMenu(actEl, t); return; }
      if (act === "shot") { if (t.shots && t.shots[0]) global.Shots.view(t.shots[0].id); return; }
      if (e.target.closest("a")) return;
      global.Editor.open(t.id);
    });
    root.addEventListener("contextmenu", e => {
      const host = e.target.closest("[data-task-id]");
      if (!host) return;
      const t = Store.tasks.get(host.dataset.taskId);
      if (!t) return;
      e.preventDefault();
      Actions.moreMenu({ x: e.clientX, y: e.clientY }, t);
    });
  };

  Comp.emptyInline = text => `<div class="empty-inline">${esc(text)}</div>`;

  Comp.section = ({ title, count, tone, body, id, collapsible, collapsed, right }) => `
    <section class="section ${collapsed ? "collapsed" : ""}" ${id ? `data-section="${esc(id)}"` : ""}>
      <div class="section-head ${tone || ""}">
        ${collapsible ? `<button type="button" class="collapse-btn" data-collapse="${esc(id)}">${App.icon("down", "sm")}<h2>${esc(title)}</h2></button>` : `<h2>${esc(title)}</h2>`}
        ${count != null ? `<span class="count">${count}</span>` : ""}
        ${right ? `<span class="right">${right}</span>` : ""}
      </div>
      ${collapsed ? "" : body}
    </section>`;

  global.Actions = Actions;
  global.Comp = Comp;
})(window);
