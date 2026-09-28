# Publishing the app — exact owner steps

The app code is complete and committed locally to the delivery repository
(`MatthewMBowyer/Invoice_app`, branch `main`, one ordinary commit). Publishing it
is a short owner action because it needs a GitHub login; the build environment has
no write credential, so it cannot be done for you.

Everything below is done on **your own machine** (or in the GitHub web UI). You do
not need to know Git for the web-UI route.

## A. One-time: publish the app

### Option 1 — GitHub web UI (no tools)

1. Open <https://github.com/MatthewMBowyer/Invoice_app>.
2. **Add file → Upload files**, drag in the contents of the app folder
   (everything except `.git`), and **Commit changes** to `main`.
   The important thing is that `index.html` sits at the repository **root**.
3. That is the publish step. Go to section B.

### Option 2 — command line (if you already use Git)

From the folder that holds the committed app:

```bash
git remote set-url origin https://github.com/MatthewMBowyer/Invoice_app.git
git push -u origin main        # normal push — never --force
```

You must be signed in to GitHub as an account that can write to
`MatthewMBowyer/Invoice_app`. A **personal access token** used as the password
must have **Contents: Read and write** for this repository. A token without that
scope fails with `403 / Resource not accessible by personal access token`.

## B. One-time: turn on GitHub Pages

1. In the repository: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Save. The included workflow (`.github/workflows/pages.yml`) then publishes on
   every push to `main`.
4. Wait for the **Actions** run to go green, then open:

   **https://matthewmbowyer.github.io/Invoice_app/**

   The site is served from the **repository root** (not `/docs`), matching the
   workflow and the delivery summary.

## C. One-time: let Google sign-in work for the live URL

1. In **Google Cloud Console → APIs & Services → Credentials**, open the OAuth
   **Client ID** used by the app.
2. Under **Authorized JavaScript origins**, add `https://matthewmbowyer.github.io`.
3. Save. (If the OAuth consent screen is still in **Testing**, add each person's
   Google address as a test user, or publish the consent screen.)

## D. Prove it end to end

Run **`docs/OWNER_LIVE_VERIFICATION.md`** once the URL is live. It is the exact,
four-part check: a stranger signs in, creates an invoice, confirms the file is in
their own Drive, and confirms a second account sees none of it. Until you run it,
that item stays "unproven" — it is not something the build can prove.

## What is already done (so you can trust the push)

- The whole app is committed to `main` as a single ordinary commit; no
  force-push, no rewritten history.
- `index.html` is at the repository root and every asset path is relative, so the
  `/Invoice_app/` sub-path works.
- The static checks, the cross-language parity harness, the headless
  demonstrator, the PDF inspection and the click-driven UI harness all pass.
