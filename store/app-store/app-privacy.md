# App Privacy ("nutrition label"): click-by-click

App Store Connect → **Tikèm** → **App Privacy** (left sidebar, under *General*). Only the
owner can enter this. There is no public API for it. The answers below come from what the
mobile code in `mobile/` actually sends off the device, as of build 43.

**Privacy Policy URL:** `https://www.tikem.co/legal/privacy` (the apply script sets it; confirm it shows at the top of the page).
**User Privacy Choices URL:** leave empty.

---

## Step 1: "Do you or your third-party partners collect data from this app?"

**Yes, we collect data from this app.**

## Step 2: tick these data types (and only these)

| Section | Tick | Why (where in the code) |
|---|---|---|
| **Contact Info** | ☑ Name | Sign-up / profile (`AuthContext`, `ProfileScreen`), organizer info form |
| | ☑ Email Address | Firebase Auth account, ticket receipts |
| | ☑ Phone Number | Profile phone (optional), MonCash checkout and payouts, "discoverable by phone" |
| | ☐ Physical Address, ☐ Other User Contact Info | not collected from users (venue addresses belong to events) |
| **Health & Fitness** | ☐ none | |
| **Financial Info** | ☑ Payment Info | Card and Apple Pay entry through the Stripe SDK (`@stripe/stripe-react-native`) and MonCash checkout |
| | ☑ Other Financial Info | Organizer payout details: bank account/routing/IBAN/SWIFT, MonCash payout number (`OrganizerPayoutSettingsScreenV2`) |
| | ☐ Credit Info | |
| **Location** | ☐ Precise, ☐ Coarse | The app never reads device location. People *choose* a country/city for discovery, and that choice is stored as profile data, not location data. |
| **Sensitive Info** | ☐ | No racial, health, religious or biometric data. The liveness video is reviewed by a person; no face template is computed. |
| **Contacts** | ☐ | Phone numbers from the address book go to `/api/connections/match-contacts` and are matched in real time. The server does not store them. Apple's definition of "collect" excludes data handled only in real time. If that route ever starts storing or logging numbers, tick **Contacts**. |
| **User Content** | ☑ Emails or Text Messages | Contact-organizer messages and organizer event updates |
| | ☑ Photos or Videos | Profile photo, event posters, organization logo, ID document photos and the muted liveness video for organizer verification |
| | ☐ Audio Data | Liveness video is recorded muted |
| | ☐ Gameplay Content | |
| | ☐ Customer Support | Support happens by email/web, outside the app |
| | ☑ Other User Content | Event listings and descriptions, reviews and ratings, bio and social handles |
| **Browsing History** | ☐ | |
| **Search History** | ☐ | Searches run as queries and are not saved |
| **Identifiers** | ☑ User ID | Firebase UID on every record |
| | ☑ Device ID | Expo push token, stored so we can send ticket and event notifications |
| **Purchases** | ☑ Purchase History | Tickets, orders, refunds |
| **Usage Data** | ☐ Product Interaction, ☐ Advertising Data, ☐ Other Usage Data | No analytics SDK in `mobile/package.json`; no view/event tracking |
| **Diagnostics** | ☐ Crash Data, ☐ Performance Data, ☐ Other Diagnostic Data | No crash or analytics SDK |
| **Surroundings / Body** | ☐ | |
| **Other Data** | ☑ Other Data Types | Government ID document (organizer identity verification before payout) |

Click **Save**.

## Step 3: answer three questions for each ticked type

Use the **same answers for every type** unless a row below says otherwise:

1. **"How is this data used?"** → tick **App Functionality** only.
   - Add **Analytics** / **Product Personalization** / **Developer's Advertising or Marketing** only if you start using the data for that. Marketing emails to attendees would need **Developer's Advertising or Marketing** on *Email Address*.
   - For **Payment Info**, **Other Financial Info** and **Other Data Types** (ID), also tick **Other Purposes** if you want to be explicit about fraud prevention and identity verification. App Functionality alone is acceptable, because Apple lists fraud prevention and security under App Functionality.
2. **"Is this data linked to the user's identity?"** → **Yes** for every type (everything is stored against the account).
3. **"Do you or your third-party partners use this data for tracking?"** → **No** for every type.

## Step 4: tracking

On the summary page, **Data Used to Track You** must be empty and every type must appear
under **Data Linked to You**. The app shows no ads, has no ad or attribution SDK, never calls
`AppTrackingTransparency`, and shares no data with data brokers. Promoter links are
first-party attribution inside Tikèm, not tracking.

## Step 5: publish

Click **Publish** (top right of the App Privacy page). The label must be published before
the version can be submitted.

---

### Resulting label (for a sanity check)

**Data Linked to You:** Contact Info (name, email, phone) · Financial Info (payment info, other financial info) · User Content (messages, photos or videos, other user content) · Identifiers (user ID, device ID) · Purchases · Other Data.
**Data Used to Track You:** none.

### Notes

- Stripe's SDK also collects device signals for fraud prevention. Stripe publishes its own
  App Store privacy guidance ("App Store privacy details" in the Stripe docs). If it lists
  types not ticked here for the React Native SDK version in use (0.57), add them with
  purpose App Functionality, linked, no tracking.
- Google Sign-In and Sign in with Apple return name and email, which are already covered above.
- Re-check this page whenever an analytics/crash SDK (Sentry, Firebase Analytics, PostHog…)
  or device location is added.
