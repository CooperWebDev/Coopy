// Editing operations on timeline clips: split, trim, duplicate, delete (plain and ripple),
// retime via exact values, nudge. Each operation is ONE undo step and returns { ok, msg }
// so the UI layer decides how to report it. No DOM in here, so it is unit-testable.
import { store, newId } from "./store.js";
import { playback } from "./playback.js";
import { round6 } from "./timecode.js";
import { normalizeProps, LOOK_KEYS } from "./props.js";
import { clipEnd, clipById, trackById, resolvePlacement, computeTrim } from "./clips.js";

const EPS = 1e-6;
const ok = (msg = "") => ({ ok: true, msg });
const fail = (msg) => ({ ok: false, msg });
const clone = (o) => JSON.parse(JSON.stringify(o));

const lockedMsg = (clip) => `Track ${trackById(clip.trackId)?.name ?? ""} is locked`;
const isLocked = (clip) => !!trackById(clip.trackId)?.locked;

/** Clips whose span contains time t (edge-exclusive at the end). */
export function clipsAt(t) {
  return store.project.clips.filter((c) => t > c.start - EPS && t < clipEnd(c) - EPS);
}

/** A cut is only meaningful if both halves are at least half a frame long. */
function canCutAt(clip, t, fps) {
  const half = 0.5 / fps;
  return t - clip.start > half && clipEnd(clip) - t > half;
}

/** Split the given clips at time t as a single undo step. */
export function splitClips(ids, t) {
  const fps = playback.fps;
  const targets = ids.map(clipById).filter(Boolean);
  if (!targets.length) return fail("Nothing to split");
  const locked = targets.filter(isLocked);
  const free = targets.filter((c) => !isLocked(c));
  if (!free.length) return fail(lockedMsg(locked[0]));
  const cuttable = free.filter((c) => canCutAt(c, t, fps));
  if (!cuttable.length) return fail("Move the playhead inside the clip to split it");

  store.commit(cuttable.length > 1 ? `split ${cuttable.length} clips` : `split ${cuttable[0].name}`, (p) => {
    for (const { id } of cuttable) {
      const i = p.clips.findIndex((c) => c.id === id);
      const c = p.clips[i];
      const offset = round6(t - c.start);
      const right = {
        ...clone(c), id: newId("c"),
        start: round6(t),
        duration: round6(c.duration - offset),
        in: c.kind === "image" ? 0 : round6(c.in + offset),
      };
      c.duration = offset;
      p.clips.splice(i + 1, 0, right); // keep array order = visual order
    }
  });
  return ok(cuttable.length > 1 ? `Split ${cuttable.length} clips` : "Split clip");
}

export function splitClip(id, t) { return splitClips([id], t); }

/**
 * Split at the playhead. If the selected clip is under the playhead only that clip is cut;
 * otherwise every clip under the playhead (on unlocked tracks) is cut.
 */
export function splitAtPlayhead(selectedId = null) {
  const t = playback.time;
  const under = clipsAt(t);
  if (!under.length) return fail("No clip under the playhead");
  const sel = selectedId && under.find((c) => c.id === selectedId);
  return splitClips((sel ? [sel] : under).map((c) => c.id), t);
}

/** Drag-trim one edge to `time`. Returns the applied geometry in msg-less form via `result`. */
export function trimEdge(id, edge, time) {
  const clip = clipById(id);
  if (!clip) return fail("Clip not found");
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const r = computeTrim(store.project, clip, edge, time, playback.fps);
  if (r.start === clip.start && r.duration === clip.duration && r.in === clip.in) {
    return fail(edge === "right" && time > clipEnd(clip) ? "Can't extend further (end of source or next clip)" : "Nothing to trim");
  }
  store.commit(`trim ${edge === "left" ? "start" : "end"}`, (p) => {
    const c = p.clips.find((x) => x.id === id);
    c.start = r.start; c.duration = r.duration; c.in = r.in;
  });
  return ok();
}

export function duplicateClip(id) {
  const clip = clipById(id);
  if (!clip) return fail("Select a clip first");
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const copy = clone(clip);
  copy.id = newId("c");
  copy.start = round6(resolvePlacement(store.project, clip.trackId, clipEnd(clip), clip.duration));
  copy.name = clip.name;
  store.commit(`duplicate ${clip.name}`, (p) => { p.clips.push(copy); });
  return { ok: true, msg: "Duplicated clip", clipId: copy.id };
}

/** Delete a clip. With ripple, later clips on the same track close the gap. */
export function deleteClip(id, { ripple = false } = {}) {
  const clip = clipById(id);
  if (!clip) return fail("Select a clip first");
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const end = clipEnd(clip);
  store.commit(`${ripple ? "ripple delete" : "delete"} ${clip.name}`, (p) => {
    p.clips = p.clips.filter((c) => c.id !== id);
    if (ripple) {
      for (const c of p.clips) {
        if (c.trackId === clip.trackId && c.start >= end - EPS) c.start = round6(c.start - clip.duration);
      }
    }
  });
  return ok();
}

/** Move a clip to an exact start (placed at the nearest free spot if it would overlap). */
export function setClipStart(id, start) {
  const clip = clipById(id);
  if (!clip) return fail("Clip not found");
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const want = Math.max(0, round6(start));
  const got = round6(resolvePlacement(store.project, clip.trackId, want, clip.duration, id));
  if (Math.abs(got - clip.start) < EPS) return want === got ? ok() : fail("No room there – the clip would overlap another");
  store.commit("move clip", (p) => { p.clips.find((c) => c.id === id).start = got; });
  return got === want ? ok() : ok("Placed at the nearest free spot");
}

/** Set an exact duration by moving the right edge (clamped to neighbours / source length). */
export function setClipDuration(id, duration) {
  const clip = clipById(id);
  if (!clip) return fail("Clip not found");
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const r = computeTrim(store.project, clip, "right", clip.start + duration, playback.fps);
  if (Math.abs(r.duration - clip.duration) < EPS) {
    return Math.abs(duration - clip.duration) < EPS ? ok() : fail("Limited by the source length or the next clip");
  }
  store.commit("change duration", (p) => { p.clips.find((c) => c.id === id).duration = r.duration; });
  return Math.abs(r.duration - duration) > 1 / playback.fps ? ok("Limited by the source length or the next clip") : ok();
}

export function nudgeClip(id, frames) {
  const clip = clipById(id);
  if (!clip) return fail("Select a clip first");
  return setClipStart(id, clip.start + frames / playback.fps);
}

/**
 * Merge a patch into a clip's look/sound properties as ONE undo step.
 * `patch` values equal to the default are dropped. Allowed on locked tracks? No: locked means locked.
 */
export function setClipProps(id, patch, label = "change clip properties") {
  const clip = clipById(id);
  if (!clip) return fail("Clip not found");
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const next = normalizeProps({ ...(clip.props || {}), ...patch });
  if (JSON.stringify(next) === JSON.stringify(clip.props || {})) return ok();
  store.commit(label, (p) => { p.clips.find((c) => c.id === id).props = next; });
  return ok();
}

/** Replace only the colour/look properties with a preset (keeps transform, fades and volume). */
export function applyLook(id, lookProps, label) {
  const clip = clipById(id);
  if (!clip) return fail("Clip not found");
  const keep = { ...(clip.props || {}) };
  for (const k of LOOK_KEYS) delete keep[k];
  if (isLocked(clip)) return fail(lockedMsg(clip));
  const next = normalizeProps({ ...keep, ...lookProps });
  store.commit(label, (p) => { p.clips.find((c) => c.id === id).props = next; });
  return ok();
}
