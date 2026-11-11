// Project state + undo/redo. State is plain JSON so it can be saved to IndexedDB (Stage 2+).
import { bus } from "./events.js";

let uid = 0;
export const newId = (prefix) => `${prefix}${Date.now().toString(36)}${(uid++).toString(36)}`;

export function createProject(name = "Untitled Project") {
  return {
    name,
    settings: { width: 1920, height: 1080, fps: 24 },
    tracks: [
      { id: newId("t"), type: "video", name: "V2", locked: false, muted: false, hidden: false },
      { id: newId("t"), type: "video", name: "V1", locked: false, muted: false, hidden: false },
      { id: newId("t"), type: "audio", name: "A1", locked: false, muted: false, hidden: false },
      { id: newId("t"), type: "audio", name: "A2", locked: false, muted: false, hidden: false },
    ],
    clips: [],
    // Media records are metadata only (JSON-safe). The File/URL lives in core/media.js at runtime.
    bins: [{ id: "master", name: "Master", parentId: null }],
    media: [],
  };
}

const HISTORY_LIMIT = 200;
const clone = (o) => JSON.parse(JSON.stringify(o));

class Store {
  constructor() {
    this.project = createProject();
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
  }

  /** Replace the whole project (new / open). Clears history. */
  load(project) {
    this.project = project;
    this.undoStack = [];
    this.redoStack = [];
    this.dirty = false;
    bus.emit("project:loaded", this.project);
    bus.emit("history:changed");
  }

  /** Apply a mutation as one undoable step. */
  commit(label, mutator) {
    this.undoStack.push({ label, snapshot: clone(this.project) });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    mutator(this.project);
    this.dirty = true;
    bus.emit("project:changed", { label });
    bus.emit("history:changed");
  }

  undo() {
    const step = this.undoStack.pop();
    if (!step) return false;
    this.redoStack.push({ label: step.label, snapshot: clone(this.project) });
    this.project = step.snapshot;
    this.dirty = true;
    bus.emit("project:changed", { label: `Undo ${step.label}` });
    bus.emit("history:changed");
    return step.label;
  }

  redo() {
    const step = this.redoStack.pop();
    if (!step) return false;
    this.undoStack.push({ label: step.label, snapshot: clone(this.project) });
    this.project = step.snapshot;
    this.dirty = true;
    bus.emit("project:changed", { label: `Redo ${step.label}` });
    bus.emit("history:changed");
    return step.label;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** End of the last clip in seconds. */
  get contentDuration() {
    return this.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  }
}

export const store = new Store();
