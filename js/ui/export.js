// Export (Stage 9): renders the timeline in real time into the project's resolution and records it with
// MediaRecorder (canvas video + mixed timeline audio). Output is WebM (or MP4 where the browser can record it).
import { store } from "../core/store.js";
import { playback } from "../core/playback.js";
import { engine } from "../core/engine.js";
import { renderTimeline } from "../core/render.js";
import { transport } from "../core/transport.js";
import { openModal } from "./modal.js";
import { toast } from "./toast.js";

const TYPES = [["video/mp4;codecs=avc1,mp4a.40.2", "mp4", "MP4 (H.264)"], ["video/webm;codecs=vp9,opus", "webm", "WebM (VP9)"], ["video/webm;codecs=vp8,opus", "webm", "WebM (VP8)"], ["video/webm", "webm", "WebM"]];
const supported = () => (window.MediaRecorder ? TYPES.filter(([t]) => MediaRecorder.isTypeSupported(t)) : []);

let busy = false;

async function runExport({ type, ext, height, mbps }, ui) {
  const p = store.project;
  const dur = store.contentDuration;
  const aspect = p.settings.width / p.settings.height;
  const h = height, w = Math.round(h * aspect / 2) * 2;
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d");
  const fps = Math.min(30, p.settings.fps);
  const stream = canvas.captureStream(fps);
  const audio = engine.audioStream();
  audio?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: mbps * 1e6 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((res) => (rec.onstop = res));

  transport.setMode("timeline");
  playback.pause();
  playback.setSpeed(1);
  playback.seek(0);
  rec.start(500);
  let cancelled = false;
  ui.cancel = () => { cancelled = true; };
  playback.play();
  await new Promise((resolve) => {
    const tick = () => {
      renderTimeline(ctx, w, h, playback.time);
      ui.progress(Math.min(1, playback.time / dur));
      if (cancelled || !playback.playing) return resolve();
      requestAnimationFrame(tick);
    };
    tick();
  });
  renderTimeline(ctx, w, h, Math.max(0, dur - 1e-3));
  await new Promise((r) => setTimeout(r, 300));
  playback.pause();
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  return cancelled ? null : new Blob(chunks, { type: type.split(";")[0] });
}

export function openExport() {
  const fmts = supported();
  const body = document.createElement("div");
  const mk = (label, sel) => { const r = document.createElement("div"); r.className = "form-row"; const l = document.createElement("label"); l.textContent = label; r.append(l, sel); return r; };
  const sel = (opts, v) => { const s = document.createElement("select"); for (const [val, t] of opts) s.add(new Option(t, val)); s.value = v; return s; };
  if (!fmts.length) {
    body.innerHTML = "<p>This browser can't record video (MediaRecorder is missing). Use a current Chrome, Edge or Firefox.</p>";
    return openModal("Export", body, [{ label: "Close" }]);
  }
  const format = sel(fmts.map(([t, , n], i) => [String(i), n]), "0");
  const res = sel([["720", "1280 × 720"], ["1080", "1920 × 1080"]], String(Math.min(1080, store.project.settings.height) >= 1080 ? 1080 : 720));
  const rate = sel([["8", "8 Mbps"], ["16", "16 Mbps"]], "8");
  const prog = Object.assign(document.createElement("progress"), { max: 1, value: 0, hidden: true });
  prog.style.width = "100%";
  const note = Object.assign(document.createElement("div"), { className: "form-note" });
  note.textContent = "Export renders in real time: a 1-minute edit takes about 1 minute. Keep this tab visible while it runs.";
  body.append(mk("Format", format), mk("Resolution", res), mk("Quality", rate), prog, note);
  const ui = { progress: (v) => (prog.value = v), cancel: null };
  openModal("Export", body, [
    { label: "Close", onClick: () => { ui.cancel?.(); } },
    { label: "Start Export", primary: true, onClick: () => {
      if (busy) return false;
      if (!store.contentDuration) { toast("Nothing to export: the timeline is empty"); return false; }
      const [type, ext] = fmts[Number(format.value)];
      busy = true; prog.hidden = false; note.textContent = "Rendering… do not switch tabs.";
      runExport({ type, ext, height: Number(res.value), mbps: Number(rate.value) }, ui).then((blob) => {
        if (!blob) return toast("Export cancelled");
        const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `${store.project.name.replace(/[^\w\- ]+/g, "_")}.${ext}` });
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast("Export finished", "ok");
      }).catch((e) => toast(`Export failed: ${e.message}`, "error", 6000)).finally(() => { busy = false; });
      return false; // keep the dialog open to show progress
    } },
  ]);
}
