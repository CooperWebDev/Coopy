// Source monitor controller: plays a single media item independently of the timeline.
import { bus } from "./events.js";
import { mediaFiles } from "./media.js";

class Source {
  constructor() {
    this.media = null;
    this.el = null;     // <video> or <audio>
    this.img = null;    // HTMLImageElement for stills
    this.speed = 1;
  }

  get loaded() { return !!this.media; }
  get time() { return this.el ? this.el.currentTime : 0; }
  get duration() { return this.media?.duration ?? 0; }
  get playing() { return !!this.el && !this.el.paused && !this.el.ended; }
  get frameSource() { return this.media?.kind === "video" ? this.el : this.img; }

  async load(media) {
    this.unload();
    const rec = mediaFiles.get(media.id);
    if (!rec) throw new Error("File data isn't available in this session — import it again.");
    if (media.kind === "image") {
      const img = new Image();
      img.src = rec.url;
      try { await img.decode(); } catch { throw new Error("Can't decode this image"); }
      this.img = img;
    } else {
      const el = document.createElement(media.kind === "video" ? "video" : "audio");
      el.preload = "auto";
      el.playsInline = true;
      el.src = rec.url;
      el.playbackRate = this.speed;
      el.addEventListener("seeked", () => bus.emit("source:time", el.currentTime));
      el.addEventListener("loadeddata", () => bus.emit("source:time", el.currentTime));
      el.addEventListener("play", () => bus.emit("source:state", true));
      el.addEventListener("pause", () => bus.emit("source:state", false));
      el.addEventListener("ended", () => bus.emit("source:state", false));
      await new Promise((res, rej) => {
        el.addEventListener("loadeddata", res, { once: true });
        el.addEventListener("error", () => rej(new Error("The browser can't play this file")), { once: true });
      });
      this.el = el;
    }
    this.media = media;
    bus.emit("source:loaded", media);
  }

  unload() {
    if (this.el) { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); }
    this.el = null; this.img = null; this.media = null;
    bus.emit("source:unloaded");
  }

  play() {
    if (!this.el) return;
    if (this.el.ended || this.el.currentTime >= this.duration - 0.05) this.el.currentTime = 0;
    this.el.play().catch((e) => bus.emit("source:error", e));
  }
  pause() { this.el?.pause(); }
  toggle() { this.playing ? this.pause() : this.play(); }

  seek(t) {
    if (!this.el) return;
    this.el.currentTime = Math.min(Math.max(0, t), this.duration || 0);
  }
  step(frames, fps) {
    this.pause();
    this.seek(this.time + frames / fps);
  }
  setSpeed(s) {
    this.speed = s;
    if (this.el) this.el.playbackRate = s;
  }
}

export const source = new Source();
