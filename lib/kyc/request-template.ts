/**
 * The blank KYC request steps, shared by the web client (lib/verification.ts)
 * and the server restart route (/api/organizer/reset-verification). Pure data,
 * no Firebase import, so it is safe in both bundles.
 */
export function blankVerificationSteps() {
  return {
    organizerInfo: {
      id: 'organizerInfo',
      title: 'Organizer Information',
      description: 'Basic information about you and your organization',
      status: 'incomplete' as const,
      required: true,
      fields: {},
      missingFields: ['full_name', 'phone', 'organization_name'],
    },
    governmentId: {
      id: 'governmentId',
      title: 'Government ID Upload',
      description: 'Upload a valid government-issued ID (front and back)',
      status: 'incomplete' as const,
      required: true,
      fields: {},
      missingFields: ['id_front', 'id_back'],
    },
    selfie: {
      id: 'selfie',
      title: 'Identity Verification',
      description: 'Take a selfie holding your ID for verification',
      status: 'incomplete' as const,
      required: true,
      fields: {},
    },
    businessDetails: {
      id: 'businessDetails',
      title: 'Business Details',
      description: 'Optional business registration and tax information',
      status: 'incomplete' as const,
      required: false,
      fields: {},
    },
    payoutSetup: {
      id: 'payoutSetup',
      title: 'Payout Setup',
      description: 'Configure how you receive payments (can be set up later)',
      status: 'incomplete' as const,
      required: false,
      fields: {},
    },
  }
}

/** Statuses in which the OWNER may still edit steps/files (mirrors firestore.rules). */
export const OWNER_EDITABLE_STATUSES = ['in_progress', 'not_started', 'changes_requested'] as const

/** Statuses from which /api/organizer/submit-verification accepts a submission. */
export const SUBMITTABLE_STATUSES = ['in_progress', 'not_started', 'changes_requested', ''] as const

/** Statuses from which /api/organizer/reset-verification starts a fresh request. */
export const RESTARTABLE_STATUSES = ['rejected', 'changes_requested', 'in_progress', 'not_started', ''] as const
