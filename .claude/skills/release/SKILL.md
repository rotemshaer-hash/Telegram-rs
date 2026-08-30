---
name: release
description: Ship a change to Drushe end to end — version bump, the full local gate (constitution validator, e2e suite, Firebase rules suite), commit, push to a claude/* branch and open a PR. Use when a code change is finished and ready to go out, or when the user says לשחרר / להעלות / לדחוף / release / ship. Does NOT merge.
---

# Releasing a Drushe change

The project constitution (`CLAUDE.md`) is binding here. Two rules dominate:
**never push or merge without the user's explicit "כן"**, and **root cause
before symptom**. This skill is the checklist, not a licence to skip either.

## 1. Decide the version bump

`APP_VERSION` in `index.html` is the single source of truth, and
`mobile/android/app/build.gradle` reads it for `versionName` — so it is the
number a user quotes when reporting a bug.

- **Bump the patch** when the change is visible on a device: UI, copy, a
  behaviour fix, anything in `index.html` a user could notice.
- **Do not bump** for build config, CI, tests, docs, or rules-only changes.

State which of the two applies and why, before editing.

## 2. Run the whole local gate

All three, in this order. A failure is a stop, never a warning to note and
move past.

```bash
bash scripts/validate.sh     # constitution: SSOT, protected strings, price
npm test                     # Playwright e2e against the real index.html
npm run test:rules           # security rules against the Firebase emulator
```

`test:rules` needs Java and a one-time emulator download. In a sandbox whose
egress goes through a proxy, firebase-tools sends its local rules upload
through it and fails to parse the reply; run that one command with
`env -u HTTPS_PROXY -u https_proxy` — the target is loopback, so nothing
leaves the machine. Never do this for a command that actually reaches the
network.

## 3. Prove the change, don't assert it

Before committing, show the fix working:

- A bug fix needs a test that **fails on the old code and passes on the new**.
  Verify that both ways — restore the previous file, run the test, watch it
  fail. A test that passes before and after proves nothing.
- A rules or permission change needs `tests/rules/`, because the JS-level
  stub has no rules and will happily pass code the database would reject.
  This exact gap shipped the deletion bug four separate times.
- A visual change is worth a screenshot from a throttled browser, not a
  reading of the CSS.

## 4. Branch, commit, push

Work on a `claude/<short-topic>` branch off the current `origin/main` — never
commit to `main`, and never stack an unrelated change on an existing branch.

```bash
git checkout -B claude/<topic> origin/main
git add -A && git status --short   # look at this; never blind-add
```

Check the file list before committing. Debug logs, emulator output and
scratch specs have leaked into commits here before.

The commit message says **what the root cause was**, not what lines moved.
End it with the standard co-author trailer.

`git push -u origin claude/<topic>`, retrying with backoff on network errors.

## 5. Open a PR — and stop

Write the PR body in Hebrew, addressing the user in masculine form. Structure
it as: the root cause → what changed → how it was verified → what was
deliberately left alone.

**Then stop.** Merging requires the user to say "כן" first, every time.

## 6. After a merge to main

- `deploy.yml` publishes to Netlify, so the change reaches users without a
  new AAB — `mobile/capacitor.config.json` points the wrapper at the live
  site.
- `deploy-firebase-rules.yml` deploys `database.rules.json` automatically.
  Storage rules are a known-stuck exception and must be published by hand.
- A native change (icon, permissions, targetSdk, a plugin) does need a new
  AAB: run **Build Android App** via `workflow_dispatch` and take the
  `.aab` from the GitHub Release it publishes, not from the Actions artifact
  (artifacts always download as ZIP, which Android's file picker cannot feed
  to Play Console).
