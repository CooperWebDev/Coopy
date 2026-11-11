// Persistence (Stage 12): the project JSON and the imported media files are kept in IndexedDB,
// autosaved after edits and restored on load. "Save" also downloads a portable .coopy.json
// (project only: media files stay in this browser, see README).
import { bus } from "./events.js";
import { store } from "./store.js";
import { mediaFiles } from "./media.js";

const DB = "coopy", VERSION = 1;
let dbp = null;
const open = () => dbp ??= new Promise((res, rej) => {
  const r = indexedDB.open(DB, VERSION);
  r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("media"); };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
const tx = async (store_, mode, fn) => {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store_, mode);
    const out = fn(t.objectStore(store_));
    t.oncomplete = () => res(out?.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
};

export async function saveNow() {
  const p = store.project;
  const ids = new Set(p.media.map((m) => m.id));
  await tx("kv", "readwrite", (s) => s.put(p, "project"));
  const have = new Set(await tx("media", "readonly", (s) => s.getAllKeys()));
  for (const id of ids) {
    if (have.has(id)) continue;
    const rec = mediaFiles.get(id);
    if (rec) await tx("media", "readwrite", (s) => s.put(rec.file, id));
  }
  for (const id of have) if (!ids.has(id)) await tx("media", "readwrite", (s) => s.delete(id));
  store.dirty = false;
  bus.emit("project:saved");
}

/** Load project + media from IndexedDB. Returns the project or null. */
export async function restore() {
  const p = await tx("kv", "readonly", (s) => s.get("project"));
  if (!p || !Array.isArray(p.clips)) return null;
  return hydrate(p);
}

/** Re-attach media files stored in IndexedDB to a project's media records. Returns { project, missing }. */
export async function hydrate(p) {
  const missing = [];
  for (const m of p.media) {
    const file = await tx("media", "readonly", (s) => s.get(m.id));
    if (file) mediaFiles.set(m.id, { file, url: URL.createObjectURL(file) });
    else missing.push(m.name);
  }
  return { project: p, missing };
}

export function downloadProject() {
  const blob = new Blob([JSON.stringify({ coopy: 1, project: store.project }, null, 1)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${store.project.name.replace(/[^\w\- ]+/g, "_")}.coopy.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function parseProjectFile(file) {
  const j = JSON.parse(await file.text());
  const p = j.project ?? j;
  if (!p || !Array.isArray(p.clips) || !Array.isArray(p.tracks) || !p.settings) throw new Error("Not a Coopy project file");
  p.media ??= []; p.bins ??= [{ id: "master", name: "Master", parentId: null }];
  return p;
}

let timer = 0;
export function initAutosave() {
  bus.on("project:changed", () => {
    clearTimeout(timer);
    timer = setTimeout(() => saveNow().catch((e) => console.warn("autosave failed", e)), 1500);
  });
  window.addEventListener("beforeunload", (e) => { if (store.dirty) { e.preventDefault(); e.returnValue = ""; } });
}
