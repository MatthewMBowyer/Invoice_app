#!/usr/bin/env python3
"""Inspect the PRODUCED invoice PDF with pypdf (AC-29, AC-31, AC-32).

Never trusts the PDF library's return value: it parses the artefact that was
actually written to disk, asserts the A4 page size, asserts every required field
from docs/PDF_GENERATION.md is present in the extracted text, and asserts that
the amount appearing in the text equals the invoice's stored total.

Usage:
    python3 tests/pdf_inspect.py <pdf_path> <expected_total_cents> [extra_json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from pypdf import PdfReader

# A4 in PostScript points, with the small tolerance the spec permits.
A4_W, A4_H = 595.28, 841.89
TOL = 1.5


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(int(cents))
    whole, frac = divmod(cents, 100)
    return f"{sign}R{whole:,}.{frac:02d}"


def extract_text(pdf_path: Path) -> str:
    reader = PdfReader(str(pdf_path))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def inspect_path(pdf_path: Path, total_cents: int | None, extra: dict, quiet: bool = False) -> int:
    reader = PdfReader(str(pdf_path))
    report: dict = {"path": str(pdf_path), "bytes": pdf_path.stat().st_size}
    report["pages"] = len(reader.pages)
    box = reader.pages[0].mediabox
    report["width"] = round(float(box.width), 2)
    report["height"] = round(float(box.height), 2)
    report["is_a4"] = abs(float(box.width) - A4_W) <= TOL and abs(float(box.height) - A4_H) <= TOL

    text = extract_text(pdf_path)
    report["text"] = text

    required = {
        "INVOICE heading": "INVOICE",
        "BILL TO label": "BILL TO",
        "invoice number label": "INVOICE NUMBER",
        "ISSUED label": "ISSUED",
        "DUE label": "DUE",
        "item table header": "ITEM",
        "subtotal": "Subtotal:",
        "total": "Total:",
        "amount due": "AMOUNT DUE",
        "payment instructions": "PAYMENT INSTRUCTIONS",
        "account holder": "Account Holder",
        "account type": "Account Type",
        "bank": "Bank",
        "branch code": "Branch Code",
        "account number": "Account Number",
        "swift": "SWIFT",
        "reference": "Reference",
        "footer note": "Generated locally by this invoicing app",
    }
    flat = text.replace("\u00a0", " ")
    fields = {name: (needle in flat) for name, needle in required.items()}

    if total_cents is not None:
        want = money(total_cents)
        report["expected_total"] = want
        report["total_present"] = want in flat
        report["total_bare_present"] = str(total_cents // 100) in flat and want not in flat
    else:
        report["total_present"] = True
        report["total_bare_present"] = False

    extra_fields = {k: (str(v) in flat) for k, v in extra.items()}

    ok = (report["is_a4"] and all(fields.values()) and report["total_present"]
          and not report["total_bare_present"] and all(extra_fields.values()))
    report["fields"] = fields
    report["extra_fields"] = extra_fields
    report["result"] = "PASS" if ok else "FAIL"

    if not quiet:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if ok else 1


def main() -> int:
    pdf_path = Path(sys.argv[1])
    total_cents = int(sys.argv[2]) if len(sys.argv) > 2 else None
    extra = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
    return inspect_path(pdf_path, total_cents, extra)


if __name__ == "__main__":
    raise SystemExit(main())
