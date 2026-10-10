import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { adminAuth, adminDb } from '@/lib/firebase/admin'
import { sendEmail } from '@/lib/email'
import { renderEmail, title, p, gap, codeBlock } from '@/lib/email-kit/layout'
import type { EmailLang } from '@/lib/email-kit/i18n'
import { resolveEmailLang } from '@/lib/email-kit/recipient'
import crypto from 'crypto'

const DOC_ID = 'payoutDetailsChangeVerification'
const CODE_TTL_MS = 10 * 60 * 1000
const RESEND_COOLDOWN_MS = 60 * 1000

const getRef = (organizerId: string) =>
  adminDb
    .collection('organizers')
    .doc(organizerId)
    .collection('security')
    .doc(DOC_ID)

const toIso = (value: any): string | null => {
  if (!value) return null
  if (value?.toDate && typeof value.toDate === 'function') return value.toDate().toISOString()
  if (typeof value === 'string') return value
  try {
    return new Date(value).toISOString()
  } catch {
    return null
  }
}

const CODE_COPY: Record<EmailLang, { subject: string; status: string; head: string; body: string; note: string; ignore: string }> = {
  en: {
    subject: 'Tikèm: Confirm payout details change',
    status: 'Security',
    head: 'Confirm your payout details change',
    body: 'Enter this code in Tikèm to confirm the change to your payout or bank details.',
    note: 'Expires in 10 minutes',
    ignore: 'If you did not ask for this change, ignore this email and check your account security. Your payout details stay as they are.',
  },
  fr: {
    subject: 'Tikèm : confirmez la modification de vos coordonnées de paiement',
    status: 'Sécurité',
    head: 'Confirmez la modification de vos coordonnées de paiement',
    body: 'Saisissez ce code dans Tikèm pour confirmer la modification de vos coordonnées de paiement ou bancaires.',
    note: 'Expire dans 10 minutes',
    ignore: "Si vous n'avez pas demandé cette modification, ignorez cet e-mail et vérifiez la sécurité de votre compte. Vos coordonnées de paiement restent inchangées.",
  },
  ht: {
    subject: 'Tikèm: konfime chanjman enfòmasyon peman ou',
    status: 'Sekirite',
    head: 'Konfime chanjman enfòmasyon peman ou',
    body: 'Antre kòd sa a nan Tikèm pou konfime chanjman enfòmasyon peman oswa labank ou.',
    note: 'Li ekspire nan 10 minit',
    ignore: 'Si se pa ou ki mande chanjman sa a, pa okipe imèl sa a epi tcheke sekirite kont ou. Enfòmasyon peman ou yo rete jan yo ye a.',
  },
}

function payoutCodeEmail(lang: EmailLang, code: string): { subject: string; html: string } {
  const t = CODE_COPY[lang]
  return {
    subject: t.subject,
    html: renderEmail({
      lang,
      title: t.head,
      preheader: `${t.body} ${t.note}.`,
      status: { label: t.status, tone: 'grey' },
      footer: 'account',
      blocks: [title(t.head, 34), gap(14), p(t.body), gap(4), codeBlock(code, t.note), gap(24), p(t.ignore)],
    }),
  }
}

const hashCode = (salt: string, code: string) =>
  crypto
    .createHash('sha256')
    .update(`${salt}:${code}`)
    .digest('hex')

export async function POST(_request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get('session')?.value
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const decodedClaims = await adminAuth.verifySessionCookie(sessionCookie, true)
    const organizerId = decodedClaims.uid

    const userDoc = await adminDb.collection('users').doc(organizerId).get()
    // The step-up code goes to the sign-in email, never the client-writable
    // profile copy (a stolen session could otherwise redirect it).
    // Sign-in email ONLY, and only once verified. The profile copy is
    // client-writable, so falling back to it would let a stolen session send
    // the step-up code to an attacker's inbox.
    const email =
      (decodedClaims as any)?.email_verified === true ? (decodedClaims as any)?.email || null : null

    if (!email) {
      return NextResponse.json({ error: 'A verified sign-in email is required to change payout details' }, { status: 400 })
    }

    const ref = getRef(organizerId)
    const existing = await ref.get()
    if (existing.exists) {
      const sentAtIso = toIso((existing.data() as any)?.sentAt)
      if (sentAtIso) {
        const sentAtMs = new Date(sentAtIso).getTime()
        if (Number.isFinite(sentAtMs) && Date.now() - sentAtMs < RESEND_COOLDOWN_MS) {
          return NextResponse.json(
            { error: 'Please wait a moment before requesting another code.' },
            { status: 429 }
          )
        }
      }
    }

    const verificationCode = crypto.randomInt(100000, 1000000).toString()
    const salt = crypto.randomBytes(16).toString('hex')
    const codeHash = hashCode(salt, verificationCode)

    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString()

    const lang = await resolveEmailLang({
      explicit: userDoc.exists ? (userDoc.data() as any)?.language : null,
      userId: organizerId,
      email,
    })
    const { subject, html } = payoutCodeEmail(lang, verificationCode)

    const emailResult = await sendEmail({
      to: email,
      subject,
      html,
    })

    const isDev = process.env.NODE_ENV === 'development'

    if (!emailResult.success && !isDev) {
      return NextResponse.json(
        { error: 'Email delivery is not configured. Please contact support.' },
        { status: 500 }
      )
    }

    // Store only after successful send (or in dev).
    await ref.set(
      {
        type: 'payout_details_change',
        sentTo: email,
        sentAt: new Date().toISOString(),
        expiresAt,
        verifiedUntil: null,
        codeHash,
        salt,
        // A fresh code gets a fresh attempt budget (the verify route wipes the
        // code after 5 wrong guesses).
        failedAttempts: 0,
      },
      { merge: true }
    )

    return NextResponse.json({
      success: true,
      message: 'Verification code sent',
      debugCode: isDev ? verificationCode : undefined,
    })
  } catch (error: any) {
    console.error('Error sending payout change email code:', error)
    return NextResponse.json(
      { error: 'Failed to send verification code', message: error?.message },
      { status: 500 }
    )
  }
}
