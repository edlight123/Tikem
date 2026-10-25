import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { requireOrg } from '@/lib/organizer/context';
import { safeExternalUrl } from '@/lib/safeUrl';
import { writeOrgBrandAdmin } from '@/lib/firestore/org-brand-server';

const MAX_LINK_LENGTH = 500;
const HANDLE_RE = /^@?[A-Za-z0-9._-]{1,100}$/;

/**
 * A social field is "username or URL". A bare handle is stored as typed; a
 * value that looks like a link (has a scheme, a slash, or a dot-host) must pass
 * safeExternalUrl, so a `javascript:` URL can never reach an <a href>.
 * Returns '' for empty, the normalised value, or null when invalid.
 */
function cleanSocial(raw: unknown): string | null {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return '';
  if (s.length > MAX_LINK_LENGTH) return null;
  // Handles (incl. dotted ones like john.doe) carry no scheme or slash.
  if (HANDLE_RE.test(s)) return s;
  return safeExternalUrl(s);
}

function storageBucketName(): string {
  const raw = process.env.FIREBASE_STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '';
  return raw.startsWith('gs://') ? raw.slice('gs://'.length) : raw;
}

/**
 * A logo must be an https URL in OUR Firebase Storage bucket (what
 * upload-logo and the app's uploader produce), never an arbitrary host.
 * Returns '' to clear, the URL, or null when invalid.
 */
function cleanLogoUrl(raw: unknown): string | null {
  if (raw == null || raw === '') return '';
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const bucket = storageBucketName();
  if (url.protocol !== 'https:' || !bucket || url.username || url.password) return null;
  const ok =
    (url.hostname === 'storage.googleapis.com' && url.pathname.startsWith(`/${bucket}/`)) ||
    (url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(`/v0/b/${bucket}/o/`));
  return ok ? url.toString() : null;
}

/**
 * Update the ACTING org's profile (lib/organizer/context.ts): its owner, or a
 * team admin (manage_settings). Mobile sends X-Tikem-Org for a non-owner admin.
 *
 * Body (JSON), every key optional except as noted; only keys present are
 * written, so a partial body never blanks the rest:
 *   organization_name         required unless the body only sets the logo
 *   organization_logo         https URL in our Storage bucket, or '' to clear
 *   organization_type, organization_description, website,
 *   facebook, instagram, twitter, linkedin
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const org = await requireOrg('manage_settings');
    if (!org.ok) return org.response;
    const orgId = org.value.orgId;

    const body = (await request.json().catch(() => null)) || {};
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const {
      organization_name,
      organization_type,
      organization_description,
      website,
      facebook,
      instagram,
      twitter,
      linkedin,
      organization_logo,
    } = body;

    // Every link here is rendered as an href (admin console, public profile,
    // mobile). Reject anything that is not http(s) instead of storing it.
    let cleanWebsite = '';
    if (typeof website === 'string' && website.trim()) {
      const safe = website.trim().length <= MAX_LINK_LENGTH ? safeExternalUrl(website) : null;
      if (!safe) {
        return NextResponse.json({ error: 'Website must be a valid http(s) URL' }, { status: 400 });
      }
      cleanWebsite = safe;
    } else if (website != null && typeof website !== 'string') {
      return NextResponse.json({ error: 'Website must be a valid http(s) URL' }, { status: 400 });
    }

    const social: Record<string, string> = {};
    const socialInput = Object.entries({ facebook, instagram, twitter, linkedin }).filter(([key]) => has(key));
    for (const [key, value] of socialInput) {
      const cleaned = cleanSocial(value);
      if (cleaned === null) {
        return NextResponse.json(
          { error: `${key} must be a username or a valid http(s) URL` },
          { status: 400 }
        );
      }
      social[key] = cleaned;
    }

    let cleanLogo: string | null = null;
    if (has('organization_logo')) {
      cleanLogo = cleanLogoUrl(organization_logo);
      if (cleanLogo === null) {
        return NextResponse.json(
          { error: 'Logo must be an https URL from Tikem storage' },
          { status: 400 }
        );
      }
    }

    // Validate required fields (a logo-only update may leave the name alone).
    const logoOnly = has('organization_logo') && !has('organization_name');
    if (!logoOnly && (typeof organization_name !== 'string' || organization_name.trim().length === 0)) {
      return NextResponse.json(
        { error: 'Organization name is required' },
        { status: 400 }
      );
    }

    // Update the org's data in Firestore: only the keys the caller sent.
    const details: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (!logoOnly) details.organization_name = organization_name.trim();
    if (has('organization_type')) details.organization_type = typeof organization_type === 'string' ? organization_type : '';
    if (has('organization_description')) {
      details.organization_description =
        typeof organization_description === 'string' ? organization_description.trim() : '';
    }
    if (has('website')) details.website = cleanWebsite;
    // merge: true deep-merges the map, so only the networks sent are touched.
    if (socialInput.length) details.social_media = social;
    await adminDb.collection('organizers').doc(orgId).set(details, { merge: true });

    // The brand's canonical home is public_profiles/{orgId} (plus the
    // users/{orgId} copy the app and the event pages read): lib/profile/org-brand.ts.
    const brand: Record<string, unknown> = {};
    if (!logoOnly) brand.organization_name = organization_name.trim();
    if (cleanLogo !== null) brand.organization_logo = cleanLogo;
    await writeOrgBrandAdmin(orgId, brand, { organizers: true });

    return NextResponse.json({ 
      success: true,
      message: 'Organization details updated successfully' 
    });
  } catch (error) {
    console.error('Error updating organization:', error);
    return NextResponse.json(
      { error: 'Failed to update organization' },
      { status: 500 }
    );
  }
}

// The app sends partial updates as PATCH ({ organization_name? , organization_logo? }); same handler.
export const PATCH = PUT
