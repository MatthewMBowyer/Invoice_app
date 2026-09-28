#!/usr/bin/env python3
"""Run a browser-based test page under the /Invoice_app/ prefix and return its
DOM output. Used for tests/ui_flow.html and tests/measure.html.

Usage: python3 tests/run_ui_flow.py <repo_dir> <page> [out_file]
"""
from __future__ import annotations

import html
import http.server
import re
import socketserver
import subprocess
import sys
import threading
from pathlib import Path

PREFIX = "/Invoice_app"


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if not path.startswith(PREFIX):
            return "/nope"
        return super().translate_path(path[len(PREFIX):] or "/")

    def log_message(self, *a):
        pass


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    page = sys.argv[2]
    out_file = Path(sys.argv[3]) if len(sys.argv) > 3 else None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), lambda *a, **k: Handler(*a, directory=str(root), **k))
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{port}{PREFIX}/{page}"
    try:
        res = subprocess.run([
            "chromium", "--headless=new", "--no-sandbox", "--disable-gpu",
            "--disable-dev-shm-usage", "--virtual-time-budget=9000", "--dump-dom", url,
        ], capture_output=True, text=True, timeout=120)
    finally:
        httpd.shutdown()
    dom = res.stdout
    m = re.search(r'<pre id="out">(.*?)</pre>', dom, re.S)
    body = html.unescape(m.group(1)) if m else "NO OUTPUT (page title: " + (re.search(r"<title>(.*?)</title>", dom, re.S).group(1) if "<title>" in dom else "?") + ")"
    print(body)
    if out_file:
        out_file.write_text(body, encoding="utf-8")
    return 0 if "PASS" in body and "FAIL" not in body.splitlines()[-1] else 1


if __name__ == "__main__":
    raise SystemExit(main())
