// Invoice history: the five filters (parent, learner, invoice number, month,
// status) and an invoice detail with status actions, duplicate, soft cancel,
// PDF download and the WhatsApp deep link.

import { el, field, toast, confirmDialog, download, emptyState, viewDocument, revealElement, headerOffset, canShareFile, shareFile } from "../ui.js";
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
    // Probed once per detail view: Web Share level 2 decides whether the PDF can
    // be attached at all, and the copy and the button must agree about that.
    const canAttachPdf = canShareFile(new Uint8Array([1]), "probe.pdf", "application/pdf");

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

    // One render, reused by view / download / share so all three show the same
    // document and none of them can silently disagree with the others.
    let cachedBytes = null;
    async function pdfBytes() {
      if (!cachedBytes) cachedBytes = await buildInvoicePdf(inv, { rates: store.rates });
      return cachedBytes;
    }

    // An invoice generated before the banking details were entered keeps blank
    // payment lines forever, because the PDF prints the values frozen onto the
    // invoice. This offers the one-click repair, and only when it is needed.
    if (!S.hasBankingDetails({
      account_holder: inv.snap_bank_account_holder, account_type: inv.snap_bank_account_type,
      bank_name: inv.snap_bank_name, branch_code: inv.snap_bank_branch_code,
      account_number: inv.snap_bank_account_number, swift_bic: inv.snap_bank_swift,
    })) {
      if (S.hasBankingDetails(store.settings)) {
        actions.appendChild(el("button", { class: "btn primary small", text: "Add my banking details", onClick: async () => {
          try {
            await S.applyBankingToInvoice(store, inv.invoice_id);
            await store.reload();
            toast("Banking details added to this invoice.", "success");
            refresh();
          } catch (err) { toast(errorMessage(err), "error"); }
        } }));
        detail.appendChild(el("p", { class: "help", text: "This invoice was made before your banking details were saved, so its payment lines are blank. \u201CAdd my banking details\u201D fills them in. It changes nothing else." }));
      } else {
        detail.appendChild(el("p", { class: "help", text: "This invoice has no banking details. Add them under Settings \u203A Banking, then press \u201CAdd my banking details\u201D here." }));
      }
    }

    actions.appendChild(el("button", { class: "btn primary small", text: "View invoice", onClick: async () => {
      try { viewDocument(await pdfBytes(), I.invoiceFilename(inv)); }
      catch (err) { toast(errorMessage(err), "error"); }
    } }));
    actions.appendChild(el("button", { class: "btn secondary small", text: "Download PDF", onClick: async () => {
      try {
        const bytes = await pdfBytes();
        download(I.invoiceFilename(inv), bytes, "application/pdf");
        toast("PDF downloaded.", "success");
      } catch (err) { toast(errorMessage(err), "error"); }
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
      const waActions = el("div", { class: "detail-actions" });
      waActions.appendChild(el("a", { class: "btn primary small", href: share.url, target: "_blank", rel: "noopener", text: "Open WhatsApp" }));
      waActions.appendChild(el("button", { class: "btn secondary small", text: "Copy message", onClick: async () => {
        try { await navigator.clipboard.writeText(share.message); toast("Message copied.", "success"); }
        catch (err) { toast("Could not copy; select the text instead.", "error"); }
      } }));

      // Attaching the PDF is only possible through the OS share sheet: a wa.me
      // link carries text and nothing else. On a phone (Web Share level 2) this
      // hands WhatsApp the real file, so the parent receives the invoice itself.
      if (canAttachPdf) {
        waActions.appendChild(el("button", { class: "btn primary small", text: "Share PDF on WhatsApp", onClick: async () => {
          try {
            const bytes = await pdfBytes();
            await shareFile(bytes, I.invoiceFilename(inv), "application/pdf", {
              title: `Invoice ${inv.number_text}`, text: share.message,
            });
          } catch (err) {
            // Dismissing the share sheet is a normal action, not a failure.
            if (err && (err.name === "AbortError" || /abort|cancel/i.test(String(err.message || "")))) return;
            toast("Could not open the share sheet. Use Download PDF, then attach it in WhatsApp.", "error");
          }
        } }));
      }
      wa.appendChild(waActions);
    }
    wa.appendChild(el("p", { class: "help", text: canAttachPdf
      ? "Tap Share PDF on WhatsApp, then choose WhatsApp to send the invoice and its PDF together."
      : "The app does not send anything and cannot confirm delivery. Attach the downloaded PDF inside WhatsApp." }));
    detail.appendChild(wa);
    revealElement(detail, headerOffset() + 8);
  }

  draw();
  main.appendChild(box);
}
