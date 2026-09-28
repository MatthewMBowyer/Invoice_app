#!/usr/bin/env node
// The required headless automated test of the money and numbering logic
// (AC-48), plus adversarial boundary cases (INV-01, INV-02, INV-04, INV-05,
// INV-06, INV-07, INV-10). Runs against the real app modules with an in-memory
// Google test double — no browser needed.
//
//   node tests/money_numbering.test.mjs

import { Store, MemoryBackend } from "../assets/js/store.js";
import * as S from "../assets/js/service.js";
import * as M from "../assets/js/money.js";
import * as I from "../assets/js/invoicing.js";

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name} ${detail}`);
  }
}
function eq(name, got, want) {
  check(name, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

function section(title) { console.log(`\n${title}`); }

// ---------------------------------------------------------------------------
section("money: exact integer-cent arithmetic and ZAR formatting");
eq("R1,560.00 from 156000 cents", M.formatMoney(156000), "R1,560.00");
eq("never bare 1560", M.formatMoney(156000).includes(","), true);
eq("primary 240 x 6.5 = 156000 (R1,560.00)", M.lineAmountCents(24000, 6500), 156000);
eq("example 240x4 + 280x2 total", M.lineAmountCents(24000, 4000) + M.lineAmountCents(28000, 2000), 152000);
eq("half-up at .xx5 boundary", M.parseMoneyToCents("0.005"), 0);
eq("parse 1,234,567.89", M.parseMoneyToCents("1,234,567.89"), 123456789);
eq("parse R240", M.parseMoneyToCents("R240"), 24000);
eq("hours 2.25", M.parseHoursToMilli("2.25"), 2250);
eq("format hours 6500 -> 6.5", M.formatHours(6500), "6.5");
eq("format hours 1000 -> 1", M.formatHours(1000), "1");
eq("line amount rounds half-up (1 cent x 0.5h = 0.5c -> 1c)", M.lineAmountCents(1, 500), 1);
eq("very large value", M.formatMoney(999999999), "R9,999,999.99");
let threw = false;
try { M.parseMoneyToCents("abc"); } catch (e) { threw = e instanceof M.MoneyError; }
check("malformed money rejected", threw);
threw = false;
try { M.parseHoursToMilli("1.2.3"); } catch (e) { threw = true; }
check("malformed hours rejected", threw);

// ---------------------------------------------------------------------------
section("reference-separator rule (INV-06)");
eq("blank learner stripped with separator",
  I.paymentReference({ snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Test Parent", snap_learner_name: "", number_text: "1", total_cents: 0 }),
  "Test Parent");
eq("both present kept",
  I.paymentReference({ snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Tarryn Fourie", snap_learner_name: "Learner A", number_text: "643", total_cents: 156000 }),
  "Tarryn Fourie - Learner A");
eq("no dangling separator", I.paymentReference({ snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Solo", snap_learner_name: "", number_text: "1", total_cents: 0 }).endsWith("-"), false);

// ---------------------------------------------------------------------------
section("filenames (AC-30)");
eq("spec pattern",
  I.invoiceFilename({ snap_business_name: "Chloe's Travelling Tutors", number_text: "643", snap_parent_name: "Tarryn Fourie" }),
  "Chloes_Travelling_Tutors_Invoice_643_Tarryn_Fourie.pdf");
eq("windows reserved guarded", I.sanitizeFilenameComponent("CON", "B"), "CON_file");
eq("trailing dot stripped", I.sanitizeFilenameComponent("...", "B"), "B");

// ---------------------------------------------------------------------------
section("numbering monotonicity and safety (INV-02, AC-20)");

const store = new Store(new MemoryBackend());
await store.open();
await store.bootstrapIfEmpty();
await S.saveParent(store, { name: "Test Parent", whatsapp: "0821234567" });
await store.reload();
eq("fresh next number", store.settings.next_invoice_number, "1");

const inv1 = await S.createInvoice(store, { parentId: 1, lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "4" }] });
eq("first invoice number", inv1.number_text, "1");
eq("next number advanced once", store.settings.next_invoice_number, "2");

await store.reload();
eq("reload persists next number", store.settings.next_invoice_number, "2");
const inv2 = await S.createInvoice(store, { parentId: 1, lines: [{ service: "high", mode: "hourly", rate: "280", hours: "2" }] });
eq("second invoice is 2", inv2.number_text, "2");

// duplicate refused
let dupErr = null;
try {
  await S.createInvoice(store, { parentId: 1, manualNumber: 1, manualPrefix: "", lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "1" }] });
} catch (e) { dupErr = e; }
check("duplicate manual number refused", dupErr && dupErr.messages.join(" ").includes("has already been used"));

// failed save does not increment
const before = store.settings.next_invoice_number;
store.backend.failNextWrite("Drive write failed.");
let failErr = null;
try {
  await S.createInvoice(store, { parentId: 1, lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "3" }] });
} catch (e) { failErr = e; }
check("failed write surfaces plain error", failErr && /Could not save the invoice/.test(failErr.message) && !/Bearer|token|ya29/.test(failErr.message));
eq("failed write does not advance number", store.settings.next_invoice_number, before);

// cancelled invoice burns its number
await store.reload();
const inv3 = await S.createInvoice(store, { parentId: 1, lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "1" }] });
const num3 = inv3.number_text;
await S.setInvoiceStatus(store, inv3.invoice_id, "Cancelled", { reason: "test" });
await store.reload();
let reuseErr = null;
try {
  await S.createInvoice(store, { parentId: 1, manualNumber: num3, manualPrefix: "", lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "1" }] });
} catch (e) { reuseErr = e; }
check("cancelled invoice number cannot be reused", reuseErr !== null);
const inv4 = await S.createInvoice(store, { parentId: 1, lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "1" }] });
eq("next number after cancel is distinct", inv4.number_text !== num3, true);

// ---------------------------------------------------------------------------
section("mixed flat + hourly totals (INV-04, INV-07)");
await store.reload();
const mixed = await S.createInvoice(store, {
  parentId: 1,
  lines: [
    { service: "primary", mode: "hourly", rate: "240", hours: "4" },
    { service: "high", mode: "hourly", rate: "280", hours: "2" },
    { service: "custom", mode: "flat", amount: "500.00" },
  ],
});
eq("mixed total 960+560+500", mixed.total_cents, 202000);
eq("flat line prints flat", I.isFlatLine({ mode: "flat", amount: "500" }), true);
await store.reload();
const stored = store.invoices.find((i) => i.number_text === mixed.number_text);
eq("stored line amount = rate x hours", Number(stored.line_items[0].amount_cents), 96000);
eq("subtotal equals total", stored.subtotal_cents, stored.total_cents);

// snapshot immutability
const refBefore = I.paymentReference(stored);
await S.saveRate(store, { key: "primary", label: "Primary School", rateCents: 99900 });
await store.reload();
const storedAgain = store.invoices.find((i) => i.number_text === mixed.number_text);
eq("snapshot survives rate change", I.paymentReference(storedAgain), refBefore);
eq("snapshot total unchanged after rate change", storedAgain.total_cents, 202000);

// ---------------------------------------------------------------------------
section("empty-terms rule (INV-05)");
const s = store.settings;
eq("default payment terms empty", s.payment_terms, "");
check("no hardcoded 'Payment due within 7 days' default",
  !String(s.payment_terms).includes("Payment due within 7 days"));

// ---------------------------------------------------------------------------
console.log(`\nmoney/numbering checks: ${passed} passed, ${failed} failed`);
if (failed > 0) { console.log("MONEY_NUMBERING: FAIL"); process.exit(1); }
console.log("MONEY_NUMBERING: PASS");
