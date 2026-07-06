# Kidemy – Project Constitution

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
| App name | **Kidemy** — never "Lamdeni" | Brand |
| Firebase project | `kidemy-83a17` | Wrong project = data loss |
| Dark header gradient | `linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)` | Core visual identity — **never change** |
| Commission model | `COMMISSION_RATE=0` — subscription only | Business model decision |
| Admin email | `ADMIN_EMAIL` constant — one definition | SSOT |
| App version | `APP_VERSION` constant — one definition | SSOT |

## Structural Invariants

- `_attachStudentApprovalListener(uid)` **must** be called before every `go('studentPending')`.
- `render()` **must** contain the unverified-student guard that redirects to `studentPending`.
- Every `db.ref(...).on(...)` listener that matters for UX must be attached **before** the `return` that exits the auth flow.

## Workflow Rules

- **Never push or merge without explicit user approval ("כן").**
- Read the relevant code section before any edit — never edit blind.
- After every fix, explain the root cause that was addressed, not just what changed.
- Commits go to `claude/telegram-rs-code-1krmf2`; merges go to `main` only after approval.

## Validation

Run `bash scripts/validate.sh` locally or let CI run it on every push.
A failing check blocks the deploy — fix the violation, don't suppress the check.
