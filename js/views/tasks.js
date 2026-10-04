/* All tasks: Table (sortable columns, grouping) and Board (drag between statuses), with shared search + filters. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp, Actions = global.Actions;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};

  const DEFAULT = { mode: "table", sort: "smart", dir: "asc", group: "", filters: { requesters: [], projects: [], statuses: [], priorities: [], tags: [], self: null, due: "" } };
  const state = Object.assign({}, DEFAULT, App.lsGet("wb:tasksView", {}));
  state.filters = Object.assign({}, DEFAULT.filters, state.filters || {});
  let query = "";
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
  function openFilterMenu(btn, key, rerender) {
    const f = state.filters;
    let items = [];
    const counts = new Map();
    const active = [...Store.tasks.values()].filter(Model.isActive);
    if (key === "requesters") {
      active.forEach(t => counts.set(t.requesterId || "", (counts.get(t.requesterId || "") || 0) + 1));
      const ids = [...counts.keys()].sort((a, b) => (a === Model.ME ? -1 : b === Model.ME ? 1 : !a ? 1 : !b ? -1 : Model.personName(a).localeCompare(Model.personName(b))));
      items = ids.map(id => ({ label: id ? Model.personName(id) || "Unknown" : "No requester", k: String(counts.get(id)), on: f.requesters.includes(id), onClick: () => { toggleIn(f.requesters, id); persist(); rerender(); } }));
    } else if (key === "projects") {
      active.forEach(t => counts.set(t.projectId || "", (counts.get(t.projectId || "") || 0) + 1));
      const ids = [...counts.keys()].sort((a, b) => !a ? 1 : !b ? -1 : Model.projectName(a).localeCompare(Model.projectName(b)));
      items = ids.map(id => ({ label: id ? Model.projectName(id) || "Unknown" : "No project", icon: id ? `<span class="dot-sw" style="background:${esc(Model.project(id)?.color || "#999")}"></span>` : null, k: String(counts.get(id)), on: f.projects.includes(id), onClick: () => { toggleIn(f.projects, id); persist(); rerender(); } }));
    } else if (key === "statuses") {
      items = Model.ACTIVE_STATUSES.map(s => ({ label: s.label, icon: `<span class="dot-sw" style="background:${Model.statusDot(s.key)};border-radius:50%"></span>`, on: f.statuses.includes(s.key), onClick: () => { toggleIn(f.statuses, s.key); persist(); rerender(); } }));
    } else if (key === "priorities") {
      items = [{ key: "urgent", label: "Urgent" }].concat(Model.PRIORITIES).map(p => ({ label: p.label, icon: "flag", on: f.priorities.includes(p.key), onClick: () => { toggleIn(f.priorities, p.key); persist(); rerender(); } }));
    } else if (key === "due") {
      items = [["", "Any time"], ["overdue", "Overdue"], ["today", "Due today"], ["week", "Due this week"], ["next", "Next 2 weeks"], ["later", "Later"], ["none", "No due date"]]
        .map(([v, l]) => ({ label: l, on: f.due === v, onClick: () => { f.due = v; persist(); rerender(); } }));
    } else if (key === "tags") {
      const tags = Model.allTags();
      items = tags.length ? tags.map(tag => ({ label: "#" + tag, on: f.tags.includes(tag), onClick: () => { toggleIn(f.tags, tag); persist(); rerender(); } })) : [{ label: "No tags yet", onClick: () => {} }];
    }
    if (items.some(i => i.on)) items.push({ sep: true }, { label: "Clear this filter", icon: "x", onClick: () => { if (Array.isArray(f[key])) f[key] = []; else f[key] = ""; persist(); rerender(); } });
    App.menu.open(btn, items);
  }

  // ---------- table ----------
  const COLS = [
    { key: "title", label: "The ask", cls: "c-title" },
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
  function renderBoard(tasks) {
    const smart = Model.comparator("smart");
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const recentDone = [...Store.tasks.values()].filter(t => t.status === "done" && (t.completedAt || "") >= weekAgo && Model.matches(t, Object.assign({ q: query }, state.filters, { statuses: [] })));
    const cols = Model.ACTIVE_STATUSES.filter(s => !state.filters.statuses.length || state.filters.statuses.includes(s.key)).map(s => {
      const list = tasks.filter(t => t.status === s.key).sort(smart);
      return `<div class="bcol" data-status="${s.key}">
        <div class="bcol-head"><span class="dot-sw" style="background:${Model.statusDot(s.key)}"></span>${esc(s.label)}<span class="count">${list.length}</span>
          <button type="button" class="icon-btn sm plain" style="margin-left:auto" data-add-status="${s.key}" title="Add task here">${App.icon("plus")}</button></div>
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
        if (t && t.status !== col.dataset.status) Actions.setStatus(t, col.dataset.status);
      });
    });
    panel.querySelectorAll("[data-add-status]").forEach(b => b.onclick = () => global.Editor.quickAdd({ status: b.dataset.addStatus }));
  }

  // ---------- render ----------
  Views.tasks = {
    render(panel, params) {
      if (params && params.focusSearch) params.focusSearch = false;
      const f = state.filters;
      const tasks = filtered().sort(Model.comparator(state.sort, state.dir));
      const anyFilter = query || f.requesters.length || f.projects.length || f.statuses.length || f.priorities.length || f.tags.length || f.self !== null || f.due;
      const hadFocus = document.activeElement && document.activeElement.id === "taskSearch";
      const caret = hadFocus ? document.activeElement.selectionStart : null;

      panel.innerHTML = `
        <div class="page-head">
          <div><h1>All tasks</h1><p class="lede">${App.plural(tasks.length, "open task")}${anyFilter ? " match" : ""}</p></div>
          <div class="head-actions">
            <div class="seg" role="tablist">
              <button type="button" data-mode="table" class="${state.mode === "table" ? "on" : ""}">${App.icon(App.isDesktop() ? "table" : "list", "sm")}${App.isDesktop() ? "Table" : "List"}</button>
              <button type="button" data-mode="board" class="${state.mode === "board" ? "on" : ""}">${App.icon("board", "sm")}Board</button>
            </div>
            <button class="btn sm primary" type="button" data-new>${App.icon("plus", "sm")}New</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search"><span>${App.icon("search", "sm")}</span><input type="search" id="taskSearch" placeholder="Search asks, people, steps, notes…" value="${esc(query)}" autocomplete="off">${App.isDesktop() ? "<kbd>/</kbd>" : ""}</div>
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
        </div>
        ${tasks.length || state.mode === "board" ? (state.mode === "board" ? renderBoard(tasks) : renderTable(tasks)) :
          `<div class="empty"><div class="big">${anyFilter ? "🔍" : "🗂️"}</div><h3>${anyFilter ? "No matching tasks" : "No open tasks"}</h3><p>${anyFilter ? "Try clearing a filter." : "Press N to add one."}</p></div>`}
      `;
      const rerender = () => Views.tasks.render(panel);
      Comp.bindTasks(panel);
      const search = panel.querySelector("#taskSearch");
      search.addEventListener("input", App.debounce(() => { query = search.value; rerender(); }, 120));
      search.addEventListener("keydown", e => { if (e.key === "Escape") { search.value = ""; query = ""; search.blur(); rerender(); } if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); search.blur(); global.Shortcuts && global.Shortcuts.focusFirst(); } });
      if (hadFocus) { search.focus(); try { search.setSelectionRange(caret, caret); } catch (e) { /* ignore */ } }
      panel.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => { state.mode = b.dataset.mode; persist(); rerender(); });
      panel.querySelector("[data-new]").onclick = () => global.Editor.quickAdd({ self: f.self === true, requesterId: f.requesters.length === 1 ? f.requesters[0] : "", projectId: f.projects.length === 1 ? f.projects[0] : "" });
      panel.querySelector("[data-sort-select]").onchange = e => { state.sort = e.target.value; state.dir = "asc"; persist(); rerender(); };
      const g = panel.querySelector("[data-group-select]"); if (g) g.onchange = e => { state.group = e.target.value; persist(); rerender(); };
      panel.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => openFilterMenu(b, b.dataset.filter, rerender));
      panel.querySelector("[data-self]").onclick = () => { f.self = f.self === true ? null : true; persist(); rerender(); };
      const clr = panel.querySelector("[data-clear]"); if (clr) clr.onclick = () => { Views.clearTasksFilters(); rerender(); };
      panel.querySelectorAll("th[data-sort]").forEach(th => th.onclick = () => {
        if (state.sort === th.dataset.sort) state.dir = state.dir === "asc" ? "desc" : "asc"; else { state.sort = th.dataset.sort; state.dir = "asc"; }
        persist(); rerender();
      });
      if (state.mode === "board") bindBoard(panel);
    },
    focusSearch(panel) { const s = panel.querySelector("#taskSearch"); if (s) { s.focus(); s.select(); } },
    setMode(panel, mode) { state.mode = mode || (state.mode === "table" ? "board" : "table"); persist(); Views.tasks.render(panel); }
  };
})(window);
