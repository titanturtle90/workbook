/*
 * Meetings: notes for each meeting (who was there, what was said, photos),
 * with action items that become real tasks — yours as normal tasks, other
 * people's as "Waiting On Someone" tasks with a follow-up.
 */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp, Actions = global.Actions;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};
  const Meetings = {};
  let query = "";

  const copy = x => JSON.parse(JSON.stringify(x));
  const noteTitle = n => (n.title || "").trim() || "Untitled meeting";
  const sameSeries = (a, b) => (a.title || "").trim().toLowerCase() === (b.title || "").trim().toLowerCase() && (a.title || "").trim() !== "";

  Meetings.newNote = (defaults) => {
    const n = Object.assign({
      id: App.genId(), title: "", date: App.today(), organizerId: "", attendees: [], projectId: "",
      body: "", actions: [], shots: [], createdAt: new Date().toISOString()
    }, defaults || {});
    Store.save("notes", n);
    location.hash = "#meetings/" + encodeURIComponent(n.id);
    setTimeout(() => { const el = document.querySelector("#panel-meetings [name=noteTitle]"); if (el) el.focus(); }, 120);
    return n;
  };

  /** Notes a person was at (organizer or attendee), newest first. */
  Meetings.forPerson = id => [...Store.notes.values()].filter(n => n.organizerId === id || (n.attendees || []).includes(id)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  Meetings.forProject = id => [...Store.notes.values()].filter(n => n.projectId === id).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  Meetings.previous = n => [...Store.notes.values()].filter(o => o.id !== n.id && sameSeries(o, n) && (o.date || "") < (n.date || "")).sort((a, b) => b.date.localeCompare(a.date))[0] || null;

  /** Action-item tasks for a note (live from the task list; missing ones were deleted). */
  const actionTasks = n => (n.actions || []).map(a => ({ a, t: Store.tasks.get(a.taskId) || null }));
  const openActionCount = n => actionTasks(n).filter(x => x.t && Model.isActive(x.t)).length;
  // across all notes, counting a carried-over task once
  const openActionsTotal = () => new Set([...Store.notes.values()].flatMap(n => actionTasks(n).filter(x => x.t && Model.isActive(x.t)).map(x => x.t.id))).size;

  /** A compact row used on the list page and on People / Project pages. */
  Meetings.rowHtml = n => {
    const acts = (n.actions || []).length, open = openActionCount(n);
    const people = [n.organizerId].concat(n.attendees || []).filter((v, i, arr) => v && arr.indexOf(v) === i);
    const snippet = (n.body || "").replace(/\s+/g, " ").trim().slice(0, 160);
    return `<a class="mcard" href="#meetings/${encodeURIComponent(n.id)}">
      <div class="mc-top"><span class="mc-title">${esc(noteTitle(n))}</span><span class="pill gray">${App.icon("calendar")}${esc(n.date ? App.fmtDateLong(n.date) : "No date")}</span></div>
      ${snippet ? `<div class="mc-snippet">${esc(snippet)}</div>` : ""}
      <div class="mc-meta">
        ${people.length ? `<span class="mc-people">${people.slice(0, 6).map(id => Comp.avatar(id)).join("")}${people.length > 6 ? `<span class="muted">+${people.length - 6}</span>` : ""}</span>` : ""}
        ${Comp.projectPill(n.projectId)}
        ${acts ? `<span class="pill ${open ? "st st-in_progress" : "st st-done"}">${App.icon("check")}${App.plural(acts, "action item")}${open ? ` · ${open} open` : ""}</span>` : ""}
        ${(n.shots || []).length ? `<span class="pill gray">${App.icon("image")}${n.shots.length}</span>` : ""}
      </div>
    </a>`;
  };

  // ======================= list =======================
  function renderList(panel) {
    panel._noteId = null;
    const all = [...Store.notes.values()];
    const q = query.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = n => [n.title, n.body, Model.personName(n.organizerId), (n.attendees || []).map(Model.personName).join(" "), Model.projectName(n.projectId),
      actionTasks(n).map(x => x.t ? x.t.title : x.a.text).join(" ")].join(" ").toLowerCase();
    const list = all.filter(n => q.every(w => hay(n).includes(w))).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || "").localeCompare(a.createdAt || ""));
    const today = App.today(), wk = App.weekStart(), lastWk = App.addDays(-7, wk);
    const bucket = n => !n.date ? "No date" : n.date > today ? "Upcoming" : n.date === today ? "Today" : n.date >= wk ? "Earlier this week" : n.date >= lastWk ? "Last week"
      : App.parseDate(n.date).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const groups = [];
    list.forEach(n => { const b = bucket(n); let g = groups[groups.length - 1]; if (!g || g.label !== b) { g = { label: b, items: [] }; groups.push(g); } g.items.push(n); });
    const hadFocus = document.activeElement && document.activeElement.id === "meetSearch";
    panel.innerHTML = `
      <div class="page-head">
        <div><h1>Meetings</h1><p class="lede">${App.plural(all.length, "meeting note")}${all.length ? ` · ${openActionsTotal()} open action items` : ""}</p></div>
        <div class="head-actions"><button class="btn sm primary" type="button" data-new-note>${App.icon("plus", "sm")}New meeting note <kbd>M</kbd></button></div>
      </div>
      ${all.length ? `<div class="search"><span>${App.icon("search", "sm")}</span><input type="search" id="meetSearch" placeholder="Search notes, people, action items…" value="${esc(query)}" autocomplete="off"></div>` : ""}
      ${groups.length ? groups.map(g => Comp.section({ title: g.label, count: g.items.length, body: `<div class="mlist">${g.items.map(Meetings.rowHtml).join("")}</div>` })).join("")
        : all.length ? `<div class="empty"><div class="big">🔍</div><h3>No matching notes</h3></div>`
        : `<div class="empty"><div class="big">📝</div><h3>No meeting notes yet</h3><p>Press <kbd>M</kbd> or tap <b>New meeting note</b>. Action items you add become tasks automatically.</p></div>`}
    `;
    panel.querySelector("[data-new-note]").onclick = () => Meetings.newNote();
    const s = panel.querySelector("#meetSearch");
    if (s) {
      s.addEventListener("input", App.debounce(() => { query = s.value; renderList(panel); }, 150));
      if (hadFocus) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }
  }

  // ======================= one note =======================
  const DUE_CHOICES = () => [["", "No due date"]].concat(Comp.quickDates().filter(d => d.value).map(d => [d.value, `${d.label} (${App.fmtDate(d.value)})`]));

  function renderDetail(panel, id) {
    const n0 = Store.notes.get(id);
    if (!n0) { panel._noteId = null; panel.innerHTML = `<a class="back-link" href="#meetings">${App.icon("back", "sm")}Meetings</a><div class="empty"><h3>Meeting note not found</h3><p>It may have been deleted.</p></div>`; return; }
    // Already showing this note: refresh the live parts only, so typing is never interrupted.
    if (panel._noteId === id && panel._refresh) { panel._refresh(); return; }
    panel._noteId = id;

    const mutate = fn => { const cur = Store.notes.get(id); if (!cur) return; const n = copy(cur); fn(n); Store.save("notes", n); };
    const savers = [];
    const textField = (el, apply) => {
      const save = App.debounce(() => mutate(n => apply(n, el.value)), 500);
      el.addEventListener("input", () => save());
      el.addEventListener("blur", () => save.flush());
      savers.push(save);
    };

    panel.innerHTML = `
      <a class="back-link" href="#meetings">${App.icon("back", "sm")}Meetings</a>
      <div class="note">
        <input class="input note-title" name="noteTitle" placeholder="Meeting title, e.g. Monday staff meeting" value="${esc(n0.title)}" autocomplete="off">
        <div class="note-grid mt-12">
          <div class="field"><label>Date</label><input class="input" type="date" name="noteDate" value="${esc(n0.date || "")}"></div>
          <div class="field"><label>Organizer <span class="muted">(asks default to them)</span></label><div class="ac"><input class="input" name="noteOrg" placeholder="Who ran it?" value="${esc(Model.personName(n0.organizerId))}" autocomplete="off"></div></div>
          <div class="field"><label>Project <span class="muted">(optional)</span></label><div class="ac"><input class="input" name="noteProj" placeholder="Pick or create" value="${esc(Model.projectName(n0.projectId))}" autocomplete="off"></div></div>
          <div class="field note-att"><label>Attendees</label><div class="tag-input ac" data-att><input name="noteAtt" placeholder="Add a person" autocomplete="off"></div></div>
        </div>
        <div data-prev></div>

        <div class="ed-section">
          <div class="label">${App.icon("note")}Notes</div>
          <textarea class="input note-body" name="noteBody" placeholder="Agenda, discussion, decisions… (paste a screenshot here too)">${esc(n0.body || "")}</textarea>
        </div>

        <div class="ed-section">
          <div class="label">${App.icon("check")}Action items <span class="muted" style="font-weight:500">· each one becomes a task</span></div>
          <div class="actions-list" data-actions></div>
          <form class="ai-add" data-ai-form autocomplete="off">
            <input class="input" name="aiText" placeholder="Add an action item, press Enter">
            <div class="ai-opts">
              <div class="ac ai-who"><input class="input" name="aiWho" value="Me" title="Who's doing it" autocomplete="off"></div>
              <select class="select" name="aiDue" title="Due">${DUE_CHOICES().map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select>
              <button class="btn sm primary" type="submit">Add</button>
            </div>
          </form>
          <p class="muted ai-hint">Yours become normal tasks. Someone else's become “Waiting On Someone” tasks with a follow-up, so you can chase them.</p>
        </div>

        <div class="ed-section">
          <div class="label">${App.icon("image")}Photos &amp; screenshots</div>
          <div class="shots" data-note-shots></div>
          <div data-note-drop></div>
        </div>

        <div class="note-foot">
          <button type="button" class="btn ghost" data-copy>${App.icon("copy", "sm")}Copy recap</button>
          <button type="button" class="btn danger foot-icon" data-del-note title="Delete meeting note" aria-label="Delete meeting note">${App.icon("trash", "sm")}</button>
          <span class="grow"></span>
          <span class="muted note-saved" data-saved></span>
        </div>
      </div>`;
    const q = sel => panel.querySelector(sel);

    // ---- header fields
    textField(q("[name=noteTitle]"), (n, v) => { n.title = v; });
    q("[name=noteTitle]").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); q("[name=noteBody]").focus(); } });
    q("[name=noteDate]").addEventListener("change", e => mutate(n => { n.date = e.target.value; }));
    const org = q("[name=noteOrg]");
    const saveOrg = () => mutate(n => { const pid = Actions.ensurePerson(org.value); n.organizerId = pid === Model.ME ? "" : pid; });
    global.Editor.bindPersonInput(org, false, saveOrg); org.addEventListener("change", saveOrg);
    const proj = q("[name=noteProj]");
    const saveProj = () => mutate(n => { n.projectId = Actions.ensureProject(proj.value); });
    global.Editor.bindProjectInput(proj, saveProj); proj.addEventListener("change", saveProj);

    // attendees (chips)
    const attBox = q("[data-att]"), attIn = attBox.querySelector("input");
    const addAtt = name => { const pid = Actions.ensurePerson(name); attIn.value = ""; if (!pid || pid === Model.ME) return; mutate(n => { if (!(n.attendees || []).includes(pid)) n.attendees = (n.attendees || []).concat(pid); }); };
    global.Editor.bindPersonInput(attIn, false, v => addAtt(v));
    attIn.addEventListener("keydown", e => {
      if ((e.key === "Enter" || e.key === ",") && attIn.value.trim()) { e.preventDefault(); addAtt(attIn.value); }
      else if (e.key === "Backspace" && !attIn.value) mutate(n => { n.attendees = (n.attendees || []).slice(0, -1); });
    });
    attBox.addEventListener("click", e => { const b = e.target.closest("[data-rm-att]"); if (b) mutate(n => { n.attendees = (n.attendees || []).filter(x => x !== b.dataset.rmAtt); }); else attIn.focus(); });

    // ---- notes body (auto-grow)
    const body = q("[name=noteBody]");
    const grow = () => { body.style.height = "auto"; body.style.height = Math.max(220, body.scrollHeight + 2) + "px"; };
    body.addEventListener("input", grow); requestAnimationFrame(grow);
    textField(body, (n, v) => { n.body = v; });

    // ---- action items
    const aiForm = q("[data-ai-form]"), aiText = aiForm.querySelector("[name=aiText]"), aiWho = aiForm.querySelector("[name=aiWho]"), aiDue = aiForm.querySelector("[name=aiDue]");
    global.Editor.bindPersonInput(aiWho, true);
    aiWho.addEventListener("focus", () => aiWho.select());
    aiForm.addEventListener("submit", e => {
      e.preventDefault();
      const text = aiText.value.trim(); if (!text) { aiText.focus(); return; }
      const n = Store.notes.get(id); if (!n) return;
      const owner = Actions.ensurePerson(aiWho.value) || Model.ME;
      const due = aiDue.value;
      const t = Model.newTask({
        title: text, projectId: n.projectId || "", due, source: "meeting", meetingId: n.id,
        requesterId: n.organizerId || Model.ME,
        status: owner === Model.ME ? "new" : "waiting",
        log: [Actions.logEntry(`From meeting: ${noteTitle(n)}${n.date ? ` (${App.fmtDate(n.date)})` : ""}`, true)]
      });
      if (owner !== Model.ME) t.waiting = { on: true, personId: owner, since: App.today(), followUp: due || App.addDays(Model.FOLLOW_UP_DAYS), note: text };
      Store.save("tasks", t);
      mutate(m => { m.actions = (m.actions || []).concat({ id: App.genId(), taskId: t.id, text, ownerId: owner }); });
      aiText.value = ""; aiWho.value = "Me"; aiDue.value = ""; aiText.focus();
    });
    q("[data-actions]").addEventListener("click", e => {
      const row = e.target.closest("[data-action-id]"); if (!row) return;
      const n = Store.notes.get(id); const a = (n.actions || []).find(x => x.id === row.dataset.actionId); if (!a) return;
      const t = Store.tasks.get(a.taskId);
      if (e.target.closest("[data-ai-check]")) { if (t) { if (Model.isActive(t)) Actions.complete(t); else Actions.reopen(t); } return; }
      if (e.target.closest("[data-ai-rm]")) {
        const before = copy(n.actions);
        mutate(m => { m.actions = m.actions.filter(x => x.id !== a.id); });
        if (t) Actions.trash([t]);
        else App.toast("Action item removed", { label: "Undo", onClick: () => mutate(m => { m.actions = before; }) });
        return;
      }
      if (e.target.closest("[data-ai-open]") && t) global.Editor.open(t.id);
    });

    // ---- photos & screenshots (paste anywhere on this page, drop, or choose)
    const addImages = async files => {
      try {
        const refs = await Promise.all((await global.Shots.prepare(files)).map(global.Shots.save));
        mutate(n => { n.shots = (n.shots || []).concat(refs); });
      } catch (err) { App.toast(err.message || "Couldn't add that image"); }
    };
    Meetings.addImages = addImages;
    global.Shots.dropZone(q("[data-note-drop]"), addImages, { label: "photo or screenshot" });
    let shotsKey = null;
    const removeShot = sid => {
      const before = copy(Store.notes.get(id).shots || []);
      mutate(n => { n.shots = (n.shots || []).filter(x => x.id !== sid); });
      App.toast("Image removed", { label: "Undo", onClick: () => mutate(n => { n.shots = before; }) });
      global.Shots.cleanupLater([sid]);
    };

    // ---- footer
    q("[data-copy]").onclick = async () => App.toast((await App.copy(Meetings.recapText(Store.notes.get(id)))) ? "Recap copied: paste it into an email or chat" : "Couldn't copy");
    q("[data-del-note]").onclick = async () => {
      const n = Store.notes.get(id);
      if (!(await App.confirm({ title: "Delete this meeting note?", text: (n.actions || []).length ? "Its action-item tasks stay on your list." : "", okLabel: "Delete", danger: true }))) return;
      savers.forEach(s => s.flush && s.flush());
      Store.remove("notes", id);
      global.Shots.cleanupLater((n.shots || []).map(s => s.id), 0);
      location.hash = "#meetings";
      App.toast("Meeting note deleted");
    };

    // ---- live parts
    panel._refresh = () => {
      const n = Store.notes.get(id); if (!n) return;
      // attendees
      attBox.querySelectorAll(".tag-chip").forEach(c => c.remove());
      (n.attendees || []).forEach(pid => attIn.insertAdjacentHTML("beforebegin", `<span class="tag-chip">${Comp.avatar(pid)}${esc(Model.personName(pid))}<button type="button" data-rm-att="${esc(pid)}" aria-label="Remove">${App.icon("x", "xs")}</button></span>`));
      // previous meeting in the same series
      const prev = Meetings.previous(n);
      const prevEl = q("[data-prev]");
      if (prev) {
        const carry = actionTasks(prev).filter(x => x.t && Model.isActive(x.t) && !(n.actions || []).some(a => a.taskId === x.t.id));
        prevEl.innerHTML = `<div class="note-prev">${App.icon("back", "sm")}<span>Previous “${esc(noteTitle(prev))}”: <a href="#meetings/${encodeURIComponent(prev.id)}">${esc(App.fmtDateLong(prev.date))}</a></span>
          ${carry.length ? `<button type="button" class="btn xs" data-carry>Carry over ${App.plural(carry.length, "open action item")}</button>` : ""}</div>`;
        const cb = prevEl.querySelector("[data-carry]");
        if (cb) cb.onclick = () => mutate(m => { m.actions = (m.actions || []).concat(carry.map(x => ({ id: App.genId(), taskId: x.t.id, text: x.t.title, ownerId: x.a.ownerId, carried: true }))); });
      } else prevEl.innerHTML = "";
      // action items
      const rows = actionTasks(n);
      q("[data-actions]").innerHTML = rows.length ? rows.map(({ a, t }) => {
        if (!t) return `<div class="ai-row gone" data-action-id="${esc(a.id)}"><span class="check sq"></span><div class="ai-text">${esc(a.text)} <span class="muted">(task deleted)</span></div><button type="button" class="icon-btn sm plain" data-ai-rm title="Remove">${App.icon("x")}</button></div>`;
        const active = Model.isActive(t);
        const ownerId = t.status === "waiting" || (t.waiting && t.waiting.on && t.waiting.personId) ? (t.waiting && t.waiting.personId) || a.ownerId : a.ownerId;
        return `<div class="ai-row ${active ? "" : "done"}" data-action-id="${esc(a.id)}" data-task-id="${esc(t.id)}">
          <button type="button" class="check sq ${active ? "" : "on"}" data-ai-check aria-label="${active ? "Mark done" : "Reopen"}">${App.icon("check")}</button>
          <button type="button" class="ai-text" data-ai-open title="Open task">${esc(t.title)}${a.carried ? ` <span class="muted">· carried over</span>` : ""}</button>
          <span class="ai-meta">${ownerId && ownerId !== Model.ME ? `<span class="who">${Comp.avatar(ownerId)}${esc(Model.personName(ownerId))}</span>` : `<span class="who">${Comp.avatar(Model.ME)}Me</span>`}
            ${t.due ? Comp.duePill(t, false) : ""}${active ? Comp.statusPill(t, false) : ""}</span>
          <button type="button" class="icon-btn sm plain" data-ai-rm title="Remove action item (moves its task to Recently deleted)">${App.icon("x")}</button>
        </div>`;
      }).join("") : `<div class="muted" style="font-size:.86rem;padding:2px 0 8px">No action items yet.</div>`;
      // images
      const key = (n.shots || []).map(s => s.id).join(",");
      if (key !== shotsKey) { shotsKey = key; global.Shots.renderStrip(q("[data-note-shots]"), n.shots || [], { onRemove: removeShot }); }
      // gentle "saved" note
      q("[data-saved]").textContent = n.updatedAt ? `Saved ${App.relative(n.updatedAt)}` : "";
    };
    panel._refresh();
  }

  /** Plain-text recap for email / chat. */
  Meetings.recapText = n => {
    const lines = [`${noteTitle(n)}${n.date ? ` (${App.fmtDateLong(n.date)})` : ""}`];
    const people = [n.organizerId].concat(n.attendees || []).filter((v, i, a) => v && a.indexOf(v) === i).map(Model.personName).filter(Boolean);
    if (people.length) lines.push(`Attendees: ${people.join(", ")}`);
    if (n.projectId) lines.push(`Project: ${Model.projectName(n.projectId)}`);
    if ((n.body || "").trim()) lines.push("", "Notes", n.body.trim());
    const acts = actionTasks(n);
    if (acts.length) {
      lines.push("", "Action items");
      acts.forEach(({ a, t }) => {
        const owner = t && t.waiting && t.waiting.personId && t.status === "waiting" ? Model.personName(t.waiting.personId) : a.ownerId && a.ownerId !== Model.ME ? Model.personName(a.ownerId) : "Me";
        lines.push(`• ${t && !Model.isActive(t) ? "[done] " : ""}${t ? t.title : a.text} (${owner}${t && t.due ? `, due ${App.fmtDate(t.due)}` : ""})`);
      });
    }
    return lines.join("\n");
  };

  Views.meetings = {
    render(panel, params) {
      if (params && params.id) renderDetail(panel, params.id);
      else { Meetings.addImages = null; renderList(panel); }
    }
  };
  global.Meetings = Meetings;
})(window);
