#!/usr/bin/env bash
# Replace RESEND_API_KEY in Vercel production with the key on the clipboard.
# The key is never printed. Run from the repo root right after clicking Copy in Resend:
#   bash scripts/set-resend-key-from-clipboard.sh
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="$(pbpaste | tr -d '[:space:]')"
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

vercel env rm RESEND_API_KEY production --yes >/dev/null 2>&1 || true
printf '%s' "$KEY" | vercel env add RESEND_API_KEY production --sensitive >/dev/null
echo "RESEND_API_KEY replaced in Vercel production. Redeploy production for it to take effect."
