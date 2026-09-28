# Setting up Google sign-in (for the owner)

You only do this once. It takes about five minutes, and it is free.

The app signs people in with Google. Google wants to know which web address the
sign-in is allowed to come from, so we tell it ours. This is the only setup step
that touches Google Cloud.

There is **no client secret** in this app, and you must not create one. A browser
app cannot keep a secret, and a secret in a public repository would let anyone
pretend to be the app. The app uses the browser-only Google Identity Services
token flow, which needs no secret at all.

---

## 1. Open the Google Cloud Console

1. Go to <https://console.cloud.google.com/> and sign in.
2. At the top left, pick (or create) a project. Any project will do; call it
   "CTT Invoices" if you are making a new one.

## 2. Create the OAuth client (if you have not already)

1. In the left menu go to **APIs & Services → Credentials**.
2. Click **+ Create credentials → OAuth client ID**.
   - If it asks you to configure a consent screen first, do that: choose
     **External**, give it the app name "CTT Invoices", your email as the support
     address and as the developer contact, and save. You do **not** need to add
     any scopes here — the app asks for its one narrow scope at sign-in time, and
     it is a non-sensitive scope, so no Google review is needed.
3. For **Application type** choose **Web application**.
4. Under **Authorized JavaScript origins**, click **ADD URI** and enter exactly:

   ```
   https://matthewmbowyer.github.io
   ```

   (just the origin: no trailing slash, no path)

5. Under **Authorized redirect URIs**, click **ADD URI** and enter exactly:

   ```
   https://matthewmbowyer.github.io/Invoice_app/
   ```

   This is only needed if the authorization-code flow is used. The app currently
   uses the token flow, which does not need a redirect URI, but registering it now
   costs nothing and means the app keeps working if the flow is ever changed.
6. Click **Create**. Google shows you a **Client ID** (a long string ending in
   `.apps.googleusercontent.com`). It also shows a client secret — **ignore the
   secret, and do not copy it anywhere.**

   The client ID is public by design. It is already committed in
   `assets/js/auth.js`, so the code is visible to everyone and that is fine:

   ```
   521516474299-dda9340m27adjkft0pjq8i2ds45jurie.apps.googleusercontent.com
   ```

   If you ever create a *new* client ID, replace that one string in
   `assets/js/auth.js` and commit it. Nothing else changes.

## 3. For local development (optional)

If you want to run the app on your own computer while changing it, add your
local address as a second origin:

1. Reopen the OAuth client (**Credentials → your client → edit**).
2. Under **Authorized JavaScript origins**, add:

   ```
   http://localhost:8080
   ```

3. Save, then run `python3 -m http.server 8080` in the repository folder and open
   <http://localhost:8080/>.

## 4. Telling GitHub to serve the site

1. On GitHub, open the repository **MatthewMBowyer/Invoice_app**.
2. Go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.

The workflow in `.github/workflows/pages.yml` then publishes the site every time
`main` changes. The site is served from the **repository root** — `index.html`
sits at the top of the repository, not in a `/docs` folder — and the workflow
uploads the repository root as the site. Those two must match, and they do.

## 5. Checking it worked

Open <https://matthewmbowyer.github.io/Invoice_app/>. You should see the CTT
logo and a **Sign in with Google** button. Press it and pick your account. If it
works, you will land on the home screen. If Google says the origin is not
allowed, come back to step 2 and check the origin is exactly
`https://matthewmbowyer.github.io` with no trailing slash and no path.
