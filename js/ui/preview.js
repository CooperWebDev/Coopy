// Preview monitor + transport controls. Shows the timeline (black until Stage 3 composites clips)
// or the source monitor (a single media item loaded from the Media Pool).
import { bus } from "../core/events.js";
import { store } from "../core/store.js";
import { playback } from "../core/playback.js";
import { source } from "../core/source.js";
import { engine } from "../core/engine.js";
import { transport } from "../core/transport.js";
import { toTimecode } from "../core/timecode.js";
import { renderTimeline } from "../core/render.js";

const canvas = document.getElementById("previewCanvas");
const viewer = document.getElementById("viewer");
const ctx = canvas.getContext("2d");
const tcEl = document.getElementById("timecode");
const playBtn = document.getElementById("btnPlay");
const hint = document.getElementById("viewerHint");
const modeSeg = document.getElementById("modeSeg");
const sourceName = document.getElementById("sourceName");
let raf = 0;

function sizeCanvas() {
  const aspect = document.getElementById("aspectSelect").value.split(":").map(Number);
  const ratio = aspect[0] / aspect[1];
  const h = Math.min(store.project.settings.height, 720);
  const w = Math.round(h * ratio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  viewer.style.setProperty("--ar", String(ratio));
}

function drawContain(src, sw, sh) {
  const s = Math.min(canvas.width / sw, canvas.height / sh);
  const w = sw * s, h = sh * s;
  ctx.drawImage(src, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}

function drawFrame() {
  sizeCanvas();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (!transport.isSource) {
    const t = playback.time;
    const n = renderTimeline(ctx, canvas.width, canvas.height, t);
    const active = engine.activeClips(t);
    hint.hidden = active.length > 0 && (n > 0 || active.some((c) => c.kind === "audio"));
    hint.textContent = active.length ? "No video at playhead" : "No clip at playhead";
    return;
  }

  const m = source.media;
  hint.hidden = true;
  if (m.kind === "video" && source.el?.readyState >= 2) {
    drawContain(source.el, source.el.videoWidth, source.el.videoHeight);
  } else if (m.kind === "image" && source.img) {
    drawContain(source.img, source.img.naturalWidth, source.img.naturalHeight);
  } else if (m.kind === "audio") {
    ctx.fillStyle = "#9b3fb5";
    ctx.font = `${Math.round(canvas.height * 0.22)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("♪", canvas.width / 2, canvas.height * 0.45);
    ctx.fillStyle = "#a89fbf";
    ctx.font = `${Math.round(canvas.height * 0.045)}px sans-serif`;
    ctx.fillText(m.name, canvas.width / 2, canvas.height * 0.68);
  }
}

function updateTimecode() {
  tcEl.textContent = toTimecode(transport.time, playback.fps);
}

function syncEngine() { engine.sync(playback.time, playback.playing, playback.speed, playback.fps); }

function refresh() { drawFrame(); updateTimecode(); }

function updatePlayIcon() { playBtn.textContent = transport.playing ? "❚❚" : "▶"; }

// While the source plays we repaint every animation frame (video frames aren't pushed to us).
function loop() {
  cancelAnimationFrame(raf);
  if (!(transport.isSource && source.playing)) return;
  refresh();
  raf = requestAnimationFrame(loop);
}

function syncModeUI() {
  const src = transport.isSource;
  modeSeg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === (src ? "source" : "timeline")));
  modeSeg.querySelector('[data-mode="source"]').disabled = !source.loaded;
  sourceName.textContent = source.loaded ? source.media.name : "";
  updatePlayIcon();
  refresh();
}

export function initPreview() {
  bus.on("playback:time", () => { if (!transport.isSource) { syncEngine(); refresh(); } });
  bus.on("playback:state", () => { syncEngine(); updatePlayIcon(); });
  bus.on("playback:speed", syncEngine);
  bus.on("engine:frame", () => { if (!transport.isSource) refresh(); });
  bus.on("source:time", refresh);
  bus.on("source:state", () => { updatePlayIcon(); loop(); refresh(); });
  bus.on("source:loaded", () => { transport.setMode("source"); syncModeUI(); });
  bus.on("source:unloaded", syncModeUI);
  bus.on("source:error", (e) => console.error("source play failed", e));
  bus.on("transport:mode", syncModeUI);
  bus.on("project:loaded", () => { syncEngine(); refresh(); });
  bus.on("project:changed", () => { syncEngine(); refresh(); });

  playBtn.addEventListener("click", () => transport.toggle());
  document.getElementById("btnToStart").addEventListener("click", () => transport.toStart());
  document.getElementById("btnToEnd").addEventListener("click", () => transport.toEnd());
  document.getElementById("btnStepBack").addEventListener("click", () => transport.step(-1));
  document.getElementById("btnStepFwd").addEventListener("click", () => transport.step(1));
  document.getElementById("speedSelect").addEventListener("change", (e) => transport.setSpeed(Number(e.target.value)));
  document.getElementById("aspectSelect").addEventListener("change", refresh);
  document.getElementById("btnFullscreen").addEventListener("click", toggleFullscreen);
  modeSeg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (b && !b.disabled) transport.setMode(b.dataset.mode);
  });

  syncEngine();
  syncModeUI();
}

export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else viewer.requestFullscreen?.().catch(() => {});
}
