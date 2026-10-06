import { syncPublicProfileClient } from './public-profile-client'
import {
  type SocialLinks,
  type PrivacySettings,
  DEFAULT_PRIVACY,
  attendanceVisibilityUnset,
  sanitizeSocialLinks,
  sanitizePrivacy,
} from '@/types/social'

/**
 * BUNDLE: the Firebase imports below are deferred ON PURPOSE — do not hoist
 * them back to module scope.
 *
 * Seven client components import this module (the five components/profile/*
 * cards, app/profile/ProfileClient, and components/LocationDetectionBanner —
 * which LocationBannerWrapper renders on the MARKETING HOMEPAGE). A static
 * `import 'firebase/firestore'` here therefore put the Firestore SDK on the
 * first load of every page, including pages that never read a profile.
 *
 * Measured at the time of this change: 444KB of Firebase (three chunks —
 * 223 + 136 + 85KB) on the first load of every route, out of ~988KB of shared
 * JS. A route only sheds those chunks when its LAST static importer is
 * deferred, so every export in this file must resolve Firebase lazily — one
 * static import anywhere undoes the whole thing. (Reference point: /resources
 * went 350KB -> 167KB once its only importer was deferred.)
 *
 * The module namespaces are cached as promises, so a page that calls three of
 * these functions pays for the dynamic import once.
 */
let firestoreModule: Promise<typeof import('firebase/firestore')> | null = null
let clientModule: Promise<typeof import('@/lib/firebase/client')> | null = null

async function firebase() {
  const [fs, client] = await Promise.all([
    (firestoreModule ??= import('firebase/firestore')),
    (clientModule ??= import('@/lib/firebase/client')),
  ])
  return { fs, db: client.db }
}

export interface UserProfile {
  uid: string
  displayName: string
  email: string
  photoURL?: string
  phone?: string
  bio?: string
  socialLinks?: SocialLinks
  privacy?: PrivacySettings
  /** Appear in "people you may know" / "friends going". Top-level users field; missing = true. */
  discoverable?: boolean
  /**
   * True when the stored privacy has no attendance_visibility (the user never
   * chose; `privacy` above shows the 'friends' default). Read-only.
   */
  attendanceVisibilityUnset?: boolean
  /**
   * When the one-time "your friends can now see your events" notice was seen.
   * Writing ANY value through /api/profile/update stamps the server's time.
   */
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
 * Get user profile from Firestore (client-side)
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  try {
    const { fs, db } = await firebase()
    const userDoc = await fs.getDoc(fs.doc(db, 'users', uid))

    if (!userDoc.exists()) {
      return null
    }

    const data = userDoc.data()
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
    console.error('Error fetching user profile:', error)
    return null
  }
}

/**
 * Create user profile in Firestore (client-side)
 */
export async function createUserProfile(uid: string, profile: Partial<UserProfile>): Promise<void> {
  try {
    const { fs, db } = await firebase()
    const userRef = fs.doc(db, 'users', uid)

    await fs.setDoc(userRef, {
      display_name: profile.displayName || '',
      email: profile.email || '',
      photo_url: profile.photoURL || '',
      phone: profile.phone || '',
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
      created_at: fs.serverTimestamp(),
      updated_at: fs.serverTimestamp()
    })

    // H4: seed the cross-user-readable projection (best-effort).
    await syncPublicProfileClient(uid, {
      full_name: profile.displayName || '',
      photo_url: profile.photoURL || '',
    })
  } catch (error) {
    console.error('Error creating user profile:', error)
    throw error
  }
}

/**
 * Update user profile in Firestore (client-side)
 */
export async function updateUserProfile(uid: string, updates: Partial<UserProfile>): Promise<void> {
  try {
    const { fs, db } = await firebase()
    const userRef = fs.doc(db, 'users', uid)

    const updateData: any = {
      updated_at: fs.serverTimestamp()
    }

    // Use full_name to match server-side convention
    if (updates.displayName !== undefined) {
      updateData.full_name = updates.displayName
      updateData.display_name = updates.displayName // Keep both for compatibility
    }
    if (updates.phone !== undefined) {
      updateData.phone_number = updates.phone
      updateData.phone = updates.phone // Keep both for compatibility
    }
    if (updates.photoURL !== undefined) updateData.photo_url = updates.photoURL
    if (updates.bio !== undefined) updateData.bio = String(updates.bio).slice(0, 280)
    if (updates.socialLinks !== undefined) updateData.social_links = sanitizeSocialLinks(updates.socialLinks)
    if (updates.privacy !== undefined) updateData.privacy = sanitizePrivacy(updates.privacy)
    if (typeof updates.discoverable === 'boolean') updateData.discoverable = updates.discoverable
    if (updates.defaultCountry !== undefined) updateData.default_country = updates.defaultCountry
    if (updates.defaultCity !== undefined) updateData.default_city = updates.defaultCity
    if (updates.subareaType !== undefined) updateData.subarea_type = updates.subareaType
    if (updates.defaultSubarea !== undefined) updateData.default_subarea = updates.defaultSubarea
    if (updates.favoriteCategories !== undefined) updateData.favorite_categories = updates.favoriteCategories
    if (updates.language !== undefined) updateData.language = updates.language
    if (updates.notify !== undefined) updateData.notify = updates.notify

    await fs.updateDoc(userRef, updateData)

    // H4: mirror any SAFE fields that changed into the public projection.
    await syncPublicProfileClient(uid, updateData)
  } catch (error) {
    console.error('Error updating user profile:', error)
    throw error
  }
}
