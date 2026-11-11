// Central shortcut registry. Bindings live in one table so a remapping UI can be added later.
import { bus } from "../core/events.js";
import { transport } from "../core/transport.js";
import { zoomBy } from "./timeline.js";
import { toggleFullscreen } from "./preview.js";
import { isModalOpen } from "./modal.js";

// combo format: [ctrl+][shift+][alt+]key  (key lowercased, e.g. "ctrl+shift+z", " ", "arrowleft")
export const SHORTCUTS = [
  { combo: " ", label: "Play / Pause", display: "Space", run: () => transport.toggle() },
  { combo: "ctrl+z", label: "Undo", display: "Ctrl+Z", run: () => bus.emit("cmd:undo") },
  { combo: "ctrl+shift+z", label: "Redo", display: "Ctrl+Shift+Z", run: () => bus.emit("cmd:redo") },
  { combo: "ctrl+y", label: "Redo (alt)", display: "Ctrl+Y", run: () => bus.emit("cmd:redo") },
  { combo: "arrowleft", label: "Previous frame", display: "←", run: () => transport.step(-1) },
  { combo: "arrowright", label: "Next frame", display: "→", run: () => transport.step(1) },
  { combo: "shift+arrowleft", label: "Back 10 frames", display: "Shift+←", run: () => transport.step(-10) },
  { combo: "shift+arrowright", label: "Forward 10 frames", display: "Shift+→", run: () => transport.step(10) },
  { combo: "home", label: "Go to start", display: "Home", run: () => transport.toStart() },
  { combo: "end", label: "Go to end", display: "End", run: () => transport.toEnd() },
  { combo: "=", label: "Zoom in", display: "+", run: () => zoomBy(1.4) },
  { combo: "+", label: "Zoom in", display: "+", hidden: true, run: () => zoomBy(1.4) },
  { combo: "-", label: "Zoom out", display: "−", run: () => zoomBy(1 / 1.4) },
  { combo: "delete", label: "Delete selected", display: "Delete", run: () => bus.emit("cmd:delete") },
  { combo: "backspace", label: "Delete selected", display: "Backspace", hidden: true, run: () => bus.emit("cmd:delete") },
  { combo: "shift+delete", label: "Ripple delete (close the gap)", display: "Shift+Delete", run: () => bus.emit("cmd:rippleDelete") },
  { combo: "shift+backspace", label: "Ripple delete", display: "Shift+Backspace", hidden: true, run: () => bus.emit("cmd:rippleDelete") },
  { combo: "s", label: "Split at playhead", display: "S", run: () => bus.emit("cmd:split") },
  { combo: "ctrl+d", label: "Duplicate selected clip", display: "Ctrl+D", run: () => bus.emit("cmd:duplicate") },
  { combo: "q", label: "Trim clip start to playhead", display: "Q", run: () => bus.emit("cmd:trimStart") },
  { combo: "w", label: "Trim clip end to playhead", display: "W", run: () => bus.emit("cmd:trimEnd") },
  { combo: ",", label: "Nudge clip 1 frame earlier", display: ",", run: () => bus.emit("cmd:nudge", -1) },
  { combo: ".", label: "Nudge clip 1 frame later", display: ".", run: () => bus.emit("cmd:nudge", 1) },
  { combo: "v", label: "Selection tool", display: "V", run: () => bus.emit("cmd:tool", "select") },
  { combo: "b", label: "Blade tool", display: "B", run: () => bus.emit("cmd:tool", "blade") },
  { combo: "ctrl+s", label: "Save project", display: "Ctrl+S", run: () => bus.emit("cmd:save") },
  { combo: "f", label: "Fullscreen preview", display: "F", run: () => toggleFullscreen() },
];

const REPEATABLE = new Set(["arrowleft", "arrowright", "shift+arrowleft", "shift+arrowright", ",", ".", "=", "+", "-"]);

function comboFromEvent(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push("ctrl");
  if (e.shiftKey && e.key.length > 1 || (e.shiftKey && /[a-z]/i.test(e.key))) parts.push("shift");
  if (e.altKey) parts.push("alt");
  parts.push(e.key.toLowerCase());
  return parts.join("+");
}

export function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (isModalOpen()) return;
    const el = document.activeElement;
    if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) {
      // let typing / form controls work, except modifier combos like undo inside the project title input
      if (!(e.ctrlKey || e.metaKey)) return;
    }
    const combo = comboFromEvent(e);
    // Holding a key must not repeat one-shot edits (e.g. S would spam "playhead at edge" warnings)
    if (e.repeat && !REPEATABLE.has(combo)) { if (SHORTCUTS.some((s) => s.combo === combo)) e.preventDefault(); return; }
    const hit = SHORTCUTS.find((s) => s.combo === combo);
    if (hit) {
      e.preventDefault();
      hit.run();
    }
  });
}
