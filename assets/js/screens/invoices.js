// Invoice history: the five filters (parent, learner, invoice number, month,
// status) and an invoice detail with status actions, duplicate, soft cancel,
// PDF download and the WhatsApp deep link.

import { el, field, toast, confirmDialog, download, emptyState } from "../ui.js";
import * as I from "../invoicing.js";
import * as W from "../whatsapp.js";
import * as S from "../service.js";
import { buildInvoicePdf } from "../pdf.js";
import { state, navigate, errorMessage } from "../app.js";

export async function renderInvoices(main, { refresh }) {
  const store = state.store;
  const filters = { parent: "", learner: "", number: "", month: "", status: "" };

  const box = el("div", { class: "screen" });
  box.appendChild(el("div", { class: "screen-head" }, [
    el("h1", { text: "Invoices" }),
    el("button", { class: "btn primary", text: "Create Invoice", onClick: () => navigate("create") }),
  ]));

  const statusOptions = ["", "Draft", "Sent", "Paid", "Overdue", "Cancelled"];
  const parentSel = el("select", { "aria-label": "Filter by parent" });
  parentSel.appendChild(el("option", { value: "", text: "All parents" }));
  for (const p of store.parents) parentSel.appendChild(el("option", { value: p.parent_id, text: `${p.name} ${p.surname}`.trim() }));
  const learnerSel = el("select", { "aria-label": "Filter by learner" });
  learnerSel.appendChild(el("option", { value: "", text: "All learners" }));
  for (const l of store.learners) learnerSel.appendChild(el("option", { value: l.learner_id, text: `${l.name} ${l.surname}`.trim() }));
  const numberInput = el("input", { type: "search", placeholder: "Invoice number", "aria-label": "Filter by invoice number" });
  const monthInput = el("input", { type: "month", "aria-label": "Filter by month" });
  const statusSel = el("select", { "aria-label": "Filter by status" });
  for (const s of statusOptions) statusSel.appendChild(el("option", { value: s, text: s || "All statuses" }));

  for (const [key, node] of [["parent", parentSel], ["learner", learnerSel], ["number", numberInput], ["month", monthInput], ["status", statusSel]]) {
    node.addEventListener("change", () => { filters[key] = node.value; draw(); });
    node.addEventListener("input", () => { filters[key] = node.value; draw(); });
  }

  box.appendChild(el("div", { class: "filter-grid" }, [
    field("Parent", parentSel), field("Learner", learnerSel), field("Number", numberInput),
    field("Month", monthInput), field("Status", statusSel),
  ]));

  const list = el("div", { class: "invoice-list" });
  box.appendChild(list);

  function matches(inv) {
    if (filters.parent && String(inv.parent_id) !== filters.parent) return false;
    if (filters.learner && String(inv.learner_id) !== filters.learner) return false;
    if (filters.number && !String(inv.number_text).toLowerCase().includes(filters.number.toLowerCase())) return false;
    if (filters.month && I.monthKey(inv.invoice_date) !== filters.month) return false;
    if (filters.status && I.deriveDisplayStatus(inv) !== filters.status) return false;
    return true;
  }

  function draw() {
    list.replaceChildren();
    const rows = store.invoices.filter(matches).sort((a, b) => String(b.invoice_date).localeCompare(String(a.invoice_date)));
    if (!rows.length) {
      list.appendChild(emptyState("No invoices yet", "Create your first one.",
        el("button", { class: "btn primary", text: "Create Invoice", onClick: () => navigate("create") })));
      return;
    }
    for (const inv of rows) {
      const parent = store.parents.find((p) => String(p.parent_id) === String(inv.parent_id));
      const status = I.deriveDisplayStatus(inv);
      list.appendChild(el("button", {
        class: "invoice-row", onClick: () => showDetail(inv),
      }, [
        el("div", { class: "inv-main" }, [
          el("strong", { text: `#${inv.number_text}` }),
          el("span", { text: inv.snap_parent_name || (parent ? `${parent.name} ${parent.surname}` : "") }),
        ]),
        el("div", { class: "inv-side" }, [
          el("span", { class: "inv-amount", text: I.formatMoney(inv.total_cents, "ZAR", store.settings.currency_symbol || "R") }),
          el("span", { class: `badge status-${status.toLowerCase()}`, text: status }),
        ]),
      ]));
    }
  }

  async function showDetail(inv) {
    const detail = el("div", { class: "detail-panel" });
    main.appendChild(detail);
    detail.appendChild(el("button", { class: "btn secondary small", text: "Back", onClick: () => detail.remove() }));
    detail.appendChild(el("h2", { text: `Invoice ${inv.number_text}` }));
    detail.appendChild(el("p", { text: `${inv.snap_parent_name || ""} ${inv.snap_learner_name ? "\u2022 " + inv.snap_learner_name : ""}` }));
    detail.appendChild(el("p", { text: `Issued ${I.formatDateDisplay(inv.invoice_date)} \u2022 Due ${I.formatDateDisplay(inv.due_date)}` }));
    detail.appendChild(el("p", { class: "inv-amount", text: I.formatMoney(inv.total_cents, "ZAR", store.settings.currency_symbol || "R") }));
    detail.appendChild(el("p", { class: "help", text: `Payment reference: ${I.paymentReference(inv)}` }));

    const actions = el("div", { class: "detail-actions" });
    for (const status of ["Draft", "Sent", "Paid", "Cancelled"]) {
      if (status === inv.status) continue;
      actions.appendChild(el("button", {
        class: "btn secondary small", text: `Mark ${status}`,
        onClick: async () => {
          if (status === "Cancelled") {
            const ok = await confirmDialog({ title: "Cancel this invoice?", message: "The record is kept and its number is never reused.", confirmText: "Cancel invoice", danger: true });
            if (!ok) return;
          }
          try { await S.setInvoiceStatus(store, inv.invoice_id, status, { reason: "owner action" }); await store.reload(); toast(`Invoice ${inv.number_text} is now ${status}.`, "success"); refresh(); }
          catch (err) { toast(errorMessage(err), "error"); }
        },
      }));
    }
    actions.appendChild(el("button", { class: "btn secondary small", text: "Duplicate", onClick: async () => {
      try { const dup = await S.duplicateInvoice(store, inv.invoice_id); await store.reload(); toast(`Duplicated as #${dup.number_text}.`, "success"); refresh(); }
      catch (err) { toast(errorMessage(err), "error"); }
    } }));
    actions.appendChild(el("button", { class: "btn secondary small", text: "Download PDF", onClick: async () => {
      try { const bytes = await buildInvoicePdf(inv); download(I.invoiceFilename(inv), bytes, "application/pdf"); toast("PDF downloaded.", "success"); }
      catch (err) { toast(errorMessage(err), "error"); }
    } }));
    detail.appendChild(actions);

    // WhatsApp share: the real wa.me link, copy button, and the honest note.
    const share = W.invoiceSharePayload(inv, {
      amountDisplay: I.formatMoney(inv.total_cents, "ZAR", store.settings.currency_symbol || "R"),
      dueDateDisplay: I.formatDateDisplay(inv.due_date),
    });
    const wa = el("div", { class: "whatsapp-block" }, [el("h3", { text: "Send on WhatsApp" })]);
    if (share.problem) {
      wa.appendChild(el("p", { class: "help", text: share.problem }));
    } else {
      wa.appendChild(el("p", { class: "wa-url", text: share.url }));
      wa.appendChild(el("div", { class: "detail-actions" }, [
        el("a", { class: "btn primary small", href: share.url, target: "_blank", rel: "noopener", text: "Open WhatsApp" }),
        el("button", { class: "btn secondary small", text: "Copy message", onClick: async () => {
          try { await navigator.clipboard.writeText(share.message); toast("Message copied.", "success"); }
          catch (err) { toast("Could not copy; select the text instead.", "error"); }
        } }),
      ]));
    }
    wa.appendChild(el("p", { class: "help", text: "The app does not send anything and cannot confirm delivery. Attach the downloaded PDF inside WhatsApp." }));
    detail.appendChild(wa);
    detail.scrollIntoView({ behavior: "smooth" });
  }

  draw();
  main.appendChild(box);
}
