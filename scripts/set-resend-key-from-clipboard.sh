#!/usr/bin/env bash
# Put the secret on the clipboard into a Vercel production env var. Never printed.
# Run from the repo root right after clicking Copy in Resend:
#   bash scripts/set-resend-key-from-clipboard.sh                                   # RESEND_API_KEY
#   bash scripts/set-resend-key-from-clipboard.sh RESEND_INBOUND_API_KEY
#   bash scripts/set-resend-key-from-clipboard.sh RESEND_INBOUND_WEBHOOK_SECRET whsec
set -euo pipefail
cd "$(dirname "$0")/.."

VAR="${1:-RESEND_API_KEY}"
KIND="${2:-key}"
KEY="$(pbpaste | tr -d '[:space:]')"
if [[ "$KIND" == "whsec" ]]; then
  if [[ ! "$KEY" =~ ^whsec_[A-Za-z0-9+/=_]{20,}$ ]]; then
    echo "Clipboard does not hold a webhook signing secret (expected whsec_...)." >&2
    exit 1
  fi
  vercel env rm "$VAR" production --yes >/dev/null 2>&1 || true
  printf '%s' "$KEY" | vercel env add "$VAR" production --sensitive >/dev/null
  echo "$VAR replaced in Vercel production. Redeploy production for it to take effect."
  exit 0
fi
if [[ ! "$KEY" =~ ^re_[A-Za-z0-9_]{20,}$ ]]; then
  echo "Clipboard does not hold a Resend key (expected re_...). Click Copy in Resend and rerun." >&2
  exit 1
fi

# Prove the key works for tikem.co before touching Vercel. A sending-only key
# can't list domains, so validate with a request that fails on auth, not on payload.
STATUS=$(curl -s -o /dev/null -w '%{http_code}' https://api.resend.com/emails \
  -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{}')
if [[ "$STATUS" == "401" || "$STATUS" == "403" ]]; then
  echo "Resend rejected the key (HTTP $STATUS). Not changing Vercel." >&2
  exit 1
fi
echo "Key accepted by Resend (validation HTTP $STATUS)."

vercel env rm "$VAR" production --yes >/dev/null 2>&1 || true
printf '%s' "$KEY" | vercel env add "$VAR" production --sensitive >/dev/null
echo "$VAR replaced in Vercel production. Redeploy production for it to take effect."
