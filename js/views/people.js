/* People: directory of everyone who asks you for things, with a page per person. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};
  let query = "";

  function statsFor(id) {
    const all = [...Store.tasks.values()];
    const asked = all.filter(t => t.requesterId === id);
    const open = asked.filter(Model.isActive);
    return {
      open: open.length,
      overdue: open.filter(t => t.due && t.due < App.today()).length,
      waitingOn: all.filter(t => Model.isWaiting(t) && t.waiting && t.waiting.personId === id).length,
      done: asked.filter(t => t.status === "done").length,
      last: asked.reduce((m, t) => (t.createdAt > m ? t.createdAt : m), "")
    };
  }

  Views.editPerson = function (person, onSaved) {
    const p = person ? Object.assign({}, person) : { id: App.genId(), name: "", role: "", team: "", email: "", notes: "", createdAt: new Date().toISOString() };
    const body = App.el(`<form autocomplete="off">
      <div class="form-grid">
        <div class="field span-2"><label>Name</label><input class="input" name="name" required value="${esc(p.name)}"></div>
        <div class="field"><label>Role / title</label><input class="input" name="role" value="${esc(p.role || "")}" placeholder="e.g. Director of Ops"></div>
        <div class="field"><label>Team</label><input class="input" name="team" value="${esc(p.team || "")}"></div>
        <div class="field span-2"><label>Email</label><input class="input" type="email" name="email" value="${esc(p.email || "")}"></div>
        <div class="field span-2"><label>Notes</label><textarea class="input" name="notes" rows="3" placeholder="How they like updates, their priorities…">${esc(p.notes || "")}</textarea></div>
      </div><button type="submit" hidden></button></form>`);
    const foot = App.el(`<div style="display:contents">${person ? `<button type="button" class="btn danger" data-del>${App.icon("trash", "sm")}Delete</button>` : ""}<span class="spacer"></span><button type="button" class="btn primary" data-save>Save</button></div>`);
    App.sheet.open({ title: person ? "Edit person" : "Add person", body, foot, narrow: true });
    const save = () => {
      const f = body;
      p.name = f.querySelector("[name=name]").value.trim();
      if (!p.name) { f.querySelector("[name=name]").focus(); return; }
      p.role = f.role.value.trim(); p.team = f.team.value.trim(); p.email = f.email.value.trim(); p.notes = f.notes.value.trim();
      Store.save("people", p); App.sheet.close(); if (onSaved) onSaved(p);
    };
    body.addEventListener("submit", e => { e.preventDefault(); save(); });
    foot.querySelector("[data-save]").onclick = save;
    const del = foot.querySelector("[data-del]");
    if (del) del.onclick = async () => {
      const n = [...Store.tasks.values()].filter(t => t.requesterId === p.id).length;
      if (!(await App.confirm({ title: `Delete ${p.name}?`, text: n ? `Their ${App.plural(n, "task")} will stay but show no requester.` : "", okLabel: "Delete", danger: true }))) return;
      Store.remove("people", p.id); App.sheet.close(); location.hash = "#people";
    };
    setTimeout(() => body.querySelector("[name=name]").focus(), 80);
  };

  function renderList(panel) {
    const people = [...Store.people.values()].filter(p => !query || [p.name, p.role, p.team, p.email].join(" ").toLowerCase().includes(query.toLowerCase()));
    const rows = people.map(p => ({ p, s: statsFor(p.id) })).sort((a, b) => (b.s.open + b.s.waitingOn) - (a.s.open + a.s.waitingOn) || a.p.name.localeCompare(b.p.name));
    const me = statsFor(Model.ME);
    const hadFocus = document.activeElement && document.activeElement.id === "peopleSearch";
    panel.innerHTML = `
      <div class="page-head">
        <div><h1>People</h1><p class="lede">Who's asking, and who you're waiting on.</p></div>
        <div class="head-actions"><button class="btn sm primary" type="button" data-add>${App.icon("plus", "sm")}Add person</button></div>
      </div>
      <div class="search"><span>${App.icon("search", "sm")}</span><input type="search" id="peopleSearch" placeholder="Search people" value="${esc(query)}" autocomplete="off"></div>
      <div class="grid-cards mt-16">
        <button type="button" class="pcard" data-person="${Model.ME}">
          <div class="top">${Comp.avatar(Model.ME, "lg")}<div><div class="name">Me</div><div class="role">Self-assigned tasks</div></div></div>
          <div class="nums"><span><b>${me.open}</b> open</span>${me.overdue ? `<span class="alert"><b>${me.overdue}</b> overdue</span>` : ""}<span><b>${me.done}</b> done</span></div>
        </button>
        ${rows.map(({ p, s }) => `<button type="button" class="pcard" data-person="${esc(p.id)}">
          <div class="top">${Comp.avatar(p.id, "lg")}<div class="grow"><div class="name">${esc(p.name)}</div><div class="role">${esc([p.role, p.team].filter(Boolean).join(" · ") || p.email || "")}</div></div></div>
          <div class="nums"><span><b>${s.open}</b> open asks</span>${s.overdue ? `<span class="alert"><b>${s.overdue}</b> overdue</span>` : ""}${s.waitingOn ? `<span><b>${s.waitingOn}</b> waiting on them</span>` : ""}<span><b>${s.done}</b> done</span></div>
        </button>`).join("")}
      </div>
      ${!rows.length && !query ? `<div class="empty"><h3>No people yet</h3><p>People are added automatically when you type a new name in “Who asked”.</p></div>` : ""}
    `;
    const s = panel.querySelector("#peopleSearch");
    s.addEventListener("input", App.debounce(() => { query = s.value; renderList(panel); }, 120));
    if (hadFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    panel.querySelector("[data-add]").onclick = () => Views.editPerson(null);
    panel.querySelectorAll("[data-person]").forEach(b => b.onclick = () => { location.hash = "#people/" + b.dataset.person; });
  }

  function renderDetail(panel, id) {
    const isMe = id === Model.ME;
    const p = isMe ? { id, name: "Me" } : Store.people.get(id);
    if (!p) { panel.innerHTML = `<a class="back-link" href="#people">${App.icon("back", "sm")}People</a><div class="empty"><h3>Person not found</h3></div>`; return; }
    const all = [...Store.tasks.values()];
    const smart = Model.comparator("smart");
    const asked = all.filter(t => t.requesterId === id && Model.isActive(t)).sort(smart);
    const waiting = isMe ? [] : all.filter(t => Model.isWaiting(t) && t.waiting && t.waiting.personId === id).sort(smart);
    const done = all.filter(t => t.requesterId === id && !Model.isActive(t)).sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || "")).slice(0, 20);
    const hours = asked.reduce((s, t) => s + (t.estimate || 0), 0);
    panel.innerHTML = `
      <a class="back-link" href="#people">${App.icon("back", "sm")}People</a>
      <div class="detail-head">
        ${Comp.avatar(id, "lg")}
        <div class="grow"><h1>${esc(p.name)}</h1><p class="lede muted">${esc(isMe ? "Tasks you assigned yourself" : [p.role, p.team].filter(Boolean).join(" · "))}${p.email ? ` · <a href="mailto:${esc(p.email)}">${esc(p.email)}</a>` : ""}</p></div>
        ${isMe ? "" : `<button class="btn sm ghost" type="button" data-edit>${App.icon("edit", "sm")}Edit</button>`}
        <button class="btn sm primary" type="button" data-new>${App.icon("plus", "sm")}${isMe ? "New" : "New ask"}</button>
      </div>
      ${p.notes ? `<p class="mt-8" style="color:var(--text-2);font-size:.9rem;white-space:pre-wrap">${esc(p.notes)}</p>` : ""}
      ${Comp.section({ title: isMe ? "Open" : `Asked of you`, count: asked.length, right: hours ? `<span class="muted" style="font-size:.8rem">≈ ${Comp.fmtHours(hours)} estimated</span>` : "", body: asked.length ? `<div class="list">${asked.map(t => Comp.taskCard(t, { hideRequester: true })).join("")}</div>` : Comp.emptyInline("Nothing open.") })}
      ${isMe ? "" : Comp.section({ title: "You're waiting on them", tone: "orange", count: waiting.length, body: waiting.length ? `<div class="list">${waiting.map(t => Comp.taskCard(t)).join("")}</div>` : Comp.emptyInline("Not waiting on them for anything.") })}
      ${done.length ? Comp.section({ title: "Recently finished", count: done.length, body: `<div class="list">${done.map(t => Comp.taskCard(t, { hideRequester: true, compact: true })).join("")}</div>` }) : ""}
    `;
    Comp.bindTasks(panel);
    const ed = panel.querySelector("[data-edit]"); if (ed) ed.onclick = () => Views.editPerson(p);
    panel.querySelector("[data-new]").onclick = () => global.Editor.quickAdd({ requesterId: id, self: isMe });
  }

  Views.people = {
    render(panel, params) { if (params && params.id) renderDetail(panel, params.id); else renderList(panel); }
  };
})(window);
