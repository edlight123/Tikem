/**
 * The payout-blocked badge on the organizer's event row.
 *
 * This badge is the only place the Connect health sweep's finding becomes
 * visible in the product, so it is worth asserting it actually renders — a
 * field written by a cron that nothing displays is the failure mode this test
 * exists to prevent. Also pins the house rules: status reads as a dot plus a
 * label, never a filled pill.
 */
import { render, screen } from '@testing-library/react'
import OrganizerEventCard from '@/components/organizer/events-manager/OrganizerEventCard'

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: any) =>
      typeof fallback === 'string' ? fallback : key.split('.').pop(),
  }),
}))

jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: any) => <img alt={props.alt} />,
}))

const BASE = {
  id: 'evt_1',
  title: 'Kanaval 2026',
  start_datetime: '2026-12-01T20:00:00.000Z',
  is_published: true,
  tickets_sold: 4,
  total_tickets: 100,
  banner_image_url: 'https://example.test/p.jpg',
  ticket_tiers: [{ id: 't1', price: 20 }],
}

describe('OrganizerEventCard payout-blocked badge', () => {
  it('shows nothing when the payout account is healthy', () => {
    render(<OrganizerEventCard event={BASE as any} />)
    expect(screen.queryByText(/can't take payments/i)).not.toBeInTheDocument()
  })

  it('surfaces the badge when the sweep has flagged the event', () => {
    render(<OrganizerEventCard event={{ ...BASE, payout_blocked: true } as any} />)
    expect(screen.getByText(/can't take payments/i)).toBeInTheDocument()
  })

  it('carries the sweep\'s reason as a tooltip so the organizer knows what to fix', () => {
    const reason = 'Your Stripe payout account could not be found. Reconnect Stripe in Payout settings.'
    render(
      <OrganizerEventCard
        event={{ ...BASE, payout_blocked: true, payout_blocked_reason: reason } as any}
      />
    )
    expect(screen.getByText(/can't take payments/i).closest('span')).toHaveAttribute('title', reason)
  })

  it('renders as a dot plus label, never a filled pill (house rule)', () => {
    render(<OrganizerEventCard event={{ ...BASE, payout_blocked: true } as any} />)
    const chip = screen.getByText(/can't take payments/i).closest('span')!
    // No pill: nothing fully-rounded, no background fill on the chip itself.
    expect(chip.className).not.toMatch(/rounded-full/)
    expect(chip.className).not.toMatch(/\bbg-/)
    // The dot is the only fully-rounded thing, and it is decorative.
    const dot = chip.querySelector('span[aria-hidden]')
    expect(dot).toBeTruthy()
    expect(dot!.className).toMatch(/rounded-full/)
  })
})
