// Small DOM helpers shared by every screen. No framework, no build step.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k === "value") node.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") node[k] = v;
    else if (/^on[A-Z]/.test(k) && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" || typeof child === "number"
      ? document.createTextNode(String(child)) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function field(labelText, input, help) {
  const id = input.id || `f${Math.random().toString(36).slice(2, 8)}`;
  input.id = id;
  return el("div", { class: "field" }, [
    el("label", { for: id, text: labelText }),
    input,
    help ? el("p", { class: "help", text: help }) : null,
  ]);
}

let toastTimer = null;
export function toast(message, kind = "info") {
  let box = document.getElementById("toast");
  if (!box) {
    box = el("div", { id: "toast", class: "toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(box);
  }
  clear(box);
  box.className = `toast toast-${kind} visible`;
  box.appendChild(el("span", { text: message }));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = "toast"; }, 6000);
}

let dialogResolve = null;
export function confirmDialog({ title, message, confirmText = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", { class: "app-dialog" });
    const close = (val) => { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); resolve(val); };
    dlg.appendChild(el("h2", { text: title }));
    dlg.appendChild(el("p", { text: message }));
    dlg.appendChild(el("div", { class: "dialog-actions" }, [
      el("button", { class: "btn secondary", text: "Cancel", onClick: () => close(false) }),
      el("button", { class: `btn ${danger ? "danger" : "primary"}`, text: confirmText, onClick: () => close(true) }),
    ]));
    document.body.appendChild(dlg);
    dlg.showModal();
    dialogResolve = resolve;
  });
}

export function promptDialog({ title, message, label, value = "", confirmText = "Save" }) {
  return new Promise((resolve) => {
    const dlg = el("dialog", { class: "app-dialog" });
    const input = el("input", { type: "text", value });
    const close = (val) => { dlg.close(); if (dlg.parentNode) dlg.parentNode.removeChild(dlg); resolve(val); };
    dlg.appendChild(el("h2", { text: title }));
    if (message) dlg.appendChild(el("p", { text: message }));
    dlg.appendChild(el("label", { for: "prompt-input", text: label }));
    input.id = "prompt-input";
    dlg.appendChild(input);
    dlg.appendChild(el("div", { class: "dialog-actions" }, [
      el("button", { class: "btn secondary", text: "Cancel", onClick: () => close(null) }),
      el("button", { class: "btn primary", text: confirmText, onClick: () => close(input.value) }),
    ]));
    document.body.appendChild(dlg);
    dlg.showModal();
    void dialogResolve;
  });
}

export function emptyState(title, message, action) {
  return el("div", { class: "empty" }, [
    el("h3", { text: title }),
    message ? el("p", { text: message }) : null,
    action || null,
  ]);
}

export function money(cents, symbol = "R") {
  const sign = cents < 0 ? "-" : "";
  const c = Math.abs(Math.trunc(Number(cents) || 0));
  const whole = Math.floor(c / 100);
  const frac = String(c % 100).padStart(2, "0");
  return `${sign}${symbol}${whole.toLocaleString("en-ZA")}.${frac}`;
}

export function download(filename, bytes, mime = "application/octet-stream") {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => esc(row[c])).join(","));
  return lines.join("\r\n");
}
