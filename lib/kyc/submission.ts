/**
 * Which stored KYC request can be submitted, and which Storage objects are its
 * evidence. Used by /api/organizer/submit-verification (server) — kept out of
 * the route file because a Next.js route may only export handlers.
 */
import { isOwnedVerificationPath } from '@/lib/kyc/identity'
import { SUBMITTABLE_STATUSES } from '@/lib/kyc/request-template'

const ALREADY_SUBMITTED = new Set(['pending', 'pending_review', 'in_review'])

type StoredSubmissionCheck =
  | { ok: true; paths: string[] }
  | { ok: false; status: number; error: string; code: string }

/**
 * Can this stored request be submitted, and which Storage objects are its
 * evidence? A passport is a single photo page, so it needs no back.
 */
export function validateStoredSubmission(data: Record<string, any>, uid: string): StoredSubmissionCheck {
  const status = String(data?.status || '').trim().toLowerCase()
  if (status === 'approved' || status === 'verified') {
    return { ok: false, status: 409, error: 'Your identity is already verified.', code: 'already_verified' }
  }
  if (ALREADY_SUBMITTED.has(status)) {
    return { ok: false, status: 409, error: 'Your verification is already under review.', code: 'already_submitted' }
  }
  if (status === 'rejected') {
    return {
      ok: false,
      status: 409,
      error: 'This verification was declined. Start a new application to submit again.',
      code: 'restart_required',
    }
  }
  if (!(SUBMITTABLE_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, status: 409, error: 'This verification cannot be submitted right now.', code: 'not_submittable' }
  }

  const files = data?.files || {}
  const isPassport = String(files?.governmentId?.documentType || '') === 'passport'
  const front = files?.governmentId?.front
  const back = files?.governmentId?.back
  const selfie = files?.selfie?.path
  const liveness = files?.liveness?.path

  if (!front || !selfie || (!isPassport && !back)) {
    return {
      ok: false,
      status: 400,
      error: isPassport
        ? 'Please upload your passport photo page and a selfie before submitting.'
        : 'Please upload the front and back of your ID and a selfie before submitting.',
      code: 'documents_required',
    }
  }

  const paths = [front, ...(isPassport ? (back ? [back] : []) : [back]), selfie, ...(liveness ? [liveness] : [])]
  for (const path of paths) {
    if (!isOwnedVerificationPath(path, uid)) {
      return {
        ok: false,
        status: 400,
        error: 'One of your documents could not be read. Please upload it again before submitting.',
        code: 'invalid_document_path',
      }
    }
  }
  return { ok: true, paths: paths as string[] }
}
