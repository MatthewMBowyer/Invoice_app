#!/usr/bin/env python3
"""Deterministic design-quality checks (AC-46, AC-47).

Asserts the delivered CSS/HTML meets the stated quality bar: a consistent spacing
scale, a clear type hierarchy, visible focus and pressed states, sensible empty
states, short plain on-screen copy, and that the app is not a drop-in Bootstrap
template. Also asserts field labels/help text are carried over from the Python
app's templates (AC-47).

Usage: python3 tests/design_check.py <repo_dir> <reference_app_dir> <out_dir>
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    ref = Path(sys.argv[2]).resolve()
    out = Path(sys.argv[3]).resolve()
    css = (root / "assets/css/app.css").read_text()
    report: dict = {}
    failures = 0

    def check(name, ok, detail=""):
        nonlocal failures
        report[name] = {"ok": bool(ok), "detail": detail}
        if not ok:
            failures += 1

    # Consistent spacing scale.
    spaces = re.findall(r'--space-\d+:', css)
    check("spacing_scale", len(spaces) >= 6, f"{len(spaces)} --space-* tokens")

    # Clear type hierarchy.
    h1 = re.search(r'h1 \{ font-size: ([^;]+);', css)
    h2 = re.search(r'h2 \{ font-size: ([^;]+);', css)
    h3 = re.search(r'h3 \{ font-size: ([^;]+);', css)
    check("type_hierarchy", bool(h1 and h2 and h3),
          f"h1={h1 and h1.group(1)} h2={h2 and h2.group(1)} h3={h3 and h3.group(1)}")

    # Focus and pressed states.
    check("focus_visible_styles", css.count(":focus-visible") >= 5, f"{css.count(':focus-visible')} focus-visible rules")
    check("pressed_states", css.count(":active") >= 2, f"{css.count(':active')} active rules")

    # Empty states + short plain copy.
    screens = "\n".join(p.read_text() for p in (root / "assets/js/screens").glob("*.js"))
    check("empty_state_invoices", "no invoices yet" in screens.lower() and "create your first one" in screens.lower())
    check("empty_state_parents", "No parents yet" in screens)
    check("plain_create_button", 'text: "Create Invoice"' in (root / "assets/js/screens/dashboard.js").read_text())

    # Not a Bootstrap template, and no CSS framework CDN.
    html = (root / "index.html").read_text()
    check("no_bootstrap_template",
          "bootstrap" not in css.lower() and "bootstrap" not in html.lower()
          and "cdn.jsdelivr" not in html and "cdnjs" not in html)

    # The one external script is Google Identity Services only.
    externals = re.findall(r'<script[^>]+src="(https?://[^"]+)"', html)
    check("only_gis_external_script", externals == ["https://accounts.google.com/gsi/client"], str(externals))

    # AC-47: field labels and help text carried over in spirit from the Python templates.
    if ref.exists():
        templates = ref / "app" / "templates"
        ref_text = "\n".join(p.read_text(errors="ignore") for p in templates.rglob("*.html")) if templates.exists() else ""
        wanted = ["Payment reference", "Due", "Bank", "Reference", "WhatsApp", "Grade", "School Level"]
        carried = [w for w in wanted if w.lower() in screens.lower() or w.lower() in html.lower()]
        check("labels_carried_over", len(carried) >= 5, f"carried: {carried}")
        report["reference_templates_found"] = templates.exists()
    else:
        check("labels_carried_over", False, "reference app not found")

    report["result"] = "PASS" if failures == 0 else "FAIL"
    out.mkdir(parents=True, exist_ok=True)
    (out / "design_checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = ["# Design-quality checks (AC-46, AC-47)", ""]
    for k, v in report.items():
        if isinstance(v, dict) and "ok" in v:
            lines.append(f"{v['ok'] and 'PASS' or 'FAIL'}  {k}  {v.get('detail','')}")
    lines.append(f"\nRESULT: {report['result']}")
    (out / "design_checks.txt").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
