// Dashboard: the six summary figures, computed from the underlying records, with
// a large "Create Invoice" control as the FIRST element.

import { el } from "../ui.js";
import * as I from "../invoicing.js";
import { state, navigate } from "../app.js";

export async function renderDashboard(main) {
  const store = state.store;
  const d = I.dashboard(store.invoices);
  const symbol = store.settings.currency_symbol || "R";
  const show = (cents) => I.formatMoney(cents, "ZAR", symbol);

  main.appendChild(el("div", { class: "screen" }, [
    el("button", {
      class: "create-invoice-cta", id: "create-invoice",
      onClick: () => navigate("create"),
    }, [
      el("span", { class: "cta-plus", "aria-hidden": "true", text: "+" }),
      el("span", { text: "Create Invoice" }),
    ]),

    el("div", { class: "stat-grid" }, [
      stat("Invoices this month", String(d.invoices_this_month), "invoices-this-month"),
      stat("Invoiced this month", show(d.invoiced_this_month_cents), "invoiced-this-month"),
      stat("Total paid", show(d.paid_total_cents), "total-paid"),
      stat("Outstanding invoices", String(d.outstanding_invoices), "outstanding-invoices"),
      stat("Total outstanding", show(d.outstanding_total_cents), "total-outstanding"),
      stat("This month", d.month_label, "month-label"),
    ]),

    el("div", { class: "quick-links" }, [
      link("Parents", "parents"),
      link("Invoices", "invoices"),
      link("Rates", "rates"),
      link("Settings", "settings"),
    ]),
  ]));
}

function stat(label, value, id) {
  return el("div", { class: "stat", id }, [
    el("span", { class: "stat-value", text: value }),
    el("span", { class: "stat-label", text: label }),
  ]);
}

function link(label, route) {
  return el("button", { class: "quick-link", text: label, onClick: () => navigate(route) });
}
