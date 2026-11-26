/**
 * Community-shared events in the app (web lib/community/submissions).
 *
 * "Share an event": a member sends a flyer they saw, with whatever details
 * they know, to POST /api/community/submissions. Nothing is published from
 * here; an admin checks it and publishes it, credited to the community and
 * owned by the Tikèm Community account until the organizer claims it.
 *
 * "Claim it": on a community event, the organizer sends a proof to
 * POST /api/events/:id/claim. An uploaded proof goes to the PRIVATE
 * claim-proofs/{uid}/ folder (storage.rules: owner create-only, no client
 * read) and only its storage PATH is sent, never a download URL.
 *
 * The pure helpers at the top have no React Native imports so the website's
 * jest suite can test them; the network and storage modules are imported at
 * the point of use.
 */

export const SHARE_COUNTRIES = ['HT', 'US', 'CA', 'FR'] as const;
export type ShareCountry = (typeof SHARE_COUNTRIES)[number];
export const SHARE_CURRENCIES = ['HTG', 'USD', 'CAD', 'EUR'] as const;
export type ShareCurrency = (typeof SHARE_CURRENCIES)[number];

/** The website's canonical categories (lib/filters/config CATEGORIES). */
export const SHARE_CATEGORIES = [
  'Concert',
  'Party',
  'Festival',
  'Conference',
  'Workshop',
  'Sports',
  'Theater',
  'Food & Drink',
  'Family',
  'Other',
] as const;

/** Locale key for a canonical category under `community.categories`. */
export function shareCategoryKey(cat: string): string {
  const map: Record<string, string> = {
    Concert: 'concert',
    Party: 'party',
    Festival: 'festival',
    Conference: 'conference',
    Workshop: 'workshop',
    Sports: 'sports',
    Theater: 'theater',
    'Food & Drink': 'foodDrink',
    Family: 'family',
    Other: 'other',
  };
  return `community.categories.${map[cat] || 'other'}`;
}

/** Currencies a price can be quoted in for a country (same lock as the web). */
export function shareCurrenciesFor(country: string): ShareCurrency[] {
  if (country === 'HT') return ['HTG', 'USD'];
  if (country === 'CA') return ['CAD'];
  if (country === 'FR') return ['EUR'];
  return ['USD'];
}

/** An http(s) link on a real host with no credentials, or null. */
export function isSafeHttpUrl(raw: unknown): string | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 500) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A public https link (no port, no IP literal), for the ticket link-out. */
export function isPublicHttpsUrl(raw: unknown): string | null {
  const safe = isSafeHttpUrl(raw);
  if (!safe) return null;
  const u = new URL(safe);
  if (u.protocol !== 'https:' || u.port) return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^\d+\.\d+\.\d+\.\d+$/.test(h)) return null;
  return safe;
}

/** Shared by the community and not yet claimed. */
export function isCommunityEvent(event: any): boolean {
  return event?.community_shared === true;
}

/** Where a community event's tickets are sold (server-written, re-checked here). */
export function communityTicketsUrl(event: any): string | null {
  if (!isCommunityEvent(event)) return null;
  return isPublicHttpsUrl(event?.external_url);
}

/** "@Kompa.Night" → "kompa.night"; '' when it is not a handle. */
export function cleanHandle(raw: unknown): string {
  let s = String(raw ?? '').trim().toLowerCase();
  s = s.replace(/^https?:\/\/(www\.)?instagram\.com\//, '').replace(/^@+/, '').split(/[/?#\s]/)[0] || '';
  return /^[a-z0-9._]{1,40}$/.test(s) ? s : '';
}

export interface ShareDetails {
  title: string;
  date: string;
  start_time: string;
  end_time: string;
  venue_name: string;
  address: string;
  city: string;
  country: ShareCountry | '';
  free: boolean | null;
  price: string;
  currency: ShareCurrency | '';
  ticket_url: string;
  category: string;
}

export interface ShareInput {
  image_url: string;
  source_url: string;
  organizer_name: string;
  organizer_handle: string;
  note: string;
  details: ShareDetails;
}

export const EMPTY_SHARE_DETAILS: ShareDetails = {
  title: '',
  date: '',
  start_time: '',
  end_time: '',
  venue_name: '',
  address: '',
  city: '',
  country: '',
  free: null,
  price: '',
  currency: '',
  ticket_url: '',
  category: '',
};

/** The flyer read (/api/flyers/read) fields a share form can take. */
export interface ShareFlyerRead {
  title: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  price_type: 'free' | 'paid' | 'unknown';
  price: number | null;
  currency: string | null;
}

/** Fill only the EMPTY fields from a flyer read; returns the patch and what it filled. */
export function shareDetailsFromRead(
  read: ShareFlyerRead,
  d: ShareDetails
): { patch: Partial<ShareDetails>; filled: string[] } {
  const patch: Partial<ShareDetails> = {};
  const filled: string[] = [];
  const take = <K extends keyof ShareDetails>(k: K, v: ShareDetails[K] | null | undefined, field: string = k) => {
    if (v == null || v === '' || (d[k] !== '' && d[k] !== null)) return;
    patch[k] = v;
    filled.push(field);
  };
  take('title', read.title || null);
  take('date', read.date || null);
  take('start_time', read.start_time || null);
  take('end_time', read.end_time || null);
  take('venue_name', read.venue_name || null);
  take('address', read.address || null);
  take('city', read.city || null);
  if (d.free === null && read.price_type === 'free') {
    patch.free = true;
    filled.push('price');
  } else if (d.free === null && read.price_type === 'paid' && read.price) {
    patch.free = false;
    patch.price = String(read.price);
    if ((SHARE_CURRENCIES as readonly string[]).includes(String(read.currency))) patch.currency = read.currency as ShareCurrency;
    filled.push('price');
  }
  return { patch, filled };
}

/** The body POST /api/community/submissions takes. */
export function shareRequestBody(input: ShareInput): Record<string, unknown> {
  const d = input.details;
  return {
    image_url: input.image_url,
    source_url: input.source_url.trim() || undefined,
    organizer_name: input.organizer_name.trim() || undefined,
    organizer_handle: cleanHandle(input.organizer_handle) || undefined,
    note: input.note.trim() || undefined,
    details: {
      ...d,
      price: d.free === false ? d.price.trim() : '',
      currency: d.free === false ? d.currency : '',
    },
  };
}

// ---------------------------------------------------------------------------
// Network and storage (imported at the point of use)
// ---------------------------------------------------------------------------

export type ClaimMethod = 'instagram' | 'link' | 'upload';

export interface ClaimBody {
  method: ClaimMethod;
  instagram_handle?: string;
  proof_url?: string;
  proof_path?: string;
  message?: string;
}

/** Upload a flyer (device uri) to our bucket and read it on the website. */
export async function uploadShareFlyer(uid: string, localUri: string): Promise<string> {
  const { uploadEventFlyer } = await import('./api/events');
  return uploadEventFlyer(uid, localUri);
}

export async function readShareFlyer(url: string): Promise<ShareFlyerRead> {
  const { backendJson } = await import('./api/backend');
  const { read } = await backendJson<{ read: ShareFlyerRead }>('/api/flyers/read', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return read;
}

/** Posts a share: it goes live at once (status 'published', with its event) or waits for review. */
export async function submitShare(
  input: ShareInput
): Promise<{ ok: boolean; id?: string; status?: 'published' | 'pending'; eventId?: string }> {
  const { backendJson } = await import('./api/backend');
  return backendJson('/api/community/submissions', {
    method: 'POST',
    body: JSON.stringify(shareRequestBody(input)),
  });
}

export async function getMyClaim(eventId: string): Promise<{ claimable: boolean; claim: { status: string } | null }> {
  const { backendJson } = await import('./api/backend');
  return backendJson(`/api/events/${encodeURIComponent(eventId)}/claim`);
}

export async function submitClaim(eventId: string, body: ClaimBody): Promise<{ ok: boolean; already?: boolean }> {
  const { backendJson } = await import('./api/backend');
  return backendJson(`/api/events/${encodeURIComponent(eventId)}/claim`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const PROOF_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/gif': 'gif',
};
const PROOF_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Upload a claim proof (an image) to claim-proofs/{uid}/ and resolve to its
 * storage PATH. Never asks for a download URL: the rules allow no read.
 */
export async function uploadClaimProof(localUri: string, mimeType?: string | null): Promise<string> {
  const [{ ref, uploadBytes }, { auth, storage }] = await Promise.all([
    import('firebase/storage'),
    import('../config/firebase'),
  ]);
  const uid = auth.currentUser?.uid;
  if (!uid) throw Object.assign(new Error('Not signed in'), { code: 'unauthorized' });
  const res = await fetch(localUri);
  const blob = await res.blob();
  if (blob.size > PROOF_MAX_BYTES) throw Object.assign(new Error('Too large'), { code: 'too_large' });
  const type = String(mimeType || blob.type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  const contentType = PROOF_EXT[type] ? type : 'image/jpeg';
  const path = `claim-proofs/${uid}/proof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${PROOF_EXT[contentType]}`;
  await uploadBytes(ref(storage, path), blob, { contentType });
  return path;
}
