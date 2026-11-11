// Clip model helpers. A clip is JSON: { id, mediaId, trackId, kind, name, start, duration, in }
// start/duration/in are in seconds on the timeline / source.
import { store, newId } from "./store.js";
import { playback } from "./playback.js";
import { snapToFrame, round6 } from "./timecode.js";

const EPS = 1e-6;
export const clipEnd = (c) => c.start + c.duration;

export const trackById = (id) => store.project.tracks.find((t) => t.id === id);
export const mediaById = (id) => store.project.media.find((m) => m.id === id);
export const clipById = (id) => store.project.clips.find((c) => c.id === id);

/** Track type a media kind may be placed on. Video and stills go on video tracks. */
export const trackTypeFor = (mediaKind) => (mediaKind === "audio" ? "audio" : "video");

/**
 * Nearest start >= 0 at which a clip of `duration` fits on the track without overlapping
 * another clip. Always succeeds (after the last clip is always free).
 */
export function resolvePlacement(project, trackId, start, duration, ignoreId = null) {
  start = Math.max(0, start);
  const others = project.clips.filter((c) => c.trackId === trackId && c.id !== ignoreId);
  const overlaps = (s) => others.some((c) => s < clipEnd(c) - EPS && s + duration > c.start + EPS);
  if (!overlaps(start)) return start;
  const cands = [0, ...others.map(clipEnd), ...others.map((c) => c.start - duration)]
    .filter((s) => s >= 0 && !overlaps(s));
  cands.sort((a, b) => Math.abs(a - start) - Math.abs(b - start));
  return cands[0];
}

/** Snap candidates: timeline start, playhead and every other clip edge. */
export function snapPoints(excludeIds = []) {
  const pts = [0, playback.time];
  for (const c of store.project.clips) {
    if (excludeIds.includes(c.id)) continue;
    pts.push(c.start, clipEnd(c));
  }
  return pts;
}

/**
 * Snap a clip's start (or end) to the nearest snap point within `thresholdSec`.
 * Returns { start, guide } where guide is the time snapped to (or null).
 */
export function snapStart(start, duration, thresholdSec, excludeIds = []) {
  let best = null;
  for (const p of snapPoints(excludeIds)) {
    for (const [edge, offset] of [[start, 0], [start + duration, duration]]) {
      const d = Math.abs(edge - p);
      if (d <= thresholdSec && (!best || d < best.d)) best = { d, start: p - offset, guide: p };
    }
  }
  return best ? { start: best.start, guide: best.guide } : { start, guide: null };
}

export function newClip(media, trackId, start) {
  return {
    id: newId("c"), mediaId: media.id, trackId, kind: media.kind, name: media.name,
    start: snapToFrame(start, playback.fps), duration: media.duration, in: 0,
  };
}

export function addClip(media, trackId, start) {
  const clip = newClip(media, trackId, resolvePlacement(store.project, trackId, start, media.duration));
  store.commit(`add ${media.name}`, (p) => { p.clips.push(clip); });
  return clip;
}

/** Preferred unlocked track for a media kind: V1 (lowest video) or A1 (first audio). */
export function defaultTrackFor(media) {
  const type = trackTypeFor(media.kind);
  const list = store.project.tracks.filter((t) => t.type === type && !t.locked);
  return type === "video" ? list[list.length - 1] : list[0];
}

/** Snap a single time (e.g. a trimmed edge) to the nearest snap point within thresholdSec. */
export function snapTime(t, thresholdSec, excludeIds = []) {
  let best = null;
  for (const p of snapPoints(excludeIds)) {
    const d = Math.abs(t - p);
    if (d <= thresholdSec && (!best || d < best.d)) best = { d, p };
  }
  return best ? { time: best.p, guide: best.p } : { time: t, guide: null };
}

/**
 * How far a clip's edges may move: bounded by the neighbouring clips on the same track and,
 * for video/audio, by the source file (the clip can't show footage that doesn't exist).
 * Stills have no source length, so they can be extended freely.
 */
export function trimLimits(project, clip) {
  const end = clipEnd(clip);
  const others = project.clips.filter((c) => c.trackId === clip.trackId && c.id !== clip.id);
  let prevEnd = 0, nextStart = Infinity;
  for (const o of others) {
    if (clipEnd(o) <= clip.start + EPS) prevEnd = Math.max(prevEnd, clipEnd(o));
    else if (o.start >= end - EPS) nextStart = Math.min(nextStart, o.start);
  }
  const media = project.media.find((m) => m.id === clip.mediaId);
  const finite = clip.kind !== "image" && media && Number.isFinite(media.duration);
  return {
    minStart: Math.max(prevEnd, finite ? clip.start - clip.in : 0),
    maxEnd: Math.min(nextStart, finite ? clip.start + (media.duration - clip.in) : Infinity),
  };
}

/**
 * Result of dragging one edge of `clip` to `time`: { start, duration, in }.
 * Frame-snapped, clamped to trimLimits, never shorter than one frame.
 * Trimming the left edge also advances the source in-point so the picture doesn't slide.
 */
export function computeTrim(project, clip, edge, time, fps) {
  const minDur = 1 / fps;
  const { minStart, maxEnd } = trimLimits(project, clip);
  const end = clipEnd(clip);
  const t = snapToFrame(time, fps);
  if (edge === "left") {
    const s = round6(Math.min(Math.max(t, minStart), end - minDur));
    return { start: s, duration: round6(end - s), in: clip.kind === "image" ? 0 : round6(clip.in + (s - clip.start)) };
  }
  const e = Math.max(Math.min(t, maxEnd), clip.start + minDur);
  return { start: clip.start, duration: round6(e - clip.start), in: clip.in };
}
