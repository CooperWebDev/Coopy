// Top menus, project title editing, settings / export / shortcut dialogs.
import { bus } from "../core/events.js";
import { store, createProject } from "../core/store.js";
import { playback } from "../core/playback.js";
import { selection } from "../core/selection.js";
import { openModal } from "./modal.js";
import { toast } from "./toast.js";
import { setWorkspace, resetLayout, workspaceNames } from "./panels.js";
import { toggleFullscreen } from "./preview.js";
import { source } from "../core/source.js";
import { releaseAllMedia } from "../core/media.js";
import { engine } from "../core/engine.js";
import { openExport } from "./export.js";
import { saveNow, downloadProject, parseProjectFile, hydrate } from "../core/persist.js";
import { SHORTCUTS } from "./shortcuts.js";

const pop = document.getElementById("menuPop");
let openKey = null;

const MENUS = {
  file: () => [
    { label: "New Project", run: newProject },
    { label: "Open Project…", run: openProject },
    { label: "Save Project", kbd: "Ctrl+S", run: saveProject },
    { label: "Download Project File", run: downloadProject },
    { sep: true },
    { label: "Project Settings…", run: openSettings },
    { label: "Export…", run: openExport },
  ],
  edit: () => {
    const clip = selection.kind === "clip";
    return [
      { label: "Undo", kbd: "Ctrl+Z", disabled: !store.canUndo, run: () => bus.emit("cmd:undo") },
      { label: "Redo", kbd: "Ctrl+Shift+Z", disabled: !store.canRedo, run: () => bus.emit("cmd:redo") },
      { sep: true },
      { label: "Split at Playhead", kbd: "S", run: () => bus.emit("cmd:split") },
      { label: "Trim Start to Playhead", kbd: "Q", disabled: !clip, run: () => bus.emit("cmd:trimStart") },
      { label: "Trim End to Playhead", kbd: "W", disabled: !clip, run: () => bus.emit("cmd:trimEnd") },
      { label: "Duplicate Clip", kbd: "Ctrl+D", disabled: !clip, run: () => bus.emit("cmd:duplicate") },
      { label: "Delete", kbd: "Delete", disabled: !clip, run: () => bus.emit("cmd:delete") },
      { label: "Ripple Delete", kbd: "Shift+Delete", disabled: !clip, run: () => bus.emit("cmd:rippleDelete") },
      { sep: true },
      { label: "Selection Tool", kbd: "V", run: () => bus.emit("cmd:tool", "select") },
      { label: "Blade Tool", kbd: "B", run: () => bus.emit("cmd:tool", "blade") },
    ];
  },
  view: () => [
    ...Object.entries(workspaceNames).map(([k, v]) => ({ label: `${v} workspace`, run: () => setWorkspace(k) })),
    { sep: true },
    { label: "Fullscreen preview", kbd: "F", run: toggleFullscreen },
    { label: "Reset panel layout", run: resetLayout },
  ],
  help: () => [{ label: "Keyboard shortcuts…", run: openShortcuts }, { label: "About Coopy", run: openAbout }],
};

function closeMenu() {
  pop.hidden = true;
  document.querySelectorAll("#menu button").forEach((b) => b.classList.remove("open"));
  openKey = null;
}

function showMenu(btn) {
  const key = btn.dataset.menu;
  if (openKey === key) return closeMenu();
  closeMenu();
  pop.replaceChildren();
  for (const item of MENUS[key]()) {
    if (item.sep) { pop.appendChild(document.createElement("hr")); continue; }
    const b = document.createElement("button");
    b.disabled = !!item.disabled;
    b.innerHTML = `<span>${item.label}</span><span class="kbd">${item.kbd ?? ""}</span>`;
    b.addEventListener("click", () => { closeMenu(); item.run?.(); });
    pop.appendChild(b);
  }
  const r = btn.getBoundingClientRect();
  pop.style.left = `${r.left}px`;
  pop.style.top = `${r.bottom + 4}px`;
  pop.hidden = false;
  btn.classList.add("open");
  openKey = key;
}

async function saveProject() {
  try { await saveNow(); toast("Project saved in this browser", "ok"); } catch (e) { toast(`Save failed: ${e.message}`, "error"); }
}

function openProject() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: ".json,application/json" });
  input.onchange = async () => {
    try {
      const p = await parseProjectFile(input.files[0]);
      const { missing } = await hydrate(p);
      playback.pause(); playback.seek(0); source.unload(); engine.releaseAll();
      store.load(p);
      toast(missing.length ? `Opened. ${missing.length} media file(s) are not in this browser and must be re-imported: ${missing.slice(0, 3).join(", ")}` : "Project opened", missing.length ? "warn" : "ok", missing.length ? 7000 : 2500);
    } catch (e) { toast(`Can't open: ${e.message}`, "error", 5000); }
  };
  input.click();
}

function newProject() {
  const go = () => { playback.pause(); playback.seek(0); source.unload(); engine.releaseAll(); releaseAllMedia(); store.load(createProject()); toast("New project created", "ok"); };
  if (!store.dirty) return go();
  openModal("Discard changes?", "<p>The current project has unsaved changes . Start a new project anyway?</p>", [
    { label: "Cancel" },
    { label: "Discard & New", primary: true, onClick: go },
  ]);
}

function row(label, control) {
  const r = document.createElement("div");
  r.className = "form-row";
  const l = document.createElement("label");
  l.textContent = label;
  r.append(l, control);
  return r;
}
function select(options, value) {
  const s = document.createElement("select");
  for (const [v, text] of options) {
    const o = document.createElement("option");
    o.value = v; o.textContent = text; s.appendChild(o);
  }
  s.value = value;
  return s;
}

function openSettings() {
  const p = store.project;
  const body = document.createElement("div");
  const name = Object.assign(document.createElement("input"), { type: "text", value: p.name });
  const res = select([["1280x720", "1280 × 720 (HD)"], ["1920x1080", "1920 × 1080 (Full HD)"], ["2560x1440", "2560 × 1440 (QHD)"], ["3840x2160", "3840 × 2160 (4K UHD)"]], `${p.settings.width}x${p.settings.height}`);
  const fps = select([["23.976", "23.976"], ["24", "24"], ["25", "25"], ["30", "30"], ["50", "50"], ["60", "60"]], String(p.settings.fps));
  body.append(row("Project name", name), row("Resolution", res), row("Frame rate", fps));
  const note = document.createElement("div");
  note.className = "form-note";
  note.textContent = "Changing frame rate changes how timecode is displayed. Existing clips keep their time positions in seconds.";
  body.appendChild(note);
  openModal("Project Settings", body, [
    { label: "Cancel" },
    { label: "Apply", primary: true, onClick: () => {
      const [w, h] = res.value.split("x").map(Number);
      const n = name.value.trim() || "Untitled Project";
      store.commit("project settings", (proj) => { proj.name = n; proj.settings = { width: w, height: h, fps: Number(fps.value) }; });
    } },
  ]);
}

function openShortcuts() {
  const table = document.createElement("table");
  table.className = "kbd-table";
  for (const s of SHORTCUTS.filter((x) => !x.hidden)) {
    const tr = table.insertRow();
    tr.insertCell().textContent = s.label;
    tr.insertCell().textContent = s.display;
  }
  openModal("Keyboard Shortcuts", table);
}

function openAbout() {
  openModal("About Coopy", "<p><strong>Coopy</strong> — a browser-based video editor, built in stages.</p><p class='muted'>Media import, multitrack timeline, trimming and splitting, per-clip transform / opacity / fades / volume, color and looks, autosave, and real-time export to WebM/MP4.</p>");
}

function initTitle() {
  const el = document.getElementById("projectTitle");
  const render = () => { el.textContent = store.project.name; document.title = `${store.project.name} — Coopy`; };
  const edit = () => {
    const input = Object.assign(document.createElement("input"), { type: "text", value: store.project.name });
    el.replaceChildren(input);
    input.focus(); input.select();
    const done = (commit) => {
      const v = input.value.trim();
      if (commit && v && v !== store.project.name) store.commit("rename project", (p) => { p.name = v; });
      else render();
    };
    input.addEventListener("blur", () => done(true));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") { input.value = store.project.name; input.blur(); }
    });
  };
  el.addEventListener("click", (e) => { if (e.target === el) edit(); });
  el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === el) edit(); });
  bus.on("project:loaded", render);
  bus.on("project:changed", render);
  render();
}

export function initMenus() {
  document.getElementById("menu").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-menu]");
    if (b) { e.stopPropagation(); showMenu(b); }
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  document.getElementById("btnSettings").addEventListener("click", openSettings);
  document.getElementById("btnExport").addEventListener("click", openExport);
  initTitle();
}
