#!/usr/bin/env python3
"""Parse every produced PDF in the corpus with pypdf (AC-29, AC-31, AC-32, INV-05).

Reads the manifest written by tests/pdf_corpus.mjs and, for EACH artefact,
asserts the A4 page size, every required field's presence, that the amount in the
text equals the stored total, and the empty-terms rule. Corpus-wide, so a single
good sample cannot stand in for the whole set.

Usage: python3 tests/inspect_corpus.py <pdf_artifacts_dir>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pdf_inspect  # local module in the same directory


def main() -> int:
    outdir = Path(sys.argv[1])
    manifest = json.loads((outdir / "manifest.json").read_text())
    rows = [m for m in manifest if m.get("tag") != "immutability"]

    failures = 0
    for row in rows:
        path = Path(row["path"])
        extra = {
            "business": row["business_name"],
            "parent": row["parent_name"],
        }
        rc = pdf_inspect.inspect_path(path, row["total_cents"], extra, quiet=True)
        text = pdf_inspect.extract_text(path)
        terms_present = "\nTerms" in text or text.strip().startswith("Terms")
        terms_rule_ok = terms_present == bool(row["payment_terms"])
        if rc != 0 or not terms_rule_ok:
            failures += 1
        print(f"{row['tag']}: pdf={ 'PASS' if rc == 0 else 'FAIL' } "
              f"terms_expected={bool(row['payment_terms'])} terms_present={terms_present} "
              f"terms_rule={'PASS' if terms_rule_ok else 'FAIL'} total={row['total_cents']}")

    print(f"\nPDF corpus items: {len(rows)}, failures: {failures}")
    if failures:
        print("PDF_CORPUS_INSPECT: FAIL")
        return 1
    print("PDF_CORPUS_INSPECT: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
