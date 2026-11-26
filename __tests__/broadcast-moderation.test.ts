import { checkBroadcast, extractLinks, normalizeForModeration } from '@/lib/moderation/broadcast'

describe('organizer broadcast moderation', () => {
  it.each([
    { title: 'Doors at 8', message: 'Doors now open at 8pm. Parking at https://venue.example/parking' },
    { message: 'Bring your ID. See you Saturday!' },
    { message: 'Interac and cash accepted at the door. Doors 8.30pm, e.g. bring ID.' },
    { message: 'Full schedule on venue.example/schedule, see you there.' },
    { message: 'Questions? Write to info@venue.example and we will answer.' },
  ])('lets an ordinary update through: %j', (input) => {
    expect(checkBroadcast(input)).toEqual({ ok: true })
  })

  it.each([
    [{ message: '' }, 'empty'],
    [{ message: '​​' }, 'empty'],
    [{ message: 'x'.repeat(2001) }, 'too_long'],
    [{ title: 't'.repeat(121), message: 'ok' }, 'too_long'],
    [{ message: 'a https://a.example b https://b.example c https://c.example d https://d.example' }, 'too_many_links'],
    [{ message: 'a a.example b b.example c c.example d d.example' }, 'too_many_links'],
    [{ message: 'Details here http://venue.example/info' }, 'insecure_link'],
    [{ message: 'Details here ftp://venue.example/info' }, 'insecure_link'],
    [{ message: 'Details here https://bit.ly/abc123' }, 'shortened_link'],
    [{ message: 'Details here bit.ly/abc123 for the lineup' }, 'shortened_link'],
    [{ message: 'Please verify your account at https://evil.example/login' }, 'phishing'],
    [{ message: 'Send an Interac e-transfer to secure your seat https://pay.example' }, 'phishing'],
    [{ message: 'https://x.example' }, 'too_many_links'],
    [{ message: 'THIS EVENT IS GOING TO BE AMAZING DO NOT MISS IT EVERYONE' }, 'shouting'],
  ])('refuses %j as %s', (input, code) => {
    expect(checkBroadcast(input as any)).toEqual({ ok: false, code })
  })

  describe('bypasses that used to pass', () => {
    it.each([
      // A bare domain with any TLD, no scheme or www.
      'Log in at evil.xyz/login with your password to keep your seat.',
      // No link at all: a credential or payment request is enough.
      'Reply with your password so we can move your ticket.',
      'Send the balance by e-transfer to tickets.kompa@gmail.com before Friday.',
      'Buy two gift cards and send us the codes to confirm your table.',
      'Confirm your card number by replying to this email.',
      // Zero-width characters and full-width letters.
      'Re-enter your pass​word here: evil.xyz',
      'Your ｐａｓｓｗｏｒｄ is needed at the door app.',
      'Verify‌ your‍ account now.',
    ])('refuses %j as phishing', (message) => {
      expect(checkBroadcast({ message })).toEqual({ ok: false, code: 'phishing' })
    })

    it('finds bare and obfuscated links of any TLD', () => {
      expect(extractLinks('go to evil.xyz/login or evil[.]top or xn--80ak6aa92e.com today')).toEqual([
        'evil.xyz/login',
        'evil.top',
        'xn--80ak6aa92e.com',
      ])
      expect(extractLinks('write to me@site.example, see you at 8.30pm, e.g. tomorrow')).toEqual([])
      expect(checkBroadcast({ message: 'Lineup at tinyurl[.]com/abc, see you Saturday' })).toEqual({ ok: false, code: 'shortened_link' })
    })

    it('normalises before matching', () => {
      expect(normalizeForModeration('ｐａｓｓ​ｗｏｒｄ')).toBe('password')
    })
  })
})
