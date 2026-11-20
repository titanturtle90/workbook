/*
 * Categories: your own list of kinds of ask (RFI, Submittal, PO…). Add, rename, reorder or
 * delete them from the side menu (Categories → pencil) or Settings. Stored in settings so the
 * list follows you between devices; a task keeps its category's key, so renaming is safe.
 */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store;
  const esc = App.esc;
  const Categories = {};

  const save = list => Store.setSetting("categories", list.map(c => ({ key: c.key, label: c.label })));
  /** Open tasks per category key. */
  Categories.counts = () => {
    const m = new Map();
    Store.tasks.forEach(t => { if (Model.isActive(t) && t.category) m.set(t.category, (m.get(t.category) || 0) + 1); });
    return m;
  };

  /** Shows the Dashboard filtered to one category (Table view, or By project if you're on it). */
  Categories.show = key => {
    const Views = global.Views;
    Views.clearTasksFilters();
    Views.setTasksFilter({ categories: [key] });
    if (Views.tasksState.mode === "today") Views.tasksState.mode = "table";
    global.Router.go("tasks");
  };

  Categories.manage = () => {
    let list = Model.categories().map(c => Object.assign({}, c));
    const body = App.el(`<div class="catman"></div>`);
    const foot = App.el(`<div style="display:contents"><button type="button" class="btn ghost" data-reset>Restore the starting list</button><span class="spacer"></span><button type="button" class="btn primary" data-done>Done</button></div>`);
    App.sheet.open({ title: "Categories", subtitle: "The kinds of ask you can tag a task with", body, foot, narrow: true });
    const counts = Categories.counts();
    const commit = () => save(list);
    const paint = () => {
      body.innerHTML = `
        <div class="catman-list">${list.map((c, i) => `<div class="catman-row" data-key="${esc(c.key)}">
          <input class="input" value="${esc(c.label)}" aria-label="Category name" autocomplete="off">
          <span class="muted catman-n" title="Open tasks">${counts.get(c.key) || ""}</span>
          <button type="button" class="icon-btn sm plain" data-up title="Move up" ${i === 0 ? "disabled" : ""}>${App.icon("up")}</button>
          <button type="button" class="icon-btn sm plain" data-down title="Move down" ${i === list.length - 1 ? "disabled" : ""}>${App.icon("down")}</button>
          <button type="button" class="icon-btn sm plain danger" data-del title="Delete">${App.icon("trash")}</button>
        </div>`).join("") || `<div class="muted" style="font-size:.88rem">No categories yet. Add your first one below.</div>`}</div>
        <form class="add-line mt-12" data-add><input class="input" name="label" placeholder="New category, e.g. Warranty" autocomplete="off"><button class="btn sm" type="submit">${App.icon("plus", "xs")}Add</button></form>`;
    };
    body.addEventListener("submit", e => {
      e.preventDefault();
      const inp = e.target.label; const label = inp.value.trim(); if (!label) return;
      if (list.some(c => c.label.toLowerCase() === label.toLowerCase())) { App.toast(`“${label}” is already on the list`); return; }
      list.push({ key: App.genId(), label }); commit(); paint();
      body.querySelector("[name=label]").focus();
    });
    body.addEventListener("change", e => {
      const row = e.target.closest("[data-key]"); if (!row || !e.target.matches("input")) return;
      const c = list.find(x => x.key === row.dataset.key); const v = e.target.value.trim();
      if (!v) { e.target.value = c.label; return; }
      c.label = v; commit();
    });
    body.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest(".catman-row")) { e.preventDefault(); e.target.blur(); } });
    body.addEventListener("click", async e => {
      const row = e.target.closest("[data-key]"); if (!row) return;
      const i = list.findIndex(x => x.key === row.dataset.key); const c = list[i];
      if (e.target.closest("[data-up]") && i > 0) { [list[i - 1], list[i]] = [list[i], list[i - 1]]; commit(); paint(); }
      else if (e.target.closest("[data-down]") && i < list.length - 1) { [list[i + 1], list[i]] = [list[i], list[i + 1]]; commit(); paint(); }
      else if (e.target.closest("[data-del]")) {
        const used = [...Store.tasks.values()].filter(t => t.category === c.key);
        if (used.length && !(await App.confirm({ title: `Delete “${c.label}”?`, text: `${App.plural(used.length, "task")} will no longer have a category.`, okLabel: "Delete", danger: true }))) return;
        list.splice(i, 1); commit();
        if (used.length) Store.saveMany("tasks", used.map(t => Object.assign(JSON.parse(JSON.stringify(t)), { category: "" })));
        paint();
      }
    });
    foot.querySelector("[data-reset]").onclick = async () => {
      if (!(await App.confirm({ title: "Restore the starting list?", text: "Adds back RFI, Submittal, PO and the rest. Categories you added stay.", okLabel: "Restore" }))) return;
      Model.DEFAULT_CATEGORIES.forEach(d => { if (!list.some(c => c.key === d.key)) list.push(Object.assign({}, d)); });
      commit(); paint();
    };
    foot.querySelector("[data-done]").onclick = () => { const a = document.activeElement; if (a && a.blur) a.blur(); App.sheet.close(); };
    paint();
  };

  global.Categories = Categories;
})(window);
