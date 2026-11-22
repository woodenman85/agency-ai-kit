#!/usr/bin/env bash
# One command that puts approved compensation wording back on every posting, then audits.
#
#   bash scripts/fix-compensation.sh              # writes to Manatal
#   bash scripts/fix-compensation.sh 2026-11-10   # same, naming the date the outside batch was created
#
# What it does, in order (each step re-reads the account first, which takes about a minute):
#   1-3  Replaces three versions of the "commission-based / no salary or hourly pay" sentence with
#        "Compensation is paid under an independent contractor (1099) contract." on every city posting
#        created on or after the date (only postings that contain the exact old sentence are touched).
#   4    Restores every city posting made from your approved templates to its template text.
#   5    Unpublishes extra live copies of a city (keeps the oldest live one; reversible).
#   6    Audits the whole account for the flagged wording.
# It stops at the first step that fails. Run it again after fixing the problem; finished work is skipped.
set -eu
cd "$(dirname "$0")/.."
DATE="${1:-2026-11-10}"
NEW='Compensation is paid under an independent contractor (1099) contract.'
step() { printf '\n==================== %s\n' "$1"; }

step "1 of 6: fix the sentence 'Compensation is commission-based…' (created on or after $DATE)"
node scripts/edit-jobs.mjs --created-after "$DATE" --find "Compensation is commission-based. No salary or hourly pay is provided. Earnings depend on individual production." --replace "$NEW" --live

step "2 of 6: fix the sentence 'Pay is commission-based…'"
node scripts/edit-jobs.mjs --created-after "$DATE" --find "Pay is commission-based. No salary or hourly pay is provided. Earnings depend on individual production." --replace "$NEW" --live

step "3 of 6: fix the longer team-lead version"
node scripts/edit-jobs.mjs --created-after "$DATE" --find "Pay is commission-based and comes from each agent's own insurance sales to clients, not from the production of anyone they mentor or recruit. No salary or hourly pay is provided. Earnings depend on individual production." --replace "$NEW" --live

step "4 of 6: restore the template text on the postings made from your approved templates (several minutes)"
node scripts/sync-descriptions.mjs --titles-file scripts/titles-2.json --live

step "5 of 6: unpublish extra live copies of a city"
node scripts/prune-jobs.mjs --duplicate-cities --unpublish --live || echo "(no repeated cities to unpublish)"

step "6 of 6: audit the whole account"
node scripts/audit-manatal.mjs
