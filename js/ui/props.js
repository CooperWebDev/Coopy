// Clip property panels: Transform / Fades / Audio (Inspector), Color (Color tab), Looks (Effects tab).
// Sliders preview live while dragging; releasing commits ONE undo step.
import { bus } from "../core/events.js";
import { store } from "../core/store.js";
import { selection } from "../core/selection.js";
import * as edit from "../core/edit.js";
import { DEFAULTS, RANGES, getProps, PRESETS, normalizeProps } from "../core/props.js";
import { toast } from "./toast.js";

const colorPage = document.querySelector('[data-page="color"]');
const fxPage = document.querySelector('[data-page="effects"]');
const UNITS = { opacity: "%", scale: "%", x: "%", y: "%", rotation: "°", volume: "%", fadeIn: " s", fadeOut: " s",
  brightness: "%", contrast: "%", saturation: "%", hue: "°", blur: " px", grayscale: "%", sepia: "%" };
const LABELS = { opacity: "Opacity", scale: "Scale", x: "Position X", y: "Position Y", rotation: "Rotation", volume: "Volume",
  fadeIn: "Fade in", fadeOut: "Fade out", brightness: "Brightness", contrast: "Contrast", saturation: "Saturation",
  hue: "Hue shift", blur: "Blur", grayscale: "Grayscale", sepia: "Sepia" };

const clipOf = (id) => store.project.clips.find((c) => c.id === id);

function slider(clip, key) {
  const [min, max, step] = RANGES[key];
  const row = document.createElement("div");
  row.className = "prop-row";
  const label = Object.assign(document.createElement("label"), { textContent: LABELS[key] });
  const range = Object.assign(document.createElement("input"), { type: "range", min, max, step, value: getProps(clip)[key] });
  const num = Object.assign(document.createElement("input"), { type: "number", min, max, step, value: getProps(clip)[key] });
  const reset = Object.assign(document.createElement("button"), { className: "icon-btn prop-reset", textContent: "↺", title: "Reset to default" });
  let before = null;

  const live = (v) => {
    const c = clipOf(clip.id);
    if (!c) return;
    if (before === null) before = c.props ? { ...c.props } : undefined;
    c.props = normalizeProps({ ...(c.props || {}), [key]: v }); // not undoable yet
    range.value = num.value = getProps(c)[key];
    bus.emit("engine:frame");
  };
  const commit = () => {
    const c = clipOf(clip.id);
    if (!c || before === null) return;
    const finalVal = getProps(c)[key];
    c.props = before; before = null;               // restore, then record as a proper undo step
    const r = edit.setClipProps(clip.id, { [key]: finalVal }, `${LABELS[key].toLowerCase()}`);
    if (!r.ok) { toast(r.msg); bus.emit("engine:frame"); }
  };
  range.addEventListener("input", () => live(Number(range.value)));
  range.addEventListener("change", commit);
  num.addEventListener("input", () => live(Number(num.value)));
  num.addEventListener("change", commit);
  reset.addEventListener("click", () => { before = null; const r = edit.setClipProps(clip.id, { [key]: DEFAULTS[key] }, `reset ${LABELS[key].toLowerCase()}`); if (!r.ok) toast(r.msg); });
  const unit = Object.assign(document.createElement("span"), { className: "prop-unit", textContent: UNITS[key] });
  row.append(label, range, num, unit, reset);
  return row;
}

function section(title, keys, clip) {
  const s = document.createElement("div");
  const h = Object.assign(document.createElement("div"), { className: "insp-sub", textContent: title });
  const body = document.createElement("div");
  body.className = "prop-grid";
  for (const k of keys) body.append(slider(clip, k));
  s.append(h, body);
  return s;
}

/** Sections appended to the Inspector for a clip. */
export function clipPropSections(clip) {
  const out = [];
  if (clip.kind !== "audio") {
    out.push(section("Transform", ["scale", "x", "y", "rotation"], clip));
    out.push(section("Opacity", ["opacity"], clip));
  }
  if (clip.kind !== "image") out.push(section("Audio", ["volume"], clip));
  out.push(section("Fades", ["fadeIn", "fadeOut"], clip));
  return out;
}

function renderColor() {
  const clip = selection.kind === "clip" ? clipOf(selection.id) : null;
  colorPage.replaceChildren();
  if (!clip || clip.kind === "audio") {
    colorPage.innerHTML = `<div class="empty-state"><p><strong>Color grading</strong></p><p class="muted">${clip ? "Audio clips have no picture." : "Select a video or image clip to adjust its color."}</p></div>`;
    return;
  }
  colorPage.append(section("Color", ["brightness", "contrast", "saturation", "hue"], clip), section("Stylize", ["grayscale", "sepia", "blur"], clip));
  const b = Object.assign(document.createElement("button"), { className: "btn btn-sm", textContent: "Reset all color" });
  b.style.margin = "8px 12px";
  b.addEventListener("click", () => toast(edit.applyLook(clip.id, {}, "reset color").msg || "Color reset"));
  colorPage.append(b);
}

function renderEffects() {
  const clip = selection.kind === "clip" ? clipOf(selection.id) : null;
  fxPage.replaceChildren();
  const head = Object.assign(document.createElement("div"), { className: "insp-sub", textContent: "Looks" });
  const grid = document.createElement("div");
  grid.className = "look-grid";
  for (const pr of PRESETS) {
    const b = Object.assign(document.createElement("button"), { className: "btn look", textContent: pr.name, disabled: !clip || clip.kind === "audio" });
    b.title = clip ? `Apply "${pr.name}" to the selected clip` : "Select a video or image clip first";
    b.addEventListener("click", () => { const r = edit.applyLook(clip.id, pr.props, `look ${pr.name}`); if (!r.ok) toast(r.msg); });
    grid.append(b);
  }
  const note = Object.assign(document.createElement("p"), { className: "muted", textContent: "Looks set the Color tab values; fine-tune them there. Fades are in the Inspector." });
  note.style.padding = "8px 12px";
  fxPage.append(head, grid, note);
}

export function initProps() {
  const refresh = () => { renderColor(); renderEffects(); };
  bus.on("selection:changed", refresh);
  bus.on("project:changed", refresh);
  bus.on("project:loaded", refresh);
  refresh();
}
