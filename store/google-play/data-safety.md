# Play Console: Data safety form, click-by-click

Play Console → **Tikèm** → **Policy and programs → App content → Data safety → Start**.
The answers are derived from the same code audit as `store/app-store/app-privacy.md`. The
two forms differ in one place: **Google counts data that leaves the device as "collected"
even when it is only processed ephemerally**. That is why Contacts is declared here but not on Apple.

---

## Page 1: Overview
Read, then **Next**.

## Page 2: Data collection and security

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only: Firebase, tikem.co API, Stripe; `NSAllowsArbitraryLoads` false) |
| Which of the following methods of account creation does your app support? | ☑ **Username and password**, ☑ **OAuth** (Google, Sign in with Apple), ☐ Other |
| Add a link that users can use to request that their account and associated data is deleted | **BLOCKER:** needs a page on tikem.co. Suggested: `https://www.tikem.co/account/delete`, which explains the in-app path and offers an email request to privacy@tikem.co. That URL returns 404 today. |
| Do you provide a way for users to request that some or all of their data is deleted, without requiring them to delete their account? | **Yes** if privacy@tikem.co handles partial deletion requests (the privacy policy promises "request deletion of your data"); otherwise **No** |

**Next**

## Page 3: Data types (tick exactly these)

| Category | Data type | Tick |
|---|---|---|
| **Location** | Approximate / Precise | ☐ ☐ (device location is never read) |
| **Personal info** | Name | ☑ |
| | Email address | ☑ |
| | User IDs | ☑ |
| | Address | ☐ |
| | Phone number | ☑ |
| | Race and ethnicity · Political or religious beliefs · Sexual orientation | ☐ |
| | Other info | ☑ (government ID document for organizer verification) |
| **Financial info** | User payment info | ☑ |
| | Purchase history | ☑ |
| | Credit score | ☐ |
| | Other financial info | ☑ (organizer bank account / MonCash payout details) |
| **Health and fitness** | both | ☐ |
| **Messages** | Emails · SMS or MMS | ☐ ☐ |
| | Other in-app messages | ☑ (contact-organizer messages, event updates) |
| **Photos and videos** | Photos | ☑ (profile photo, posters, logo, ID photos) |
| | Videos | ☑ (muted liveness video, organizer verification) |
| **Audio files** | all | ☐ |
| **Files and docs** | | ☐ |
| **Calendar** | Calendar events | ☐ (Add to Calendar hands the event to the OS; nothing is read back) |
| **Contacts** | Contacts | ☑ (phone numbers sent to be matched, ephemeral, optional) |
| **App activity** | App interactions · In-app search history · Installed apps · Other actions | ☐ |
| | Other user-generated content | ☑ (events, reviews, bio, social handles) |
| **Web browsing** | | ☐ |
| **App info and performance** | Crash logs · Diagnostics · Other | ☐ (no crash/analytics SDK) |
| **Device or other IDs** | Device or other IDs | ☑ (Expo/FCM push token) |

**Next**

## Page 4: For each ticked type, answer the same 4 questions

Default answers (apply to every type unless the table below overrides):

1. **Is this data collected, shared, or both?** → **Collected** only.
   *Not shared*: sending data to service providers that process it for us (Firebase, Stripe,
   MonCash/Digicel for Haiti payments, Expo push) is exempt from "sharing" under Play's definition.
2. **Is this data processed ephemerally?** → **No**
3. **Is this data required for your app, or can users choose whether it's collected?** → see table
4. **Why is this user data collected?** → ☑ **App functionality** (plus the extras noted)

| Data type | Ephemeral | Required / Optional | Purposes |
|---|---|---|---|
| Name | No | Required | App functionality, Account management |
| Email address | No | Required | App functionality, Account management |
| User IDs | No | Required | App functionality, Account management |
| Phone number | No | Optional | App functionality |
| Other info (ID document) | No | Optional (organizers requesting payouts) | App functionality, Fraud prevention, security, and compliance |
| User payment info | No | Optional (only paid tickets) | App functionality, Fraud prevention, security, and compliance |
| Purchase history | No | Required | App functionality |
| Other financial info | No | Optional (organizers) | App functionality, Fraud prevention, security, and compliance |
| Other in-app messages | No | Optional | App functionality |
| Photos | No | Optional | App functionality |
| Videos | No | Optional (organizers) | Fraud prevention, security, and compliance |
| Contacts | **Yes** | Optional | App functionality |
| Other user-generated content | No | Optional | App functionality |
| Device or other IDs | No | Optional (push opt-in) | App functionality |

Never tick Analytics, Developer communications, Advertising or marketing, or Personalization
unless the app starts doing that.

**Next** → review the preview → **Submit**.

---

### Resulting "Data safety" card
- No data shared with third parties
- Collects: Personal info, Financial info, Messages, Photos and videos, Contacts, App activity, Device or other IDs
- Data is encrypted in transit
- You can request that data be deleted (only true once the deletion URL above exists)
