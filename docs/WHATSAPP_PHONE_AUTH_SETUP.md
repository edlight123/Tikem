# Phone sign-in with WhatsApp codes: owner setup

Phone sign-in is built and shipped **switched off**. Nothing changes for anyone
until every step below is done and the switch is flipped. This page is the
checklist, in order.

## How it works (one paragraph)

The app asks for a phone number and calls `POST /api/auth/phone/start`. The
server sends a 6-digit code through the WhatsApp Cloud API using an
AUTHENTICATION template with a copy-code button. The person types or pastes the
code; `POST /api/auth/phone/verify` checks it, finds or creates the Firebase
account for that number, and returns a Firebase custom token the app signs in
with. Google and Apple stay as backup buttons; email stays behind a quiet link.
Signed-in people can add a number from Profile ("Add phone number"). When a number is added, the account gets a security notice (bell, push, and email if it has one) so an unexpected link is visible.

Two keys must both be on:

| Key | Where | Default |
| --- | --- | --- |
| `PHONE_AUTH_ENABLED=true` | Vercel env (server) | off |
| `config/auth` doc `{ phone_whatsapp: true }` | Firestore | missing = off |

The Firestore doc is the instant kill switch: the server re-reads it every 30
seconds, and the app re-reads it every few minutes. When either key is off,
every `/api/auth/phone/*` route answers 404 and the app shows the login screen
exactly as before.

## 1. Meta account and verification

1. Meta Business account (Business Portfolio): https://business.facebook.com/
2. **Business Verification** (already pending): Business settings > Security
   Center > Start verification.
   https://www.facebook.com/business/help/2058515294227817
3. A **dedicated phone number** for Tikèm's WhatsApp sender. It must NOT already
   be registered on the WhatsApp or WhatsApp Business app (or delete that
   account first). It must be able to receive one SMS or voice call for
   registration. A US number is fine for a Haitian audience.
4. Display name **Tikèm**, reviewed by Meta against the display name
   guidelines: https://www.facebook.com/business/help/757569725593362

## 2. Developer app and WhatsApp product

1. Create an app at https://developers.facebook.com/apps (type: Business) and
   attach it to the Tikèm Business portfolio.
2. Add the **WhatsApp** product. Getting started:
   https://developers.facebook.com/docs/whatsapp/cloud-api/get-started
3. In WhatsApp > API Setup, add the dedicated number, verify it, and note:
   - **Phone number ID** -> `WHATSAPP_PHONE_NUMBER_ID`
   - **WhatsApp Business Account ID** -> `WHATSAPP_WABA_ID`
4. **Payment method**: Business settings > WhatsApp accounts > (the WABA) >
   Payment settings. Authentication messages are paid per delivered message;
   without a card, sends fail.
   https://developers.facebook.com/docs/whatsapp/pricing

## 3. System user and permanent token

The token on the API Setup page expires after 24 hours. Production needs a
system-user token:

1. Business settings > Users > System users > Add (role: Admin).
2. Assign assets: the developer app (Full control) and the WhatsApp account
   (Full control).
3. Generate token: pick the app, expiry **Never**, permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. That token is `WHATSAPP_ACCESS_TOKEN`. Store it only in Vercel.

https://developers.facebook.com/docs/whatsapp/business-management-api/get-started#1--acquire-an-access-token-using-a-system-user-or-facebook-login

## 4. The authentication template

WhatsApp Manager > Message templates > Create template:

| Field | Value |
| --- | --- |
| Category | **Authentication** |
| Name | `tikem_login_code` (or set `WHATSAPP_TEMPLATE_NAME`) |
| Languages | **English (`en`)** and **French (`fr`)** |
| Code delivery | **Copy code** |
| Security recommendation | on ("For your security, do not share this code.") |
| Expiration warning | on, **10 minutes** (the server expires codes at 10 min) |
| Button text | default ("Copy code") |

Meta writes the body text for authentication templates ("{{1}} is your
verification code."); you cannot customise it. Approval is usually minutes.

Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/copy-code-button-authentication-templates

**Haitian Creole.** WhatsApp has no Haitian Creole template language, so
people using the app in Kreyòl get the **French** template. If Meta ever adds
it, create the template in that language and set `WHATSAPP_TEMPLATE_LANG_HT`
to its code. If you approve the template under regional codes instead (for
example `en_US`), set `WHATSAPP_TEMPLATE_LANG_EN` / `WHATSAPP_TEMPLATE_LANG_FR`.

## 5. Environment variables (Vercel, Production)

| Variable | Value | Required |
| --- | --- | --- |
| `PHONE_AUTH_ENABLED` | `true` (only at go-live) | yes |
| `AUTH_OTP_SECRET` | 32+ random chars: `openssl rand -hex 32` | yes |
| `WHATSAPP_ACCESS_TOKEN` | system-user token from step 3 | yes |
| `WHATSAPP_PHONE_NUMBER_ID` | from step 2 | yes |
| `WHATSAPP_WABA_ID` | from step 2 (reference; not used to send) | recommended |
| `WHATSAPP_OTP_TEMPLATE` | default `tikem_login_code` (legacy alias `WHATSAPP_TEMPLATE_NAME`) | no |
| `WHATSAPP_GRAPH_VERSION` | default `v25.0` (legacy alias `WHATSAPP_API_VERSION`) | no |
| `WHATSAPP_OTP_HAS_BUTTON` | default `true`; `false` only if the template has no copy-code button | no |
| `WHATSAPP_OTP_TEMPLATE_LANGS` | JSON map, default `{"en":"en","fr":"fr","ht":"fr"}` | no |
| `WHATSAPP_TEMPLATE_LANG_EN` / `_FR` / `_HT` | per-locale override, wins over the JSON map | no |
| `PHONE_OTP_ALLOWED_COUNTRIES` | default `HT,US,CA,FR,DO` | no |
| `PHONE_OTP_DAILY_CAP` | global sends per UTC day, default `2000` | no |
| `PHONE_OTP_PER_PHONE_HOURLY` / `_DAILY` | defaults `5` / `10` | no |
| `PHONE_OTP_PER_IP_HOURLY` / `_DAILY` | defaults `30` / `100` | no |
| `PHONE_AUTH_ALLOWED_ORIGINS` | extra browser origins allowed to call the routes (e.g. a preview URL); `https://www.tikem.co` and `https://tikem.co` are built in | no |
| `NEXT_PUBLIC_PHONE_AUTH_ENABLED` | `true` to show the panel on the web login | no |

`NEXT_PUBLIC_*` values are inlined at build time: changing one needs a
redeploy. Server-only values also need a redeploy to take effect on Vercel.

If `PHONE_AUTH_ENABLED=true` but the token, number ID or secret is missing,
`/start` answers 503 and sends nothing.

## 6. Test with Meta's free test number first

API Setup gives every app a **test sender number** and lets you add up to five
recipient numbers you control. Messages from it are free.

1. Add your own WhatsApp number as a recipient on API Setup.
2. Create the `tikem_login_code` template on the test WABA too (or use the
   real WABA once approved).
3. Locally, in `.env.local`:
   ```
   PHONE_AUTH_ENABLED=true
   OTP_SENDER=whatsapp
   WHATSAPP_ACCESS_TOKEN=<temporary token from API Setup>
   WHATSAPP_PHONE_NUMBER_ID=<test number's phone number ID>
   ```
4. `npm run dev`, then:
   ```
   curl -s localhost:3000/api/auth/phone/start -H 'content-type: application/json' \
     -d '{"phone":"+1XXXXXXXXXX","locale":"fr"}'
   ```
   The code arrives on WhatsApp with a Copy code button.

Without `OTP_SENDER=whatsapp`, a non-production server uses the dev sender
instead: no message is sent and the code is printed in the server log
(`[otp:dev] code for +509... : 123456`). That is the normal way to test.

## 7. Go-live

1. Business Verification approved, display name approved, template approved,
   payment method added.
2. Set the Vercel env vars from step 5, including `PHONE_AUTH_ENABLED=true`.
3. Deploy (and verify the deploy is the right commit: `GET
   https://www.tikem.co/api/auth/phone/status` must answer **404** at this point,
   not a Next.js page error).
4. Deploy the Firestore rules (adds public read of `config/auth` only, and
   locks `phone_otp` / `phone_otp_rate`):
   `firebase deploy --only firestore:rules`
5. Optional but recommended: Firestore console > TTL policies > add a policy on
   field `expireAt` for collection groups `phone_otp` and `phone_otp_rate`, so
   stale codes and counters delete themselves.
6. Firestore console: create `config/auth` with `phone_whatsapp` = `true`
   (boolean). Within ~30 s `GET /api/auth/phone/status` answers
   `{"enabled":true}`.
7. Ship the app code with an OTA update:
   `eas update --branch production --environment production`
   (always pass `--environment production`).
8. Sign in with your own number on a real phone, then try "Add phone number"
   from Profile on an email account.

## Rollback

Set `config/auth.phone_whatsapp` to `false` (or delete the doc). Within 30
seconds every phone route answers 404; the app hides phone sign-in on its next
config read and the login screen is back to email + Google/Apple. Accounts
already created by phone keep working only through phone sign-in, so turn it
back on once the problem is fixed. For a harder stop, also set
`PHONE_AUTH_ENABLED=false` and redeploy.

## Costs

Meta charges per delivered authentication message, by the recipient's country:

| Country | Per code |
| --- | --- |
| Haiti | about $0.0113 |
| US / Canada | about $0.0034 |
| France | about $0.03 |

A sign-in usually costs one message; resends cost one each. The server caps
sends at 5 per number per hour, 10 per number per day, per-IP limits, and a
global ceiling of `PHONE_OTP_DAILY_CAP` (2000/day by default, at most about
$60/day even if every code went to France). When the global cap is hit, the
server logs `GLOBAL DAILY CAP reached` and refuses sends until UTC midnight.
Premium-rate, shared-cost and toll-free numbers, and every country outside the
allowlist (including the other +1 Caribbean ranges), are refused before
anything is sent.

Pricing: https://developers.facebook.com/docs/whatsapp/pricing

## Known gaps

- Phone-only accounts have no email address. Receipts and anything else that
  emails the buyer will have nothing to send to until they add one.
- Account deletion asks for a recent sign-in; phone-only accounts have no
  re-verify button in that sheet yet, so a phone user who signed in more than
  10 minutes ago must sign out and back in first.
- No SMS fallback is wired. `SmsSender` in `lib/auth/otp/senders.ts` is the slot
  for one (for example Twilio Verify).
