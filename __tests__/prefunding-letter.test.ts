/**
 * The Digicel prefunding LETTER (two types), its cover email, the PDF render,
 * the admin-only letter + settings routes, and the settings validation.
 * Firestore and auth are mocked: nothing here reaches production or sends mail.
 *
 * Set LETTER_PDF_OUT=/some/dir to also write both sample letters there (for a
 * visual check).
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

let authResult: { user: any; error: string | null } = { user: { id: 'admin1', email: 'a@x.co' }, error: null }
jest.mock('@/lib/auth', () => ({ requireAdmin: async () => authResult }))

const docs: Record<string, any> = {}
const sets: Array<{ path: string; data: any; opts: any }> = []
jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (c: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: `${c}/${id}` in docs, data: () => docs[`${c}/${id}`] }),
        set: async (data: any, opts: any) => {
          sets.push({ path: `${c}/${id}`, data, opts })
        },
      }),
    }),
  },
}))
jest.mock('@/lib/admin/audit-log', () => ({ logAdminAction: jest.fn(async () => {}) }))
jest.mock('@/lib/moncash', () => ({ moncashPrefundedBalance: jest.fn() }))

import {
  DEFAULT_DIGICEL_PREFUNDING_CONTACTS,
  letterSettingsFromContacts,
  letterSettingsToDigicelPatch,
  parseLetterSettingsInput,
  resolvePrefundingPlanConfig,
} from '@/lib/payouts/prefunding-config'
import {
  BLANK_LINE,
  DIGICEL_BANK_ACCOUNTS,
  bankTransferDescription,
  buildPrefundingCoverEmail,
  buildPrefundingLetter,
  prefundingLetterText,
} from '@/lib/payouts/prefunding-letter'
import { renderPrefundingLetterPdf } from '@/lib/payouts/prefunding-letter-pdf'
import { GET as letterGET } from '@/app/api/admin/moncash-funding/requests/[id]/letter/route'
import { GET as settingsGET, PUT as settingsPUT } from '@/app/api/admin/moncash-funding/settings/route'

const at = new Date('2026-10-26T14:00:00Z') // Monday 10 AM Haiti
const reference = 'TKM-PF-20261026-ABCD'
const contacts = DEFAULT_DIGICEL_PREFUNDING_CONTACTS
const withMerchant = { ...contacts, merchantAccountNumber: '50912345' }

function built(input: Parameters<typeof buildPrefundingLetter>[0]) {
  const r = buildPrefundingLetter(input)
  if (!r.ok) throw new Error(r.error)
  return r.letter
}

describe('letter A: merchant account → prefunded', () => {
  const letter = built({ kind: 'merchant_transfer', amountHtg: 50_000, at, reference, contacts })
  const text = prefundingLetterText(letter)

  it('mirrors the template: place and French date, MonCash team, Réf, salutation, closing, signature', () => {
    expect(text).toContain('Port-au-Prince, le 26 octobre 2026')
    expect(letter.recipient).toEqual(['A L’EQUIPE MONCASH', 'Service Financier Mobile', 'MonCash Business Services', 'En ses bureaux. -'])
    expect(letter.refLine).toMatch(/^Réf : Transfert – /)
    expect(text).toContain('N/Réf : TKM-PF-20261026-ABCD')
    expect(letter.salutation).toBe('Monsieur,')
    expect(text).toContain('Par la Présente, PANTHEON SERVICES vous présente ses compliments')
    expect(letter.closing).toContain('elle vous prie de recevoir, Monsieur, ses salutations distinguées.')
    expect(letter.signature).toEqual({ label: 'Signature Autorisée', name: 'Stéphane LAINÉ', title: 'Représentant' })
  })

  it('asks to debit the merchant account and credit PREFUNDED No. 188721, amount in figures and words with 00/100', () => {
    expect(text).toContain('débiter son compte marchand MonCash No.')
    expect(text).toContain('pour un montant HTG 50 000,00 (cinquante mille gourdes 00/100)')
    expect(text).toContain('créditer le compte PANTHEON SERVICES PREFUNDED Account No. 188721 pour le même montant')
  })

  it('prints a visible blank line while the merchant account number is unknown, and says so', () => {
    expect(text).toContain(`compte marchand MonCash No. ${BLANK_LINE} pour`)
    expect(letter.missing).toEqual(['merchantAccountNumber'])
    const filled = built({ kind: 'merchant_transfer', amountHtg: 50_000, at, reference, contacts: withMerchant })
    expect(prefundingLetterText(filled)).toContain('compte marchand MonCash No. 50912345 pour')
    expect(filled.missing).toEqual([])
  })

  it('never prints a national ID: only the company patente / identification numbers', () => {
    expect(letter.letterhead.idsLine).toBe('Patente / Identification : 000-284-278-2 · 2607188721')
    expect(letter.letterhead.addressLine).toBe('N° 2, rue Corlette, route de Frères, Pétion-Ville, Haïti')
  })

  it('keeps the amount on one line (no-break spaces) and refuses non-whole amounts', () => {
    expect(letter.paragraphs[0]).toContain('HTG 50 000,00')
    expect(buildPrefundingLetter({ kind: 'merchant_transfer', amountHtg: 10.5, at, reference, contacts }).ok).toBe(false)
    expect(buildPrefundingLetter({ kind: 'merchant_transfer', amountHtg: 0, at, reference, contacts }).ok).toBe(false)
  })

  it('writes larger amounts in words', () => {
    const l = built({ kind: 'merchant_transfer', amountHtg: 1_284_000, at, reference, contacts })
    expect(prefundingLetterText(l)).toContain('(un million deux cent quatre-vingt-quatre mille gourdes 00/100)')
  })

  it('dates by the Haiti calendar day', () => {
    // 02:00 UTC on the 1st is still 31 December in Port-au-Prince.
    const l = built({ kind: 'merchant_transfer', amountHtg: 1000, at: new Date('2027-01-01T02:00:00Z'), reference, contacts })
    expect(l.placeDate).toBe('Port-au-Prince, le 31 décembre 2026')
  })
})

describe('letter B: bank transfer (the template as written)', () => {
  const letter = built({
    kind: 'bank_transfer',
    amountHtg: 75_000,
    at,
    reference,
    contacts,
    bankId: 'unibank',
    transactionNumber: 'FT26299ABC12',
  })
  const text = prefundingLetterText(letter)

  it('names the Digicel bank account, the amount in words (00/100) gourdes and the transaction number', () => {
    expect(text).toContain(
      'vous informe d’un transfert effectué sur le compte gourde No. 250-1021-1776024 domicilié à l’Unibank pour un montant HTG 75 000,00 (soixante-quinze mille 00/100) gourdes dont le numéro de transaction est FT26299ABC12.'
    )
    expect(text).toContain(
      'Prière de créditer le compte PANTHEON SERVICES PREFUNDED Account No. 188721 pour le même montant. Vous trouverez en annexe le reçu de la transaction.'
    )
    expect(letter.refLine).toBe('Réf : Transfert – Compte MonCash Prefunded')
  })

  it('offers exactly the four Digicel bank accounts from the 2023 notice and the contract', () => {
    expect(DIGICEL_BANK_ACCOUNTS.map((b) => [b.bank, b.accountName, b.accountNumber])).toEqual([
      ['Sogebank', 'MFS-PAIEMENTDIGICEL/SERVICEPAIMENTCLIENT', '7-0610-776-0'],
      ['Capital Bank', 'Unigestion Holding SA/MFS', '1884836'],
      ['Unibank', 'Unigestion Holding SA/MFS', '250-1021-1776024'],
      ['BNC', 'Unigestion Holding SA/MFS', '1660021480'],
    ])
  })

  it('the wire description must end with "PANTHEON SERVICES Prefunded"', () => {
    expect(bankTransferDescription(contacts.companyName)).toBe('PANTHEON SERVICES Prefunded')
    expect(bankTransferDescription(contacts.companyName).endsWith('PANTHEON SERVICES Prefunded')).toBe(true)
  })

  it('needs a known bank and a transaction number', () => {
    expect(buildPrefundingLetter({ kind: 'bank_transfer', amountHtg: 1000, at, reference, contacts, bankId: 'paypal', transactionNumber: 'X123' })).toEqual({
      ok: false,
      error: expect.stringContaining('bank account'),
    })
    expect(buildPrefundingLetter({ kind: 'bank_transfer', amountHtg: 1000, at, reference, contacts, bankId: 'bnc', transactionNumber: ' ' })).toEqual({
      ok: false,
      error: expect.stringContaining('transaction number'),
    })
  })
})

describe('cover email', () => {
  it('goes from info@edlight.org to MonCash, cc B2B and Business Services, and says the letter is attached', () => {
    const letter = built({ kind: 'merchant_transfer', amountHtg: 50_000, at, reference, contacts: withMerchant })
    const e = buildPrefundingCoverEmail({ letter, amountHtg: 50_000, reference, contacts: withMerchant })
    expect(e.from).toBe('info@edlight.org')
    expect(e.to).toEqual(['Hai_MFS_Request@digicelgroup.com'])
    expect(e.cc).toEqual(['hai_mfs_b2b_team@digicelgroup.com', 'MFS_B.Services@digicelgroup.com'])
    expect(e.body).toContain('Veuillez trouver en pièce jointe la lettre de PANTHEON SERVICES datée du 26 octobre 2026')
    expect(e.attachments).toEqual([letter.fileName])
    expect(letter.fileName).toBe('Renflouement-PANTHEON-SERVICES-Prefunded-2026-10-26-TKM-PF-20261026-ABCD.pdf')
    expect(e.gmailUrl.startsWith('https://mail.google.com/mail/?authuser=info%40edlight.org&view=cm')).toBe(true)
    expect(e.gmailUrl).toContain('cc=hai_mfs_b2b_team%40digicelgroup.com%2CMFS_B.Services%40digicelgroup.com')
  })

  it('for a bank transfer, says the receipt is attached too', () => {
    const input = { kind: 'bank_transfer' as const, amountHtg: 75_000, at, reference, contacts, bankId: 'sogebank', transactionNumber: 'TX-881' }
    const e = buildPrefundingCoverEmail({ ...input, letter: built(input) })
    expect(e.subject).toContain('Transaction TX-881')
    expect(e.body).toContain('et le reçu du virement de HTG 75 000,00 effectué sur le compte No. 7-0610-776-0 (Sogebank)')
    expect(e.attachments).toHaveLength(2)
  })
})

describe('PDF', () => {
  const samples = {
    'letter-A-merchant-transfer': built({ kind: 'merchant_transfer', amountHtg: 250_000, at, reference, contacts }),
    'letter-B-bank-transfer': built({
      kind: 'bank_transfer',
      amountHtg: 250_000,
      at,
      reference,
      contacts,
      bankId: 'sogebank',
      transactionNumber: 'FT26299ABC12',
    }),
  }

  it.each(Object.entries(samples))('%s renders a one-page PDF', (name, letter) => {
    const pdf = renderPrefundingLetterPdf(letter)
    const head = Buffer.from(pdf.slice(0, 5)).toString('latin1')
    expect(head).toBe('%PDF-')
    expect(pdf.byteLength).toBeGreaterThan(2000)
    expect((Buffer.from(pdf).toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(1)
    const out = process.env.LETTER_PDF_OUT
    if (out) fs.writeFileSync(path.join(out, `${name}.pdf`), pdf)
  })

  it('places an optional logo, and an unreadable one never blocks the letter', () => {
    const letter = samples['letter-A-merchant-transfer']
    const png = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'public/apple-touch-icon.png')))
    const withLogo = renderPrefundingLetterPdf(letter, { logo: { data: png, format: 'PNG' } })
    expect(withLogo.byteLength).toBeGreaterThan(renderPrefundingLetterPdf(letter).byteLength)
    const broken = renderPrefundingLetterPdf(letter, { logo: { data: new Uint8Array([1, 2, 3]), format: 'PNG' } })
    expect(Buffer.from(broken.slice(0, 5)).toString('latin1')).toBe('%PDF-')
    const out = process.env.LETTER_PDF_OUT
    if (out) fs.writeFileSync(path.join(out, 'letter-A-with-logo.pdf'), withLogo)
  })
})

describe('GET /api/admin/moncash-funding/requests/:id/letter', () => {
  const call = (id = 'req1') => letterGET({} as any, { params: Promise.resolve({ id }) })

  beforeEach(() => {
    authResult = { user: { id: 'admin1', email: 'a@x.co' }, error: null }
    docs['prefunding_requests/req1'] = { reference, amountHtg: 50_000, status: 'generated', letterType: 'merchant_transfer' }
    docs['config/payouts'] = { prefundingPlan: { digicel: { merchantAccountNumber: '50912345' } } }
  })

  it('refuses a signed-out visitor (401) and a non-admin (403)', async () => {
    authResult = { user: null, error: 'Not authenticated' }
    expect((await call()).status).toBe(401)
    authResult = { user: null, error: 'Admin access required' }
    expect((await call()).status).toBe(403)
  })

  it('returns the PDF to an admin', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('attachment; filename="Renflouement-PANTHEON-SERVICES-Prefunded-')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  })

  it('404s an unknown request and 409s a cancelled one', async () => {
    expect((await call('nope')).status).toBe(404)
    docs['prefunding_requests/req1'].status = 'cancelled'
    expect((await call()).status).toBe(409)
  })
})

describe('letter settings', () => {
  const valid = letterSettingsFromContacts(DEFAULT_DIGICEL_PREFUNDING_CONTACTS)

  it('defaults carry the contract facts, with the merchant number left blank', () => {
    expect(valid).toEqual({
      companyName: 'PANTHEON SERVICES',
      companyAddress: 'N° 2, rue Corlette, route de Frères, Pétion-Ville, Haïti',
      companyIds: ['000-284-278-2', '2607188721'],
      logoUrl: '',
      merchantAccountNumber: '',
      prefundedAccountNumber: '188721',
      signatoryName: 'Stéphane LAINÉ',
      signatoryTitle: 'Représentant',
      to: ['Hai_MFS_Request@digicelgroup.com'],
      cc: ['hai_mfs_b2b_team@digicelgroup.com', 'MFS_B.Services@digicelgroup.com'],
      fromEmail: 'info@edlight.org',
    })
    expect(parseLetterSettingsInput(valid)).toEqual({ ok: true, value: valid })
  })

  it('accepts comma-separated recipient lists and trims', () => {
    const r = parseLetterSettingsInput({ ...valid, cc: ' a@b.co ; c@d.co ', merchantAccountNumber: ' 509-1234 ' })
    expect(r.ok && r.value.cc).toEqual(['a@b.co', 'c@d.co'])
    expect(r.ok && r.value.merchantAccountNumber).toBe('509-1234')
  })

  it.each([
    ['companyName', { companyName: '' }],
    ['companyAddress', { companyAddress: 'x' }],
    ['companyIds', { companyIds: ['ok-123', 'no spaces allowed!'] }],
    ['logoUrl', { logoUrl: 'http://example.com/logo.png' }],
    ['merchantAccountNumber', { merchantAccountNumber: '12' }],
    ['prefundedAccountNumber', { prefundedAccountNumber: '' }],
    ['signatoryName', { signatoryName: '' }],
    ['to', { to: [] }],
    ['to', { to: ['not-an-email'] }],
    ['cc', { cc: ['x@'] }],
    ['fromEmail', { fromEmail: 'info at edlight' }],
  ])('rejects a bad %s', (field, over) => {
    const r = parseLetterSettingsInput({ ...valid, ...over })
    expect(r.ok).toBe(false)
    expect(!r.ok && Object.keys(r.errors)).toContain(field)
  })

  it('the saved patch keeps the signatory email and round-trips through the resolver', () => {
    const patch = letterSettingsToDigicelPatch({ ...valid, merchantAccountNumber: '50912345', signatoryTitle: '' }, DEFAULT_DIGICEL_PREFUNDING_CONTACTS)
    expect(patch.signatories).toEqual([{ name: 'Stéphane LAINÉ', email: 'stephane.laine@edlight.org' }])
    const c = resolvePrefundingPlanConfig({ digicel: patch })
    expect(c.digicel.merchantAccountNumber).toBe('50912345')
    expect(c.digicel.prefundedAccountNumber).toBe('188721')
  })

  it('the resolver repairs what is stored: empty prefunded number and non-https logo fall back', () => {
    const c = resolvePrefundingPlanConfig({ digicel: { prefundedAccountNumber: '', logoUrl: 'http://x.co/l.png' } })
    expect(c.digicel.prefundedAccountNumber).toBe('188721')
    expect(c.digicel.logoUrl).toBe('')
  })

  describe('API', () => {
    const put = (body: any) => settingsPUT({ json: async () => body } as any)
    beforeEach(() => {
      sets.length = 0
      authResult = { user: { id: 'admin1', email: 'a@x.co' }, error: null }
      delete docs['config/payouts']
    })

    it('is admin only', async () => {
      authResult = { user: null, error: 'Not authenticated' }
      expect((await settingsGET()).status).toBe(401)
      authResult = { user: null, error: 'Admin access required' }
      expect((await put(valid)).status).toBe(403)
      expect(sets).toHaveLength(0)
    })

    it('rejects invalid input with per-field errors and writes nothing', async () => {
      const res = await put({ ...valid, to: [] })
      expect(res.status).toBe(400)
      expect((await res.json()).errors).toHaveProperty('to')
      expect(sets).toHaveLength(0)
    })

    it('merges valid settings into config/payouts.prefundingPlan.digicel', async () => {
      const res = await put({ ...valid, merchantAccountNumber: '50912345' })
      expect(res.status).toBe(200)
      expect(sets).toEqual([
        {
          path: 'config/payouts',
          data: { prefundingPlan: { digicel: expect.objectContaining({ merchantAccountNumber: '50912345', prefundedAccountNumber: '188721' }) } },
          opts: { merge: true },
        },
      ])
      expect((await res.json()).changed).toEqual(['merchantAccountNumber'])
    })
  })
})
