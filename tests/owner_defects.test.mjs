// Owner-reported defects on the live invoice, round 3:
//   1. "#ERROR!" printed under the parent's name (the WhatsApp row)
//   2. banking details blank on an invoice issued before they were saved
//   3. the payment reference should read name + YYMM
//   4. a refresh must not force a fresh Google sign-in
//
// These exercise the real code paths (no mocks of the logic under test); only
// the browser globals GIS would touch are provided as plain objects.

import assert from "node:assert/strict";

globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.sessionStorage = {
  _d: new Map(),
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
  setItem(k, v) { this._d.set(k, String(v)); },
  removeItem(k) { this._d.delete(k); },
};

const { snapshotFields, hasBankingDetails, BANKING_KEYS } = await import("../assets/js/service.js");
const { DEFAULT_SETTINGS, LEGACY_DEFAULT_REFERENCE, cleanCell } = await import("../assets/js/store.js");
const { paymentReference } = await import("../assets/js/invoicing.js");
const { Auth, clearStoredSession } = await import("../assets/js/auth.js");

let pass = 0;
const fails = [];
function check(name, fn) {
  try { fn(); pass += 1; } catch (err) { fails.push(`${name}: ${err.message}`); }
}

// ---- 1. "#ERROR!" must never reach a snapshot ------------------------------
check("error literal in the parent's number is frozen as blank", () => {
  const s = snapshotFields({ ...DEFAULT_SETTINGS }, { name: "Meghan", whatsapp: "#ERROR!" }, {});
  assert.equal(s.snap_parent_whatsapp, "");
});

check("every error literal the renderer knows is scrubbed", () => {
  for (const lit of ["#ERROR!", "#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NULL!", "#NUM!"]) {
    const s = snapshotFields({ ...DEFAULT_SETTINGS }, { name: "Meghan", whatsapp: lit }, {});
    assert.equal(s.snap_parent_whatsapp, "", `${lit} survived`);
  }
});

check("a real number is kept verbatim", () => {
  const s = snapshotFields({ ...DEFAULT_SETTINGS }, { name: "Meghan", whatsapp: "+27 (0)82 123 4567" }, {});
  assert.equal(s.snap_parent_whatsapp, "+27 (0)82 123 4567");
});

check("a poisoned banking field is not frozen onto the invoice", () => {
  const s = snapshotFields({ ...DEFAULT_SETTINGS, bank_name: "#ERROR!", account_number: "12345" }, {}, {});
  assert.equal(s.snap_bank_name, "");
  assert.equal(s.snap_bank_account_number, "12345");
});

check("a poisoned setting does not break the reference template", () => {
  const s = snapshotFields({ ...DEFAULT_SETTINGS, payment_reference_template: "#REF!" }, {}, {});
  assert.equal(s.snap_payment_reference_template, "");
});

check("cleanCell leaves an ordinary value alone", () => {
  assert.equal(cleanCell("Meghan"), "Meghan");
  assert.equal(cleanCell(""), "");
});

// ---- 2. banking details ---------------------------------------------------
check("banking is recognised as absent when all six are blank", () => {
  assert.equal(hasBankingDetails(DEFAULT_SETTINGS), false);
});

check("banking is recognised as present when any one is filled", () => {
  assert.equal(hasBankingDetails({ ...DEFAULT_SETTINGS, account_number: "123" }), true);
});

check("whitespace-only banking counts as absent", () => {
  assert.equal(hasBankingDetails({ ...DEFAULT_SETTINGS, account_number: "   " }), false);
});

check("the six banking keys are the ones the PDF prints", () => {
  assert.deepEqual(BANKING_KEYS, [
    "account_holder", "account_type", "bank_name", "branch_code", "account_number", "swift_bic",
  ]);
});

check("a saved banking detail is frozen onto the invoice", () => {
  const s = snapshotFields({ ...DEFAULT_SETTINGS, account_holder: "C T Tutors", bank_name: "FNB", account_number: "62123456789" }, {}, {});
  assert.equal(s.snap_bank_account_holder, "C T Tutors");
  assert.equal(s.snap_bank_name, "FNB");
  assert.equal(s.snap_bank_account_number, "62123456789");
});

// ---- 3. the reference is name + YYMM --------------------------------------
check("the shipped default reference is name + YYMM", () => {
  assert.equal(DEFAULT_SETTINGS.payment_reference_template, "{parent_name} {yymm}");
});

function refFor(date) {
  return paymentReference({
    snap_parent_name: "Meghan",
    snap_payment_reference_template: DEFAULT_SETTINGS.payment_reference_template,
    invoice_date: date,
    total_cents: 206000,
    currency: "ZAR",
    snap_currency_symbol: "R",
  });
}

check("the reference reads 'Meghan 2608' for August 2026", () => {
  assert.equal(refFor("2026-08-07"), "Meghan 2608");
});

check("the reference uses the invoice's own month, not today's", () => {
  assert.equal(refFor("2026-01-31"), "Meghan 2601");
  assert.equal(refFor("2026-12-01"), "Meghan 2612");
});

check("YYMM pads a single-digit year and month", () => {
  assert.equal(refFor("2005-03-09"), "Meghan 0503");
});

check("an invoice with no date still yields a reference", () => {
  const ref = refFor("");
  assert.match(ref, /^Meghan \d{4}$/);
});

check("the old default is recognised so it can be upgraded", () => {
  assert.equal(LEGACY_DEFAULT_REFERENCE, "{parent_name} - {learner_name}");
});

check("an owner-typed template is left alone", () => {
  const ref = paymentReference({
    snap_parent_name: "Meghan",
    snap_payment_reference_template: "INV {invoice_number} {yymm}",
    number_text: "42",
    invoice_date: "2026-08-07",
    total_cents: 100,
    currency: "ZAR",
  });
  assert.equal(ref, "INV 42 2608");
});

// ---- 4. a refresh keeps the session ---------------------------------------
check("a token issued in this tab survives a page reload", () => {
  clearStoredSession();
  const gis = { accounts: { oauth2: {} } };
  const a = new Auth({ gis });
  // Simulate the token response the GIS callback would deliver.
  a._handleTokenResponse({ access_token: "tok-123", expires_in: 3600 });
  // A reload constructs a brand-new Auth with the same sessionStorage.
  const b = new Auth({ gis });
  assert.equal(b.getToken(), "tok-123");
  assert.equal(b.isSignedIn(), true);
});

check("signing out clears the stored session for the next boot", () => {
  clearStoredSession();
  const gis = { accounts: { oauth2: { revoke: () => {} } } };
  const a = new Auth({ gis });
  a._handleTokenResponse({ access_token: "tok-456", expires_in: 3600 });
  assert.equal(a.isSignedIn(), true);
  a.signOut();
  const b = new Auth({ gis });
  assert.equal(b.getToken(), null);
  assert.equal(b.isSignedIn(), false);
});

check("an expired stored token is not restored", () => {
  clearStoredSession();
  globalThis.sessionStorage.setItem("ctt_invoice_session", JSON.stringify({
    token: "stale", expiresAt: Date.now() - 1000, profile: null,
  }));
  const b = new Auth({ gis: { accounts: { oauth2: {} } } });
  assert.equal(b.getToken(), null);
});

check("GIS arriving after construction is still usable", () => {
  // The bug: window.google was snapshotted at module load, so a null stayed
  // null and every silent sign-in failed. The API must be read per call.
  delete globalThis.window;
  const a = new Auth({});           // constructed with no window.google at all
  globalThis.window = { google: { accounts: { oauth2: { initTokenClient: () => ({ requestAccessToken() {} }) } } } };
  assert.doesNotThrow(() => a.init());
  delete globalThis.window;
});

console.log(`owner defects: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("FAIL " + f);
if (fails.length) process.exit(1);
console.log("OWNER_DEFECTS: PASS");
