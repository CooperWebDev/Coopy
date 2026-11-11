// Tiny pub/sub bus used by every module so they stay decoupled.
const handlers = new Map();

export const bus = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt)?.delete(fn);
  },
  emit(evt, payload) {
    handlers.get(evt)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error(`[bus] handler for "${evt}" failed`, err); }
    });
  },
};
