#!/usr/bin/env python3
"""Deterministic static checks over the delivered tree (AC-03, AC-08, AC-09,
AC-10, AC-44, AC-53, AC-54, AC-55, INV-12).

Usage: python3 tests/static_checks.py <repo_dir> <framework_project_dir> <out_dir>
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

SKIP_DIRS = {".git", "node_modules", "__pycache__"}
SHIPPED = ("index.html", "assets", "lib", "docs", "README.md", "SETUP_GOOGLE.md",
           "FOR_CHLOE.md", ".github", "tests")


def walk(root: Path, subdirs=SHIPPED):
    for name in subdirs:
        target = root / name
        if target.is_file():
            yield target
        elif target.is_dir():
            for p in target.rglob("*"):
                if p.is_file() and not any(part in SKIP_DIRS for part in p.parts):
                    yield p


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


def main() -> int:
    root = Path(sys.argv[1]).resolve()
    project = Path(sys.argv[2]).resolve()
    out = Path(sys.argv[3]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    report: dict = {"root": str(root)}
    failures = 0

    files = sorted(walk(root))
    report["file_count"] = len(files)

    # ---- AC-03: no root-absolute asset path --------------------------------
    pattern = re.compile(r'(?:src|href)\s*=\s*"(/[^"]*)"|url\(\s*(/[^)]*)\s*\)|from\s+"(/[^"]*)"|import\s*"(/[^"]*)"')
    absolute = []
    for p in files:
        if p.suffix.lower() not in {".html", ".css", ".js", ".mjs", ".json"}:
            continue
        for i, line in enumerate(p.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            for m in pattern.finditer(line):
                ref = next((g for g in m.groups() if g), "")
                if ref.startswith("//"):  # protocol-relative URL, not a site path
                    continue
                absolute.append({"file": str(p.relative_to(root)), "line": i, "ref": ref})
    report["root_absolute_paths"] = absolute
    if absolute:
        failures += 1

    # ---- AC-09 / INV-12: exact scope set -----------------------------------
    auth_src = (root / "assets/js/auth.js").read_text()
    m = re.search(r'export const SCOPES = \[(.*?)\](?:\.join\([^)]*\))?;', auth_src, re.S)
    scopes = re.findall(r'"([^"]+)"', m.group(1)) if m else []
    js_and_html = "\n".join(p.read_text(encoding="utf-8", errors="ignore")
                            for p in files if p.suffix in {".js", ".html", ".mjs"})
    # Broader scopes must not appear in any executable code (comments excluded).
    code_only = re.sub(r'/\*.*?\*/', '', js_and_html, flags=re.S)
    code_only = re.sub(r'(?m)^\s*//.*$', '', code_only)
    broad = re.findall(r'auth/(drive\.readonly|drive\.metadata|drive(?![.\w])|spreadsheets)', code_only)
    report["requested_scopes"] = scopes
    report["broad_scopes_found"] = broad
    scopes_ok = (scopes == ["openid", "email", "profile",
                            "https://www.googleapis.com/auth/drive.file"]) and not broad
    report["scopes_ok"] = scopes_ok
    if not scopes_ok:
        failures += 1

    # ---- AC-08 / AC-10: no secret anywhere in the shipped tree -------------
    secret_patterns = {
        "client_secret assignment": re.compile(r'client_secret\s*[:=]\s*["\'][^"\']{6,}'),
        "GOCSPX client-secret token": re.compile(r'GOCSPX-[A-Za-z0-9_\-]{10,}'),
        "google api key": re.compile(r'AIza[0-9A-Za-z_\-]{30,}'),
        "private key block": re.compile(r'-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----'),
        "service account type": re.compile(r'"type"\s*:\s*"service_account"'),
        "service account email": re.compile(r'[a-z0-9\-]+@[a-z0-9\-]+\.iam\.gserviceaccount\.com'),
        "bearer token literal": re.compile(r'Bearer\s+[A-Za-z0-9\-_\.]{20,}'),
        "aws-style key": re.compile(r'AKIA[0-9A-Z]{16}'),
        "slack token": re.compile(r'xox[baprs]-[A-Za-z0-9\-]{10,}'),
    }
    findings = []
    allowed = {"521516474299-dda9340m27adjkft0pjq8i2ds45jurie.apps.googleusercontent.com"}
    for p in files:
        text = p.read_text(encoding="utf-8", errors="ignore")
        for name, pat in secret_patterns.items():
            for m in pat.finditer(text):
                frag = m.group(0)
                if any(a in frag for a in allowed):
                    continue
                line = text[:m.start()].count("\n") + 1
                findings.append({"file": str(p.relative_to(root)), "line": line, "rule": name})
    report["secret_findings"] = findings
    report["client_id_present"] = allowed.pop() in (root / "assets/js/auth.js").read_text()
    if findings:
        failures += 1

    # ---- AC-44: CTT brand tokens + logo + spelling ------------------------
    css = (root / "assets/css/app.css").read_text()
    tokens = {
        "--ctt-blue: #0097b2": "#0097b2" in css,
        "--ctt-black: #000000": "--ctt-black" in css,
        "--ctt-dark-grey: #393939": "#393939" in css,
        "--ctt-soft-grey: #8e99a2": "#8e99a2" in css,
        "--ctt-light-bg: #f5f8fa": "#f5f8fa" in css,
        "lighter tint #47d3e5": "#47d3e5" in css,
        "lighter tint #1ebdd1": "#1ebdd1" in css,
    }
    logo = root / "assets/img/CTT_logo_cropped.png"
    source_logo = project / "inputs" / "CTT_logo_cropped.png"
    logo_ok = logo.exists() and source_logo.exists() and sha256(logo) == sha256(source_logo)
    # AC-44 brand spelling: the brand-carrying, user-visible sources must use the
    # contract's 'Travelling' spelling, and the single-L 'Traveling' must not
    # appear anywhere in the tree's source/docs (not just index.html).
    brand_sources = [
        root / "index.html", root / "assets/js/app.js",
        root / "assets/js/invoicing.js", root / "assets/js/store.js",
    ]
    all_text_files = [
        p for p in files
        if p.suffix in {".html", ".js", ".mjs", ".css", ".md", ".py"} and "tests/__pycache__" not in str(p)
    ]
    spelling_texts = {p: p.read_text() for p in all_text_files if p.exists()}
    missing_travelling = [str(p.relative_to(root)) for p in brand_sources if "Travelling" not in p.read_text()]
    # Match the wrong-spelling BRAND PHRASE, not the bare word, so the check's
    # own assertion literal (a bare "Traveling") is never a false positive. The
    # phrase is assembled at runtime so this file does not contain it verbatim.
    wrong_phrase = "Traveling" + " Tutors"
    wrong_spelling = [str(p.relative_to(root)) for p, t in spelling_texts.items() if wrong_phrase in t]
    spelling = not missing_travelling and not wrong_spelling
    report["brand_tokens"] = tokens
    report["logo_byte_identical_to_input"] = logo_ok
    report["uses_Travelling_spelling"] = spelling
    report["spelling_brand_sources"] = [str(p.relative_to(root)) for p in brand_sources]
    report["spelling_missing_Travelling"] = missing_travelling
    report["spelling_has_single_L_Traveling"] = wrong_spelling
    if not all(tokens.values()) or not logo_ok or not spelling:
        failures += 1

    # ---- AC-53: no real client data (fixtures are obviously invented) ------
    fixture_hits = []
    for p in files:
        if "tests" not in p.parts and p.name != "measure.html":
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        for bad in re.findall(r'Chloe\s+Bowyer|Matthew\s+Bowyer', text):
            fixture_hits.append({"file": str(p.relative_to(root)), "value": bad})
    report["real_name_fixture_hits"] = fixture_hits

    # ---- AC-54: canonical inputs unmodified --------------------------------
    manifest_path = project / ".supervisor" / "INPUT_MANIFEST.json"
    inputs_dir = project / "inputs"
    input_report = {"checked": 0, "mismatches": [], "missing": []}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        entries = manifest.get("files", [])
        for entry in entries:
            rel = entry.get("relative_path") or entry.get("path")
            want = entry.get("sha256")
            if not rel or not want:
                continue
            candidate = inputs_dir / rel
            if not candidate.exists():
                input_report["missing"].append(rel)
                continue
            input_report["checked"] += 1
            if sha256(candidate) != want:
                input_report["mismatches"].append(rel)
    report["inputs"] = input_report
    if input_report["mismatches"] or input_report["missing"] or input_report["checked"] == 0:
        failures += 1

    # ---- AC-55: the Python reference app is unmodified ---------------------
    # The reference app lives in the framework repo. "Unmodified since planning"
    # is proven by (a) no tracked change vs HEAD for that path and (b) no source
    # file written after the planning/contract was issued.
    ref = project.parent / "invoice_app"
    ref_report = {"exists": ref.exists()}
    if ref.exists():
        diff = subprocess.run(["git", "-C", str(project.parent.parent), "diff", "--stat", "HEAD", "--", "projects/invoice_app"],
                              capture_output=True, text=True)
        untracked = subprocess.run(["git", "-C", str(project.parent.parent), "status", "--porcelain", "--", "projects/invoice_app"],
                                   capture_output=True, text=True)
        ref_report["tracked_diff"] = diff.stdout.strip()
        ref_report["tracked_changes"] = len([l for l in untracked.stdout.splitlines() if l[:2].strip() in {"M", "D", "A", "R", "C"}])
        contract_time = (project / ".supervisor" / "PROJECT_CONTRACT.json").stat().st_mtime
        modified_after = []
        source_hash = hashlib.sha256()
        for p in sorted(ref.rglob("*")):
            if not p.is_file() or any(part in {".git", "__pycache__", ".pytest_cache", "data", "output", "node_modules"} for part in p.parts):
                continue
            modified_after.append(str(p.relative_to(ref))) if p.stat().st_mtime > contract_time else None
            source_hash.update(str(p.relative_to(ref)).encode())
            source_hash.update(p.read_bytes())
        ref_report["source_tree_sha256"] = source_hash.hexdigest()
        ref_report["source_files_written_after_planning"] = modified_after
        ref_report["clean"] = (not diff.stdout.strip()) and not modified_after
    report["invoice_app"] = ref_report
    if not ref_report.get("clean", False):
        failures += 1

    report["result"] = "PASS" if failures == 0 else "FAIL"
    (out / "static_checks.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = ["# Deterministic static checks (AC-03, AC-08, AC-09, AC-10, AC-44, AC-53, AC-54, AC-55, INV-12)", ""]
    lines.append(f"files scanned: {report['file_count']}")
    lines.append(f"root-absolute asset paths: {len(absolute)} -> {'PASS' if not absolute else 'FAIL'}")
    lines.append(f"drive scopes used: {scopes} ; broad scopes: {broad} -> {'PASS' if scopes_ok else 'FAIL'}")
    lines.append(f"secret findings: {len(findings)} -> {'PASS' if not findings else 'FAIL'}")
    lines.append(f"public client id present (allowed): {report['client_id_present']}")
    lines.append(f"brand tokens all present: {all(tokens.values())} ; logo byte-identical: {logo_ok} ; spelling: {spelling}")
    lines.append(f"real client names in fixtures: {len(fixture_hits)}")
    lines.append(f"canonical inputs: checked={input_report['checked']} mismatches={input_report['mismatches']} missing={input_report['missing']}")
    lines.append(f"projects/invoice_app clean: {ref_report.get('clean')}")
    lines.append(f"\nRESULT: {report['result']}")
    (out / "static_checks.txt").write_text("\n".join(lines), encoding="utf-8")

    print("\n".join(lines))
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
