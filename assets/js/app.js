// App shell: brand header, the sign-in gate, the router and the bottom-anchored
// navigation. Everything runs in the browser; there is no server.

import { auth, AuthExpiredError, rememberedEmail } from "./auth.js";
import { Store, GoogleDriveBackend, StoreError } from "./store.js";
import { el, clear, toast } from "./ui.js";
import { renderDashboard } from "./screens/dashboard.js";
import { renderInvoiceNew } from "./screens/invoice_new.js";
import { renderInvoices } from "./screens/invoices.js";
import { renderParents } from "./screens/parents.js";
import { renderRates } from "./screens/rates.js";
import { renderSettings } from "./screens/settings.js";
import { renderBackup } from "./screens/backup.js";

export const state = {
  store: null,
  user: null,
  ready: false,
};

const ROUTES = {
  create: { label: "Create", render: renderInvoiceNew, nav: true },
  dashboard: { label: "Home", render: renderDashboard, nav: false },
  parents: { label: "Parents", render: renderParents, nav: true },
  invoices: { label: "Invoices", render: renderInvoices, nav: true },
  rates: { label: "Rates", render: renderRates, nav: true },
  settings: { label: "Settings", render: renderSettings, nav: true },
  backup: { label: "Backup", render: renderBackup, nav: false },
};

function currentRoute() {
  const hash = (location.hash || "").replace(/^#\/?/, "");
  return ROUTES[hash] ? hash : "dashboard";
}

export function navigate(route) {
  location.hash = `#/${route}`;
}

/** Re-render the current screen (used after a save). */
export function refresh() {
  renderRoute(document.getElementById("app"));
}

export function errorMessage(err) {
  if (err instanceof AuthExpiredError) return err.message;
  if (err instanceof StoreError) return err.message;
  return err && err.message ? err.message : "Something went wrong.";
}

// Sign-in progress. While a sign-in is in flight no sign-in control may be on
// screen: the Google popup can take seconds to appear and the Drive read takes
// longer still, so a live button invites a second tap that opens a second popup
// competing with the first. This is scoped to sign-in only - ordinary screens
// keep their header button.
let signInBusy = false;
let signInMessage = "";

function setSigningIn(busy, message = "") {
  signInBusy = busy;
  signInMessage = message;
  // Never clobber a working screen; the gate is only re-rendered while the app
  // is still unready, which is exactly when the gate is what is on screen.
  if (!state.ready) gateView(document.getElementById("app"));
}

/**
 * Clear the in-flight flags WITHOUT re-rendering, for the moment a sign-in has
 * succeeded and a real screen has taken over. Without this the flags would stay
 * set and the next visit to the gate would show a spinner for ever.
 */
function finishSigningIn() {
  signInBusy = false;
  signInMessage = "";
}

function waitingBlock(message, help) {
  return [
    el("div", { class: "waiting", role: "status", "aria-live": "polite", "aria-busy": "true" }, [
      el("span", { class: "spinner", "aria-hidden": "true" }),
      el("p", { class: "waiting-label", text: message }),
    ]),
    help ? el("p", { class: "help", text: help }) : null,
  ];
}

function header(root, { waiting = false } = {}) {
  const logo = el("img", {
    src: "assets/img/CTT_logo_cropped.png",
    alt: "Chloe's Travelling Tutors",
    class: "brand-logo",
  });
  const right = el("div", { class: "header-right" }, [
    waiting
      ? el("span", { class: "header-waiting", text: "Signing in\u2026" })
      : state.user
        ? el("button", { class: "btn small secondary", text: "Sign out", onClick: doSignOut })
        : el("button", { class: "btn small primary", id: "signin-btn", text: "Sign in with Google", onClick: doSignIn }),
  ]);
  return el("header", { class: "app-header" }, [
    el("div", { class: "header-inner" }, [logo, el("div", { class: "brand-text" }, [
      el("strong", { text: "Chloe's Travelling" }),
      el("span", { text: "Tutors" }),
    ]), right]),
  ]);
}

function gateView(root) {
  clear(root);
  // While a sign-in is in flight the gate shows progress INSTEAD of the button,
  // so there is nothing to tap twice.
  root.appendChild(header(root, { waiting: signInBusy }));
  if (signInBusy) {
    root.appendChild(el("main", { class: "app-main gate" }, [
      el("div", { class: "gate-card" }, waitingBlock(
        signInMessage || "Signing you in\u2026",
        "This can take a few seconds while Google opens and your Drive is read.",
      )),
    ]));
    return;
  }
  root.appendChild(el("main", { class: "app-main gate" }, [
    el("div", { class: "gate-card" }, [
      el("h1", { text: "Invoices on the go" }),
      el("p", { text: "Create tutoring invoices and keep them safely in your own Google Drive. Sign in to see your clients, lessons and invoices." }),
      el("button", { class: "btn primary large", id: "signin-cta", text: "Sign in with Google", onClick: doSignIn }),
      el("p", { class: "help", text: "Your data is stored only in your own Google Drive. Nobody else can see it." }),
    ]),
  ]));
}

function navBar(root) {
  const nav = el("nav", { class: "bottom-nav", "aria-label": "Main navigation" });
  const active = currentRoute();
  for (const [key, route] of Object.entries(ROUTES)) {
    if (!route.nav) continue;
    nav.appendChild(el("button", {
      class: `nav-item${key === active ? " active" : ""}`,
      onClick: () => navigate(key === "create" ? "create" : key),
      "aria-current": key === active ? "page" : null,
    }, [
      el("span", { class: "nav-icon", "aria-hidden": "true", text: route.label.charAt(0) }),
      el("span", { class: "nav-label", text: route.label }),
    ]));
  }
  return nav;
}

async function renderRoute(root) {
  clear(root);
  root.appendChild(header(root));
  const main = el("main", { class: "app-main" });
  root.appendChild(main);
  root.appendChild(navBar(root));
  if (!state.ready) {
    main.appendChild(el("div", { class: "loading", text: "Loading your data\u2026" }));
    return;
  }
  const route = currentRoute();
  try {
    await ROUTES[route].render(main, { navigate, refresh: () => renderRoute(root) });
  } catch (err) {
    if (err instanceof AuthExpiredError) {
      state.ready = false;
      showExpired(root);
      return;
    }
    main.appendChild(el("div", { class: "error-box", text: errorMessage(err) }));
  }
}

export function showExpired(root) {
  clear(root);
  root.appendChild(header(root, { waiting: signInBusy }));
  if (signInBusy) {
    root.appendChild(el("main", { class: "app-main gate" }, [
      el("div", { class: "gate-card" }, waitingBlock(
        signInMessage || "Signing you in\u2026",
        "This can take a few seconds while Google opens and your Drive is read.",
      )),
    ]));
    return;
  }
  root.appendChild(el("main", { class: "app-main gate" }, [
    el("div", { class: "gate-card" }, [
      el("h1", { text: "Your Google sign-in expired." }),
      el("p", { text: "Tap to sign in again." }),
      el("button", { class: "btn primary large", id: "signin-cta", text: "Sign in with Google", onClick: doSignIn }),
    ]),
  ]));
}

async function doSignIn() {
  if (signInBusy) return;
  setSigningIn(true, "Opening Google sign-in\u2026");
  try {
    await signInThenLoad();
  } catch (err) {
    // A refused or failed sign-in returns the owner to a usable gate rather than
    // leaving them on a spinner that never resolves.
    setSigningIn(false);
    toast(errorMessage(err), "error");
  }
}

async function signInThenLoad() {
  setSigningIn(true, "Opening Google sign-in\u2026");
  await auth.requestSignIn();
  // The Google popup has closed and we hold a token; the Drive read is the slow
  // part now, so say so instead of leaving a stale "opening" label up.
  setSigningIn(true, "Signed in. Opening your Google Drive\u2026");
  await loadData();
}

async function doSignOut() {
  auth.signOut();
  state.store = null;
  state.user = null;
  state.ready = false;
  navigate("dashboard");
  boot();
}

async function loadData() {
  const root = document.getElementById("app");
  root.appendChild(el("div", { class: "loading", id: "loading-line", text: "Opening your Google Drive\u2026" }));
  state.store = new Store(new GoogleDriveBackend(auth));
  await state.store.open();
  await state.store.bootstrapIfEmpty();
  await state.store.reload();
  state.user = auth.getUser();
  state.ready = true;
  // The gate is no longer on screen; drop the in-flight flags so a later sign-out
  // returns to a real button rather than an eternal spinner.
  finishSigningIn();
  renderRoute(root);
}

function boot() {
  const root = document.getElementById("app");
  auth.onStateChange(() => { });
  if (auth.isSignedIn()) {
    loadData().catch((err) => { toast(errorMessage(err), "error"); gateView(root); });
    return;
  }
  // No token in memory yet, but the browser may still hold a Google session and
  // an earlier consent. Asking GIS silently first is what turns "sign in again
  // every visit" into "it just opens". While that is in flight the user sees a
  // progress card with NO sign-in button, so an account that can sign in
  // silently never flashes a login screen at all.
  const remembered = rememberedEmail();
  setSigningIn(true, remembered ? `Signing in as ${remembered}\u2026` : "Signing you in\u2026");
  auth.trySilentSignIn().then((ok) => {
    if (ok) {
      setSigningIn(true, "Signed in. Opening your Google Drive\u2026");
      loadData().catch((err) => { setSigningIn(false); toast(errorMessage(err), "error"); gateView(root); });
      return;
    }
    setSigningIn(false);
    gateView(root);
  });
}

window.addEventListener("hashchange", () => {
  if (state.ready || auth.isSignedIn()) renderRoute(document.getElementById("app"));
});

boot();

// The single sign-out entry point used by the header.
export { doSignOut };
