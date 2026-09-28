// App shell: brand header, the sign-in gate, the router and the bottom-anchored
// navigation. Everything runs in the browser; there is no server.

import { auth, AuthExpiredError } from "./auth.js";
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

function header(root) {
  const logo = el("img", {
    src: "assets/img/CTT_logo_cropped.png",
    alt: "Chloe's Travelling Tutors",
    class: "brand-logo",
  });
  const right = el("div", { class: "header-right" }, [
    state.user
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
  root.appendChild(header(root));
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
  root.appendChild(header(root));
  root.appendChild(el("main", { class: "app-main gate" }, [
    el("div", { class: "gate-card" }, [
      el("h1", { text: "Your Google sign-in expired." }),
      el("p", { text: "Tap to sign in again." }),
      el("button", { class: "btn primary large", text: "Sign in with Google", onClick: signInThenLoad }),
    ]),
  ]));
}

async function doSignIn() {
  try {
    await signInThenLoad();
  } catch (err) {
    toast(errorMessage(err), "error");
  }
}

async function signInThenLoad() {
  await auth.requestSignIn();
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
  renderRoute(root);
}

function boot() {
  const root = document.getElementById("app");
  auth.onStateChange(() => { });
  if (!auth.isSignedIn()) {
    gateView(root);
    return;
  }
  loadData().catch((err) => { toast(errorMessage(err), "error"); gateView(root); });
}

window.addEventListener("hashchange", () => {
  if (state.ready || auth.isSignedIn()) renderRoute(document.getElementById("app"));
});

boot();

// The single sign-out entry point used by the header.
export { doSignOut };
