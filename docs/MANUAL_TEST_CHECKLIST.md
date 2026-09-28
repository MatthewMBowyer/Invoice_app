# Manual test checklist — the invoice flow

A short, hand-run checklist for the invoice flow. Each row has an **expected
result** you can see with your own eyes. Work top to bottom once; about ten
minutes. Everything happens in the browser at
**https://matthewmbowyer.github.io/Invoice_app/** — there is no server to start.

Sign in with any Google account first (section 1); the checklist drives the real
app, including the parts that genuinely need a live Google session.

Legend: **[auto]** = also covered by an automated check in `tests/`;
**[live]** = needs a real Google account, so it is proven by hand here.

---

## 0. Before you start

| # | Step | Expected result |
|---|------|-----------------|
| 0.1 | Open the URL on a phone (or a narrow desktop window ~390px wide). | The CTT logo, the words "Invoices on the go", and a **Sign in with Google** button. No invoices, no client names — nothing but chrome and the button. **[auto]** |
| 0.2 | Look at the URL and the page. | Nothing is served from `localhost`; the address is `matthewmbowyer.github.io`. |

## 1. Sign in as the gate

| # | Step | Expected result |
|---|------|-----------------|
| 1.1 | With no session, look at the screen. | You see the sign-in card only. No clients, lessons, invoices or settings from any Drive are shown. **[auto]** |
| 1.2 | Tap **Sign in with Google** and pick your account. | Google asks to let the app see a file in your Drive. Choose **Allow**. The app opens on the dashboard. **[live]** |
| 1.3 | Open Google Drive (on a computer is easiest) and find the file the app made. | A Google **spreadsheet** the app created in *your own* Drive, with tabs Settings, Clients, Learners, Lessons, Rates, Invoices, Invoice_lines. **[live]** |
| 1.4 | Tap **Sign out** (top right), then try to see your invoices. | You are returned to the sign-in screen. Your data is not reachable until you sign in again. **[auto]** |

## 2. Create a mixed invoice (the critical screen)

| # | Step | Expected result |
|---|------|-----------------|
| 2.1 | Tap **Create Invoice** (the big teal button, the first thing on the dashboard). | The three-step screen opens on **Step 1 — Who is it for?** **[auto]** |
| 2.2 | Start typing a saved parent's name. | A list of matching saved parents appears as you type (type-ahead). **[auto]** |
| 2.3 | Type a name that is **not** saved, then continue. | A **Mobile number** box appears, so the new parent can be saved with the invoice. |
| 2.4 | Pick a saved parent instead. | Their children appear in an optional **Child** picker. Leave it blank if you like. **[auto]** |
| 2.5 | Go to **Step 2 — Rate and hours**; pick **Primary School** and type `4` hours. | The line total shows **R960.00** and the invoice total updates live. **[auto]** |
| 2.6 | Tap **+ Add another rate**; pick **High School**, type `2` hours. | A second line appears; the invoice total shows **R1,520.00** (R960 + R560). **[auto]** |
| 2.7 | Tap **+ Add another rate**; tick **Charge one total instead of hours**; type `350`. | The Hours box is replaced by a **Full amount** box; the invoice total shows **R1,870.00**. |
| 2.8 | Look at each line's remove control. | They are named per row — "Remove line 1", "Remove line 2", "Remove line 3" — not a generic "Remove". **[auto]** |
| 2.9 | Look at the rate dropdown on a line. | It ends with **+ Add a new rate**; choosing it lets you name a new rate, which is saved for next time. **[auto]** |
| 2.10 | Go to **Step 3 — Dates**. | The invoice number is filled in, the date is today, the due date is worked out. There is **no hint text** in the due-date field. **[auto]** |
| 2.11 | Tick/leave **Remember this rate for this parent** on, then **Save invoice**. | The invoice is saved; you are shown the invoice list with the new invoice as a row. |

## 3. Mixing hourly and flat — read the rows

| # | Step | Expected result |
|---|------|-----------------|
| 3.1 | Open the mixed invoice you just made; view its lines. | The hourly lines show hours; the flat line shows **flat** rather than a number of hours. **[auto]** |
| 3.2 | Check the totals. | Each hourly line = rate x hours; the flat line = the typed total; the invoice total = the sum. **[auto]** |

## 4. Numbering never lies

| # | Step | Expected result |
|---|------|-----------------|
| 4.1 | Create a second invoice. | It gets the **next** number, not the same one. **[auto]** |
| 4.2 | Reload the page (pull-to-refresh), then create another. | The number continues from where it left off — the count never silently skips or repeats. **[auto]** |
| 4.3 | Open an invoice and tap **Duplicate**. | A copy is created with a **fresh number** and **today's date**. **[auto]** |
| 4.4 | On that copy, tap **Mark Cancelled** and confirm. | The record is **kept** (not deleted) and its number is still used up. **[auto]** |

## 5. The PDF

| # | Step | Expected result |
|---|------|-----------------|
| 5.1 | Open an invoice and tap **Download PDF**. | A PDF downloads named like `Chloes_Travelling_Tutors_Invoice_<n>_<Parent>.pdf`. **[auto]** |
| 5.2 | Open the PDF and read it. | It has **INVOICE**, the business block, a **BILL TO** block, the invoice number, issue date and due date, the line items (with hours, or a flat amount), the subtotal and the **total in ZAR**, the **banking details**, the **payment reference** and the footer. **[auto]** |
| 5.3 | Change a rate in **Rates**, then download the *same old* invoice again. | The old invoice's PDF is **unchanged** — it uses the values captured when it was made, not today's settings. **[auto]** |

## 6. Blank payment terms

| # | Step | Expected result |
|---|------|-----------------|
| 6.1 | Go to **Settings → Invoicing**, clear **Payment terms**, and tap Save. | Saved with no error. |
| 6.2 | Make a new invoice and download its PDF. | There is **no payment terms row at all** — not a blank line and not a hardcoded "Payment due within 7 days". **[auto]** |
| 6.3 | Look again at the new-invoice due-date field (Step 3). | Still no hint text mentioning a number of days. **[auto]** |

## 7. WhatsApp share — honest about what it cannot do

| # | Step | Expected result |
|---|------|-----------------|
| 7.1 | Open an invoice with a parent that has a mobile number; find **Send on WhatsApp**. | A **wa.me** link is shown with the number normalised (e.g. `0821234567` becomes `27821234567`) and the message text already written. **[auto]** |
| 7.2 | Tap **Open WhatsApp**. | WhatsApp opens (or the web version) with the chat and the message pre-filled. |
| 7.3 | Read the note under the share block. | It says plainly that the app **does not send anything** and **cannot confirm delivery**. **[auto]** |
| 7.4 | Tap **Copy message**. | The message is copied to the clipboard. |

## 8. Export, backup and restore

| # | Step | Expected result |
|---|------|-----------------|
| 8.1 | Go to **Settings**, tap **Export invoices (CSV)**. | A CSV of your invoices downloads. **[auto]** |
| 8.2 | Go to **Backup**, tap **Export JSON backup**. | One JSON file downloads with settings, parents, learners, rates, lessons, invoices and invoice lines. Keep it in your Drive next to the sheet. **[auto]** |
| 8.3 | Tap **Restore this file**, choose the JSON you just saved, confirm. | Your data is restored from the backup, unchanged. **[auto]** |

## 9. Look and feel on a phone

| # | Step | Expected result |
|---|------|-----------------|
| 9.1 | On the phone, swipe sideways on every screen. | Nothing scrolls sideways — there is no horizontal scroll at any width. **[auto]** |
| 9.2 | Try to tap the main buttons with your thumb. | Buttons are comfortably large (at least ~44px). |
| 9.3 | Open a list with nothing in it (e.g. a fresh account's Invoices). | A friendly empty state such as "No invoices yet — create your first one". **[auto]** |

## 10. Data isolation (two accounts)

| # | Step | Expected result |
|---|------|-----------------|
| 10.1 | Sign out, sign in with a **second** Google account. | The second account sees **none** of the first account's data — a fresh, empty app. **[auto]** |
| 10.2 | Sign back in as the first account. | Its data is still there, untouched. **[live]** |

---

## What "automated" vs "live" means here

The **[auto]** rows are also exercised by the deterministic checks in `tests/`
(headless, in a browser and in Node), so a regression shows up without a human.
The **[live]** rows genuinely need a real Google account and interactive consent
and therefore cannot be automated; they are covered by the step-by-step owner
procedure in `docs/OWNER_LIVE_VERIFICATION.md`. Do not treat a code check as a
substitute for the live rows — and do not treat the live rows as passing until
someone has actually done them.
