// Settings: business details, banking, invoicing defaults, appearance, WhatsApp
// template and the next invoice number. Each group saves on its own so one save
// does not disturb another.

import { el, field, toast, download } from "../ui.js";
import * as I from "../invoicing.js";
import { state, refresh } from "../app.js";

export async function renderSettings(main, ctx) {
  const store = state.store;
  const s = store.settings;
  const box = el("div", { class: "screen" });
  box.appendChild(el("h1", { text: "Settings" }));

  function group(title, fields, help) {
    const card = el("section", { class: "settings-card" }, [el("h2", { text: title })]);
    if (help) card.appendChild(el("p", { class: "help", text: help }));
    const inputs = {};
    for (const [key, label, type, hint] of fields) {
      const input = type === "textarea" ? el("textarea", {}, [s[key] ?? ""])
        : el("input", { type: type || "text", value: s[key] ?? "" });
      inputs[key] = input;
      card.appendChild(field(label, input, hint));
    }
    card.appendChild(el("button", { class: "btn primary", text: "Save", onClick: async () => {
      const patch = {};
      for (const key of Object.keys(inputs)) patch[key] = inputs[key].value;
      try { await store.saveSettings(patch); toast(`${title} saved.`, "success"); (ctx && ctx.refresh ? ctx.refresh() : refresh()); }
      catch (err) { toast(err.message || "Could not save.", "error"); }
    } }));
    return card;
  }

  box.appendChild(group("Business", [
    ["business_name", "Business name"],
    ["business_address", "Address", "textarea"],
    ["business_phone", "Phone"],
    ["business_email", "Email", "email"],
    ["logo_path", "Logo (relative path or URL)", "text", "The CTT logo is bundled; leave blank to use it."],
  ]));

  box.appendChild(group("Banking", [
    ["account_holder", "Account holder"],
    ["account_type", "Account type"],
    ["bank_name", "Bank"],
    ["branch_code", "Branch code"],
    ["account_number", "Account number"],
    ["swift_bic", "SWIFT / BIC"],
  ], "Every label is printed on the invoice; a field left blank prints a blank ruled line."));

  box.appendChild(group("Invoicing", [
    ["payment_reference_template", "Payment reference template", "text", "Use {parent_name} and {learner_name}. A blank variable is removed with its separator."],
    ["payment_terms", "Payment terms", "textarea", "Leave blank for no terms row on the invoice and no hint on the due-date field."],
    ["due_date_period_days", "Due-date period (days)"],
    ["currency_symbol", "Currency symbol"],
    ["invoice_prefix", "Invoice number prefix"],
    ["next_invoice_number", "Next invoice number"],
  ]));

  box.appendChild(group("Appearance", [
    ["invoice_title", "Invoice title"],
    ["invoice_footer", "Invoice footer", "textarea"],
    ["terms_extra", "Extra terms", "textarea"],
    ["accent_colour", "Accent colour", "text", "A hex colour such as #0097b2."],
  ]));

  box.appendChild(group("WhatsApp", [
    ["whatsapp_template", "Message template", "textarea", "Variables: {parent_name} {learner_name} {invoice_number} {amount} {due_date} {business_name}"],
  ]));

  const exportCard = el("section", { class: "settings-card" }, [
    el("h2", { text: "Export" }),
    el("p", { class: "help", text: "Export the invoice history as a CSV file." }),
    el("button", { class: "btn secondary", text: "Export invoices (CSV)", onClick: () => {
      const columns = ["number_text", "invoice_date", "due_date", "status", "snap_parent_name", "snap_learner_name", "total_cents"];
      import("../ui.js").then(({ toCsv }) => {
        download("invoices.csv", toCsv(store.invoices, columns), "text/csv");
      });
    } }),
  ]);
  box.appendChild(exportCard);

  main.appendChild(box);
  void I;
}
