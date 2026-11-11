// Single selection shared by the media pool, timeline and inspector.
import { bus } from "./events.js";

export const selection = {
  kind: null, // "media" | "clip" | null
  id: null,
  set(kind, id) {
    if (!id) { kind = null; id = null; }
    if (kind === this.kind && id === this.id) return;
    this.kind = kind;
    this.id = id;
    bus.emit("selection:changed", { kind, id });
  },
  clear() { this.set(null, null); },
};
