export function toast(message, kind = "info", ms = 2800) {
  const host = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind === "info" ? "" : kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
