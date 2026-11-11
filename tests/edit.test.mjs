import assert from "node:assert/strict";
import { store, createProject } from "../js/core/store.js";
import { playback } from "../js/core/playback.js";
import { parseTimecode } from "../js/core/timecode.js";
import * as E from "../js/core/edit.js";

const fps = 24;
function fresh() {
  const p = createProject();
  p.media = [
    { id: "mv", kind: "video", name: "vid", duration: 10 },
    { id: "ma", kind: "audio", name: "aud", duration: 8 },
    { id: "mi", kind: "image", name: "img", duration: 5 },
  ];
  store.load(p);
  playback.time = 0;
  return p;
}
const V1 = () => store.project.tracks.find((t) => t.name === "V1").id;
const A1 = () => store.project.tracks.find((t) => t.name === "A1").id;
let n = 0;
const add = (mediaId, trackId, start, duration, inn = 0) => {
  const m = store.project.media.find((x) => x.id === mediaId);
  const c = { id: `c${++n}`, mediaId, trackId, kind: m.kind, name: m.name, start, duration, in: inn };
  store.project.clips.push(c); return c;
};
const t = (name, fn) => { fresh(); fn(); console.log("ok -", name); };

t("split keeps picture continuous (in/duration)", () => {
  add("mv", V1(), 2, 6, 1);              // timeline 2..8 shows source 1..7
  playback.time = 5;
  const r = E.splitAtPlayhead();
  assert.ok(r.ok);
  const [a, b] = store.project.clips;
  assert.equal(a.start, 2); assert.equal(a.duration, 3); assert.equal(a.in, 1);
  assert.equal(b.start, 5); assert.equal(b.duration, 3); assert.equal(b.in, 4);   // 1 + 3
  assert.notEqual(a.id, b.id);
  // undo is a single step
  store.undo(); assert.equal(store.project.clips.length, 1);
  assert.equal(store.project.clips[0].duration, 6);
  store.redo(); assert.equal(store.project.clips.length, 2);
});

t("split at/near edge is refused", () => {
  add("mv", V1(), 2, 6);
  playback.time = 2; assert.equal(E.splitAtPlayhead().ok, false);
  playback.time = 8; assert.equal(E.splitAtPlayhead().ok, false);
  playback.time = 1; assert.equal(E.splitAtPlayhead().ok, false);
  assert.equal(store.project.clips.length, 1);
});

t("split with no selection cuts all unlocked clips under playhead; selected-only otherwise", () => {
  const v = add("mv", V1(), 0, 6), a = add("ma", A1(), 0, 6);
  playback.time = 3;
  assert.equal(E.splitAtPlayhead(v.id).ok, true);       // only the selected one
  assert.equal(store.project.clips.length, 3);
  store.undo();
  assert.equal(E.splitAtPlayhead(null).ok, true);       // both
  assert.equal(store.project.clips.length, 4);
});

t("split skips / refuses locked tracks", () => {
  const v = add("mv", V1(), 0, 6);
  store.project.tracks.find((x) => x.id === V1()).locked = true;
  playback.time = 3;
  const r = E.splitAtPlayhead(); assert.equal(r.ok, false); assert.match(r.msg, /locked/);
  assert.equal(store.project.clips.length, 1);
});

t("split image: both halves keep in=0", () => {
  add("mi", V1(), 0, 5); playback.time = 2; E.splitAtPlayhead();
  assert.deepEqual(store.project.clips.map((c) => c.in), [0, 0]);
  assert.deepEqual(store.project.clips.map((c) => c.duration), [2, 3]);
});

t("trim left advances in-point; right only changes duration", () => {
  const c = add("mv", V1(), 2, 6, 1);
  assert.ok(E.trimEdge(c.id, "left", 3).ok);
  assert.deepEqual([c.start, c.duration, c.in], [3, 5, 2]);
  assert.ok(E.trimEdge(c.id, "right", 6).ok);
  assert.deepEqual([c.start, c.duration, c.in], [3, 3, 2]);
});

t("trim can restore footage (extend) up to source limits", () => {
  const c = add("mv", V1(), 2, 4, 3);                    // source 3..7 of 10
  E.trimEdge(c.id, "left", -50);                         // as far left as possible
  // timeline start can't go below 0 (source allows 2-3=-1): so start=0, in=3-2=1
  assert.equal(c.start, 0); assert.equal(c.in, 1); assert.equal(c.duration, 6);
  E.trimEdge(c.id, "right", 999);                        // source ends at 10 -> end = 0 + (10-1) = 9
  assert.equal(c.start + c.duration, 9);
});

t("trim never crosses neighbours or goes under one frame", () => {
  const a = add("mv", V1(), 0, 3), b = add("mv", V1(), 3, 3, 0), c = add("mv", V1(), 8, 2);
  E.trimEdge(b.id, "left", 1);   assert.equal(b.start, 3);           // blocked by a
  assert.equal(E.trimEdge(b.id, "left", 1).ok, false);
  E.trimEdge(b.id, "right", 20); assert.equal(b.start + b.duration, 8); // blocked by c (and source)
  E.trimEdge(b.id, "right", 0);  assert.ok(Math.abs(b.duration - 1 / fps) < 1e-6);
});

t("image clips extend freely, in stays 0", () => {
  const i = add("mi", V1(), 0, 5);
  E.trimEdge(i.id, "right", 60); assert.equal(i.duration, 60);
  add("mi", V1(), 100, 2);
  E.trimEdge(i.id, "right", 500); assert.equal(i.duration, 100);     // stops at next clip
  E.trimEdge(i.id, "left", 10); assert.equal(i.in, 0); assert.equal(i.start, 10);
});

t("trim on locked track refused", () => {
  const c = add("mv", V1(), 0, 5); store.project.tracks.find((x) => x.id === V1()).locked = true;
  assert.equal(E.trimEdge(c.id, "right", 2).ok, false); assert.equal(c.duration, 5);
});

t("duplicate lands after the original, or nearest free spot, with new id", () => {
  const a = add("mv", V1(), 0, 3), b = add("mv", V1(), 3, 2);
  const r = E.duplicateClip(a.id);
  const d = store.project.clips.find((c) => c.id === r.clipId);
  assert.notEqual(d.id, a.id); assert.equal(d.duration, 3); assert.equal(d.in, a.in);
  assert.ok(d.start >= 5 - 1e-9);                                    // 3..5 is taken by b
  const spans = store.project.clips.map((c) => [c.start, c.start + c.duration]).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-9, "no overlap");
  store.undo(); assert.equal(store.project.clips.length, 2);
});

t("delete and ripple delete (same track only)", () => {
  const a = add("mv", V1(), 0, 3), b = add("mv", V1(), 3, 2), c = add("mv", V1(), 6, 2), au = add("ma", A1(), 6, 2);
  E.deleteClip(b.id);
  assert.equal(c.start, 6);                                          // plain delete leaves a gap
  store.undo();
  E.deleteClip(b.id, { ripple: true });
  const cc = store.project.clips.find((x) => x.id === c.id);
  assert.equal(cc.start, 4);
  assert.equal(store.project.clips.find((x) => x.id === au.id).start, 6); // other track untouched
  assert.equal(store.project.clips.find((x) => x.id === a.id).start, 0);
});

t("exact start / duration / nudge", () => {
  const a = add("mv", V1(), 0, 3), b = add("mv", V1(), 5, 2);
  const A = () => store.project.clips.find((c) => c.id === a.id);
  assert.ok(E.setClipStart(a.id, 1).ok); assert.equal(A().start, 1);
  E.setClipStart(a.id, 4.5);                                         // overlaps b -> nearest free spot
  const spans = store.project.clips.map((c) => [c.start, c.start + c.duration]).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] >= spans[i - 1][1] - 1e-9, "no overlap");
  E.setClipStart(a.id, 0);
  E.setClipDuration(a.id, 1.5); assert.equal(A().duration, 1.5);
  E.nudgeClip(a.id, 1); assert.ok(Math.abs(A().start - 1 / fps) < 1e-6);
  E.nudgeClip(a.id, -10); assert.equal(A().start, 0);                 // can't go below 0
});

t("setClipDuration is limited by source", () => {
  const a = add("ma", A1(), 0, 3);                                   // audio is 8s
  const r = E.setClipDuration(a.id, 30);
  assert.equal(store.project.clips[0].duration, 8); assert.ok(r.msg);
});

t("parseTimecode", () => {
  assert.equal(parseTimecode("00:00:02:12", 24), 2.5);
  assert.equal(parseTimecode("2:12", 24), 2.5);
  assert.equal(parseTimecode("48", 24), 2);
  assert.equal(parseTimecode("00:00:00:30", 24), null);              // frame >= fps
  assert.equal(parseTimecode("abc", 24), null);
});

// ---- Stage 5-8: clip properties ----
import { getProps, normalizeProps, fadeFactor, gainAt, opacityAt, filterString, DEFAULTS } from "../js/core/props.js";
t("props: defaults are dropped, values clamped", () => {
  assert.deepEqual(normalizeProps({ opacity: 100, scale: 9999, bogus: 1, volume: -5 }), { scale: 400, volume: 0 });
  assert.equal(getProps({}).opacity, DEFAULTS.opacity);
});
t("props: fades scale opacity and gain", () => {
  const c = { start: 10, duration: 4, props: { fadeIn: 2, fadeOut: 1, volume: 50 } };
  assert.equal(fadeFactor(c, 10), 0);
  assert.equal(fadeFactor(c, 11), 0.5);
  assert.equal(fadeFactor(c, 12), 1);
  assert.equal(fadeFactor(c, 13.5), 0.5);
  assert.equal(gainAt(c, 12), 0.5);
  assert.equal(opacityAt({ start: 0, duration: 4, props: { opacity: 50 } }, 2), 0.5);
});
t("props: filter string", () => {
  assert.equal(filterString({}), "none");
  assert.equal(filterString({ props: { grayscale: 100, blur: 2 } }, 720), "grayscale(100%) blur(2.00px)");
});
t("setClipProps is one undo step and respects locks", () => {
  const c = add("mv", V1(), 0, 4);
  assert.ok(E.setClipProps(c.id, { opacity: 40, scale: 120 }).ok);
  assert.deepEqual(store.project.clips[0].props, { opacity: 40, scale: 120 });
  store.undo();
  assert.equal(store.project.clips[0].props, undefined);
  store.redo();
  assert.equal(store.project.clips[0].props.opacity, 40);
  E.setClipProps(c.id, { opacity: 100, scale: 100 });
  assert.deepEqual(store.project.clips[0].props, {});
  store.project.tracks.find((x) => x.id === V1()).locked = true;
  assert.equal(E.setClipProps(c.id, { opacity: 10 }).ok, false);
});
t("split and duplicate keep clip props", () => {
  const c = add("mv", V1(), 0, 6);
  E.setClipProps(c.id, { sepia: 60 });
  playback.time = 2;
  E.splitClip(c.id, 2);
  assert.ok(store.project.clips.every((x) => x.props.sepia === 60));
});
t("applyLook replaces look but keeps transform", () => {
  const c = add("mv", V1(), 0, 4);
  E.setClipProps(c.id, { scale: 150, sepia: 50 });
  E.applyLook(c.id, { grayscale: 100 }, "look");
  assert.deepEqual(store.project.clips[0].props, { scale: 150, grayscale: 100 });
});
{
  fresh();
  const { renderTimeline } = await import("../js/core/render.js");
  const { engine } = await import("../js/core/engine.js");
  const calls = [];
  const names = ["drawImage", "save", "restore", "translate", "rotate", "setTransform", "fillRect"];
  const ctx = new Proxy({}, { get: (_, k) => (names.includes(k) ? (...a) => calls.push([k, ...a]) : undefined), set: (_, k, v) => { calls.push(["set", k, v]); return true; } });
  const orig = engine.layers;
  engine.layers = () => [{ clip: { start: 0, duration: 4, props: { opacity: 50, scale: 50, x: 10 } }, src: {}, w: 1920, h: 1080 }];
  const n = renderTimeline(ctx, 1280, 720, 1);
  engine.layers = orig;
  assert.equal(n, 1);
  const draw = calls.find((c) => c[0] === "drawImage");
  assert.equal(draw[5], 360); // 1080 * (720/1080 fit) * 0.5 scale
  assert.equal(draw[4], 640); // 1920 * (720/1080) * 0.5
  assert.ok(calls.some((c) => c[0] === "set" && c[1] === "globalAlpha" && c[2] === 0.5));
  assert.ok(calls.some((c) => c[0] === "translate" && c[1] === 640 + 128 && c[2] === 360));
  console.log("ok - renderTimeline applies opacity, scale and position");
}
console.log("\nall passed");
