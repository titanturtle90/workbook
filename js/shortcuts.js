/* Keyboard shortcuts for desktop. Press ? in the app for the cheat sheet. */
(function (global) {
  "use strict";
  const App = global.App, Store = global.Store, Model = global.Model, Actions = global.Actions;
  const Shortcuts = {};
  let focusedId = null;

  const VIEWS = ["tasks", "people", "projects", "meetings", "done", "review"];
  const LIST = [
    ["Anywhere", [
      [["N"], "New task"], [["Shift", "N"], "New self-assigned task"], [["M"], "New meeting note"],
      [["/"], "Search tasks"], [["Ctrl", "V"], "Paste a screenshot → new task with it attached"], [["?"], "Show this cheat sheet"], [["Esc"], "Close / cancel"]
    ]],
    ["Go to", [
      [["1"], "Dashboard"], [["2"], "People"], [["3"], "Projects"], [["4"], "Meetings"], [["5"], "Done"], [["6"], "Weekly review"],
      [["T"], "Switch Today → Table → Board → Calendar"], [["["], "Collapse / expand the side menu"]
    ]],
    ["Selected task", [
      [["J"], "Next task (or ↓)"], [["K"], "Previous task (or ↑)"], [["Enter"], "Open"], [["X"], "Mark done / reopen"],
      [["S"], "Change status (then 1–8)"], [["P"], "Cycle priority"], [["D"], "Change due date"], [["Z"], "Not until… (hide from Today)"], [["V"], "Select / unselect (change several at once)"], [["F"], "Finish the next step"],
      [["L"], "Log a note"], [["Del"], "Delete"]
    ]],
    ["In a form", [
      [["Enter"], "Add (quick add, steps, notes)"], [["Ctrl", "Enter"], "Save & close"], [["↑", "↓"], "Pick from suggestions"]
    ]]
  ];

  Shortcuts.help = () => {
    const html = `<div class="kb-grid">${LIST.map(([group, rows]) => `<div class="kb-group">${group}</div>` + rows.map(([keys, label]) => `<div class="kb-row"><span>${App.esc(label)}</span><span class="keys">${keys.map(k => `<kbd>${App.esc(k)}</kbd>`).join("")}</span></div>`).join("")).join("")}</div>`;
    App.sheet.open({ title: "Keyboard shortcuts", body: html });
  };

  const typing = el => el && (el.closest("input, textarea, select, [contenteditable=true], [contenteditable='']"));
  const panel = () => document.querySelector(".panel:not([hidden])");
  const items = () => { const p = panel(); return p ? [...p.querySelectorAll("[data-task-id]")].filter(el => el.offsetParent !== null) : []; };
  const focusedEl = () => focusedId ? items().find(el => el.dataset.taskId === focusedId) : null;
  const focusedTask = () => focusedId ? Store.tasks.get(focusedId) : null;

  function setFocus(el) {
    document.querySelectorAll(".kb-focus").forEach(x => x.classList.remove("kb-focus"));
    focusedId = el ? el.dataset.taskId : null;
    if (el) { el.classList.add("kb-focus"); el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  }
  Shortcuts.focusFirst = () => { const list = items(); if (list.length) setFocus(list[0]); };
  // Re-apply the highlight after a view re-renders.
  Shortcuts.reapply = () => { if (!focusedId) return; const el = focusedEl(); if (el) el.classList.add("kb-focus"); };
  Shortcuts.clear = () => setFocus(null);

  function move(delta) {
    const list = items(); if (!list.length) return;
    const cur = list.findIndex(el => el.dataset.taskId === focusedId);
    let next = cur < 0 ? (delta > 0 ? 0 : list.length - 1) : cur + delta;
    next = Math.max(0, Math.min(list.length - 1, next));
    setFocus(list[next]);
  }

  document.addEventListener("keydown", e => {
    // Menus first: arrows, Enter, Esc, and number keys pick items.
    if (App.menu.isOpen()) {
      if (e.key === "Escape") { e.preventDefault(); App.menu.close(); return; }
      if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); App.menu.move(1); return; }
      if (e.key === "ArrowUp" || e.key === "k") { e.preventDefault(); App.menu.move(-1); return; }
      if (e.key === "Enter") { e.preventDefault(); App.menu.activate(); return; }
      if (/^[1-9]$/.test(e.key)) {
        const btns = [...document.querySelectorAll("#menu .mi")];
        const b = btns[Number(e.key) - 1];
        if (b) { e.preventDefault(); b.click(); }
        return;
      }
      return;
    }
    if (App.dialogOpen()) return;
    if (global.Bulk && global.Bulk.active && e.key === "Escape" && !App.sheet.isOpen()) { e.preventDefault(); global.Bulk.stop(); return; }

    if (App.sheet.isOpen()) {
      if (e.key === "Escape") {
        if (typing(e.target) && e.target.closest(".txt")) { e.target.blur(); return; }
        e.preventDefault(); App.sheet.close(); return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.target.closest(".qa")) { e.preventDefault(); if (document.activeElement) document.activeElement.blur(); App.sheet.close(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (typing(e.target)) return;
    if (!document.getElementById("shell") || document.getElementById("shell").hidden) return;

    const k = e.key;
    const t = focusedTask();
    const handled = () => e.preventDefault();

    if (k === "N") { handled(); global.Editor.quickAdd({ self: true }); return; }
    if (k === "n") { handled(); global.Editor.quickAdd(); return; }
    if (k === "m") { handled(); global.Meetings.newNote(); return; }
    if (k === "?") { handled(); Shortcuts.help(); return; }
    if (k === "/") { handled(); global.Router.go("tasks", { focusSearch: true }); return; }
    if (/^[1-6]$/.test(k)) { handled(); global.Router.go(VIEWS[Number(k) - 1]); return; }
    if (k === "t") { handled(); global.Router.toggleTaskMode(); return; }
    if (k === "[") { handled(); App.toggleSidebar(); return; }
    if (k === "j" || k === "ArrowDown") { handled(); move(1); return; }
    if (k === "k" || k === "ArrowUp") { handled(); move(-1); return; }
    if (k === "Escape") { setFocus(null); return; }
    if (!t) return;
    const anchor = focusedEl() && (focusedEl().querySelector("[data-act=status], .t, .title") || focusedEl());
    if (k === "Enter" || k === "o" || k === "e") { handled(); global.Editor.open(t.id); }
    else if (k === "x") { handled(); if (Model.isActive(t)) Actions.complete(t); else Actions.reopen(t); }
    else if (k === "s") { handled(); Actions.statusMenu(anchor, t, { keyboard: true }); }
    else if (k === "p") { handled(); Actions.cyclePriority(t); }
    else if (k === "d") { handled(); Actions.dueMenu(anchor, t, { keyboard: true }); }
    else if (k === "v") { handled(); global.Bulk.toggle(t.id); }
    else if (k === "z") { handled(); Actions.snoozeMenu(anchor, t, { keyboard: true }); }
    else if (k === "f") { handled(); const n = Model.nextStep(t); if (n) Actions.completeStep(t, n.id); else App.toast("No open steps on this task"); }
    else if (k === "l") { handled(); global.Editor.open(t.id, { focus: "log" }); }
    else if (k === "Delete" || k === "Backspace") { handled(); Actions.remove(t); }
  });

  global.Shortcuts = Shortcuts;
})(window);
