/*
 * Store: in-memory maps of tasks / people / projects / meta, kept in sync
 * with either Firestore (signed in: users/{uid}/{collection}) or this
 * device's localStorage (preview mode). Views read the maps directly and
 * re-render on the "data" event.
 */
(function (global) {
  "use strict";
  const App = global.App;
  const COLS = ["tasks", "people", "projects", "meta"];
  const LOCAL_PREFIX = "wb:local:";

  const Store = {
    tasks: new Map(),
    people: new Map(),
    projects: new Map(),
    meta: new Map(),
    mode: null,
    uid: null,
    loaded: new Set()
  };
  let userDoc = null;
  let unsubs = [];

  // Firestore rejects `undefined`; a JSON round-trip also deep-copies.
  const clean = obj => JSON.parse(JSON.stringify(obj));

  let emitQueued = false;
  function changed() {
    if (emitQueued) return;
    emitQueued = true;
    requestAnimationFrame(() => { emitQueued = false; App.emit("data"); });
  }

  function markLoaded(col) {
    const was = Store.loaded.size;
    Store.loaded.add(col);
    if (was < COLS.length && Store.loaded.size === COLS.length) App.emit("data-ready");
  }

  Store.isReady = () => Store.loaded.size === COLS.length;

  Store.start = function ({ mode, uid }) {
    Store.stop();
    Store.mode = mode; Store.uid = uid || null;
    if (mode === "local") {
      COLS.forEach(col => {
        const raw = App.lsGet(LOCAL_PREFIX + col, {});
        Object.values(raw).forEach(doc => Store[col].set(doc.id, doc));
        markLoaded(col);
      });
      App.setSync("local", "Preview · this device only");
      changed();
      return;
    }
    userDoc = App.db.collection("users").doc(uid);
    COLS.forEach(col => {
      const unsub = userDoc.collection(col).onSnapshot({ includeMetadataChanges: false }, snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === "removed") Store[col].delete(ch.doc.id);
          else Store[col].set(ch.doc.id, Object.assign({ id: ch.doc.id }, ch.doc.data()));
        });
        markLoaded(col);
        App.setSync("synced", navigator.onLine ? "Synced" : "Offline · will sync");
        changed();
      }, err => {
        console.error("Sync error", col, err);
        App.setSync("error", err.code === "permission-denied" ? "No access — check Firestore rules" : "Sync error");
        markLoaded(col);
      });
      unsubs.push(unsub);
    });
  };

  Store.stop = function () {
    unsubs.forEach(u => { try { u(); } catch (e) { /* ignore */ } });
    unsubs = [];
    COLS.forEach(col => Store[col].clear());
    Store.loaded.clear();
  };

  function persistLocal(col) {
    const obj = {};
    Store[col].forEach((v, k) => { obj[k] = v; });
    App.lsSet(LOCAL_PREFIX + col, obj);
  }

  Store.save = function (col, doc) {
    if (!doc.id) doc.id = App.genId();
    doc.updatedAt = new Date().toISOString();
    const data = clean(doc);
    Store[col].set(data.id, data);
    changed();
    if (Store.mode === "local") { persistLocal(col); return Promise.resolve(data); }
    return userDoc.collection(col).doc(data.id).set(data).then(() => data).catch(err => {
      console.error(err); App.toast("Couldn't save — " + (err.code || "sync error"));
    });
  };

  Store.saveMany = function (col, docs) {
    const now = new Date().toISOString();
    const datas = docs.map(d => { if (!d.id) d.id = App.genId(); d.updatedAt = d.updatedAt || now; return clean(d); });
    datas.forEach(d => Store[col].set(d.id, d));
    changed();
    if (Store.mode === "local") { persistLocal(col); return Promise.resolve(); }
    // Firestore batches cap at 500 writes.
    const chunks = [];
    for (let i = 0; i < datas.length; i += 450) chunks.push(datas.slice(i, i + 450));
    return Promise.all(chunks.map(chunk => {
      const b = App.db.batch();
      chunk.forEach(d => b.set(userDoc.collection(col).doc(d.id), d));
      return b.commit();
    })).catch(err => { console.error(err); App.toast("Couldn't save — " + (err.code || "sync error")); });
  };

  Store.remove = function (col, id) {
    Store[col].delete(id);
    changed();
    if (Store.mode === "local") { persistLocal(col); return Promise.resolve(); }
    return userDoc.collection(col).doc(id).delete().catch(err => { console.error(err); App.toast("Couldn't delete — " + (err.code || "sync error")); });
  };

  // ---------- settings (stored in meta/settings so they follow you across devices) ----------
  Store.settings = () => Store.meta.get("settings") || { id: "settings" };
  Store.setting = (key, fallback) => { const v = Store.settings()[key]; return v === undefined ? fallback : v; };
  Store.setSetting = (key, value) => { const s = Object.assign({}, Store.settings(), { id: "settings" }); s[key] = value; return Store.save("meta", s); };

  // ---------- preview data left on this device (offered for import after sign-in) ----------
  Store.localPreviewData = () => {
    const out = {};
    COLS.forEach(col => { out[col] = Object.values(App.lsGet(LOCAL_PREFIX + col, {})); });
    return out;
  };
  Store.clearLocalPreview = () => COLS.forEach(col => { try { localStorage.removeItem(LOCAL_PREFIX + col); } catch (e) { /* ignore */ } });

  global.Store = Store;
})(window);
