# Google Play: first release, owner steps

For an **organization** developer account whose app does not exist yet. Organization accounts
are **exempt** from the "12 testers for 14 days" closed-test rule, which only applies to
personal accounts created after Nov 2023. So Internal testing → Production is allowed directly.

Everything the agent could prepare is in `store/google-play/`:
`listing.json` (copy), `icon-512.png`, `feature-graphic-1024x500.png`, `data-safety.md`,
`content-rating.md`. Phone screenshots: `store/screenshots/play-phone/`.

---

## 1. Create the app
Play Console → **All apps → Create app**
- App name: **Tikèm: Events & Tickets**
- Default language: **English (United States), en-US**
- App or game: **App**
- Free or paid: **Free** (permanent: a free app can never become paid)
- Tick the Developer Program Policies and US export-law declarations → **Create app**

The package name is fixed by the first AAB you upload (`co.tikem.mobile`), not typed here.

## 2. Store listing
**Grow users → Store presence → Main store listing**
- App name / Short description / Full description: copy from `listing.json → listings.en-US`
- App icon: `icon-512.png`
- Feature graphic: `feature-graphic-1024x500.png`
- Phone screenshots: 2 to 8 from `store/screenshots/play-phone/`
- Tablet screenshots: skip (the listing still publishes; tablets simply show phone shots)
- **Save**

**Store settings** (same menu)
- App category: **Events**; Tags: see `listing.json → tags`
- Contact details: email **support@tikem.co**, phone **+1 631-629-5402**, website **https://www.tikem.co**
- **Save**

**Translations → Manage translations → Add your own translations → French (France), fr-FR**
- Paste `listing.json → listings.fr-FR` (title, short, full). Graphics are inherited.

## 3. App content (Policy and programs → App content)
Work through every card until each is marked complete:

| Card | Answer |
|---|---|
| **Privacy policy** | `https://www.tikem.co/legal/privacy` |
| **App access** | **All or some functionality is restricted** → **Add instructions**: name "Attendee"; username `appreview.attendee@tikem.co`; password = `ASC_DEMO_PASSWORD` from `store/app-store/demo.env`; notes: "Sign in with email. Open https://www.tikem.co/events/app-review-showcase to claim a free ticket." Add a second entry, "Organizer", with `ASC_DEMO_ORGANIZER_EMAIL` / `ASC_DEMO_ORGANIZER_PASSWORD` and the note "Profile → View as: Organizer to see the dashboard and scanner." |
| **Ads** | **No, my app does not contain ads** |
| **Content rating** | follow `content-rating.md` |
| **Target audience and content** | **18 and over** only; "appeal to children" → No |
| **News apps** | **No** |
| **COVID-19 contact tracing and status apps** | **My app is not a publicly available COVID-19 contact tracing or status app** |
| **Data safety** | follow `data-safety.md` (needs the account-deletion URL first) |
| **Government apps** | **No** |
| **Financial features** | **My app doesn't provide any financial features**. Selling tickets for real-world events is commerce, not a financial service. Organizer payouts are settlements of the organizer's own sales through Stripe Connect / MonCash, not a money-transfer, wallet, lending or banking feature. Do NOT tick "Payments / money transfer" or "Digital wallets". |
| **Health apps** | **My app does not have any health features** |
| **Advertising ID** | **No** (the app does not use the advertising ID; no ads SDK). If Play flags `com.google.android.gms.permission.AD_ID` in the manifest after the upload, answer **Yes → purposes: none apply** or remove the permission (see §7). |
| **Photo and video permissions** | Only shown if the AAB requests `READ_MEDIA_IMAGES/VIDEO`. If it does: the app picks photos one at a time (avatar, poster, ID), so Play will ask you to use the system photo picker. Remove the permission (§7) rather than declare it. |

Payments policy note: Play Billing is **not** required. Google's Payments policy exempts
payment for physical goods and services, which includes tickets to in-person events.

## 4. Upload the first AAB manually (Internal testing)
The first upload must go through the web UI. The API, and so `eas submit`, cannot create the app's first release.

1. Download the AAB from the EAS build page:
   https://expo.dev/accounts/edlight/projects/tikem/builds/84113ec0-08c3-458d-8d33-9ad09a3dffc8
   (versionCode **2**, package `co.tikem.mobile`)
2. **Test and release → Testing → Internal testing → Create new release**
3. **Play App Signing:** when prompted, choose **Use Google-generated key** (recommended) → **Continue**.
   EAS signs with its upload key, and Google re-signs for distribution. After enrolment, copy
   the **App signing key certificate SHA-256** (Setup → App signing) for §6.
4. Drop the `.aab` in **App bundles**. Release name: `1.0.0 (2)`. Release notes (en-US):
   `First release of Tikèm for Android.` → **Next** → **Save and publish** (internal track only).
5. **Testers** tab → create an email list (yourself plus the team) → copy the opt-in link and install from Play.

## 5. Service account for `eas submit --platform android`
1. Google Cloud Console (https://console.cloud.google.com), project **event-haiti** (the one
   that already hosts `tikem-wallet@…`) or a new one → **APIs & Services → Library** → enable
   **Google Play Android Developer API**.
2. **IAM & Admin → Service accounts → Create service account**: name `eas-submit`, no project
   roles → **Done**.
3. Open it → **Keys → Add key → Create new key → JSON** → download. Save it as
   `mobile/google-play-service-account.json` and add that path to `mobile/.gitignore`. Never commit it.
4. Play Console → **Users and permissions → Invite new users** → paste the service-account
   email (`eas-submit@<project>.iam.gserviceaccount.com`) → **App permissions → Add app →
   Tikèm** → tick **Release apps to testing tracks**, **Release to production, exclude devices,
   and use Play App Signing**, and **Manage testing tracks and edit tester lists** → **Invite user** → **Send invitation**.
   (It can take up to 24 h before the first API call succeeds.)

Then add this to `mobile/eas.json` under `submit.production`, next to the existing `ios` block:

```json
"android": {
  "serviceAccountKeyPath": "./google-play-service-account.json",
  "track": "internal",
  "releaseStatus": "draft"
}
```

- `releaseStatus: "draft"` is **required** until the app's first production release is live.
  Play rejects any other status on an app that is still in draft. After launch, switch to
  `"completed"` (or keep `draft` and press *Roll out* by hand).
- Or keep the JSON out of the repo: upload it as an EAS secret file
  (`eas env:create --scope project --name GOOGLE_SERVICE_ACCOUNT_KEY --type file --value ./google-play-service-account.json --environment production`)
  and set `"serviceAccountKeyPath": "$GOOGLE_SERVICE_ACCOUNT_KEY"`.

Future builds: `cd mobile && eas build --platform android --profile production --auto-submit`,
or `eas submit --platform android --latest`.

## 6. App Links (verified links to tikem.co)
`app.json` declares `autoVerify` intent filters for tikem.co / www.tikem.co. The route
`app/api/well-known/assetlinks/route.ts` serves `/.well-known/assetlinks.json` from the Vercel
env var **`ANDROID_SHA256_CERT_FINGERPRINTS`** (comma-separated). It returns `[]` today, so the
variable is unset. Set it to the **App signing key SHA-256** from §4.3 plus the EAS upload key's
(`eas credentials -p android` shows it), then **redeploy** Vercel.
Without it, event links open in the browser instead of the app. Check it with
Play Console → **Grow users → Deep links**.

## 7. Before promoting to Production
- [ ] Account deletion exists in-app **and** at a public URL (Data safety needs the URL).
- [ ] Review the merged manifest (**App bundle explorer → Permissions**). Expected: INTERNET,
      CAMERA, RECORD_AUDIO, READ_CONTACTS, POST_NOTIFICATIONS, VIBRATE. Anything like
      `READ_MEDIA_IMAGES`, `READ_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW` or `AD_ID` should be
      removed with `expo.android.blockedPermissions` in `app.json` before the production build.
- [ ] Internal-test on a real Android phone: Google sign-in, Google Pay sheet, MonCash web
      checkout, QR scanner, push notification.
- [ ] Google Wallet: the issuer is still in **demo mode**, so "Add to Google Wallet" only works
      for console test accounts. Request publishing access in the Google Pay & Wallet console, or hide
      the button on Android, before production.
- [ ] **Production → Create new release** → promote the internal release → **Countries/regions**:
      add all (or at least United States, Canada, France, Haiti) → **Send for review**. Your first
      review usually takes several days.
