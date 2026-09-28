#!/usr/bin/env python3
"""Browser-level probes for the delivered app (AC-03, AC-45, AC-46, INV-11).

1. Serves the delivery repository under a SUBDIRECTORY base (/Invoice_app/),
   exactly like GitHub Pages, and confirms every asset the app references returns
   HTTP 200 (AC-03, INV-11).
2. Boots the app in that subdirectory with headless Chromium and confirms the
   JavaScript actually ran and the sign-in gate rendered (AC-11).
3. Loads the test-only measurement harness at 390/414/768/1280 and reports
   scrollWidth vs clientWidth and small tap targets (AC-45).
4. Writes screenshots of the real screens (AC-45, AC-46).

Usage: python3 tests/browser_check.py <repo_dir> <out_dir>
"""
from __future__ import annotations

import http.server
import json
import re
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

PREFIX = "/Invoice_app"
CHROMIUM = "chromium"


class PrefixedHandler(http.server.SimpleHTTPRequestHandler):
    """Serve <root>/ under the /Invoice_app/ prefix, like GitHub Pages."""

    def translate_path(self, path):
        if not path.startswith(PREFIX):
            return str(Path(self.directory) / "__not_found__")
        stripped = path[len(PREFIX):] or "/"
        return super().translate_path(stripped)

    def log_message(self, *args):  # keep the console quiet
        pass


def start_server(root: Path):
    handler = lambda *a, **k: PrefixedHandler(*a, directory=str(root), **k)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


REF_RE = re.compile(r'(?:src|href)\s*=\s*"([^"]+)"|url\(([^)]+)\)|from\s+"([^"]+)"|import\s*"([^"]+)"')


def referenced_assets(root: Path):
    """Every relative asset referenced by the app, resolved to a repo path."""
    found = set()
    for path in list(root.rglob("*.html")) + list(root.rglob("*.css")) + list(root.rglob("*.js")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for m in REF_RE.finditer(text):
            ref = next((g for g in m.groups() if g), "")
            ref = ref.strip().strip("'\"")
            if not ref or ref.startswith(("http://", "https://", "data:", "#", "mailto:")):
                continue
            if ref.startswith("/"):
                # A root-absolute path is the Pages failure this project forbids.
                found.add("ROOT-ABSOLUTE:" + ref)
                continue
            # Relative refs resolve against the referencing file's directory.
            target = (path.parent / ref).resolve()
            try:
                found.add(str(target.relative_to(root)))
            except ValueError:
                found.add("OUTSIDE:" + ref)
    return sorted(found)


def chromium_dump(url: str, width: int, budget: int = 6000) -> str:
    cmd = [
        CHROMIUM, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", f"--window-size={width},900",
        f"--virtual-time-budget={budget}", "--dump-dom", url,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, timeout=90)
    return res.stdout


def chromium_shot(url: str, width: int, height: int, out: Path) -> None:
    cmd = [
        CHROMIUM, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", f"--window-size={width},{height}",
        "--virtual-time-budget=6000", f"--screenshot={out}", url,
    ]
    subprocess.run(cmd, capture_output=True, text=True, timeout=90)


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    shots = out / "screenshots"
    shots.mkdir(exist_ok=True)
    report: dict = {"root": str(root), "prefix": PREFIX}
    failures = 0

    httpd, port = start_server(root)
    base = f"http://127.0.0.1:{port}{PREFIX}/"
    try:
        import urllib.request

        assets = referenced_assets(root)
        results = {}
        for rel in assets:
            url = base + rel
            try:
                with urllib.request.urlopen(url, timeout=10) as r:
                    results[rel] = r.status
            except Exception as exc:  # noqa: BLE001
                results[rel] = f"ERROR {exc}"
        report["asset_status"] = results
        bad = {k: v for k, v in results.items() if v != 200}
        report["assets_total"] = len(results)
        report["assets_failed"] = bad
        if bad:
            failures += 1
        print(f"assets served under {PREFIX}/: {len(results)}, non-200: {len(bad)}")

        # Boot the app under the subdirectory and confirm the gate rendered.
        dom = chromium_dump(base + "index.html", 390)
        report["boots"] = ("Sign in with Google" in dom) and ("app-header" in dom)
        report["boot_has_no_404_text"] = "404" not in dom
        print(f"app boots under subdirectory: {report['boots']}")
        if not report["boots"]:
            failures += 1

        # Widths.
        widths = [390, 414, 768, 1280]
        measurements = {}
        for w in widths:
            dom = chromium_dump(base + f"tests/measure.html?w={w}", w, budget=7000)
            m = re.search(r'<pre id="result">(.*?)</pre>', dom, re.S)
            raw = m.group(1) if m else ""
            raw = raw.replace("&quot;", '"').replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
            try:
                measurements[w] = json.loads(raw)
            except Exception:
                measurements[w] = {"raw": raw[:500]}
        report["measurements"] = measurements

        all_no_scroll = True
        for w, data in measurements.items():
            for screen in data.get("screens", []):
                if not screen.get("noHorizontalScroll", False):
                    all_no_scroll = False
        report["no_horizontal_scroll_all_widths"] = all_no_scroll
        print(f"no horizontal scroll at all widths: {all_no_scroll}")
        if not all_no_scroll:
            failures += 1

        # Screenshots of the real screens at iPhone width (AC-44, AC-45, AC-46).
        chromium_shot(base + "index.html", 390, 844, shots / "gate-390.png")
        for name in ["dashboard", "create", "parents", "invoices", "settings"]:
            chromium_shot(base + f"tests/measure.html?w=390&screen={name}", 390, 1500, shots / f"{name}-390.png")
        report["screenshots"] = sorted(p.name for p in shots.glob("*.png"))
        for shot in report["screenshots"]:
            if (shots / shot).stat().st_size < 3000:
                failures += 1
                print(f"screenshot too small (likely blank): {shot}")
    finally:
        httpd.shutdown()

    (out / "relpath_probe.txt").write_text(
        "# Subdirectory + relative-path probe (AC-03, INV-11)\n"
        "# The app is served from the /Invoice_app/ subdirectory, as GitHub Pages does.\n"
        + json.dumps(report, indent=2, default=str),
        encoding="utf-8",
    )
    print(f"\nwrote {out / 'relpath_probe.txt'}")
    if failures:
        print("BROWSER_CHECK: FAIL")
        return 1
    print("BROWSER_CHECK: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
