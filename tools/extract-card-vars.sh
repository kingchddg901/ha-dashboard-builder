#!/usr/bin/env bash
# Extract the CSS custom properties each installed Lovelace card actually READS.
#
# WHY: the outbound half of theme hand-off needs a mapping per foreign card TYPE
# (semantic token -> that card's variable vocabulary). The only trustworthy source
# for that vocabulary is the shipped bundle, not the card's documentation -- docs
# lag, and a renamed internal variable is exactly the drift the mapping has to
# survive. Re-run this after a HACS update to see what moved.
#
# It reports only `var(--x)` READS. A card may also SET properties it never reads
# through var(); those are invisible here by design -- a mapping can only target
# something the card reads.
#
# Usage:  tools/extract-card-vars.sh [community-dir] [out-dir]

set -euo pipefail

SRC="${1:-//192.168.4.104/config/www/community}"
OUT="${2:-$(dirname "$0")/../docs/card-vocabularies}"

# Anything not owned by a card: HA core, Material Web, Paper. A mapping never
# targets these -- the dashboard sets them globally instead, which is what makes
# an UNMAPPED card degrade to "a normal HA card in your palette" rather than break.
SHARED='^--(primary|secondary|accent|card|ha|state|disabled|divider|error|warning|success|info|text|app|paper|mdc|md|rgb)-'

mkdir -p "$OUT"
[ -d "$SRC" ] || { echo "not reachable: $SRC" >&2; exit 1; }

printf '%-30s %8s %8s %8s\n' CARD TOTAL OWNED SHARED

for dir in "$SRC"/*/; do
  card=$(basename "$dir")
  bundle=$(ls "$dir"*.js 2>/dev/null | head -1) || continue
  [ -n "${bundle:-}" ] || continue

  vars=$(grep -ohE 'var\(\s*--[A-Za-z0-9_-]+' "$bundle" 2>/dev/null | sed 's/.*--/--/' | sort -u) || true
  [ -n "$vars" ] || continue

  total=$(printf '%s\n' "$vars" | wc -l)
  shared=$(printf '%s\n' "$vars" | grep -cE "$SHARED" || true)
  owned=$((total - shared))

  { echo "# $card"
    echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ) from $(basename "$bundle")"
    echo "# $total read, $owned card-owned, $shared shared/HA"
    echo
    echo "## card-owned -- these are what a mapping targets"
    printf '%s\n' "$vars" | grep -vE "$SHARED" || true
    echo
    echo "## shared -- the dashboard sets these globally; never map them per-card"
    printf '%s\n' "$vars" | grep -E "$SHARED" || true
  } > "$OUT/$card.txt"

  printf '%-30s %8s %8s %8s\n' "$card" "$total" "$owned" "$shared"
done
