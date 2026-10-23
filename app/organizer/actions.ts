'use server'

import { requireAuth } from '@/lib/auth'
import { updateUserRole } from '@/lib/firestore/user-profile-server'
import { revalidatePath } from 'next/cache'

export async function becomeOrganizer(details?: {
  organizationName?: string
  organizationLogo?: string
}) {
  const { user, error } = await requireAuth()

  if (error || !user) {
    throw new Error('Not authenticated')
  }

  const result = await updateUserRole(user.id, 'organizer')

  if (!result.success) {
    throw new Error(result.error || 'Failed to update role')
  }

  // Persist the brand name / logo captured during the create-organization step.
  const orgName = details?.organizationName?.trim()
  const orgLogo = details?.organizationLogo?.trim()
  if (orgName || orgLogo) {
    try {
      const patch: Record<string, unknown> = {}
      if (orgName) patch.organization_name = orgName
      if (orgLogo) patch.organization_logo = orgLogo
      // Canonical public_profiles/{uid} + the users/{uid} copy, and
      // organizers/{uid} so the settings page opens filled in
      // (lib/profile/org-brand.ts).
      const { writeOrgBrandAdmin } = await import('@/lib/firestore/org-brand-server')
      await writeOrgBrandAdmin(user.id, patch, { organizers: true })
    } catch (e) {
      // Non-fatal: the role upgrade already succeeded; details can be set later in settings.
      console.error('Failed to save organization details on upgrade:', e)
    }
  }

  revalidatePath('/organizer')
  revalidatePath('/organizer/events')

  return { success: true }
}
