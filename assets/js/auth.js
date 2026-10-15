// Google Identity Services token flow — browser only, NO client secret.
//
// This is the single auth gate. There is no server: the OAuth access token is
// requested with google.accounts.oauth2 (the GIS token model, which needs no
// client secret). The token is kept in a module-private WeakMap and is never
// written to the DOM, a URL, localStorage, a log or an error message.

export const CLIENT_ID =
  "521516474299-dda9340m27adjkft0pjq8i2ds45jurie.apps.googleusercontent.com";

// Exactly these scopes, nothing broader. drive.file is non-sensitive and only
// grants access to files this app creates or the user explicitly opens with it.
export const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

export const EXPIRED_MESSAGE = "Your Google sign-in expired. Tap to sign in again.";

export class AuthExpiredError extends Error {
  constructor() {
    super(EXPIRED_MESSAGE);
    this.name = "AuthExpiredError";
  }
}

// A token older than ~55 minutes is treated as stale so we refresh before Google
// rejects the call (Google tokens last about an hour).
const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

// Private per-instance state. The access token is only ever read via getToken().
const STATE = new WeakMap();

// Remembers the address that last signed in, so Google can skip the account
// chooser. This is an email address the user typed into Google's own flow, not a
// credential, and it grants no access on its own - it is only a hint.
const LAST_EMAIL_KEY = "ctt_invoice_last_email";

function hintStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (err) {
    return null;
  }
}

export function rememberSignedInEmail(email) {
  const store = hintStorage();
  if (!store) return;
  try {
    if (email) store.setItem(LAST_EMAIL_KEY, String(email));
    else store.removeItem(LAST_EMAIL_KEY);
  } catch (err) { /* private mode: the hint is optional */ }
}

export function rememberedEmail() {
  const store = hintStorage();
  if (!store) return "";
  try {
    return store.getItem(LAST_EMAIL_KEY) || "";
  } catch (err) {
    return "";
  }
}

export class Auth {
  constructor({ clientId = CLIENT_ID, scopes = SCOPES, gis = null } = {}) {
    STATE.set(this, {
      token: null,
      expiresAt: 0,
      profile: null,
      tokenClient: null,
      resolvePending: null,
      rejectPending: null,
      listeners: [],
    });
    this.clientId = clientId;
    this.scopes = scopes;
    this.gis = gis || (typeof window !== "undefined" ? window.google : null);
  }

  onStateChange(fn) {
    STATE.get(this).listeners.push(fn);
  }

  _emit(state) {
    for (const fn of STATE.get(this).listeners) fn(state, this.getUser());
  }

  getUser() {
    const s = STATE.get(this);
    return s.profile ? { name: s.profile.name, email: s.profile.email } : null;
  }

  init() {
    if (!this.gis || !this.gis.accounts || !this.gis.accounts.oauth2) {
      throw new Error("Google Identity Services did not load.");
    }
    STATE.get(this).tokenClient = this.gis.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: this.scopes,
      callback: (resp) => this._handleTokenResponse(resp),
      error_callback: () => this._handleTokenError(),
    });
  }

  isSignedIn() {
    return this.hasValidToken();
  }

  hasValidToken() {
    const s = STATE.get(this);
    return Boolean(s.token) && Date.now() < s.expiresAt;
  }

  getToken() {
    return STATE.get(this).token;
  }

  _handleTokenResponse(resp) {
    const s = STATE.get(this);
    if (resp && resp.access_token) {
      s.token = resp.access_token;
      const seconds = Number(resp.expires_in || 3600);
      s.expiresAt = Date.now() + Math.min(seconds * 1000, TOKEN_LIFETIME_MS);
      this._fetchProfile(resp.access_token).then(() => this._emit("signed-in"));
      if (s.resolvePending) {
        const done = s.resolvePending;
        s.resolvePending = null;
        s.rejectPending = null;
        done();
      }
    } else if (s.rejectPending) {
      const fail = s.rejectPending;
      s.resolvePending = null;
      s.rejectPending = null;
      fail(new AuthExpiredError());
    }
  }

  _handleTokenError() {
    const s = STATE.get(this);
    if (s.rejectPending) {
      const fail = s.rejectPending;
      s.resolvePending = null;
      s.rejectPending = null;
      fail(new AuthExpiredError());
    }
  }

  async _fetchProfile(accessToken) {
    const s = STATE.get(this);
    try {
      const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      if (res.ok) {
        const data = await res.json();
        s.profile = { name: data.name || data.email || "Signed in", email: data.email || "" };
        // Remembered only as a sign-in hint for next time.
        if (s.profile.email) rememberSignedInEmail(s.profile.email);
      }
    } catch (err) {
      // A profile fetch failure is not fatal: the token still works for Drive.
      s.profile = s.profile || { name: "Signed in", email: "" };
    }
  }

  /** Interactive sign-in (must be called from a user gesture). */
  requestSignIn() {
    const s = STATE.get(this);
    return new Promise((resolve, reject) => {
      if (!s.tokenClient) this.init();
      s.resolvePending = resolve;
      s.rejectPending = reject;
      // `prompt` is deliberately omitted rather than forced to "consent": the
      // owner has already granted these scopes, so Google issues the token
      // without re-showing the approval screen, but may still interact if it
      // genuinely needs to. Passing "" here would mean "never interact", which
      // would break the first sign-in on a new device. The remembered address
      // additionally skips the account chooser for the usual single-account case.
      const options = {};
      const hint = rememberedEmail();
      if (hint) options.hint = hint;
      s.tokenClient.requestAccessToken(options);
    });
  }

  /**
   * Try to restore a session with NO user interaction at all.
   *
   * GIS can re-issue a token silently when the browser still holds a Google
   * session and the user has already consented. Calling this on boot is what
   * makes returning to the app land straight on the dashboard instead of the
   * sign-in card. Resolves false (never throws) when a tap is genuinely needed.
   */
  async trySilentSignIn() {
    const s = STATE.get(this);
    if (this.hasValidToken()) return true;
    try {
      if (!s.tokenClient) this.init();
    } catch (err) {
      return false;
    }
    try {
      await new Promise((resolve, reject) => {
        s.resolvePending = resolve;
        s.rejectPending = reject;
        s.tokenClient.requestAccessToken({ prompt: "" });
      });
      return this.hasValidToken();
    } catch (err) {
      return false;
    } finally {
      s.resolvePending = null;
      s.rejectPending = null;
    }
  }

  /**
   * Ensure a usable token without user interaction where possible. When a token
   * is stale, ask GIS for a silent refresh (prompt:'') first; only if that is
   * genuinely refused does the caller show the plain-language expiry message.
   */
  async ensureToken() {
    const s = STATE.get(this);
    if (this.hasValidToken()) return s.token;
    if (!s.token) throw new AuthExpiredError();
    if (!s.tokenClient) this.init();
    try {
      await new Promise((resolve, reject) => {
        s.resolvePending = resolve;
        s.rejectPending = reject;
        s.tokenClient.requestAccessToken({ prompt: "" });
      });
      if (this.hasValidToken()) return s.token;
    } catch (err) {
      // fall through to the plain-language error
    }
    throw new AuthExpiredError();
  }

  /** Real sign-out: revoke the token at Google and clear all in-memory state. */
  signOut() {
    const s = STATE.get(this);
    const token = s.token;
    s.token = null;
    s.expiresAt = 0;
    s.profile = null;
    // A deliberate sign-out must not be silently undone by the next boot, so the
    // remembered account hint goes with it. (Chrome's own Google session is
    // untouched - that is the browser's, not this app's.)
    rememberSignedInEmail("");
    if (token && this.gis && this.gis.accounts && this.gis.accounts.oauth2) {
      this.gis.accounts.oauth2.revoke(token, () => {});
    }
    this._emit("signed-out");
  }
}

export const auth = new Auth();
