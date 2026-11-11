// Frame compositor shared by the preview and the exporter, so what you see is what you export.
import { engine } from "./engine.js";
import { opacityAt, getProps, filterString } from "./props.js";

/** Draw every visible layer at time t onto ctx (canvas of size w×h). Returns number of layers drawn. */
export function renderTimeline(ctx, w, h, t) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = "none";
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const layers = engine.layers(t);
  for (const l of layers) {
    const p = getProps(l.clip);
    const a = opacityAt(l.clip, t);
    if (a <= 0 || !l.w || !l.h) continue;
    const fit = Math.min(w / l.w, h / l.h) * (p.scale / 100);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.filter = filterString(l.clip, h);
    ctx.translate(w / 2 + (p.x / 100) * w, h / 2 + (p.y / 100) * h);
    ctx.rotate((p.rotation * Math.PI) / 180);
    ctx.drawImage(l.src, (-l.w * fit) / 2, (-l.h * fit) / 2, l.w * fit, l.h * fit);
    ctx.restore();
  }
  ctx.restore();
  return layers.length;
}
