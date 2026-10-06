/**
 * Profile phone field (mobile/lib/profilePhone.ts) and the web picker's
 * legacy parse (lib/phoneCountries.fromE164). TestFlight 2026-10-06: a US
 * number stored as bare digits showed under the +509 chip.
 */
import {
  composeStoredPhone,
  readTypedPhone,
  splitStoredPhone,
} from '../mobile/lib/profilePhone'
import {
  MAX_PROFILE_IMAGE_BYTES,
  profileImageContentType,
  profileImagePath,
} from '../mobile/lib/profileImagePath'
import { fromE164, toE164 } from '../lib/phoneCountries'

describe('splitStoredPhone', () => {
  it('reads a bare 10-digit number as NANP, not Haiti (the reported bug)', () => {
    expect(splitStoredPhone('7654076400')).toEqual({ dial: '1', national: '7654076400' })
    expect(splitStoredPhone('(765) 407-6400', 'HT')).toEqual({ dial: '1', national: '7654076400' })
  })

  it('reads E.164 by its own prefix', () => {
    expect(splitStoredPhone('+17654076400')).toEqual({ dial: '1', national: '7654076400' })
    expect(splitStoredPhone('+50934125678')).toEqual({ dial: '509', national: '34125678' })
    expect(splitStoredPhone('+33612345678')).toEqual({ dial: '33', national: '612345678' })
    expect(splitStoredPhone('+590690123456')).toEqual({ dial: '590', national: '690123456' })
    expect(splitStoredPhone('+44 7700 900123')).toEqual({ dial: '44', national: '7700900123' })
    expect(splitStoredPhone('0050934125678')).toEqual({ dial: '509', national: '34125678' })
  })

  it('reads bare Haitian and prefixed-without-plus shapes', () => {
    expect(splitStoredPhone('34125678')).toEqual({ dial: '509', national: '34125678' })
    expect(splitStoredPhone('509 3412 5678')).toEqual({ dial: '509', national: '34125678' })
    expect(splitStoredPhone('17654076400')).toEqual({ dial: '1', national: '7654076400' })
  })

  it('uses the account country only for shapes it cannot place', () => {
    expect(splitStoredPhone('', 'US')).toEqual({ dial: '1', national: '' })
    expect(splitStoredPhone('', null)).toEqual({ dial: '509', national: '' })
    expect(splitStoredPhone('0612345678', 'FR')).toEqual({ dial: '33', national: '612345678' })
    expect(splitStoredPhone('12345', 'US')).toEqual({ dial: '1', national: '12345' })
  })
})

describe('composeStoredPhone', () => {
  it('stores E.164', () => {
    expect(composeStoredPhone('1', '765-407-6400')).toBe('+17654076400')
    expect(composeStoredPhone('509', '3412 5678')).toBe('+50934125678')
  })

  it('stores nothing for an empty number', () => {
    expect(composeStoredPhone('509', '')).toBe('')
    expect(composeStoredPhone('509', '  ')).toBe('')
  })

  it('cleans repeated codes, NANP leading 1 and French trunk 0', () => {
    expect(composeStoredPhone('509', '50934125678')).toBe('+50934125678')
    expect(composeStoredPhone('1', '17654076400')).toBe('+17654076400')
    expect(composeStoredPhone('33', '0612345678')).toBe('+33612345678')
  })

  it('round-trips with splitStoredPhone', () => {
    for (const v of ['+17654076400', '+50934125678', '+33612345678', '+590690123456']) {
      const { dial, national } = splitStoredPhone(v)
      expect(composeStoredPhone(dial, national)).toBe(v)
    }
  })
})

describe('readTypedPhone', () => {
  it('a pasted +number moves the chip', () => {
    expect(readTypedPhone('+1 765 407 6400', '509')).toEqual({ dial: '1', national: '7654076400' })
  })
  it('plain typing keeps the chip', () => {
    expect(readTypedPhone('3412-5678', '509')).toEqual({ dial: '509', national: '34125678' })
  })
})

describe('web fromE164 legacy values', () => {
  it('places a bare US number under US, not Haiti', () => {
    expect(fromE164('7654076400')).toEqual({ iso: 'US', national: '7654076400' })
    expect(fromE164('17654076400')).toEqual({ iso: 'US', national: '7654076400' })
    expect(toE164('US', fromE164('7654076400').national)).toBe('+17654076400')
  })
  it('keeps Haitian shapes under Haiti', () => {
    expect(fromE164('34125678')).toEqual({ iso: 'HT', national: '34125678' })
    expect(fromE164('50934125678')).toEqual({ iso: 'HT', national: '34125678' })
    expect(fromE164('+50934125678')).toEqual({ iso: 'HT', national: '34125678' })
  })
})

describe('profile image uploads', () => {
  it('both kinds go under profile-images/{uid}/ (the only prefix storage.rules opens)', () => {
    expect(profileImagePath('u1', 'avatar', 5)).toBe('profile-images/u1/avatar_5.jpg')
    expect(profileImagePath('u1', 'logo', 5)).toBe('profile-images/u1/org_logo_5.jpg')
  })
  it('always uploads with an image/* content type the rule accepts', () => {
    expect(profileImageContentType(undefined)).toBe('image/jpeg')
    expect(profileImageContentType('image/jpg')).toBe('image/jpeg')
    expect(profileImageContentType('image/png')).toBe('image/png')
    expect(profileImageContentType('application/octet-stream')).toBe('image/jpeg')
  })
  it('matches the 10 MB rule', () => {
    expect(MAX_PROFILE_IMAGE_BYTES).toBe(10 * 1024 * 1024)
  })
})
