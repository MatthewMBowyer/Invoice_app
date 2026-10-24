// Small DOM helpers shared by every screen. No framework, no build step.

/**
 * A single in-flight counter behind the global progress bar.
 *
 * Every slow path in this app is a Google round trip, so counting them in one
 * place means a wait can never be silent: if the app is talking to Google, the
 * bar is moving. Individual screens still set their own busy labels for work
 * that happens after the last response (PDF rendering), which is not network.
 */
let pendingWork = 0;
let progressTimer = null;

function progressNode() {
  if (typeof document === "undefined" || !document.body) return null;
  let node = document.getElementById("global-progress");
  if (!node) {
    node = el("div", { id: "global-progress", class: "global-progress", role: "progressbar",
      "aria-label": "Working", "aria-hidden": "true" });
    document.body.appendChild(node);
  }
  return node;
}

export function beginWork() {
  pendingWork += 1;
  const node = progressNode();
  if (!node) return;
  node.setAttribute("aria-hidden", "false");
  node.classList.add("is-active");
  // A request that finishes inside a few milliseconds should not flash the bar;
  // only a wait the owner can actually perceive is worth announcing.
  if (!progressTimer) {
    progressTimer = setTimeout(() => { node.classList.add("is-visible"); }, 120);
  }
}

export function endWork() {
  pendingWork = Math.max(0, pendingWork - 1);
  if (pendingWork > 0) return;
  if (progressTimer) { clearTimeout(progressTimer); progressTimer = null; }
  // Look up rather than create: if the bar was never shown there is nothing to
  // clear, and a hidden node should not be left behind.
  const node = typeof document === "undefined" ? null : document.getElementById("global-progress");
  if (!node) return;
  node.classList.remove("is-active", "is-visible");
  node.setAttribute("aria-hidden", "true");
}

/** True while anything is in flight — used by tests. */
export function isWorking() {
  return pendingWork > 0;
}

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

/**
 * Bring a node into view immediately and deterministically.
 *
 * Deliberately NOT scrollIntoView({behavior:"smooth"}): app.css sets
 * `html { scroll-behavior: smooth }`, which makes every programmatic scroll
 * animated. iOS Safari drops or refuses those animations in common cases, which
 * left the invoice detail panel rendered below the list and off-screen, so
 * tapping a row looked like it did nothing. The animation is switched off around
 * the call so the jump is synchronous and honoured everywhere.
 */
export function revealElement(node, offset = 0) {
  const top = node.getBoundingClientRect().top + window.scrollY - offset;
  const y = Math.max(0, Math.round(top));
  const html = document.documentElement;
  // scroll-behavior:smooth in the stylesheet wins over an "instant" scroll
  // request in browsers that do not recognise that keyword, so it is turned off
  // around the call. This is what makes the jump synchronous and reliable.
  const previous = html.style.scrollBehavior;
  html.style.scrollBehavior = "auto";
  try {
    window.scrollTo(0, y);
  } finally {
    html.style.scrollBehavior = previous;
  }
}

/** Height of the sticky header, so a revealed node is not hidden underneath it. */
export function headerOffset() {
  const header = document.querySelector(".app-header");
  return header ? header.getBoundingClientRect().height : 0;
}

/**
 * Show generated bytes in a full-screen viewer.
 *
 * A Blob download is unreliable on phones — iOS Safari often ignores the
 * `download` attribute entirely, so a tap on "Download PDF" could appear to do
 * nothing at all. Rendering the bytes in an <iframe> over the app always shows
 * the document, on every browser, without relying on a download or a popup.
 * Returns a function that closes the viewer.
 */
export function viewDocument(bytes, filename, mime = "application/pdf") {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const overlay = el("div", { class: "viewer-overlay", role: "dialog", "aria-label": filename });
  const frame = el("iframe", { class: "viewer-frame", src: url, title: filename });

  // Until the frame paints, an empty white rectangle is indistinguishable from a
  // PDF that failed to load. This says which it is.
  const pending = el("div", { class: "viewer-pending" }, [
    el("div", { class: "spinner" }),
    el("p", { class: "waiting-label", text: "Opening the document\u2026" }),
  ]);
  const stage = el("div", { class: "viewer-stage" }, [frame, pending]);
  frame.addEventListener("load", () => { pending.remove(); });
  // A browser that cannot render PDF inline still fires "load" and shows blank
  // space, so the bar always carries a way to get the file out.
  const bar = el("div", { class: "viewer-bar" }, [
    el("span", { class: "viewer-name", text: filename }),
    el("button", { class: "btn secondary small", text: "Download", onClick: () => download(filename, bytes, mime) }),
    el("button", { class: "btn secondary small", text: "Close", onClick: () => close() }),
  ]);
  overlay.appendChild(bar);
  overlay.appendChild(stage);
  document.body.appendChild(overlay);
  document.body.classList.add("viewer-open");
  function close() {
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    document.body.classList.remove("viewer-open");
    URL.revokeObjectURL(url);
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  return close;
}

/**
 * Run a slow action with the button visibly working.
 *
 * Generating a PDF takes long enough on a phone that an unchanged button reads
 * as a dead tap, which is exactly how a working action gets reported as broken.
 * The label change is the signal that the tap registered.
 */
export async function withBusy(button, label, action) {
  if (!button || button.dataset.busy === "1") return undefined;
  const original = button.textContent;
  button.dataset.busy = "1";
  button.disabled = true;
  button.classList.add("is-busy");
  button.textContent = label;
  try {
    return await action();
  } finally {
    delete button.dataset.busy;
    button.disabled = false;
    button.classList.remove("is-busy");
    button.textContent = original;
  }
}

export function canShareFile(bytes, filename, mime) {
  try {
    if (typeof File === "undefined" || typeof navigator === "undefined" || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File([bytes], filename, { type: mime })] });
  } catch (err) {
    return false;
  }
}

/**
 * Hand a generated file to the OS share sheet, which is the only way a web app
 * can attach a file to WhatsApp: a wa.me link carries text only. Rejects with an
 * AbortError-named error when the user dismisses the sheet.
 */
export async function shareFile(bytes, filename, mime, { title, text } = {}) {
  const file = new File([bytes], filename, { type: mime });
  await navigator.share({ files: [file], title, text });
}

/**
 * Say what actually went wrong when the share sheet will not open.
 *
 * "Could not open the share sheet" on its own sends the owner looking for a bug
 * in the app when the usual cause is the browser withholding the gesture or not
 * supporting file sharing at all. Each case names the working alternative.
 */
export function shareFailureMessage(err) {
  const name = String((err && err.name) || "");
  if (name === "NotAllowedError") {
    return "The browser blocked the share sheet. Open WhatsApp yourself and attach the PDF from Download PDF.";
  }
  if (name === "NotSupportedError" || name === "TypeError") {
    return "This browser cannot share a file directly. Use Download PDF, then attach it in WhatsApp.";
  }
  if (name === "DataError") {
    return "The PDF was empty, so there was nothing to share. Use Download PDF and check the file opens.";
  }
  const detail = err && err.message ? String(err.message) : "unknown error";
  return `The share sheet failed (${detail}). Use Download PDF, then attach it in WhatsApp.`;
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
