// Invoicing business rules — the browser twin of the Python app's
// app/services/invoicing.py and the filename/reference parts of
// app/services/pdf.py. Everything here is deliberately free of DOM and network
// knowledge so the same code path serves the UI, the headless tests and the
// cross-language parity harness.

import {
  formatMoney, parseMoneyToCents, parseHoursToMilli, lineAmountCents,
  formatHours, formatMoneyPlain, todayIso, addDays, formatDateDisplay, monthKey,
  monthLabel,
} from "./money.js";

export const STATUSES = ["Draft", "Sent", "Paid", "Overdue", "Cancelled"];

export function serviceLabel(rate, service) {
  const key = String(service || "").trim();
  if (!key) return "Tuition";
  if (rate && rate.label) return rate.label;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --------------------------------------------------------------------------
// status derivation
// --------------------------------------------------------------------------

/** Cancelled stays Cancelled; Paid/Draft never Overdue; Sent past due is Overdue. */
export function deriveDisplayStatus(invoice, today = null) {
  const status = invoice.status || "Draft";
  if (status === "Paid" || status === "Cancelled" || status === "Draft") return status;
  const t = today || todayIso();
  const due = invoice.due_date || "";
  if (due && due < t) return "Overdue";
  return status === "Sent" ? "Sent" : status;
}

export function withDisplayStatus(invoice, today = null) {
  return Object.assign({}, invoice, { display_status: deriveDisplayStatus(invoice, today) });
}

// --------------------------------------------------------------------------
// numbering
// --------------------------------------------------------------------------

export function numberText(prefix, number) {
  const p = String(prefix || "").trim();
  return p ? `${p}${Math.trunc(number)}` : String(Math.trunc(number));
}

export function nextNumberPreview(settings) {
  const number = parseInt(settings.next_invoice_number || 1, 10) || 1;
  const prefix = settings.invoice_prefix || "";
  return { number, text: numberText(prefix, number) };
}

function numberTextExists(invoices, text) {
  return invoices.some((i) => i.number_text === text);
}

export function duplicateNumberError(invoices, number, prefix) {
  const text = numberText(prefix, number);
  if (numberTextExists(invoices, text)) {
    return `Invoice number ${text} has already been used. Pick a different ` +
      "number or leave the field on the next available number.";
  }
  return null;
}

/**
 * Reserve and consume the next invoice number. Returns {number, text, settings}
 * with the advanced setting. A collision (owner lowered the setting onto used
 * numbers) is skipped rather than silently reusing a number.
 */
export function allocateNumber(invoices, settings) {
  const s = Object.assign({}, settings);
  for (;;) {
    const { number, text } = nextNumberPreview(s);
    s.next_invoice_number = number + 1;
    if (!numberTextExists(invoices, text)) return { number, text, settings: s };
  }
}

// --------------------------------------------------------------------------
// line handling
// --------------------------------------------------------------------------

export function isFlatLine(line) {
  const mode = String(line.mode || line.line_mode || "").trim().toLowerCase();
  if (["flat", "amount", "full", "full_amount"].includes(mode)) return true;
  if (["hourly", "rate", "hours"].includes(mode)) return false;
  const hasAmount = line.amount !== null && line.amount !== undefined && String(line.amount) !== "";
  const noHours = String(line.hours ?? "").trim() === "" || String(line.hours ?? "").trim() === "0";
  return hasAmount && noHours;
}

/**
 * Turn raw form lines into the stored shape. A flat line is stored with
 * rate_cents = amount_cents and hours_milli = 1000 so rate x hours reproduces
 * the amount exactly.
 */
export function normaliseLines(lines) {
  return lines.map((line) => {
    const service = String(line.service || "").trim() || "Custom";
    if (isFlatLine(line)) {
      const src = line.amount !== null && line.amount !== undefined && String(line.amount) !== ""
        ? line.amount : line.rate;
      const amountCents = parseMoneyToCents(src);
      return {
        service,
        description: String(line.description || "").trim(),
        rate_cents: amountCents,
        hours_milli: 1000,
        amount_cents: amountCents,
        lesson_id: line.lesson_id ?? null,
        is_flat: 1,
      };
    }
    const rateCents = parseMoneyToCents(line.rate);
    const hoursMilli = parseHoursToMilli(line.hours);
    return {
      service,
      description: String(line.description || "").trim(),
      rate_cents: rateCents,
      hours_milli: hoursMilli,
      amount_cents: lineAmountCents(rateCents, hoursMilli),
      lesson_id: line.lesson_id ?? null,
      is_flat: 0,
    };
  });
}

export function invoiceTotalCents(lineItems) {
  return lineItems.reduce((acc, l) => acc + Math.trunc(l.amount_cents || 0), 0);
}

// --------------------------------------------------------------------------
// payment reference
// --------------------------------------------------------------------------

/** Render the payment reference template with the invoice's variables. */
export function paymentReference(invoice, { totalCents = null } = {}) {
  const template = invoice.snap_payment_reference_template || "{parent_name} - {learner_name}";
  const symbol = invoice.snap_currency_symbol !== null && invoice.snap_currency_symbol !== undefined
    && invoice.snap_currency_symbol !== "" ? invoice.snap_currency_symbol : null;
  const total = totalCents !== null && totalCents !== undefined
    ? totalCents : (invoice.total_cents || 0);
  const ctx = {
    parent_name: invoice.snap_parent_name || "",
    learner_name: invoice.snap_learner_name || "",
    invoice_number: invoice.number_text || "",
    amount: formatMoney(total, invoice.currency || "ZAR", symbol),
  };
  let text = template;
  for (const key of ["parent_name", "learner_name", "invoice_number", "amount"]) {
    text = text.split("{" + key + "}").join(String(ctx[key]));
  }
  // An empty variable leaves its separator behind ("Test Parent - "); drop
  // dangling and doubled separators, but keep wording the owner typed.
  text = text.replace(/[\s\-\u2013\u2014\/,:]+$/g, "");
  text = text.replace(/([\-\u2013\u2014\/,:])\s*\1+/g, "$1");
  text = text.replace(/\s{2,}/g, " ");
  return text.trim();
}

// --------------------------------------------------------------------------
// filenames (from the Python app's pdf.py)
// --------------------------------------------------------------------------

const RESERVED_NAMES = new Set(["CON", "PRN", "AUX", "NUL",
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)]);

const INVALID_FILENAME_CHARS = /[^A-Za-z0-9\-_. ]/g;

/** Make a single filename component safe on Windows, macOS and Linux. */
export function sanitizeFilenameComponent(value, fallback = "Item", maxLength = 60) {
  let text = String(value === null || value === undefined ? "" : value).trim();
  if (!text) return fallback;
  // Strip accents, then fold to ASCII (mirrors NFKD + ascii-ignore).
  text = text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  text = text.replace(/[^\x00-\x7F]/g, "");
  text = text.replace(/'/g, "").replace(/\u2019/g, "");
  text = text.replace(INVALID_FILENAME_CHARS, "_");
  text = text.replace(/[\s_]+/g, "_");
  text = text.replace(/^[._ ]+|[._ ]+$/g, "");
  if (!text) return fallback;
  text = text.slice(0, maxLength).replace(/^[._ ]+|[._ ]+$/g, "");
  if (!text) return fallback;
  if (RESERVED_NAMES.has(text.toUpperCase())) text = `${text}_file`;
  return text;
}

// The owner's default business name, matching the Python app's db.BUSINESS_NAME.
export const DEFAULT_BUSINESS_NAME = "Chloe's Travelling Tutors";

/** Chloes_Travelling_Tutors_Invoice_643_Tarryn.pdf */
export function invoiceFilename(invoice) {
  const business = sanitizeFilenameComponent(
    invoice.snap_business_name || DEFAULT_BUSINESS_NAME, "Invoice");
  const number = sanitizeFilenameComponent(invoice.number_text || invoice.number || "0", "0");
  const parent = sanitizeFilenameComponent(invoice.snap_parent_name || "Parent", "Parent");
  return `${business}_Invoice_${number}_${parent}.pdf`;
}

// --------------------------------------------------------------------------
// dashboard
// --------------------------------------------------------------------------

/** Dashboard figures computed from the invoice rows, never a cached counter. */
export function dashboard(invoices, today = null) {
  const t = today || todayIso();
  const key = monthKey(t);
  const month = invoices.filter((i) => monthKey(i.invoice_date) === key);
  const monthTotal = month.reduce((a, i) => a + Math.trunc(i.total_cents || 0), 0);
  const paid = invoices.filter((i) => i.status === "Paid");
  const paidTotal = paid.reduce((a, i) => a + Math.trunc(i.total_cents || 0), 0);
  const outstanding = invoices.filter((i) => {
    const ds = deriveDisplayStatus(i, t);
    return ds === "Sent" || ds === "Overdue";
  });
  const outstandingTotal = outstanding.reduce((a, i) => a + Math.trunc(i.total_cents || 0), 0);
  return {
    today: t,
    month: key,
    month_label: monthLabel(key),
    invoices_this_month: month.length,
    invoiced_this_month_cents: monthTotal,
    invoiced_this_month_display: formatMoney(monthTotal),
    paid_invoices: paid.length,
    paid_total_cents: paidTotal,
    paid_total_display: formatMoney(paidTotal),
    outstanding_invoices: outstanding.length,
    outstanding_total_cents: outstandingTotal,
    outstanding_total_display: formatMoney(outstandingTotal),
  };
}

export { formatMoney, formatMoneyPlain, formatHours, formatDateDisplay, todayIso, addDays, monthKey };
