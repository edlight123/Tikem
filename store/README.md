# Tikèm store submission kit

Everything needed to put Tikèm (`co.tikem.mobile`) on the App Store and Google Play.
Copy lives in JSON, owner-only forms are written as click-by-click answers, and one script
pushes the App Store listing through the App Store Connect API.

```
store/
├── app-store/
│   ├── metadata.json      listing copy (en-US, fr-FR), categories, age rating, price, review contact
│   ├── review-notes.md    App Review notes (the NOTES block is what gets sent)
│   ├── app-privacy.md     App Privacy questionnaire: owner enters it in the ASC web UI
│   └── demo.env           reviewer logins + test event URL (gitignored, never commit)
├── google-play/
│   ├── listing.json       Play title / short / full description (en-US, fr-FR)
│   ├── data-safety.md     Data safety form, click-by-click
│   ├── content-rating.md  IARC questionnaire + target audience
│   ├── PLAY_CONSOLE_STEPS.md  first-release walkthrough, service account, eas.json
│   ├── icon-512.png, feature-graphic-1024x500.png
│   └── make-graphics.mjs  regenerates both images from mobile/assets
└── screenshots/
    ├── ios-6.9/           1320x2868, uploaded as APP_IPHONE_67
    └── play-phone/
scripts/asc-apply-metadata.mjs   dry-run / apply for App Store Connect
```

## What is automated vs owner-only

| Task | How |
|---|---|
| App Store description, keywords, promo text, URLs (en-US + fr-FR) | `asc-apply-metadata.mjs` |
| App name + subtitle + privacy URL (en-US + fr-FR) | script |
| Version string 1.0 → **1.0.0** (must match the build), copyright | script |
| Categories (Entertainment / Lifestyle) | script |
| Age rating questionnaire | script |
| Content rights declaration | script |
| Price = free, availability = all territories | script |
| App Review contact, demo account, notes | script (refuses while notes contain `TODO`) |
| Attach build 43 | script `--attach-build 43` |
| Screenshots (6.9") | script `--upload-screenshots` |
| **App Privacy labels** | **owner**, ASC web UI (`app-store/app-privacy.md`) |
| **Add for Review → Submit** | **owner**, ASC web UI |
| **Everything on Google Play** | **owner**, Play Console (`google-play/PLAY_CONSOLE_STEPS.md`); `eas submit` works only after the first manual upload + service account |

## Commands (run from the repo root)

```sh
node scripts/asc-apply-metadata.mjs                        # dry run: GETs only, prints the diff
node scripts/asc-apply-metadata.mjs --apply                # write listing, ratings, price, availability
node scripts/asc-apply-metadata.mjs --apply --attach-build 43 --upload-screenshots
node scripts/asc-apply-metadata.mjs                        # again: should print "= unchanged" everywhere
node store/google-play/make-graphics.mjs                   # rebuild the Play icon + feature graphic
```

Useful flags: `--only review,build`, `--screenshot-locales en-US,fr-FR`,
`--replace-screenshots`, `--territories USA,CAN,FRA,HTI`, `--allow-todo`.

## Blockers: fix before pressing Submit

1. **Account deletion (Apple 5.1.1(v), Play Data safety). MISSING.**
   The mobile app has no delete-account path (Profile ends at Sign out). The web Settings "Delete account"
   button is hard-`disabled`, and `components/profile/AccountCard.tsx` is a stub. The support FAQ
   tells people to use "Settings > Privacy & Security > Delete Account", which does not exist.
   Needed: a *Delete account* row in `mobile/screens/ProfileScreen.tsx` (below Sign out, confirm step)
   that calls a server route that deletes the Firebase Auth user and personal data. (`/api/gdpr/data`
   DELETE exists but is written against the old Supabase-style shim and has upcoming-ticket and
   upcoming-event guards. Verify it before wiring it up.) Plus a public page such as
   `https://www.tikem.co/account/delete` for Google Play.
2. **Report / block for user-generated content (Apple 1.2). MISSING.** Organizers publish events
   without pre-approval. Admins can unpublish events and ban organizers, but there is no in-app
   "Report event" or "Block user", and `event_reports` has no writer. Apple expects a report
   mechanism, a way to block abusive users, and timely action. Minimum fix: a *Report* action on
   EventDetail and OrganizerProfile that writes `event_reports` and increments `reports_count`
   (already read by the admin Reported tab), plus *Block* on profiles.
3. **Vague permission strings (Apple 5.1.1).** The built Info.plist has the defaults
   "Allow $(PRODUCT_NAME) to access your microphone" and "…your photos". Apple rejects these. Set them in
   `mobile/app.json` plugins, for example:
   `["expo-image-picker", { "photosPermission": "Tikèm uses your photos when you choose a profile picture, an event poster or an ID document." }]`
   and `["expo-camera", { "cameraPermission": "Tikèm uses the camera to scan tickets at the door, scan your card at checkout, and take the ID photo and selfie video that verify organizers before payout.", "microphonePermission": "Tikèm records a short, muted selfie video to verify organizers before payout. No audio is kept." }]`.
   `expo-image-picker` also writes camera and microphone defaults, so give it the same
   `cameraPermission` / `microphonePermission` strings to stop the plugins overwriting each other.
   Check the result with `npx expo prebuild -p ios --clean` and grep `ios/*/Info.plist`.
   The current camera string also leaves out ticket scanning and the selfie. Needs a new build (not OTA).
4. **Review notes contain `TODO`** for items 1 and 2. The script will not send them until you edit
   `app-store/review-notes.md` (or pass `--allow-todo`, which is not recommended).

Worth knowing (not blockers):
- Sign in with Apple parity (4.8) is **OK**: Log in and Sign up both show Google + Apple.
- Card checkout for paid events depends on organizers having live Stripe Connect accounts
  (none have re-onboarded yet). Review uses the free test event, so this does not block review.
- The app name changes from "Tikèm" to **"Tikèm: Events & Tickets"** on the store (the home-screen
  name stays "Tikèm"). Edit `metadata.json` if you prefer the bare name.
- The review contact phone is the support line (+1 631-629-5402). Change it in `metadata.json` if Apple
  should reach you directly.

## Checklist

### App Store
- [ ] Fix blockers 1 to 3, ship them in a build, and use that build number instead of 43
- [ ] Edit the `TODO` paragraphs in `app-store/review-notes.md`
- [ ] Screenshots in `store/screenshots/ios-6.9/` (3 to 10 PNG/JPG, 1320x2868, no alpha)
- [ ] `node scripts/asc-apply-metadata.mjs` → read the diff
- [ ] `node scripts/asc-apply-metadata.mjs --apply --attach-build <n> --upload-screenshots`
- [ ] Re-run the dry run: expect no differences
- [ ] ASC → App Privacy → enter `app-privacy.md` → **Publish**
- [ ] ASC → version 1.0.0 → check the age rating Apple computed (expect 13+), the export-compliance answer (the build says no non-exempt encryption), and the screenshots
- [ ] Sign in to both demo accounts on build <n> and claim the free ticket
- [ ] **Add for Review → Submit to App Review**

### Google Play
- [ ] Account deletion URL live (blocker 1)
- [ ] Follow `google-play/PLAY_CONSOLE_STEPS.md` §1 to §4 (create app, listing, app content, internal AAB)
- [ ] §5 service account + `submit.production.android` in `mobile/eas.json`
- [ ] §6 set `ANDROID_SHA256_CERT_FINGERPRINTS` on Vercel and redeploy
- [ ] §7 manifest/permissions check, device test, Google Wallet decision → Production review
