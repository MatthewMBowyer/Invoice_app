# Screen map — CTT invoice app (web edition)

Every screen the shipped app actually serves, the route that serves it, what is
on it, and how it maps to the reference Python app's `docs/SCREEN_MAP.md`. All
routes except the sign-in gate are behind Google sign-in.

The app is one HTML page; screens are hash routes on that page. "Route" below is
the URL hash.

## 1. Route table

| # | Screen | Route | What is on it | Reference screen |
|---|---|---|---|---|
| 1 | Sign-in gate | (no route; shown until a session exists) | logo, "Invoices on the go", **Sign in with Google**, privacy line. **No data.** | Login (`/login`) — replaced (see §3) |
| 2 | Dashboard (home) | `#/dashboard` | **Create Invoice** as the FIRST element, then the six figures (invoices this month, invoiced this month, total paid, outstanding invoices, total outstanding, month label), then quick links | Dashboard (`/`) |
| 3 | Parents / Clients | `#/parents` | search (parent name, learner name, phone), Active/All/Archived filter, Add parent, per-row Open/Edit/Add learner/Delete | Parents (`/parents`) |
| 4 | Parent detail | `#/parents` → Open (inline panel) | contact details, learners (with per-learner Edit/Remove), lessons, invoices | Parent detail (`/parents/{id}`) |
| 5 | Add / edit parent | `#/parents` → Add parent / Edit (dialog) | name, surname, WhatsApp, email, notes, active | New/edit parent (`/parents/new`) |
| 6 | Add / edit learner | `#/parents` → Add learner / Edit (dialog) | name, surname, grade (free text), school level (Primary/High School), default rate | Add learner (`/parents/{id}/learners/new`) |
| 7 | **New Invoice** | `#/create` | three steps: (1) Who is it for? (2) Rate and hours (3) Dates | New Invoice (`/invoices/new`) |
| 8 | Invoice history | `#/invoices` | five filters (parent, learner, number, month, status) + list | Invoice history (`/invoices`) |
| 9 | Invoice detail | `#/invoices` → tap a row (inline panel) | status actions (Draft/Sent/Paid/Cancelled), Duplicate, soft Cancel (confirmed), Download PDF, WhatsApp block | Invoice detail (`/invoices/{id}`) |
| 10 | Rates | `#/rates` | editable rate types (label + hourly price + active), Add rate type | Rates (`/rates`) |
| 11 | Settings | `#/settings` | Business, Banking, Invoicing, Appearance, WhatsApp, plus Export CSV | Settings (`/settings`) |
| 12 | Backup / restore | `#/backup` | Export JSON backup, Restore from a JSON file | Backup/restore (`/backup`) |

## 2. Navigation model

A bottom-anchored bar with five destinations — **Create**, **Parents**,
**Invoices**, **Rates**, **Settings** — because the primary device is an iPhone
held one-handed. Deeper screens (invoice detail, parent detail) open as an inline
panel with a **Back** button and do not rely on browser chrome. Dashboard and
Backup are reached from the header/quick links. No screen needs more than one
scroll to reach its primary action, and no screen uses accounting jargon.

## 3. Screens deliberately not built

Recorded rather than silently omitted (full reasoning in
`docs/DELIVERY_SUMMARY.md` §7):

| Reference screen | Not built | Reason |
|---|---|---|
| Uninvoiced lessons (`/invoices/new/lessons`) | yes | Owner types hours directly on the invoice; auto-billing stored lessons is an OWNER DECISION, not a requirement. |
| Google connect / sync (`/settings/google/connect`) | yes | Sign-in **is** the connection; there is no server to hold a credential. |
| Health check (`/healthz`) | yes | No server process exists. |
| Local login / logout (`/login`, `/logout`) | replaced | Replaced by the Google sign-in gate and the Sign out button. |
| Reports / analytics | yes | The dashboard figures cover the need. |
| Payment gateway | yes | The request states none is required initially. |
| PDF template editor, Sheets column-mapping editor | yes | Layout and tab schema are fixed and version-controlled in code. |

## 4. Feature parity mapping (request §5 → new screen)

| §5 item | New screen | Reference screen it replaces |
|---|---|---|
| Dashboard figures + Create Invoice first | `#/dashboard` | Dashboard (`/`) |
| Parents list/search/filter + detail | `#/parents` | Parents (`/parents`), Parent detail (`/parents/{id}`) |
| Parent with history not deletable | `#/parents` (refuses plainly) | schema `ON DELETE RESTRICT` |
| Learner fields | `#/parents` learner dialog | Add learner (`/parents/{id}/learners/new`) |
| Rates editable + defaults | `#/rates`, `#/create` step 2 | Rates (`/rates`) |
| New Invoice three steps | `#/create` | New Invoice (`/invoices/new`) |
| Hourly + flat mix, "flat", per-row names | `#/create` | New Invoice (`/invoices/new`) |
| History filters + detail actions | `#/invoices` | Invoice history/detail (`/invoices`, `/invoices/{id}`) |
| WhatsApp share | `#/invoices` detail | WhatsApp link (`/invoices/{id}/whatsapp`) |
| Settings fields | `#/settings` | Settings (`/settings`) |
| Empty payment terms rule | `#/create` step 3 + PDF | New Invoice + PDF |
| Export CSV | `#/settings` | Export CSV (`/export/invoices.csv`) |
| Backup / restore | `#/backup` | Backup/restore (`/backup`) |
