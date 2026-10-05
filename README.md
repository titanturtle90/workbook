# Workbook

A personal, installable work task organizer (PWA). It tracks every ask: **who asked**, **what they asked**, **your next step**, **when it's due**, and **which project it belongs to**. Use it on your work computer and your phone, synced through your own Firebase project.

No build step: plain HTML/CSS/JS served statically (GitHub Pages), with Firebase Auth + Firestore for private sync.

## What's in it

| Area | What it does |
| --- | --- |
| **Dashboard** | Switch between three views (top right, or press `T`): **Today** (overdue, due today, follow-ups due, the rest of this week, waiting on others, new asks to triage, then everything else), **Table** (sortable columns, group by requester / project / status / priority / due) and **Board** (drag cards between statuses). Table and Board share search plus filters for who asked, project, status, priority, due, tags, and self-assigned. On a phone the table becomes cards. |
| **People** | Everyone who asks you for things: open asks, overdue, what you're waiting on them for, and their history. "Me" holds your self-assigned tasks. |
| **Projects** | Name, color, short description and an optional photo; progress bar, open/done counts, next due date, and a page per project. |
| **Done** | Searchable archive of finished work, filterable by month. |
| **Weekly review** | A guided Friday pass: wins, slipped tasks, follow-ups, tasks missing a next step, stale tasks, and next week's load vs. your capacity. |
| **Export** | CSV for Excel (open or all tasks), a "what I did this month" summary, and JSON backup/restore. |

Every task has: the ask, requester (or **Me** for self-assigned), project, due date, status (New, Not Started, In Progress, Waiting On Someone, In Review, Blocked, Done, Cancelled), priority (High/Medium/Low, raised automatically as the due date approaches), an ordered **next steps** checklist, a dated **activity log**, who you're **waiting on** with a follow-up date, links, a time estimate, tags, and an optional **repeat** schedule (a new copy is created when you finish it).

**Screenshots:** snip the original request (e.g. `Win+Shift+S` on Windows, `Cmd+Shift+4` on Mac) and paste it with `Ctrl+V`/`Cmd+V`. Paste anywhere in Workbook to start a new task with the snip attached, or paste/drop/choose an image under **Next step** in a task. On a phone, pick from your photos or take a photo. Screenshots are shrunk to fit in Firestore (`users/{uid}/images`) and load only when you open a task; click one to see it full size.

**Meeting mode** lets you set the meeting, default requester, project, and due date once, then type asks one after another.

## Keyboard shortcuts

Press `?` in the app for the full list.

| Key | Action | Key | Action |
| --- | --- | --- | --- |
| `N` | New task | `J` / `K` | Next / previous task |
| `Shift+N` | New self-assigned task | `Enter` | Open selected task |
| `M` | Meeting mode | `X` | Mark done / reopen |
| `/` | Search | `S` | Change status (then `1`–`8`) |
| `1`–`5` | Dashboard, People, Projects, Done, Review | `P` | Cycle priority |
| `T` | Switch Today → Table → Board | `D` | Change due date |
| `[` | Collapse / expand the side menu |
| `Esc` | Close | `F` | Finish the next step |
| | | `L` | Log a note |

## Setup

### 1. Publish with GitHub Pages
Repository → **Settings → Pages** → Source: *Deploy from a branch* → Branch: `main`, folder `/ (root)` → Save. After a minute the app is live at `https://<your-username>.github.io/workbook/`.

Until Firebase is connected, the app runs in **preview mode**: everything stays in that one browser. After you sign in, it offers to import that preview data into your account.

### 2. Create a Firebase project (free)
1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `workbook`). Google Analytics isn't needed.
2. **Build → Authentication → Get started → Sign-in method**:
   - Enable **Google**.
   - Enable **Email/Password**, and inside it turn on **Email link (passwordless sign-in)**. This is the backup for when a work computer blocks Google pop-ups.
   - **Settings → Authorized domains → Add domain** → `<your-username>.github.io`.
3. **Build → Firestore Database → Create database** → *Start in production mode* → pick a location near you.
4. Firestore → **Rules** tab → paste the contents of [`firestore.rules`](firestore.rules) → **Publish**. This makes your data readable only by you.
5. **Project settings (gear icon) → General → Your apps → Web (`</>`)** → register an app (no hosting needed) → copy the `firebaseConfig` values into [`js/firebase-config.js`](js/firebase-config.js) and commit.

The web config is not a secret. Access is controlled by sign-in plus the Firestore rules.

### 3. Install it
- **iPhone:** open the site in Safari → Share → **Add to Home Screen**.
- **Android:** Chrome → menu → **Install app**.
- **Desktop:** Chrome/Edge → the install icon in the address bar (or just bookmark it).

## Project layout

```
index.html               app shell + icons
css/app.css              design system (navy, light + dark)
js/firebase-config.js    your Firebase web config (empty = preview mode)
js/core.js               helpers, dates, toast, dialog, sheet/drawer, menus, autocomplete
js/model.js              task shape, statuses, priority bumping, sort/group/filter, recurrence
js/store.js              Firestore (users/{uid}/…) or local preview storage
js/components.js         task cards/pills + shared actions (complete, status, steps…)
js/editor.js             quick add, meeting mode, full task editor
js/views/*.js            Dashboard (Today/Table/Board), People, Projects, Done, Weekly review
js/export.js             CSV, monthly summary, backup/restore
js/shortcuts.js          keyboard shortcuts
js/app.js                sign-in, routing, navigation, settings
sw.js, manifest.json     offline + install
firestore.rules          security rules to paste into Firebase
```

Data lives in Firestore under `users/{uid}/tasks`, `users/{uid}/people`, `users/{uid}/projects`, `users/{uid}/images` (screenshots), and `users/{uid}/meta/settings`.

When you change a JS/CSS file, bump the `?v=` number in `index.html` and `sw.js` (and `CACHE_NAME`) so installed copies pick up the update.
