// Backup / restore: export the full data set to JSON and restore from JSON.
// A JSON backup can be kept in the same Drive folder as the honest answer to
// "what if the sheet is damaged".

import { el, toast, download, confirmDialog } from "../ui.js";
import { COLUMNS, DEFAULT_SETTINGS, objectsToValues, encodeInvoice, encodeLine } from "../store.js";
import { state, refresh, errorMessage } from "../app.js";

export async function renderBackup(main) {
  const store = state.store;
  const box = el("div", { class: "screen" });
  box.appendChild(el("h1", { text: "Backup and restore" }));

  box.appendChild(el("section", { class: "settings-card" }, [
    el("h2", { text: "Export a full backup" }),
    el("p", { class: "help", text: "Downloads one JSON file with your settings, parents, learners, rates, lessons and invoices. Keep it in your Drive next to the spreadsheet as a safety copy." }),
    el("button", { class: "btn primary", text: "Export JSON backup", onClick: () => {
      const bundle = {
        app: "ctt-invoice-web",
        exported_at: new Date().toISOString(),
        settings: store.settings,
        parents: store.parents,
        learners: store.learners,
        rates: store.rates,
        lessons: store.lessons,
        invoices: store.invoices.map((i) => {
          const row = Object.assign({}, i);
          delete row.line_items;
          return row;
        }),
        invoice_lines: store.lines,
      };
      download(`ctt_invoice_backup_${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(bundle, null, 2), "application/json");
      toast("Backup downloaded.", "success");
    } }),
  ]));

  const fileInput = el("input", { type: "file", accept: "application/json,.json", "aria-label": "Choose a backup file" });
  box.appendChild(el("section", { class: "settings-card" }, [
    el("h2", { text: "Restore from a backup" }),
    el("p", { class: "help", text: "This replaces the data in your sheet with the values in the backup file. Export a fresh backup first if you are unsure." }),
    fileInput,
    el("button", { class: "btn danger", text: "Restore this file", onClick: async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) { toast("Choose a backup file first.", "error"); return; }
      const ok = await confirmDialog({ title: "Replace your data?", message: "Your current sheet data will be replaced by the backup.", confirmText: "Restore", danger: true });
      if (!ok) return;
      try {
        const text = await file.text();
        const bundle = JSON.parse(text);
        await applyBundle(store, bundle);
        await store.reload();
        toast("Backup restored.", "success");
        refresh();
      } catch (err) { toast(errorMessage(err), "error"); }
    } }),
  ]));

  main.appendChild(box);
}

/** Write a backup bundle back into the user's own sheet. */
export async function applyBundle(store, bundle) {
  if (!bundle || typeof bundle !== "object") throw new Error("That file is not a CTT backup.");
  const settings = Object.assign({}, DEFAULT_SETTINGS, bundle.settings || {});
  const parents = bundle.parents || [];
  const learners = bundle.learners || [];
  const rates = bundle.rates || [];
  const lessons = bundle.lessons || [];
  const invoices = (bundle.invoices || []).map(encodeInvoice);
  const lines = (bundle.invoice_lines || []).map(encodeLine);
  await store.backend.batchWrite(store.sheetId, [
    { range: "SETTINGS!A1", values: settingsRows(settings) },
    { range: "CLIENTS!A1", values: objectsToValues(COLUMNS.CLIENTS, parents) },
    { range: "LEARNERS!A1", values: objectsToValues(COLUMNS.LEARNERS, learners) },
    { range: "RATES!A1", values: objectsToValues(COLUMNS.RATES, rates) },
    { range: "LESSONS!A1", values: objectsToValues(COLUMNS.LESSONS, lessons) },
    { range: "INVOICES!A1", values: objectsToValues(COLUMNS.INVOICES, invoices) },
    { range: "INVOICE_LINES!A1", values: objectsToValues(COLUMNS.INVOICE_LINES, lines) },
  ]);
}

function settingsRows(settings) {
  const rows = [COLUMNS.SETTINGS.slice()];
  for (const key of Object.keys(DEFAULT_SETTINGS)) rows.push([key, settings[key] ?? ""]);
  for (const key of Object.keys(settings)) if (!(key in DEFAULT_SETTINGS)) rows.push([key, settings[key] ?? ""]);
  return rows;
}
