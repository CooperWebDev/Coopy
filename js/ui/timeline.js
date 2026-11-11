// Timeline: ruler, track headers/lanes, zoom, scrubbing, playhead and interactive clips
// (drop from the Media Pool, move across tracks, snap, select, delete).
import { bus } from "../core/events.js";
import { store, newId } from "../core/store.js";
import { playback } from "../core/playback.js";
import { toTimecode, snapToFrame } from "../core/timecode.js";
import { selection } from "../core/selection.js";
import { dnd } from "../core/dnd.js";
import { trackById, mediaById, resolvePlacement, snapStart, snapTime, computeTrim, trackTypeFor, addClip } from "../core/clips.js";
import { splitClip } from "../core/edit.js";
import { toast } from "./toast.js";

const RULER_H = 28;
const MIN_PPS = 5;
const MAX_PPS = 1280;
const SNAP_PX = 8;

const scroll = document.getElementById("tlScroll");
const content = document.getElementById("tlContent");
const ruler = document.getElementById("tlRuler");
const tracksEl = document.getElementById("tlTracks");
const headerList = document.getElementById("tlHeaderList");
const playheadEl = document.getElementById("playhead");
const zoomSlider = document.getElementById("zoomSlider");

let pps = 46; // pixels per second
export const timeline = { snap: true, tool: "select", get pps() { return pps; } };

/** "select" (move/trim/select) or "blade" (click a clip to cut it). */
export function setTool(tool) {
  if (tool !== "select" && tool !== "blade") return;
  timeline.tool = tool;
  content.dataset.tool = tool;
  document.getElementById("btnToolSelect").classList.toggle("on", tool === "select");
  document.getElementById("btnToolBlade").classList.toggle("on", tool === "blade");
  showGuide(null);
  bus.emit("tool:changed", tool);
}

const sliderToPps = (v) => MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, v / 100);
const ppsToSlider = (p) => (Math.log(p / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100;

export function setZoom(newPps, anchorTime) {
  const t = anchorTime ?? (scroll.scrollLeft + scroll.clientWidth / 2) / pps;
  const offset = t * pps - scroll.scrollLeft;
  pps = Math.min(MAX_PPS, Math.max(MIN_PPS, newPps));
  zoomSlider.value = ppsToSlider(pps);
  layout();
  layoutClips();
  scroll.scrollLeft = t * pps - offset;
  drawRuler();
  positionPlayhead();
}
export const zoomBy = (factor) => setZoom(pps * factor);
export function zoomFit() {
  const usable = Math.max(100, scroll.clientWidth - 40);
  setZoom(usable / playback.duration, 0);
  scroll.scrollLeft = 0;
}

/* ---------- Layout / rendering ---------- */
function layout() {
  const width = Math.max(scroll.clientWidth, Math.ceil(playback.duration * pps) + 80);
  content.style.width = `${width}px`;
  tracksEl.style.width = `${width}px`;
}

function layoutClips() {
  tracksEl.querySelectorAll(".clip:not(.ghost)").forEach((d) => {
    const c = store.project.clips.find((x) => x.id === d.dataset.id);
    if (!c) return;
    d.style.left = `${c.start * pps}px`;
    d.style.width = `${Math.max(2, c.duration * pps)}px`;
  });
}

function makeClipEl(clip, track) {
  const d = document.createElement("div");
  d.className = `clip ${clip.kind}${selection.kind === "clip" && selection.id === clip.id ? " selected" : ""}`;
  d.dataset.id = clip.id;
  d.title = clip.name;
  const media = mediaById(clip.mediaId);
  if (media?.thumb && clip.kind !== "audio") {
    const th = document.createElement("div");
    th.className = "clip-thumb";
    th.style.backgroundImage = `url(${media.thumb})`;
    d.appendChild(th);
  }
  const name = document.createElement("span");
  name.className = "clip-name";
  name.textContent = clip.name;
  d.appendChild(name);
  d.addEventListener("pointerdown", (e) => onClipPointerDown(e, clip.id));
  for (const edge of ["left", "right"]) {
    const h = document.createElement("div");
    h.className = `clip-handle ${edge}`;
    h.title = edge === "left" ? "Drag to trim the start" : "Drag to trim the end";
    h.addEventListener("pointerdown", (e) => onHandlePointerDown(e, clip.id, edge));
    d.appendChild(h);
  }
  return d;
}

function renderTracks() {
  headerList.replaceChildren();
  tracksEl.replaceChildren();
  for (const t of store.project.tracks) {
    const h = document.createElement("div");
    h.className = "track-header";
    h.dataset.id = t.id;
    const kind = t.type === "video" ? "v" : "a";
    h.innerHTML = `
      <span class="name ${kind}">${t.name}</span>
      <button class="th-btn ${t.locked ? "on" : ""}" data-act="lock" title="Lock track">L</button>
      ${t.type === "video"
        ? `<button class="th-btn ${t.hidden ? "on" : ""}" data-act="hide" title="Hide track">${t.hidden ? "✕" : "◉"}</button>`
        : `<button class="th-btn mute ${t.muted ? "on" : ""}" data-act="mute" title="Mute track">M</button>`}`;
    headerList.appendChild(h);

    const lane = document.createElement("div");
    lane.className = `track-lane ${t.type}${t.locked ? " locked" : ""}${t.hidden ? " hidden-track" : ""}`;
    lane.dataset.id = t.id;
    for (const clip of store.project.clips.filter((c) => c.trackId === t.id)) lane.appendChild(makeClipEl(clip, t));
    tracksEl.appendChild(lane);
  }
  layoutClips();
}

function drawRuler() {
  const dpr = window.devicePixelRatio || 1;
  const w = scroll.clientWidth;
  ruler.style.width = `${w}px`;
  ruler.style.height = `${RULER_H}px`;
  ruler.width = Math.round(w * dpr);
  ruler.height = Math.round(RULER_H * dpr);
  const ctx = ruler.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, RULER_H);
  ctx.font = "10px ui-monospace, Menlo, Consolas, monospace";
  ctx.textBaseline = "top";

  const steps = [1 / 24, 1 / 12, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  const major = steps.find((s) => s * pps >= 90) ?? 3600;
  const minor = major / 5;
  const t0 = scroll.scrollLeft / pps;
  const t1 = (scroll.scrollLeft + w) / pps;
  const fps = store.project.settings.fps;

  ctx.strokeStyle = "#3b2e5a";
  ctx.fillStyle = "#a89fbf";
  ctx.beginPath();
  for (let t = Math.floor(t0 / minor) * minor; t <= t1 + minor; t += minor) {
    const x = Math.round(t * pps - scroll.scrollLeft) + 0.5;
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ctx.moveTo(x, isMajor ? 12 : 20);
    ctx.lineTo(x, RULER_H);
    if (isMajor) ctx.fillText(toTimecode(t, fps), x + 4, 3);
  }
  ctx.stroke();
}

function positionPlayhead() {
  playheadEl.style.left = `${playback.time * pps}px`;
}

function followPlayhead() {
  if (!playback.playing) return;
  const x = playback.time * pps;
  const l = scroll.scrollLeft, r = l + scroll.clientWidth;
  if (x > r - 40 || x < l) scroll.scrollLeft = Math.max(0, x - scroll.clientWidth * 0.2);
}

/* ---------- Pointer helpers ---------- */
function timeFromEvent(e) {
  const rect = scroll.getBoundingClientRect();
  return (e.clientX - rect.left + scroll.scrollLeft) / pps;
}

function laneAtY(clientY) {
  for (const lane of tracksEl.children) {
    const r = lane.getBoundingClientRect();
    if (clientY >= r.top && clientY < r.bottom) return lane;
  }
  return null;
}
const laneEl = (trackId) => tracksEl.querySelector(`.track-lane[data-id="${trackId}"]`);

function showGuide(time, blade = false) {
  let g = content.querySelector(".snap-line");
  if (time == null) { g?.remove(); return; }
  if (!g) { g = document.createElement("div"); g.className = "snap-line"; content.appendChild(g); }
  g.classList.toggle("blade", blade);
  g.style.left = `${time * pps}px`;
}

function snapped(desiredStart, duration, excludeIds) {
  const fps = playback.fps;
  const r = timeline.snap ? snapStart(desiredStart, duration, SNAP_PX / pps, excludeIds) : { start: desiredStart, guide: null };
  return { start: snapToFrame(Math.max(0, r.start), fps), guide: r.guide };
}

/* ---------- Scrubbing ---------- */
function startScrub(e) {
  e.preventDefault();
  e.currentTarget.setPointerCapture?.(e.pointerId);
  playback.seek(timeFromEvent(e));
  const move = (ev) => playback.seek(timeFromEvent(ev));
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* ---------- Clip move ---------- */
/** Time a blade cut would land at for a pointer event: frame-snapped, sticky to the playhead. */
function bladeTime(e) {
  const fps = playback.fps;
  let t = snapToFrame(timeFromEvent(e), fps);
  if (timeline.snap && Math.abs(t - playback.time) <= SNAP_PX / pps) t = playback.time;
  return t;
}

function bladeCut(e, clipId) {
  e.stopPropagation();
  e.preventDefault();
  const r = splitClip(clipId, bladeTime(e));
  if (!r.ok) toast(r.msg);
}

function onClipPointerDown(e, clipId) {
  if (e.button !== 0) return;
  if (timeline.tool === "blade") return bladeCut(e, clipId);
  e.stopPropagation();
  const clip = store.project.clips.find((c) => c.id === clipId);
  if (!clip) return;
  selection.set("clip", clip.id);
  const track = trackById(clip.trackId);
  if (track.locked) { toast(`Track ${track.name} is locked`); return; }

  const d = e.currentTarget;
  d.setPointerCapture(e.pointerId);
  const sx = e.clientX, sy = e.clientY;
  const origLane = laneEl(clip.trackId).getBoundingClientRect().top;
  let moved = false;
  let cur = { trackId: clip.trackId, start: clip.start };

  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return;
    moved = true;
    d.classList.add("dragging");
    const lane = laneAtY(ev.clientY);
    let tid = clip.trackId;
    if (lane) {
      const t = trackById(lane.dataset.id);
      if (t && t.type === track.type && !t.locked) tid = t.id;
    }
    const s = snapped(clip.start + (ev.clientX - sx) / pps, clip.duration, [clip.id]);
    const start = resolvePlacement(store.project, tid, s.start, clip.duration, clip.id);
    cur = { trackId: tid, start };
    d.style.left = `${start * pps}px`;
    d.style.transform = `translateY(${laneEl(tid).getBoundingClientRect().top - origLane}px)`;
    showGuide(start === s.start ? s.guide : null);
  };
  const up = () => {
    d.removeEventListener("pointermove", move);
    d.removeEventListener("pointerup", up);
    d.removeEventListener("pointercancel", up);
    showGuide(null);
    if (moved && (cur.start !== clip.start || cur.trackId !== clip.trackId)) {
      store.commit("move clip", (p) => {
        const c = p.clips.find((x) => x.id === clip.id);
        c.start = cur.start; c.trackId = cur.trackId;
      });
    } else if (moved) {
      renderTracks();
    }
    d.classList.remove("dragging");
  };
  d.addEventListener("pointermove", move);
  d.addEventListener("pointerup", up);
  d.addEventListener("pointercancel", up);
}

/* ---------- Clip trim (drag an edge) ---------- */
function onHandlePointerDown(e, clipId, edge) {
  if (e.button !== 0) return;
  if (timeline.tool === "blade") return bladeCut(e, clipId);
  e.stopPropagation();
  e.preventDefault();
  const clip = store.project.clips.find((c) => c.id === clipId);
  if (!clip) return;
  selection.set("clip", clip.id);
  const track = trackById(clip.trackId);
  if (track.locked) { toast(`Track ${track.name} is locked`); return; }

  const handle = e.currentTarget;
  const d = handle.parentElement;
  handle.setPointerCapture(e.pointerId);
  d.classList.add("trimming");
  const fps = playback.fps;
  const grab = timeFromEvent(e) - (edge === "left" ? clip.start : clip.start + clip.duration); // keep the grab offset
  let cur = { start: clip.start, duration: clip.duration, in: clip.in };
  const info = document.getElementById("sbInfo");

  const move = (ev) => {
    let t = timeFromEvent(ev) - grab;
    let guide = null;
    if (timeline.snap) { const s = snapTime(t, SNAP_PX / pps, [clip.id]); t = s.time; guide = s.guide; }
    cur = computeTrim(store.project, clip, edge, t, fps);
    d.style.left = `${cur.start * pps}px`;
    d.style.width = `${Math.max(2, cur.duration * pps)}px`;
    // only show the snap guide if the edge really landed on it (it may have been clamped)
    const edgeT = edge === "left" ? cur.start : cur.start + cur.duration;
    showGuide(guide != null && Math.abs(edgeT - guide) < 0.5 / fps ? guide : null);
    info.textContent = `Trim: duration ${toTimecode(cur.duration, fps)}  ·  ${edge === "left" ? "start" : "end"} ${toTimecode(edgeT, fps)}`;
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    showGuide(null);
    info.textContent = "Ready";
    d.classList.remove("trimming");
    if (cur.start !== clip.start || cur.duration !== clip.duration || cur.in !== clip.in) {
      store.commit(`trim ${edge === "left" ? "start" : "end"}`, (p) => {
        const c = p.clips.find((x) => x.id === clip.id);
        c.start = cur.start; c.duration = cur.duration; c.in = cur.in;
      });
    } else {
      renderTracks(); // restore any visual change from a clamped drag
    }
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
}

/* ---------- Drop from the Media Pool ---------- */
let ghost = null;
function clearGhost() { ghost?.remove(); ghost = null; showGuide(null); }

function dropInfo(e) {
  const media = store.project.media.find((m) => m.id === dnd.mediaId);
  const lane = e.target.closest?.(".track-lane");
  if (!media || !lane) return null;
  const track = trackById(lane.dataset.id);
  if (!track || track.locked || track.type !== trackTypeFor(media.kind)) return null;
  const s = snapped(timeFromEvent(e), media.duration, []);
  const start = resolvePlacement(store.project, track.id, s.start, media.duration);
  return { media, track, lane, start, guide: start === s.start ? s.guide : null };
}

function initDrop() {
  tracksEl.addEventListener("dragover", (e) => {
    if (!dnd.mediaId) return;
    const info = dropInfo(e);
    if (!info) { clearGhost(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!ghost) { ghost = document.createElement("div"); ghost.className = "clip ghost"; }
    if (ghost.parentNode !== info.lane) info.lane.appendChild(ghost);
    ghost.classList.add(info.media.kind);
    ghost.style.left = `${info.start * pps}px`;
    ghost.style.width = `${Math.max(2, info.media.duration * pps)}px`;
    showGuide(info.guide);
  });
  tracksEl.addEventListener("dragleave", (e) => { if (!tracksEl.contains(e.relatedTarget)) clearGhost(); });
  tracksEl.addEventListener("drop", (e) => {
    if (!dnd.mediaId) return;
    const info = dropInfo(e);
    clearGhost();
    if (!info) return;
    e.preventDefault();
    const clip = addClip(info.media, info.track.id, info.start);
    selection.set("clip", clip.id);
  });
  window.addEventListener("dragend", clearGhost);
}

/* ---------- Wiring ---------- */
function initInteraction() {
  ruler.addEventListener("pointerdown", startScrub);
  playheadEl.querySelector(".playhead-handle").addEventListener("pointerdown", startScrub);
  tracksEl.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("track-lane")) {
      if (selection.kind === "clip") selection.clear();
      startScrub(e);
    }
  });

  tracksEl.addEventListener("pointermove", (e) => {
    if (timeline.tool !== "blade") return;
    showGuide(e.target.closest(".clip") ? bladeTime(e) : null, true);
  });
  tracksEl.addEventListener("pointerleave", () => { if (timeline.tool === "blade") showGuide(null); });
  document.getElementById("btnToolSelect").addEventListener("click", () => setTool("select"));
  document.getElementById("btnToolBlade").addEventListener("click", () => setTool("blade"));

  scroll.addEventListener("scroll", () => {
    headerList.style.transform = `translateY(${-scroll.scrollTop}px)`;
    drawRuler();
  });

  scroll.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15), timeFromEvent(e));
  }, { passive: false });

  headerList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.closest(".track-header").dataset.id;
    const act = btn.dataset.act;
    const key = { lock: "locked", hide: "hidden", mute: "muted" }[act];
    const track = store.project.tracks.find((t) => t.id === id);
    store.commit(`${act} ${track.name}`, (p) => {
      const t = p.tracks.find((x) => x.id === id);
      t[key] = !t[key];
    });
  });

  zoomSlider.addEventListener("input", () => setZoom(sliderToPps(Number(zoomSlider.value))));
  document.getElementById("btnZoomIn").addEventListener("click", () => zoomBy(1.4));
  document.getElementById("btnZoomOut").addEventListener("click", () => zoomBy(1 / 1.4));
  document.getElementById("btnZoomFit").addEventListener("click", zoomFit);
  document.getElementById("chkSnap").addEventListener("change", (e) => { timeline.snap = e.target.checked; });

  document.getElementById("btnAddVideoTrack").addEventListener("click", () => addTrack("video"));
  document.getElementById("btnAddAudioTrack").addEventListener("click", () => addTrack("audio"));
  document.getElementById("btnUndo").addEventListener("click", () => bus.emit("cmd:undo"));
  document.getElementById("btnRedo").addEventListener("click", () => bus.emit("cmd:redo"));

  initDrop();
  new ResizeObserver(() => { layout(); drawRuler(); }).observe(scroll);
}

export function addTrack(type) {
  const count = store.project.tracks.filter((t) => t.type === type).length + 1;
  const name = `${type === "video" ? "V" : "A"}${count}`;
  store.commit(`add track ${name}`, (p) => {
    const track = { id: newId("t"), type, name, locked: false, muted: false, hidden: false };
    if (type === "video") p.tracks.unshift(track); // higher video tracks sit on top
    else p.tracks.push(track);
  });
}

function refreshHistoryButtons() {
  document.getElementById("btnUndo").disabled = !store.canUndo;
  document.getElementById("btnRedo").disabled = !store.canRedo;
}

export function initTimeline() {
  initInteraction();
  const rerender = () => {
    if (selection.kind === "clip" && !store.project.clips.some((c) => c.id === selection.id)) selection.clear();
    renderTracks(); layout(); drawRuler(); positionPlayhead();
  };
  bus.on("project:loaded", () => { selection.clear(); rerender(); });
  bus.on("project:changed", rerender);
  bus.on("history:changed", refreshHistoryButtons);
  bus.on("layout:changed", () => { layout(); drawRuler(); });
  bus.on("playback:time", () => { positionPlayhead(); followPlayhead(); });
  bus.on("selection:changed", ({ kind, id }) => {
    tracksEl.querySelectorAll(".clip.selected").forEach((c) => c.classList.remove("selected"));
    if (kind === "clip") tracksEl.querySelector(`.clip[data-id="${id}"]`)?.classList.add("selected");
  });
  rerender();
  refreshHistoryButtons();
  zoomSlider.value = ppsToSlider(pps);
}
