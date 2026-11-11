import { bus } from "./core/events.js";
import { store } from "./core/store.js";
import { initPanels } from "./ui/panels.js";
import { initTimeline } from "./ui/timeline.js";
import { initPreview } from "./ui/preview.js";
import { initShortcuts } from "./ui/shortcuts.js";
import { initMenus } from "./ui/menus.js";
import { initMediaPool } from "./ui/mediapool.js";
import { initInspector } from "./ui/inspector.js";
import { initEditing } from "./ui/editing.js";
import { initProps } from "./ui/props.js";
import { initAutosave, restore, saveNow } from "./core/persist.js";
import { toast } from "./ui/toast.js";

function updateStatus() {
  const s = store.project.settings;
  document.getElementById("sbProject").textContent = `${s.width}×${s.height} · ${s.fps} fps`;
  const pill = document.getElementById("saveStatus");
  pill.textContent = store.dirty ? "Unsaved changes" : "Saved";
  pill.className = `status-pill ${store.dirty ? "dirty" : ""}`;
}

function boot() {
  initPanels();
  initPreview();
  initTimeline();
  initMediaPool();
  initInspector();
  initEditing();
  initProps();
  initMenus();
  initShortcuts();

  bus.on("cmd:undo", () => {
    const l = store.undo();
    toast(l ? `Undid: ${l}` : "Nothing to undo");
  });
  bus.on("cmd:redo", () => {
    const l = store.redo();
    toast(l ? `Redid: ${l}` : "Nothing to redo");
  });
  bus.on("project:changed", updateStatus);
  bus.on("project:loaded", updateStatus);
  bus.on("project:saved", updateStatus);
  bus.on("cmd:save", () => saveNow().then(() => toast("Project saved in this browser", "ok")).catch((e) => toast(`Save failed: ${e.message}`, "error")));
  initAutosave();
  restore().then((r) => {
    if (!r) return;
    store.load(r.project);
    toast(r.missing.length ? `Restored your last project; ${r.missing.length} media file(s) are missing` : "Restored your last project", r.missing.length ? "warn" : "ok");
  }).catch((e) => console.warn("restore failed", e));
  updateStatus();
}

window.addEventListener("error", (e) => toast(`Error: ${e.message}`, "error", 5000));
window.addEventListener("unhandledrejection", (e) => toast(`Error: ${e.reason?.message ?? e.reason}`, "error", 5000));

boot();
