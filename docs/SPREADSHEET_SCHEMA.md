# Spreadsheet schema — the final Google Sheets tab set

The web app stores everything in **one spreadsheet that it creates in the
signed-in user's own Drive** (Drive v3, `drive.file` scope). Nothing is stored on
a server. This document is the authoritative list of tabs and columns.

It starts from the Python app's Google-Sheets column sets
(`app/gsheets/base.py`, `CLIENTS_COLUMNS` and `LESSONS_COLUMNS`) and extends them
where the browser model needs it: the Python app kept a learner inside the
CLIENTS row, whereas the web model splits learners into their own tab, and it adds
settings, rates, invoices and invoice lines.

| Python `CLIENTS_COLUMNS` | Where it lives here |
| --- | --- |
| `Parent ID` | `CLIENTS.parent_id` |
| `Parent Name` | `CLIENTS.name` + `CLIENTS.surname` |
| `WhatsApp Number` | `CLIENTS.whatsapp` |
| `Email` | `CLIENTS.email` |
| `Learner Name` | `LEARNERS.name` + `LEARNERS.surname` |
| `Grade` | `LEARNERS.grade` |
| `School Level` | `LEARNERS.school_level` |
| `Default Rate` | `CLIENTS.default_rate_cents` and `LEARNERS.default_rate_cents` |
| `Active` | `CLIENTS.active` / `LEARNERS.active` (+ `archived`) |

| Python `LESSONS_COLUMNS` | Where it lives here |
| --- | --- |
| `Date` | `LESSONS.date` |
| `Parent` | `LESSONS.parent_id` (name is resolved from CLIENTS) |
| `Learner` | `LESSONS.learner_id` |
| `Duration / Hours` | `LESSONS.hours_milli` |
| `Rate` | `LESSONS.rate_cents` |
| `Amount` | `LESSONS.amount_cents` |
| `Invoiced` | `LESSONS.invoiced` |
| `Invoice Number` | `LESSONS.number_text` |

All money columns hold **integer cents**. All hour columns hold **thousandths of
an hour** (`hours_milli`), so a quarter hour is `250`. Dates are ISO `YYYY-MM-DD`.
Booleans are the strings `TRUE` / `FALSE`. This is deliberate: a sheet cell
should not silently lose money to a float.

---

## 1. `SETTINGS` — key/value configuration

Two columns: `key`, `value`. One row per setting. This is the tab that holds the
next invoice number.

| key | meaning | default |
| --- | --- | --- |
| `business_name` | printed business name | `Chloe's Travelling Tutors` |
| `business_address` | printed address | empty |
| `business_phone` | printed phone | empty |
| `business_email` | printed email | empty |
| `logo_path` | relative path or URL to a logo | empty (bundled CTT logo is used) |
| `account_holder` | banking: account holder | empty |
| `account_type` | banking: account type | empty |
| `bank_name` | banking: bank | empty |
| `branch_code` | banking: branch code | empty |
| `account_number` | banking: account number | empty |
| `swift_bic` | banking: SWIFT / BIC | empty |
| `payment_reference_template` | reference template, `{parent_name}`, `{learner_name}` | `{parent_name} - {learner_name}` |
| `payment_terms` | terms wording; blank means no terms row at all | empty |
| `due_date_period_days` | days from invoice date to due date | `7` |
| `currency` | currency code | `ZAR` |
| `currency_symbol` | printed symbol | `R` |
| `invoice_prefix` | optional prefix for numbers | empty |
| `invoice_title` | printed title | `INVOICE` |
| `invoice_footer` | printed footer | empty |
| `terms_extra` | extra printed terms | empty |
| `accent_colour` | hex accent used in the PDF | `#0097b2` |
| `whatsapp_template` | message template | see `assets/js/store.js` `WA_TEMPLATE` |
| `next_invoice_number` | **the next number to assign** | `1` |
| `pdf_footer_note` | PDF footer note | `Generated locally by this invoicing app.…` |

Every banking key is always printed on the invoice as its **label**; a blank
value is drawn as a blank ruled line so the owner can fill it in by hand.

## 2. `CLIENTS` — the parents

| column | type | notes |
| --- | --- | --- |
| `parent_id` | integer | primary key, assigned by the app |
| `name` | text | first name |
| `surname` | text | |
| `whatsapp` | text | South African mobile, normalised for links |
| `email` | text | |
| `notes` | text | free text |
| `active` | `TRUE`/`FALSE` | |
| `archived` | `TRUE`/`FALSE` | archived clients are hidden by default |
| `default_rate_cents` | integer cents | the remembered rate for this parent |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

## 3. `LEARNERS` — the children

| column | type | notes |
| --- | --- | --- |
| `learner_id` | integer | primary key |
| `parent_id` | integer | foreign key to `CLIENTS.parent_id` |
| `name` | text | |
| `surname` | text | |
| `grade` | text | free text: `Grade 4`, `Gr 4`, `R` |
| `school_level` | text | a `RATES.key` (`primary`, `high`, or a custom key) |
| `default_rate_cents` | integer cents | |
| `active` | `TRUE`/`FALSE` | |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

## 4. `LESSONS` — individual lessons

| column | type | notes |
| --- | --- | --- |
| `lesson_id` | integer | primary key |
| `date` | ISO date | |
| `parent_id` | integer | foreign key |
| `learner_id` | integer | foreign key (may be blank) |
| `hours_milli` | integer | thousandths of an hour |
| `rate_cents` | integer cents | |
| `amount_cents` | integer cents | `rate_cents × hours` at write time |
| `invoiced` | `TRUE`/`FALSE` | |
| `number_text` | text | the invoice number it was billed on |
| `created_at` | ISO timestamp | |

## 5. `RATES` — owner-editable rate types

| column | type | notes |
| --- | --- | --- |
| `key` | text | slug, e.g. `primary`, `high` |
| `label` | text | printed label, e.g. `Primary School` |
| `rate_cents` | integer cents | hourly price |
| `active` | `TRUE`/`FALSE` | |
| `sort_order` | integer | display order |
| `updated_at` | ISO timestamp | |

Seeded with **Primary School R240.00/hour** and **High School R280.00/hour**.
They are editable and a new type can be added from the invoice screen; nothing is
hardcoded in the app.

## 6. `INVOICES` — the invoice header

This tab holds **both the live fields and the snapshot** used to render the PDF.
The PDF is drawn from the `snap_*` columns only, never from live settings, so an
issued document can never change under the owner's feet.

Live columns:

| column | type | notes |
| --- | --- | --- |
| `invoice_id` | integer | primary key |
| `number` | integer | the number as a number |
| `number_text` | text | the number as printed |
| `prefix` | text | prefix in force when issued |
| `parent_id` | integer | foreign key |
| `learner_id` | integer | foreign key (may be blank) |
| `invoice_date` | ISO date | |
| `due_date` | ISO date | |
| `status` | text | `Draft`, `Sent`, `Paid` or `Cancelled` |
| `currency` | text | `ZAR` |
| `subtotal_cents` | integer cents | sum of the line amounts |
| `total_cents` | integer cents | equals the subtotal |
| `cancelled_at` | ISO timestamp | set on a soft cancel |
| `cancel_reason` | text | |
| `duplicate_of` | integer | the `invoice_id` this was cloned from |
| `date_sent` | ISO timestamp | |
| `created_at` | ISO timestamp | |
| `updated_at` | ISO timestamp | |

Snapshot columns (written once, at save):

`snap_parent_name`, `snap_parent_whatsapp`, `snap_parent_email`,
`snap_learner_name`, `snap_school_level`, `snap_business_name`,
`snap_business_address`, `snap_business_phone`, `snap_business_email`,
`snap_bank_account_holder`, `snap_bank_account_type`, `snap_bank_name`,
`snap_bank_branch_code`, `snap_bank_account_number`, `snap_bank_swift`,
`snap_payment_reference_template`, `snap_payment_terms`,
`snap_whatsapp_template`, `snap_invoice_footer`, `snap_terms_extra`,
`snap_accent_colour`, `snap_currency_symbol`, `snap_invoice_title`,
`snap_pdf_footer_note`.

## 7. `INVOICE_LINES` — the line items

| column | type | notes |
| --- | --- | --- |
| `line_id` | integer | primary key |
| `invoice_id` | integer | foreign key to `INVOICES.invoice_id` |
| `service` | text | a `RATES.key` |
| `description` | text | printed description |
| `rate_cents` | integer cents | the line's own rate at save time |
| `hours_milli` | integer | thousandths of an hour; blank for a flat line |
| `amount_cents` | integer cents | for hourly: `rate_cents × hours`; for flat: the typed total |
| `is_flat` | `TRUE`/`FALSE` | a flat line prints `flat` instead of hours |
| `sort_order` | integer | display order |

Each line keeps its **own** copy of rate, hours and amount, so changing a rate
later never rewrites an existing invoice.

---

## Numbering rules

- `SETTINGS.next_invoice_number` is the next number to assign.
- A successful save uses that number and increments the setting by exactly one.
- A number is **never reused**, including for a cancelled invoice (a cancel burns
  the number).
- A duplicate is detected and refused with a plain message; it is never silently
  overwritten.
- A failed save does **not** increment the counter.

## What the app does on first run

It looks for a spreadsheet it previously created (which is the only kind
`drive.file` lets it see). If there is none, it creates one, writes the header
row of each tab and the seeded settings and rates, and remembers the file id in
`localStorage`. The id is not a secret — it is useless without the owner's own
signed-in Google session.

## If the sheet is damaged

Use **Backup → Export JSON backup** to keep a full copy in the same Drive folder,
and **Restore from a JSON backup** to write it back. The JSON backup contains
every tab above.
