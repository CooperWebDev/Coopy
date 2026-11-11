// Inspector: shows properties of the selected media item or timeline clip.
// Editable clip properties (transform, opacity, keyframes…) arrive in later stages.
import { bus } from "../core/events.js";
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import { playback } from "../core/playback.js";
import { toTimecode, parseTimecode } from "../core/timecode.js";
import * as edit from "../core/edit.js";
import { toast } from "./toast.js";
import { clipPropSections } from "./props.js";
import { formatSize, formatDuration } from "../core/media.js";

const page = document.querySelector('[data-page="inspector"]');

function renderEmpty() {
  page.innerHTML = `<div class="empty-state"><p><strong>Nothing selected</strong></p>
    <p class="muted">Select a media item or a clip to see its properties.</p></div>`;
}

function renderRows(title, rows) {
  page.replaceChildren();
  const head = document.createElement("div");
  head.className = "insp-head";
  head.textContent = title;
  const dl = document.createElement("dl");
  dl.className = "meta";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    dl.append(dt, dd);
  }
  page.append(head, dl);
}

function renderMedia(id) {
  const m = store.project.media.find((x) => x.id === id);
  if (!m) return renderEmpty();
  const bin = store.project.bins.find((b) => b.id === m.binId)?.name ?? "–";
  renderRows("Media", [
    ["Name", m.name],
    ["Type", `${m.kind}${m.mime ? ` (${m.mime})` : ""}`],
    ["Size", formatSize(m.size)],
    ...(m.kind !== "audio" ? [["Resolution", `${m.width} × ${m.height}`]] : []),
    ...(m.kind !== "image" ? [["Duration", `${formatDuration(m.duration)} (${m.duration.toFixed(2)} s)`]] : []),
    ["Bin", bin],
    ["Imported", new Date(m.added).toLocaleString()],
  ]);
}

function field(label, value, onCommit) {
  const l = document.createElement("label");
  l.textContent = label;
  const input = Object.assign(document.createElement("input"), { type: "text", value, spellcheck: false });
  input.title = "Timecode HH:MM:SS:FF, or a number of frames. Enter to apply.";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
    if (e.key === "Escape") { input.value = value; input.blur(); }
  });
  input.addEventListener("change", () => {
    const secs = parseTimecode(input.value, playback.fps);
    if (secs == null) { input.classList.add("err"); toast("Use timecode HH:MM:SS:FF or a frame count"); input.value = value; return; }
    input.classList.remove("err");
    onCommit(secs);
  });
  return [l, input];
}

function readonly(label, value) {
  const l = document.createElement("label");
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "ro";
  v.textContent = value;
  return [l, v];
}

function actionButton(label, title, run) {
  const b = document.createElement("button");
  b.className = "btn btn-sm";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", run);
  return b;
}

function renderClip(id) {
  const c = store.project.clips.find((x) => x.id === id);
  if (!c) return renderEmpty();
  const track = store.project.tracks.find((t) => t.id === c.trackId);
  const media = store.project.media.find((m) => m.id === c.mediaId);
  const fps = playback.fps;
  const report = (r) => { if (!r.ok || r.msg) toast(r.msg); };

  page.replaceChildren();
  const head = document.createElement("div");
  head.className = "insp-head";
  head.textContent = "Clip";
  const info = document.createElement("dl");
  info.className = "meta";
  for (const [k, v] of [["Name", c.name], ["Track", track ? `${track.name} (${track.type})` : "–"]]) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd"); dd.textContent = v;
    info.append(dt, dd);
  }

  const sub = document.createElement("div");
  sub.className = "insp-sub";
  sub.textContent = "Timing";
  const fields = document.createElement("div");
  fields.className = "insp-fields";
  fields.append(
    ...field("Start", toTimecode(c.start, fps), (s) => report(edit.setClipStart(c.id, s))),
    ...field("Duration", toTimecode(c.duration, fps), (s) => report(edit.setClipDuration(c.id, s))),
    ...readonly("End", toTimecode(c.start + c.duration, fps)),
    ...(c.kind === "image" ? [] : readonly("Source in", toTimecode(c.in, fps))),
    ...(c.kind === "image" ? readonly("Source", "Still image (any length)")
      : readonly("Remaining", toTimecode(Math.max(0, (media?.duration ?? 0) - c.in - c.duration), fps))),
  );

  const actions = document.createElement("div");
  actions.className = "insp-actions";
  actions.append(
    actionButton("Split at playhead", "Split (S)", () => bus.emit("cmd:split")),
    actionButton("Duplicate", "Duplicate (Ctrl+D)", () => bus.emit("cmd:duplicate")),
    actionButton("Delete", "Delete (Delete)", () => bus.emit("cmd:delete")),
    actionButton("Ripple delete", "Delete and close the gap on this track (Shift+Delete)", () => bus.emit("cmd:rippleDelete")),
  );
  page.append(head, info, sub, fields, ...clipPropSections(c), actions);
}

function render() {
  if (selection.kind === "media") renderMedia(selection.id);
  else if (selection.kind === "clip") renderClip(selection.id);
  else renderEmpty();
}

export function initInspector() {
  bus.on("selection:changed", render);
  bus.on("project:changed", render);
  bus.on("project:loaded", render);
  render();
}
