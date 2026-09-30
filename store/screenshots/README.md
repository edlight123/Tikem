# Store screenshots

Captured 2026-09-30 from the Tikèm mobile app (Expo Go, iPhone 17 Pro Max simulator, iOS 26.5) against production data. Status bar overridden to 9:41 / full signal / charged. No captions or device frames.

- `ios-6.9/`: App Store 6.9" iPhone slot, 1320x2868 PNG, no alpha.
- `play-phone/`: Google Play phone screenshots, 1434x2868 PNG (exactly 2:1). These are the same captures with #0A0A0A bars added on the left and right, so nothing is cropped.

| # | File | Shows | Store slot |
|---|------|-------|------------|
| 1 | `01-home.png` | Home: "for you" rail of real upcoming event posters (Konpa Cruise, Kreyòl Jazz) and the "this week" rail | App Store 1 / Play 1 |
| 2 | `02-event-detail.png` | Kreyòl Jazz event page (EdLight Initiative, Minton's Playhouse): poster, details, and a floating "Get Tickets from 39.96 USD" button | App Store 2 / Play 2 |
| 3 | `03-select-tickets.png` | Ticket selection sheet for Kreyòl Jazz: 2x General Admission, $79.61 total including the service fee, "Continue to Payment" | App Store 3 / Play 3 |
| 4 | `04-ticket-qr.png` | The demo attendee's ticket for Tikèm Showcase Night: branded QR code, Apple Wallet, save, transfer | App Store 4 / Play 4 |
| 5 | `05-discover.png` | Discover feed: full-width poster card, search bar, For You / Following / Saved | App Store 5 / Play 5 |
| 6 | `06-search.png` | Search: featured events in the United States | App Store 6 / Play 6 |
| 7 | `07-organizer-dashboard.png` | Organizer dashboard (demo organizer): getting-started checklist, weekly stats, quick actions | App Store 7 / Play 7 |
| 8 | `08-organizer-event-tools.png` | Event management for the demo event: scan, team, attendees, messages, earnings, promo codes, promoters, sales progress, event controls | App Store 8 / Play 8 |

The only names on screen are demo accounts ("App Review Attendee", "Tikèm App Review") and public event or organizer info.

Not included:
- The card payment step, because Stripe native does not run in Expo Go.
- The Scan tab, because it only shows "No events happening today" and the camera does not work in the simulator.
