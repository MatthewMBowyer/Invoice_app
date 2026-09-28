// Rates: the owner's editable rate types with a label and an hourly price.
// Defaults are Primary School R240.00/hour and High School R280.00/hour, but the
// list is owner-configurable — nothing is hardcoded.

import { el, field, toast } from "../ui.js";
import * as I from "../invoicing.js";
import * as S from "../service.js";
import { state, errorMessage } from "../app.js";

export async function renderRates(main, { refresh }) {
  const store = state.store;
  const box = el("div", { class: "screen" });
  box.appendChild(el("div", { class: "screen-head" }, [
    el("h1", { text: "Rates" }),
    el("button", { class: "btn primary", text: "Add rate type", onClick: () => addRate() }),
  ]));
  box.appendChild(el("p", { class: "help", text: "Rates are yours to edit. A new rate type added here (or while creating an invoice) is saved for next time." }));

  const list = el("div", { class: "rate-list" });
  for (const r of store.rates) {
    const label = el("input", { type: "text", value: r.label, "aria-label": "Rate label" });
    const price = el("input", { type: "text", value: (Number(r.rate_cents) / 100).toFixed(2), "aria-label": "Hourly price" });
    const active = el("input", { type: "checkbox", checked: String(r.active).toLowerCase() !== "false", "aria-label": "Active" });
    list.appendChild(el("div", { class: "rate-card", dataset: { key: r.key } }, [
      el("div", { class: "rate-grid" }, [field("Label", label), field("Hourly price", price), field("Active", active)]),
      el("p", { class: "help", text: `Saved as: ${I.formatMoney(Number(r.rate_cents))}/hour` }),
      el("button", { class: "btn primary small", text: "Save rate", onClick: async () => {
        try {
          await S.saveRate(store, { key: r.key, label: label.value, rateCents: Math.round(Number(price.value || "0") * 100), active: active.checked });
          await store.reload(); toast("Rate saved.", "success"); refresh();
        } catch (err) { toast(errorMessage(err), "error"); }
      } }),
    ]));
  }
  box.appendChild(list);

  async function addRate() {
    const name = window.prompt('New rate type name (for example "Holiday intensive")');
    if (!name || !name.trim()) return;
    const key = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    const price = window.prompt("Hourly price in rands (for example 300)") || "0";
    try {
      await S.saveRate(store, { key, label: name.trim(), rateCents: Math.round(Number(price) * 100) });
      await store.reload(); toast("Rate type added.", "success"); refresh();
    } catch (err) { toast(errorMessage(err), "error"); }
  }

  main.appendChild(box);
}
