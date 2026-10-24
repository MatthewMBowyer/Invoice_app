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
const pending = [];
function check(name, fn) {
  try {
    const out = fn();
    // An async case must be awaited, or its rejection would go unhandled and the
    // check would pass without ever running its assertions.
    if (out && typeof out.then === "function") {
      pending.push(out.then(() => { pass += 1; }, (err) => { fails.push(`${name}: ${err.message}`); }));
      return;
    }
    pass += 1;
  } catch (err) { fails.push(`${name}: ${err.message}`); }
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

// ---- 5. the share sheet must not spend the tap's activation ----------------
// navigator.share only opens while the tap is still "active". Awaiting the PDF
// build inside the handler spends that activation, which is exactly the reported
// "Could not open the share sheet". So the share path must hand share() bytes it
// already holds, with no await before the call.

const ui = await import("../assets/js/ui.js");

check("the share failure message names the working alternative", () => {
  const blocked = ui.shareFailureMessage(Object.assign(new Error("x"), { name: "NotAllowedError" }));
  assert.match(blocked, /Download PDF/);
  const unsupported = ui.shareFailureMessage(Object.assign(new Error("x"), { name: "NotSupportedError" }));
  assert.match(unsupported, /Download PDF/);
  const other = ui.shareFailureMessage(new Error("boom"));
  assert.match(other, /boom/);
  assert.match(other, /Download PDF/);
});

check("shareFile passes the real bytes to navigator.share", async () => {
  let seen = null;
  globalThis.File = class { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } };
  // Node exposes navigator as a getter, so it has to be redefined, not assigned.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { share: async (payload) => { seen = payload; }, canShare: () => true },
  });
  await ui.shareFile(new Uint8Array([1, 2, 3]), "inv.pdf", "application/pdf", { title: "t", text: "m" });
  assert.equal(seen.files.length, 1);
  assert.equal(seen.files[0].name, "inv.pdf");
  assert.equal(seen.title, "t");
});

// ---- 6. every wait must be visible ----------------------------------------
// The reported confusion: a slow PDF looked identical to a broken one. Work in
// flight is counted centrally, so the bar is driven by real requests.
// beginWork touches the DOM only to show the bar, so a minimal stub is enough
// and the counter under test is the real one.
const barClasses = new Set();
let barHidden = "true";
let barNode = null;
function stubBar() {
  const node = {
    className: "", dataset: {}, style: {}, children: [],
    classList: { add: (c) => barClasses.add(c), remove: (c) => barClasses.delete(c),
      contains: (c) => barClasses.has(c) },
    setAttribute: (k, v) => { if (k === "aria-hidden") barHidden = v; },
    appendChild() {}, set textContent(v) { this._t = v; }, get textContent() { return this._t; },
  };
  return node;
}
globalThis.document = {
  getElementById: (id) => (id === "global-progress" ? barNode : null),
  createElement: () => stubBar(),
  body: { appendChild: (n) => { barNode = n; }, classList: { add() {}, remove() {} } },
};
check("beginWork/endWork track overlapping work", () => {
  barNode = null;
  barClasses.clear();
  assert.equal(ui.isWorking(), false);
  ui.beginWork();
  assert.equal(ui.isWorking(), true);
  assert.ok(barClasses.has("is-active"), "the bar is active while work is in flight");
  ui.beginWork();
  assert.equal(ui.isWorking(), true);
  ui.endWork();
  assert.equal(ui.isWorking(), true, "one request still in flight");
  assert.ok(barClasses.has("is-active"), "the bar stays active while work remains");
  ui.endWork();
  assert.equal(ui.isWorking(), false);
  assert.equal(barHidden, "true", "the bar is hidden once the last request lands");
  assert.ok(!barClasses.has("is-active"), "the bar stops animating when the work ends");
});

check("a stray endWork cannot drive the counter negative", () => {
  ui.endWork();
  ui.endWork();
  assert.equal(ui.isWorking(), false);
  ui.beginWork();
  assert.equal(ui.isWorking(), true);
  ui.endWork();
});

check("the source renders the PDF before the share button is tapped", async () => {
  // Guards the ordering, which is what actually fixes the share sheet: if the
  // build ever moves back inside the tap, activation is spent again.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../assets/js/screens/invoices.js", import.meta.url), "utf8"));
  const prefetch = src.indexOf("const bytesReady = pdfBytes();");
  const shareCall = src.indexOf("shareFile(cachedBytes");
  assert.ok(prefetch > -1, "the invoice detail must start rendering on open");
  assert.ok(shareCall > -1, "the share button must use already-rendered bytes");
  assert.ok(prefetch < shareCall, "the render must start before the share handler");
  // And the share handler must not await anything before calling share().
  const handler = src.slice(src.indexOf("onClick: () => {"), shareCall);
  assert.ok(!/await/.test(handler), "no await may precede share(), or activation is spent");
});

await Promise.all(pending);
console.log(`owner defects: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log("FAIL " + f);
if (fails.length) process.exit(1);
console.log("OWNER_DEFECTS: PASS");
