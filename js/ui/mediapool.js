// Media Pool: import, bins, search/filter, selection, drag-and-drop, source loading.
import { bus } from "../core/events.js";
import { store, newId } from "../core/store.js";
import { importFiles, formatDuration } from "../core/media.js";
import { source } from "../core/source.js";
import { selection } from "../core/selection.js";
import { dnd } from "../core/dnd.js";
import { addClip, defaultTrackFor, resolvePlacement } from "../core/clips.js";
import { playback } from "../core/playback.js";
import { openModal } from "./modal.js";
import { toast } from "./toast.js";

const MEDIA_DND = "application/x-coopy-media";
const $ = (id) => document.getElementById(id);
const binTree = $("binTree"), grid = $("mediaGrid"), empty = $("mediaEmpty");
const panel = $("panelLeft"), overlay = $("dropOverlay"), fileInput = $("fileInput");

export const poolState = { bin: "master", selected: null, query: "", filter: "all" };

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

/* ---------- bins ---------- */
const binById = (id) => store.project.bins.find((b) => b.id === id);
function descendants(id) {
  const out = [];
  for (const b of store.project.bins) if (b.parentId === id) out.push(b.id, ...descendants(b.id));
  return out;
}

function renderBins() {
  binTree.replaceChildren();
  const walk = (parentId, depth) => {
    for (const bin of store.project.bins.filter((b) => b.parentId === parentId)) {
      const row = el("div", `bin-item${poolState.bin === bin.id ? " active" : ""}`);
      row.style.paddingLeft = `${8 + depth * 14}px`;
      row.dataset.id = bin.id;
      const count = store.project.media.filter((m) => m.binId === bin.id).length;
      row.append(el("span", "bin-name", `📁 ${bin.name}`), el("span", "bin-count", String(count)));
      if (bin.id !== "master") {
        const del = el("button", "bin-del", "×");
        del.title = "Delete bin (media moves to the parent bin)";
        del.addEventListener("click", (e) => { e.stopPropagation(); deleteBin(bin.id); });
        row.appendChild(del);
      }
      row.addEventListener("click", () => { poolState.bin = bin.id; renderAll(); });
      row.addEventListener("dblclick", () => bin.id !== "master" && renameBin(bin.id));
      row.addEventListener("dragover", (e) => {
        if (e.dataTransfer.types.includes(MEDIA_DND)) { e.preventDefault(); row.classList.add("drop"); }
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop"));
      row.addEventListener("drop", (e) => {
        row.classList.remove("drop");
        const id = e.dataTransfer.getData(MEDIA_DND);
        if (!id) return;
        e.preventDefault(); e.stopPropagation();
        moveMedia(id, bin.id);
      });
      binTree.appendChild(row);
      walk(bin.id, depth + 1);
    }
  };
  walk(null, 0);
}

function promptName(title, value, onOk) {
  const input = Object.assign(el("input"), { type: "text", value });
  input.style.width = "100%";
  const submit = () => {
    const v = input.value.trim();
    if (!v) { input.focus(); return false; }
    onOk(v);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { if (submit() !== false) document.getElementById("modalClose").click(); }
  });
  openModal(title, input, [{ label: "Cancel" }, { label: "OK", primary: true, onClick: submit }]);
  input.focus(); input.select();
}

function newBin() {
  promptName("New bin", "New Bin", (name) => {
    const id = newId("b");
    const parent = poolState.bin;
    store.commit("new bin", (p) => { p.bins.push({ id, name, parentId: parent }); });
    poolState.bin = id;
    renderAll();
  });
}
function renameBin(id) {
  promptName("Rename bin", binById(id).name, (name) => {
    store.commit("rename bin", (p) => { p.bins.find((b) => b.id === id).name = name; });
  });
}
function deleteBin(id) {
  const bin = binById(id);
  const gone = new Set([id, ...descendants(id)]);
  const moved = store.project.media.filter((m) => gone.has(m.binId)).length;
  const run = () => {
    store.commit("delete bin", (p) => {
      p.media.forEach((m) => { if (gone.has(m.binId)) m.binId = bin.parentId; });
      p.bins = p.bins.filter((b) => !gone.has(b.id));
    });
    if (gone.has(poolState.bin)) poolState.bin = bin.parentId;
    renderAll();
  };
  if (!moved && gone.size === 1) return run();
  openModal("Delete bin?", `<p>"${bin.name.replace(/</g, "&lt;")}" and its sub-bins will be deleted. ${moved} media item${moved === 1 ? "" : "s"} will move to the parent bin.</p>`,
    [{ label: "Cancel" }, { label: "Delete", primary: true, onClick: run }]);
}

function moveMedia(id, binId) {
  const m = store.project.media.find((x) => x.id === id);
  if (!m || m.binId === binId) return;
  store.commit("move media", (p) => { p.media.find((x) => x.id === id).binId = binId; });
}

/* ---------- media grid ---------- */
function visibleMedia() {
  const q = poolState.query.toLowerCase();
  return store.project.media.filter((m) => {
    if (poolState.filter !== "all" && m.kind !== poolState.filter) return false;
    if (q) return m.name.toLowerCase().includes(q); // searching spans all bins
    return m.binId === poolState.bin;
  });
}

function renderGrid() {
  grid.replaceChildren();
  const items = visibleMedia();
  empty.hidden = items.length > 0;
  empty.querySelector("strong").textContent = poolState.query ? "No matches" : "No media here";
  for (const m of items) {
    const card = el("div", `media-card${poolState.selected === m.id ? " selected" : ""}`);
    card.draggable = true;
    card.dataset.id = m.id;
    card.title = `${m.name}\n${m.kind}${m.width ? ` · ${m.width}×${m.height}` : ""} · double-click to open in Source`;
    const th = el("div", `thumb ${m.kind}`);
    if (m.thumb) { const img = el("img"); img.src = m.thumb; img.alt = ""; img.loading = "lazy"; th.appendChild(img); }
    else th.textContent = "♪";
    if (m.kind !== "image") th.appendChild(el("span", "dur", formatDuration(m.duration)));
    card.append(th, el("div", "mname", m.name));
    card.addEventListener("click", () => select(m.id));
    card.addEventListener("dblclick", () => openInSource(m));
    card.addEventListener("dragstart", (e) => { dnd.mediaId = m.id; e.dataTransfer.setData(MEDIA_DND, m.id); e.dataTransfer.effectAllowed = "move"; });
    card.addEventListener("dragend", () => { dnd.mediaId = null; });
    grid.appendChild(card);
  }
}

function select(id) {
  poolState.selected = id;
  $("btnRemoveMedia").disabled = !id;
  $("btnAddToTimeline").disabled = !id;
  grid.querySelectorAll(".media-card").forEach((c) => c.classList.toggle("selected", c.dataset.id === id));
  if (id) selection.set("media", id);
  else if (selection.kind === "media") selection.clear();
}

function addSelectedToTimeline() {
  const media = store.project.media.find((x) => x.id === poolState.selected);
  if (!media) return;
  const track = defaultTrackFor(media);
  if (!track) return toast(`No unlocked ${media.kind === "audio" ? "audio" : "video"} track available`, "error");
  const start = playback.time;
  const clip = addClip(media, track.id, start);
  selection.set("clip", clip.id);
  toast(`Added to ${track.name}`, "ok");
}

async function openInSource(m) {
  select(m.id);
  try { await source.load(m); }
  catch (err) { toast(err.message, "error", 5000); }
}

function removeSelected() {
  const id = poolState.selected;
  if (!id) return;
  const m = store.project.media.find((x) => x.id === id);
  if (!m) return;
  const used = store.project.clips.filter((c) => c.mediaId === id).length;
  const run = () => {
    if (source.media?.id === id) source.unload();
    store.commit(`remove ${m.name}`, (p) => {
      p.media = p.media.filter((x) => x.id !== id);
      p.clips = p.clips.filter((c) => c.mediaId !== id);
    });
    select(null);
  };
  if (!used) return run();
  openModal("Remove media?", `<p>This media is used by ${used} clip${used === 1 ? "" : "s"} on the timeline. Removing it deletes those clips too (you can undo).</p>`,
    [{ label: "Cancel" }, { label: "Remove", primary: true, onClick: run }]);
}

function renderAll() {
  if (!binById(poolState.bin)) poolState.bin = "master";
  if (poolState.selected && !store.project.media.some((m) => m.id === poolState.selected)) select(null);
  renderBins();
  renderGrid();
}

/* ---------- import ---------- */
let importing = false;
async function runImport(files) {
  if (!files.length) return;
  if (importing) return toast("An import is already running", "error");
  importing = true;
  const info = $("sbInfo");
  try {
    const { added, failed } = await importFiles(files, poolState.bin, (i, n, name) => {
      info.textContent = name ? `Importing ${i + 1}/${n}: ${name}` : "Ready";
    });
    if (added.length) toast(`Imported ${added.length} item${added.length > 1 ? "s" : ""}`, "ok");
    failed.slice(0, 3).forEach((f) => toast(`${f.name}: ${f.reason}`, "error", 6000));
    if (failed.length > 3) toast(`…and ${failed.length - 3} more failed`, "error", 6000);
  } finally {
    importing = false;
    info.textContent = "Ready";
  }
}

function initDragDrop() {
  const hasFiles = (e) => e.dataTransfer?.types?.includes("Files");
  // Never let the browser navigate to a dropped file.
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });

  let depth = 0;
  panel.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; overlay.hidden = false; } });
  panel.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; overlay.hidden = true; } });
  panel.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; overlay.hidden = true;
    runImport(e.dataTransfer.files);
  });
}

export function initMediaPool() {
  $("btnImport").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => { runImport(fileInput.files); fileInput.value = ""; });
  $("btnNewBin").addEventListener("click", newBin);
  $("btnRemoveMedia").addEventListener("click", removeSelected);
  $("mediaSearch").addEventListener("input", (e) => { poolState.query = e.target.value.trim(); renderGrid(); });
  $("mediaFilter").addEventListener("change", (e) => { poolState.filter = e.target.value; renderGrid(); });
  initDragDrop();

  bus.on("project:loaded", () => { poolState.bin = "master"; poolState.selected = null; renderAll(); });
  bus.on("project:changed", renderAll);
  bus.on("cmd:delete", () => { if (selection.kind === "media") removeSelected(); });
  bus.on("selection:changed", ({ kind }) => {
    if (kind !== "media" && poolState.selected) {
      poolState.selected = null;
      $("btnRemoveMedia").disabled = true;
      $("btnAddToTimeline").disabled = true;
      grid.querySelectorAll(".media-card.selected").forEach((c) => c.classList.remove("selected"));
    }
  });
  $("btnAddToTimeline").addEventListener("click", addSelectedToTimeline);
  renderAll();
}
