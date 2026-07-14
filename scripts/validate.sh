#!/bin/bash
# Drushe project constitution validator.
# Runs on every deploy — a non-zero exit blocks the deploy.

set -euo pipefail

FILE="index.html"
ERRORS=0

fail() { echo "❌  $1"; ERRORS=$((ERRORS + 1)); }
pass() { echo "✅  $1"; }

count_pattern() {
  grep -c "$1" "$FILE" 2>/dev/null || echo 0
}

has_pattern() {
  grep -q "$1" "$FILE" 2>/dev/null
}

echo "=== Drushe constitution validator ==="
echo ""

# ── SSOT: each constant defined exactly once ─────────────────────────────────
echo "-- SSOT checks --"

ssot_check() {
  local label="$1" pattern="$2"
  local n
  n=$(count_pattern "$pattern")
  if [ "$n" -eq 1 ]; then
    pass "SSOT: $label (1 definition)"
  else
    fail "SSOT violation: '$label' appears $n times — must be exactly 1"
  fi
}

ssot_check "COMMISSION_RATE"  "const COMMISSION_RATE="
ssot_check "ADMIN_EMAIL"      "const ADMIN_EMAIL="
ssot_check "APP_VERSION"      "const APP_VERSION="

echo ""

# ── Required strings (must exist) ────────────────────────────────────────────
echo "-- Required strings --"

require() {
  local label="$1" pattern="$2"
  if has_pattern "$pattern"; then
    pass "Required: $label"
  else
    fail "Missing required: $label — pattern: $pattern"
  fi
}

require "Commission is zero"            "const COMMISSION_RATE=0"
require "Dark header gradient"          "linear-gradient(150deg,#0F1A1F 0%,#0e7a72 45%,#8b2fc9 100%)"
require "Firebase project kidemy-83a17" "kidemy-83a17"
require "App name Drushe"               "Drushe"
require "Student approval listener fn"  "_attachStudentApprovalListener"
require "Student pending guard in render" "verified!==true&&!isAdmin()"

echo ""

# ── Forbidden strings (must NOT exist) ───────────────────────────────────────
echo "-- Forbidden strings --"

forbid() {
  local label="$1" pattern="$2"
  if has_pattern "$pattern"; then
    fail "Forbidden pattern found: $label — pattern: $pattern"
  else
    pass "Not present: $label"
  fi
}

forbid "Wrong app name (Lamdeni)"   "Lamdeni"
forbid "Wrong app name (Kidemy)"    "Kidemy"
forbid "Direct eval()"              "eval("

echo ""

# ── Result ────────────────────────────────────────────────────────────────────
if [ "$ERRORS" -gt 0 ]; then
  echo "🚫  Validation FAILED — $ERRORS violation(s). Deploy blocked."
  exit 1
else
  echo "✅  All checks passed. Deploy may proceed."
  exit 0
fi
