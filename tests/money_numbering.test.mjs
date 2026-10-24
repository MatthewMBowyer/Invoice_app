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
import * as W from "../assets/js/whatsapp.js";

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
section("comma or dot both work as the decimal separator");
// The defect this guards: "," was stripped as noise, so "6,5" hours silently
// became 65 hours instead of six and a half. A South African keyboard puts ","
// on the decimal key, so both must be accepted when typing hours and amounts.
eq("hours 6,5 is six and a half", M.parseHoursToMilli("6,5"), 6500);
eq("hours 6,5 formats back as 6.5", M.formatHours(M.parseHoursToMilli("6,5")), "6.5");
eq("hours dot still works", M.parseHoursToMilli("6.5"), 6500);
eq("hours 2,25", M.parseHoursToMilli("2,25"), 2250);
eq("hours 0,5", M.parseHoursToMilli("0,5"), 500);
eq("amount 150,50", M.parseMoneyToCents("150,50"), 15050);
eq("amount 1 500,50", M.parseMoneyToCents("R1 500,50"), 150050);
eq("amount 1 234,56", M.parseMoneyToCents("1 234,56"), 123456);
eq("amount dot still works", M.parseMoneyToCents("150.50"), 15050);
eq("amount 1,234.56 still grouping", M.parseMoneyToCents("1,234.56"), 123456);
eq("amount 1,234,567.89 still grouping", M.parseMoneyToCents("1,234,567.89"), 123456789);
eq("amount 1,500 reads as fifteen hundred", M.parseMoneyToCents("1,500"), 150000);
eq("hours 1,500 reads as one and a half", M.parseHoursToMilli("1,500"), 1500);
eq("a dot is always the decimal point", M.parseMoneyToCents("1.500"), 150);
check("commas cannot double as two decimal points",
  (() => { try { M.parseMoneyToCents("1,2,3"); return false; } catch (e) { return true; } })());
check("a malformed comma group is still rejected",
  (() => { try { M.parseMoneyToCents("1,23,456.78"); return false; } catch (e) { return true; } })());
check("hours typed with a stray minus are rejected",
  (() => { try { M.parseHoursToMilli("6-5"); return false; } catch (e) { return true; } })());

// The end-to-end consequence for an invoice: 2,5 hours at R280,00 is R700,00,
// which is what the owner sees when they use commas on the real screen.
eq("2,5 hours at R280,00 is R700,00",
  M.lineAmountCents(M.parseMoneyToCents("280,00"), M.parseHoursToMilli("2,5")), 70000);

// ---------------------------------------------------------------------------
section("WhatsApp numbers normalise to a dialable 27XXXXXXXXX");
// The defect this guards: "+27 (0)82 123 4567" - the standard South African
// written form - produced 270821234567, which is not dialable, and the owner was
// told their own number was invalid. A cell holding "082 ... or 083 ..." glued
// both numbers together and dialled nobody.
const sameNumber = "27821234567";
for (const written of [
  "0821234567", "082 123 4567", "+27821234567", "27821234567", "082-123-4567",
  "0027821234567", "(082) 123 4567", "(+27) 82 123 4567", "082.123.4567",
  "+27 (0)82 123 4567", "27 (0)82 123 4567", "+27 082 123 4567",
  "0027 (0)82 123 4567", "082 123 4567 ",
]) {
  eq(`"${written}" normalises`, W.normaliseZaMobile(written), sameNumber);
  check(`"${written}" is accepted`, W.isValidZaMobile(written));
}
// Someone who writes two numbers means either is fine; pick the reachable one.
for (const written of [
  "082 123 4567 or 083 765 4321", "082 123 4567/083 765 4321",
  "0821234567 ext 21", "082 123 4567 (home)",
]) {
  eq(`"${written}" resolves to one dialable number`, W.normaliseZaMobile(written), sameNumber);
}
// A landline is a real contact detail but not a WhatsApp destination.
check("a landline is not accepted as a WhatsApp number", !W.isValidZaMobile("021 123 4567"));
eq("a landline still normalises for display", W.normaliseZaMobile("021 123 4567"), "27211234567");
// The digits are already gone in scientific notation; guessing would dial a
// stranger, so it is reported unreadable instead.
eq("scientific notation is not guessed at", W.normaliseZaMobile("8.21235E+08"), "");
check("scientific notation is rejected", !W.isValidZaMobile("8.21235E+08"));
eq("an empty number is not invented", W.normaliseZaMobile(""), "");
eq("nonsense is not invented", W.normaliseZaMobile("abc"), "");
// The normalised number is what the wa.me link actually dials.
const waPayload = W.invoiceSharePayload(
  { snap_parent_whatsapp: "+27 (0)82 123 4567", snap_parent_name: "Test Parent", number_text: "1", snap_whatsapp_template: "Hi {parent_name}" },
  { amountDisplay: "R700.00", dueDateDisplay: "1 Sep 2026" });
check("a (0) number produces a working wa.me link",
  Boolean(waPayload.url) && waPayload.url.includes("wa.me/27821234567"), String(waPayload.url));
check("no problem is reported for a valid (0) number", waPayload.problem === null, String(waPayload.problem));

// ---------------------------------------------------------------------------
section("reference-separator rule (INV-06)");
eq("blank learner stripped with separator",
  I.paymentReference({ snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Test Parent", snap_learner_name: "", number_text: "1", total_cents: 0 }),
  "Test Parent");
eq("both present kept",
  I.paymentReference({ snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Tarryn Fourie", snap_learner_name: "Learner A", number_text: "643", total_cents: 156000 }),
  "Tarryn Fourie - Learner A");
eq("no dangling separator", I.paymentReference({ snap_payment_reference_template: "{parent_name} - {learner_name}", snap_parent_name: "Solo", snap_learner_name: "", number_text: "1", total_cents: 0 }).endsWith("-"), false);

// YYMM: the invoice's own date as a two-digit year + month, so the reference a
// parent quotes back identifies the month it was billed for.
eq("yymm from the invoice date", M.formatYearMonthShort("2026-08-25"), "2608");
eq("yymm pads a single-digit month", M.formatYearMonthShort("2026-01-05"), "2601");
eq("yymm handles a century rollover", M.formatYearMonthShort("2031-12-31"), "3112");
eq("yymm is empty for an unreadable date", M.formatYearMonthShort("not-a-date"), "");
eq("reference uses yymm", I.paymentReference({ snap_payment_reference_template: "{parent_name} {yymm}", snap_parent_name: "Meghan", invoice_date: "2026-08-25", total_cents: 0 }), "Meghan 2608");
eq("yymm follows the stored invoice date, not today",
  I.paymentReference({ snap_payment_reference_template: "{yymm}", invoice_date: "2025-03-01", total_cents: 0 }), "2503");
eq("yymm composes with a name and date as the owner asked",
  I.paymentReference({ snap_payment_reference_template: "{parent_name} - {yymm}", snap_parent_name: "Meghan", invoice_date: "2026-08-25", total_cents: 0 }), "Meghan - 2608");

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
