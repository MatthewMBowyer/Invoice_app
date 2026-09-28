#!/usr/bin/env node
// PDF corpus generator (AC-28, AC-29, AC-31, AC-32, INV-03, INV-05).
//
// Renders a population of invoices through the REAL pdf-lib renderer and writes
// each produced PDF plus a manifest, so tests/inspect_corpus.py can parse every
// artefact with pypdf. Covers blank banking (ruled lines), filled banking with
// terms, a mixed flat/hourly invoice and a byte-identical re-render check for
// snapshot immutability.
//
//   node tests/pdf_corpus.mjs <outDir>

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

import { Store, MemoryBackend, DEFAULT_SETTINGS } from "../assets/js/store.js";
import * as S from "../assets/js/service.js";
import * as I from "../assets/js/invoicing.js";
import { buildInvoicePdf } from "../assets/js/pdf.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const OUT = process.argv[2] || join(REPO, "..", "..", "projects", "ctt_invoice_web", "output", "evidence", "pdf_artifacts");

function loadPdfLib() {
  const require = createRequire(import.meta.url);
  void require;
  const source = readFileSync(join(REPO, "lib", "pdf-lib.min.js"), "utf8");
  const module = { exports: {} };
  new Function("module", "exports", source)(module, module.exports);
  return module.exports;
}

const sha = (bytes) => createHash("sha256").update(Buffer.from(bytes)).digest("hex");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const PDFLib = loadPdfLib();
  const manifest = [];

  // -- Scenario 1: default settings (blank banking -> ruled lines, no terms) --
  const s1 = new Store(new MemoryBackend());
  await s1.open(); await s1.bootstrapIfEmpty();
  await S.saveParent(s1, { name: "Test Parent", whatsapp: "0821234567", email: "test@example.com" });
  await s1.reload();
  const inv1 = await S.createInvoice(s1, {
    parentId: 1,
    lines: [
      { service: "primary", mode: "hourly", rate: "240.00", hours: "4", description: "Primary School Tuition" },
      { service: "high", mode: "hourly", rate: "280.00", hours: "2", description: "High School Tuition" },
      { service: "custom", mode: "flat", amount: "350.00", description: "Once-off materials" },
    ],
    status: "Sent",
  });

  // -- Scenario 2: filled banking + terms ------------------------------------
  const s2 = new Store(new MemoryBackend());
  await s2.open(); await s2.bootstrapIfEmpty();
  await S.saveParent(s2, { name: "Tarryn Fourie", whatsapp: "+27821234567" });
  await s2.saveSettings({
    business_name: "Chloe's Travelling Tutors",
    business_address: "12 Main Road, Cape Town",
    business_phone: "021 555 0100",
    business_email: "hello@example.com",
    account_holder: "C Travelling Tutors",
    account_type: "Cheque",
    bank_name: "Example Bank",
    branch_code: "123456",
    account_number: "0123456789",
    swift_bic: "EXAMZAJJ",
    payment_terms: "Payment due on presentation.",
    terms_extra: "Thank you for your business.",
    invoice_footer: "Registered tutor.",
  });
  await s2.reload();
  const inv2 = await S.createInvoice(s2, {
    parentId: 1,
    lines: [{ service: "primary", mode: "hourly", rate: "240", hours: "6.5" }],
    status: "Draft",
  });

  // -- Scenario 3: zero-amount flat line (boundary) ---------------------------
  const inv3 = await S.createInvoice(s2, {
    parentId: 1,
    lines: [{ service: "custom", mode: "flat", amount: "0.00", description: "No charge" }],
    allowZero: true,
  });

  const scenarios = [
    { tag: "default-blank-banking", store: s1, invoice: s1.invoices.find((i) => i.number_text === inv1.number_text) },
    { tag: "filled-banking-terms", store: s2, invoice: s2.invoices.find((i) => i.number_text === inv2.number_text) },
    { tag: "zero-flat-line", store: s2, invoice: s2.invoices.find((i) => i.number_text === inv3.number_text) },
  ];

  for (const sc of scenarios) {
    const bytes = await buildInvoicePdf(sc.invoice, { PDFLib });
    const name = I.invoiceFilename(sc.invoice);
    const path = join(OUT, `${sc.tag}__${name}`);
    writeFileSync(path, Buffer.from(bytes));
    manifest.push({
      tag: sc.tag,
      path,
      filename: name,
      total_cents: Number(sc.invoice.total_cents),
      business_name: sc.invoice.snap_business_name,
      parent_name: sc.invoice.snap_parent_name,
      learner_name: sc.invoice.snap_learner_name,
      payment_terms: sc.invoice.snap_payment_terms || "",
      hash: sha(bytes),
    });
    console.log(`wrote ${path} (${bytes.length} bytes)`);
  }

  // -- Snapshot immutability: re-render after changing live settings ----------
  const before = await buildInvoicePdf(scenarios[2].invoice, { PDFLib });
  // Change the live settings that the snapshot was taken from.
  await s2.saveSettings({ account_holder: "SOMEONE ELSE", bank_name: "Another Bank", payment_terms: "Different terms now." });
  const fresh = s2.invoices.find((i) => i.number_text === inv3.number_text);
  const after = await buildInvoicePdf(fresh, { PDFLib });
  const immutable = sha(before) === sha(after);
  console.log(`snapshot immutability (byte-identical re-render): ${immutable}`);
  manifest.push({ tag: "immutability", immutable, hash_before: sha(before), hash_after: sha(after) });

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`manifest: ${join(OUT, "manifest.json")}`);
  if (!immutable) { console.log("PDF_CORPUS: FAIL"); process.exit(1); }
  console.log("PDF_CORPUS: PASS");
}

main().catch((e) => { console.error(e); process.exit(2); });
