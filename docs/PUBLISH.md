# Publishing the app — current state and the owner steps that remain

## Current state (measured)

- **The site is LIVE** at **https://matthewmbowyer.github.io/Invoice_app/**
  (HTTP 200). The served `index.html` is byte-identical to the committed one
  (`sha256 d2f8b3a5…`), and every referenced asset returns 200 under the
  `/Invoice_app/` sub-path. The repository `MatthewMBowyer/Invoice_app` is
  **populated** (not empty).
- **Pages Source is set to "GitHub Actions"** (Pages API `build_type: workflow`).
- **One deliverable is still not on the remote:** the GitHub Actions workflow
  file `.github/workflows/pages.yml` is committed in the local delivery tree but
  **could not be pushed** by the build environment, because GitHub refuses any
  write to a path under `.github/workflows/` unless the credential carries the
  `workflow` scope, and the environment's token does not have it. This is the
  **single owner action** in section A below. Until it is done, the site is
  served by GitHub's own branch-deployment bot rather than by the workflow.

## A. Owner step: add the workflow file (one small upload)

On your own machine, at <https://github.com/MatthewMBowyer/Invoice_app>:

1. **Add file → Create new file**.
2. Name it exactly `.github/workflows/pages.yml`.
3. Paste the contents of the `pages.yml` shown at the end of this file, then
   **Commit changes** to `main`.

That is the whole step. It needs no Git and no token — the GitHub web UI can
create a workflow file even when a scoped automation token cannot.

Confirm it worked: <https://github.com/MatthewMBowyer/Invoice_app/blob/main/.github/workflows/pages.yml>
should load, and the **Actions** tab should now list **"Deploy to GitHub Pages"**.

## B. Owner step: confirm Pages is set to GitHub Actions

It already is. If it is ever changed: **Settings → Pages → Build and
deployment → Source**, choose **"GitHub Actions"**, save. Open the **Actions**
tab and confirm the **"Deploy to GitHub Pages"** run is green, then open the URL
above. The site is served from the **repository root** (not `/docs`), matching
the workflow and the delivery summary.

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

## The workflow file to paste

```yaml
name: Deploy to GitHub Pages

# Publishes the app on every push to main. GitHub Pages serves STATIC files only:
# there is no server, no build step and no secret in this workflow.
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Check out the repository
        uses: actions/checkout@v4

      - name: Configure Pages
        uses: actions/configure-pages@v5

      # The site is served from the REPOSITORY ROOT (index.html is at the root).
      # In the repository settings, Pages -> Build and deployment -> Source must
      # be set to "GitHub Actions".
      - name: Upload the site
        uses: actions/upload-pages-artifact@v3
        with:
          path: .

      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
```
