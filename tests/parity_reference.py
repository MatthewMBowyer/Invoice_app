#!/usr/bin/env python3
"""Cross-language parity reference for the CTT invoice web app.

Reads a JSON corpus of cases on stdin and prints the authoritative results
computed by the *existing Python application* (projects/invoice_app), so the
browser JavaScript modules can be compared against the same code that already
passes 308 tests.

This script is TEST tooling only. It is never loaded by the shipped app.

Usage:
    echo '<corpus json>' | python3 tests/parity_reference.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def find_invoice_app() -> Path:
    candidates = []
    env = os.environ.get("INVOICE_APP_DIR")
    if env:
        candidates.append(Path(env))
    here = Path(__file__).resolve()
    candidates += [
        here.parents[2] / "projects" / "invoice_app",
        here.parents[1] / "invoice_app",
        Path("/projects/conference-program/projects/invoice_app"),
    ]
    for c in candidates:
        if (c / "app" / "services" / "money.py").exists():
            return c
    raise SystemExit("could not locate projects/invoice_app (set INVOICE_APP_DIR)")


APP_DIR = find_invoice_app()
sys.path.insert(0, str(APP_DIR))

from app.services import money as M  # noqa: E402
from app.services import whatsapp as W  # noqa: E402
from app.services import pdf as P  # noqa: E402


def safe(fn, *args, **kwargs):
    try:
        return {"ok": True, "value": fn(*args, **kwargs)}
    except M.MoneyError as exc:
        # Only the fact that the value was rejected is compared; the two
        # languages phrase the message differently (Python reprs the value).
        return {"ok": False, "error": type(exc).__name__}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": type(exc).__name__}


def main() -> None:
    corpus = json.load(sys.stdin)
    out: dict = {}

    out["parse_money"] = [safe(M.parse_money_to_cents, v) for v in corpus["parse_money"]]
    out["format_money"] = [M.format_money(c) for c in corpus["format_money"]]
    out["format_money_plain"] = [M.format_money_plain(c) for c in corpus["format_money_plain"]]
    out["parse_hours"] = [safe(M.parse_hours_to_milli, v) for v in corpus["parse_hours"]]
    out["format_hours"] = [M.format_hours(h) for h in corpus["format_hours"]]
    out["line_amount"] = [M.line_amount_cents(r, h) for r, h in corpus["line_amount"]]
    out["sanitise_symbol"] = [M.sanitise_symbol(v) for v in corpus["sanitise_symbol"]]

    out["reference"] = [
        P.payment_reference(inv, total_cents=inv.get("_total")) for inv in corpus["reference"]
    ]
    out["filename"] = [P.invoice_filename(inv) for inv in corpus["filename"]]
    out["sanitize_component"] = [
        P.sanitize_filename_component(v, fallback, ml)
        for (v, fallback, ml) in corpus["sanitize_component"]
    ]

    out["normalise_mobile"] = [W.normalise_za_mobile(v) for v in corpus["normalise_mobile"]]
    out["valid_mobile"] = [W.is_valid_za_mobile(v) for v in corpus["normalise_mobile"]]
    out["wa_link"] = [
        W.build_wa_link(n, m) for (n, m) in corpus["wa_link"]
    ]
    out["number_text"] = [
        P.__dict__ and (lambda p, n: (f"{p}{n}" if p else str(n)))(p, n)
        for (p, n) in corpus["number_text"]
    ]
    out["format_date_display"] = [M.format_date_display(v) for v in corpus["dates"]]
    out["format_date_long"] = [M.format_date_long(v) for v in corpus["dates"]]
    out["month_key"] = [M.month_key(v) for v in corpus["dates"]]

    json.dump(out, sys.stdout, ensure_ascii=False, sort_keys=True)


if __name__ == "__main__":
    main()
