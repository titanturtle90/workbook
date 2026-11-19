/*
 * Templates: reusable starting points for asks that come up again and again
 * (e.g. "Monthly report" with the same five steps). Save one from any task,
 * manage them in Settings, and pick one at the top of the New task form.
 */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Actions = global.Actions, Editor = global.Editor;
  const esc = App.esc;
  const Templates = {};

  Templates.list = () => [...Store.templates.values()].sort((a, b) => (b.usedAt || b.createdAt || "").localeCompare(a.usedAt || a.createdAt || "") || a.name.localeCompare(b.name));

  /** Template → fields for a new task. */
  Templates.toTaskFields = tpl => ({
    title: tpl.title || tpl.name,
    requesterId: tpl.requesterId && (tpl.requesterId === Model.ME || Store.people.has(tpl.requesterId)) ? tpl.requesterId : "",
    projectId: tpl.projectId && Store.projects.has(tpl.projectId) ? tpl.projectId : "",
    priority: tpl.priority || "medium",
    steps: (tpl.steps || []).filter(Boolean).map(text => ({ id: App.genId(), text, done: false })),
    category: tpl.category || "",
    details: tpl.details || ""
  });
  Templates.markUsed = tpl => Store.save("templates", Object.assign({}, tpl, { usedAt: new Date().toISOString() }));

  /** Opens the template editor. `from` may be a task (Save as template) or an existing template. */
  Templates.edit = (tpl, fromTask, onDone) => {
    const t = tpl ? Object.assign({}, tpl) : {
      id: App.genId(), createdAt: new Date().toISOString(),
      name: fromTask ? fromTask.title : "", title: fromTask ? fromTask.title : "",
      steps: fromTask ? (fromTask.steps || []).map(s => s.text) : [],
      requesterId: fromTask ? fromTask.requesterId || "" : "", projectId: fromTask ? fromTask.projectId || "" : "",
      priority: fromTask ? fromTask.priority : "medium", category: fromTask ? fromTask.category || "" : "",
      details: fromTask ? fromTask.details || "" : ""
    };
    const body = App.el(`<form autocomplete="off">
      <div class="field"><label>Template name</label><input class="input" name="name" required value="${esc(t.name)}" placeholder="e.g. Monthly report"></div>
      <div class="field mt-12"><label>Task title</label><input class="input" name="title" value="${esc(t.title)}" placeholder="What the task will be called"></div>
      <div class="field mt-12"><label>Steps <span class="muted">(one per line, in order)</span></label>
        <textarea class="input" name="steps" rows="5" placeholder="Pull the numbers&#10;Draft the summary&#10;Send to Dana">${esc((t.steps || []).join("\n"))}</textarea></div>
      <div class="form-grid mt-12">
        <div class="field"><label>Who asked <span class="muted">(optional)</span></label><div class="ac"><input class="input" name="requester" placeholder="Name, or “Me”" value="${esc(Model.personName(t.requesterId))}"></div></div>
        <div class="field"><label>Project <span class="muted">(optional)</span></label><div class="ac"><input class="input" name="project" placeholder="Pick or create" value="${esc(Model.projectName(t.projectId))}"></div></div>
        <div class="field"><label>Priority</label><div class="seg full" data-prio>${Model.PRIORITIES.slice().reverse().map(p => `<button type="button" data-v="${p.key}" class="${(t.priority || "medium") === p.key ? "on" : ""}">${p.label}</button>`).join("")}</div></div>
        <div class="field"><label>Category</label><select class="select" name="category"><option value="">—</option>${Model.CATEGORIES.map(c => `<option value="${c.key}" ${t.category === c.key ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
        <div class="field span-2"><label>Details</label><textarea class="input" name="details" rows="3">${esc(t.details || "")}</textarea></div>
      </div>
      <button type="submit" hidden></button>
    </form>`);
    const foot = App.el(`<div style="display:contents">${tpl ? `<button type="button" class="btn danger" data-del>${App.icon("trash", "sm")}Delete</button>` : ""}<span class="spacer"></span><button type="button" class="btn primary" data-save>Save template</button></div>`);
    App.sheet.open({ title: tpl ? "Edit template" : fromTask ? "Save as template" : "New template", subtitle: "Pick it at the top of the New task form", body, foot });
    const q = n => body.querySelector(`[name=${n}]`);
    Editor.bindPersonInput(q("requester"), true);
    Editor.bindProjectInput(q("project"));
    let prio = t.priority || "medium";
    body.querySelectorAll("[data-prio] button").forEach(b => b.onclick = () => { prio = b.dataset.v; body.querySelectorAll("[data-prio] button").forEach(x => x.classList.toggle("on", x === b)); });
    const save = () => {
      t.name = q("name").value.trim();
      if (!t.name) { q("name").focus(); return; }
      t.title = q("title").value.trim();
      t.steps = q("steps").value.split("\n").map(x => x.trim()).filter(Boolean);
      t.requesterId = Actions.ensurePerson(q("requester").value);
      t.projectId = Actions.ensureProject(q("project").value);
      t.priority = prio;
      t.category = q("category").value;
      delete t.estimate; delete t.recurrence; delete t.tags;
      t.details = q("details").value.trim();
      Store.save("templates", t);
      App.sheet.close();
      App.toast(`Template “${t.name}” saved`);
      if (onDone) setTimeout(onDone, 60);
    };
    body.addEventListener("submit", e => { e.preventDefault(); save(); });
    foot.querySelector("[data-save]").onclick = save;
    const del = foot.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      if (!(await App.confirm({ title: `Delete “${t.name}”?`, text: "Tasks already made from it aren't affected.", okLabel: "Delete", danger: true }))) return;
      Store.remove("templates", t.id); App.sheet.close(); App.toast("Template deleted");
      if (onDone) setTimeout(onDone, 60);
    };
    setTimeout(() => q("name").focus(), 80);
  };

  /** Settings → Task templates. */
  Templates.manage = () => {
    const body = App.el(`<div></div>`);
    const foot = App.el(`<div style="display:contents"><span class="spacer"></span><button type="button" class="btn primary" data-new>${App.icon("plus", "sm")}New template</button></div>`);
    App.sheet.open({ title: "Task templates", subtitle: "Reusable checklists for asks that come up often", body, foot });
    const list = Templates.list();
    body.innerHTML = list.length ? list.map(t => `<button type="button" class="mrow" data-tpl="${esc(t.id)}">${App.icon("template")}<div class="grow"><div>${esc(t.name)}</div>
        <div class="sub">${esc([App.plural((t.steps || []).length, "step"), Model.projectName(t.projectId), Model.categoryLabel(t.category)].filter(Boolean).join(" · "))}</div></div>${App.icon("edit", "sm")}</button>`).join("")
      : `<div class="empty"><div class="big">📋</div><h3>No templates yet</h3><p>Create one here, or open any task and choose <b>Save as template</b>.</p></div>`;
    body.querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => Templates.edit(Store.templates.get(b.dataset.tpl), null, Templates.manage));
    foot.querySelector("[data-new]").onclick = () => Templates.edit(null, null, Templates.manage);
  };

  global.Templates = Templates;
})(window);
