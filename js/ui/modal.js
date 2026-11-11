const host = document.getElementById("modalHost");
const titleEl = document.getElementById("modalTitle");
const bodyEl = document.getElementById("modalBody");
const footEl = document.getElementById("modalFoot");

export function closeModal() {
  host.hidden = true;
  bodyEl.replaceChildren();
  footEl.replaceChildren();
}

/**
 * Show a modal.
 * @param {string} title
 * @param {Node|string} body
 * @param {{label:string, primary?:boolean, disabled?:boolean, onClick?:()=>(boolean|void)}[]} buttons
 *        onClick returning false keeps the modal open.
 */
export function openModal(title, body, buttons = [{ label: "Close" }]) {
  titleEl.textContent = title;
  if (typeof body === "string") bodyEl.innerHTML = body;
  else bodyEl.replaceChildren(body);
  footEl.replaceChildren();
  for (const b of buttons) {
    const btn = document.createElement("button");
    btn.className = `btn${b.primary ? " btn-primary" : ""}`;
    btn.textContent = b.label;
    btn.disabled = !!b.disabled;
    btn.addEventListener("click", () => {
      if (b.onClick?.() !== false) closeModal();
    });
    footEl.appendChild(btn);
  }
  host.hidden = false;
  bodyEl.querySelector("input,select,button")?.focus();
}

document.getElementById("modalClose").addEventListener("click", closeModal);
host.addEventListener("mousedown", (e) => { if (e.target === host) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !host.hidden) closeModal(); });

export const isModalOpen = () => !host.hidden;
