// Playback engine: keeps one media element per active clip in sync with the timeline playhead.
// Video clips carry their own audio; audio clips play through <audio>. (Mixing arrives in Stage 5.)
import { bus } from "./events.js";
import { store } from "./store.js";
import { mediaFiles } from "./media.js";
import { gainAt } from "./props.js";

// Audio graph: every media element -> its own GainNode -> speakers (+ export tap). Built lazily.
let actx = null, exportDest = null;
function audioCtx() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); exportDest = actx.createMediaStreamDestination(); } catch { actx = false; }
  }
  return actx || null;
}
function wire(h) {
  if (h.gain !== undefined) return;
  const ac = audioCtx();
  h.gain = null;
  if (!ac) return;
  try {
    const src = ac.createMediaElementSource(h.el);
    h.gain = ac.createGain();
    src.connect(h.gain);
    h.gain.connect(ac.destination);
    h.gain.connect(exportDest);
  } catch (e) { h.gain = null; }
}
function setLevel(h, level, muted) {
  const v = muted ? 0 : level;
  if (h.gain) { h.el.volume = 1; h.gain.gain.value = v; } else h.el.volume = Math.min(1, v);
}

const handles = new Map(); // clipId -> { el, used }
const images = new Map();  // mediaId -> HTMLImageElement
const MAX_ELEMENTS = 8;
const PREROLL = 1.0;       // seconds: warm up a clip that is about to start

function ensureEl(clip, media) {
  let h = handles.get(clip.id);
  if (h) return h;
  const rec = mediaFiles.get(media.id);
  if (!rec) return null;
  const el = document.createElement(media.kind === "video" ? "video" : "audio");
  el.preload = "auto";
  el.playsInline = true;
  el.src = rec.url;
  el.currentTime = clip.in;
  const frame = () => bus.emit("engine:frame");
  el.addEventListener("seeked", frame);
  el.addEventListener("loadeddata", frame);
  h = { el, used: performance.now() };
  handles.set(clip.id, h);
  wire(h);
  return h;
}

function dispose(id) {
  const h = handles.get(id);
  if (!h) return;
  h.el.pause();
  h.el.removeAttribute("src");
  h.el.load();
  handles.delete(id);
}

function ensureImage(media) {
  let img = images.get(media.id);
  if (!img) {
    const rec = mediaFiles.get(media.id);
    if (!rec) return null;
    img = new Image();
    img.onload = () => bus.emit("engine:frame");
    img.src = rec.url;
    images.set(media.id, img);
  }
  return img;
}

export const engine = {
  /** Clips under time t, ordered bottom track first (so later items paint on top). */
  activeClips(t) {
    const p = store.project;
    const order = new Map(p.tracks.map((tr, i) => [tr.id, i]));
    return p.clips
      .filter((c) => t >= c.start - 1e-6 && t < c.start + c.duration - 1e-6)
      .sort((a, b) => order.get(b.trackId) - order.get(a.trackId));
  },

  /** Drawable layers at time t: [{ src, w, h }], skipping hidden tracks and frames not decoded yet. */
  layers(t) {
    const p = store.project;
    const out = [];
    for (const clip of this.activeClips(t)) {
      if (clip.kind === "audio") continue;
      const track = p.tracks.find((tr) => tr.id === clip.trackId);
      if (!track || track.hidden) continue;
      if (clip.kind === "image") {
        const media = p.media.find((m) => m.id === clip.mediaId);
        const img = media && ensureImage(media);
        if (img?.complete && img.naturalWidth) out.push({ clip, src: img, w: img.naturalWidth, h: img.naturalHeight });
      } else {
        const h = handles.get(clip.id);
        if (h && h.el.readyState >= 2) out.push({ clip, src: h.el, w: h.el.videoWidth, h: h.el.videoHeight });
      }
    }
    return out;
  },

  /** Align every element with the playhead. Cheap enough to call every frame. */
  sync(t, playing, speed = 1, fps = 24) {
    const p = store.project;
    const now = performance.now();
    if (playing && actx && actx.state === "suspended") actx.resume().catch(() => {});
    const active = this.activeClips(t);
    const activeIds = new Set(active.map((c) => c.id));

    for (const id of [...handles.keys()]) if (!p.clips.some((c) => c.id === id)) dispose(id);

    for (const clip of active) {
      const media = p.media.find((m) => m.id === clip.mediaId);
      const track = p.tracks.find((tr) => tr.id === clip.trackId);
      if (!media || !track) continue;
      if (media.kind === "image") { ensureImage(media); continue; }
      const h = ensureEl(clip, media);
      if (!h) continue;
      const { el } = h;
      const target = clip.in + (t - clip.start);
      // Muted tracks are silenced through the gain (el.muted would also work, but keeps export in sync)
      el.muted = false;
      setLevel(h, gainAt(clip, t), track.muted || (track.hidden && clip.kind !== "audio"));
      el.playbackRate = speed;
      const drift = Math.abs(el.currentTime - target);
      if (playing) {
        if (el.paused || drift > 0.25) el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      } else {
        if (!el.paused) el.pause();
        if (drift > 0.5 / fps) el.currentTime = target;
      }
      h.used = now;
    }

    for (const [id, h] of handles) {
      if (activeIds.has(id)) continue;
      if (!h.el.paused) h.el.pause();
    }

    // Warm up clips that start within the next second while playing
    if (playing) {
      for (const clip of p.clips) {
        if (activeIds.has(clip.id) || clip.kind === "image") continue;
        const ahead = clip.start - t;
        if (ahead > 0 && ahead < PREROLL) {
          const media = p.media.find((m) => m.id === clip.mediaId);
          const h = media && ensureEl(clip, media);
          if (h) { h.used = now; if (Math.abs(h.el.currentTime - clip.in) > 0.05) h.el.currentTime = clip.in; }
        }
      }
    }

    // Keep the number of live decoders bounded
    if (handles.size > MAX_ELEMENTS) {
      const idle = [...handles].filter(([id]) => !activeIds.has(id)).sort((a, b) => a[1].used - b[1].used);
      for (const [id] of idle) { if (handles.size <= MAX_ELEMENTS) break; dispose(id); }
    }
  },

  /** MediaStream carrying the mixed timeline audio (for export), or null when WebAudio is unavailable. */
  audioStream() { audioCtx(); if (actx && actx.state === "suspended") actx.resume().catch(() => {}); return exportDest ? exportDest.stream : null; },

  pauseAll() { for (const h of handles.values()) h.el.pause(); },

  releaseAll() {
    for (const id of [...handles.keys()]) dispose(id);
    images.clear();
  },
};
