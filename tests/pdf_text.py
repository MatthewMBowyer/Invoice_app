#!/usr/bin/env python3
"""Print the extracted text of a PDF, one line per text run.

Used by tests/owner_fixes.test.mjs so the assertions read the artefact that was
actually written to disk rather than trusting the PDF library's return value.

Usage: python3 tests/pdf_text.py <pdf_path>
"""
from __future__ import annotations

import sys
from pathlib import Path

from pypdf import PdfReader


def main() -> int:
    reader = PdfReader(str(Path(sys.argv[1])))
    print("\n".join((page.extract_text() or "") for page in reader.pages))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
