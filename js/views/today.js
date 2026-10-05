/* Today: what needs you now, in order of urgency. Shown as the "Today" view of the Dashboard. */
(function (global) {
  "use strict";
  const App = global.App, Model = global.Model, Store = global.Store, Comp = global.Comp;
  const Views = global.Views = global.Views || {};

  const collapsed = () => App.lsGet("wb:todayCollapsed", { later: true });

  /** Buckets every active task into exactly one Today section. */
  Views.todayBuckets = () => {
    const b = { overdue: [], today: [], followup: [], week: [], waiting: [], triage: [], later: [] };
    const today = App.today();
    const endOfWeek = App.addDays(6, App.weekStart());
    [...Store.tasks.values()].filter(Model.isActive).forEach(t => {
      if (t.due && t.due < today) b.overdue.push(t);
      else if (t.due === today) b.today.push(t);
      else if (Model.followUpDue(t)) b.followup.push(t);
      else if (t.due && t.due <= endOfWeek) b.week.push(t);
      else if (Model.isWaiting(t)) b.waiting.push(t);
      else if (t.status === "new") b.triage.push(t);
      else b.later.push(t);
    });
    const smart = Model.comparator("smart");
    Object.values(b).forEach(list => list.sort(smart));
    b.week.sort(Model.comparator("due"));
    b.followup.sort((x, y) => (x.waiting.followUp || "").localeCompare(y.waiting.followUp || ""));
    b.waiting.sort((x, y) => (x.waiting?.followUp || "9999").localeCompare(y.waiting?.followUp || "9999"));
    return b;
  };

  Views.today = {
    greeting() {
      const hour = new Date().getHours();
      const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
      return `${greet} · ${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}`;
    },
    /**
     * Renders the Today stats + sections into `root` (the Dashboard panel's body).
     * Task clicks are handled by the Dashboard panel's own Comp.bindTasks; `rerender` redraws the Dashboard.
     */
    renderInto(root, rerender) {
      const b = Views.todayBuckets();
      const allFollow = [...Store.tasks.values()].filter(Model.followUpDue).length;
      const weekCount = b.week.length + b.today.length;
      const col = collapsed();
      const list = (tasks, opts) => tasks.length ? `<div class="list">${tasks.map(t => Comp.taskCard(t, opts)).join("")}</div>` : "";
      const sec = (id, title, tone, tasks, empty, opts) => (tasks.length || empty) ? Comp.section({
        id, title, tone, count: tasks.length, collapsible: true, collapsed: !!col[id],
        body: tasks.length ? list(tasks, opts) : Comp.emptyInline(empty)
      }) : "";
      const activeCount = [...Store.tasks.values()].filter(Model.isActive).length;

      root.innerHTML = `
        <div class="stats">
          <button class="stat ${b.overdue.length ? "red" : "zero"}" type="button" data-jump="overdue"><div class="n">${b.overdue.length}</div><div class="l">Overdue</div></button>
          <button class="stat ${b.today.length ? "orange" : "zero"}" type="button" data-jump="today"><div class="n">${b.today.length}</div><div class="l">Due today</div></button>
          <button class="stat ${allFollow ? "purple" : "zero"}" type="button" data-jump="followup"><div class="n">${allFollow}</div><div class="l">Follow-ups</div></button>
          <button class="stat ${weekCount ? "blue" : "zero"}" type="button" data-jump="week"><div class="n">${weekCount}</div><div class="l">This week</div></button>
        </div>
        ${activeCount === 0 ? `<div class="empty mt-24"><div class="big">🗂️</div><h3>Nothing on your plate</h3><p>Press <kbd>N</kbd> or tap + to capture your first ask.</p></div>` : ""}
        ${sec("overdue", "Overdue", "red", b.overdue)}
        ${sec("today", "Due today", "orange", b.today, activeCount ? "Nothing due today." : "")}
        ${sec("followup", "Follow up today", "orange", b.followup)}
        ${sec("week", "Rest of this week", "blue", b.week)}
        ${sec("waiting", "Waiting on others", "", b.waiting)}
        ${sec("triage", "New asks to triage", "", b.triage)}
        ${sec("later", "Later & no date", "", b.later)}
      `;
      root.querySelectorAll("[data-jump]").forEach(btn => btn.onclick = () => {
        const id = btn.dataset.jump;
        const c = collapsed();
        if (c[id]) { delete c[id]; App.lsSet("wb:todayCollapsed", c); rerender(); }
        const el = document.querySelector(`#panel-tasks [data-section="${id}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        else App.toast("Nothing here right now");
      });
      root.querySelectorAll("[data-collapse]").forEach(btn => btn.onclick = e => {
        e.stopPropagation();
        const c = collapsed(); c[btn.dataset.collapse] = !c[btn.dataset.collapse]; App.lsSet("wb:todayCollapsed", c);
        rerender();
      });
    }
  };
})(window);
