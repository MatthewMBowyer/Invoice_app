# Owner live verification — the Google sign-in + Drive proof

This is the one part of the project that **cannot be automated**. It needs a real
Google account and a real tap on Google's own consent screen, so it is
`HUMAN_DEPENDENT`: a person has to do it and report what they saw. Nothing in
this file is a code PASS, and no automated check on this project claims to have
performed it.

The claim being proven is definition-of-done item 1:

> A stranger with any Google account can open the public URL, sign in, and create
> an invoice that saves to their own Drive — and sees none of anyone else's data.

Two people are needed to prove the *isolation* half honestly (one account cannot
show you that another account's data is invisible to it). Steps for both are
below.

---

## What you need

- The public URL: **https://matthewmbowyer.github.io/Invoice_app/**
- **Two different Google accounts** (e.g. Chloe's account, and any second
  account — a family member's or a spare). Call them **Account A** and
  **Account B**.
- A computer (easiest for checking Drive) and, if you want, a phone.

There is nothing to install. Do not open `localhost` — that only works for a
developer and proves nothing about the public site.

## Part 1 — a stranger can sign in and has nothing (Account A)

| # | Do this | Report what you saw |
|---|---------|---------------------|
| 1.1 | Open the URL in a **fresh private/incognito window**. | You should see the CTT logo and a **Sign in with Google** button, and **no** invoices, clients or settings. |
| 1.2 | Tap **Sign in with Google**, choose **Account A**. | Google shows its consent screen. It must ask only to let the app *see and manage a file it creates in your Drive* — it must **not** ask for broad Drive or Gmail access. Say **Allow**. |
| 1.3 | After sign-in, look at the dashboard. | An empty, new app: 0 invoices, R0.00 totals. |

## Part 2 — an invoice saves to Account A's own Drive

| # | Do this | Report what you saw |
|---|---------|---------------------|
| 2.1 | Tap **Create Invoice**. Type a parent's name (a made-up name is fine). Enter a mobile number when asked. | The parent is accepted. |
| 2.2 | On step 2, pick **Primary School**, hours `4`; add another line, **High School**, hours `2`. | Line totals R960.00 and R560.00; invoice total **R1,520.00**. |
| 2.3 | Finish step 3 and tap **Save invoice**. | The invoice is saved and appears in the list. |
| 2.4 | Open **Google Drive** at drive.google.com with **Account A**. Find the file the app created (a spreadsheet named like "Chloe Travelling Tutors Invoice Data"). | The file exists in **Account A's** Drive, with the tabs Settings, Clients, Learners, Lessons, Rates, Invoices, Invoice_lines, and your invoice row is in it. |
| 2.5 | Reload the app URL (not incognito — stay signed in). | Your invoice is still there; the next invoice number has advanced. |

## Part 3 — Account B sees none of Account A's data

| # | Do this | Report what you saw |
|---|---------|---------------------|
| 3.1 | In a **different** private window, open the URL and sign in as **Account B**. | Account B is asked to allow its **own** file; the dashboard is empty. |
| 3.2 | Look for any of Account A's data. | Account B sees **none** of Account A's parents, learners, lessons, invoices or settings — a completely separate, empty app. |
| 3.3 | In Drive with **Account B**, look for Account A's file. | Account B **cannot** see Account A's spreadsheet at all. |
| 3.4 | Back in Account A's window, reload. | Account A's data is untouched and still private to Account A. |

## Part 4 — it works on a phone

| # | Do this | Report what you saw |
|---|---------|---------------------|
| 4.1 | Open the URL on an iPhone (Safari) and sign in as Account A. | The same app, the same invoices. |
| 4.2 | Swipe sideways on every screen. | No horizontal scrolling anywhere. |
| 4.3 | Use **Share → Add to Home Screen**, then open it from the icon. | It opens like a normal app icon. |

---

## How to report the result

Reply with the four parts above, each marked **PASS** or **FAIL**, plus a
one-line note of anything that differed. A FAIL is more useful than a polite
PASS: if the consent screen asked for more than one file, or Account B could see
Account A's data, that is exactly the thing this project must not ship.

## Why this file exists and what it does NOT claim

- **It is not proof.** It is the *procedure* by which a human produces the proof.
  Until a human runs it and reports, item 1 of the definition of done is
  **unproven**, and this project says so plainly.
- **The automated checks cover the code paths, not the live session.** A headless
  demonstrator drives the real app code with Google replaced by an in-memory test
  double (`tests/demonstrator.mjs`); that proves the gate logic, the store logic,
  the numbering, the PDF and the WhatsApp link, but it cannot prove that a real
  Google account gets a real token and a real file in their real Drive. Only this
  procedure proves that.
- **No secret is involved.** The sign-in uses Google Identity Services, which
  needs no client secret and no server; the consent is a per-user, per-file
  grant the user gives Google directly.
