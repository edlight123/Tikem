/**
 * The acting org's brand (organization name + logo), read and written for a
 * TEAM MEMBER. The owner keeps writing their own users/{uid} and
 * public_profiles/{uid} from the app (AuthContext.updateUserProfile), which
 * firestore.rules allow only for the owner. An admin acting for someone
 * else's org writes through the server instead:
 *
 *   PATCH /api/organizer/settings/organization
 *     body: { organization_name?: string, organization_logo?: string }
 *     header: X-Tikem-Org (added by the API client for the acting org)
 *
 * The server gates it with requireOrg('manage_settings') and writes the
 * brand to users/{orgId} and public_profiles/{orgId}. A logo is uploaded
 * first to the ACTOR's own profile-images/{uid}/ prefix (the one storage
 * prefix the rules open to them) and its URL is sent here.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { resolveOrgBrand, type OrgBrand } from '../orgBrand';
import { backendJson } from './backend';

/** The org's brand as event pages show it (public_profiles, then users). */
export async function loadOrgBrand(orgId: string): Promise<OrgBrand> {
  const [pub, usr] = await Promise.all([
    getDoc(doc(db, 'public_profiles', orgId)).catch(() => null),
    getDoc(doc(db, 'users', orgId)).catch(() => null),
  ]);
  return resolveOrgBrand(
    pub?.exists() ? (pub.data() as any) : null,
    usr?.exists() ? (usr.data() as any) : null,
  );
}

/** Save brand fields for the acting org through the server (team admins). */
export async function saveActingOrgBrand(patch: Partial<OrgBrand>): Promise<void> {
  const body: Partial<OrgBrand> = {};
  if (typeof patch.organization_name === 'string') body.organization_name = patch.organization_name.trim();
  if (typeof patch.organization_logo === 'string') body.organization_logo = patch.organization_logo.trim();
  await backendJson('/api/organizer/settings/organization', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
