import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { requireOrg } from '@/lib/organizer/context';
import { cleanOrgLinks } from '@/lib/organizer/links';
import { writeOrgBrandAdmin } from '@/lib/firestore/org-brand-server';

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
 *   organization_name         may be left out of a partial update, never sent empty
 *   organization_logo         https URL in our Storage bucket, or '' to clear
 *   organization_type, organization_description, website,
 *   facebook, instagram, twitter, linkedin   (links stored as https URLs)
 *
 * GET returns the acting org's description and links, for the app's editor.
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
      organization_logo,
    } = body;

    // Every link here is rendered as an href (admin console, public profile,
    // mobile). Stored as https URLs only; a bare handle becomes its profile
    // URL on that network (lib/organizer/links.ts).
    const linkInput: Record<string, unknown> = {};
    for (const key of ['website', 'facebook', 'instagram', 'twitter', 'linkedin'] as const) {
      if (has(key)) linkInput[key] = body[key];
    }
    const links = cleanOrgLinks(linkInput);
    if (!links.ok) {
      return NextResponse.json(
        {
          error:
            links.field === 'website'
              ? 'Website must be a valid web address'
              : `${links.field} must be a username or a link to that profile`,
          field: links.field,
        },
        { status: 400 }
      );
    }
    const cleanWebsite = links.website ?? '';
    const social: Record<string, string> = links.social;
    const socialInput = Object.keys(social);

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

    // The name may be left out of a partial update (the logo alone, or the
    // app's description + links), but never sent empty, and a body that
    // changes nothing at all is refused as before.
    const nameSent = has('organization_name');
    const otherKeys = ['organization_logo', 'organization_type', 'organization_description', 'website', 'facebook', 'instagram', 'twitter', 'linkedin'];
    const nothingElse = !otherKeys.some(has);
    if ((nameSent || nothingElse) && (typeof organization_name !== 'string' || organization_name.trim().length === 0)) {
      return NextResponse.json(
        { error: 'Organization name is required' },
        { status: 400 }
      );
    }

    // Update the org's data in Firestore: only the keys the caller sent.
    const details: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (nameSent) details.organization_name = organization_name.trim();
    if (has('organization_type')) details.organization_type = typeof organization_type === 'string' ? organization_type : '';
    if (has('organization_description')) {
      details.organization_description =
        typeof organization_description === 'string' ? organization_description.trim().slice(0, 2000) : '';
    }
    if (has('website')) details.website = cleanWebsite;
    // merge: true deep-merges the map, so only the networks sent are touched.
    if (socialInput.length) details.social_media = social;
    await adminDb.collection('organizers').doc(orgId).set(details, { merge: true });

    // The brand's canonical home is public_profiles/{orgId} (plus the
    // users/{orgId} copy the app and the event pages read): lib/profile/org-brand.ts.
    const brand: Record<string, unknown> = {};
    if (nameSent) brand.organization_name = organization_name.trim();
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

export async function GET() {
  const org = await requireOrg('manage_settings');
  if (!org.ok) return org.response;
  const snap = await adminDb.collection('organizers').doc(org.value.orgId).get();
  const d = snap.exists ? snap.data() || {} : {};
  const social = (d.social_media && typeof d.social_media === 'object' ? d.social_media : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return NextResponse.json({
    organization_description: str(d.organization_description),
    website: str(d.website),
    instagram: str(social.instagram),
    facebook: str(social.facebook),
  });
}

// The app sends partial updates as PATCH ({ organization_name? , organization_logo? }); same handler.
export const PATCH = PUT
