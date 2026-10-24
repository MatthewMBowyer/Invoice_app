# Last known good live build

- **Commit:** `e8c1e71`
- **Date:** 2026-08-07
- **Reason:** Loading indicator plus the WhatsApp share-sheet fix. The Web Share
  call now runs inside the tap with the PDF already rendered, so the share sheet
  opens; in-flight Google work drives a visible top progress bar; slow buttons
  say what they are doing; the PDF viewer shows an "opening" notice until the
  document paints and always offers Download.

## Rollback

To put live back to this exact build:

```bash
git checkout main
git reset --hard e8c1e71
git push --force-with-lease origin main
```

If the build *after* this one is the broken one, the safer move is to revert the
offending commit instead of resetting:

```bash
git revert --no-edit <broken-commit-sha>
git push origin main
```
