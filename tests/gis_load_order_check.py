#!/usr/bin/env python3
"""GIS script-order check: a SLOW Google Identity Services must still be loaded
before the app module runs.

The defect this guards against: with `<script src=".../gsi/client" async defer>`
the GIS download and the app module race. When GIS loses, the module constructs
`auth` while `window.google` is still undefined, the app captures a null GIS for
the lifetime of the page, and every sign-in click fails with the user-visible
message "Google Identity Services did not load." even though GIS arrives moments
later. Deferred classic scripts and module scripts execute in document order, so
`defer` (without `async`) removes the race.

The check serves the REAL index.html under the real /Invoice_app/ subdirectory,
with only the GIS URL swapped for a deliberately slow local stand-in and an
observer appended that reads the app's own exported `auth` singleton. It asserts
the singleton captured a usable GIS.

`--negative-control` re-serves the same page with `async` forced back on, and
requires the check to FAIL. That proves the assertion can actually fail rather
than passing vacuously.

Usage: python3 tests/gis_load_order_check.py <repo_dir> [--negative-control]
"""
from __future__ import annotations

import http.server
import json
import re
import socketserver
import subprocess
import sys
import threading
import time
from pathlib import Path

PREFIX = "/Invoice_app"
SLOW_GIS_PATH = PREFIX + "/__slow_gis.js"
SLOW_GIS_SECONDS = 6
CHROMIUM = "chromium"
BUDGET_MS = 12000

# A minimal stand-in for the real GIS client. It only has to define the surface
# the app touches, so the assertion is about LOAD ORDER, not about Google.
GIS_STUB = (
    "window.google = window.google || {};"
    "window.google.accounts = { oauth2: {"
    " initTokenClient: function () { return { requestAccessToken: function () {} }; },"
    " revoke: function () {} } };"
)

# Observes the app's own singleton; it does not change app behaviour.
OBSERVER = """  <script type="module">
    import { auth } from "./assets/js/auth.js";
    const out = document.createElement("pre");
    out.id = "gis_probe";
    out.textContent = "PROBE " + JSON.stringify({
      gisCaptured: auth.gis === null ? null : typeof auth.gis,
      gisUsable: !!(auth.gis && auth.gis.accounts && auth.gis.accounts.oauth2),
      windowGoogle: typeof window.google,
    });
    document.body.appendChild(out);
  </script>
"""


class ThreadingServer(socketserver.ThreadingTCPServer):
    """Concurrent requests are essential: with a single-threaded server the slow
    GIS response blocks the app module's own request, which would hide the very
    race this check exists to expose."""

    daemon_threads = True
    allow_reuse_address = True


class SlowGisHandler(http.server.SimpleHTTPRequestHandler):
    """Serve the tree, but make the GIS script slow and swap it into index.html."""

    force_async = False
    protocol_version = "HTTP/1.1"

    def translate_path(self, path):
        if path.startswith(PREFIX):
            return super().translate_path(path[len(PREFIX):] or "/")
        return str(Path(self.directory) / "__not_found__")

    def _serve_script(self, body: str, content_type: str) -> None:
        raw = body.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):  # noqa: N802 - http.server's naming
        if self.path.startswith(SLOW_GIS_PATH):
            time.sleep(SLOW_GIS_SECONDS)
            return self._serve_script(GIS_STUB, "application/javascript; charset=utf-8")
        if self.path.startswith(PREFIX + "/index.html"):
            html = (Path(self.directory) / "index.html").read_text(encoding="utf-8")
            html = html.replace("https://accounts.google.com/gsi/client", SLOW_GIS_PATH)
            if self.force_async:
                html = html.replace('src="' + SLOW_GIS_PATH + '" defer>',
                                    'src="' + SLOW_GIS_PATH + '" async defer>')
            html = html.replace("</body>", OBSERVER + "</body>")
            return self._serve_script(html, "text/html; charset=utf-8")
        return super().do_GET()

    def log_message(self, *args):
        pass

    def handle_error(self, request, client_address):
        pass


def start_server(root: Path, force_async: bool):
    handler = type("H", (SlowGisHandler,), {"force_async": force_async})
    httpd = ThreadingServer(
        ("127.0.0.1", 0), lambda *a, **k: handler(*a, directory=str(root), **k)
    )
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def run_probe(root: Path, force_async: bool):
    httpd, port = start_server(root, force_async)
    try:
        url = f"http://127.0.0.1:{port}{PREFIX}/index.html"
        res = subprocess.run(
            [CHROMIUM, "--headless=new", "--no-sandbox", "--disable-gpu",
             "--disable-dev-shm-usage", "--window-size=390,900",
             f"--virtual-time-budget={BUDGET_MS}", "--dump-dom", url],
            capture_output=True, text=True, timeout=120,
        )
        dom = res.stdout
    finally:
        httpd.shutdown()
    m = re.search(r'<pre id="gis_probe">(.*?)</pre>', dom, re.S)
    if not m:
        return None, dom
    raw = (m.group(1).strip()
           .replace("&quot;", '"').replace("&amp;", "&")
           .replace("&lt;", "<").replace("&gt;", ">"))
    try:
        return json.loads(raw.split("PROBE ", 1)[1]), dom
    except Exception:
        return None, dom


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    negative = "--negative-control" in sys.argv
    label = "negative control (async forced on)" if negative else "shipped index.html"
    print(f"GIS load-order check: {label}")

    probe, dom = run_probe(root, force_async=negative)
    if probe is None:
        print("  FAIL could not read the probe payload from the page")
        return 1
    print(f"  probe: {json.dumps(probe)}")

    loaded_error = "Google Identity Services did not load." in dom
    print(f"  page shows the user-visible load error: {loaded_error}")

    ok = probe.get("gisUsable") is True and not loaded_error

    if negative:
        # The whole point: with the race restored, the check must fail.
        if ok:
            print("  FAIL negative control passed - this check cannot detect the race")
            return 1
        print("  PASS negative control correctly detected the race (check can fail)")
        return 0

    if not ok:
        print("  FAIL the app captured no usable GIS when GIS was slow to load")
        return 1
    print("  PASS the app captured a usable GIS despite a slow GIS download")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
