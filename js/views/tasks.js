/* Dashboard: Today (what needs you now), Table (sortable columns, grouping) and Board (drag between statuses). Table and Board share search + filters. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp, Actions = global.Actions;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};

  const DEFAULT = { mode: "today", sort: "smart", dir: "asc", group: "", filters: { requesters: [], projects: [], statuses: [], priorities: [], tags: [], self: null, due: "" } };
  const state = Object.assign({}, DEFAULT, App.lsGet("wb:tasksView", {}));
  state.filters = Object.assign({}, DEFAULT.filters, state.filters || {});
  const dashStart = App.lsGet("wb:dashStart", "last"); // Settings → "Dashboard opens on"
  if (dashStart !== "last") state.mode = dashStart;
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
    ["requesters", "Who asked"], ["projects", "Project"], ["statuses", "Status"],
    ["priorities", "Priority"], ["due", "Due"], ["tags", "Tag"]
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
      return [...counts.keys()].sort((a, b) => !a ? 1 : !b ? -1 : Model.projectName(a).localeCompare(Model.projectName(b)))
        .map(id => ({ value: id, label: id ? Model.projectName(id) || "Unknown" : "No project", swatch: id ? Model.project(id)?.color || "#999" : "", count: counts.get(id), on: f.projects.includes(id) }));
    }
    if (key === "statuses") return Model.ACTIVE_STATUSES.map(st => ({ value: st.key, label: st.label, dot: Model.statusDot(st.key), on: f.statuses.includes(st.key) }));
    if (key === "priorities") return [{ key: "urgent", label: "Urgent" }].concat(Model.PRIORITIES).map(p => ({ value: p.key, label: p.label, on: f.priorities.includes(p.key) }));
    if (key === "due") return DUE_CHOICES.map(([v, l]) => ({ value: v, label: l, on: f.due === v }));
    if (key === "tags") return Model.allTags().map(tag => ({ value: tag, label: "#" + tag, on: f.tags.includes(tag) }));
    return [];
  }
  function toggleFilter(key, value) {
    const f = state.filters;
    if (key === "due") f.due = f.due === value ? "" : value;
    else toggleIn(f[key], value);
    persist();
  }
  function clearFilter(key) { const f = state.filters; if (Array.isArray(f[key])) f[key] = []; else f[key] = ""; persist(); }
  const activeFilterCount = () => { const f = state.filters; return f.requesters.length + f.projects.length + f.statuses.length + f.priorities.length + f.tags.length + (f.due ? 1 : 0) + (f.self === true ? 1 : 0); };

  function openFilterMenu(btn, key, rerender) {
    const opts = filterOptions(key);
    let items = opts.map(o => ({
      label: o.label, k: o.count != null ? String(o.count) : "", on: o.on,
      icon: o.swatch ? `<span class="dot-sw" style="background:${esc(o.swatch)}"></span>` : o.dot ? `<span class="dot-sw" style="background:${o.dot};border-radius:50%"></span>` : key === "priorities" ? "flag" : null,
      onClick: () => { toggleFilter(key, o.value); rerender(); }
    }));
    if (key === "due") items.unshift({ label: "Any time", on: !state.filters.due, onClick: () => { clearFilter("due"); rerender(); } });
    if (!items.length) items = [{ label: key === "tags" ? "No tags yet" : "Nothing to filter", onClick: () => {} }];
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
      const chip = (key, o) => `<button type="button" class="chip ${o.on ? "on" : ""}" data-k="${key}" data-v="${esc(o.value)}">${o.swatch ? `<span class="swatch" style="background:${esc(o.swatch)}"></span>` : ""}${esc(o.label)}${o.count != null ? ` <span class="cnt">${o.count}</span>` : ""}</button>`;
      body.innerHTML = `
        <div class="mf-row">
          <label class="field grow"><span class="label">Sort by</span><select class="select" data-sort>${Model.SORTS.map(o => `<option value="${o.key}" ${state.sort === o.key ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
          ${state.mode === "table" ? `<label class="field grow"><span class="label">Group by</span><select class="select" data-group>${Model.GROUPS.map(g => `<option value="${g.key}" ${state.group === g.key ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></label>` : ""}
        </div>
        <div class="mf-sec"><div class="label">Show</div><div class="chips"><button type="button" class="chip ${f.self === true ? "on" : ""}" data-self>${App.icon("me", "xs")}Only self-assigned</button></div></div>
        ${FILTER_KEYS.filter(([key]) => !(key === "statuses" && state.mode === "board")).map(([key, label]) => {
          const opts = filterOptions(key);
          if (!opts.length) return "";
          return `<div class="mf-sec"><div class="label">${esc(label)}${opts.some(o => o.on) ? ` <button type="button" class="mf-clear" data-clear="${key}">Clear</button>` : ""}</div><div class="chips">${opts.map(o => chip(key, o)).join("")}</div></div>`;
        }).join("")}`;
      const n = filtered().length;
      foot.querySelector("[data-done]").textContent = `Show ${App.plural(n, "task")}`;
      foot.querySelector("[data-clear-all]").disabled = !activeFilterCount();
    };
    body.addEventListener("click", e => {
      const c = e.target.closest("[data-k]");
      if (c) { toggleFilter(c.dataset.k, c.dataset.v); }
      else if (e.target.closest("[data-self]")) { state.filters.self = state.filters.self === true ? null : true; persist(); }
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
    return out.length ? `<div class="m-active chips">${out.join("")}<button type="button" class="btn xs ghost" data-clear>Clear</button></div>` : "";
  }

  // ---------- table ----------
  const COLS = [
    { key: "title", label: "Task", cls: "c-title" },
    { key: "requester", label: "Who asked", cls: "c-who" },
    { key: "next", label: "Next step", cls: "c-next" },
    { key: "due", label: "Due", cls: "c-due" },
    { key: "project", label: "Project", cls: "c-proj" },
    { key: "status", label: "Status", cls: "c-status" },
    { key: "priority", label: "Priority", cls: "c-prio" }
  ];
  function rowHtml(t) {
    const n = Model.nextStep(t);
    return `<tr class="trow" data-task-id="${esc(t.id)}" tabindex="-1">
      <td class="c-check"><button type="button" class="check" data-act="toggle" title="Mark done (X)" aria-label="Mark done">${App.icon("check")}</button></td>
      <td class="c-title"><div class="t">${esc(t.title || "Untitled")}</div><div class="tags">${Comp.followPill(t)}${Comp.extrasPills(t)}${Comp.tags(t)}</div></td>
      <td class="c-who">${Comp.who(t.requesterId)}</td>
      <td class="c-next">${n ? `<div class="n"><button type="button" class="mini-check" data-act="step" data-step="${esc(n.id)}" title="Mark step done">${App.icon("check")}</button><span>${esc(n.text)}</span></div>` : `<span class="muted">—</span>`}</td>
      <td class="c-due">${Comp.duePill(t, true)}</td>
      <td class="c-proj">${Comp.projectPill(t.projectId) || `<span class="muted">—</span>`}</td>
      <td class="c-status">${Comp.statusPill(t, true)}</td>
      <td class="c-prio">${Comp.prioPill(t, true)}</td>
      <td style="width:36px;padding-left:0"><button type="button" class="icon-btn sm plain" data-act="more" aria-label="More">${App.icon("more")}</button></td>
    </tr>`;
  }
  function renderTable(tasks) {
    const groups = Model.group(tasks, state.group);
    if (!App.isDesktop()) {
      return groups.map(g => (g.label ? `<div class="section-head mt-16"><h2>${g.color ? `<span class="dot-sw" style="background:${esc(g.color)};margin-right:6px"></span>` : ""}${esc(g.label)}</h2><span class="count">${g.tasks.length}</span></div>` : "") +
        `<div class="list ${g.label ? "" : "mt-12"}">${g.tasks.map(t => Comp.taskCard(t)).join("")}</div>`).join("");
    }
    const head = `<tr><th class="c-check"></th>${COLS.map(c => `<th class="${c.cls} sortable ${state.sort === c.key ? "sorted" : ""}" data-sort="${c.key}">${c.label} ${state.sort === c.key ? App.icon(state.dir === "desc" ? "up" : "down") : ""}</th>`).join("")}<th></th></tr>`;
    const bodyRows = groups.map(g => (g.label ? `<tr class="group-row"><td colspan="${COLS.length + 2}">${g.color ? `<span class="dot-sw" style="background:${esc(g.color)};margin-right:6px"></span>` : g.dot ? `<span class="dot-sw" style="background:${g.dot};border-radius:50%;margin-right:6px"></span>` : ""}${esc(g.label)}<span class="count">${g.tasks.length}</span></td></tr>` : "") + g.tasks.map(rowHtml).join("")).join("");
    return `<div class="table-wrap mt-12"><table class="ttable"><thead>${head}</thead><tbody>${bodyRows}</tbody></table></div>`;
  }

  // ---------- board ----------
  // Waiting and Blocked share a column; cards keep their own status pill, and a drop moves a card to "Waiting".
  const BOARD_COLUMNS = [
    { keys: ["new"], drop: "new", label: "New" },
    { keys: ["not_started"], drop: "not_started", label: "Not Started" },
    { keys: ["in_progress"], drop: "in_progress", label: "In Progress" },
    { keys: ["waiting", "blocked"], drop: "waiting", label: "Waiting / Blocked" },
    { keys: ["in_review"], drop: "in_review", label: "In Review" }
  ];
  function renderBoard(tasks) {
    const smart = Model.comparator("smart");
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentDone = [...Store.tasks.values()].filter(t => t.status === "done" && (t.completedAt || "") >= weekAgo && Model.matches(t, Object.assign({ q: query }, state.filters, { statuses: [] })));
    const cols = BOARD_COLUMNS.filter(c => !state.filters.statuses.length || c.keys.some(k => state.filters.statuses.includes(k))).map(c => {
      const list = tasks.filter(t => c.keys.includes(t.status)).sort(smart);
      return `<div class="bcol" data-status="${c.drop}" data-keys="${c.keys.join(" ")}">
        <div class="bcol-head"><span class="dot-sw" style="background:${Model.statusDot(c.drop)}"></span>${esc(c.label)}<span class="count">${list.length}</span>
          <button type="button" class="icon-btn sm plain" style="margin-left:auto" data-add-status="${c.drop}" title="Add task here">${App.icon("plus")}</button></div>
        ${list.map(t => Comp.taskCard(t, { draggable: App.isDesktop(), compact: true })).join("")}
      </div>`;
    });
    cols.push(`<div class="bcol" data-status="done">
      <div class="bcol-head"><span class="dot-sw" style="background:var(--green)"></span>Done this week<span class="count">${recentDone.length}</span></div>
      ${recentDone.sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).slice(0, 15).map(t => Comp.taskCard(t, { compact: true })).join("")}
      ${App.isDesktop() ? `<div class="drop-done">Drop a card here to mark it done</div>` : ""}
    </div>`);
    return `<div class="board mt-12">${cols.join("")}</div>`;
  }
  function bindBoard(panel) {
    let dragId = null;
    panel.querySelectorAll(".tcard[draggable=true]").forEach(card => {
      card.addEventListener("dragstart", e => { dragId = card.dataset.taskId; card.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch (err) { /* ignore */ } });
      card.addEventListener("dragend", () => { card.classList.remove("dragging"); panel.querySelectorAll(".drop-hover").forEach(c => c.classList.remove("drop-hover")); });
    });
    panel.querySelectorAll(".bcol").forEach(col => {
      col.addEventListener("dragover", e => { if (!dragId) return; e.preventDefault(); col.classList.add("drop-hover"); });
      col.addEventListener("dragleave", e => { if (!col.contains(e.relatedTarget)) col.classList.remove("drop-hover"); });
      col.addEventListener("drop", e => {
        e.preventDefault(); col.classList.remove("drop-hover");
        const t = Store.tasks.get(dragId); dragId = null;
        const keys = (col.dataset.keys || col.dataset.status).split(" ");
        if (t && !keys.includes(t.status)) Actions.setStatus(t, col.dataset.status);
      });
    });
    panel.querySelectorAll("[data-add-status]").forEach(b => b.onclick = () => global.Editor.quickAdd({ status: b.dataset.addStatus }));
  }

  // ---------- render ----------
  Views.tasks = {
    render(panel, params) {
      const f = state.filters;
      const tasks = filtered().sort(Model.comparator(state.sort, state.dir));
      const anyFilter = query || f.requesters.length || f.projects.length || f.statuses.length || f.priorities.length || f.tags.length || f.self !== null || f.due;
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
          <div class="head-actions">
            <button class="btn sm ghost" type="button" data-new-self title="New self-assigned task (Shift+N)" aria-label="New self-assigned task">${App.icon("me", "sm")}<span class="wide-label">Self-assigned</span></button>
            <div class="seg" role="tablist" title="Switch view (T)">
              <button type="button" data-mode="today" class="${isToday ? "on" : ""}">${App.icon("sun", "sm")}Today</button>
              <button type="button" data-mode="table" class="${state.mode === "table" ? "on" : ""}">${App.icon(App.isDesktop() ? "table" : "list", "sm")}${App.isDesktop() ? "Table" : "List"}</button>
              <button type="button" data-mode="board" class="${state.mode === "board" ? "on" : ""}">${App.icon("board", "sm")}Board</button>
            </div>
            ${mobile && !isToday ? `<button class="icon-btn filter-btn ${nActive ? "on" : ""}" type="button" data-mobile-filters aria-label="Sort and filter${nActive ? ` (${nActive} on)` : ""}">${App.icon("sliders", "sm")}${nActive ? `<span class="badge">${nActive}</span>` : ""}</button>` : ""}
            <button class="btn sm primary" type="button" data-new>${App.icon("plus", "sm")}New</button>
          </div>
        </div>`;

      const bindHead = () => {
        panel.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { state.mode = b.dataset.mode; persist(); rerender(); });
        panel.querySelector("[data-new]").onclick = () => global.Editor.quickAdd(isToday ? {} : { self: f.self === true, requesterId: f.requesters.length === 1 ? f.requesters[0] : "", projectId: f.projects.length === 1 ? f.projects[0] : "" });
        const ns = panel.querySelector("[data-new-self]"); if (ns) ns.onclick = () => global.Editor.quickAdd({ self: true });
      };

      if (isToday) {
        panel.innerHTML = head + `<div data-today></div>`;
        Comp.bindTasks(panel);
        bindHead();
        Views.today.renderInto(panel.querySelector("[data-today]"), rerender);
        return;
      }

      const searchBox = `<div class="search"><span>${App.icon("search", "sm")}</span><input type="search" id="taskSearch" placeholder="Search tasks, people, steps, notes…" value="${esc(query)}" autocomplete="off">${App.isDesktop() ? "<kbd>/</kbd>" : `<button type="button" class="icon-btn sm plain" data-close-search aria-label="Close search">${App.icon("x")}</button>`}</div>`;
      const controls = mobile
        ? `${searchOpen || query ? `<div class="toolbar">${searchBox}</div>` : ""}${activeChipsHtml()}<div class="m-gap"></div>`
        : `<div class="toolbar">
          ${searchBox}
          <label class="sort-ctl">Sort <select class="select" data-sort-select>${Model.SORTS.map(s => `<option value="${s.key}" ${state.sort === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label>
          ${state.mode === "table" ? `<label class="sort-ctl">Group <select class="select" data-group-select>${Model.GROUPS.map(g => `<option value="${g.key}" ${state.group === g.key ? "selected" : ""}>${esc(g.label)}</option>`).join("")}</select></label>` : ""}
        </div>
        <div class="filter-row">
          ${filterChip("Who asked", f.requesters, id => id ? Model.personName(id) || "?" : "None", "requesters")}
          ${filterChip("Project", f.projects, id => id ? Model.projectName(id) || "?" : "None", "projects")}
          ${state.mode === "table" ? filterChip("Status", f.statuses, k => Model.status(k).short || Model.status(k).label, "statuses") : ""}
          ${filterChip("Priority", f.priorities, k => k === "urgent" ? "Urgent" : Model.priority(k).label, "priorities")}
          ${filterChip("Due", f.due ? [f.due] : [], v => ({ overdue: "Overdue", today: "Today", week: "This week", next: "Next 2 wks", later: "Later", none: "None" }[v]), "due")}
          ${filterChip("Tag", f.tags, v => "#" + v, "tags")}
          <button type="button" class="chip ${f.self === true ? "on" : ""}" data-self>${App.icon("me", "xs")}Self-assigned</button>
          ${anyFilter ? `<button type="button" class="btn xs ghost" data-clear>${App.icon("x", "xs")}Clear all</button>` : ""}
        </div>`;

      panel.innerHTML = head + controls + `
        ${tasks.length || state.mode === "board" ? (state.mode === "board" ? renderBoard(tasks) : renderTable(tasks)) :
          `<div class="empty"><div class="big">${anyFilter ? "🔍" : "🗂️"}</div><h3>${anyFilter ? "No matching tasks" : "No open tasks"}</h3><p>${anyFilter ? "Try clearing a filter." : "Press N to add one."}</p></div>`}
      `;
      Comp.bindTasks(panel);
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
      const rmSelf = panel.querySelector("[data-rm-self]"); if (rmSelf) rmSelf.onclick = () => { f.self = null; persist(); rerender(); };
      const clr = panel.querySelector("[data-clear]"); if (clr) clr.onclick = () => { Views.clearTasksFilters(); rerender(); };
      panel.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
        if (state.sort === th.dataset.sort) state.dir = state.dir === "asc" ? "desc" : "asc"; else { state.sort = th.dataset.sort; state.dir = "asc"; }
        persist(); rerender();
      });
      if (state.mode === "board") bindBoard(panel);
    },
    focusSearch(panel) {
      searchOpen = true;
      if (state.mode === "today") state.mode = "table"; // search lives in Table/Board
      persist(); Views.tasks.render(panel);
      const s = panel.querySelector("#taskSearch"); if (s) { s.focus(); s.select(); }
    },
    /** Switch to a mode, or cycle Today → Table → Board. */
    setMode(panel, mode) {
      const order = ["today", "table", "board"];
      state.mode = mode || order[(order.indexOf(state.mode) + 1) % order.length];
      persist(); Views.tasks.render(panel);
    }
  };
})(window);
