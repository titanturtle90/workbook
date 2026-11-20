/* Dashboard: Today (what needs you now), Table (sortable columns, grouping) and By project (everything grouped under each project). Table and By project share search + filters, and all three can be arranged by dragging. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp, Actions = global.Actions;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};

  const DEFAULT = { mode: "today", sort: "manual", dir: "asc", group: "", filters: { requesters: [], projects: [], categories: [], statuses: [], priorities: [], self: null, due: "", hideSnoozed: false } };
  const state = Object.assign({}, DEFAULT, App.lsGet("wb:tasksView", {}));
  state.filters = Object.assign({}, DEFAULT.filters, state.filters || {});
  const dashStart = App.lsGet("wb:dashStart", "last"); // Settings → "Dashboard opens on"
  if (dashStart !== "last") state.mode = dashStart;
  if (state.mode === "board") state.mode = "table"; // the Board view was removed
  if (state.mode === "calendar") state.mode = "projects"; // the Calendar view was replaced by By project
  if (dashStart === "calendar") App.lsSet("wb:dashStart", "projects");
  if (!App.lsGet("wb:manualSortOn", false)) { state.sort = "manual"; state.dir = "asc"; App.lsSet("wb:manualSortOn", true); } // drag-to-arrange became the default
  delete state.filters.tags; // tags were retired
  if (!Model.AUTO_RAISE_PRIORITY) state.filters.priorities = (state.filters.priorities || []).filter(k => k !== "urgent"); // Urgent only existed as an automatic level
  if (dashStart === "board") App.lsSet("wb:dashStart", "table");
  let query = "";
  let searchOpen = false; // phones: the search bar shows only when asked for (top-bar search icon or /)
  const persist = () => App.lsSet("wb:tasksView", { mode: state.mode, sort: state.sort, dir: state.dir, group: state.group, filters: state.filters });

  Views.tasksState = state;
  Views.setTasksFilter = (patch) => { Object.assign(state.filters, patch); persist(); };
  Views.clearTasksFilters = () => { state.filters = JSON.parse(JSON.stringify(DEFAULT.filters)); query = ""; persist(); };

  const filtered = () => [...Store.tasks.values()].filter(t => Model.isActive(t) && Model.matches(t, Object.assign({ q: query }, state.filters)));

  // ---------- filter chips ----------
  function filterChip(label, values, nameOf, key) {
    const on = values.length > 0;
    const text = on ? `${label}: ${nameOf(values[0])}${values.length > 1 ? ` +${values.length - 1}` : ""}` : label;
    return `<button type="button" class="chip ${on ? "on" : ""}" data-filter="${key}">${esc(text)}${App.icon("down", "xs")}</button>`;
  }
  function toggleIn(arr, v) { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); }
  const FILTER_KEYS = [
    ["requesters", "Who asked"], ["projects", "Project"], ["categories", "Category"], ["statuses", "Status"],
    ["priorities", "Priority"], ["due", "Due"]
  ];
  const DUE_CHOICES = [["overdue", "Overdue"], ["today", "Due today"], ["week", "Due this week"], ["next", "Next 2 weeks"], ["later", "Later"], ["none", "No due date"]];

  /** Choices for one filter: [{ value, label, count, swatch, on }]. */
  function filterOptions(key) {
    const f = state.filters;
    const counts = new Map();
    const active = [...Store.tasks.values()].filter(Model.isActive);
    if (key === "requesters") {
      active.forEach(t => counts.set(t.requesterId || "", (counts.get(t.requesterId || "") || 0) + 1));
      return [...counts.keys()].sort((a, b) => (a === Model.ME ? -1 : b === Model.ME ? 1 : !a ? 1 : !b ? -1 : Model.personName(a).localeCompare(Model.personName(b))))
        .map(id => ({ value: id, label: id ? Model.personName(id) || "Unknown" : "No requester", count: counts.get(id), on: f.requesters.includes(id) }));
    }
    if (key === "projects") {
      active.forEach(t => counts.set(t.projectId || "", (counts.get(t.projectId || "") || 0) + 1));
      return [...counts.keys()].sort((a, b) => Model.projectOrderKey(Model.project(a)).localeCompare(Model.projectOrderKey(Model.project(b))))
        .map(id => ({ value: id, label: id ? Model.projectName(id) || "Unknown" : "No project", swatch: id ? Model.project(id)?.color || "#999" : "", count: counts.get(id), on: f.projects.includes(id) }));
    }
    if (key === "statuses") return Model.ACTIVE_STATUSES.map(st => ({ value: st.key, label: st.label, dot: Model.statusDot(st.key), on: f.statuses.includes(st.key) }));
    if (key === "priorities") return (Model.AUTO_RAISE_PRIORITY ? [{ key: "urgent", label: "Urgent" }] : []).concat(Model.PRIORITIES).map(p => ({ value: p.key, label: p.label, dot: Model.priorityDot(p.key), on: f.priorities.includes(p.key) }));
    if (key === "due") return DUE_CHOICES.map(([v, l]) => ({ value: v, label: l, on: f.due === v }));
    if (key === "categories") {
      active.forEach(t => counts.set(t.category || "", (counts.get(t.category || "") || 0) + 1));
      return Model.categories().map(c => c.key).concat("").filter(k => counts.has(k) || f.categories.includes(k))
        .map(k => ({ value: k, label: k ? Model.categoryLabel(k) : "No category", count: counts.get(k) || 0, on: f.categories.includes(k) }));
    }
    return [];
  }
  function toggleFilter(key, value) {
    const f = state.filters;
    if (key === "due") f.due = f.due === value ? "" : value;
    else toggleIn(f[key], value);
    persist();
  }
  function clearFilter(key) { const f = state.filters; if (Array.isArray(f[key])) f[key] = []; else f[key] = ""; persist(); }
  const activeFilterCount = () => { const f = state.filters; return f.requesters.length + f.projects.length + f.categories.length + f.statuses.length + f.priorities.length + (f.due ? 1 : 0) + (f.self === true ? 1 : 0) + (f.hideSnoozed ? 1 : 0); };

  function openFilterMenu(btn, key, rerender) {
    const opts = filterOptions(key);
    let items = opts.map(o => ({
      label: o.label, k: o.count != null ? String(o.count) : "", on: o.on,
      icon: o.swatch ? `<span class="dot-sw" style="background:${esc(o.swatch)}"></span>` : o.dot ? `<span class="dot-sw" style="background:${o.dot};border-radius:50%"></span>` : null,
      onClick: () => { toggleFilter(key, o.value); rerender(); }
    }));
    if (key === "due") items.unshift({ label: "Any time", on: !state.filters.due, onClick: () => { clearFilter("due"); rerender(); } });
    if (!items.length) items = [{ label: "Nothing to filter", onClick: () => {} }];
    if (opts.some(o => o.on)) items.push({ sep: true }, { label: "Clear this filter", icon: "x", onClick: () => { clearFilter(key); rerender(); } });
    App.menu.open(btn, items);
  }

  // ---------- phones: one "Sort & filter" sheet instead of a row of controls ----------
  function openMobileFilters(rerender) {
    const body = App.el(`<div class="mf"></div>`);
    const foot = App.el(`<div style="display:contents"><button type="button" class="btn ghost" data-clear-all>Clear all</button><button type="button" class="btn primary" data-done></button></div>`);
    App.sheet.open({ title: "Sort & filter", body, foot });
    const paint = () => {
      const f = state.filters;
      const chip = (key, o) => `<button type="button" class="chip ${o.on ? "on" : ""}" data-k="${key}" data-v="${esc(o.value)}">${o.swatch ? `<span class="swatch" style="background:${esc(o.swatch)}"></span>` : o.dot ? `<span class="swatch" style="background:${o.dot};border-radius:50%"></span>` : ""}${esc(o.label)}${o.count != null ? ` <span class="cnt">${o.count}</span>` : ""}</button>`;
      body.innerHTML = `
        <div class="mf-row">
          <label class="field grow"><span class="label">Sort by</span><select class="select" data-sort>${Model.SORTS.map(o => `<option value="${o.key}" ${state.sort === o.key ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
          ${state.mode === "table" ? `<label class="field grow"><span class="label">Group by</span><select class="select" data-group>${Model.GROUPS.map(g => `<option value="${g.key}" ${state.group === g.key ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></label>` : ""}
        </div>
        <button type="button" class="btn block ghost mt-4" data-start-select>${App.icon("check", "sm")}Select several tasks to change at once</button>
        <div class="mf-sec"><div class="label">Show</div><div class="chips"><button type="button" class="chip ${f.self === true ? "on" : ""}" data-self>${App.icon("me", "xs")}Only self-assigned</button><button type="button" class="chip ${f.hideSnoozed ? "on" : ""}" data-hide-snoozed>${App.icon("moon", "xs")}Hide snoozed</button></div></div>
        ${FILTER_KEYS.map(([key, label]) => {
          const opts = filterOptions(key);
          if (!opts.length) return "";
          return `<div class="mf-sec"><div class="label">${esc(label)}${opts.some(o => o.on) ? ` <button type="button" class="mf-clear" data-clear="${key}">Clear</button>` : ""}</div><div class="chips">${opts.map(o => chip(key, o)).join("")}</div></div>`;
        }).join("")}`;
      const n = filtered().length;
      foot.querySelector("[data-done]").textContent = `Show ${App.plural(n, "task")}`;
      foot.querySelector("[data-clear-all]").disabled = !activeFilterCount();
    };
    body.addEventListener("click", e => {
      if (e.target.closest("[data-start-select]")) { App.sheet.close(); global.Bulk.start(); App.toast("Tap tasks to select them"); return; }
      const c = e.target.closest("[data-k]");
      if (c) { toggleFilter(c.dataset.k, c.dataset.v); }
      else if (e.target.closest("[data-self]")) { state.filters.self = state.filters.self === true ? null : true; persist(); }
      else if (e.target.closest("[data-hide-snoozed]")) { state.filters.hideSnoozed = !state.filters.hideSnoozed; persist(); }
      else if (e.target.closest("[data-clear]")) { clearFilter(e.target.closest("[data-clear]").dataset.clear); }
      else return;
      paint(); rerender();
    });
    body.addEventListener("change", e => {
      if (e.target.matches("[data-sort]")) { state.sort = e.target.value; state.dir = "asc"; }
      else if (e.target.matches("[data-group]")) state.group = e.target.value;
      else return;
      persist(); rerender();
    });
    foot.querySelector("[data-clear-all]").onclick = () => { const q = query; Views.clearTasksFilters(); query = q; paint(); rerender(); };
    foot.querySelector("[data-done]").onclick = () => App.sheet.close();
    paint();
  }

  /** Phones: the filters you've turned on, as removable chips (nothing shows when none are on). */
  function activeChipsHtml() {
    const f = state.filters;
    const out = [];
    FILTER_KEYS.forEach(([key, label]) => filterOptions(key).filter(o => o.on).forEach(o => out.push(`<button type="button" class="chip on" data-rm-k="${key}" data-rm-v="${esc(o.value)}">${esc(o.label)}${App.icon("x", "xs")}</button>`)));
    if (f.self === true) out.unshift(`<button type="button" class="chip on" data-rm-self>Self-assigned${App.icon("x", "xs")}</button>`);
    if (f.hideSnoozed) out.unshift(`<button type="button" class="chip on" data-rm-snoozed>Hiding snoozed${App.icon("x", "xs")}</button>`);
    return out.length ? `<div class="m-active chips">${out.join("")}<button type="button" class="btn xs ghost" data-clear>Clear</button></div>` : "";
  }

  // ---------- table ----------
  const COLS = [
    { key: "project", label: "Project", cls: "c-proj" },
    { key: "category", label: "Category", cls: "c-cat" },
    { key: "title", label: "Task", cls: "c-title" },
    { key: "requester", label: "Who asked", cls: "c-who" },
    { key: "next", label: "Next step", cls: "c-next" },
    { key: "due", label: "Due", cls: "c-due" },
    { key: "status", label: "Status", cls: "c-status" },
    { key: "priority", label: "Priority", cls: "c-prio" }
  ];
  const canDrag = () => state.sort === "manual";
  const dragHint = () => canDrag() ? "" : `<div class="drag-hint">${App.icon("grip", "xs")}To drag tasks into your own order, choose <button type="button" class="linkish" data-manual>Sort: My order</button></div>`;
  function rowHtml(t, cols) {
    const n = Model.nextStep(t);
    const cell = {
      project: () => `<td class="c-proj">${Comp.projectTag(t.projectId) || `<span class="muted">—</span>`}</td>`,
      title: () => `<td class="c-title"><div class="t">${esc(t.title || "Untitled")}</div><div class="tags">${Comp.snoozePill(t, true)}${Comp.followPill(t)}${Comp.extrasPills(t)}</div></td>`,
      category: () => `<td class="c-cat">${Comp.categoryTag(t) || `<span class="muted">—</span>`}</td>`,
      requester: () => `<td class="c-who">${Comp.who(t.requesterId)}</td>`,
      next: () => `<td class="c-next">${n ? `<div class="n"><button type="button" class="mini-check" data-act="step" data-step="${esc(n.id)}" title="Mark step done">${App.icon("check")}</button><span>${esc(n.text)}</span></div>` : `<span class="muted">—</span>`}</td>`,
      due: () => `<td class="c-due">${Comp.duePill(t, true)}</td>`,
      status: () => `<td class="c-status">${Comp.statusPill(t, true)}</td>`,
      priority: () => `<td class="c-prio">${Comp.prioPill(t, true)}</td>`
    };
    return `<tr class="trow ${Model.isSnoozed(t) ? "snoozed" : ""}${Comp.selCls(t.id)}" data-task-id="${esc(t.id)}" tabindex="-1">
      ${canDrag() ? `<td class="c-drag">${Comp.dragHandle()}</td>` : ""}
      <td class="c-check"><button type="button" class="check" data-act="toggle" title="Mark done (X)" aria-label="Mark done">${App.icon("check")}</button></td>
      ${cols.map(c => cell[c.key]()).join("")}
      <td style="width:36px;padding-left:0"><button type="button" class="icon-btn sm plain" data-act="more" aria-label="More">${App.icon("more")}</button></td>
    </tr>`;
  }
  /** groups: [{ label, color?, dot?, tasks }]; opts.hideProject drops the Project column (By project view). */
  function tableHtml(groups, opts) {
    opts = opts || {};
    const cols = COLS.filter(c => !(opts.hideProject && c.key === "project"));
    const span = cols.length + 2 + (canDrag() ? 1 : 0);
    const head = `<tr>${canDrag() ? `<th class="c-drag"></th>` : ""}<th class="c-check"></th>${cols.map(c => `<th class="${c.cls} sortable ${state.sort === c.key ? "sorted" : ""}" data-sort="${c.key}">${c.label} ${state.sort === c.key ? App.icon(state.dir === "desc" ? "up" : "down") : ""}</th>`).join("")}<th></th></tr>`;
    const bodies = groups.map(g => `<tbody ${canDrag() ? "data-sortable" : ""}>${g.label && !opts.noGroupRows ? `<tr class="group-row ${g.snoozed ? "snoozed-row" : ""}"><td colspan="${span}">${g.snoozed ? App.icon("moon", "sm") : ""}${g.color ? `<span class="dot-sw" style="background:${esc(g.color)};margin-right:6px"></span>` : g.dot ? `<span class="dot-sw" style="background:${g.dot};border-radius:50%;margin-right:6px"></span>` : ""}${esc(g.label)}<span class="count">${g.tasks.length}</span></td></tr>` : ""}${g.tasks.map(t => rowHtml(t, cols)).join("")}</tbody>`).join("");
    return `<div class="table-wrap ${opts.flush ? "" : "mt-12"}"><table class="ttable ${opts.hideProject ? "no-proj" : ""}"><thead>${head}</thead>${bodies}</table></div>`;
  }
  const cardsHtml = (tasks, opts) => `<div class="list" ${canDrag() ? "data-sortable" : ""}>${tasks.map(t => Comp.taskCard(t, Object.assign({ drag: canDrag() }, opts))).join("")}</div>`;
  function renderTable(tasks) {
    // Snoozed tasks ("not until" a later date) drop to their own section at the bottom, soonest first.
    const snoozed = tasks.filter(Model.isSnoozed).sort((a, b) => a.startDate.localeCompare(b.startDate) || Model.manualCompare(a, b));
    const groups = Model.group(tasks.filter(t => !Model.isSnoozed(t)), state.group).filter(g => g.tasks.length);
    if (snoozed.length) groups.push({ key: "__snoozed", label: "Snoozed (not until later)", snoozed: true, tasks: snoozed });
    if (!App.isDesktop()) {
      return dragHint() + groups.map(g => (g.label ? `<div class="section-head mt-16"><h2>${g.color ? `<span class="dot-sw" style="background:${esc(g.color)};margin-right:6px"></span>` : ""}${g.snoozed ? App.icon("moon", "sm") : ""}${esc(g.label)}</h2><span class="count">${g.tasks.length}</span></div>` : `<div class="mt-12"></div>`) + cardsHtml(g.tasks)).join("");
    }
    return dragHint() + tableHtml(groups);
  }

  // ---------- by project ----------
  function renderProjects(tasks) {
    const groups = Model.group(tasks, "project");
    const desktop = App.isDesktop();
    return dragHint() + groups.map(g => {
      const p = g.key ? Model.project(g.key) : null;
      const head = `<div class="proj-head" style="--pc:${esc(p ? p.color : "var(--text-3)")}">
        <span class="bar"></span>
        <div class="grow">
          <h2>${p ? `<a href="#projects/${encodeURIComponent(p.id)}">${esc(p.name)}</a>` : "No project"}</h2>
          ${p && p.description ? `<div class="pdesc">${esc(p.description)}</div>` : ""}
        </div>
        <span class="count">${g.tasks.length}</span>
        <button type="button" class="icon-btn sm plain" data-add-to="${esc(g.key)}" title="Add a task to ${esc(p ? p.name : "no project")}" aria-label="Add task">${App.icon("plus")}</button>
      </div>`;
      return `<section class="proj-group">${head}${desktop ? tableHtml([{ label: "", tasks: g.tasks }], { hideProject: true, flush: true }) : cardsHtml(g.tasks, { hideProject: true })}</section>`;
    }).join("");
  }

  // ---------- render ----------
  Views.tasks = {
    render(panel, params) {
      const f = state.filters;
      const tasks = filtered().sort(Model.comparator(state.sort, state.dir));
      const anyFilter = query || f.requesters.length || f.projects.length || f.categories.length || f.statuses.length || f.priorities.length || f.self !== null || f.due || f.hideSnoozed;
      const hadFocus = document.activeElement && document.activeElement.id === "taskSearch";
      const caret = hadFocus ? document.activeElement.selectionStart : null;
      const rerender = () => Views.tasks.render(panel);
      const isToday = state.mode === "today";
      const mobile = !App.isDesktop();
      const nActive = activeFilterCount();
      const activeCount = [...Store.tasks.values()].filter(Model.isActive).length;

      const head = `
        <div class="page-head">
          <div><h1>Dashboard</h1><p class="lede">${isToday ? `${esc(Views.today.greeting())} · ${App.plural(activeCount, "open task")}` : `${App.plural(tasks.length, "open task")}${anyFilter ? " match" : ""}`}</p></div>
          ${mobile && !isToday ? `<button class="icon-btn filter-btn ${nActive ? "on" : ""}" type="button" data-mobile-filters aria-label="Sort and filter${nActive ? ` (${nActive} on)` : ""}">${App.icon("sliders", "sm")}${nActive ? `<span class="badge">${nActive}</span>` : ""}</button>` : ""}
          <div class="head-actions">
            ${mobile ? "" : `<button class="btn sm ghost" type="button" data-select title="Select several tasks to change at once (V)">${App.icon("check", "sm")}Select</button>`}
            <button class="btn sm ghost" type="button" data-new-self title="New self-assigned task (Shift+N)" aria-label="New self-assigned task">${App.icon("me", "sm")}<span class="wide-label">Self-assigned</span></button>
            <div class="seg view-seg" role="tablist" title="Switch view (T)">
              <button type="button" data-mode="today" class="${isToday ? "on" : ""}">${App.icon("sun", "sm")}<span>Today</span></button>
              <button type="button" data-mode="table" class="${state.mode === "table" ? "on" : ""}">${App.icon(App.isDesktop() ? "table" : "list", "sm")}<span>${App.isDesktop() ? "Table" : "List"}</span></button>
              <button type="button" data-mode="projects" class="${state.mode === "projects" ? "on" : ""}">${App.icon("folder", "sm")}<span>${App.isDesktop() ? "By project" : "Projects"}</span></button>
            </div>
            <button class="btn sm primary" type="button" data-new>${App.icon("plus", "sm")}New</button>
          </div>
        </div>`;

      const bindHead = () => {
        panel.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { state.mode = b.dataset.mode; persist(); rerender(); });
        panel.querySelector("[data-new]").onclick = () => global.Editor.quickAdd(isToday ? {} : { self: f.self === true, requesterId: f.requesters.length === 1 ? f.requesters[0] : "", projectId: f.projects.length === 1 ? f.projects[0] : "" });
        const ns = panel.querySelector("[data-new-self]"); if (ns) ns.onclick = () => global.Editor.quickAdd({ self: true });
        const sel = panel.querySelector("[data-select]"); if (sel) sel.onclick = () => (global.Bulk.active ? global.Bulk.stop() : global.Bulk.start());
      };

      if (isToday) {
        panel.innerHTML = head + `<div data-today></div>`;
        Comp.bindTasks(panel);
        Comp.bindReorder(panel);
        bindHead();
        Views.today.renderInto(panel.querySelector("[data-today]"), rerender);
        return;
      }

      const searchBox = `<div class="search"><span>${App.icon("search", "sm")}</span><input type="search" id="taskSearch" placeholder="Search tasks, people, steps, notes…" value="${esc(query)}" autocomplete="off">${App.isDesktop() ? "<kbd>/</kbd>" : `<button type="button" class="icon-btn sm plain" data-close-search aria-label="Close search">${App.icon("x")}</button>`}</div>`;
      const controls = mobile
        ? `${searchOpen || query ? `<div class="toolbar">${searchBox}</div>` : ""}${activeChipsHtml()}<div class="m-gap"></div>`
        : `<div class="toolbar">
          ${searchBox}
          ${`<label class="sort-ctl">Sort <select class="select" data-sort-select>${Model.SORTS.map(s => `<option value="${s.key}" ${state.sort === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>`}
          ${state.mode === "table" ? `<label class="sort-ctl">Group <select class="select" data-group-select>${Model.GROUPS.map(g => `<option value="${g.key}" ${state.group === g.key ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></label>` : ""}
        </div>
        <div class="filter-row">
          ${filterChip("Who asked", f.requesters, id => id ? Model.personName(id) || "?" : "None", "requesters")}
          ${filterChip("Project", f.projects, id => id ? Model.projectName(id) || "?" : "None", "projects")}
          ${filterChip("Category", f.categories, k => k ? Model.categoryLabel(k) : "None", "categories")}
          ${state.mode === "table" ? filterChip("Status", f.statuses, k => Model.status(k).short || Model.status(k).label, "statuses") : ""}
          ${filterChip("Priority", f.priorities, k => k === "urgent" ? "Urgent" : Model.priority(k).label, "priorities")}
          ${filterChip("Due", f.due ? [f.due] : [], v => ({ overdue: "Overdue", today: "Today", week: "This week", next: "Next 2 wks", later: "Later", none: "None" }[v]), "due")}
          <button type="button" class="chip ${f.self === true ? "on" : ""}" data-self>${App.icon("me", "xs")}Self-assigned</button>
          <button type="button" class="chip ${f.hideSnoozed ? "on" : ""}" data-hide-snoozed title="Hide tasks with a future “not until” date">${App.icon("moon", "xs")}Hide snoozed</button>
          ${anyFilter ? `<button type="button" class="btn xs ghost" data-clear>${App.icon("x", "xs")}Clear all</button>` : ""}
        </div>`;

      panel.innerHTML = head + controls + `
        ${!tasks.length ? "" : state.mode === "projects" ? renderProjects(tasks) : renderTable(tasks)}
        ${tasks.length ? "" :
          `<div class="empty"><div class="big">${anyFilter ? "🔍" : "🗂️"}</div><h3>${anyFilter ? "No matching tasks" : "No open tasks"}</h3><p>${anyFilter ? "Try clearing a filter." : "Press N to add one."}</p></div>`}
      `;
      Comp.bindTasks(panel);
      Comp.bindReorder(panel);
      bindHead();
      const search = panel.querySelector("#taskSearch");
      if (search) {
        search.addEventListener("input", App.debounce(() => { query = search.value; rerender(); }, 120));
        search.addEventListener("keydown", e => { if (e.key === "Escape") { search.value = ""; query = ""; searchOpen = false; search.blur(); rerender(); } if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); search.blur(); global.Shortcuts && global.Shortcuts.focusFirst(); } });
        if (hadFocus) { search.focus(); try { search.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
      }
      const closeSearch = panel.querySelector("[data-close-search]");
      if (closeSearch) closeSearch.onclick = () => { query = ""; searchOpen = false; rerender(); };
      const sortSel = panel.querySelector("[data-sort-select]"); if (sortSel) sortSel.onchange = e => { state.sort = e.target.value; state.dir = "asc"; persist(); rerender(); };
      const g = panel.querySelector("[data-group-select]"); if (g) g.onchange = e => { state.group = e.target.value; persist(); rerender(); };
      panel.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => openFilterMenu(b, b.dataset.filter, rerender));
      const selfChip = panel.querySelector("[data-self]"); if (selfChip) selfChip.onclick = () => { f.self = f.self === true ? null : true; persist(); rerender(); };
      const mf = panel.querySelector("[data-mobile-filters]"); if (mf) mf.onclick = () => openMobileFilters(rerender);
      panel.querySelectorAll("[data-rm-k]").forEach(b => b.onclick = () => { toggleFilter(b.dataset.rmK, b.dataset.rmV); rerender(); });
      const hs = panel.querySelector(".filter-row [data-hide-snoozed]"); if (hs) hs.onclick = () => { f.hideSnoozed = !f.hideSnoozed; persist(); rerender(); };
      const rmSn = panel.querySelector("[data-rm-snoozed]"); if (rmSn) rmSn.onclick = () => { f.hideSnoozed = false; persist(); rerender(); };
      const rmSelf = panel.querySelector("[data-rm-self]"); if (rmSelf) rmSelf.onclick = () => { f.self = null; persist(); rerender(); };
      const clr = panel.querySelector("[data-clear]"); if (clr) clr.onclick = () => { Views.clearTasksFilters(); rerender(); };
      panel.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
        if (state.sort === th.dataset.sort) state.dir = state.dir === "asc" ? "desc" : "asc"; else { state.sort = th.dataset.sort; state.dir = "asc"; }
        persist(); rerender();
      });
      panel.querySelectorAll("[data-add-to]").forEach(b => b.onclick = () => global.Editor.quickAdd({ projectId: b.dataset.addTo }));
      const man = panel.querySelector("[data-manual]"); if (man) man.onclick = () => { state.sort = "manual"; state.dir = "asc"; persist(); rerender(); };
    },
    focusSearch(panel) {
      searchOpen = true;
      if (state.mode === "today") state.mode = "table"; // search lives in Table / By project
      persist(); Views.tasks.render(panel);
      const s = panel.querySelector("#taskSearch"); if (s) { s.focus(); s.select(); }
    },
    /** Switch to a mode, or cycle Today → Table → By project. */
    setMode(panel, mode) {
      const order = ["today", "table", "projects"];
      state.mode = mode || order[(order.indexOf(state.mode) + 1) % order.length];
      persist(); Views.tasks.render(panel);
    }
  };
})(window);
