#!/usr/bin/env node
// Regression tests for the five defects the owner reported on a live invoice:
//
//   1. "#ERROR!" printed under the parent's name on the invoice/PDF
//   2. the owner's banking details not showing on the invoice
//   3. the wording "High Tuition" on a line item
//   4. sign-in slower than it needs to be / no device memory
//   5. typed work lost when moving between invoice steps, plus the
//      un-actionable "Line 1: enter a rate" message
//
// Everything runs against the real shipped modules with the Google provider
// replaced by the in-memory double. No browser is needed.
//
//   node tests/owner_fixes.test.mjs

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { Store, MemoryBackend, cleanCell, valuesToObjects } from "../assets/js/store.js";
import * as S from "../assets/js/service.js";
import * as I from "../assets/js/invoicing.js";
import { buildInvoicePdf } from "../assets/js/pdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OUT = process.argv[2] || join(REPO, "..", "..", "projects", "ctt_invoice_web", "output", "evidence", "pdf_artifacts");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed += 1; console.log(`  ok   ${name}`); }
  else { failed += 1; console.log(`  FAIL ${name} ${detail}`); }
}
function section(title) { console.log(`\n${title}`); }

function loadPdfLib() {
  const require = createRequire(import.meta.url);
  const source = readFileSync(join(REPO, "lib", "pdf-lib.min.js"), "utf8");
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

// pypdf is the arbiter: it parses the artefact that was actually written, so a
// passing assertion cannot come from the library's own return value.
function pdfText(path) {
  return execFileSync("python3", [join(HERE, "pdf_text.py"), path], { encoding: "utf8" });
}

async function main() {
  const PDFLib = loadPdfLib();

  // -----------------------------------------------------------------------
  section("1. a Sheets error literal never reaches the invoice");
  // Google Sheets serves "#ERROR!" as the stored VALUE of a cell that was
  // written as a formula. It must be neutralised on read and on render.
  check("cleanCell blanks #ERROR!", cleanCell("#ERROR!") === "");
  check("cleanCell blanks #REF!", cleanCell("#REF!") === "");
  check("cleanCell blanks a padded literal", cleanCell(" #ERROR! ") === "");
  check("cleanCell keeps a real value", cleanCell("Example Parent") === "Example Parent");
  check("cleanCell keeps a number", cleanCell("0821234567") === "0821234567");
  check("cleanCell tolerates null/undefined", cleanCell(null) === "" && cleanCell(undefined) === "");

  const rows = valuesToObjects(
    ["parent_id", "name", "whatsapp"],
    [["parent_id", "name", "whatsapp"], ["1", "Example Parent", "#ERROR!"]],
  );
  check("valuesToObjects drops the literal from a row", rows[0].whatsapp === "", JSON.stringify(rows[0]));
  check("valuesToObjects keeps the good column", rows[0].name === "Example Parent");

  // -----------------------------------------------------------------------
  section("1b. the app no longer WRITES cells that Sheets can misread");
  const storeSrc = readFileSync(join(REPO, "assets/js/store.js"), "utf8");
  const entered = storeSrc.match(/valueInputOption["'\s:=]*["']?USER_ENTERED/g) || [];
  check("no USER_ENTERED left in store.js", entered.length === 0, `found ${entered.length}`);
  check("writes use RAW", /valueInputOption=RAW/.test(storeSrc) && /valueInputOption: "RAW"/.test(storeSrc));

  // A stored "+27..." mobile must survive a round trip verbatim.
  const s0 = new Store(new MemoryBackend());
  await s0.open(); await s0.bootstrapIfEmpty();
  await S.saveParent(s0, { name: "Example Parent", whatsapp: "+27821234567" });
  await s0.reload();
  check("a +27 number round-trips unchanged", s0.parents[0].whatsapp === "+27821234567", s0.parents[0].whatsapp);

  // -----------------------------------------------------------------------
  section("3. the line wording is the owner's rate label, not 'High Tuition'");
  const store = new Store(new MemoryBackend());
  await store.open(); await store.bootstrapIfEmpty();
  await store.reload();
  const highRate = store.rates.find((r) => r.key === "high");
  check("a 'high' rate type exists", Boolean(highRate));
  check("its label is 'High School'", highRate && highRate.label === "High School", highRate && highRate.label);
  check("serviceLabel maps high -> High School", I.serviceLabel(highRate, "high") === "High School");
  check("serviceLabel falls back readably for an unknown key", I.serviceLabel(undefined, "holiday_intensive") === "Holiday Intensive");

  await S.saveParent(store, { name: "Example Parent", whatsapp: "+27821234567" });
  await store.reload();
  // A line with NO description is exactly the case that produced "High Tuition".
  const inv = await S.createInvoice(store, {
    parentId: 1,
    lines: [{ service: "high", mode: "hourly", rate: "280", hours: "4" }],
    status: "Sent",
  });
  await store.reload();
  const stored = store.invoices.find((i) => i.number_text === inv.number_text);
  check("the stored description is the rate label", stored.line_items[0].description === "High School",
    stored.line_items[0].description);
  check("the word Tuition is not appended", !/Tuition/.test(stored.line_items[0].description));
  check("the total is still R1,120.00", Number(stored.total_cents) === 112000, String(stored.total_cents));

  mkdirSync(OUT, { recursive: true });
  const p1 = join(OUT, "ownerfix-wording.pdf");
  writeFileSync(p1, Buffer.from(await buildInvoicePdf(stored, { PDFLib, rates: store.rates })));
  const t1 = pdfText(p1);
  check("the PDF says 'High School'", t1.includes("High School"), t1.replace(/\n/g, " | "));
  check("the PDF never says 'High Tuition'", !t1.includes("High Tuition"));

  // A stored snapshot can ALREADY carry the literal from before the RAW fix, so
  // the renderer has to neutralise it too - cleaning only on the way in leaves
  // every invoice issued so far printing "#ERROR!" under the parent's name.
  const poisoned = Object.assign({}, stored, {
    snap_parent_whatsapp: "#ERROR!",
    snap_bank_name: "#REF!",
    snap_bank_account_number: "#ERROR!",
  });
  const pp = join(OUT, "ownerfix-poisoned.pdf");
  writeFileSync(pp, Buffer.from(await buildInvoicePdf(poisoned, { PDFLib, rates: store.rates })));
  const tp = pdfText(pp);
  check("a poisoned snapshot never prints #ERROR!", !tp.includes("#ERROR!"), tp.replace(/\n/g, " | "));
  check("a poisoned snapshot never prints #REF!", !tp.includes("#REF!"));
  check("the parent name still prints", tp.includes("Example Parent"));

  // An invoice whose line description was already stored as the bare key.
  const legacy = Object.assign({}, stored, {
    line_items: [Object.assign({}, stored.line_items[0], { description: "" })],
  });
  const p2 = join(OUT, "ownerfix-legacy-desc.pdf");
  writeFileSync(p2, Buffer.from(await buildInvoicePdf(legacy, { PDFLib, rates: store.rates })));
  const t2 = pdfText(p2);
  check("a legacy blank description prints 'High School' too", t2.includes("High School"), t2.replace(/\n/g, " | "));
  check("a legacy blank description never prints 'High Tuition'", !t2.includes("High Tuition"));

  // -----------------------------------------------------------------------
  section("2. banking details reach the invoice and the PDF");
  check("hasBankingDetails is false when all six are blank",
    S.hasBankingDetails({}) === false);
  check("hasBankingDetails is true with one field filled",
    S.hasBankingDetails({ bank_name: "Example Bank" }) === true);
  check("hasBankingDetails ignores whitespace", S.hasBankingDetails({ bank_name: "   " }) === false);

  await store.saveSettings({
    account_holder: "Example Holder", account_type: "Cheque",
    bank_name: "Example Bank", branch_code: "679000",
    account_number: "1234567890", swift_bic: "DISCZAJJ",
  });
  await store.reload();
  check("settings keep the bank name", store.settings.bank_name === "Example Bank");

  const blankBefore = store.invoices.find((i) => i.number_text === inv.number_text);
  check("the old invoice's banking snapshot is blank", !S.hasBankingDetails({
    account_holder: blankBefore.snap_bank_account_holder, bank_name: blankBefore.snap_bank_name,
  }));
  const repaired = await S.applyBankingToInvoice(store, blankBefore.invoice_id);
  check("applyBankingToInvoice fills the snapshot", repaired.snap_bank_name === "Example Bank",
    repaired.snap_bank_name);
  check("applyBankingToInvoice fills the account number", repaired.snap_bank_account_number === "1234567890");
  check("applyBankingToInvoice does NOT change the total", Number(repaired.total_cents) === 112000);
  check("applyBankingToInvoice does NOT change the number", repaired.number_text === blankBefore.number_text);
  check("applyBankingToInvoice does NOT change a line item",
    repaired.line_items[0].description === blankBefore.line_items[0].description);

  const p3 = join(OUT, "ownerfix-banking.pdf");
  writeFileSync(p3, Buffer.from(await buildInvoicePdf(repaired, { PDFLib, rates: store.rates })));
  const t3 = pdfText(p3);
  for (const [label, needle] of [
    ["account holder", "Example Holder"], ["account type", "Cheque"],
    ["bank", "Example Bank"], ["branch code", "679000"],
    ["account number", "1234567890"], ["swift", "DISCZAJJ"],
  ]) {
    check(`the PDF prints the ${label}`, t3.includes(needle), t3.replace(/\n/g, " | "));
  }

  // Refuses when there is nothing to copy, rather than silently blanking.
  const empty = new Store(new MemoryBackend());
  await empty.open(); await empty.bootstrapIfEmpty();
  await S.saveParent(empty, { name: "Someone", whatsapp: "0821234567" });
  await empty.reload();
  const eInv = await S.createInvoice(empty, { parentId: 1, lines: [{ service: "high", mode: "hourly", rate: "280", hours: "1" }] });
  let refused = null;
  try { await S.applyBankingToInvoice(empty, eInv.invoice_id); } catch (e) { refused = e; }
  check("applyBankingToInvoice refuses when settings are blank", Boolean(refused));

  // -----------------------------------------------------------------------
  section("2b. a blank-banking invoice is flagged before it is sent");
  const warnStore = new Store(new MemoryBackend());
  await warnStore.open(); await warnStore.bootstrapIfEmpty();
  await S.saveParent(warnStore, { name: "Example Parent", whatsapp: "0821234567" });
  await warnStore.reload();
  const v = S.validateInvoice(warnStore, {
    parentId: 1, lines: [{ service: "high", mode: "hourly", rate: "280", hours: "1" }],
  });
  check("validation warns about missing banking",
    v.warnings.some((w) => /banking details are still blank/i.test(w)), JSON.stringify(v.warnings));
  check("missing banking is a warning, not an error", v.errors.length === 0, JSON.stringify(v.errors));
  check("the warning says where to fix it", v.warnings.some((w) => /Settings/.test(w)));

  await warnStore.saveSettings({ bank_name: "Example Bank" });
  await warnStore.reload();
  const v2 = S.validateInvoice(warnStore, {
    parentId: 1, lines: [{ service: "high", mode: "hourly", rate: "280", hours: "1" }],
  });
  check("the warning goes away once banking is set", !v2.warnings.some((w) => /banking/i.test(w)),
    JSON.stringify(v2.warnings));

  // -----------------------------------------------------------------------
  section("4. sign-in is quicker and the device is remembered");
  const authSrc = readFileSync(join(REPO, "assets/js/auth.js"), "utf8");
  check("the forced consent screen is gone", !/prompt:\s*"consent"/.test(authSrc));
  check("interactive sign-in does NOT force silent-only",
    !/requestSignIn[\s\S]{0,600}?prompt:\s*""/.test(authSrc));
  check("a silent restore path exists", /trySilentSignIn/.test(authSrc));
  check("the account hint is persisted", /LAST_EMAIL_KEY/.test(authSrc) && /localStorage/.test(authSrc));
  const appSrc = readFileSync(join(REPO, "assets/js/app.js"), "utf8");
  check("boot attempts a silent restore", /trySilentSignIn/.test(appSrc));

  // -----------------------------------------------------------------------
  section("5. typed work survives moving between steps");
  const newSrc = readFileSync(join(REPO, "assets/js/screens/invoice_new.js"), "utf8");
  check("the draft is persisted", /DRAFT_KEY/.test(newSrc) && /localStorage/.test(newSrc));
  check("rows are rendered FROM the draft", /draft\.rows\.forEach/.test(newSrc));
  check("drawRows no longer clears the rows", !/function drawRows\(\)[\s\S]{0,200}rows\.length = 0/.test(newSrc));
  check("the draft is cleared only after a successful save", /clearInvoiceDraft\(\)/.test(newSrc));

  section("5b. the error message says which box to fill in");
  check("the message names the box", /type the hourly rate in the "Rate" box/.test(newSrc));
  check("the message names the row", /Line \$\{i \+ 1\}/.test(newSrc));
  check("the offending row is marked", /field-error/.test(newSrc));
  check("the offending field is focused", /\.focus\(/.test(newSrc));
  check("the step holding the problem is shown", /goTo\(2\)/.test(newSrc));
  const css = readFileSync(join(REPO, "assets/css/app.css"), "utf8");
  check("the error marker is styled", /\.line-row\.field-error/.test(css));

  console.log(`\nowner-fix checks: ${passed} passed, ${failed} failed`);
  if (failed > 0) { console.log("OWNER_FIXES: FAIL"); process.exit(1); }
  console.log("OWNER_FIXES: PASS");
}

main().catch((err) => { console.error("owner-fix tests crashed:", err); process.exit(2); });
