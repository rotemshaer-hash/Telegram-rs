# Drushe – Project Constitution

## Core Principles

### 1. Root Cause First
Never patch symptoms. Before any fix, identify the structural root cause.
A symptom fix that doesn't address the root cause will be reverted.

### 2. Single Source of Truth (SSOT)
Every constant, rule, or piece of logic has exactly **one** definition.
No duplicates. No inline magic numbers. Refer to the one definition everywhere.

---

## Immutable Rules (enforced by `scripts/validate.sh` on every deploy)

| Rule | Value | Why |
|------|-------|-----|
| App name | **Drushe** — never "Kidemy" or "Lamdeni" (both retired) | Brand |
| Firebase project | `kidemy-83a17` — **intentionally still says "kidemy"**, do not rename | Real infra ID from before the Drushe rebrand; renaming it would require migrating to a new Firebase project, not a text edit — wrong project = data loss |
| Dark header gradient | `linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)` | Core visual identity — **never change** |
| Commission model | `COMMISSION_RATE=0` — subscription only | Business model decision |
| Admin email | `ADMIN_EMAIL` constant — one definition | SSOT |
| App version | `APP_VERSION` constant — one definition | SSOT |

## Structural Invariants

- `_attachStudentApprovalListener(uid)` **must** be called before every `go('studentPending')`.
- `render()` **must** contain the unverified-student guard that redirects to `studentPending`.
- Every `db.ref(...).on(...)` listener that matters for UX must be attached **before** the `return` that exits the auth flow.

## Working with the owner (asked for explicitly — do not drift from this)

- **Hebrew always. Address him in masculine.** It slips easily mid-message —
  check before sending.
- **He works only from an Android phone.** Every instruction must be doable
  there. No terminal, no desktop.
- **Give the fastest working path first — not a menu of options.** One route,
  the shortest one that works. Offer an alternative only after the first fails.
- **Everything in the chat.** Never an artifact, never a file card. Step by
  step, with links written out so he can copy them.
- **Always a deep link, never a trail of menu clicks.** Land him on the exact
  screen: `.../app-content`, `.../configuration/env`, the workflow's own page.
  Derive the URL from something real — a CI check's link, a URL he pasted — and
  say so; a guessed id sends him to an error page, which is slower than the
  menu would have been. Known bases, kept here so they are not re-derived:
  Netlify `https://app.netlify.com/projects/kidemy-app/`, Firebase Console
  `https://console.firebase.google.com/project/kidemy-83a17/`, GitHub
  `https://github.com/rotemshaer-hash/Telegram-rs/`. Play Console needs his
  developer and app ids, which are not written down here because the repo is
  public — ask him to paste any console URL and build the rest from it.
- **Do it yourself instead of asking him to.** Close the PR, run the workflow,
  read the logs. He is the one who does what only he can: consoles, secrets,
  device checks, and decisions. Note that this session cannot dispatch or
  cancel GitHub workflows (403) — that one genuinely needs him.
- **Never a picker** (`AskUserQuestion`). Ask in plain text.
- **Bump `APP_VERSION` on every fix that reaches the device** — he verifies by
  the number. Skip it for build config, CI, or rules-only changes, which never
  show up there and would only send him looking for a number that never comes.

## Every change must look like it belongs (asked for explicitly, 12.10.2026)

Anything a user can see has to match the rest of the app and read as part of
it — not as a correct patch bolted on. This is a gate, not a preference: a
screen that works but looks foreign is not finished.

Before calling any visible change done, check it against the app itself:

- **Never a white surface.** Cards and panels use the app's own colours — the
  surface gradient `linear-gradient(165deg,#ECFEFF 0%,#F0F9FF 50%,#EEF2FF 100%)`,
  or the mint tint of `.tpcard`. He has had to say this twice: on the teacher
  page, and again on the onboarding card.
- **Colours come from the token block at the top of `index.html`**, never from
  a new hex invented for one screen. `--grad-main` for primary buttons, the
  protected dark gradient for brand headers, `#0F1A1F` for titles, `#64748B`
  and `#475569` for body text.
- **Reuse the existing component and its wording.** If a screen for this
  already exists, extend it rather than building a second one beside it.
- **Render it on the real app and look at it** before saying it is ready —
  then send him the image. A screenshot catches what reading the diff does not.

The same holds for copy: it addresses the role actually using the screen, and
it never contradicts something another screen already tells the user.

## Workflow Rules

- **Never push or merge without explicit user approval ("כן").**
- **Batch merges — a production deploy costs 15 of 3,000 monthly Netlify
  credits.** The July–August invoice: 194 deploys took 2,910 credits, 97% of
  the budget, while bandwidth, functions and requests together took under
  three. The ceiling is 200 deploys a month, and four separate PRs merged one
  by one cost four times what the same work costs merged together. So hold
  finished work on the branch and merge it in one go. Merge alone and
  immediately for a security fix or anything broken — 15 credits never
  outweigh that.

  ⚠️ **`paths-ignore` does not make a push free, and this entry used to claim
  it did.** Netlify is linked to the repo with *auto publishing on*, so it
  builds and publishes **every** push to `main` by itself — confirmed on
  12.10.2026: commit `85320de` went live although `deploy.yml` correctly
  skipped it. `paths-ignore` saves the GitHub Actions run, not the deploy.

  The cost is the smaller half of it. Netlify's own publish runs **no gate**:
  `netlify.toml` has an empty build command, so it serves the repo as-is
  without `validate.sh`, the e2e suite or the rules suite. Everything we
  built to block a bad deploy runs only in our workflow — which Netlify
  publishes ahead of. Until auto publishing is turned off, assume a push to
  `main` is live within a minute, unchecked.
- Read the relevant code section before any edit — never edit blind.
- After every fix, explain the root cause that was addressed, not just what changed.
- Development happens on the `claude/*` branch the session is given; merges go
  to `main` only after approval.
- **Check `HANDOFF.md` against the code before building from it.** Large parts
  of it have described work as open that had already shipped, and a session was
  spent re-investigating those. Verify, then build.

## Validation

Run `bash scripts/validate.sh` locally or let CI run it on every push.
A failing check blocks the deploy — fix the violation, don't suppress the check.

**Enable the pre-commit hook once per clone:**

```bash
git config core.hooksPath .githooks
```

The validator then runs before every commit, so a violation never enters the
history in the first place. CI catching it later means someone has to remember
to come back to it — this way there is nothing to remember.

## Shipping a change

`/release` walks the full gate: version-bump decision, `validate.sh`, the e2e
suite, the Firebase rules suite, branch, commit, push, PR. It stops at the PR
— merging still needs an explicit "כן".
