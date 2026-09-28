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
      s.tokenClient.requestAccessToken({ prompt: "consent" });
    });
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
    if (token && this.gis && this.gis.accounts && this.gis.accounts.oauth2) {
      this.gis.accounts.oauth2.revoke(token, () => {});
    }
    this._emit("signed-out");
  }
}

export const auth = new Auth();
