#!/usr/bin/env node
// Headless end-to-end demonstrator (AC-50, plus INV-08..INV-12).
//
// Drives the REAL application modules (auth gate, store, service, domain logic,
// PDF renderer, WhatsApp link) with the unavailable Google provider replaced by
// an in-memory TEST DOUBLE. The double lives here in the test harness only — it
// is never part of the shipped app; production always uses the Google backend.
//
//   node tests/demonstrator.mjs [outputDir]
//
// It writes a real invoice PDF so tests/pdf_inspect.py can parse the PRODUCED
// artefact with pypdf (never trusting the library's return value).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import { Auth, AuthExpiredError } from "../assets/js/auth.js";
import { Store, MemoryBackend, SPREADSHEET_TITLE } from "../assets/js/store.js";
import * as S from "../assets/js/service.js";
import * as I from "../assets/js/invoicing.js";
import * as W from "../assets/js/whatsapp.js";
import { buildInvoicePdf } from "../assets/js/pdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OUT = process.argv[2] || join(REPO, "..", "..", "projects", "ctt_invoice_web", "output", "evidence", "pdf_artifacts");

let ok = 0; let bad = 0;
function check(name, cond, detail = "") {
  if (cond) { ok += 1; console.log(`  ok   ${name}`); }
  else { bad += 1; console.log(`  FAIL ${name} ${detail}`); }
}

// A GIS test double: never used by the production app.
function makeGisDouble({ refuseSilent = false, expiresIn = 3600 } = {}) {
  return {
    accounts: {
      oauth2: {
        initTokenClient: ({ callback, error_callback }) => ({
          requestAccessToken: ({ prompt }) => {
            if (prompt === "" && refuseSilent) { error_callback && error_callback(); return; }
            callback({ access_token: "TEST-DOUBLE-TOKEN", expires_in: expiresIn });
          },
        }),
        revoke: () => { revokeCalled = true; },
      },
    },
  };
}
let revokeCalled = false;

function loadPdfLib() {
  const require = createRequire(import.meta.url);
  const vendor = join(REPO, "lib", "pdf-lib.min.js");
  const source = readFileSync(vendor, "utf8");
  // pdf-lib.min.js is a UMD bundle: evaluate it with a CommonJS-style shim so it
  // attaches to module.exports here (in the browser it attaches to window).
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

async function main() {
  console.log("== headless end-to-end demonstrator ==");

  // ---- auth gate ---------------------------------------------------------
  console.log("\n[auth gate]");
  const auth = new Auth({ gis: null });
  // With no GIS loaded and no session, there is no token -> the gate is closed.
  check("no session -> no token", auth.getToken() === null);
  check("no session -> not signed in", auth.isSignedIn() === false);
  let gateErr = null;
  try { await auth.ensureToken(); } catch (e) { gateErr = e; }
  check("no session -> ensureToken refuses (gate closed)", gateErr instanceof AuthExpiredError);
  check("no raw 401 leaks to the user", gateErr && !/401|Bearer|ya29/.test(gateErr.message));
  check("plain-language expiry message", gateErr && /sign-in expired/.test(gateErr.message));
  check("token is not enumerable on the instance", JSON.stringify(auth).indexOf("TEST-DOUBLE") === -1);

  // sign in with the test double
  const auth2 = new Auth({ gis: makeGisDouble() });
  await auth2.requestSignIn();
  check("sign-in yields a token (in memory only)", auth2.getToken() === "TEST-DOUBLE-TOKEN");
  check("token not visible in serialised state", JSON.stringify(auth2).indexOf("TEST-DOUBLE-TOKEN") === -1);
  auth2.signOut();
  check("sign-out revokes at Google", revokeCalled === true);
  check("sign-out clears the token", auth2.getToken() === null);
  check("sign-out clears the profile", auth2.getUser() === null);

  // silent refresh vs interactive expiry
  const a3 = new Auth({ gis: makeGisDouble({ refuseSilent: true, expiresIn: -1 }) });
  await a3.requestSignIn();
  check("stale token present after an expired sign-in", a3.getToken() === "TEST-DOUBLE-TOKEN");
  check("stale token is not treated as signed in", a3.isSignedIn() === false);
  let silentErr = null;
  try { await a3.ensureToken(); } catch (e) { silentErr = e; }
  check("silent refresh refused -> plain-language expiry error", silentErr instanceof AuthExpiredError && /sign-in expired/.test(silentErr.message));

  // ---- first run creates own spreadsheet ---------------------------------
  console.log("\n[first run -> own Drive spreadsheet]");
  const backend = new MemoryBackend();
  const store = new Store(backend);
  const id = await store.open();
  check("created a spreadsheet in the user's own Drive", backend.store.has(id));
  check("spreadsheet has the expected title", backend.store.get(id).name === SPREADSHEET_TITLE);
  await store.bootstrapIfEmpty();
  const tabs = await backend.readRaw(id);
  for (const t of ["SETTINGS", "CLIENTS", "LEARNERS", "LESSONS", "RATES", "INVOICES", "INVOICE_LINES"]) {
    check(`tab present: ${t}`, Array.isArray(tabs[t]));
  }

  // ---- create a mixed hourly + flat invoice ------------------------------
  console.log("\n[create a mixed hourly + flat invoice]");
  await S.saveParent(store, { name: "Test Parent", whatsapp: "0821234567", email: "test@example.com" });
  await S.addLearner(store, { parentId: 1, name: "Learner", surname: "One", grade: "Grade 4", schoolLevel: "primary", defaultRateCents: 24000 });
  await store.reload();

  const lines = [
    { service: "primary", mode: "hourly", rate: "240", hours: "4", description: "Primary School Tuition" },
    { service: "high", mode: "hourly", rate: "280", hours: "2", description: "High School Tuition" },
    { service: "custom", mode: "flat", amount: "350.00", description: "Once-off materials" },
  ];
  const invoice = await S.createInvoice(store, { parentId: 1, learnerId: 1, lines, status: "Sent" });
  check("invoice number is 1", invoice.number_text === "1", invoice.number_text);
  check("mixed total = 960 + 560 + 350 = R1,870.00", Number(invoice.total_cents) === 187000, String(invoice.total_cents));
  check("settings next number advanced to 2", store.settings.next_invoice_number === "2");

  // ---- save + reload + numbering -----------------------------------------
  console.log("\n[save, reload, numbering increment]");
  await store.reload();
  check("invoice persisted after reload", store.invoices.length === 1);
  check("reloaded total is R1,870.00", store.invoices[0].total_cents === 187000);
  check("reloaded number_text is 1", store.invoices[0].number_text === "1");
  check("reloaded next number is 2", store.settings.next_invoice_number === "2");
  check("line items persisted", store.invoices[0].line_items.length === 3);
  const second = await S.createInvoice(store, { parentId: 1, lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "1" }] });
  check("second invoice number is 2 (incremented)", second.number_text === "2");

  // ---- two-identity isolation --------------------------------------------
  console.log("\n[data isolation: two identities]");
  const storeA = new Store(new MemoryBackend());
  const storeB = new Store(new MemoryBackend());
  await storeA.open(); await storeA.bootstrapIfEmpty();
  await storeB.open(); await storeB.bootstrapIfEmpty();
  await S.saveParent(storeA, { name: "Alice", whatsapp: "0821234567" });
  await storeA.reload();
  check("identity A sees its own data", storeA.parents.length === 1);
  check("identity B sees none of A's data", storeB.parents.length === 0);
  check("the two identities use separate drives", storeA.backend !== storeB.backend
    && storeA.backend.store.size === 1 && storeB.backend.store.size === 1);
  check("identity B's drive holds no copy of A's data",
    JSON.stringify([...storeB.backend.tables.values()]).indexOf("Alice") === -1);

  // ---- snapshot immutability ---------------------------------------------
  console.log("\n[snapshot immutability]");
  await store.reload();
  const target = store.invoices.find((i) => i.number_text === "1");
  const refBefore = I.paymentReference(target);
  await S.saveRate(store, { key: "primary", label: "Primary School", rateCents: 99900 });
  await store.reload();
  const after = store.invoices.find((i) => i.number_text === "1");
  check("existing invoice total unchanged after rate edit", after.total_cents === 187000);
  check("existing invoice reference unchanged", I.paymentReference(after) === refBefore);

  // ---- duplicate + cancel ------------------------------------------------
  console.log("\n[duplicate and soft cancel]");
  const dup = await S.duplicateInvoice(store, target.invoice_id);
  check("duplicate gets a fresh number", dup.number_text !== "1");
  check("duplicate is today's date", dup.invoice_date === new Date().toISOString().slice(0, 10));
  check("duplicate is Draft", dup.status === "Draft");
  await S.setInvoiceStatus(store, dup.invoice_id, "Cancelled", { reason: "test" });
  await store.reload();
  const cancelled = store.invoices.find((i) => i.invoice_id === dup.invoice_id);
  check("cancel is soft (record kept)", Boolean(cancelled));
  check("cancelled record keeps its number", cancelled.number_text === dup.number_text);

  // ---- PDF from the stored snapshot --------------------------------------
  console.log("\n[PDF generation from the snapshot]");
  const PDFLib = loadPdfLib();
  const pdfInvoices = [store.invoices.find((i) => i.number_text === "1")];
  const pdfBytes = await buildInvoicePdf(pdfInvoices[0], { PDFLib });
  check("PDF bytes produced", pdfBytes && pdfBytes.length > 1000, `len=${pdfBytes && pdfBytes.length}`);
  const filename = I.invoiceFilename(pdfInvoices[0]);
  check("filename follows the spec pattern", /^Chloes_Travelling_Tutors_Invoice_1_Test_Parent\.pdf$/.test(filename), filename);
  mkdirSync(OUT, { recursive: true });
  const outPath = join(OUT, filename);
  writeFileSync(outPath, Buffer.from(pdfBytes));
  console.log(`  wrote ${outPath}`);

  // ---- WhatsApp link -----------------------------------------------------
  console.log("\n[WhatsApp share link]");
  const share = W.invoiceSharePayload(pdfInvoices[0], {
    amountDisplay: I.formatMoney(Number(pdfInvoices[0].total_cents)),
    dueDateDisplay: I.formatDateDisplay(pdfInvoices[0].due_date),
  });
  check("wa.me URL built with normalised number", share.url && share.url.startsWith("https://wa.me/27821234567?text="), share.url && share.url.slice(0, 40));
  check("no server-side send claimed", share.server_side_send === false && share.delivery_claimed === false);
  check("message is percent-encoded (no raw space)", !share.url.split("?text=")[1].includes(" "));

  // ---- failed-write honesty ----------------------------------------------
  console.log("\n[failed-write honesty]");
  const beforeNum = store.settings.next_invoice_number;
  store.backend.failNextWrite("Drive write failed.");
  let wErr = null;
  try {
    await S.createInvoice(store, { parentId: 1, lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "2" }] });
  } catch (e) { wErr = e; }
  check("failed write reported plainly", wErr && /Could not save the invoice/.test(wErr.message), wErr && wErr.message);
  check("failed write did not advance the number", store.settings.next_invoice_number === beforeNum);

  console.log(`\ndemonstrator checks: ${ok} passed, ${bad} failed`);
  if (bad > 0) { console.log("DEMONSTRATOR: FAIL"); process.exit(1); }
  console.log("DEMONSTRATOR: PASS");
  console.log(`PDF_ARTIFACT: ${outPath}`);
}

main().catch((err) => { console.error("demonstrator crashed:", err); process.exit(2); });
