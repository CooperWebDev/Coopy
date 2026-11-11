// Master clock. The playhead position (seconds) lives here; the timeline, preview and
// (later) audio engine all follow it, which keeps everything synchronized.
import { bus } from "./events.js";
import { store } from "./store.js";
import { snapToFrame } from "./timecode.js";

const MIN_TIMELINE = 60; // seconds shown even for an empty project

class Playback {
  constructor() {
    this.time = 0;
    this.playing = false;
    this.speed = 1;
    this._raf = 0;
    this._last = 0;
  }

  get fps() { return store.project.settings.fps; }
  get duration() { return Math.max(MIN_TIMELINE, store.contentDuration + 10); }
  /** Where playback stops: end of content, or the minimum timeline if empty. */
  get endTime() { return store.contentDuration || MIN_TIMELINE; }

  seek(t, { snap = true } = {}) {
    let v = Math.min(Math.max(0, t), this.duration);
    if (snap) v = snapToFrame(v, this.fps);
    this.time = v;
    bus.emit("playback:time", v);
  }

  step(frames) { this.seek(this.time + frames / this.fps); }

  play() {
    if (this.playing) return;
    if (this.time >= this.endTime) this.seek(0);
    this.playing = true;
    this._last = performance.now();
    bus.emit("playback:state", true);
    const tick = (now) => {
      if (!this.playing) return;
      const dt = (now - this._last) / 1000;
      this._last = now;
      const next = this.time + dt * this.speed;
      if (next >= this.endTime) {
        this.seek(this.endTime, { snap: false });
        this.pause();
        return;
      }
      this.seek(next, { snap: false });
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this._raf);
    this.seek(this.time); // land on a frame boundary
    bus.emit("playback:state", false);
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  setSpeed(s) { this.speed = s; bus.emit("playback:speed", s); }
}

export const playback = new Playback();
