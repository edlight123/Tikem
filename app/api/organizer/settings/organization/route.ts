import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { adminDb } from '@/lib/firebase/admin';
import { safeExternalUrl } from '@/lib/safeUrl';

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

export async function PUT(request: NextRequest) {
  try {
    const user = await getCurrentUser();

    if (!user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      organization_name,
      organization_type,
      organization_description,
      website,
      facebook,
      instagram,
      twitter,
      linkedin,
    } = body;

    if (!['organizer', 'admin', 'super_admin'].includes(String(user.role))) {
      return NextResponse.json(
        { error: 'Only organizers can update organization details' },
        { status: 403 }
      );
    }

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
    for (const [key, value] of Object.entries({ facebook, instagram, twitter, linkedin })) {
      const cleaned = cleanSocial(value);
      if (cleaned === null) {
        return NextResponse.json(
          { error: `${key} must be a username or a valid http(s) URL` },
          { status: 400 }
        );
      }
      social[key] = cleaned;
    }

    // Validate required fields
    if (typeof organization_name !== 'string' || organization_name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Organization name is required' },
        { status: 400 }
      );
    }

    // Update organizer data in Firestore
    await adminDb.collection('organizers').doc(user.id).set({
      organization_name: organization_name.trim(),
      organization_type: typeof organization_type === 'string' ? organization_type : '',
      organization_description:
        typeof organization_description === 'string' ? organization_description.trim() : '',
      website: cleanWebsite,
      social_media: social,
      updated_at: new Date().toISOString(),
    }, { merge: true });

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
