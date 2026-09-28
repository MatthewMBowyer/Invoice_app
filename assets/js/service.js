// Application service layer: the business operations the screens call. It owns
// no DOM and no network details — it composes the domain modules (money,
// invoicing, whatsapp) with the Store, so the same code path serves the UI and
// the headless demonstrator.

import * as M from "./money.js";
import * as INV from "./invoicing.js";
import {
  StoreError, COLUMNS, DEFAULT_SETTINGS, objectsToValues, encodeInvoice,
  encodeLine, asInt, asBool, nowIso,
} from "./store.js";

export class ValidationError extends Error {
  constructor(messages, warnings = []) {
    super((messages || []).join("; ") || "validation failed");
    this.name = "ValidationError";
    this.messages = messages || [];
    this.warnings = warnings || [];
  }
}

/** The values frozen onto the invoice at generation time. */
export function snapshotFields(settings, parent, learner) {
  const s = settings || {};
  const p = parent || {};
  const l = learner || {};
  const full = (o) => `${o.name || ""} ${o.surname || ""}`.trim();
  return {
    snap_parent_name: full(p),
    snap_parent_whatsapp: p.whatsapp || "",
    snap_parent_email: p.email || "",
    snap_learner_name: full(l),
    snap_school_level: l.school_level || "",
    snap_business_name: s.business_name || "",
    snap_business_address: s.business_address || "",
    snap_business_phone: s.business_phone || "",
    snap_business_email: s.business_email || "",
    snap_bank_account_holder: s.account_holder || "",
    snap_bank_account_type: s.account_type || "",
    snap_bank_name: s.bank_name || "",
    snap_bank_branch_code: s.branch_code || "",
    snap_bank_account_number: s.account_number || "",
    snap_bank_swift: s.swift_bic || "",
    snap_payment_reference_template: s.payment_reference_template || "",
    snap_payment_terms: s.payment_terms || "",
    snap_whatsapp_template: s.whatsapp_template || "",
    snap_invoice_footer: s.invoice_footer || "",
    snap_terms_extra: s.terms_extra || "",
    snap_accent_colour: s.accent_colour || "",
    snap_currency_symbol: s.currency_symbol || "",
    snap_invoice_title: s.invoice_title || "",
    snap_pdf_footer_note: s.pdf_footer_note || "",
  };
}

export function validateInvoice(store, { parentId, lines, manualNumber, manualPrefix }) {
  const errors = [];
  const warnings = [];
  const parent = store.parents.find((p) => asInt(p.parent_id) === asInt(parentId));
  if (!parent) errors.push("Choose a parent before generating an invoice.");
  else if (!asBool(parent.active)) {
    warnings.push(`${parent.name} is marked inactive - the invoice will still be generated.`);
  }
  if (!lines || !lines.length) errors.push("Add at least one line item before generating an invoice.");

  let total = 0;
  (lines || []).forEach((line, idx) => {
    const label = `Line ${idx + 1}`;
    if (INV.isFlatLine(line)) {
      try {
        const cents = M.parseMoneyToCents(
          line.amount !== null && line.amount !== undefined && String(line.amount) !== ""
            ? line.amount : line.rate);
        if (cents < 0) errors.push(`${label}: the amount cannot be negative.`);
        else total += cents;
      } catch (err) {
        errors.push(`${label}: enter an amount.`);
      }
      return;
    }
    let rateCents; let hoursMilli;
    try {
      rateCents = M.parseMoneyToCents(line.rate);
    } catch (err) {
      errors.push(`${label}: enter a rate.`);
      return;
    }
    try {
      hoursMilli = M.parseHoursToMilli(line.hours);
    } catch (err) {
      errors.push(`${label}: enter the hours worked.`);
      return;
    }
    if (rateCents < 0) errors.push(`${label}: the rate cannot be negative.`);
    if (hoursMilli < 0) errors.push(`${label}: the hours cannot be negative.`);
    if (hoursMilli === 0) {
      errors.push(`${label}: hours must be greater than zero (delete the line instead of invoicing 0 hours).`);
    }
    if (rateCents >= 0 && hoursMilli > 0) total += M.lineAmountCents(rateCents, hoursMilli);
  });

  if (!errors.length && total === 0) {
    warnings.push(`The invoice total is ${M.formatMoney(0, "ZAR", store.settings.currency_symbol)}. ` +
      "Check the hours and rate, then generate again if you really mean to send a zero-value invoice.");
  }
  if (manualNumber !== null && manualNumber !== undefined && manualNumber !== "") {
    const dup = INV.duplicateNumberError(store.invoices, manualNumber, manualPrefix || "");
    if (dup) errors.push(dup);
  }
  return { errors, warnings, total };
}

/**
 * Create an invoice transactionally. The invoice row, its line items and the
 * advanced next-number setting are written together; a write failure surfaces a
 * plain error and leaves the stored state (and the caller's form values) intact.
 */
export async function createInvoice(store, {
  parentId, learnerId = null, lines, invoiceDate = null, dueDate = null,
  status = "Draft", manualNumber = null, manualPrefix = null, allowZero = false,
  isDemo = false,
}) {
  const check = validateInvoice(store, { parentId, lines, manualNumber, manualPrefix });
  if (check.errors.length) throw new ValidationError(check.errors, check.warnings);
  if (check.warnings.length && !allowZero && check.warnings.some((w) => w.includes("total is"))) {
    throw new ValidationError([], check.warnings);
  }

  const parent = store.parents.find((p) => asInt(p.parent_id) === asInt(parentId));
  const learner = learnerId !== null && learnerId !== undefined && learnerId !== ""
    ? store.learners.find((l) => asInt(l.learner_id) === asInt(learnerId))
    : null;

  const manual = manualNumber !== null && manualNumber !== undefined && manualNumber !== "";
  const nextSettings = Object.assign({}, store.settings);
  let number; let numberText; let prefixUsed;
  if (manual) {
    prefixUsed = manualPrefix || "";
    number = asInt(manualNumber);
    numberText = INV.numberText(prefixUsed, number);
    if (number >= (asInt(nextSettings.next_invoice_number, 1))) {
      nextSettings.next_invoice_number = String(number + 1);
    }
  } else {
    const alloc = INV.allocateNumber(store.invoices, store.settings);
    number = alloc.number;
    numberText = alloc.text;
    prefixUsed = store.settings.invoice_prefix || "";
    nextSettings.next_invoice_number = String(alloc.settings.next_invoice_number);
  }

  const now = M.todayIso();
  const date = invoiceDate || now;
  const termsDays = asInt(nextSettings.due_date_period_days, 7);
  const due = dueDate || M.addDays(date, termsDays);

  const prepared = INV.normaliseLines(lines);
  const total = INV.invoiceTotalCents(prepared);
  const invoiceId = nextId(store.invoices, "invoice_id");

  const invoice = Object.assign({
    invoice_id: String(invoiceId),
    number: String(number),
    number_text: numberText,
    prefix: prefixUsed,
    parent_id: String(parentId),
    learner_id: learnerId === null || learnerId === undefined ? "" : String(learnerId),
    invoice_date: date,
    due_date: due,
    status,
    currency: nextSettings.currency || "ZAR",
    subtotal_cents: String(total),
    total_cents: String(total),
    cancelled_at: "",
    cancel_reason: "",
    duplicate_of: "",
    date_sent: status === "Sent" ? nowIso() : "",
    created_at: nowIso(),
    updated_at: nowIso(),
  }, snapshotFields(nextSettings, parent, learner));

  const newLines = prepared.map((l, i) => Object.assign({
    line_id: String(nextId(store.lines, "line_id") + i),
    invoice_id: String(invoiceId),
    sort_order: String(i),
  }, {
    service: l.service,
    description: l.description,
    rate_cents: String(l.rate_cents),
    hours_milli: String(l.hours_milli),
    amount_cents: String(l.amount_cents),
    is_flat: String(l.is_flat),
  }));

  const newInvoices = store.invoices.concat([decodeForStore(invoice)]);
  const newLinesAll = store.lines.concat(newLines);

  await commitTabs(store, {
    INVOICES: newInvoices,
    INVOICE_LINES: newLinesAll,
    SETTINGS: settingsRows(nextSettings),
  }, "save the invoice");

  store.invoices = newInvoices;
  store.lines = newLinesAll;
  store.settings = nextSettings;
  return store.invoices[store.invoices.length - 1];
}

function decodeForStore(invoice) {
  const out = Object.assign({}, invoice);
  out.invoice_id = asInt(invoice.invoice_id);
  out.number = asInt(invoice.number);
  out.parent_id = asInt(invoice.parent_id);
  out.learner_id = invoice.learner_id === "" ? null : asInt(invoice.learner_id);
  out.subtotal_cents = asInt(invoice.subtotal_cents);
  out.total_cents = asInt(invoice.total_cents);
  return out;
}

function nextId(rows, key) {
  let max = 0;
  for (const r of rows) {
    const v = asInt(r[key]);
    if (v > max) max = v;
  }
  return max + 1;
}

function settingsRows(settings) {
  const rows = [COLUMNS.SETTINGS.slice()];
  for (const key of Object.keys(DEFAULT_SETTINGS)) rows.push([key, settings[key] ?? ""]);
  for (const key of Object.keys(settings)) {
    if (!(key in DEFAULT_SETTINGS)) rows.push([key, settings[key] ?? ""]);
  }
  return rows;
}

/** Write the given tabs; a failure throws a plain StoreError and changes nothing. */
async function commitTabs(store, tabs, action) {
  const updates = [];
  if (tabs.INVOICES) {
    updates.push({ range: "INVOICES!A1", values: objectsToValues(COLUMNS.INVOICES, tabs.INVOICES.map(encodeInvoice)) });
  }
  if (tabs.INVOICE_LINES) {
    updates.push({ range: "INVOICE_LINES!A1", values: objectsToValues(COLUMNS.INVOICE_LINES, tabs.INVOICE_LINES.map(encodeLine)) });
  }
  if (tabs.SETTINGS) {
    updates.push({ range: "SETTINGS!A1", values: tabs.SETTINGS });
  }
  if (tabs.CLIENTS) {
    updates.push({ range: "CLIENTS!A1", values: objectsToValues(COLUMNS.CLIENTS, tabs.CLIENTS) });
  }
  if (tabs.LEARNERS) {
    updates.push({ range: "LEARNERS!A1", values: objectsToValues(COLUMNS.LEARNERS, tabs.LEARNERS) });
  }
  if (tabs.RATES) {
    updates.push({ range: "RATES!A1", values: objectsToValues(COLUMNS.RATES, tabs.RATES) });
  }
  if (tabs.LESSONS) {
    updates.push({ range: "LESSONS!A1", values: objectsToValues(COLUMNS.LESSONS, tabs.LESSONS) });
  }
  try {
    await store.backend.batchWrite(store.sheetId, updates);
  } catch (err) {
    const reason = (err && err.message) ? err.message : "unknown error";
    throw new StoreError(`Could not ${action || "save"}: ${reason}`);
  }
}

export async function saveParent(store, { parentId = null, name, surname = "", whatsapp, email = "", notes = "", defaultRateCents = 0 }) {
  if (!String(name || "").trim()) throw new ValidationError(["Enter the parent's name."]);
  const now = nowIso();
  const rows = store.parents.slice();
  if (parentId) {
    const idx = rows.findIndex((p) => asInt(p.parent_id) === asInt(parentId));
    if (idx === -1) throw new ValidationError(["That parent no longer exists."]);
    rows[idx] = Object.assign({}, rows[idx], { name, surname, whatsapp, email, notes, default_rate_cents: String(defaultRateCents), updated_at: now });
  } else {
    rows.push({
      parent_id: String(nextId(store.parents, "parent_id")), name, surname, whatsapp, email,
      notes, active: "TRUE", archived: "FALSE", default_rate_cents: String(defaultRateCents),
      created_at: now, updated_at: now,
    });
  }
  await commitTabs(store, { CLIENTS: rows }, "save the parent");
  store.parents = rows;
  return rows[rows.length - 1];
}

export async function addLearner(store, { parentId, name, surname = "", grade = "", schoolLevel = "primary", defaultRateCents = 0, learnerId = null }) {
  if (!String(name || "").trim()) throw new ValidationError(["Enter the learner's name."]);
  const now = nowIso();
  const rows = store.learners.slice();
  if (learnerId) {
    const idx = rows.findIndex((l) => asInt(l.learner_id) === asInt(learnerId));
    if (idx === -1) throw new ValidationError(["That learner no longer exists."]);
    rows[idx] = Object.assign({}, rows[idx], { name, surname, grade, school_level: schoolLevel, default_rate_cents: String(defaultRateCents), updated_at: now });
  } else {
    rows.push({
      learner_id: String(nextId(store.learners, "learner_id")), parent_id: String(parentId),
      name, surname, grade, school_level: schoolLevel, default_rate_cents: String(defaultRateCents),
      active: "TRUE", created_at: now, updated_at: now,
    });
  }
  await commitTabs(store, { LEARNERS: rows }, "save the learner");
  store.learners = rows;
  return rows[rows.length - 1];
}

/** A parent with financial history cannot be deleted (the rule, in JS). */
export function parentHasFinancialHistory(store, parentId) {
  const pid = asInt(parentId);
  return store.invoices.some((i) => asInt(i.parent_id) === pid)
    || store.lessons.some((l) => asInt(l.parent_id) === pid);
}

export async function deleteParent(store, parentId) {
  const idx = store.parents.findIndex((p) => asInt(p.parent_id) === asInt(parentId));
  if (idx === -1) throw new ValidationError(["That parent no longer exists."]);
  if (parentHasFinancialHistory(store, parentId)) {
    throw new ValidationError([
      `${store.parents[idx].name} has invoices or lessons, so cannot be deleted. ` +
      "Archive them instead.",
    ]);
  }
  const rows = store.parents.slice();
  rows.splice(idx, 1);
  await commitTabs(store, { CLIENTS: rows }, "delete the parent");
  store.parents = rows;
}

export async function removeLearner(store, learnerId) {
  const idx = store.learners.findIndex((l) => asInt(l.learner_id) === asInt(learnerId));
  if (idx === -1) throw new ValidationError(["That learner no longer exists."]);
  const rows = store.learners.slice();
  rows.splice(idx, 1);
  await commitTabs(store, { LEARNERS: rows }, "remove the learner");
  store.learners = rows;
}

/** Save a rate type (used by "+ Add a new rate" on the invoice screen). */
export async function saveRate(store, { key, label, rateCents, active = true }) {
  const rows = store.rates.slice();
  const idx = rows.findIndex((r) => r.key === key);
  const row = {
    key, label, rate_cents: String(rateCents),
    active: active ? "TRUE" : "FALSE",
    sort_order: idx === -1 ? String(rows.length + 1) : rows[idx].sort_order,
    updated_at: nowIso(),
  };
  if (idx === -1) rows.push(row); else rows[idx] = Object.assign({}, rows[idx], row);
  await commitTabs(store, { RATES: rows }, "save the rate");
  store.rates = rows;
  return row;
}

export async function setInvoiceStatus(store, invoiceId, status, { reason = "" } = {}) {
  const rows = store.invoices.slice();
  const idx = rows.findIndex((i) => asInt(i.invoice_id) === asInt(invoiceId));
  if (idx === -1) throw new ValidationError(["That invoice no longer exists."]);
  const patch = { status, updated_at: nowIso() };
  if (status === "Cancelled") { patch.cancelled_at = nowIso(); patch.cancel_reason = reason; }
  if (status === "Sent" && !rows[idx].date_sent) patch.date_sent = nowIso();
  rows[idx] = Object.assign({}, rows[idx], patch);
  await commitTabs(store, { INVOICES: rows }, "update the invoice status");
  store.invoices = rows;
  return rows[idx];
}

export async function duplicateInvoice(store, invoiceId, { invoiceDate = null } = {}) {
  const src = store.invoices.find((i) => asInt(i.invoice_id) === asInt(invoiceId));
  if (!src) throw new ValidationError(["That invoice no longer exists."]);
  const lines = (src.line_items || []).map((l) => ({
    service: l.service, description: l.description,
    rate: M.formatMoneyPlain(asInt(l.rate_cents)),
    hours: M.formatHours(asInt(l.hours_milli)),
    mode: asBool(l.is_flat) ? "flat" : "hourly",
    amount: M.formatMoneyPlain(asInt(l.amount_cents)),
  }));
  const date = invoiceDate || M.todayIso();
  const inv = await createInvoice(store, {
    parentId: asInt(src.parent_id),
    learnerId: src.learner_id === null ? null : asInt(src.learner_id),
    lines,
    invoiceDate: date,
    status: "Draft",
  });
  const rows = store.invoices.slice();
  const idx = rows.findIndex((i) => asInt(i.invoice_id) === asInt(inv.invoice_id));
  rows[idx] = Object.assign({}, rows[idx], { duplicate_of: String(asInt(invoiceId)) });
  await commitTabs(store, { INVOICES: rows }, "link the duplicate");
  store.invoices = rows;
  return rows[idx];
}

export { M, INV };
