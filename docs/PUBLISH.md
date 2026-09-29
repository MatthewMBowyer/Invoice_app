# Publishing the app — current state and the owner steps that remain

**Status: PUBLISHED AND LIVE.** The app is committed and pushed to
`MatthewMBowyer/Invoice_app` (branch `main`), and the site is served at:

**https://matthewmbowyer.github.io/Invoice_app/**

Nothing below re-publishes the app — the earlier "upload it yourself" steps are
gone because the repository is populated and the site is live. What remains is one
one-time repository setting, one Google Cloud step, and the live Google proof.

## A. Already done (no action needed)

- The whole app is committed to `main` as ordinary, non-force commits.
  `index.html` sits at the repository **root** and every asset path is relative,
  so the `/Invoice_app/` sub-path works.
- **The Pages workflow is committed.** `.github/workflows/pages.yml`
  ("Deploy to GitHub Pages") is in the repository and publishes on every push to
  `main`. Confirm at
  <https://github.com/MatthewMBowyer/Invoice_app/blob/main/.github/workflows/pages.yml>
  (raw URL returns HTTP 200).
- GitHub Pages **Source** is set to **"GitHub Actions"** (`build_type: workflow`),
  so the committed workflow — not the legacy branch bot — drives deployment.

## B. Owner step: confirm Pages is set to GitHub Actions

Only if it is ever changed: in the repository, **Settings → Pages → Build and
deployment → Source**, choose **"GitHub Actions"** and save. The committed
workflow then publishes on every push to `main`. Open the **Actions** tab and
confirm the **"Deploy to GitHub Pages"** run is green, then open the URL above.
The site is served from the **repository root** (not `/docs`), matching the
workflow and the delivery summary.

## C. Owner step: let Google sign-in work for the live URL

1. In **Google Cloud Console → APIs & Services → Credentials**, open the OAuth
   **Client ID** used by the app.
2. Under **Authorized JavaScript origins**, add `https://matthewmbowyer.github.io`.
   If the authorization-code flow were used, add
   `https://matthewmbowyer.github.io/Invoice_app/` as a redirect URI; the shipped
   app uses the browser token flow, so the JavaScript origin is the one that
   matters.
3. Save. (If the OAuth consent screen is still in **Testing**, add each person's
   Google address as a test user, or publish the consent screen.)

## D. Owner step: prove it end to end

Run **`docs/OWNER_LIVE_VERIFICATION.md`** against the live URL. It is the exact,
four-part check: a stranger signs in, creates an invoice, confirms the file is in
their own Drive, and confirms a second account sees none of it. Until it is run,
that item stays "unproven" — it is not something the build can prove.

## What is already proven by the shipped checks

- The static checks, the cross-language parity harness (176/0), the headless
  demonstrator (50/0), the money/numbering suite (38/0), the PDF inspection and
  the click-driven UI harness (37/0) all pass.
- The live served `index.html` is byte-identical to the committed one, and all
  referenced assets return HTTP 200 under the `/Invoice_app/` sub-path.
