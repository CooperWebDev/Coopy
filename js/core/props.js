// Per-clip look & sound properties (Stages 5–8). Pure functions, no DOM: unit-testable in Node.
// A clip stores only the properties that differ from DEFAULTS in clip.props.

export const DEFAULTS = Object.freeze({
  opacity: 100,     // %
  scale: 100,       // %
  x: 0, y: 0,       // % of canvas width / height, offset from centre
  rotation: 0,      // degrees
  volume: 100,      // % (0–200)
  fadeIn: 0, fadeOut: 0, // seconds (fade picture and sound)
  brightness: 100, contrast: 100, saturation: 100, // %
  hue: 0,           // degrees
  blur: 0,          // px at 720p
  grayscale: 0, sepia: 0, // %
});

export const RANGES = {
  opacity: [0, 100, 1], scale: [5, 400, 1], x: [-100, 100, 0.5], y: [-100, 100, 0.5], rotation: [-180, 180, 1],
  volume: [0, 200, 1], fadeIn: [0, 10, 0.1], fadeOut: [0, 10, 0.1],
  brightness: [0, 200, 1], contrast: [0, 200, 1], saturation: [0, 200, 1], hue: [-180, 180, 1],
  blur: [0, 40, 0.5], grayscale: [0, 100, 1], sepia: [0, 100, 1],
};

export const getProps = (clip) => ({ ...DEFAULTS, ...(clip.props || {}) });

export function clampProp(key, v) {
  const r = RANGES[key];
  if (!r || !Number.isFinite(v)) return DEFAULTS[key];
  return Math.min(r[1], Math.max(r[0], v));
}

/** Return a clean props object (defaults removed, values clamped). */
export function normalizeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(k in DEFAULTS)) continue;
    const c = clampProp(k, Number(v));
    if (c !== DEFAULTS[k]) out[k] = c;
  }
  return out;
}

/** 0..1 multiplier from fade in/out at timeline time t. */
export function fadeFactor(clip, t) {
  const p = getProps(clip);
  const local = t - clip.start;
  let f = 1;
  if (p.fadeIn > 0 && local < p.fadeIn) f = Math.min(f, Math.max(0, local / p.fadeIn));
  const left = clip.start + clip.duration - t;
  if (p.fadeOut > 0 && left < p.fadeOut) f = Math.min(f, Math.max(0, left / p.fadeOut));
  return f;
}

export const opacityAt = (clip, t) => (getProps(clip).opacity / 100) * fadeFactor(clip, t);
export const gainAt = (clip, t) => (getProps(clip).volume / 100) * fadeFactor(clip, t);

/** CSS filter string for ctx.filter, or "none". `scale` adapts blur to the canvas height. */
export function filterString(clip, canvasH = 720) {
  const p = getProps(clip);
  const parts = [];
  if (p.brightness !== 100) parts.push(`brightness(${p.brightness}%)`);
  if (p.contrast !== 100) parts.push(`contrast(${p.contrast}%)`);
  if (p.saturation !== 100) parts.push(`saturate(${p.saturation}%)`);
  if (p.hue !== 0) parts.push(`hue-rotate(${p.hue}deg)`);
  if (p.grayscale > 0) parts.push(`grayscale(${p.grayscale}%)`);
  if (p.sepia > 0) parts.push(`sepia(${p.sepia}%)`);
  if (p.blur > 0) parts.push(`blur(${(p.blur * canvasH / 720).toFixed(2)}px)`);
  return parts.length ? parts.join(" ") : "none";
}

/** Looks the Effects panel can apply in one click (each replaces the look props, not transform/audio). */
export const LOOK_KEYS = ["brightness", "contrast", "saturation", "hue", "blur", "grayscale", "sepia"];
export const PRESETS = [
  { name: "None", props: {} },
  { name: "Black & White", props: { grayscale: 100, contrast: 110 } },
  { name: "Sepia", props: { sepia: 80, contrast: 95 } },
  { name: "Vivid", props: { saturation: 150, contrast: 115 } },
  { name: "Faded", props: { saturation: 70, contrast: 85, brightness: 108 } },
  { name: "Cool", props: { hue: -12, saturation: 110 } },
  { name: "Warm", props: { sepia: 25, saturation: 115, brightness: 104 } },
  { name: "Dreamy", props: { blur: 3, brightness: 112, saturation: 120 } },
  { name: "Noir", props: { grayscale: 100, contrast: 150, brightness: 90 } },
];
