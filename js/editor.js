/*
 * Editor: quick add, meeting mode (rapid multi-add), and the full task
 * detail sheet (autosaves every change).
 */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Actions = global.Actions, Comp = global.Comp;
  const esc = App.esc;
  const Editor = {};

  // ---------- reusable fields ----------
  function peopleSource(allowMe) {
    return q => {
      const ql = q.toLowerCase();
      const people = [...Store.people.values()].filter(p => !ql || p.name.toLowerCase().includes(ql) || (p.role || "").toLowerCase().includes(ql))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)
        .map(p => ({ label: p.name, sub: p.role || p.team || "", value: p.name, html: `${Comp.avatar(p.id)}<span>${esc(p.name)}</span>` }));
      const out = [];
      if (allowMe && (!ql || "me".startsWith(ql) || "myself".startsWith(ql) || "self".startsWith(ql))) out.push({ label: "Me", sub: "self-assigned", value: "Me", html: `${Comp.avatar(Model.ME)}<span>Me</span>` });
      out.push(...people);
      if (q && !people.some(p => p.label.toLowerCase() === ql) && !/^me$/i.test(q)) out.push({ label: `Add "${q}"`, sub: "new person", value: q, html: `${App.icon("plus", "sm")}<span>Add “${esc(q)}”</span>` });
      return out;
    };
  }
  function projectSource() {
    return q => {
      const ql = q.toLowerCase();
      const list = [...Store.projects.values()].filter(p => !p.archived && (!ql || p.name.toLowerCase().includes(ql)))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8)
        .map(p => ({ label: p.name, value: p.name, html: `<span class="dot-sw" style="background:${esc(p.color)}"></span><span>${esc(p.name)}</span>` }));
      if (q && !list.some(p => p.label.toLowerCase() === ql)) list.push({ label: `Create "${q}"`, value: q, sub: "new project", html: `${App.icon("plus", "sm")}<span>Create project “${esc(q)}”</span>` });
      return list;
    };
  }
  Editor.bindPersonInput = (input, allowMe, onPick) => App.autocomplete(input, { source: peopleSource(allowMe), onPick: it => { input.value = it.value; if (onPick) onPick(it.value); } });
  Editor.bindProjectInput = (input, onPick) => App.autocomplete(input, { source: projectSource(), onPick: it => { input.value = it.value; if (onPick) onPick(it.value); } });
  const sourceOptions = sel => `<option value="">—</option>` + Model.SOURCES.map(s => `<option value="${s.key}" ${sel === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("");
  const snoozeChips = attr => global.Actions.snoozeChoices().map(c => `<button type="button" class="chip" ${attr}="${c.value}">${esc(c.label)}</button>`).join("");
  const quickDateChips = (attr) => Comp.quickDates().filter(d => d.value).map(d => `<button type="button" class="chip" ${attr}="${d.value}">${esc(d.label)}</button>`).join("");
  /** A checkbox that shows its fields only when ticked. */
  const toggleField = (key, label, hint, on, inner) => `<div class="field span-2 tg" data-tg-wrap="${key}">
          <label class="check-row"><input type="checkbox" data-tg="${key}" ${on ? "checked" : ""}><span><b>${label}</b> <span class="muted">${hint}</span></span></label>
          <div class="tg-box" ${on ? "" : "hidden"}>${inner}</div>
        </div>`;
  const dueInner = value => `<div class="row"><input class="input" type="date" name="due" value="${esc(value || "")}" style="max-width:200px"></div>
          <div class="quick-dates">${quickDateChips("data-date")}</div>`;
  const startInner = value => `<div class="row"><input class="input" type="date" name="startDate" value="${esc(value || "")}" style="max-width:200px"></div>
          <div class="quick-dates">${snoozeChips("data-start")}</div>`;
  const categoryChips = sel => `<div class="chips cat-chips" data-cat>${Model.CATEGORIES.map(c => `<button type="button" class="chip ${sel === c.key ? "on" : ""}" data-v="${c.key}">${esc(c.label)}</button>`).join("")}</div>`;
  /** File paths come first (most asks point at a file on the network drive); anything starting with http(s) is a link. */
  const linkInner = `<div class="row wrap lf-add"><input class="input grow" name="lfValue" placeholder="File path, e.g. \\\\server\\Projects\\RFI-012.pdf (or paste a link)" autocomplete="off" spellcheck="false">
          <input class="input" name="lfLabel" placeholder="Label (optional)" style="max-width:170px" autocomplete="off"><button class="btn sm" type="button" data-lf-add>Add</button></div>`;
  Editor.parseLinkOrFile = (value, label) => {
    const v = String(value || "").trim();
    if (!v) return null;
    if (/^(https?:\/\/|www\.|mailto:)/i.test(v)) { const url = App.safeUrl(/^www\./i.test(v) ? "https://" + v : v); return url ? { id: App.genId(), url, label: label || "" } : null; }
    return { id: App.genId(), path: v.replace(/^file:\/{2,3}/i, "").replace(/^"(.*)"$/, "$1"), label: label || "" };
  };
  Editor.linkRowHtml = l => l.path
    ? `<div class="link-row file">${App.icon("folder", "sm")}<span class="path" title="${esc(l.path)}">${l.label ? `<b>${esc(l.label)}</b>` : ""}<code>${esc(l.path)}</code></span><button type="button" class="btn xs ghost" data-copy-path="${esc(l.path)}">${App.icon("copy", "xs")}Copy</button><button type="button" class="icon-btn sm plain" data-del-link="${esc(l.id)}" title="Remove">${App.icon("x")}</button></div>`
    : `<div class="link-row">${App.icon("link", "sm")}<a href="${esc(App.safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.url)}</a><button type="button" class="icon-btn sm plain" data-del-link="${esc(l.id)}" title="Remove">${App.icon("x")}</button></div>`;
  /** Wires a toggleField: ticking shows the fields; unticking hides them and calls onOff (to clear the value). */
  function bindToggle(root, key, onOn, onOff) {
    const cb = root.querySelector(`[data-tg="${key}"]`), box = root.querySelector(`[data-tg-wrap="${key}"] .tg-box`);
    cb.addEventListener("change", () => { box.hidden = !cb.checked; if (cb.checked) { if (onOn) onOn(); } else if (onOff) onOff(); });
    return { cb, box, set(on) { cb.checked = on; box.hidden = !on; } };
  }

  // ---------- follow-up fields (quick add) ----------
  const FU_CHOICES = [["1", "Tomorrow"], ["2", "2 days"], ["3", "3 days"], ["7", "1 week"], ["14", "2 weeks"]];
  function followUpFields() {
    return `<div class="form-grid">
      <div class="field span-2"><label>What to follow up on</label><input class="input" name="fuNote" placeholder="e.g. Confirm finance got the numbers" autocomplete="off"></div>
      <div class="field span-2"><label>Who to follow up with <span class="muted">(optional)</span></label><div class="ac"><input class="input" name="fuWho" placeholder="Name" autocomplete="off"></div></div>
      <div class="field span-2"><label>Follow up in</label>
        <div class="row wrap">${FU_CHOICES.map(([d, l]) => `<button type="button" class="chip" data-fu-days="${d}">${l}</button>`).join("")}
          <input class="input" type="date" name="fuDate" style="max-width:180px"></div>
      </div>
    </div>`;
  }
  function bindFollowUpFields(box) {
    const note = box.querySelector("[name=fuNote]"), who = box.querySelector("[name=fuWho]"), date = box.querySelector("[name=fuDate]");
    Editor.bindPersonInput(who, false);
    const mark = () => box.querySelectorAll("[data-fu-days]").forEach(b => b.classList.toggle("on", App.addDays(Number(b.dataset.fuDays)) === date.value));
    box.querySelectorAll("[data-fu-days]").forEach(b => b.addEventListener("click", () => { date.value = App.addDays(Number(b.dataset.fuDays)); mark(); }));
    date.addEventListener("change", mark);
    date.value = App.addDays(Model.FOLLOW_UP_DAYS); mark();
    return {
      note,
      read() {
        const pid = Actions.ensurePerson(who.value);
        return { note: note.value.trim(), personId: pid === Model.ME ? "" : pid, followUp: date.value || App.addDays(Model.FOLLOW_UP_DAYS) };
      }
    };
  }

  // ================= QUICK ADD =================
  /** defaults: { requesterId, projectId, self, due, status } */
  Editor.quickAdd = function (defaults) {
    defaults = defaults || {};
    const self = defaults.self || defaults.requesterId === Model.ME;
    const reqName = self ? "Me" : (defaults.requesterId ? Model.personName(defaults.requesterId) : "");
    const projName = defaults.projectId ? Model.projectName(defaults.projectId) : "";
    const tpls = global.Templates ? global.Templates.list() : [];
    const body = App.el(`<form class="qa" autocomplete="off">
      ${tpls.length ? `<div class="tpl-row"><span class="label">Start from a template</span><div class="chips scroll">${tpls.slice(0, 8).map(t => `<button type="button" class="chip" data-tpl="${esc(t.id)}">${App.icon("template", "xs")}${esc(t.name)}</button>`).join("")}</div></div>` : ""}
      <div class="field"><label>Project</label><div class="ac"><input class="input" name="project" placeholder="Pick or create" value="${esc(projName)}"></div></div>
      <div class="field mt-12"><label>Task</label><input class="input title-input" name="title" placeholder="What's the ask?" required></div>
      <div class="field mt-12"><label>Category</label>${categoryChips(defaults.category || "")}</div>
      <div class="form-grid mt-12">
        <div class="field"><label>Who asked</label>
          <div class="ac"><input class="input" name="requester" placeholder="Name, or “Me”" value="${esc(reqName)}"></div>
          <div class="chips mt-4"><button type="button" class="chip ${self ? "on" : ""}" data-self>${App.icon("me", "sm")}I assigned this to myself</button></div>
        </div>
        <div class="field"><label>Status</label><select class="select" name="status" data-st>${Model.ACTIVE_STATUSES.map(st => `<option value="${st.key}" ${(defaults.status || "new") === st.key ? "selected" : ""}>${esc(st.label)}</option>`).join("")}</select></div>
        <div class="field"><label>Priority</label>
          <div class="seg full" data-prio>${Model.PRIORITIES.slice().reverse().map(p => `<button type="button" data-v="${p.key}" class="${p.key === "medium" ? "on" : ""}">${p.label}</button>`).join("")}</div>
        </div>
        <div class="field"><label>How it came in</label><select class="select" name="source">${sourceOptions(self ? "self" : "")}</select></div>
        <div class="field span-2"><label>Next step <span class="muted">(optional)</span></label><input class="input" name="step" placeholder="e.g. Pull last quarter's numbers"><div class="muted tpl-steps" data-tpl-steps hidden></div></div>
        ${toggleField("due", "Due date", "", !!defaults.due, dueInner(defaults.due))}
        ${toggleField("start", "Not until", "Hide it from Today until a date", !!defaults.startDate, startInner(defaults.startDate))}
        ${toggleField("lf", "File or link", "A file path on the network drive, or a link", false, `<div class="links" data-links></div>${linkInner}`)}
        <div class="field span-2"><label>Screenshot of the request <span class="muted">(optional)</span></label>
          <div class="shots" data-shot-strip></div><div data-shot-drop></div>
        </div>
        <div class="field span-2">
          <label class="check-row"><input type="checkbox" name="fu"><span><b>Follow up</b> <span class="muted">Remind me to check back on this</span></span></label>
          <div class="fu-box" data-fu-box hidden>${followUpFields()}</div>
        </div>
      </div>
      <button type="submit" hidden></button>
    </form>`);
    const foot = App.el(`<div style="display:contents">
      <button type="button" class="btn ghost" data-more>Add + details</button><span class="spacer"></span>
      <button type="button" class="btn primary" data-add>Add task <kbd>↵</kbd></button></div>`);
    App.sheet.open({ title: self ? "New self-assigned task" : "New task", subtitle: "Enter to add · Esc to cancel", body, foot, narrow: true });

    const f = body;
    const title = f.querySelector("[name=title]"), req = f.querySelector("[name=requester]"), proj = f.querySelector("[name=project]"), due = f.querySelector("[name=due]"), source = f.querySelector("[name=source]"), step = f.querySelector("[name=step]");
    let prio = "medium";
    const selfChip = f.querySelector("[data-self]");
    const syncSelf = () => { const on = /^me$/i.test(req.value.trim()); selfChip.classList.toggle("on", on); if (on && !source.value) source.value = "self"; };
    Editor.bindPersonInput(req, true, syncSelf);
    req.addEventListener("input", syncSelf);
    selfChip.addEventListener("click", () => { const on = !selfChip.classList.contains("on"); req.value = on ? "Me" : ""; if (!on && source.value === "self") source.value = ""; syncSelf(); });
    Editor.bindProjectInput(proj);
    f.querySelectorAll("[data-date]").forEach(b => b.addEventListener("click", () => { due.value = b.dataset.date; markDate(); }));
    const markDate = () => f.querySelectorAll("[data-date]").forEach(b => b.classList.toggle("on", b.dataset.date === due.value));
    due.addEventListener("change", markDate); markDate();
    f.querySelectorAll("[data-prio] button").forEach(b => b.addEventListener("click", () => { prio = b.dataset.v; f.querySelectorAll("[data-prio] button").forEach(x => x.classList.toggle("on", x === b)); }));
    let category = defaults.category || "";
    f.querySelector("[data-cat]").addEventListener("click", e => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      category = category === b.dataset.v ? "" : b.dataset.v;
      f.querySelectorAll("[data-cat] [data-v]").forEach(x => x.classList.toggle("on", x.dataset.v === category));
    });
    // due date / not until: ticking shows the date; unticking clears it
    bindToggle(f, "due", () => setTimeout(() => due.focus(), 30), () => { due.value = ""; markDate(); });
    bindToggle(f, "start", () => setTimeout(() => startIn.focus(), 30), () => { startIn.value = ""; markStart(); });
    // files & links
    const lfList = [];
    const lfValue = f.querySelector("[name=lfValue]"), lfLabel = f.querySelector("[name=lfLabel]");
    const paintLf = () => { f.querySelector("[data-links]").innerHTML = lfList.map(Editor.linkRowHtml).join(""); };
    const addLf = () => {
      const item = Editor.parseLinkOrFile(lfValue.value, lfLabel.value.trim());
      if (!item) { if (lfValue.value.trim()) App.toast("That doesn't look like a link"); return false; }
      lfList.push(item); lfValue.value = ""; lfLabel.value = ""; paintLf(); return true;
    };
    bindToggle(f, "lf", () => setTimeout(() => lfValue.focus(), 30), () => { lfList.length = 0; lfValue.value = ""; paintLf(); });
    f.querySelector("[data-lf-add]").addEventListener("click", () => { addLf(); lfValue.focus(); });
    [lfValue, lfLabel].forEach(inp => inp.addEventListener("keydown", e => { if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); addLf(); lfValue.focus(); } }));
    f.querySelector("[data-links]").addEventListener("click", e => {
      const c = e.target.closest("[data-copy-path]"); if (c) { Comp.copyPath(c.dataset.copyPath); return; }
      const d = e.target.closest("[data-del-link]"); if (d) { lfList.splice(lfList.findIndex(x => x.id === d.dataset.delLink), 1); paintLf(); }
    });

    // screenshots: compressed now, saved with the task
    const pending = [];
    const strip = f.querySelector("[data-shot-strip]");
    const paintShots = () => global.Shots.renderStrip(strip, pending, { onRemove: id => { pending.splice(pending.findIndex(x => x.id === id), 1); paintShots(); } });
    const addFiles = async files => {
      try { pending.push(...await global.Shots.prepare(files)); paintShots(); }
      catch (err) { App.toast(err.message || "Couldn't add that image"); }
    };
    global.Shots.dropZone(f.querySelector("[data-shot-drop]"), addFiles);
    global.Shots.onPaste(body, addFiles);
    if (defaults.files && defaults.files.length) addFiles(defaults.files);

    // not until
    const startIn = f.querySelector("[name=startDate]");
    const markStart = () => f.querySelectorAll("[data-start]").forEach(b => b.classList.toggle("on", b.dataset.start === startIn.value));
    f.querySelectorAll("[data-start]").forEach(b => b.addEventListener("click", () => { startIn.value = startIn.value === b.dataset.start ? "" : b.dataset.start; markStart(); }));
    startIn.addEventListener("change", markStart); markStart();

    // status + follow-up
    const statusSel = f.querySelector("[name=status]");
    const colorStatus = () => statusSel.style.setProperty("--st-color", Model.statusDot(statusSel.value));
    statusSel.addEventListener("change", colorStatus); colorStatus();
    const fuCheck = f.querySelector("[name=fu]");
    const fuBox = f.querySelector("[data-fu-box]");
    const fu = bindFollowUpFields(fuBox);
    const showFu = on => { fuCheck.checked = on; fuBox.hidden = !on; if (on) setTimeout(() => fu.note.focus(), 30); };
    fuCheck.addEventListener("change", () => showFu(fuCheck.checked));
    // "Waiting On Someone" implies a follow-up; pre-fill who from the requester.
    statusSel.addEventListener("change", () => {
      if (statusSel.value === "waiting" && !fuCheck.checked) showFu(true);
    });

    // templates: fill the form; extra steps and details are added on save
    let tplExtra = null;
    f.querySelectorAll("[data-tpl]").forEach(b => b.addEventListener("click", () => {
      const tpl = Store.templates.get(b.dataset.tpl); if (!tpl) return;
      const x = global.Templates.toTaskFields(tpl);
      f.querySelectorAll("[data-tpl]").forEach(c => c.classList.toggle("on", c === b));
      title.value = x.title;
      if (x.requesterId) { req.value = Model.personName(x.requesterId); syncSelf(); }
      if (x.projectId) proj.value = Model.projectName(x.projectId);
      prio = x.priority; f.querySelectorAll("[data-prio] button").forEach(p => p.classList.toggle("on", p.dataset.v === prio));
      step.value = x.steps[0] ? x.steps[0].text : "";
      if (x.category) { category = x.category; f.querySelectorAll("[data-cat] [data-v]").forEach(c => c.classList.toggle("on", c.dataset.v === category)); }
      tplExtra = { tpl, steps: x.steps.slice(1), details: x.details };
      const more = f.querySelector("[data-tpl-steps]");
      more.hidden = !tplExtra.steps.length;
      more.textContent = tplExtra.steps.length ? `+ ${App.plural(tplExtra.steps.length, "more step")} from “${tpl.name}”: ${tplExtra.steps.map(s => s.text).join(" → ")}` : "";
      title.focus(); title.select();
    }));

    let saving = false;
    const submit = async (openAfter) => {
      if (saving) return;
      if (!title.value.trim()) { title.focus(); App.toast("Add a short description of the ask"); return; }
      saving = true;
      if (lfValue.value.trim()) addLf(); // typed but didn't press Add
      let shots = [];
      try { shots = await Promise.all(pending.map(global.Shots.save)); }
      catch (err) { App.toast(err.message || "Couldn't save the screenshot"); }
      const t = Model.newTask({
        shots,
        title: title.value.trim(),
        requesterId: Actions.ensurePerson(req.value),
        projectId: Actions.ensureProject(proj.value),
        category,
        links: lfList.slice(),
        due: due.value || "",
        priority: prio,
        source: source.value || (/^me$/i.test(req.value.trim()) ? "self" : ""),
        status: statusSel.value || "new",
        startDate: startIn.value || "",
        steps: (step.value.trim() ? [{ id: App.genId(), text: step.value.trim(), done: false }] : []).concat(tplExtra ? tplExtra.steps : []),
        log: [Actions.logEntry(tplExtra ? `Created from template “${tplExtra.tpl.name}”` : "Created", true)]
      });
      if (tplExtra) {
        t.details = tplExtra.details;
        global.Templates.markUsed(tplExtra.tpl);
      }
      if (fuCheck.checked) {
        const w = fu.read();
        t.waiting = { on: true, personId: w.personId, since: App.today(), followUp: w.followUp, note: w.note };
        Actions.addLog(t, `Follow-up set for ${App.fmtDate(w.followUp)}${w.note ? `: ${w.note}` : ""}`, true);
      } else if (t.status === "waiting") {
        t.waiting = { personId: "", since: App.today(), followUp: App.addDays(Model.FOLLOW_UP_DAYS), note: "" };
      }
      Store.save("tasks", t);
      App.sheet.close();
      if (openAfter) setTimeout(() => Editor.open(t.id), 60);
      else App.toast("Task added", { label: "Open", onClick: () => Editor.open(t.id) });
    };
    f.addEventListener("submit", e => { e.preventDefault(); submit(false); });
    f.addEventListener("keydown", e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(false); } });
    foot.querySelector("[data-add]").addEventListener("click", () => submit(false));
    foot.querySelector("[data-more]").addEventListener("click", () => submit(true));
    setTimeout(() => title.focus(), 80);
  };

  // ================= FULL EDITOR =================
  let current = null; // { id, flush }

  Editor.currentId = () => (App.sheet.isOpen() && current ? current.id : null);

  Editor.open = function (id, opts) {
    opts = opts || {};
    const t0 = Store.tasks.get(id);
    if (!t0) return;
    const mutate = (fn, quiet) => {
      const latest = Store.tasks.get(id);
      if (!latest) return;
      const t = JSON.parse(JSON.stringify(latest));
      fn(t);
      Store.save("tasks", t);
      if (!quiet) paint();
    };
    const textSavers = [];
    const textField = (el, apply) => {
      const save = App.debounce(() => mutate(t => apply(t, el.value), true), 500);
      el.addEventListener("input", () => save());
      el.addEventListener("blur", () => save.flush());
      textSavers.push(save);
    };

    const t = t0;
    const body = App.el(`<div class="editor">
      <div class="field ed-proj"><label>Project</label><div class="ac"><input class="input" name="project" placeholder="Pick or create" value="${esc(Model.projectName(t.projectId))}"></div></div>
      <textarea class="input title-input mt-8" rows="1" name="title" placeholder="What's the ask?" style="min-height:46px;resize:none">${esc(t.title)}</textarea>
      <div class="row wrap mt-12">
        <select class="select" name="status" data-st style="width:auto;min-width:190px">${Model.STATUSES.map(s => `<option value="${s.key}" ${t.status === s.key ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
        <div class="seg" data-prio>${Model.PRIORITIES.slice().reverse().map(p => `<button type="button" data-v="${p.key}" class="${t.priority === p.key ? "on" : ""}">${p.label}</button>`).join("")}</div>
        <span data-eff></span>
      </div>
      <div class="field mt-12"><label>Category</label>${categoryChips(t.category || "")}</div>

      <div class="form-grid mt-16">
        <div class="field"><label>Who asked</label><div class="ac"><input class="input" name="requester" placeholder="Name, or “Me”" value="${esc(Model.personName(t.requesterId))}"></div></div>
        <div class="field"><label>How it came in</label><select class="select" name="source">${sourceOptions(t.source)}</select></div>
        ${toggleField("due", "Due date", "", !!t.due, dueInner(t.due))}
        ${toggleField("start", "Not until", "Hide it from Today until a date", !!t.startDate, startInner(t.startDate))}
      </div>

      <div class="ed-section" data-waiting-wrap></div>

      <div class="ed-section">
        <div class="label">${App.icon("list")}Next steps &amp; notes</div>
        <div class="steps" data-steps></div>
        <form class="add-line sn-add" data-step-form>
          <input class="input" name="newstep" placeholder="Add a next step, or a note about what happened" autocomplete="off">
          <button class="btn sm" type="submit" title="Add as a next step (Enter)">${App.icon("plus", "xs")}Step</button>
          <button class="btn sm ghost" type="button" data-add-note title="Add as a note (Shift+Enter)">${App.icon("note", "xs")}Note</button>
        </form>
        <div class="sub-label mt-12" data-hist-label hidden>History</div>
        <div class="log" data-log></div>
      </div>

      <div class="ed-section">
        <div class="label">${App.icon("image")}Screenshots</div>
        <div class="shots" data-shot-strip></div>
        <div data-shot-drop></div>
      </div>

      <div class="form-grid ed-section">
        ${toggleField("lf", "File or link", "A file path on the network drive, or a link", (t.links || []).length > 0, `<div class="links" data-links></div>${linkInner}`)}
      </div>

      <div class="ed-section">
        <div class="label">${App.icon("edit")}Details</div>
        <textarea class="input" name="details" rows="4" placeholder="Background, specifics, anything you need to remember">${esc(t.details || "")}</textarea>
      </div>
      <div class="ed-meta" data-meta></div>
    </div>`);
    const foot = App.el(`<div style="display:contents">
      <button type="button" class="btn ghost foot-sm foot-icon" data-dup title="Duplicate" aria-label="Duplicate">${App.icon("copy", "sm")}</button>
      <button type="button" class="btn ghost foot-sm" data-save-tpl title="Save as template: reuse this task's steps and details for future asks" aria-label="Save as template">${App.icon("template", "sm")}<span class="wide-label">Save as template</span></button>
      <button type="button" class="btn danger foot-sm foot-icon" data-del title="Delete (moves to Recently deleted)" aria-label="Delete">${App.icon("trash", "sm")}</button>
      <span class="spacer"></span>
      <button type="button" class="btn primary" data-done></button></div>`);

    App.sheet.open({
      title: Model.isSelf(t) ? "Self-assigned task" : "Task", body, foot, tall: true,
      onClose: () => { textSavers.forEach(s => s.flush()); current = null; }
    });
    current = { id };
    const q = sel => body.querySelector(sel);

    // title (auto-grow)
    const title = q("[name=title]");
    const grow = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
    title.addEventListener("input", grow); requestAnimationFrame(grow);
    title.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } });
    textField(title, (t, v) => { t.title = v.trim() || t.title; });

    q("[name=status]").addEventListener("change", e => {
      const v = e.target.value;
      if (v === "done") { Actions.complete(Store.tasks.get(id)); setTimeout(paint, 30); return; }
      mutate(t => {
        const was = Model.status(t.status).label;
        if (v === "waiting") { t.waiting = Object.assign({ personId: "", since: "", followUp: "" }, t.waiting); if (!t.waiting.since) t.waiting.since = App.today(); if (!t.waiting.followUp) t.waiting.followUp = App.addDays(Model.FOLLOW_UP_DAYS); }
        if (v === "cancelled") t.completedAt = new Date().toISOString(); else if (t.status === "done" || t.status === "cancelled") t.completedAt = "";
        t.status = v;
        Actions.addLog(t, `Status: ${was} → ${Model.status(v).label}`, true);
      });
      if (v === "waiting") setTimeout(() => body.querySelector("[name=waitPerson]")?.focus(), 50);
    });
    q("[data-prio]").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      body.querySelectorAll("[data-prio] button").forEach(x => x.classList.toggle("on", x === b));
      mutate(t => { t.priority = b.dataset.v; });
    });

    const req = q("[name=requester]");
    const saveReq = () => mutate(t => { const nid = Actions.ensurePerson(req.value); if (nid !== t.requesterId) { t.requesterId = nid; if (nid === Model.ME && !t.source) t.source = "self"; } }, true);
    Editor.bindPersonInput(req, true, saveReq);
    req.addEventListener("change", saveReq);
    const proj = q("[name=project]");
    const saveProj = () => mutate(t => { t.projectId = Actions.ensureProject(proj.value); }, true);
    Editor.bindProjectInput(proj, saveProj);
    proj.addEventListener("change", saveProj);

    const due = q("[name=due]");
    const setDue = v => { due.value = v; mutate(t => { if ((t.due || "") === v) return; if (t.due && v) Actions.addLog(t, `Due date moved: ${App.fmtDate(t.due)} → ${App.fmtDate(v)}`, true); t.due = v; }); };
    due.addEventListener("change", () => setDue(due.value));
    const dueTg = bindToggle(body, "due", () => setTimeout(() => { due.focus(); try { due.showPicker && due.showPicker(); } catch (e) { /* ignore */ } }, 30), () => setDue(""));
    const startIn = q("[name=startDate]");
    const setStart = v => { startIn.value = v; mutate(t => { if ((t.startDate || "") === v) return; t.startDate = v; Actions.addLog(t, v ? `Not until ${App.fmtDate(v)}` : "“Not until” cleared", true); }); };
    startIn.addEventListener("change", () => setStart(startIn.value));
    const startTg = bindToggle(body, "start", () => setTimeout(() => { startIn.focus(); try { startIn.showPicker && startIn.showPicker(); } catch (e) { /* ignore */ } }, 30), () => setStart(""));
    // category: tap to pick, tap again to clear
    q("[data-cat]").addEventListener("click", e => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      mutate(t => { t.category = t.category === b.dataset.v ? "" : b.dataset.v; });
    });
    body.querySelectorAll("[data-start]").forEach(b => b.addEventListener("click", () => setStart(b.dataset.start)));
    body.querySelectorAll("[data-date]").forEach(b => b.addEventListener("click", () => setDue(b.dataset.date)));

    textField(q("[name=details]"), (t, v) => { t.details = v; });
    q("[name=source]").addEventListener("change", e => mutate(t => { t.source = e.target.value; }, true));

    // steps
    const snInput = q("[name=newstep]");
    const addStepOrNote = asNote => {
      const v = snInput.value.trim(); if (!v) { snInput.focus(); return; }
      if (asNote) mutate(t => Actions.addLog(t, v, false));
      else mutate(t => { t.steps = (t.steps || []).concat({ id: App.genId(), text: v, done: false }); });
      snInput.value = ""; snInput.focus();
    };
    q("[data-step-form]").addEventListener("submit", e => { e.preventDefault(); addStepOrNote(false); });
    q("[data-add-note]").addEventListener("click", () => addStepOrNote(true));
    snInput.addEventListener("keydown", e => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); addStepOrNote(true); } });
    q("[data-steps]").addEventListener("click", e => {
      const row = e.target.closest("[data-step-id]"); if (!row) return;
      const sid = row.dataset.stepId;
      const act = e.target.closest("[data-sact]")?.dataset.sact;
      if (act === "toggle") { Actions.completeStep(Store.tasks.get(id), sid); setTimeout(paint, 20); }
      if (act === "up" || act === "down") mutate(t => {
        // swap with the neighbouring open step (finished steps live in History)
        const openIdx = t.steps.map((s, k) => (s.done ? -1 : k)).filter(k => k >= 0);
        const pos = openIdx.indexOf(t.steps.findIndex(s => s.id === sid)); const other = openIdx[act === "up" ? pos - 1 : pos + 1];
        if (pos < 0 || other == null) return;
        const i = openIdx[pos]; [t.steps[i], t.steps[other]] = [t.steps[other], t.steps[i]];
      });
      if (act === "del") mutate(t => { t.steps = t.steps.filter(s => s.id !== sid); });
    });
    q("[data-steps]").addEventListener("focusout", e => {
      const txt = e.target.closest(".txt"); if (!txt) return;
      const sid = txt.closest("[data-step-id]").dataset.stepId; const v = txt.textContent.trim();
      mutate(t => { const s = t.steps.find(x => x.id === sid); if (!s) return; if (!v) t.steps = t.steps.filter(x => x.id !== sid); else s.text = v; });
    });
    q("[data-steps]").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.closest(".txt")) { e.preventDefault(); e.target.blur(); } });

    // screenshots
    const shotStrip = q("[data-shot-strip]");
    let shotsKey = null;
    const addShots = async files => {
      try {
        const refs = await Promise.all((await global.Shots.prepare(files)).map(global.Shots.save));
        mutate(t => { t.shots = (t.shots || []).concat(refs); Actions.addLog(t, refs.length > 1 ? `Added ${refs.length} screenshots` : "Added a screenshot", true); });
      } catch (err) { App.toast(err.message || "Couldn't add that image"); }
    };
    const removeShot = shotId => {
      const before = JSON.parse(JSON.stringify(Store.tasks.get(id).shots || []));
      mutate(t => { t.shots = (t.shots || []).filter(x => x.id !== shotId); });
      App.toast("Screenshot removed", { label: "Undo", onClick: () => mutate(t => { t.shots = before; }) });
      global.Shots.cleanupLater([shotId]);
    };
    global.Shots.dropZone(q("[data-shot-drop]"), addShots);
    global.Shots.onPaste(body, addShots);
    function paintShots(t) {
      const list = t.shots || [];
      const key = list.map(x => x.id).join(",");
      if (key === shotsKey) return; // don't reload thumbnails on unrelated edits
      shotsKey = key;
      global.Shots.renderStrip(shotStrip, list, { onRemove: removeShot });
    }

    // log
    q("[data-log]").addEventListener("click", e => {
      const st = e.target.closest("[data-undo-step]");
      if (st) { Actions.completeStep(Store.tasks.get(id), st.dataset.undoStep); setTimeout(paint, 20); return; }
      const b = e.target.closest("[data-del-log]"); if (!b) return;
      mutate(t => { t.log = (t.log || []).filter(l => l.id !== b.dataset.delLog); });
    });

    // links
    const lfValue = q("[name=lfValue]"), lfLabel = q("[name=lfLabel]");
    const addLf = () => {
      const item = Editor.parseLinkOrFile(lfValue.value, lfLabel.value.trim());
      if (!item) { if (lfValue.value.trim()) App.toast("That doesn't look like a link"); return; }
      mutate(t => { t.links = (t.links || []).concat(item); });
      lfValue.value = ""; lfLabel.value = ""; lfValue.focus();
    };
    q("[data-lf-add]").addEventListener("click", addLf);
    [lfValue, lfLabel].forEach(inp => inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addLf(); } }));
    const lfTg = bindToggle(body, "lf", () => setTimeout(() => lfValue.focus(), 30), () => {
      const before = (Store.tasks.get(id).links || []).slice();
      if (!before.length) return;
      mutate(t => { t.links = []; });
      App.toast(before.length === 1 ? "File/link removed" : `${before.length} files/links removed`, { label: "Undo", onClick: () => mutate(t => { t.links = before; }) });
    });
    q("[data-links]").addEventListener("click", e => {
      const c = e.target.closest("[data-copy-path]"); if (c) { Comp.copyPath(c.dataset.copyPath); return; }
      const b = e.target.closest("[data-del-link]"); if (!b) return;
      mutate(t => { t.links = (t.links || []).filter(l => l.id !== b.dataset.delLink); });
    });

    foot.querySelector("[data-save-tpl]").addEventListener("click", () => global.Templates.edit(null, Store.tasks.get(id)));
    foot.querySelector("[data-dup]").addEventListener("click", () => { const n = Actions.duplicate(Store.tasks.get(id)); Editor.open(n.id); App.toast("Duplicated — editing the copy"); });
    foot.querySelector("[data-del]").addEventListener("click", async () => { if (await Actions.remove(Store.tasks.get(id))) App.sheet.close(); });
    foot.querySelector("[data-done]").addEventListener("click", () => {
      const cur = Store.tasks.get(id);
      if (Model.isActive(cur)) { Actions.complete(cur); App.sheet.close(); } else { Actions.reopen(cur); paint(); }
    });

    // ---------- dynamic parts ----------
    function paintWaiting(t) {
      const wrap = q("[data-waiting-wrap]");
      const isWaitStatus = t.status === "waiting";
      const show = isWaitStatus || Model.hasFollowUp(t);
      if (!show) {
        wrap.innerHTML = Model.isActive(t) ? `<button type="button" class="btn sm ghost" data-start-fu>${App.icon("hourglass", "sm")}Add a follow-up</button>` : "";
        wrap.querySelector("[data-start-fu]")?.addEventListener("click", () => {
          mutate(t => { t.waiting = { on: true, personId: "", since: App.today(), followUp: App.addDays(Model.FOLLOW_UP_DAYS), note: "" }; Actions.addLog(t, `Follow-up set for ${App.fmtDate(t.waiting.followUp)}`, true); });
          setTimeout(() => wrap.querySelector("[name=waitNote]")?.focus(), 30);
        });
        return;
      }
      const w = Object.assign({ personId: "", since: "", followUp: "", note: "" }, t.waiting);
      if (wrap.querySelector(".waiting-box") && wrap.contains(document.activeElement) && document.activeElement.matches("input")) return; // don't clobber typing
      wrap.innerHTML = `<div class="waiting-box">
        <div class="label row">${App.icon("hourglass", "sm")}${isWaitStatus ? "Waiting on someone" : "Follow-up"}</div>
        <div class="form-grid mt-8">
          <div class="field span-2"><label>What to follow up on</label><input class="input" name="waitNote" placeholder="e.g. Confirm finance got the numbers" value="${esc(w.note || "")}" autocomplete="off"></div>
          <div class="field"><label>${isWaitStatus ? "Waiting on" : "Follow up with"}</label><div class="ac"><input class="input" name="waitPerson" placeholder="Who? (optional)" value="${esc(Model.personName(w.personId))}"></div></div>
          <div class="field"><label>Since</label><input class="input" type="date" name="waitSince" value="${esc(w.since)}"></div>
          <div class="field span-2"><label>Follow up on</label>
            <div class="row wrap"><input class="input" type="date" name="waitFollow" value="${esc(w.followUp)}" style="max-width:200px">
            <button type="button" class="chip" data-fu="1">Tomorrow</button><button type="button" class="chip" data-fu="2">In 2 days</button><button type="button" class="chip" data-fu="7">In 1 week</button><button type="button" class="chip" data-fu="mon">Next Mon</button></div>
          </div>
        </div>
        <div class="row wrap mt-12">
          <button type="button" class="btn sm" data-nudged>${App.icon("check", "sm")}I followed up</button>
          <button type="button" class="btn sm ghost" data-got-it>${isWaitStatus ? "Got what I needed" : "Follow-up done"}</button>
        </div>
      </div>`;
      const setW = patch => mutate(t => { t.waiting = Object.assign({ on: true }, t.waiting, patch); }, true);
      const wn = wrap.querySelector("[name=waitNote]");
      wn.addEventListener("change", () => setW({ note: wn.value.trim() }));
      const wp = wrap.querySelector("[name=waitPerson]");
      const saveWp = () => { const pid = Actions.ensurePerson(wp.value); setW({ personId: pid === Model.ME ? "" : pid }); };
      Editor.bindPersonInput(wp, false, saveWp);
      wp.addEventListener("change", saveWp);
      wrap.querySelector("[name=waitSince]").addEventListener("change", e => setW({ since: e.target.value }));
      wrap.querySelector("[name=waitFollow]").addEventListener("change", e => setW({ followUp: e.target.value }));
      const markFu = () => wrap.querySelectorAll("[data-fu]").forEach(b => b.classList.toggle("on", (b.dataset.fu === "mon" ? App.nextWeekday(1) : App.addDays(Number(b.dataset.fu))) === wrap.querySelector("[name=waitFollow]").value));
      markFu();
      wrap.querySelectorAll("[data-fu]").forEach(b => b.addEventListener("click", () => {
        const v = b.dataset.fu === "mon" ? App.nextWeekday(1) : App.addDays(Number(b.dataset.fu));
        wrap.querySelector("[name=waitFollow]").value = v; markFu();
        setW({ followUp: v });
      }));
      wrap.querySelector("[data-nudged]").addEventListener("click", () => {
        mutate(t => { const who = Model.personName(t.waiting?.personId); Actions.addLog(t, who ? `Followed up with ${who}` : "Followed up", false); t.waiting = Object.assign({}, t.waiting, { followUp: App.addDays(Model.FOLLOW_UP_DAYS) }); });
        App.toast(`Logged · next follow-up in ${Model.FOLLOW_UP_DAYS} days`);
      });
      wrap.querySelector("[data-got-it]").addEventListener("click", () => {
        mutate(t => {
          const who = Model.personName(t.waiting?.personId);
          Actions.addLog(t, isWaitStatus ? (who ? `Got it from ${who}` : "No longer waiting") : "Follow-up done", false);
          t.waiting = { personId: "", since: "", followUp: "", note: "" };
          if (t.status === "waiting") t.status = "in_progress";
        });
        q("[name=status]").value = Store.tasks.get(id).status;
      });
    }

    function paint() {
      const t = Store.tasks.get(id);
      if (!t || !body.isConnected) return;
      const eff = Model.effPriority(t);
      q("[data-eff]").innerHTML = eff.bumped ? `<span class="pill ${eff.color}" title="Raised automatically because the due date is close">${App.icon("bolt")}${esc(eff.label)} (due soon)</span>` : "";
      if (document.activeElement !== q("[name=status]")) q("[name=status]").value = t.status;
      q("[name=status]").style.setProperty("--st-color", Model.statusDot(q("[name=status]").value));
      body.querySelectorAll("[data-date]").forEach(b => b.classList.toggle("on", b.dataset.date === t.due));
      if (document.activeElement !== due) due.value = t.due || "";
      body.querySelectorAll("[data-start]").forEach(b => b.classList.toggle("on", b.dataset.start === t.startDate));
      if (document.activeElement !== startIn) startIn.value = t.startDate || "";
      if (t.due && !dueTg.cb.checked) dueTg.set(true);
      if (t.startDate && !startTg.cb.checked) startTg.set(true);
      if ((t.links || []).length && !lfTg.cb.checked) lfTg.set(true);
      body.querySelectorAll("[data-cat] [data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === (t.category || "")));
      if (document.activeElement !== proj) proj.value = Model.projectName(t.projectId);
      paintWaiting(t);
      paintShots(t);

      // open steps (checklist you can reorder and edit)
      const next = Model.nextStep(t);
      const open = (t.steps || []).filter(s => !s.done);
      const stepsEl = q("[data-steps]");
      if (!stepsEl.contains(document.activeElement) || !document.activeElement.classList.contains("txt")) {
        stepsEl.innerHTML = open.length ? open.map((s, i) => `<div class="step ${next && next.id === s.id ? "is-next" : ""}" data-step-id="${esc(s.id)}">
          <button type="button" class="check sq" data-sact="toggle" aria-label="Mark step done">${App.icon("check")}</button>
          <div class="txt" contenteditable="true" spellcheck="true">${esc(s.text)}</div>
          ${next && next.id === s.id ? `<span class="next-tag">Next</span>` : ""}
          <div class="tools">
            <button type="button" class="icon-btn sm plain" data-sact="up" title="Move up" ${i === 0 ? "disabled" : ""}>${App.icon("up")}</button>
            <button type="button" class="icon-btn sm plain" data-sact="down" title="Move down" ${i === open.length - 1 ? "disabled" : ""}>${App.icon("down")}</button>
            <button type="button" class="icon-btn sm plain danger" data-sact="del" title="Remove">${App.icon("x")}</button>
          </div></div>`).join("") : `<div class="muted" style="font-size:.86rem;padding:4px 0 6px">No open steps. The first one shows as “Next step” everywhere.</div>`;
      }

      // history: finished steps and notes together, newest first
      const hist = (t.log || []).filter(l => !(l.auto && /^Step done: /.test(l.text))).map(l => ({ at: l.at || "", html: `<div class="log-item ${l.auto ? "auto" : "is-note"}"><div class="when">${esc(App.fmtIsoTime(l.at))}${l.auto ? "" : `<button type="button" class="icon-btn sm plain del" data-del-log="${esc(l.id)}" title="Delete note" style="width:20px;height:20px;vertical-align:middle">${App.icon("x", "xs")}</button>`}</div><div class="text">${esc(l.text)}</div></div>` }))
        .concat((t.steps || []).filter(s => s.done).map(s => ({ at: s.doneAt || "", html: `<div class="log-item step-done"><div class="when">${s.doneAt ? esc(App.fmtIsoTime(s.doneAt)) : "Done"}</div><div class="text"><button type="button" class="check sq on" data-undo-step="${esc(s.id)}" title="Not done yet" aria-label="Mark step not done">${App.icon("check")}</button><span>${esc(s.text)}</span></div></div>` })))
        .sort((x, y) => y.at.localeCompare(x.at));
      q("[data-hist-label]").hidden = !hist.length;
      q("[data-log]").innerHTML = hist.map(h => h.html).join("");

      q("[data-links]").innerHTML = (t.links || []).slice().sort((a, b) => (b.path ? 1 : 0) - (a.path ? 1 : 0)).map(Editor.linkRowHtml).join("");

      const src = Model.source(t.source);
      q("[data-meta]").innerHTML = [
        `Created ${App.fmtIso(t.createdAt)}`,
        t.updatedAt ? `Updated ${App.relative(t.updatedAt)}` : "",
        t.completedAt ? `${t.status === "cancelled" ? "Cancelled" : "Completed"} ${App.fmtIso(t.completedAt)}` : "",
        src ? `Came in via ${src.label}` : ""
      ].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join("");
      const mtg = t.meetingId && Store.notes.get(t.meetingId);
      if (mtg) q("[data-meta]").insertAdjacentHTML("afterbegin", `<span>${App.icon("meeting", "xs")} From meeting: <a href="#meetings/${encodeURIComponent(mtg.id)}" data-close-sheet>${esc((mtg.title || "").trim() || "Untitled meeting")}${mtg.date ? ` · ${esc(App.fmtDate(mtg.date))}` : ""}</a></span>`);
      const cl = q("[data-close-sheet]"); if (cl) cl.onclick = () => App.sheet.close();

      foot.querySelector("[data-done]").innerHTML = Model.isActive(t) ? `${App.icon("check", "sm")}Mark done` : `${App.icon("undo", "sm")}Reopen`;
    }
    current.paint = paint;
    paint();

    // initial focus
    setTimeout(() => {
      if (opts.focus === "start") { startIn.focus(); try { startIn.showPicker && startIn.showPicker(); } catch (e) { /* ignore */ } }
      else if (opts.focus === "due") { due.focus(); try { due.showPicker && due.showPicker(); } catch (e) { /* ignore */ } }
      else if (opts.focus === "waiting") { body.querySelector("[name=waitPerson]")?.focus(); body.querySelector("[data-waiting-wrap]").scrollIntoView({ block: "center" }); }
      else if (opts.focus === "step") q("[name=newstep]").focus();
      else if (opts.focus === "log") q("[name=newstep]").focus();
      else if (!t.title) title.focus();
    }, 120);
  };

  // Keep an open editor fresh when data changes elsewhere (other device, list actions).
  App.on("data", () => { if (current && current.paint && App.sheet.isOpen()) { if (!Store.tasks.get(current.id)) { App.sheet.close(); return; } current.paint(); } });

  global.Editor = Editor;
})(window);
