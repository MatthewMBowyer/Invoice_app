# Working notes for agents

## What this repo is

Browser-only static invoice app, live from `main` via GitHub Pages
(`https://matthewmbowyer.github.io/Invoice_app/`). The Python twin at
`/projects/conference-program/projects/invoice_app` is the behavioural
reference; any visible behaviour change must land in both, or the same invoice
prints differently depending on which app made it.

## The recurring "#ERROR!" bug

Google Sheets serves an error literal (`#ERROR!`, `#REF!`, `#DIV/0!`, `#N/A`)
as the stored **value** of a cell that was written as a live formula. A mobile
number typed as `+27...` is a formula to `USER_ENTERED`, which is where the
original poisoning came from.

There are three separate places that must clean it, and fixing one is not
enough. Cleaning only on read is what let this come back twice:

1. On **write** — `valueInputOption=RAW` in `assets/js/store.js`.
2. On **read** — `cleanCell` in `assets/js/store.js`, applied by
   `valuesToObjects`.
3. On **render** — `pdf.js`, the invoice list and the invoice detail screen.
   A snapshot stored before fix 1 still carries the literal, so render-time
   cleaning is what covers invoices already issued.

The Python twin mirrors this as `clean_cell` in `app/services/pdf.py`.
Regression tests: `tests/owner_fixes.test.mjs` (JS, section 1) and
`tests/test_pdf.py::test_pdf_never_prints_a_spreadsheet_error_literal`.

## Blank banking lines on an invoice

Banking values are snapshotted onto the invoice at creation, on purpose, so an
issued invoice is immutable. An invoice created before Settings held the banking
details therefore prints blank ruled lines forever. That is the intended
behaviour, not a defect — the repair is the owner-initiated
`applyBankingToInvoice` (button "Add my banking details" on the invoice detail
screen). Do not "fix" it by reading live settings into the PDF.

## Tests

```
node tests/money_numbering.test.mjs
node tests/owner_fixes.test.mjs
node tests/parity.test.mjs
node tests/pdf_corpus.mjs /tmp/corpus
cd ../projects/invoice_app && python -m pytest -q
```

No service worker, so a push to `main` is live after the Pages build (~60s).
