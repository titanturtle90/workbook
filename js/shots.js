/*
 * Shots: screenshots attached to a task (e.g. a snip of the original request).
 * Paste (Ctrl+V / ⌘V), drag-and-drop, or pick a file / take a photo. Images are
 * shrunk in the browser so each fits in a single Firestore document.
 */
(function (global) {
  "use strict";
  const App = global.App, Store = global.Store;
  const esc = App.esc;
  const Shots = {};

  const MAX_SIDE = 1800;          // px; plenty to read a snipped email
  const MAX_CHARS = 900000;       // Firestore docs cap at 1 MiB; leave headroom

  /** Image files from a paste/drop DataTransfer. */
  Shots.imageFiles = dt => {
    if (!dt) return [];
    const files = [...(dt.files || [])].filter(f => f.type.startsWith("image/"));
    if (files.length) return files;
    return [...(dt.items || [])].filter(i => i.kind === "file" && i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean);
  };

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file couldn't be read as an image.")); };
      img.src = url;
    });
  }

  /** Shrinks an image file to a data URL that fits in one Firestore document. */
  Shots.compress = async file => {
    const img = await loadImage(file);
    let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    let quality = 0.85;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    for (let attempt = 0; attempt < 12; attempt++) {
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      ctx.fillStyle = "#fff"; // transparent PNG snips → white, not black, in JPEG
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/webp")) data = canvas.toDataURL("image/jpeg", quality); // Safari without WebP encoding
      if (data.length <= MAX_CHARS) return { data, w: canvas.width, h: canvas.height };
      if (quality > 0.55) quality -= 0.1; else scale *= 0.8;
    }
    throw new Error("That image is too large to attach.");
  };

  /** Compresses files into unsaved image objects ({ id, data, w, h, createdAt }). */
  Shots.prepare = async files => {
    const out = [];
    for (const f of files) {
      const c = await Shots.compress(f);
      out.push({ id: App.genId(), data: c.data, w: c.w, h: c.h, createdAt: new Date().toISOString() });
    }
    return out;
  };
  /** Saves a prepared image and returns the small reference kept on the task. */
  Shots.save = img => Store.putImage(img).then(() => ({ id: img.id, w: img.w, h: img.h, at: img.createdAt }));

  // ---------- thumbnails ----------
  /**
   * Renders thumbnails into `el`. items: refs ({id}) or prepared images ({id, data}).
   * opts.onRemove(id) shows a remove button on each.
   */
  Shots.renderStrip = (el, items, opts) => {
    opts = opts || {};
    el.innerHTML = items.map(it => `<div class="shot" data-shot="${esc(it.id)}" title="Click to view full size">
      ${it.data ? `<img src="${esc(it.data)}" alt="Screenshot">` : `<span class="shot-loading">Loading…</span>`}
      ${opts.onRemove ? `<button type="button" class="rm" data-rm="${esc(it.id)}" aria-label="Remove screenshot" title="Remove">${App.icon("x", "xs")}</button>` : ""}
    </div>`).join("");
    items.filter(it => !it.data).forEach(it => {
      Store.getImage(it.id).then(img => {
        const box = el.querySelector(`[data-shot="${CSS.escape(it.id)}"]`);
        if (!box) return;
        const slot = box.querySelector(".shot-loading");
        if (!slot) return;
        if (img) slot.outerHTML = `<img src="${esc(img.data)}" alt="Screenshot">`;
        else slot.textContent = "Missing";
      }).catch(() => {
        const slot = el.querySelector(`[data-shot="${CSS.escape(it.id)}"] .shot-loading`);
        if (slot) slot.textContent = "Offline";
      });
    });
    el.onclick = e => {
      const rm = e.target.closest("[data-rm]");
      if (rm) { e.stopPropagation(); opts.onRemove(rm.dataset.rm); return; }
      const box = e.target.closest("[data-shot]");
      if (box) {
        const local = items.find(x => x.id === box.dataset.shot && x.data);
        Shots.view(box.dataset.shot, local && local.data);
      }
    };
  };

  /** A drop zone that also accepts a click (file picker / camera on phones). */
  Shots.dropZone = (el, onFiles, opts) => {
    opts = opts || {};
    const what = opts.label || "screenshot";
    el.classList.add("shot-drop");
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "button");
    const touch = global.matchMedia("(hover: none)").matches;
    el.innerHTML = touch
      ? `${App.icon("image", "sm")}<span><b>Add a ${what}</b> from your photos, or take a photo</span>`
      : `${App.icon("image", "sm")}<span><b>Paste a ${what}</b> (${/Mac/.test(navigator.platform) ? "⌘V" : "Ctrl+V"}), drop an image, or <u>choose a file</u></span>`;
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*"; input.multiple = !opts.single; input.hidden = true;
    el.after(input);
    const pick = () => input.click();
    el.addEventListener("click", pick);
    el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    input.addEventListener("change", () => { const files = [...input.files]; input.value = ""; if (files.length) onFiles(files); });
    el.addEventListener("dragover", e => { if (Shots.hasImage(e.dataTransfer)) { e.preventDefault(); el.classList.add("over"); } });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", e => {
      el.classList.remove("over");
      const files = Shots.imageFiles(e.dataTransfer);
      if (files.length) { e.preventDefault(); onFiles(files); }
    });
  };
  Shots.hasImage = dt => !!dt && [...(dt.items || [])].some(i => i.kind === "file" && (!i.type || i.type.startsWith("image/")));

  /**
   * While the sheet holding `root` is open, any pasted image goes to onFiles, wherever
   * the cursor is. Images in the clipboard win over text. Unhooks itself once `root` is replaced.
   */
  Shots.onPaste = (root, onFiles) => {
    const handler = e => {
      if (!root.isConnected) { document.removeEventListener("paste", handler); return; }
      if (!App.sheet.isOpen() || Shots.isViewing()) return;
      const files = Shots.imageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      onFiles(files);
    };
    document.addEventListener("paste", handler);
  };

  /** Loads images into every empty [data-img] element under root (as a background cover). */
  Shots.fillImages = root => {
    root.querySelectorAll("[data-img]").forEach(el => {
      if (el.style.backgroundImage) return;
      Store.getImage(el.dataset.img).then(img => {
        if (img && el.isConnected) { el.style.backgroundImage = `url("${img.data}")`; el.classList.add("loaded"); }
      }).catch(() => {});
    });
  };

  // ---------- full-size viewer ----------
  let box = null;
  Shots.view = async (id, data) => {
    if (!box) {
      box = App.el(`<div class="lightbox" role="dialog" aria-label="Screenshot">
        <div class="lb-bar"><a class="btn sm" data-open target="_blank" rel="noopener">${App.icon("external", "sm")}Open</a><a class="btn sm" data-dl download="screenshot">${App.icon("download", "sm")}Save</a><button type="button" class="btn sm" data-close>${App.icon("x", "sm")}Close</button></div>
        <img alt="Screenshot">
      </div>`);
      document.body.appendChild(box);
      box.addEventListener("click", e => { if (e.target === box || e.target.closest("[data-close]")) Shots.closeView(); });
      document.addEventListener("keydown", e => { if (box.classList.contains("show") && e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); Shots.closeView(); } }, true);
    }
    let src = data;
    if (!src) { const img = await Store.getImage(id).catch(() => null); if (!img) { App.toast("Couldn't load that screenshot"); return; } src = img.data; }
    box.querySelector("img").src = src;
    // Data URLs can't open in a new tab directly in most browsers; use a blob URL.
    const blob = await (await fetch(src)).blob();
    const url = URL.createObjectURL(blob);
    if (box._url) URL.revokeObjectURL(box._url);
    box._url = url;
    box.querySelector("[data-open]").href = url;
    const dl = box.querySelector("[data-dl]");
    dl.href = url; dl.download = `screenshot-${id}.${blob.type.includes("webp") ? "webp" : "jpg"}`;
    box.classList.add("show");
  };
  Shots.closeView = () => { if (box) box.classList.remove("show"); };
  Shots.isViewing = () => !!box && box.classList.contains("show");

  // ---------- cleanup ----------
  /** Deletes images no task references any more. Waits so an "Undo" can bring a task back first. */
  Shots.cleanupLater = (ids, delay) => {
    if (!ids || !ids.length) return;
    setTimeout(() => {
      const used = new Set();
      Store.tasks.forEach(t => (t.shots || []).forEach(s => used.add(s.id)));
      Store.projects.forEach(p => { if (p.photo) used.add(p.photo.id); });
      ids.filter(id => !used.has(id)).forEach(id => Store.removeImage(id));
    }, delay == null ? 10000 : delay);
  };

  global.Shots = Shots;
})(window);
