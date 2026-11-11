// Editing commands (split, duplicate, delete, trim-to-playhead, nudge): binds bus commands and the
// timeline toolbar buttons to js/core/edit.js and reports results to the user.
import { bus } from "../core/events.js";
import { selection } from "../core/selection.js";
import { playback } from "../core/playback.js";
import { transport } from "../core/transport.js";
import * as edit from "../core/edit.js";
import { toast } from "./toast.js";
import { setTool } from "./timeline.js";

const selectedClipId = () => (selection.kind === "clip" ? selection.id : null);

/** Report a failed edit; successful edits stay quiet except for informational notes. */
function report(r) {
  if (!r.ok) toast(r.msg);
  else if (r.msg && !/^(Split|Duplicated)/.test(r.msg)) toast(r.msg);
  return r;
}

/** Playhead-based commands only make sense while the timeline is the active monitor. */
function needTimeline() {
  if (!transport.isSource) return true;
  toast("Switch the monitor to Timeline first – this edit uses the timeline playhead");
  return false;
}

function requireSelected() {
  const id = selectedClipId();
  if (!id) toast("Select a clip first");
  return id;
}

export const commands = {
  split() { if (needTimeline()) report(edit.splitAtPlayhead(selectedClipId())); },
  duplicate() {
    const id = requireSelected();
    if (!id) return;
    const r = report(edit.duplicateClip(id));
    if (r.ok && r.clipId) selection.set("clip", r.clipId);
  },
  delete({ ripple = false } = {}) {
    if (selection.kind !== "clip") return;          // media deletion is handled by the Media Pool
    const r = edit.deleteClip(selection.id, { ripple });
    if (r.ok) selection.clear(); else toast(r.msg);
  },
  trim(edge) {
    if (!needTimeline()) return;
    const id = requireSelected();
    if (id) report(edit.trimEdge(id, edge, playback.time));
  },
  nudge(frames) {
    const id = requireSelected();
    if (id) report(edit.nudgeClip(id, frames));
  },
};

function refreshButtons() {
  const has = selection.kind === "clip";
  document.getElementById("btnDuplicate").disabled = !has;
  document.getElementById("btnDeleteClip").disabled = !has;
}

export function initEditing() {
  bus.on("cmd:split", commands.split);
  bus.on("cmd:duplicate", commands.duplicate);
  bus.on("cmd:delete", () => commands.delete());
  bus.on("cmd:rippleDelete", () => commands.delete({ ripple: true }));
  bus.on("cmd:trimStart", () => commands.trim("left"));
  bus.on("cmd:trimEnd", () => commands.trim("right"));
  bus.on("cmd:nudge", (frames) => commands.nudge(frames));
  bus.on("cmd:tool", setTool);

  document.getElementById("btnSplit").addEventListener("click", commands.split);
  document.getElementById("btnDuplicate").addEventListener("click", commands.duplicate);
  document.getElementById("btnDeleteClip").addEventListener("click", () => commands.delete());

  bus.on("selection:changed", refreshButtons);
  bus.on("project:changed", refreshButtons);
  bus.on("project:loaded", refreshButtons);
  refreshButtons();
}
