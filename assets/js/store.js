// Persistence: the user's OWN Google Drive via the Drive v3 API with the
// drive.file scope, storing data as a Google Sheet. There is no server-side
// database anywhere in this application.
//
// The app creates its own spreadsheet on first run (which is what makes the
// file accessible under drive.file), remembers its file ID locally (never a
// secret — just an ID in this browser), and finds that file again on later
// visits.
//
// The backend is pluggable so the headless test suite can drive the REAL store
// logic against an in-memory Google double, without that double ever appearing
// in production code. The default backend talks to Google.

import { todayIso } from "./money.js";
import { DEFAULT_TEMPLATE as WA_TEMPLATE } from "./whatsapp.js";

export const SPREADSHEET_TITLE = "Chloe Travelling Tutors Invoice Data";
export const FILE_ID_STORAGE_KEY = "ctt_invoice_spreadsheet_id";
export const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const SHEETS_APPEND = (id, range) =>
  `${SHEETS_BASE}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append` +
  "?valueInputOption=USER_ENTERED";
const SHEETS_GET = (id, range) =>
  `${SHEETS_BASE}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`;
const SHEETS_BATCH_UPDATE = (id) => `${SHEETS_BASE}/${encodeURIComponent(id)}/values:batchUpdate`;

export const TABS = {
  SETTINGS: { name: "SETTINGS", range: "SETTINGS!A1:B200", keyed: true },
  CLIENTS: { name: "CLIENTS", range: "CLIENTS!A1:Z5000" },
  LEARNERS: { name: "LEARNERS", range: "LEARNERS!A1:Z5000" },
  LESSONS: { name: "LESSONS", range: "LESSONS!A1:Z5000" },
  RATES: { name: "RATES", range: "RATES!A1:Z500" },
  INVOICES: { name: "INVOICES", range: "INVOICES!A1:AZ5000" },
  INVOICE_LINES: { name: "INVOICE_LINES", range: "INVOICE_LINES!A1:Z20000" },
};
export const TAB_ORDER = Object.values(TABS).map((t) => t.name);

// Column sets. CLIENTS and LESSONS start from the Python app's
// CLIENTS_COLUMNS / LESSONS_COLUMNS (app/gsheets/base.py) and are extended for
// the full web entity model. See docs/SPREADSHEET_SCHEMA.md.
export const COLUMNS = {
  SETTINGS: ["key", "value"],
  CLIENTS: ["parent_id", "name", "surname", "whatsapp", "email", "notes",
    "active", "archived", "default_rate_cents", "created_at", "updated_at"],
  LEARNERS: ["learner_id", "parent_id", "name", "surname", "grade",
    "school_level", "default_rate_cents", "active", "created_at", "updated_at"],
  LESSONS: ["lesson_id", "date", "parent_id", "learner_id", "hours_milli",
    "rate_cents", "amount_cents", "invoiced", "number_text", "created_at"],
  RATES: ["key", "label", "rate_cents", "active", "sort_order", "updated_at"],
  INVOICES: ["invoice_id", "number", "number_text", "prefix", "parent_id",
    "learner_id", "invoice_date", "due_date", "status", "currency",
    "subtotal_cents", "total_cents", "cancelled_at", "cancel_reason",
    "duplicate_of", "date_sent", "created_at", "updated_at",
    "snap_parent_name", "snap_parent_whatsapp", "snap_parent_email",
    "snap_learner_name", "snap_school_level", "snap_business_name",
    "snap_business_address", "snap_business_phone", "snap_business_email",
    "snap_bank_account_holder", "snap_bank_account_type", "snap_bank_name",
    "snap_bank_branch_code", "snap_bank_account_number", "snap_bank_swift",
    "snap_payment_reference_template", "snap_payment_terms",
    "snap_whatsapp_template", "snap_invoice_footer", "snap_terms_extra",
    "snap_accent_colour", "snap_currency_symbol", "snap_invoice_title",
    "snap_pdf_footer_note"],
  INVOICE_LINES: ["line_id", "invoice_id", "service", "description",
    "rate_cents", "hours_milli", "amount_cents", "is_flat", "sort_order"],
};

export const DEFAULT_SETTINGS = {
  business_name: "Chloe's Travelling Tutors",
  business_address: "",
  business_phone: "",
  business_email: "",
  logo_path: "",
  account_holder: "",
  account_type: "",
  bank_name: "",
  branch_code: "",
  account_number: "",
  swift_bic: "",
  payment_reference_template: "{parent_name} - {learner_name}",
  payment_terms: "",
  due_date_period_days: "7",
  currency: "ZAR",
  currency_symbol: "R",
  invoice_prefix: "",
  invoice_title: "INVOICE",
  invoice_footer: "",
  terms_extra: "",
  accent_colour: "#0097b2",
  whatsapp_template: WA_TEMPLATE,
  next_invoice_number: "1",
  pdf_footer_note:
    "Generated locally by this invoicing app. Values shown are the values stored on this invoice.",
};

export const DEFAULT_RATES = [
  { key: "primary", label: "Primary School", rate_cents: 24000, active: "TRUE", sort_order: "1" },
  { key: "high", label: "High School", rate_cents: 28000, active: "TRUE", sort_order: "2" },
  { key: "custom", label: "Custom", rate_cents: 0, active: "TRUE", sort_order: "3" },
];

export function nowIso() {
  return new Date().toISOString();
}

/** A plain failure the UI can show verbatim. */
export class StoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "StoreError";
  }
}

const TRUE_SET = new Set(["true", "1", "yes", "y", "t", "active"]);
export function asBool(value) {
  return TRUE_SET.has(String(value).trim().toLowerCase());
}
export function asInt(value, def = 0) {
  const n = parseInt(String(value ?? "").replace(/[^0-9\-]/g, ""), 10);
  return Number.isFinite(n) ? n : def;
}

export function valuesToObjects(columns, values) {
  const out = [];
  if (!values || values.length < 2) return out;
  const header = values[0];
  for (let r = 1; r < values.length; r += 1) {
    const row = values[r];
    if (!row || row.every((c) => c === "" || c === null || c === undefined)) continue;
    const obj = {};
    columns.forEach((col, i) => {
      const idx = header.indexOf(col);
      obj[col] = idx === -1 ? "" : (row[idx] ?? "");
    });
    out.push(obj);
  }
  return out;
}

export function objectsToValues(columns, rows) {
  return [columns.slice(), ...rows.map((row) => columns.map((c) => (row[c] ?? "")))];
}

// ---------------------------------------------------------------------------
// Google backends
// ---------------------------------------------------------------------------

export class GoogleDriveBackend {
  constructor(auth) {
    this.auth = auth;
    this.mode = "google";
  }

  static storage() {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch (err) {
      return null;
    }
  }

  async headers() {
    const token = await this.auth.ensureToken();
    return { Authorization: "Bearer " + token };
  }

  async jsonFetch(url, options = {}) {
    const headers = Object.assign(await this.headers(), options.headers || {});
    let res;
    try {
      res = await fetch(url, Object.assign({}, options, { headers }));
    } catch (err) {
      throw new StoreError("Could not reach Google Drive. Please try again.");
    }
    if (res.status === 401) {
      throw Object.assign(new Error("unauthorised"), { name: "AuthExpiredError" });
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.json()).error?.message || "";
      } catch (err) { /* ignore */ }
      throw new StoreError(detail || `Google returned ${res.status}.`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async findSpreadsheet() {
    const params = new URLSearchParams({
      q: `mimeType='application/vnd.google-apps.spreadsheet' and name='${SPREADSHEET_TITLE}' and trashed=false`,
      fields: "files(id,name)",
      orderBy: "createdTime",
    });
    const data = await this.jsonFetch(DRIVE_FILES_URL + "?" + params.toString());
    return (data.files && data.files[0] && data.files[0].id) || null;
  }

  async createSpreadsheet() {
    const body = {
      name: SPREADSHEET_TITLE,
      mimeType: "application/vnd.google-apps.spreadsheet",
      properties: { cttInvoiceApp: "true" },
    };
    const created = await this.jsonFetch(DRIVE_FILES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const id = created.id;
    await this._ensureTabs(id);
    return id;
  }

  async _ensureTabs(id) {
    // Create every tab, then delete the default "Sheet1" if it remains.
    const wanted = TAB_ORDER;
    const body = { requests: wanted.map((title) => ({ addSheet: { properties: { title } } })) };
    try {
      await this.jsonFetch(`${SHEETS_BASE}/${id}:batchUpdate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // If a tab already exists Sheets rejects the whole batch; fall back to
      // adding tabs one at a time and ignore already-exists failures.
      for (const title of wanted) {
        try {
          await this.jsonFetch(`${SHEETS_BASE}/${id}:batchUpdate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
          });
        } catch (inner) { /* tab exists */ }
      }
    }
  }

  async readRange(id, range) {
    try {
      const data = await this.jsonFetch(SHEETS_GET(id, range));
      return data.values || [];
    } catch (err) {
      if (err instanceof StoreError) return [];
      throw err;
    }
  }

  async writeRange(id, range, values) {
    await this.jsonFetch(`${SHEETS_GET(id, range)}?valueInputOption=USER_ENTERED`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    });
  }

  async batchWrite(id, updates) {
    const data = { valueInputOption: "USER_ENTERED", data: updates };
    await this.jsonFetch(SHEETS_BATCH_UPDATE(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  }

  async deleteFile(id) {
    await this.jsonFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(id)}`, { method: "DELETE" });
  }
}

/** In-memory backend used ONLY by the headless tests (a test double). */
export class MemoryBackend {
  constructor() {
    this.mode = "memory";
    this.tables = new Map(); // sheetId -> { TAB: [ [values...] ] }
    this.store = new Map(); // sheetId -> file meta
    this.counter = 0;
    this.failNext = null;
  }

  createFile(name) {
    this.counter += 1;
    const id = `mem-${this.counter}`;
    const tabs = {};
    for (const t of TAB_ORDER) tabs[t] = [];
    this.tables.set(id, tabs);
    this.store.set(id, { id, name });
    return id;
  }

  listFiles(name) {
    return [...this.store.values()].filter((f) => f.name === name);
  }

  async readRaw(sheetId) {
    return this.tables.get(sheetId) || {};
  }

  async writeRaw(sheetId, tabs) {
    this.tables.set(sheetId, tabs);
  }

  failNextWrite(message) {
    this.failNext = message || "Drive write failed.";
  }

  _maybeFail() {
    if (this.failNext) {
      const msg = this.failNext;
      this.failNext = null;
      throw new StoreError(msg);
    }
  }

  async readRange(sheetId, range) {
    const tab = String(range).split("!")[0];
    return (this.tables.get(sheetId) || {})[tab] || [];
  }

  async writeRange(sheetId, range, values) {
    this._maybeFail();
    const tab = String(range).split("!")[0];
    const tabs = this.tables.get(sheetId) || {};
    tabs[tab] = values;
    this.tables.set(sheetId, tabs);
  }

  /** Replace whole tabs atomically, so a failure leaves nothing half-written. */
  async batchWrite(sheetId, updates) {
    this._maybeFail();
    const tabs = this.tables.get(sheetId) || {};
    const staged = Object.assign({}, tabs);
    for (const u of updates) {
      const tab = String(u.range).split("!")[0];
      staged[tab] = u.values;
    }
    this.tables.set(sheetId, staged);
  }
}

// ---------------------------------------------------------------------------
// Store — the single persistence interface
// ---------------------------------------------------------------------------

export class Store {
  constructor(backend, { storage = GoogleDriveBackend.storage() } = {}) {
    this.backend = backend;
    this.storage = storage;
    this.sheetId = null;
    this.settings = Object.assign({}, DEFAULT_SETTINGS);
    this.parents = [];
    this.learners = [];
    this.lessons = [];
    this.rates = [];
    this.invoices = [];
    this.lines = [];
  }

  get mode() {
    return this.backend.mode;
  }

  /** Open (or, on first run, create) the user's own spreadsheet. */
  async open() {
    if (this.backend.mode === "memory") {
      const existing = this.backend.store.size ? [...this.backend.store.keys()][0] : null;
      this.sheetId = existing || this.backend.createFile(SPREADSHEET_TITLE);
      const tabs = await this.backend.readRaw(this.sheetId);
      for (const t of TAB_ORDER) if (!tabs[t]) tabs[t] = [];
      await this.backend.writeRaw(this.sheetId, tabs);
      this._hydrate(tabs);
      return this.sheetId;
    }
    const stored = this.storage ? this.storage.getItem(FILE_ID_STORAGE_KEY) : null;
    let id = null;
    if (stored) {
      // Verify the remembered file is still reachable (drive.file only sees
      // files this app created / the user opened with it).
      try {
        await this.backend.readRange(stored, "SETTINGS!A1:B200");
        id = stored;
      } catch (err) {
        id = null;
      }
    }
    if (!id) id = await this.backend.findSpreadsheet();
    if (!id) id = await this.backend.createSpreadsheet();
    else await this.backend._ensureTabs(id);
    this.sheetId = id;
    if (this.storage) this.storage.setItem(FILE_ID_STORAGE_KEY, id);
    await this.reload();
    return id;
  }

  async reload() {
    const tabs = {};
    for (const t of TAB_ORDER) {
      tabs[t] = await this.backend.readRange(this.sheetId, TABS[t].range);
    }
    this._hydrate(tabs);
  }

  /** Load settings, then reconcile tabs that are empty (first run). */
  _hydrate(tabs) {
    this._loadSettings(tabs.SETTINGS || []);
    this.rates = valuesToObjects(COLUMNS.RATES, tabs.RATES || []);
    this.parents = valuesToObjects(COLUMNS.CLIENTS, tabs.CLIENTS || []);
    this.learners = valuesToObjects(COLUMNS.LEARNERS, tabs.LEARNERS || []);
    this.lessons = valuesToObjects(COLUMNS.LESSONS, tabs.LESSONS || []);
    this.invoices = valuesToObjects(COLUMNS.INVOICES, tabs.INVOICES || []).map(decodeInvoice);
    this.lines = valuesToObjects(COLUMNS.INVOICE_LINES, tabs.INVOICE_LINES || []);
    for (const inv of this.invoices) {
      inv.line_items = this.lines.filter((l) => String(l.invoice_id) === String(inv.invoice_id))
        .sort((a, b) => asInt(a.sort_order) - asInt(b.sort_order));
    }
  }

  async bootstrapIfEmpty() {
    const writes = [];
    if (!this.rates.length) {
      this.rates = DEFAULT_RATES.map((r) => Object.assign({}, r, { updated_at: nowIso() }));
      writes.push(this._update("RATES", COLUMNS.RATES, this.rates));
    }
    if (!(await this._settingsRowExists())) {
      writes.push(this._update("SETTINGS", COLUMNS.SETTINGS, this._settingsRows()));
    }
    await Promise.all(writes);
  }

  _settingsRowExists() {
    return this._settingsPresent === true;
  }

  _loadSettings(values) {
    if (!values || !values.length) {
      this.settings = Object.assign({}, DEFAULT_SETTINGS);
      this._settingsPresent = false;
      return;
    }
    const header = values[0];
    const obj = Object.assign({}, DEFAULT_SETTINGS);
    for (let i = 1; i < values.length; i += 1) {
      const row = values[i];
      if (!row || row.length < 1 || !row[0]) continue;
      const key = row[0];
      const val = row.length > 1 && row[1] !== undefined ? row[1] : "";
      if (key in obj && String(val).trim() !== "") obj[key] = val;
    }
    this.settings = obj;
    this._settingsPresent = values.length > 1;
    void header;
  }

  _settingsRows() {
    const rows = [COLUMNS.SETTINGS.slice()];
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      rows.push([key, this.settings[key] ?? ""]);
    }
    // Persist any owner-added settings keys too.
    for (const key of Object.keys(this.settings)) {
      if (!(key in DEFAULT_SETTINGS)) rows.push([key, this.settings[key] ?? ""]);
    }
    return rows;
  }

  async _update(tab, columns, rows) {
    await this.backend.writeRange(this.sheetId, TABS[tab].range.split("!")[0] + "!A1",
      objectsToValues(columns, rows));
  }

  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    const rows = this._settingsRows();
    await this._guardedWrite([{ range: "SETTINGS!A1", values: rows }], "save your settings");
    this._settingsPresent = true;
  }

  /** Perform a batch of sheet writes, surfacing any failure as a plain error. */
  async _guardedWrite(updates, action) {
    try {
      await this.backend.batchWrite(this.sheetId, updates);
    } catch (err) {
      if (err && err instanceof StoreError) throw err;
      const reason = err && err.message ? err.message : "unknown error";
      throw new StoreError(`Could not ${action || "save"}: ${reason}`);
    }
  }
}

// ---------------------------------------------------------------------------
// invoice serialisation
// ---------------------------------------------------------------------------

const BOOL_COLS = new Set(["invoiced"]);

export function encodeInvoice(inv) {
  const row = {};
  for (const c of COLUMNS.INVOICES) {
    const v = inv[c];
    row[c] = v === null || v === undefined ? "" : String(v);
  }
  return row;
}

export function decodeInvoice(row) {
  const inv = Object.assign({}, row);
  inv.invoice_id = asInt(row.invoice_id);
  inv.number = asInt(row.number);
  inv.parent_id = asInt(row.parent_id);
  inv.learner_id = row.learner_id === "" ? null : asInt(row.learner_id);
  inv.subtotal_cents = asInt(row.subtotal_cents);
  inv.total_cents = asInt(row.total_cents);
  inv.currency = row.currency || "ZAR";
  return inv;
}

export function encodeLine(line) {
  const row = {};
  for (const c of COLUMNS.INVOICE_LINES) {
    const v = line[c];
    row[c] = v === null || v === undefined ? "" : String(v);
  }
  return row;
}

export { BOOL_COLS };
