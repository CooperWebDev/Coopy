export const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, "0");

/** seconds -> HH:MM:SS:FF */
export function toTimecode(seconds, fps = 24) {
  const s = Math.max(0, seconds);
  const totalFrames = Math.round(s * fps);
  const f = totalFrames % Math.round(fps);
  const totalSec = Math.floor(totalFrames / Math.round(fps));
  return `${pad(totalSec / 3600)}:${pad((totalSec / 60) % 60)}:${pad(totalSec % 60)}:${pad(f)}`;
}

/** Snap a time to the nearest frame boundary. */
export const snapToFrame = (seconds, fps = 24) => Math.round(seconds * fps) / fps;

/** Round to micro-seconds so repeated trims/splits never accumulate float drift. */
export const round6 = (x) => Math.round(x * 1e6) / 1e6;

/**
 * Parse user input into seconds. Accepts timecode "HH:MM:SS:FF" (any number of leading parts,
 * e.g. "12:05" = 12 s 5 frames), or a plain integer = frames. Returns null if unparseable.
 */
export function parseTimecode(text, fps = 24) {
  const t = String(text).trim().replace(/[;.]/g, ":");
  if (!/^\d+(:\d+){0,3}$/.test(t)) return null;
  const parts = t.split(":").map(Number);
  if (parts.length === 1) return parts[0] / fps;
  const rate = Math.round(fps);
  const [f = 0, s = 0, m = 0, h = 0] = parts.reverse();
  if (f >= rate) return null;
  return h * 3600 + m * 60 + s + f / fps;
}
