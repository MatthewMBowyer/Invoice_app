# Chloe's Travelling Tutors — invoice app (web edition)

A browser-only tutoring invoice app. Everything runs in the browser; the data is
stored in the signed-in user's own **Google Drive as a Google Sheet**. There is
no server, no database and no secret in the repository.

Live app: **https://matthewmbowyer.github.io/Invoice_app/**

Behaviour is a faithful re-implementation of the finished Python app in
`projects/invoice_app` (308 tests), which remains the authoritative behavioural
specification. Money rounding, invoice numbering, the flat-vs-hourly split, the
payment-reference rule and the empty-payment-terms rule all match it, and a
cross-language harness proves it.

---

## What is in here

```
index.html                 the single page; every asset path is relative
assets/css/app.css         CTT brand stylesheet (mobile-first, iPhone-primary)
assets/js/app.js           the shell: sign-in gate, router, bottom navigation
assets/js/auth.js          Google Identity Services token flow (no client secret)
assets/js/store.js         Drive v3 + Sheets v4 store, plus an offline test backend
assets/js/service.js       all reads/writes: parents, learners, rates, invoices
assets/js/invoicing.js     money-free domain logic: totals, numbering, snapshots
assets/js/money.js         ZAR integer-cent money and hours arithmetic
assets/js/whatsapp.js      South African number normalisation and the wa.me link
assets/js/pdf.js           the invoice PDF, rendered with pdf-lib
assets/js/screens/         one module per screen
assets/img/                the real CTT logo
lib/pdf-lib.min.js         vendored client-side PDF library (no build step)
docs/                      spreadsheet schema, checklists, owner verification
tests/                     the deterministic checks and the demonstrator
.github/workflows/pages.yml  publishes Pages on push to main
```

## Running it locally for development

The app uses ES modules and `fetch`-style APIs, so it must be served over HTTP
(it will not work opened as a `file://` path). There is no build step and no
package to install.

```bash
cd deploy_repos/ctt_invoice_web
python3 -m http.server 8080
```

Then open **http://localhost:8080/**. To exercise the GitHub Pages subdirectory
case (where a root-absolute path would 404), serve it under a prefix instead:

```bash
python3 -m http.server 8080 --directory .
# and open http://localhost:8080/  (root) — the tests/browser_check.py script
# additionally serves it under /Invoice_app/ to prove the subdirectory case.
```

Google sign-in only works from an origin registered in Google Cloud Console
(see `SETUP_GOOGLE.md`). `http://localhost:8080` is registered there for local
development.

## Google sign-in

Sign-in uses **Google Identity Services**, the browser token flow
(`google.accounts.oauth2`). It needs **no client secret** and **no backend** —
that is the whole reason it was chosen for a static site. The requested scopes
are exactly:

```
openid email profile
https://www.googleapis.com/auth/drive.file
```

`drive.file` is non-sensitive: the app can only see the files it creates or the
user explicitly opens with it. No broader Drive or Sheets scope is requested.
Setup instructions for the owner are in `SETUP_GOOGLE.md`.

## Where the data lives

On first run the app creates **its own spreadsheet** in the signed-in user's
Drive and remembers the file ID (in `localStorage` — an id, never a token or a
secret). Later visits find that same file. Every tab, column and rule is
documented in `docs/SPREADSHEET_SCHEMA.md`.

## Tests

All checks are deterministic and run from the repository root.

```bash
node tests/money_numbering.test.mjs      # money + invoice numbering (headless)
node tests/parity.test.mjs               # JS vs the Python reference, case corpus
node tests/demonstrator.mjs              # end-to-end, Google stubbed as a test double
node tests/pdf_corpus.mjs                # renders the PDF population
python3 tests/inspect_corpus.py <evidence_dir>/pdf_artifacts   # parses them with pypdf
python3 tests/static_checks.py . <project_dir> <evidence_dir>  # no-secret, paths, brand
python3 tests/browser_check.py . <evidence_dir>                # subdirectory + viewports
```

`tests/parity_reference.py` is the Python side of the cross-language harness: it
imports the reference app's real modules and emits a case corpus for
`tests/parity.test.mjs` to compare against.

## Reporting honestly

The delivery summary `docs/DELIVERY_SUMMARY.md` states exactly what works, what
the browser cannot do, and what remains a manual owner step. Nothing in it claims
a capability the platform does not have.

## Licence / ownership

Private to Chloe's Travelling Tutors. The repository is public so that GitHub
Pages can serve it; the code is visible, and that is intended. No secret is in
it, by design.
