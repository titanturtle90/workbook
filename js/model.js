/*
 * Model: the task data shape, constants, and pure logic (next step,
 * effective priority, due buckets, sorting, grouping, filtering, recurrence).
 * No DOM access here.
 */
(function (global) {
  "use strict";
  const App = global.App;

  const STATUSES = [
    { key: "new", label: "New", color: "blue" },
    { key: "not_started", label: "Not Started", color: "gray" },
    { key: "in_progress", label: "In Progress", color: "accent" },
    { key: "waiting", label: "Waiting On Someone", short: "Waiting", color: "orange" },
    { key: "in_review", label: "In Review", color: "purple" },
    { key: "blocked", label: "Blocked", color: "red" },
    { key: "done", label: "Done", color: "green" },
    { key: "cancelled", label: "Cancelled", color: "gray" }
  ];
  const STATUS_DOT = { blue: "var(--blue)", gray: "var(--gray)", accent: "var(--accent)", orange: "var(--orange)", purple: "var(--purple)", red: "var(--red)", green: "var(--green)" };
  const PRIORITIES = [
    { key: "high", label: "High", rank: 3, color: "orange" },
    { key: "medium", label: "Medium", rank: 2, color: "blue" },
    { key: "low", label: "Low", rank: 1, color: "gray" }
  ];
  const SOURCES = [
    { key: "email", label: "Email", icon: "mail" },
    { key: "chat", label: "Teams / Chat", icon: "chat" },
    { key: "meeting", label: "Meeting", icon: "meeting" },
    { key: "in_person", label: "In person / Call", icon: "phone" },
    { key: "self", label: "Self", icon: "me" }
  ];
  const RECURRENCE = [
    { key: "", label: "Doesn't repeat" },
    { key: "daily", label: "Every day" },
    { key: "weekdays", label: "Every weekday" },
    { key: "weekly", label: "Every week" },
    { key: "biweekly", label: "Every 2 weeks" },
    { key: "monthly", label: "Every month" },
    { key: "quarterly", label: "Every 3 months" }
  ];
  const PROJECT_COLORS = ["#2a5bd7", "#7149d0", "#0e8a7d", "#1f8a4c", "#a67c00", "#d0700a", "#d43a2f", "#be185d", "#0369a1", "#475569"];
  const ME = "me";

  const Model = { STATUSES, PRIORITIES, SOURCES, RECURRENCE, PROJECT_COLORS, ME };
  Model.ACTIVE_STATUSES = STATUSES.filter(s => s.key !== "done" && s.key !== "cancelled");
  Model.status = key => STATUSES.find(s => s.key === key) || STATUSES[0];
  Model.statusDot = key => STATUS_DOT[Model.status(key).color];
  Model.priority = key => PRIORITIES.find(p => p.key === key) || PRIORITIES[1];
  Model.source = key => SOURCES.find(s => s.key === key);
  Model.recurrence = key => RECURRENCE.find(r => r.key === (key || "")) || RECURRENCE[0];

  Model.newTask = (partial) => {
    const now = new Date().toISOString();
    return Object.assign({
      id: App.genId(),
      title: "",
      details: "",
      requesterId: "",
      projectId: "",
      status: "new",
      priority: "medium",
      due: "",
      steps: [],
      log: [],
      waiting: { personId: "", since: "", followUp: "" },
      links: [],
      estimate: null,
      tags: [],
      recurrence: "",
      source: "",
      createdAt: now,
      updatedAt: now,
      completedAt: ""
    }, partial || {});
  };

  Model.isActive = t => t.status !== "done" && t.status !== "cancelled";
  Model.isSelf = t => t.requesterId === ME;
  Model.nextStep = t => (t.steps || []).find(s => !s.done) || null;
  Model.stepProgress = t => { const s = t.steps || []; return { done: s.filter(x => x.done).length, total: s.length }; };

  // ---------- due dates ----------
  Model.dueBucket = t => {
    if (!t.due) return "none";
    const n = App.daysUntil(t.due);
    if (n < 0) return "overdue";
    if (n === 0) return "today";
    if (n === 1) return "tomorrow";
    const endOfWeek = App.addDays(6, App.weekStart());
    if (t.due <= endOfWeek) return "week";
    if (n <= 14) return "next";
    return "later";
  };
  Model.DUE_BUCKETS = { overdue: "Overdue", today: "Due today", tomorrow: "Due tomorrow", week: "Later this week", next: "Next 2 weeks", later: "Later", none: "No due date" };
  Model.dueTone = t => {
    if (!t.due || !Model.isActive(t)) return "gray";
    const b = Model.dueBucket(t);
    return b === "overdue" ? "red" : b === "today" ? "orange" : b === "tomorrow" ? "yellow" : "gray";
  };

  // ---------- priority: manual level, bumped up as the due date nears ----------
  // urgent(4) when overdue / due today / tomorrow; at least high(3) within 3 days; at least medium(2) within 7.
  Model.effRank = t => {
    const base = Model.priority(t.priority).rank;
    if (!t.due || !Model.isActive(t)) return base;
    const n = App.daysUntil(t.due);
    let bump = 0;
    if (n <= 1) bump = 4; else if (n <= 3) bump = 3; else if (n <= 7) bump = 2;
    return Math.max(base, bump);
  };
  Model.effPriority = t => {
    const r = Model.effRank(t);
    const bumped = r > Model.priority(t.priority).rank;
    if (r === 4) return { key: "urgent", label: "Urgent", color: "red", bumped };
    const p = PRIORITIES.find(x => x.rank === r);
    return { key: p.key, label: p.label, color: p.color, bumped };
  };

  // ---------- waiting / follow-ups ----------
  Model.isWaiting = t => Model.isActive(t) && (t.status === "waiting" || !!(t.waiting && t.waiting.personId && t.waiting.followUp));
  Model.followUpDue = t => Model.isWaiting(t) && t.waiting && t.waiting.followUp && t.waiting.followUp <= App.today();

  // ---------- recurrence ----------
  Model.nextOccurrence = (t) => {
    const base = t.due || App.today();
    // Advance from the original due date, but never land in the past.
    let next = step(base, t.recurrence);
    let guard = 0;
    while (next < App.today() && guard++ < 500) next = step(next, t.recurrence);
    return next;
    function step(from, rule) {
      switch (rule) {
        case "daily": return App.addDays(1, from);
        case "weekdays": { let d = App.addDays(1, from); while ([0, 6].includes(App.parseDate(d).getDay())) d = App.addDays(1, d); return d; }
        case "weekly": return App.addDays(7, from);
        case "biweekly": return App.addDays(14, from);
        case "monthly": return App.addMonths(1, from);
        case "quarterly": return App.addMonths(3, from);
        default: return from;
      }
    }
  };

  // ---------- lookups (need Store; resolved lazily) ----------
  Model.person = id => id && id !== ME ? global.Store.people.get(id) : null;
  Model.personName = id => id === ME ? "Me" : (Model.person(id)?.name || "");
  Model.project = id => id ? global.Store.projects.get(id) : null;
  Model.projectName = id => Model.project(id)?.name || "";
  Model.requesterName = t => Model.personName(t.requesterId) || "";

  // ---------- filtering ----------
  /**
   * filters: { q, requesters:[], projects:[], statuses:[], priorities:[], tags:[], self: bool|null, due: "" | bucket }
   */
  Model.matches = (t, f) => {
    if (!f) return true;
    if (f.requesters && f.requesters.length && !f.requesters.includes(t.requesterId || "")) return false;
    if (f.projects && f.projects.length && !f.projects.includes(t.projectId || "")) return false;
    if (f.statuses && f.statuses.length && !f.statuses.includes(t.status)) return false;
    if (f.priorities && f.priorities.length && !f.priorities.includes(Model.effPriority(t).key)) return false;
    if (f.tags && f.tags.length && !f.tags.every(tag => (t.tags || []).includes(tag))) return false;
    if (f.self === true && !Model.isSelf(t)) return false;
    if (f.self === false && Model.isSelf(t)) return false;
    if (f.due) {
      const b = Model.dueBucket(t);
      if (f.due === "week" ? !["overdue", "today", "tomorrow", "week"].includes(b) : b !== f.due) return false;
    }
    if (f.q) {
      const hay = [t.title, t.details, Model.requesterName(t), Model.projectName(t.projectId), (t.tags || []).join(" "),
        (t.steps || []).map(s => s.text).join(" "), (t.log || []).map(l => l.text).join(" "),
        Model.personName(t.waiting?.personId)].join(" ").toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))) return false;
    }
    return true;
  };

  // ---------- sorting ----------
  Model.SORTS = [
    { key: "smart", label: "Smart (priority + due)" },
    { key: "due", label: "Due date" },
    { key: "requester", label: "Who asked" },
    { key: "title", label: "The ask (A–Z)" },
    { key: "next", label: "Next step (A–Z)" },
    { key: "project", label: "Project" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "created", label: "Newest first" },
    { key: "updated", label: "Recently updated" }
  ];
  const cmpStr = (a, b) => (a || "￿").localeCompare(b || "￿", undefined, { sensitivity: "base" });
  const dueKey = t => t.due || "9999-12-31";
  const smart = (a, b) => (Model.effRank(b) - Model.effRank(a)) || dueKey(a).localeCompare(dueKey(b)) || cmpStr(a.title, b.title);
  Model.comparator = (key, dir) => {
    const sign = dir === "desc" ? -1 : 1;
    const by = {
      smart,
      due: (a, b) => dueKey(a).localeCompare(dueKey(b)) || smart(a, b),
      requester: (a, b) => cmpStr(Model.requesterName(a), Model.requesterName(b)) || smart(a, b),
      title: (a, b) => cmpStr(a.title, b.title),
      next: (a, b) => cmpStr(Model.nextStep(a)?.text, Model.nextStep(b)?.text) || smart(a, b),
      project: (a, b) => cmpStr(Model.projectName(a.projectId), Model.projectName(b.projectId)) || smart(a, b),
      status: (a, b) => (STATUSES.findIndex(s => s.key === a.status) - STATUSES.findIndex(s => s.key === b.status)) || smart(a, b),
      priority: (a, b) => (Model.effRank(b) - Model.effRank(a)) || dueKey(a).localeCompare(dueKey(b)),
      created: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
      updated: (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")
    }[key] || smart;
    return (a, b) => sign * by(a, b);
  };

  // ---------- grouping ----------
  Model.GROUPS = [
    { key: "", label: "No grouping" },
    { key: "requester", label: "Who asked" },
    { key: "project", label: "Project" },
    { key: "status", label: "Status" },
    { key: "priority", label: "Priority" },
    { key: "due", label: "Due date" }
  ];
  /** Returns [{key, label, color?, tasks}] in a sensible order. */
  Model.group = (tasks, by) => {
    if (!by) return [{ key: "", label: "", tasks }];
    const map = new Map();
    const add = (k, meta, t) => { if (!map.has(k)) map.set(k, Object.assign({ key: k, tasks: [] }, meta)); map.get(k).tasks.push(t); };
    tasks.forEach(t => {
      if (by === "requester") { const id = t.requesterId || ""; add(id, { label: id ? Model.personName(id) || "Unknown" : "No requester", order: id === ME ? "0" : id ? "1" + Model.personName(id).toLowerCase() : "2" }, t); }
      else if (by === "project") { const p = Model.project(t.projectId); add(p ? p.id : "", { label: p ? p.name : "No project", color: p?.color, order: p ? "0" + p.name.toLowerCase() : "1" }, t); }
      else if (by === "status") { const i = STATUSES.findIndex(s => s.key === t.status); add(t.status, { label: Model.status(t.status).label, dot: Model.statusDot(t.status), order: String(i).padStart(2, "0") }, t); }
      else if (by === "priority") { const p = Model.effPriority(t); add(p.key, { label: p.label, order: String(9 - Model.effRank(t)) }, t); }
      else if (by === "due") { const b = Model.dueBucket(t); add(b, { label: Model.DUE_BUCKETS[b], order: String(Object.keys(Model.DUE_BUCKETS).indexOf(b)) }, t); }
    });
    return [...map.values()].sort((a, b) => a.order.localeCompare(b.order));
  };

  Model.allTags = () => {
    const counts = new Map();
    global.Store.tasks.forEach(t => (t.tags || []).forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag);
  };

  global.Model = Model;
})(window);
