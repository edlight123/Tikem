/**
 * POST /api/support/request: the help-center form really reaches support@tikem.co.
 *
 * @jest-environment node
 */

const sent: any[] = []
let limited = false

jest.mock('@/lib/email', () => ({
  sendEmail: jest.fn(async (msg: any) => {
    sent.push(msg)
    return { success: true, messageId: 'm1' }
  }),
}))
jest.mock('@/lib/rate-limit', () => ({
  clientIp: () => '1.2.3.4',
  consumeRateLimit: jest.fn(async () => ({ limited })),
}))
jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn(async () => null) }))

import { POST } from '@/app/api/support/request/route'
import { consumeRateLimit } from '@/lib/rate-limit'

const NASTY = '<a href="https://evil.example">Verify your bank</a>'

function req(body: Record<string, any>) {
  return new Request('http://localhost/api/support/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  })
}

const valid = {
  name: `Jean ${NASTY}`,
  email: 'Jean@Example.com',
  topic: 'refund',
  subject: `My refund ${NASTY}`,
  message: `I need help with my refund please. ${NASTY}`,
  userType: 'attendee',
  lang: 'fr',
}

beforeEach(() => {
  sent.length = 0
  limited = false
  ;(consumeRateLimit as jest.Mock).mockClear()
})

describe('POST /api/support/request', () => {
  it('emails support@tikem.co with reply-to set to the requester, then a fixed confirmation', async () => {
    const res = await POST(req(valid))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.reference).toMatch(/^TK-[A-Z2-9]{6}$/)

    expect(sent).toHaveLength(2)
    const [inbox, confirmation] = sent
    expect(inbox.to).toBe('support@tikem.co')
    expect(inbox.replyTo).toBe('jean@example.com')
    expect(inbox.subject).toContain(data.reference)
    expect(inbox.html).toContain(data.reference)
    // Full text goes to us, but escaped: no live link from user input.
    expect(inbox.html).toContain('I need help with my refund')
    expect(inbox.html).not.toContain('<a href="https://evil.example">')

    expect(confirmation.to).toBe('jean@example.com')
    expect(confirmation.subject).toContain(data.reference)
    expect(confirmation.html).toContain(data.reference)
    // Unverified address: nothing the requester typed is echoed back.
    for (const typed of ['Jean', 'My refund', 'I need help', 'evil.example', 'Verify your bank']) {
      expect(confirmation.html).not.toContain(typed)
      expect(confirmation.subject).not.toContain(typed)
    }
    expect(confirmation.html).toContain('Remboursement') // French topic label
  })

  it('rate-limits per IP and per email, and sends nothing when limited', async () => {
    limited = true
    const res = await POST(req(valid))
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('rate_limited')
    expect(sent).toHaveLength(0)

    limited = false
    await POST(req(valid))
    const keys = (consumeRateLimit as jest.Mock).mock.calls.map((c) => c[0].key)
    expect(keys).toEqual(expect.arrayContaining(['support-request:ip:1.2.3.4', 'support-request:email:jean@example.com']))
  })

  it('drops honeypot submissions silently', async () => {
    const res = await POST(req({ ...valid, company: 'Bots Inc' }))
    expect(res.status).toBe(200)
    expect(sent).toHaveLength(0)
  })

  it('rejects an unknown topic', async () => {
    const res = await POST(req({ ...valid, topic: 'Refund Request' }))
    expect(res.status).toBe(400)
    expect(sent).toHaveLength(0)
  })
})
