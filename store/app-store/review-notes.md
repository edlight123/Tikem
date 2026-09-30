# App Review notes: Tikèm 1.0.0

The text between the two markers is what `scripts/asc-apply-metadata.mjs` sends as
**App Review Information → Notes** (Apple's limit is 4,000 characters). `{{PLACEHOLDERS}}`
are filled in from `store/app-store/demo.env` at apply time, so no password is committed.
The script refuses to apply the notes while any `TODO` marker is still in them.

The attendee login also goes into the **Sign-in required** fields (`demoAccountName` /
`demoAccountPassword`). The organizer login only appears in the notes.

<!-- NOTES-BEGIN -->
Tikèm is a ticketing app for real-world events (concerts, parties, festivals, community events) in Haiti and the Haitian diaspora. Attendees discover events and buy tickets; organizers publish events, sell tickets and scan them at the door.

DEMO ACCOUNTS (email + password; Sign in with Apple and Google are also offered)
Attendee: {{ASC_DEMO_EMAIL}} / {{ASC_DEMO_PASSWORD}}
Organizer: {{ASC_DEMO_ORGANIZER_EMAIL}} / {{ASC_DEMO_ORGANIZER_PASSWORD}}

TEST EVENT
"Tikèm Showcase Night" is a free, published event set up for review. It is unlisted, so it does not appear on Discover. Open it with this link (Safari hands it to the app through a universal link):
{{ASC_DEMO_EVENT_URL}}
You can also sign in as the organizer, switch to Profile > View as: Organizer, and open it from the My Events tab.

1. ATTENDEE FLOW
- Launch the app and sign in with the attendee account (Profile tab, or any step that needs an account).
- Open the test event link above.
- Tap Get Tickets (or RSVP), choose the free ticket and confirm. No payment is taken.
- Open the Tickets tab: the ticket shows a QR code (screen brightness goes up for scanning). Tap Add to Apple Wallet to add the pass.
- Browse the Home and Discover tabs to see public events by city.

2. ORGANIZER FLOW
- Sign out (Profile > Sign out) and sign in with the organizer account.
- Profile > View as: Organizer switches the tab bar to Dashboard, My Events and Scan: events, sales, attendees and earnings.
- Open the Scan tab (or the test event > Scan Tickets) to use the camera scanner. You can scan the QR from the attendee ticket on a second device, or check guests in by hand from the attendee list.
- The + tab starts the create-event flow. Publishing an event is free.

3. PAYMENTS (Guidelines 3.1.3(e) and 3.1.5)
Every ticket sold in Tikèm admits the holder to a physical, in-person event at a real venue. Under 3.1.3(e) (goods and services consumed outside the app) these are not in-app purchases, so card and Apple Pay payments run through Stripe, and MonCash (a Haitian mobile-money wallet) is offered only for events in Haiti. The app sells no digital content, subscriptions or unlocks. The free test event lets you complete checkout without being charged.
Organizers who sell paid tickets verify their identity once before payout (government ID and a short selfie video, reviewed by our team). The camera and microphone prompts only appear inside that flow and the ticket scanner; the recording is saved muted.

4. ACCOUNT DELETION (5.1.1(v))
TODO: Profile > Account > Delete account. This deletes the account and personal data (confirmation required). NOT YET BUILT: fill in the real path before submitting.

5. USER-GENERATED CONTENT (1.2)
Events are published by organizers. Our team moderates every event from an admin console and can unpublish events and ban organizers. TODO: in-app "Report event" and "Block user" controls, their location, and the 24-hour review commitment. NOT YET BUILT: fill in before submitting.
Support: https://www.tikem.co/support. Terms: https://www.tikem.co/legal/terms (objectionable content and abusive users are not tolerated).

6. SIGN-IN
Email and password, Sign in with Apple and Google Sign-In are offered side by side on both the Log in and Sign up screens (4.8).

7. OTHER PERMISSIONS
Contacts (optional, Friends screen): phone numbers are matched in real time to find friends already on Tikèm and are not stored. Push notifications: ticket confirmations, reminders and event updates. The app does not track users and has no ads.

Contact: Ted Jacquet, ted.jacquet@edlight.org
<!-- NOTES-END -->

## Before you submit

- [ ] Replace both `TODO` paragraphs (sections 4 and 5) once account deletion and report/block exist in the build you attach. Apple rejects apps that let people create an account but not delete it in the app (5.1.1(v)). Apple also expects report and block controls in apps with user-generated content (1.2).
- [ ] Sign in to both demo accounts on a real device with build 43. Confirm the free ticket can be claimed again. Delete the reviewer's old ticket if the event caps one per person.
- [ ] Keep the test event published and in the future until the app is approved. Move its date forward if review runs long.
- [ ] If the attendee account has 2FA or email verification, turn it off for the review accounts.
