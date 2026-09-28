# Delivery summary — CTT invoice app, web edition

This is the internal delivery record for the project "CTT INVOICE APP — WEB
EDITION". It maps every request item to what was built, states the PDF library
decision, lists the final spreadsheet columns, records the honesty notes, and
raises the points that need an owner decision. It is deliberately plain about
what a browser can and cannot do.

Delivered at: **https://matthewmbowyer.github.io/Invoice_app/** (repository
`MatthewMBowyer/Invoice_app`, branch `main`, served from the **repository root**).

---

## 1. What was delivered

A single, browser-only web application — no server, no database, no build step,
no secret. It re-implements the behaviour of the finished Python app
(`projects/invoice_app`) while storing each user's data in that user's own Google
Drive as a Google Sheet.

| Deliverable | Where | Notes |
|---|---|---|
| The app | `index.html`, `assets/`, `lib/` | ES modules, all asset paths **relative** |
| Pages workflow | `.github/workflows/pages.yml` | publishes on push to `main` |
| Owner guides | `README.md`, `SETUP_GOOGLE.md`, `FOR_CHLOE.md` | plain language, no code for Chloe |
| Schema | `docs/SPREADSHEET_SCHEMA.md` | final tabs and every column |
| Checklists | `docs/MANUAL_TEST_CHECKLIST.md`, `docs/OWNER_LIVE_VERIFICATION.md` | manual flow + the live Google proof |
| Screen map | `docs/SCREEN_MAP.md` | new routes mapped to the reference screen map |
| Tests | `tests/` | money/numbering, parity, demonstrator, PDF, static, browser |
| Evidence | CMi workspace `output/evidence/` | transcripts, parsed PDFs, screenshots |

## 2. Hosting and Pages (request §2, §8)

- **Static only.** GitHub Pages serves the files as-is. There is no runtime, no
  cron, no background job, and no serverless function anywhere in the tree.
- **Publishing requires the owner's GitHub write credential.** The app is built
  and committed locally to `main` as one ordinary commit, but the build
  environment's token has no `Contents: write`, so the repository
  `MatthewMBowyer/Invoice_app` is still **empty** and the site is **not yet
  live**. The exact, no-Git-needed publishing steps (upload the folder, or
  `git push`, then enable Pages) are in **`docs/PUBLISH.md`**. The public URL
  `https://matthewmbowyer.github.io/Invoice_app/` becomes reachable after that
  step; before it, it returns 404.
- **Served from the repository root.** `index.html` sits at the root and the
  workflow uploads the repository root (`path: .`) with
  `actions/upload-pages-artifact@v3`, deployed by `actions/deploy-pages@v4`.
  Because the site lives at `.../Invoice_app/` and not at a domain root, **every**
  asset path is relative; a root-absolute path would 404. A probe serves the tree
  under a `/Invoice_app/` prefix and confirms every referenced asset returns
  HTTP 200.
- **The repository setting this depends on:** in the repository, **Settings →
  Pages → Build and deployment → Source** must be set to **"GitHub Actions"**
  (not "Deploy from a branch"). That is the *same* setting the workflow assumes;
  it is configured once by the owner and is not code.
- **No secret.** The workflow needs no secret; Pages uses the short-lived OIDC
  token (`id-token: write`). `permissions` is scoped to `contents: read`,
  `pages: write`, `id-token: write`.

## 3. Authentication (request §3)

- **Google Identity Services, browser token flow** (`google.accounts.oauth2`).
  Chosen because it needs **no client secret** and **no backend** — the only
  design a public static site can ship safely.
- Scopes are exactly `openid email profile https://www.googleapis.com/auth/drive.file`
  and nothing more. `drive.file` is non-sensitive: the app can only see the files
  it creates or that the user opens with it. No `.../auth/drive`, no
  `.../auth/spreadsheets`.
- **Sign-in is the gate.** No session → chrome and a "Sign in with Google" button,
  and no data, because data is only fetched after a token exists.
- **Sign-out is real** (`google.accounts.oauth2.revoke`) and clears all in-memory
  state.
- **Expiry** is handled silently where possible and, when interaction is needed,
  with the plain words "Your Google sign-in expired. Tap to sign in again." — a
  raw 401 is never shown.
- **No token** is ever put in the DOM, a URL, a log or an error message; the token
  lives only in a module-private `WeakMap` and is used solely as an
  `Authorization` header.
- The Client ID is the only credential-like string, and it is public by design.

## 4. Where the data lives (request §4)

- On first run the app **creates its own spreadsheet** in the signed-in user's
  Drive (Drive v3, `drive.file`) and remembers the file **ID** in `localStorage`
  (an id, never a token). Later visits find that same file.
- The spreadsheet holds the full entity model as tabs (see §6).
- **Numbering** is stored in the SETTINGS tab as `next_invoice_number` and
  incremented on save. A read-modify-write is fine because this is single-user,
  but a save never reuses or skips a number, a duplicate is detected and refused
  with a plain message, and a **failed** write does not advance the number.
- **Export CSV** of invoices and **export/restore JSON** (full backup) exist; the
  JSON backup kept in the same Drive folder is the honest answer to "what if the
  sheet is damaged".
- All money is ZAR and matches the Python rounding and formatting exactly (proven
  by a cross-language harness). A failed write is never silent: the user is told
  the invoice was **not** saved and their typing stays on screen.

## 5. PDF library decision (request §2)

**Chosen: `pdf-lib`**, vendored at `lib/pdf-lib.min.js` (UMD build) and loaded
with a plain relative `<script>` before the app module.

Why `pdf-lib` rather than `jsPDF` + `jspdf-autotable`:

- **Exact control of a fixed layout.** The invoice is a specified document, not a
  data dump. We position each drawn string explicitly, so the business block,
  BILL TO block, line items, totals, banking block (with blank ruled lines for
  unfilled fields), payment reference and footer land exactly where
  `docs/PDF_GENERATION.md` requires. No auto-table engine deciding spacing.
- **No build step.** The UMD file is committed and loaded as-is; there is no
  bundler and no private key, matching the no-build constraint.
- **Deterministic output.** Given the stored snapshot and fixed document dates,
  re-rendering produces byte-identical output, which is what makes the
  snapshot-immutability check meaningful.

It needs no server and no headless Chrome: the PDF is assembled **in the
browser** and downloaded as a file named like the Python app's output
(`Chloes_Travelling_Tutors_Invoice_<n>_<Parent>.pdf`).

The generated PDFs are verified by **inspecting the produced artefact** with
`pypdf` — A4 mediabox, every required label present, and the amount in the text
equal to the invoice's stored total — never by trusting the library's return
value.

## 6. Final spreadsheet columns (request §4, §5)

Seven tabs. `CLIENTS` and `LESSONS` start from the Python app's `CLIENTS_COLUMNS`
and `LESSONS_COLUMNS` and are extended for the full model. Full commentary is in
`docs/SPREADSHEET_SCHEMA.md`; the column sets are:

- **SETTINGS** — `key, value` (business, banking, invoicing defaults, appearance,
  WhatsApp template, `next_invoice_number`).
- **CLIENTS** — `parent_id, name, surname, whatsapp, email, notes, active,
  archived, default_rate_cents, created_at, updated_at`.
- **LEARNERS** — `learner_id, parent_id, name, surname, grade, school_level,
  default_rate_cents, active, created_at, updated_at`.
- **LESSONS** — `lesson_id, date, parent_id, learner_id, hours_milli, rate_cents,
  amount_cents, invoiced, number_text, created_at`.
- **RATES** — `key, label, rate_cents, active, sort_order, updated_at`.
- **INVOICES** — identity, dates, status and totals, plus a `snap_*` block
  capturing the parent, learner, business, banking, wording and symbols **as they
  were when the invoice was made**.
- **INVOICE_LINES** — `line_id, invoice_id, service, description, rate_cents,
  hours_milli, amount_cents, is_flat, sort_order`.

The `snap_*` columns are the mechanism behind snapshot immutability: an existing
invoice renders from its own stored snapshot, so changing a rate later cannot
change a document that was already issued.

## 7. Feature parity — every section-5 item (request §5)

Each item either **works** in the new build (with the new screen named) or is
**dropped with a reason**. New screens/routes are also mapped in
`docs/SCREEN_MAP.md` against the reference `SCREEN_MAP.md`.

| § | Feature | Status | New screen / route | Reference screen |
|---|---|---|---|---|
| 5.1 | Dashboard: figures + big Create Invoice first | **Works** | `#/dashboard` | Dashboard (`/`) |
| 5.2 | Parents: search + Active/All/Archived, add/edit, add learner, per-learner edit/remove, detail | **Works** | `#/parents` | Parents (`/parents`), Parent detail (`/parents/{id}`) |
| 5.2 | Parent with financial history not deletable (rule, not mechanism) | **Works** | `#/parents` (refuses with a plain message) | (schema `ON DELETE RESTRICT`) |
| 5.3 | Learner: name, surname, grade (free text), school level, default rate | **Works** | `#/parents` learner form | Add learner (`/parents/{id}/learners/new`) |
| 5.4 | Rates: editable types, Primary R240 / High R280 defaults, add-from-invoice saved | **Works** | `#/rates`, `#/create` step 2 | Rates (`/rates`) |
| 5.5 | New Invoice: three steps, type-ahead, new-parent saves with invoice, optional child, "+ Add a new rate", hours or flat, live totals, "+ Add another rate" | **Works** | `#/create` | New Invoice (`/invoices/new`) |
| 5.6 | Hourly + flat mix on one invoice; flat shows "flat"; per-row controls named after the row | **Works** | `#/create` | New Invoice (`/invoices/new`) |
| 5.7 | Invoice history: five filters + detail with status actions, duplicate, soft cancel, PDF, WhatsApp link | **Works** | `#/invoices` | Invoice history/detail (`/invoices`, `/invoices/{id}`) |
| 5.8 | WhatsApp: real wa.me URL, message text, copy button | **Works** | `#/invoices` detail | WhatsApp link (`/invoices/{id}/whatsapp`) |
| 5.9 | Settings: all listed fields, `{parent_name}`/`{learner_name}` placeholders with empty-separator stripping | **Works** | `#/settings`, `#/rates` | Settings (`/settings`) |
| 5.10 | Empty payment terms → no terms row, no due-date hint | **Works** | `#/create` step 3, `#/settings` | New Invoice + PDF |
| 5.11 | Export CSV of invoices | **Works** | `#/settings` | Export CSV (`/export/invoices.csv`) |
| 5.12 | Backup/restore JSON (and keeping it in the Drive folder) | **Works** | `#/backup` | Backup/restore (`/backup`) |

**Dropped, with reasons (recorded rather than silently omitted):**

| Reference screen | Dropped | Reason |
|---|---|---|
| Uninvoiced-lessons shortcut (`/invoices/new/lessons`) | **Dropped** | The reference screen turns stored *lessons* into invoice lines. The web model keeps a LESSONS tab and records lessons, but the owner's real flow is to type hours on the invoice, and there is no requirement that lessons be auto-billed. The closest thing that works is the manual three-step invoice screen. If auto-billing stored lessons is wanted, it is a small extension and an **OWNER DECISION** (§9). |
| Google connect / sync screen (`/settings/google/connect`) | **Dropped** | The reference screen is credential-gated and reports a *disabled* state — there is no server to hold a Google credential. In the web build the sign-in *is* the connection, so a separate connect screen has nothing to do. |
| Health check (`/healthz`) | **Dropped** | There is no server process to be alive; GitHub Pages serves static files. |
| Login/logout routes (`/login`, `/logout`) | **Replaced** | Replaced by the Google sign-in gate and the Sign out button; there is no local password to collect. |
| Reports/analytics screen | **Dropped** | The dashboard figures cover the stated need; a separate reports screen is a non-goal. |
| Payment gateway | **Dropped** | The request states no payment gateway is required initially. |
| PDF template editor / Sheets column-mapping editor | **Dropped** | The layout and tab schema are fixed and version-controlled in code. |

## 8. Definition of done — status of each item (request §9)

| DoD item | Status | How it is proven |
|---|---|---|
| A stranger can sign in and create an invoice in their own Drive; sees no one else's data | **HUMAN_DEPENDENT** | Procedure in `docs/OWNER_LIVE_VERIFICATION.md`; **not claimed as done** until a human runs it. |
| A second visitor's data is invisible | **Works** (code) / live per above | Headless demonstrator, two identities: "identity B sees none of A's data". |
| Hourly + flat mix with correct totals | **Works** | Demonstrator + UI harness: R960 + R560 + flat = R1,870.00. |
| PDF downloads with the required content | **Works** | Produced PDFs parsed with pypdf: A4, every field, total equals stored total. |
| Numbering never duplicates and never silently skips | **Works** | Demonstrator: increment, reload, duplicate gets a fresh number, failed write does not advance. |
| Blank terms → no terms row and no hint | **Works** | PDF inspection (no terms row) + UI harness (no hint on due-date field). |
| No secret anywhere in the public repo | **Works** | Deterministic secret scan over the shipped tree: 0 findings; only the public Client ID is present. |
| Works on an iPhone-sized viewport, no horizontal scroll | **Works** | Headless measurement at 390/414/768/1280: `scrollWidth <= clientWidth`; screenshots captured. |
| The owner can hand Chloe a single URL | **Works** | One URL; `FOR_CHLOE.md` needs no code, git or GitHub. |

## 9. OWNER DECISION points

These are choices we made a defensible default for; the owner may want to change
one.

1. **Auto-billing stored lessons.** The web build does not turn the LESSONS tab
   into invoice lines automatically (the reference's uninvoiced-lessons screen is
   dropped, §7). If Chloe wants to tick stored lessons and have them become
   invoice lines, that is a small addition. **Default: not built.**
2. **Pages source setting.** The owner must set **Settings → Pages → Source =
   "GitHub Actions"** once, so the workflow's deployment is used. **Default: the
   workflow assumes it.**
3. **The live Google proof.** Item 1 of the definition of done needs a real Google
   account and interactive consent. Someone must run
   `docs/OWNER_LIVE_VERIFICATION.md` and report. **Default: unproven until run.**
4. **Client ID / OAuth consent screen.** The app is usable by any Google account,
   but until the OAuth consent screen is published (not "Testing"), Google may
   show an "unverified app" warning to non-test users. Publishing the consent
   screen is an owner action in Google Cloud Console. **Default: whatever the
   console is currently set to.**
5. **Brand spelling.** The app now uses the brand spelling **"Travelling"**
   (double L) everywhere it is user-visible — the page title, the header brand,
   the default business name, the spreadsheet title, the PDF filename and every
   guide — matching the contract's `brand_spelling` and the website brand. The
   generated PDF filename is therefore
   `Chloes_Travelling_Tutors_Invoice_<n>_<Parent>.pdf`. If the owner ever wants
   the single-L spelling back, it is a mechanical search-and-replace plus the
   static check. **Default: "Travelling".**

## 10. Honesty notes — what a browser cannot do (request §10)

- **No background sending, no delivery confirmation, no email, no scheduled
  tasks.** A static site runs only while the page is open. WhatsApp share produces
  a `wa.me` link the user taps; the app **does not send anything** and **cannot
  confirm delivery**, and the screen says so.
- **No server-side anything.** No database, no cron, no webhook, no proxy. All
  logic runs in the browser and all persistence is a call to Google's APIs with
  the user's own token.
- **No cross-device sharing without sign-in.** Data is behind Google sign-in by
  design; there is no public or shared store.
- **The PDF is generated in the browser** (pdf-lib), not by reportlab and not by a
  headless-Chrome service.
- **Verification honesty:** the automated evidence proves the *code paths* with
  Google replaced by an in-memory test double. It does **not** prove a live Google
  session. That is stated here and in the ledger, and the live item is marked
  HUMAN_DEPENDENT rather than PASS.
