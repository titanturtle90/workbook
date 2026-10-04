/* Export & reports: CSV for Excel, monthly "what I did" summary, JSON backup/restore. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store;
  const esc = App.esc;
  const Exporter = {};

  const csvCell = v => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const iso2date = iso => iso ? App.isoToDateStr(iso) : "";

  Exporter.csv = (includeFinished) => {
    const header = ["The Ask", "Who Asked", "Next Step", "All Steps", "Due", "Project", "Status", "Priority", "Effective Priority", "Waiting On", "Follow Up", "Estimate (h)", "Tags", "Repeats", "Came In Via", "Created", "Completed", "Details", "Links", "Latest Note"];
    const tasks = [...Store.tasks.values()].filter(t => includeFinished || Model.isActive(t)).sort(Model.comparator("smart"));
    const rows = tasks.map(t => {
      const notes = (t.log || []).filter(l => !l.auto);
      return [
        t.title, Model.requesterName(t), Model.nextStep(t)?.text || "",
        (t.steps || []).map(s => (s.done ? "[x] " : "[ ] ") + s.text).join("\n"),
        t.due, Model.projectName(t.projectId), Model.status(t.status).label, Model.priority(t.priority).label, Model.effPriority(t).label,
        Model.personName(t.waiting?.personId), t.waiting?.followUp || "", t.estimate ?? "", (t.tags || []).join(", "),
        t.recurrence ? Model.recurrence(t.recurrence).label : "", Model.source(t.source)?.label || "",
        iso2date(t.createdAt), iso2date(t.completedAt), t.details || "", (t.links || []).map(l => l.url).join("\n"),
        notes.length ? notes[notes.length - 1].text : ""
      ];
    });
    const csv = "﻿" + [header].concat(rows).map(r => r.map(csvCell).join(",")).join("\r\n");
    App.download(`workbook-${includeFinished ? "all" : "open"}-tasks-${App.today()}.csv`, csv, "text/csv;charset=utf-8");
  };

  Exporter.summaryText = (month) => {
    const [y, m] = month.split("-").map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const done = [...Store.tasks.values()].filter(t => t.status === "done" && t.completedAt && App.isoToDateStr(t.completedAt).slice(0, 7) === month)
      .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
    const byProject = new Map();
    done.forEach(t => { const k = Model.projectName(t.projectId) || "Other"; if (!byProject.has(k)) byProject.set(k, []); byProject.get(k).push(t); });
    const people = new Set(done.map(t => t.requesterId).filter(id => id && id !== Model.ME));
    const lines = [`Work summary: ${label}`, ""];
    lines.push(`Completed ${App.plural(done.length, "task")}${byProject.size ? ` across ${App.plural(byProject.size, "area")}` : ""}${people.size ? ` for ${App.plural(people.size, "person", "people")}` : ""}.`, "");
    [...byProject.entries()].sort((a, b) => b[1].length - a[1].length).forEach(([proj, list]) => {
      lines.push(`${proj} (${list.length})`);
      list.forEach(t => {
        const who = t.requesterId && t.requesterId !== Model.ME ? ` (for ${Model.requesterName(t)})` : "";
        lines.push(`  • ${t.title}${who}, ${App.fmtIso(t.completedAt)}`);
      });
      lines.push("");
    });
    const endOfMonth = App.toDateStr(new Date(y, m, 0));
    if (endOfMonth >= App.today()) {
      const open = [...Store.tasks.values()].filter(Model.isActive).sort(Model.comparator("smart"));
      if (open.length) {
        lines.push(`In progress (${open.length})`);
        open.slice(0, 15).forEach(t => lines.push(`  • ${t.title}${t.due ? `, due ${App.fmtDate(t.due)}` : ""}${Model.nextStep(t) ? ` → next: ${Model.nextStep(t).text}` : ""}`));
        if (open.length > 15) lines.push(`  …and ${open.length - 15} more`);
      }
    }
    return lines.join("\n").trim();
  };

  Exporter.monthlySummary = (month) => {
    const months = [];
    for (let i = 0; i < 12; i++) months.push(App.addMonths(-i, App.today().slice(0, 7) + "-01").slice(0, 7));
    if (month && !months.includes(month)) months.push(month);
    const body = App.el(`<div>
      <div class="row"><select class="select" data-m style="max-width:240px">${months.map(m => { const [y, mm] = m.split("-").map(Number); return `<option value="${m}" ${m === month ? "selected" : ""}>${esc(new Date(y, mm - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" }))}</option>`; }).join("")}</select></div>
      <p class="muted mt-8" style="font-size:.84rem">Paste into a status update or self-review.</p>
      <div class="summary-box mt-8" data-out></div>
    </div>`);
    const foot = App.el(`<div style="display:contents"><button type="button" class="btn ghost" data-dl>${App.icon("download", "sm")}Download</button><span class="spacer"></span><button type="button" class="btn primary" data-copy>${App.icon("copy", "sm")}Copy</button></div>`);
    App.sheet.open({ title: "Monthly summary", body, foot });
    const sel = body.querySelector("[data-m]"), out = body.querySelector("[data-out]");
    const paint = () => { out.textContent = Exporter.summaryText(sel.value); };
    sel.onchange = paint; paint();
    foot.querySelector("[data-copy]").onclick = async () => App.toast((await App.copy(out.textContent)) ? "Copied to clipboard" : "Couldn't copy. Select the text instead.");
    foot.querySelector("[data-dl]").onclick = () => App.download(`workbook-summary-${sel.value}.txt`, out.textContent);
  };

  Exporter.backup = () => {
    const data = { app: "workbook", version: 1, exportedAt: new Date().toISOString(),
      tasks: [...Store.tasks.values()], people: [...Store.people.values()], projects: [...Store.projects.values()] };
    App.download(`workbook-backup-${App.today()}.json`, JSON.stringify(data, null, 2), "application/json");
  };

  Exporter.restore = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      let data;
      try { data = JSON.parse(await file.text()); } catch (e) { App.toast("That file isn't a Workbook backup"); return; }
      if (!data || data.app !== "workbook") { App.toast("That file isn't a Workbook backup"); return; }
      const n = (data.tasks || []).length;
      const ok = await App.confirm({ title: "Restore backup?", text: `Adds or updates ${App.plural(n, "task")}, ${App.plural((data.people || []).length, "person", "people")} and ${App.plural((data.projects || []).length, "project")}. Nothing else is deleted.`, okLabel: "Restore" });
      if (!ok) return;
      await Store.saveMany("people", data.people || []);
      await Store.saveMany("projects", data.projects || []);
      await Store.saveMany("tasks", data.tasks || []);
      App.toast("Backup restored");
    };
    input.click();
  };

  Exporter.open = () => {
    const open = [...Store.tasks.values()].filter(Model.isActive).length;
    const body = App.el(`<div>
      <button type="button" class="mrow" data-x="csv-open">${App.icon("table")}<div class="grow"><div>Open tasks → Excel (CSV)</div><div class="sub">${App.plural(open, "task")} with every column</div></div>${App.icon("download", "sm")}</button>
      <button type="button" class="mrow" data-x="csv-all">${App.icon("table")}<div class="grow"><div>All tasks, including finished → Excel (CSV)</div><div class="sub">${App.plural(Store.tasks.size, "task")}</div></div>${App.icon("download", "sm")}</button>
      <button type="button" class="mrow" data-x="summary">${App.icon("review")}<div class="grow"><div>Monthly summary</div><div class="sub">“What I did this month” for status updates</div></div>${App.icon("right", "sm")}</button>
      <button type="button" class="mrow" data-x="backup">${App.icon("archive")}<div class="grow"><div>Download a backup</div><div class="sub">Everything as a JSON file</div></div>${App.icon("download", "sm")}</button>
      <button type="button" class="mrow" data-x="restore">${App.icon("upload")}<div class="grow"><div>Restore from a backup</div><div class="sub">Merges a backup file back in</div></div>${App.icon("right", "sm")}</button>
    </div>`);
    App.sheet.open({ title: "Export & reports", body, narrow: true });
    body.onclick = e => {
      const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return;
      if (x === "csv-open") Exporter.csv(false);
      if (x === "csv-all") Exporter.csv(true);
      if (x === "summary") Exporter.monthlySummary(App.today().slice(0, 7));
      if (x === "backup") Exporter.backup();
      if (x === "restore") { App.sheet.close(); Exporter.restore(); }
    };
  };

  global.Exporter = Exporter;
})(window);
