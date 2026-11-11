// Media import: classify, probe metadata, generate cached thumbnails.
// Heavy bytes are never read into JS memory: files are referenced through object URLs.
import { store, newId } from "./store.js";

/** id -> { file, url }. Runtime only (persisted to IndexedDB in Stage 12). */
export const mediaFiles = new Map();

const THUMB_W = 160, THUMB_H = 90;
const PROBE_TIMEOUT = 15000;

const EXT = {
  video: ["mp4", "m4v", "mov", "webm", "mkv", "ogv", "avi"],
  audio: ["mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus"],
  image: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"],
};

export function classify(file) {
  const t = file.type || "";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (t.startsWith("image/")) return "image";
  const ext = file.name.split(".").pop().toLowerCase();
  return Object.keys(EXT).find((k) => EXT[k].includes(ext)) ?? null;
}

export const formatSize = (b) =>
  b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : b < 1073741824 ? `${(b / 1048576).toFixed(1)} MB` : `${(b / 1073741824).toFixed(2)} GB`;

export function formatDuration(s) {
  if (!Number.isFinite(s)) return "–";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function once(el, okEvent, what) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => done(new Error(`Timed out reading ${what}`)), PROBE_TIMEOUT);
    const ok = () => done();
    const bad = () => done(new Error(`The browser can't decode this ${what} (unsupported codec or corrupt file)`));
    function done(err) {
      clearTimeout(t);
      el.removeEventListener(okEvent, ok);
      el.removeEventListener("error", bad);
      err ? reject(err) : resolve();
    }
    el.addEventListener(okEvent, ok);
    el.addEventListener("error", bad);
  });
}

function drawThumb(source, sw, sh) {
  const c = document.createElement("canvas");
  c.width = THUMB_W; c.height = THUMB_H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  const s = Math.min(THUMB_W / sw, THUMB_H / sh);
  const w = sw * s, h = sh * s;
  ctx.drawImage(source, (THUMB_W - w) / 2, (THUMB_H - h) / 2, w, h);
  return c.toDataURL("image/jpeg", 0.72);
}

async function probeVideo(url) {
  const v = document.createElement("video");
  v.muted = true; v.preload = "metadata"; v.src = url;
  await once(v, "loadedmetadata", "video");
  if (!v.videoWidth) throw new Error("No decodable video track (the browser may not support this video codec)");
  const duration = v.duration;
  // seek to ~10% for a representative thumbnail
  v.currentTime = Number.isFinite(duration) ? Math.min(duration * 0.1, 2) : 0;
  await once(v, "seeked", "video frame");
  const thumb = drawThumb(v, v.videoWidth, v.videoHeight);
  const out = { duration, width: v.videoWidth, height: v.videoHeight, thumb };
  v.removeAttribute("src"); v.load();
  return out;
}

async function probeAudio(url) {
  const a = document.createElement("audio");
  a.preload = "metadata"; a.src = url;
  await once(a, "loadedmetadata", "audio");
  const out = { duration: a.duration, width: 0, height: 0, thumb: null };
  a.removeAttribute("src"); a.load();
  return out;
}

async function probeImage(url) {
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch { throw new Error("The browser can't decode this image"); }
  const w = img.naturalWidth || 1920, h = img.naturalHeight || 1080;
  return { duration: 5, width: w, height: h, thumb: drawThumb(img, w, h) };
}

/**
 * Import files into a bin. Returns { added, failed:[{name, reason}] }.
 * onProgress(done, total, currentName)
 */
export async function importFiles(files, binId, onProgress) {
  const list = [...files];
  const added = [], failed = [];
  for (let i = 0; i < list.length; i++) {
    const file = list[i];
    onProgress?.(i, list.length, file.name);
    const kind = classify(file);
    if (!kind) { failed.push({ name: file.name, reason: "Unsupported file type" }); continue; }
    const url = URL.createObjectURL(file);
    try {
      const meta = kind === "video" ? await probeVideo(url) : kind === "audio" ? await probeAudio(url) : await probeImage(url);
      const rec = {
        id: newId("m"), name: file.name, kind, mime: file.type || "", size: file.size,
        duration: meta.duration, width: meta.width, height: meta.height, thumb: meta.thumb,
        binId, added: Date.now(),
      };
      mediaFiles.set(rec.id, { file, url });
      added.push(rec);
    } catch (err) {
      URL.revokeObjectURL(url);
      failed.push({ name: file.name, reason: err.message });
    }
  }
  onProgress?.(list.length, list.length, "");
  if (added.length) {
    store.commit(`import ${added.length} item${added.length > 1 ? "s" : ""}`, (p) => { p.media.push(...added); });
  }
  return { added, failed };
}

/** Free all runtime file handles (used when a new project replaces the current one). */
export function releaseAllMedia() {
  for (const { url } of mediaFiles.values()) URL.revokeObjectURL(url);
  mediaFiles.clear();
}
