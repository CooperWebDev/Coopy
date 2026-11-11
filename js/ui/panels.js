// Resizable panels, panel tabs and workspace switching. Layout persists in localStorage.
import { bus } from "../core/events.js";

const LS_KEY = "coopy.layout.v1";
const ws = document.getElementById("workspace");
const LIMITS = {
  left: { prop: "--left-w", min: 180, max: 520, def: 280 },
  right: { prop: "--right-w", min: 220, max: 560, def: 300 },
  timeline: { prop: "--timeline-h", min: 140, max: 700, def: 300 },
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function readSaved() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
}
function save(layout) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(layout)); } catch { /* storage unavailable */ }
}

export const layout = { ...readSaved() };

function apply(name, value) {
  const l = LIMITS[name];
  const v = clamp(value, l.min, l.max);
  ws.style.setProperty(l.prop, `${v}px`);
  layout[name] = v;
}

export function resetLayout() {
  for (const [name, l] of Object.entries(LIMITS)) {
    ws.style.removeProperty(l.prop);
    delete layout[name];
  }
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  bus.emit("layout:changed");
}

function initSplitters() {
  for (const [name, l] of Object.entries(LIMITS)) {
    if (layout[name]) apply(name, layout[name]);
  }
  document.querySelectorAll(".splitter").forEach((el) => {
    const name = el.dataset.split;
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      const startX = e.clientX, startY = e.clientY;
      const start = parseFloat(getComputedStyle(ws).getPropertyValue(LIMITS[name].prop)) || LIMITS[name].def;
      const move = (ev) => {
        if (name === "left") apply(name, start + (ev.clientX - startX));
        else if (name === "right") apply(name, start - (ev.clientX - startX));
        else apply(name, start - (ev.clientY - startY));
        bus.emit("layout:changed");
      };
      const up = () => {
        el.classList.remove("dragging");
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        save(layout);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
    el.addEventListener("dblclick", () => { apply(name, LIMITS[name].def); save(layout); bus.emit("layout:changed"); });
  });
}

function initPanelTabs() {
  document.querySelectorAll(".panel-tabs").forEach((group) => {
    const panel = group.closest(".panel");
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-tab]");
      if (btn) showTab(panel, btn.dataset.tab);
    });
  });
}

export function showTab(panel, tab) {
  panel.querySelectorAll(".panel-tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  panel.querySelectorAll(".tab-page").forEach((p) => p.classList.toggle("active", p.dataset.page === tab));
}

const WORKSPACES = ["media", "edit", "color", "audio", "deliver"];
export const workspaceNames = { media: "Media", edit: "Edit", color: "Color", audio: "Audio", deliver: "Deliver" };

export function setWorkspace(name) {
  if (!WORKSPACES.includes(name)) return;
  document.body.dataset.workspace = name;
  document.querySelectorAll("#workspaceTabs [data-ws]").forEach((b) => {
    b.classList.toggle("active", b.dataset.ws === name);
  });
  if (name === "color") showTab(document.getElementById("panelRight"), "color");
  if (name === "edit") showTab(document.getElementById("panelRight"), "inspector");
  try { localStorage.setItem("coopy.workspace", name); } catch { /* ignore */ }
  bus.emit("workspace:changed", name);
  bus.emit("layout:changed");
}

export function initPanels() {
  initSplitters();
  initPanelTabs();
  document.getElementById("workspaceTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-ws]");
    if (b) setWorkspace(b.dataset.ws);
  });
  document.getElementById("btnResetLayout").addEventListener("click", resetLayout);
  let saved = "edit";
  try { saved = localStorage.getItem("coopy.workspace") || "edit"; } catch { /* ignore */ }
  setWorkspace(saved);
}
