import { escapeICSText, generateICSFile } from '@/lib/calendar'
import { phoneToE164 } from '@/types/social'
import { hashPhoneVerificationCode, phoneVerificationCodeMatches } from '@/lib/phone-verification-code'

// CSV cell escaping moved with the exports to Excel/PDF: see __tests__/exports.test.ts.

describe('ICS escaping', () => {
  it('stops CRLF from injecting properties', () => {
    const ics = generateICSFile({
      id: 'e1',
      title: 'Party\r\nATTACH:http://evil',
      description: 'x;y,z',
      start_datetime: '2026-10-05T20:00:00Z',
      end_datetime: null,
      venue_name: 'Venue',
      address: null,
      city: 'PAP',
    })
    expect(ics.split('\r\n').some((l) => l.startsWith('ATTACH'))).toBe(false)
    expect(ics).toContain('SUMMARY:Party\\nATTACH:http://evil')
    const B = String.fromCharCode(92)
    expect(escapeICSText(`a;b,c${B}d`)).toBe(`a${B};b${B},c${B}${B}d`)
  })
})

describe('phoneToE164', () => {
  it('normalises the supported shapes', () => {
    expect(phoneToE164('+509 3712-3456')).toBe('+50937123456')
    expect(phoneToE164('0050937123456')).toBe('+50937123456')
    expect(phoneToE164('3712 3456')).toBe('+50937123456')
    expect(phoneToE164('(305) 555-1234')).toBe('+13055551234')
    expect(phoneToE164('1 305 555 1234')).toBe('+13055551234')
  })
  it('rejects ambiguous or malformed numbers', () => {
    expect(phoneToE164('12345')).toBe('')
    expect(phoneToE164('')).toBe('')
    expect(phoneToE164('+0123456789')).toBe('')
  })
})

describe('payout phone verification code hash', () => {
  it('matches only the right organizer and code', () => {
    const h = hashPhoneVerificationCode('org1', '123456')
    expect(phoneVerificationCodeMatches('org1', '123456', h)).toBe(true)
    expect(phoneVerificationCodeMatches('org1', '654321', h)).toBe(false)
    expect(phoneVerificationCodeMatches('org2', '123456', h)).toBe(false)
    expect(phoneVerificationCodeMatches('org1', '123456', undefined)).toBe(false)
  })
})
