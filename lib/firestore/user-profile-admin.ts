/**
 * Server-side user profile operations using Firebase Admin SDK
 * This bypasses Firestore security rules and should only be used on the server
 */

import { adminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'
import { syncPublicProfileAdmin } from './public-profile'
import {
  type SocialLinks,
  type PrivacySettings,
  DEFAULT_PRIVACY,
  attendanceVisibilityUnset,
  sanitizeSocialLinks,
  sanitizePrivacy,
  phoneMatchKey,
} from '@/types/social'

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL?: string
  phone?: string
  bio?: string
  socialLinks?: SocialLinks
  privacy?: PrivacySettings
  /**
   * Can appear in other people's "people you may know" and "friends going"
   * (lib/social/suggestions.ts). Stored top-level as users/{uid}.discoverable;
   * missing means true. Turning it off only reduces exposure.
   */
  discoverable?: boolean
  /** True when the stored privacy has no attendance_visibility (shows the 'friends' default). Read-only. */
  attendanceVisibilityUnset?: boolean
  /** One-time attendance notice seen. Writing ANY truthy value stamps the server's time. */
  attendanceDefaultNoticeSeenAt?: string | boolean | null
  defaultCountry?: string
  defaultCity?: string
  subareaType?: 'COMMUNE' | 'NEIGHBORHOOD'
  defaultSubarea?: string
  favoriteCategories?: string[]
  language?: 'en' | 'fr' | 'ht'
  notify?: {
    reminders: boolean
    updates: boolean
    promos: boolean
  }
  role?: string
  isVerified?: boolean
  verificationStatus?: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Get user profile from Firestore (server-side with admin SDK)
 */
export async function getUserProfileAdmin(uid: string): Promise<UserProfile | null> {
  try {
    const userDoc = await adminDb.collection('users').doc(uid).get()
    
    if (!userDoc.exists) {
      return null
    }

    const data = userDoc.data()!
    return {
      uid: userDoc.id,
      displayName: data.full_name || data.display_name || data.displayName || '',
      email: data.email || '',
      photoURL: data.photo_url || data.photoURL || '',
      phone: data.phone_number || data.phone || '',
      bio: data.bio || '',
      socialLinks: data.social_links || {},
      privacy: { ...DEFAULT_PRIVACY, ...(data.privacy || {}) },
      discoverable: data.discoverable !== false,
      attendanceVisibilityUnset: attendanceVisibilityUnset(data.privacy),
      attendanceDefaultNoticeSeenAt: data.attendance_default_notice_seen_at || null,
      defaultCountry: data.default_country || data.defaultCountry || 'HT',
      defaultCity: data.default_city || data.defaultCity || '',
      subareaType: data.subarea_type || data.subareaType || 'COMMUNE',
      defaultSubarea: data.default_subarea || data.defaultSubarea || '',
      favoriteCategories: data.favorite_categories || data.favoriteCategories || [],
      language: data.language || 'en',
      notify: {
        reminders: data.notify?.reminders ?? true,
        updates: data.notify?.updates ?? true,
        promos: data.notify?.promos ?? false
      },
      role: data.role || 'attendee',
      isVerified: data.is_verified || false,
      verificationStatus: data.verification_status || 'none',
      createdAt: (data.created_at?.toDate?.() || data.createdAt?.toDate?.() || new Date()).toISOString(),
      updatedAt: (data.updated_at?.toDate?.() || data.updatedAt?.toDate?.() || new Date()).toISOString()
    }
  } catch (error) {
    console.error('Error fetching user profile (admin):', error)
    return null
  }
}

/**
 * Create user profile in Firestore (server-side with admin SDK)
 */
export async function createUserProfileAdmin(uid: string, profile: Partial<UserProfile>): Promise<void> {
  try {
    const userRef = adminDb.collection('users').doc(uid)
    
    await userRef.set({
      full_name: profile.displayName || '',
      display_name: profile.displayName || '',
      email: profile.email || '',
      photo_url: profile.photoURL || '',
      phone: profile.phone || '',
      phone_number: profile.phone || '',
      default_country: profile.defaultCountry || 'HT',
      default_city: profile.defaultCity || '',
      subarea_type: profile.subareaType || 'COMMUNE',
      default_subarea: profile.defaultSubarea || '',
      favorite_categories: profile.favoriteCategories || [],
      language: profile.language || 'en',
      notify: {
        reminders: profile.notify?.reminders ?? true,
        updates: profile.notify?.updates ?? true,
        promos: profile.notify?.promos ?? false
      },
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp()
    })

    // H4: mirror SAFE fields into the cross-user-readable projection.
    await syncPublicProfileAdmin(uid, {
      full_name: profile.displayName || '',
      photo_url: profile.photoURL || '',
    })
  } catch (error) {
    console.error('Error creating user profile (admin):', error)
    throw error
  }
}

/**
 * Update user profile in Firestore (server-side with admin SDK)
 */
export async function updateUserProfileAdmin(uid: string, updates: Partial<UserProfile>): Promise<void> {
  try {
    const userRef = adminDb.collection('users').doc(uid)
    
    const updateData: any = {
      updated_at: FieldValue.serverTimestamp()
    }

    if (updates.displayName !== undefined) {
      updateData.full_name = updates.displayName
      updateData.display_name = updates.displayName
    }
    if (updates.phone !== undefined) {
      updateData.phone_number = updates.phone
      updateData.phone = updates.phone
      updateData.phone_normalized = phoneMatchKey(updates.phone)
    }
    if (updates.photoURL !== undefined) updateData.photo_url = updates.photoURL
    if (updates.bio !== undefined) updateData.bio = String(updates.bio).slice(0, 280)
    if (updates.socialLinks !== undefined) updateData.social_links = sanitizeSocialLinks(updates.socialLinks)
    if (updates.privacy !== undefined) updateData.privacy = sanitizePrivacy(updates.privacy)
    if (typeof updates.discoverable === 'boolean') updateData.discoverable = updates.discoverable
    // The one-time attendance notice: the server stamps its own time.
    if (updates.attendanceDefaultNoticeSeenAt) updateData.attendance_default_notice_seen_at = new Date().toISOString()
    if (updates.defaultCountry !== undefined) updateData.default_country = updates.defaultCountry
    if (updates.defaultCity !== undefined) updateData.default_city = updates.defaultCity
    if (updates.subareaType !== undefined) updateData.subarea_type = updates.subareaType
    if (updates.defaultSubarea !== undefined) updateData.default_subarea = updates.defaultSubarea
    if (updates.favoriteCategories !== undefined) updateData.favorite_categories = updates.favoriteCategories
    if (updates.language !== undefined) updateData.language = updates.language
    if (updates.notify !== undefined) updateData.notify = updates.notify

    await userRef.update(updateData)

    // H4: mirror any SAFE fields that changed into the public projection.
    await syncPublicProfileAdmin(uid, updateData)
  } catch (error) {
    console.error('Error updating user profile (admin):', error)
    throw error
  }
}
