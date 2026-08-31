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
- **Do it yourself instead of asking him to.** Close the PR, run the workflow,
  read the logs. He is the one who does what only he can: consoles, secrets,
  device checks, and decisions. Note that this session cannot dispatch or
  cancel GitHub workflows (403) — that one genuinely needs him.
- **Never a picker** (`AskUserQuestion`). Ask in plain text.
- **Bump `APP_VERSION` on every fix that reaches the device** — he verifies by
  the number. Skip it for build config, CI, or rules-only changes, which never
  show up there and would only send him looking for a number that never comes.

## Workflow Rules

- **Never push or merge without explicit user approval ("כן").**
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
