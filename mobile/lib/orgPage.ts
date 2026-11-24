/**
 * An organization's public page, edited from the app: banner, photos, and
 * the description + links. Everything goes through the server, which checks
 * the caller is the org's owner or a team admin (requireOrg manage_settings)
 * and stores uploads under org-pages/{orgId}/ with the Admin SDK:
 *
 *   /api/organizer/settings/cover         GET, PUT { template | coverImageUrl }, POST file
 *   /api/organizer/settings/gallery       GET, PUT { gallery }, POST file
 *   /api/organizer/settings/organization  GET, PATCH { organization_description, website, instagram, facebook }
 *
 * Every call names the org it edits (X-Tikem-Org), so editing a page never
 * depends on which org the switcher happens to be on.
 */
import * as ImagePicker from 'expo-image-picker';
import { backendJson } from './api/backend';
import { ORG_HEADER } from './activeOrgState';
import { COVER_TEMPLATES, readGallery, type CoverTemplate, type GalleryPhoto } from './galleryRules';

export * from './galleryRules';

/** Under the server's 4MB cap (Vercel's body limit is ~4.5MB). */
export const MAX_ORG_PAGE_IMAGE_BYTES = 4 * 1024 * 1024;

export class OrgPageError extends Error {
  constructor(public key: string) {
    super(key);
  }
}

/** The template banners, bundled (the same world photos as the website's). */
export const COVER_TEMPLATE_SOURCES: Record<CoverTemplate, number> = {
  mizik: require('../assets/photos/mizik.jpg'),
  'lavi-lannwit': require('../assets/photos/lavi-lannwit.jpg'),
  kilti: require('../assets/photos/kilti.jpg'),
  espo: require('../assets/photos/espo.jpg'),
  gastronomi: require('../assets/photos/gastronomi.jpg'),
  biznis: require('../assets/photos/biznis.jpg'),
  fanmi: require('../assets/photos/fanmi.jpg'),
  eksperyans: require('../assets/photos/eksperyans.jpg'),
};
export { COVER_TEMPLATES };

const orgHeaders = (orgId: string) => ({ [ORG_HEADER]: orgId });

export interface OrgCoverState {
  coverTemplate: CoverTemplate | null;
  coverImageUrl: string | null;
}

const toCover = (d: any): OrgCoverState => ({
  coverTemplate: d?.coverTemplate ?? null,
  coverImageUrl: d?.coverImageUrl ?? null,
});

export async function fetchOrgCover(orgId: string): Promise<OrgCoverState> {
  return toCover(await backendJson('/api/organizer/settings/cover', { headers: orgHeaders(orgId) }));
}

/** A template, or null for no banner. */
export async function saveOrgCoverTemplate(orgId: string, template: CoverTemplate | null): Promise<OrgCoverState> {
  return toCover(
    await backendJson('/api/organizer/settings/cover', {
      method: 'PUT',
      headers: orgHeaders(orgId),
      body: JSON.stringify({ template }),
    })
  );
}

function fileFor(asset: ImagePicker.ImagePickerAsset, base: string) {
  if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_ORG_PAGE_IMAGE_BYTES) {
    throw new OrgPageError('orgPage.errors.tooLarge');
  }
  const type = asset.mimeType || 'image/jpeg';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const form = new FormData();
  form.append('file', { uri: asset.uri, name: `${base}.${ext}`, type } as any);
  return form;
}

export async function uploadOrgCover(orgId: string, asset: ImagePicker.ImagePickerAsset): Promise<OrgCoverState> {
  return toCover(
    await backendJson('/api/organizer/settings/cover', {
      method: 'POST',
      headers: orgHeaders(orgId),
      body: fileFor(asset, 'banner') as any,
    })
  );
}

export async function fetchOrgGallery(orgId: string): Promise<GalleryPhoto[]> {
  const d = await backendJson<{ gallery?: unknown }>('/api/organizer/settings/gallery', { headers: orgHeaders(orgId) });
  return readGallery(d?.gallery, orgId);
}

export async function saveOrgGallery(orgId: string, gallery: GalleryPhoto[]): Promise<GalleryPhoto[]> {
  const d = await backendJson<{ gallery?: unknown }>('/api/organizer/settings/gallery', {
    method: 'PUT',
    headers: orgHeaders(orgId),
    body: JSON.stringify({ gallery }),
  });
  return readGallery(d?.gallery, orgId);
}

/** Upload one photo; the server adds it at the end and returns the whole gallery. */
export async function uploadOrgGalleryPhoto(orgId: string, asset: ImagePicker.ImagePickerAsset): Promise<GalleryPhoto[]> {
  const d = await backendJson<{ gallery?: unknown }>('/api/organizer/settings/gallery', {
    method: 'POST',
    headers: orgHeaders(orgId),
    body: fileFor(asset, 'photo') as any,
  });
  return readGallery(d?.gallery, orgId);
}

/** Pick photos from the library (several for the gallery). Empty when cancelled. */
export async function pickOrgPagePhotos(limit: number): Promise<ImagePicker.ImagePickerAsset[]> {
  if (limit <= 0) return [];
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new OrgPageError('profile.uploads.photoPermissionRequired');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    orderedSelection: true,
    // Re-encoded to a JPEG well under the 4MB cap for a phone photo.
    quality: 0.6,
  });
  if (result.canceled) return [];
  return (result.assets || []).filter((a) => !!a?.uri).slice(0, limit);
}

/** The org's description and the links people find them by (settings route GET). */
export interface OrgPageDetails {
  organization_description: string;
  website: string;
  instagram: string;
  facebook: string;
}

export async function fetchOrgPageDetails(orgId: string): Promise<OrgPageDetails> {
  const d = await backendJson<Partial<OrgPageDetails>>('/api/organizer/settings/organization', {
    headers: orgHeaders(orgId),
  });
  return {
    organization_description: String(d?.organization_description || ''),
    website: String(d?.website || ''),
    instagram: String(d?.instagram || ''),
    facebook: String(d?.facebook || ''),
  };
}

/** Save them; the server keeps links as https URLs and refuses ones it cannot read. */
export async function saveOrgPageDetails(orgId: string, details: OrgPageDetails): Promise<void> {
  await backendJson('/api/organizer/settings/organization', {
    method: 'PATCH',
    headers: orgHeaders(orgId),
    body: JSON.stringify({
      organization_description: details.organization_description.trim(),
      website: details.website.trim(),
      instagram: details.instagram.trim(),
      facebook: details.facebook.trim(),
    }),
  });
}
