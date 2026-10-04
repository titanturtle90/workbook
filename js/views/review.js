/* Weekly review: a guided pass over wins, slips, follow-ups, gaps, stale work, and next week's load. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp, Actions = global.Actions;
  const esc = App.esc;
  const Views = global.Views = global.Views || {};

  /** True from Friday until the week's review is marked complete. */
  Views.reviewDue = () => {
    if (!Store.isReady()) return false;
    const dow = new Date().getDay();
    if (dow !== 5 && dow !== 6 && dow !== 0) return false;
    const last = Store.setting("lastReview", "");
    return !last || last < App.weekStart();
  };

  const item = (t, acts, meta) => `<div class="r-item" data-task-id="${esc(t.id)}">
    <div class="t" data-open><div>${esc(t.title)}</div><div class="m">${meta || [Model.requesterName(t), Model.projectName(t.projectId), t.due ? "due " + App.relDue(t.due).toLowerCase() : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
    <div class="acts">${acts}</div></div>`;
  const btn = (act, label, cls) => `<button type="button" class="btn xs ${cls || ""}" data-r="${act}">${label}</button>`;

  Views.review = {
    render(panel) {
      const all = [...Store.tasks.values()];
      const active = all.filter(Model.isActive);
      const wk = App.weekStart();
      const today = App.today();
      const won = all.filter(t => t.status === "done" && t.completedAt && App.isoToDateStr(t.completedAt) >= wk).sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      const overdue = active.filter(t => t.due && t.due < today).sort(Model.comparator("due"));
      const waiting = active.filter(Model.isWaiting).sort((a, b) => (a.waiting?.followUp || "9999").localeCompare(b.waiting?.followUp || "9999"));
      const noStep = active.filter(t => !Model.nextStep(t) && t.status !== "waiting").sort(Model.comparator("smart"));
      const staleCut = new Date(Date.now() - 14 * 86400000).toISOString();
      const stale = active.filter(t => (t.updatedAt || t.createdAt) < staleCut).sort((a, b) => (a.updatedAt || "").localeCompare(b.updatedAt || ""));
      const triage = active.filter(t => t.status === "new");
      const nextMon = App.addDays(7, wk), nextSun = App.addDays(13, wk);
      const nextWeek = active.filter(t => t.due && t.due >= nextMon && t.due <= nextSun).sort(Model.comparator("due"));
      const capacity = Number(Store.setting("weeklyCapacity", 30)) || 30;
      const load = nextWeek.reduce((s, t) => s + (t.estimate || 0), 0);
      const unestimated = nextWeek.filter(t => !t.estimate).length;
      const last = Store.setting("lastReview", "");
      const reviewedThisWeek = last && last >= wk;
      const step = (n, title, sub, body) => `<div class="review-step"><div class="rs-head"><span class="num">${n}</span><div class="grow"><h3>${esc(title)}</h3><div class="sub">${sub}</div></div></div>${body}</div>`;
      const none = msg => `<div class="muted" style="font-size:.86rem">${esc(msg)}</div>`;
      const loadPct = Math.min(100, Math.round(100 * load / capacity));

      panel.innerHTML = `
        <div class="page-head">
          <div><h1>Weekly review</h1><p class="lede">${reviewedThisWeek ? `Reviewed ${esc(App.fmtDateLong(last))} ✓` : last ? `Last review ${esc(App.fmtDateLong(last))}` : "About 10 minutes, best on Friday afternoon."}</p></div>
          <div class="head-actions"><button class="btn sm primary" type="button" data-finish>${App.icon("check", "sm")}${reviewedThisWeek ? "Mark reviewed again" : "Finish review"}</button></div>
        </div>
        ${step(1, "Wins this week", `${App.plural(won.length, "task")} finished since Monday`, won.length ? `<div>${won.slice(0, 30).map(t => item(t, "", `${esc(Model.requesterName(t) || "")}${t.completedAt ? " · " + esc(App.fmtIso(t.completedAt)) : ""}`)).join("")}</div>` : none("Nothing marked done yet this week."))}
        ${step(2, "Slipped", "Overdue: pick a new date, finish it, or let it go", overdue.length ? overdue.map(t => item(t, btn("tomorrow", "Tomorrow") + btn("monday", "Next Mon") + btn("week", "+1 week") + btn("done", "Done", "ghost") + btn("cancel", "Drop", "ghost"))).join("") : none("Nothing overdue. 🎉"))}
        ${step(3, "Waiting on others", "Nudge anyone you need to chase", waiting.length ? waiting.map(t => item(t, btn("nudged", "I nudged them") + btn("gotit", "Got it", "ghost"), `${esc(Model.personName(t.waiting?.personId) || "Someone")}${t.waiting?.since ? " since " + esc(App.fmtDate(t.waiting.since)) : ""}${t.waiting?.followUp ? " · follow up " + esc(App.relDue(t.waiting.followUp).toLowerCase()) : ""}`)).join("") : none("You're not waiting on anyone."))}
        ${step(4, "Missing a next step", "Every open task should have a clear next action", noStep.length ? noStep.slice(0, 25).map(t => item(t, btn("addstep", "Add next step"))).join("") : none("Every task has a next step."))}
        ${triage.length ? step(5, "New asks to triage", "Set a status, priority, and due date", triage.map(t => item(t, btn("start", "Start") + btn("open", "Open", "ghost"))).join("")) : ""}
        ${step(triage.length ? 6 : 5, "Gone quiet", "Untouched for 2+ weeks: still relevant?", stale.length ? stale.slice(0, 25).map(t => item(t, btn("open", "Open") + btn("done", "Done", "ghost") + btn("cancel", "Drop", "ghost"), `last touched ${esc(App.relative(t.updatedAt || t.createdAt))}`)).join("") : none("Nothing has gone stale."))}
        ${step(triage.length ? 7 : 6, "Next week", `${App.plural(nextWeek.length, "task")} due ${esc(App.fmtDate(nextMon))} – ${esc(App.fmtDate(nextSun))}`, `
          <div class="row"><span style="font-size:.86rem"><b>${Comp.fmtHours(load || 0)}</b> estimated of ${capacity}h capacity${unestimated ? ` · ${unestimated} without an estimate` : ""}</span><span class="grow"></span><button type="button" class="btn xs ghost" data-capacity>Change capacity</button></div>
          <div class="load-bar"><div style="width:${loadPct}%;background:${load > capacity ? "var(--red)" : load > capacity * 0.8 ? "var(--orange)" : "var(--green)"}"></div></div>
          ${load > capacity ? `<p class="mt-8" style="color:var(--red);font-size:.86rem">Over capacity. Consider moving or delegating something.</p>` : ""}
          <div class="mt-8">${nextWeek.length ? nextWeek.map(t => item(t, btn("open", "Open", "ghost"), `${esc(App.fmtDateLong(t.due))}${t.estimate ? " · " + Comp.fmtHours(t.estimate) : ""} · ${esc(Model.requesterName(t) || "")}`)).join("") : none("Nothing due next week yet.")}</div>`)}
      `;

      panel.onclick = e => {
        const row = e.target.closest("[data-task-id]"); if (!row) return;
        const t = Store.tasks.get(row.dataset.taskId); if (!t) return;
        const r = e.target.closest("[data-r]")?.dataset.r;
        if (!r) { if (e.target.closest("[data-open]")) global.Editor.open(t.id); return; }
        if (r === "tomorrow") Actions.setDue(t, App.addDays(1));
        else if (r === "monday") Actions.setDue(t, App.nextWeekday(1));
        else if (r === "week") Actions.setDue(t, App.addDays(7, t.due && t.due > today ? t.due : today));
        else if (r === "done") Actions.complete(t);
        else if (r === "cancel") Actions.setStatus(t, "cancelled");
        else if (r === "nudged") { const c = JSON.parse(JSON.stringify(t)); const who = Model.personName(c.waiting?.personId); Actions.addLog(c, who ? `Followed up with ${who}` : "Followed up", false); c.waiting = Object.assign({}, c.waiting, { followUp: App.addDays(Model.FOLLOW_UP_DAYS) }); Store.save("tasks", c); App.toast(`Logged · next follow-up in ${Model.FOLLOW_UP_DAYS} days`); }
        else if (r === "gotit") { const c = JSON.parse(JSON.stringify(t)); Actions.addLog(c, "No longer waiting", false); c.waiting = { personId: "", since: "", followUp: "" }; if (c.status === "waiting") c.status = "in_progress"; Store.save("tasks", c); }
        else if (r === "addstep") global.Editor.open(t.id, { focus: "step" });
        else if (r === "start") Actions.setStatus(t, "not_started");
        else if (r === "open") global.Editor.open(t.id);
      };
      panel.querySelector("[data-finish]").onclick = () => { Store.setSetting("lastReview", today); App.toast("Review done. Have a good weekend!"); };
      panel.querySelector("[data-capacity]").onclick = () => global.Settings.open();
    }
  };
})(window);
