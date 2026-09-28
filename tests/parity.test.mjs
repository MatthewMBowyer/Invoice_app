#!/usr/bin/env node
// Cross-language parity harness (AC-21, AC-22, INV-01, INV-06, INV-07).
//
// Runs the same case corpus through the browser JavaScript modules and through
// the authoritative Python implementation in projects/invoice_app, then asserts
// equality — including boundary and malformed cases. The Python side is invoked
// via tests/parity_reference.py.
//
//   node tests/parity.test.mjs

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import * as M from "../assets/js/money.js";
import * as I from "../assets/js/invoicing.js";
import * as W from "../assets/js/whatsapp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// ---------------------------------------------------------------------------
// The shared case corpus. Every value here is fed to both languages unchanged.
// ---------------------------------------------------------------------------
const corpus = {
  parse_money: [
    "R240", "240.00", 240, "1,560.00", "  R 1 560 ", "0.005", "12.345",
    "-5", "0", "", "abc", "1.2.3", ".", "-", null, "R0.005", 0.5, 2.25,
    "1560", 1560, "1,234,567.89", "  ", "+50", "50-", "1e3",
  ],
  format_money: [0, 1, 50, 100, 156000, -156000, 24000, 999999999],
  format_money_plain: [0, 100, 156000, -50, 5, 123456789],
  parse_hours: [
    "6.5", "2.25", 1, "0.5", "1.5", "0", "-1", "1.2345", "", "abc",
    "1.2.3", ".", null, "  ", 6.5, 0.005, "10", "0.001", "999999",
  ],
  format_hours: [0, 1000, 6500, 2250, 500, 12345, -6500, 1],
  line_amount: [
    [24000, 6500], [24000, 4000], [28000, 2000], [24000, 2250],
    [24000, 1000], [0, 5000], [1, 1], [33333, 3], [12345, 6789],
    [100, 5], [19999, 1001], [24000, 0],
  ],
  sanitise_symbol: ["R", "", "R$", "USD", "€", "<b>", "toolong", null, "R &", "'"],
  reference: [
    { snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Tarryn Fourie", snap_learner_name: "Learner A", number_text: "643", _total: 156000 },
    { snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Test Parent", snap_learner_name: "", number_text: "644", _total: 96000 },
    { snap_payment_reference_template: "", snap_parent_name: "Solo", snap_learner_name: "", number_text: "1", _total: 0 },
    { snap_payment_reference_template: "INV{invoice_number} {parent_name}", snap_parent_name: "Ann", snap_learner_name: "", number_text: "A7", _total: 5000 },
    { snap_payment_reference_template: "{parent_name} - {learner_name} - {amount}", snap_parent_name: "Bob", snap_learner_name: "", number_text: "9", _total: 156000 },
    { snap_payment_reference_template: "{parent_name}/{learner_name}", snap_parent_name: "X", snap_learner_name: "Y", number_text: "2", _total: 100 },
    { snap_payment_reference_template: "{parent_name} / {learner_name}", snap_parent_name: "X", snap_learner_name: "", number_text: "2", _total: 100 },
    { snap_payment_reference_template: "{unknown} {parent_name}", snap_parent_name: "Z", snap_learner_name: "", number_text: "3", _total: 0 },
  ],
  filename: [
    // These cases supply an explicit business name. The two languages fall back
    // to different brand CONSTANTS when snap_business_name is absent (the web app
    // uses the corrected double-L "Travelling"; the legacy Python app still stores
    // the single-L spelling), so the brand fallback is deliberately NOT exercised
    // here — that constant is not a behavioural rule. The fallback MECHANISM
    // itself is covered exhaustively by sanitize_component below.
    { snap_business_name: "Chloe's Travelling Tutors", number_text: "643", snap_parent_name: "Tarryn Fourie" },
    { snap_business_name: "A/B:C*D?E", number_text: "1", snap_parent_name: "  .dotted.  " },
    { snap_business_name: "Chloe's Travelling Tutors", number_text: "2", snap_parent_name: "" },
    { snap_business_name: "CON", number_text: "3", snap_parent_name: "NUL" },
    { snap_business_name: "Café Ñoño", number_text: "4", snap_parent_name: "Ünïcode" },
    { snap_business_name: "x".repeat(80), number_text: "5", snap_parent_name: "y".repeat(80) },
  ],
  sanitize_component: [
    ["Chloe's Travelling Tutors", "Business", 60],
    ["...", "Business", 60],
    ["a/b\\c:d*e?f\"g<h>i|j", "Business", 60],
    ["", "Business", 60],
    ["CON", "Business", 60],
    ["lpt9", "Business", 60],
    ["  trailing dot.  ", "Business", 60],
    ["line\nbreak", "Business", 60],
    ["Ünïcode", "Business", 60],
    ["abc", "Business", 3],
    ["...", "Business", 60],
    [null, "Business", 60],
  ],
  normalise_mobile: [
    "0821234567", "082 123 4567", "+27821234567", "27821234567", "082-123-4567",
    "0027821234567", "082 123 4567 ", "(082) 123 4567", "0211234567", "12345",
    "", "abc", "2782123456", "082123456", "0721234567", "0621234567", "0921234567",
  ],
  wa_link: [
    ["0821234567", "Hi there"],
    ["0821234567", "Line1\nLine2"],
    ["0821234567", "Emoji \u{1F60A} & more"],
    ["27821234567", "A/B test?x=1&y=2"],
    ["0821234567", "Percent % and + plus"],
  ],
  number_text: [["", 643], ["INV-", 12], ["A", 1], ["", 0], ["PRE", 999]],
  dates: ["2026-08-25", "2026-09-01", "2026-01-05", "2026-12-31", "", "bad"],
};

// ---------------------------------------------------------------------------
// JS-side computation (mirrors parity_reference.py)
// ---------------------------------------------------------------------------
function safe(fn) {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    // Only the fact that the value was rejected is compared; the wording of the
    // error differs between the languages by design.
    return { ok: false, error: e.constructor.name };
  }
}

const js = {
  parse_money: corpus.parse_money.map((v) => safe(() => M.parseMoneyToCents(v))),
  format_money: corpus.format_money.map((c) => M.formatMoney(c)),
  format_money_plain: corpus.format_money_plain.map((c) => M.formatMoneyPlain(c)),
  parse_hours: corpus.parse_hours.map((v) => safe(() => M.parseHoursToMilli(v))),
  format_hours: corpus.format_hours.map((h) => M.formatHours(h)),
  line_amount: corpus.line_amount.map(([r, h]) => M.lineAmountCents(r, h)),
  sanitise_symbol: corpus.sanitise_symbol.map((v) => M.sanitiseSymbol(v)),
  reference: corpus.reference.map((inv) => {
    const clean = Object.assign({}, inv);
    delete clean._total;
    return I.paymentReference(clean, { totalCents: inv._total });
  }),
  filename: corpus.filename.map((inv) => I.invoiceFilename(inv)),
  sanitize_component: corpus.sanitize_component.map(([v, f, ml]) => I.sanitizeFilenameComponent(v, f, ml)),
  normalise_mobile: corpus.normalise_mobile.map((v) => W.normaliseZaMobile(v)),
  valid_mobile: corpus.normalise_mobile.map((v) => W.isValidZaMobile(v)),
  wa_link: corpus.wa_link.map(([n, m]) => W.buildWaLink(n, m)),
  number_text: corpus.number_text.map(([p, n]) => I.numberText(p, n)),
  format_date_display: corpus.dates.map((v) => M.formatDateDisplay(v)),
  format_date_long: corpus.dates.map((v) => M.formatDateLong(v)),
  month_key: corpus.dates.map((v) => M.monthKey(v)),
};

// ---------------------------------------------------------------------------
// Python-side computation
// ---------------------------------------------------------------------------
const pyJson = execFileSync("python3", [join(HERE, "parity_reference.py")], {
  input: JSON.stringify(corpus),
  cwd: REPO,
  maxBuffer: 64 * 1024 * 1024,
}).toString();
const py = JSON.parse(pyJson);

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------
let checks = 0;
let failures = 0;
function stable(value) {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}
function cmp(label, jsVal, pyVal) {
  checks += 1;
  const a = stable(jsVal);
  const b = stable(pyVal);
  if (a !== b) {
    failures += 1;
    console.log(`FAIL ${label}\n  js  = ${a}\n  py  = ${b}`);
  }
}

for (const key of Object.keys(js)) {
  const len = Math.max(js[key].length, (py[key] || []).length);
  for (let i = 0; i < len; i += 1) {
    cmp(`${key}[${i}]`, js[key][i], (py[key] || [])[i]);
  }
}

console.log(`\nparity checks: ${checks}, failures: ${failures}`);
if (failures > 0) {
  console.log("PARITY: FAIL");
  process.exit(1);
}
console.log("PARITY: PASS");
