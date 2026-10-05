/* Done archive: searchable history of finished (and cancelled) tasks. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};
  let query = "", month = "", showCancelled = false;

  const monthKey = iso => iso ? iso.slice(0, 7) : "";
  const monthLabel = key => { const [y, m] = key.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }); };

  Views.done = {
    render(panel) {
      const finished = [...Store.tasks.values()].filter(t => !Model.isActive(t)).map(t => Object.assign({ _when: t.completedAt || t.updatedAt || t.createdAt }, { t }));
      const months = [...new Set(finished.map(x => monthKey(x._when)))].filter(Boolean).sort().reverse();
      const list = finished
        .filter(x => showCancelled || x.t.status === "done")
        .filter(x => !month || monthKey(x._when) === month)
        .filter(x => Model.matches(x.t, { q: query }))
        .sort((a, b) => b._when.localeCompare(a._when));

      const wk = App.weekStart();
      const lastWk = App.addDays(-7, wk);
      const bucket = x => { const d = App.isoToDateStr(x._when); if (d >= wk) return "This week"; if (d >= lastWk) return "Last week"; return monthLabel(monthKey(x._when)); };
      const groups = [];
      list.forEach(x => { const b = bucket(x); let g = groups[groups.length - 1]; if (!g || g.label !== b) { g = { label: b, items: [] }; groups.push(g); } g.items.push(x.t); });
      const thisWeek = finished.filter(x => x.t.status === "done" && App.isoToDateStr(x._when) >= wk).length;
      const thisMonth = finished.filter(x => x.t.status === "done" && monthKey(x._when) === App.today().slice(0, 7)).length;
      const hadFocus = document.activeElement && document.activeElement.id === "doneSearch";

      panel.innerHTML = `
        <div class="page-head">
          <div><h1>Done</h1><p class="lede">${thisWeek} finished this week · ${thisMonth} this month</p></div>
          <div class="head-actions">
            <button class="btn sm ghost" type="button" data-trash>${App.icon("trash", "sm")}Recently deleted${Store.trash.size ? ` (${Store.trash.size})` : ""}</button>
            <button class="btn sm ghost" type="button" data-summary>${App.icon("review", "sm")}Monthly summary</button>
          </div>
        </div>
        <div class="toolbar">
          <div class="search"><span>${App.icon("search", "sm")}</span><input type="search" id="doneSearch" placeholder="Search finished tasks" value="${esc(query)}" autocomplete="off"></div>
          <select class="select" data-month style="width:auto;min-height:40px"><option value="">All time</option>${months.map(m => `<option value="${m}" ${m === month ? "selected" : ""}>${esc(monthLabel(m))}</option>`).join("")}</select>
          <button type="button" class="chip ${showCancelled ? "on" : ""}" data-cancelled>Include cancelled</button>
        </div>
        ${groups.length ? groups.map(g => Comp.section({ title: g.label, count: g.items.length, body: `<div class="list">${g.items.map(t => Comp.taskCard(t, { compact: true })).join("")}</div>` })).join("")
          : `<div class="empty"><div class="big">✅</div><h3>${query || month ? "Nothing matches" : "Nothing finished yet"}</h3><p>Completed tasks land here, searchable forever.</p></div>`}
      `;
      Comp.bindTasks(panel);
      const s = panel.querySelector("#doneSearch");
      s.addEventListener("input", App.debounce(() => { query = s.value; Views.done.render(panel); }, 150));
      if (hadFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
      panel.querySelector("[data-month]").onchange = e => { month = e.target.value; Views.done.render(panel); };
      panel.querySelector("[data-cancelled]").onclick = () => { showCancelled = !showCancelled; Views.done.render(panel); };
      panel.querySelector("[data-trash]").onclick = () => global.Actions.openTrash();
      panel.querySelector("[data-summary]").onclick = () => global.Exporter.monthlySummary(month || App.today().slice(0, 7));
    }
  };
})(window);
