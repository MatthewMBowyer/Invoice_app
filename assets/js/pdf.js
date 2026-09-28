// Client-side A4 invoice PDF rendering with pdf-lib (vendored at lib/pdf-lib.min.js).
//
// Why pdf-lib: it is pure JavaScript, needs no build step and no server, works
// entirely in the browser, gives exact control over A4 geometry and text
// positioning (which the specified layout needs), and it is a single static file
// we vendor so the app has no runtime dependency and no private key.
//
// The renderer reads ONLY the invoice's stored snapshot columns plus its stored
// line items — never the live settings, parent, learner or rate rows — so a
// historical invoice cannot change when any of that data changes later.

import { formatMoney, formatDateDisplay, formatHours } from "./money.js";
import { paymentReference } from "./invoicing.js";

export const PAGE_WIDTH = 595.28;
export const PAGE_HEIGHT = 841.89;
const MARGIN = 51; // ~18mm
const INK = [0.13, 0.13, 0.13];
const GREY = [0.45, 0.45, 0.45];
const LINE = [0.8, 0.8, 0.8];
const ACCENT = [0.0, 0.59, 0.70]; // CTT blue #0097b2

const BANK_FIELDS = [
  ["Account Holder", "snap_bank_account_holder"],
  ["Account Type", "snap_bank_account_type"],
  ["Bank", "snap_bank_name"],
  ["Branch Code", "snap_bank_branch_code"],
  ["Account Number", "snap_bank_account_number"],
  ["SWIFT / BIC", "snap_bank_swift"],
];

function hexToRgb(hex, fallback) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function money(invoice, cents) {
  const symbol = invoice.snap_currency_symbol !== undefined && invoice.snap_currency_symbol !== ""
    ? invoice.snap_currency_symbol : null;
  return formatMoney(cents, invoice.currency || "ZAR", symbol);
}

/** Build the A4 PDF bytes for a stored invoice. Returns a Uint8Array. */
export async function buildInvoicePdf(invoice, { PDFLib } = {}) {
  const lib = PDFLib || (typeof window !== "undefined" ? window.PDFLib : null);
  if (!lib || !lib.PDFDocument) {
    throw new Error("The PDF library (pdf-lib) is not available.");
  }
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  // Fixed dates make re-rendering the SAME stored snapshot byte-identical, the
  // same invariant the Python app gets from reportlab's invariant=1. It is what
  // makes snapshot immutability checkable with a hash rather than by eye.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(invoice.snap_accent_colour, ACCENT);

  const ink = rgb(...INK);
  const grey = rgb(...GREY);
  const lineCol = rgb(...LINE);
  const accentCol = rgb(...accent);

  const text = (str, x, y, { size = 10, f = font, color = ink } = {}) =>
    page.drawText(String(str), { x, y, size, font: f, color });

  const textRight = (str, xRight, y, opts = {}) => {
    const size = opts.size || 10;
    const f = opts.f || font;
    const w = f.widthOfTextAtSize(String(str), size);
    text(str, xRight - w, y, opts);
  };

  const rule = (y, x1 = MARGIN, x2 = PAGE_WIDTH - MARGIN) =>
    page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.5, color: lineCol });

  const right = PAGE_WIDTH - MARGIN;
  let y = PAGE_HEIGHT - MARGIN;

  // ---- header -------------------------------------------------------------
  const title = invoice.snap_invoice_title || "INVOICE";
  text(title, MARGIN, y - 6, { size: 26, f: bold, color: accentCol });
  textRight(invoice.snap_business_name || "", right, y - 4, { size: 14, f: bold });
  let by = y - 18;
  for (const part of [invoice.snap_business_address, invoice.snap_business_phone,
    invoice.snap_business_email]) {
    if (part) { textRight(part, right, by, { size: 9, color: grey }); by -= 11; }
  }

  y -= 60;

  // ---- BILL TO / invoice meta --------------------------------------------
  text("BILL TO", MARGIN, y, { size: 9, f: bold, color: grey });
  text(invoice.snap_parent_name || "", MARGIN, y - 14, { size: 12, f: bold });
  let py = y - 28;
  if (invoice.snap_parent_whatsapp) { text(invoice.snap_parent_whatsapp, MARGIN, py, { size: 9 }); py -= 11; }
  if (invoice.snap_parent_email) { text(invoice.snap_parent_email, MARGIN, py, { size: 9 }); py -= 11; }
  if (invoice.snap_learner_name) { text(invoice.snap_learner_name, MARGIN, py, { size: 9, color: grey }); }

  const metaX = right - 150;
  const meta = [
    ["INVOICE NUMBER", invoice.number_text || ""],
    ["ISSUED", formatDateDisplay(invoice.invoice_date)],
    ["DUE", formatDateDisplay(invoice.due_date)],
  ];
  meta.forEach(([label, value], i) => {
    const my = y - i * 15;
    text(label, metaX, my, { size: 8, f: bold, color: grey });
    textRight(value, right, my, { size: 10, f: bold });
  });

  y -= 70;

  // ---- items table --------------------------------------------------------
  const cols = { item: MARGIN, price: right - 250, qty: right - 130, amount: right };
  text("ITEM", cols.item, y, { size: 9, f: bold, color: grey });
  textRight("PRICE", cols.price + 60, y, { size: 9, f: bold, color: grey });
  textRight("QUANTITY", cols.qty + 50, y, { size: 9, f: bold, color: grey });
  textRight("AMOUNT", cols.amount, y, { size: 9, f: bold, color: grey });
  y -= 6;
  rule(y);
  y -= 16;

  const lines = invoice.line_items || [];
  for (const line of lines) {
    const isFlat = String(line.is_flat) === "1" || line.is_flat === true;
    const qty = isFlat ? "flat" : formatHours(Number(line.hours_milli));
    const rateCents = Number(line.rate_cents);
    let desc = line.description;
    if (!desc) {
      const label = String(line.service || "Tuition").replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
      desc = `${label} Tuition`;
    }
    text(desc, cols.item, y, { size: 10 });
    textRight(money(invoice, rateCents), cols.price + 60, y, { size: 10 });
    textRight(qty, cols.qty + 50, y, { size: 10 });
    textRight(money(invoice, Number(line.amount_cents)), cols.amount, y, { size: 10, f: bold });
    y -= 16;
  }
  rule(y);
  y -= 24;

  // ---- totals -------------------------------------------------------------
  const total = Number(invoice.total_cents || 0);
  const subtotal = Number(invoice.subtotal_cents != null ? invoice.subtotal_cents : total);
  textRight("Subtotal:", right - 90, y, { size: 10, color: grey });
  textRight(money(invoice, subtotal), right, y, { size: 10 });
  y -= 15;
  textRight("Total:", right - 90, y, { size: 10, f: bold });
  textRight(money(invoice, total), right, y, { size: 11, f: bold });
  y -= 34;

  text("AMOUNT DUE", MARGIN, y, { size: 9, f: bold, color: grey });
  text(money(invoice, total), MARGIN, y - 20, { size: 20, f: bold, color: accentCol });
  y -= 60;

  // ---- payment instructions ----------------------------------------------
  text("PAYMENT INSTRUCTIONS", MARGIN, y, { size: 9, f: bold, color: grey });
  y -= 18;
  for (const [label, key] of BANK_FIELDS) {
    const value = invoice[key] || "";
    text(label, MARGIN, y, { size: 9, color: grey });
    if (value) {
      text(String(value), MARGIN + 110, y, { size: 9 });
    } else {
      page.drawLine({
        start: { x: MARGIN + 110, y: y - 2 },
        end: { x: MARGIN + 300, y: y - 2 },
        thickness: 0.5, color: lineCol,
      });
    }
    y -= 15;
  }
  // Payment reference (from the snapshot template).
  const ref = paymentReference(invoice, { totalCents: total });
  text("Reference", MARGIN, y, { size: 9, color: grey });
  text(String(ref), MARGIN + 110, y, { size: 9, f: bold });
  y -= 22;

  // ---- terms (only when the owner typed them) -----------------------------
  if (invoice.snap_payment_terms) {
    text("Terms", MARGIN, y, { size: 9, f: bold, color: grey });
    text(String(invoice.snap_payment_terms), MARGIN + 110, y, { size: 9 });
    y -= 15;
  }
  if (invoice.snap_terms_extra) {
    text(String(invoice.snap_terms_extra), MARGIN, y, { size: 9, color: grey });
    y -= 13;
  }
  if (invoice.snap_invoice_footer) {
    text(String(invoice.snap_invoice_footer), MARGIN, y, { size: 9, color: grey });
    y -= 13;
  }

  // ---- footer -------------------------------------------------------------
  const footerY = MARGIN + 24;
  rule(footerY + 12);
  const note = invoice.snap_pdf_footer_note
    || "Generated locally by this invoicing app. Values shown are the values stored on this invoice.";
  text(note, MARGIN, footerY, { size: 8, color: grey });
  textRight("Page 1 of 1", right, footerY, { size: 8, color: grey });

  return doc.save();
}
