/**
 * Pure helpers for profile photo and organization logo uploads (no Firebase
 * or Expo imports, so they can be unit tested from the root Jest suite).
 *
 * BOTH images live under `profile-images/{uid}/`, the one prefix storage.rules
 * opens to the account owner (image/* types only, under 10 MB). The logo used
 * to be written to `org-logos/{uid}/…`, which has no rule and so falls through
 * to the default deny: every mobile logo upload failed with a permission
 * error, which is the "a user should be able to change their logo" report.
 */

export type ProfileImageKind = 'avatar' | 'logo';

/** storage.rules: `request.resource.size < 10 * 1024 * 1024`. */
export const MAX_PROFILE_IMAGE_BYTES = 10 * 1024 * 1024;

const ALLOWED = /^image\/(jpeg|png|webp|heic|heif|gif)$/;

export function profileImagePath(uid: string, kind: ProfileImageKind, now: number = Date.now()): string {
  const stem = kind === 'avatar' ? 'avatar' : 'org_logo';
  return `profile-images/${uid}/${stem}_${now}.jpg`;
}

/**
 * The content type to upload with. React Native blobs often carry no type,
 * and the rule rejects anything that is not image/*, so it is set explicitly:
 * the picker's own mime type when it is one the rule accepts, else JPEG (the
 * picker re-encodes an edited/cropped image as JPEG).
 */
export function profileImageContentType(mimeType?: string | null): string {
  const m = (mimeType || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  return ALLOWED.test(m) ? m : 'image/jpeg';
}
