/* Projects: colored labels with progress, and a page per project. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};
  let showArchived = false;

  function statsFor(id) {
    const tasks = [...Store.tasks.values()].filter(t => t.projectId === id && t.status !== "cancelled");
    const open = tasks.filter(Model.isActive);
    const nextDue = open.filter(t => t.due).map(t => t.due).sort()[0] || "";
    return { total: tasks.length, done: tasks.length - open.length, open: open.length, overdue: open.filter(t => t.due && t.due < App.today()).length, nextDue };
  }

  Views.editProject = function (project) {
    const p = project ? Object.assign({}, project) : { id: App.genId(), name: "", color: Model.PROJECT_COLORS[Store.projects.size % Model.PROJECT_COLORS.length], archived: false, createdAt: new Date().toISOString() };
    const body = App.el(`<form autocomplete="off">
      <div class="field"><label>Name</label><input class="input" name="name" required value="${esc(p.name)}"></div>
      <div class="field mt-16"><label>Short description <span class="muted">(optional)</span></label>
        <textarea class="input" name="description" rows="3" maxlength="400" placeholder="What is this project, and what does done look like?">${esc(p.description || "")}</textarea></div>
      <div class="field mt-16"><label>Photo <span class="muted">(optional)</span></label>
        <div data-photo-preview></div><div data-photo-drop></div></div>
      <div class="field mt-16"><label>Color</label><div class="color-pick">${Model.PROJECT_COLORS.map(c => `<button type="button" data-c="${c}" class="${p.color === c ? "on" : ""}" style="background:${c}" aria-label="Color ${c}"></button>`).join("")}</div></div>
      <button type="submit" hidden></button></form>`);
    const foot = App.el(`<div style="display:contents">
      ${project ? `<button type="button" class="btn danger" data-del>${App.icon("trash", "sm")}Delete</button><button type="button" class="btn ghost" data-arch>${App.icon("archive", "sm")}${p.archived ? "Unarchive" : "Archive"}</button>` : ""}
      <span class="spacer"></span><button type="button" class="btn primary" data-save>Save</button></div>`);
    App.sheet.open({ title: project ? "Edit project" : "New project", body, foot, narrow: true });
    body.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { p.color = b.dataset.c; body.querySelectorAll("[data-c]").forEach(x => x.classList.toggle("on", x === b)); });

    // photo: one per project; a new pick replaces the old one when you save
    const oldPhoto = p.photo ? p.photo.id : "";
    let pendingPhoto = null;   // prepared image waiting to be saved
    let photoRemoved = false;
    const preview = body.querySelector("[data-photo-preview]");
    const paintPhoto = () => {
      const item = pendingPhoto || (!photoRemoved && p.photo ? { id: p.photo.id } : null);
      if (!item) { preview.innerHTML = ""; return; }
      preview.innerHTML = `<div class="shots"></div>`;
      global.Shots.renderStrip(preview.firstElementChild, [item], { onRemove: () => { pendingPhoto = null; photoRemoved = true; paintPhoto(); } });
      preview.querySelector(".shot").classList.add("wide");
    };
    const setPhoto = async files => {
      try { pendingPhoto = (await global.Shots.prepare(files.slice(0, 1)))[0]; photoRemoved = false; paintPhoto(); }
      catch (err) { App.toast(err.message || "Couldn't add that photo"); }
    };
    global.Shots.dropZone(body.querySelector("[data-photo-drop]"), setPhoto, { single: true, label: "photo" });
    global.Shots.onPaste(body, setPhoto);
    paintPhoto();

    let saving = false;
    const save = async () => {
      if (saving) return;
      p.name = body.querySelector("[name=name]").value.trim();
      if (!p.name) { body.querySelector("[name=name]").focus(); return; }
      p.description = body.querySelector("[name=description]").value.trim();
      saving = true;
      if (pendingPhoto) {
        try { p.photo = await global.Shots.save(pendingPhoto); }
        catch (err) { App.toast(err.message || "Couldn't save the photo"); saving = false; return; }
      } else if (photoRemoved) p.photo = null;
      Store.save("projects", p);
      if (oldPhoto && (!p.photo || p.photo.id !== oldPhoto)) global.Shots.cleanupLater([oldPhoto], 0);
      App.sheet.close();
    };
    body.addEventListener("submit", e => { e.preventDefault(); save(); });
    foot.querySelector("[data-save]").onclick = save;
    const arch = foot.querySelector("[data-arch]"); if (arch) arch.onclick = () => { p.archived = !p.archived; Store.save("projects", p); App.sheet.close(); App.toast(p.archived ? "Project archived" : "Project restored"); };
    const del = foot.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      const n = [...Store.tasks.values()].filter(t => t.projectId === p.id).length;
      if (!(await App.confirm({ title: `Delete “${p.name}”?`, text: n ? `${App.plural(n, "task")} will stay, just without a project.` : "", okLabel: "Delete", danger: true }))) return;
      Store.remove("projects", p.id); App.sheet.close(); location.hash = "#projects";
      if (p.photo) global.Shots.cleanupLater([p.photo.id], 0);
    };
    setTimeout(() => body.querySelector("[name=name]").focus(), 80);
  };

  // Same colors as task due dates: red overdue, orange today, yellow tomorrow.
  const dueTone = d => { const n = App.daysUntil(d); return n < 0 ? "red" : n === 0 ? "orange" : n === 1 ? "yellow" : "gray"; };

  function card(p) {
    const s = statsFor(p.id);
    const pct = s.total ? Math.round(100 * s.done / s.total) : 0;
    return `<button type="button" class="pcard ${p.photo ? "has-cover" : ""}" data-project="${esc(p.id)}">
      ${p.photo ? `<div class="pcover" data-img="${esc(p.photo.id)}"></div>` : ""}
      <div class="proj-head"><span class="sw" style="background:${esc(p.color)}"></span><span class="name grow">${esc(p.name)}</span><span class="muted" style="font-size:.8rem">${pct}%</span></div>
      ${p.description ? `<div class="pdesc">${esc(p.description)}</div>` : ""}
      <div class="progress"><div style="width:${pct}%;background:${esc(p.color)}"></div></div>
      <div class="nums"><span><b>${s.open}</b> open</span><span><b>${s.done}</b> done</span>${s.overdue ? `<span class="alert"><b>${s.overdue}</b> overdue</span>` : ""}</div>
      ${s.nextDue ? `<div class="next-due"><span class="pill ${dueTone(s.nextDue)}">${App.icon("calendar")}Next due ${esc(App.relDueLower(s.nextDue))}</span></div>` : ""}
    </button>`;
  }

  function renderList(panel) {
    const all = [...Store.projects.values()].sort((a, b) => statsFor(b.id).open - statsFor(a.id).open || a.name.localeCompare(b.name));
    const active = all.filter(p => !p.archived), archived = all.filter(p => p.archived);
    const unassigned = [...Store.tasks.values()].filter(t => Model.isActive(t) && !t.projectId).length;
    panel.innerHTML = `
      <div class="page-head">
        <div><h1>Projects</h1><p class="lede">${App.plural(active.length, "active project")}${unassigned ? ` · ${unassigned} open task${unassigned === 1 ? "" : "s"} without a project` : ""}</p></div>
        <div class="head-actions"><button class="btn sm primary" type="button" data-add>${App.icon("plus", "sm")}New project</button></div>
      </div>
      ${active.length ? `<div class="grid-cards">${active.map(card).join("")}</div>` : `<div class="empty"><h3>No projects yet</h3><p>Create one here, or type a new project name when adding a task.</p></div>`}
      ${archived.length ? `<div class="section"><div class="section-head"><button type="button" class="collapse-btn" data-arch-toggle>${App.icon(showArchived ? "down" : "right", "sm")}<h2>Archived</h2></button><span class="count">${archived.length}</span></div>${showArchived ? `<div class="grid-cards">${archived.map(card).join("")}</div>` : ""}</div>` : ""}
    `;
    global.Shots.fillImages(panel);
    panel.querySelector("[data-add]").onclick = () => Views.editProject(null);
    panel.querySelectorAll("[data-project]").forEach(b => b.onclick = () => { location.hash = "#projects/" + b.dataset.project; });
    const at = panel.querySelector("[data-arch-toggle]"); if (at) at.onclick = () => { showArchived = !showArchived; renderList(panel); };
  }

  function renderDetail(panel, id) {
    const p = Store.projects.get(id);
    if (!p) { panel.innerHTML = `<a class="back-link" href="#projects">${App.icon("back", "sm")}Projects</a><div class="empty"><h3>Project not found</h3></div>`; return; }
    const s = statsFor(id);
    const pct = s.total ? Math.round(100 * s.done / s.total) : 0;
    const tasks = [...Store.tasks.values()].filter(t => t.projectId === id);
    const open = tasks.filter(Model.isActive).sort(Model.comparator("smart"));
    const groups = Model.group(open, "status");
    const done = tasks.filter(t => !Model.isActive(t)).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).slice(0, 20);
    const hours = open.reduce((sum, t) => sum + (t.estimate || 0), 0);
    panel.innerHTML = `
      <a class="back-link" href="#projects">${App.icon("back", "sm")}Projects</a>
      ${p.photo ? `<button type="button" class="pbanner" data-img="${esc(p.photo.id)}" data-view-photo aria-label="View project photo"></button>` : ""}
      <div class="detail-head">
        <span class="sw" style="width:18px;height:18px;border-radius:5px;background:${esc(p.color)}"></span>
        <div class="grow"><h1>${esc(p.name)}</h1><p class="lede muted">${s.done} of ${s.total} done${hours ? ` · ≈ ${Comp.fmtHours(hours)} left` : ""}${p.archived ? " · archived" : ""}</p></div>
        <button class="btn sm ghost" type="button" data-edit>${App.icon("edit", "sm")}Edit</button>
        <button class="btn sm primary" type="button" data-new>${App.icon("plus", "sm")}Add task</button>
      </div>
      ${p.description ? `<p class="pdesc-full">${esc(p.description)}</p>`
        : !p.photo ? `<button type="button" class="btn xs ghost" data-edit-more>${App.icon("image", "xs")}Add a photo or description</button>` : ""}
      <div class="progress mt-12"><div style="width:${pct}%;background:${esc(p.color)}"></div></div>
      ${open.length ? groups.map(g => Comp.section({ title: g.label, count: g.tasks.length, body: `<div class="list">${g.tasks.map(t => Comp.taskCard(t, { hideProject: true })).join("")}</div>` })).join("") : `<div class="mt-16">${Comp.emptyInline("No open tasks in this project.")}</div>`}
      ${done.length ? Comp.section({ title: "Finished", count: done.length, body: `<div class="list">${done.map(t => Comp.taskCard(t, { hideProject: true, compact: true })).join("")}</div>` }) : ""}
    `;
    Comp.bindTasks(panel);
    panel.querySelector("[data-edit]").onclick = () => Views.editProject(p);
    const more = panel.querySelector("[data-edit-more]"); if (more) more.onclick = () => Views.editProject(p);
    const banner = panel.querySelector("[data-view-photo]"); if (banner) banner.onclick = () => global.Shots.view(p.photo.id);
    global.Shots.fillImages(panel);
    panel.querySelector("[data-new]").onclick = () => global.Editor.quickAdd({ projectId: id });
  }

  Views.projects = {
    render(panel, params) { if (params && params.id) renderDetail(panel, params.id); else renderList(panel); }
  };
})(window);
