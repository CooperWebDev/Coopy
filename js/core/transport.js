// Routes transport commands (play, step, seek…) to the active monitor: timeline or source.
import { bus } from "./events.js";
import { playback } from "./playback.js";
import { source } from "./source.js";

let mode = "timeline";

export const transport = {
  get mode() { return mode; },
  setMode(m) {
    if (m === mode) return;
    if (m === "source" && !source.loaded) return;
    // never leave something playing in the monitor we're leaving
    playback.pause();
    source.pause();
    mode = m;
    bus.emit("transport:mode", m);
  },
  get isSource() { return mode === "source"; },

  get time() { return mode === "source" ? source.time : playback.time; },
  get playing() { return mode === "source" ? source.playing : playback.playing; },

  toggle() { mode === "source" ? source.toggle() : playback.toggle(); },
  step(frames) { mode === "source" ? source.step(frames, playback.fps) : playback.step(frames); },
  toStart() { mode === "source" ? source.seek(0) : playback.seek(0); },
  toEnd() { mode === "source" ? source.seek(source.duration) : playback.seek(playback.endTime); },
  setSpeed(s) { playback.setSpeed(s); source.setSpeed(s); },
};

// If the source goes away while being shown, fall back to the timeline.
bus.on("source:unloaded", () => { if (mode === "source") { mode = "timeline"; bus.emit("transport:mode", mode); } });
