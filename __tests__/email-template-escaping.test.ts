/**
 * Every email template interpolates text an organizer or user typed (an event
 * title, a transfer message, a refund reason). Unescaped, that text renders as
 * live markup in the recipient's mail client. Each template must escape it.
 */
import {
  getTicketConfirmationEmail,
  getEventCreatedEmail,
  getRefundRequestEmail,
  getRefundProcessedEmail,
  getWaitlistNotificationEmail,
  getTicketTransferRequestEmail,
  getTicketTransferResponseEmail,
  getTicketTransferCancelledEmail,
  getEventUpdateEmail,
  getOrganizerReplyEmail,
  getBankVerificationDecisionEmail,
} from '@/lib/email'
import { escapeHtml } from '@/lib/html'

const EVIL = `<script>alert(1)</script><a href="https://evil.example">x</a>`

function assertEscaped(html: string) {
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('<a href="https://evil.example">')
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
}

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
  it('stringifies null/undefined/numbers safely', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
    expect(escapeHtml(3)).toBe('3')
  })
})

describe('email templates escape user-controlled text', () => {
  const cases: Array<[string, () => string]> = [
    [
      'ticket confirmation',
      () =>
        getTicketConfirmationEmail({
          attendeeName: EVIL,
          eventTitle: EVIL,
          eventDate: EVIL,
          eventVenue: EVIL,
          ticketId: 'abc',
          ticketTier: EVIL,
        }),
    ],
    [
      'event created',
      () => getEventCreatedEmail({ organizerName: EVIL, eventTitle: EVIL, eventDate: EVIL, eventId: 'e1' }),
    ],
    [
      'refund request',
      () =>
        getRefundRequestEmail({
          organizerName: EVIL,
          eventTitle: EVIL,
          attendeeEmail: EVIL,
          reason: EVIL,
          ticketId: EVIL,
          amount: 10,
        }),
    ],
    [
      'refund processed',
      () =>
        getRefundProcessedEmail({
          attendeeName: EVIL,
          eventTitle: EVIL,
          status: 'approved',
          refundAmount: 10,
          ticketId: EVIL,
        }),
    ],
    [
      'waitlist',
      () =>
        getWaitlistNotificationEmail({
          eventTitle: EVIL,
          eventDate: '2030-01-01T00:00:00Z',
          quantity: 2,
          eventId: 'e1',
        }),
    ],
    [
      'transfer request',
      () =>
        getTicketTransferRequestEmail({
          senderName: EVIL,
          senderEmail: EVIL,
          eventTitle: EVIL,
          eventDate: '2030-01-01T00:00:00Z',
          message: EVIL,
          transferToken: 'tok',
          expiresAt: '2030-01-01T00:00:00Z',
        }),
    ],
    [
      'transfer response',
      () =>
        getTicketTransferResponseEmail({
          recipientName: EVIL,
          eventTitle: EVIL,
          action: 'accepted',
          ticketId: 't1',
        }),
    ],
    ['transfer cancelled', () => getTicketTransferCancelledEmail({ eventTitle: EVIL, senderName: EVIL })],
    [
      'event update',
      () =>
        getEventUpdateEmail({
          attendeeName: EVIL,
          eventTitle: EVIL,
          updateTitle: EVIL,
          updateMessage: EVIL,
          eventId: 'e1',
        }),
    ],
    [
      'organizer reply',
      () =>
        getOrganizerReplyEmail({
          attendeeName: EVIL,
          organizerName: EVIL,
          eventTitle: EVIL,
          eventId: 'e1',
          question: EVIL,
          reply: EVIL,
        }),
    ],
    [
      'bank verification decision',
      () => getBankVerificationDecisionEmail({ organizerName: EVIL, decision: 'reject', reason: EVIL }),
    ],
  ]

  it.each(cases)('%s', (_name, render) => {
    assertEscaped(render())
  })

  it('path segments in links are URL-encoded, not injectable', () => {
    const html = getEventUpdateEmail({
      attendeeName: 'a',
      eventTitle: 'b',
      updateTitle: 'c',
      updateMessage: 'd',
      eventId: '"><script>x</script>',
    })
    expect(html).not.toContain('"><script>')
    expect(html).toContain('%22%3E%3Cscript%3E')
  })
})
