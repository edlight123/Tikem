import { db, storage } from '../../config/firebase';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  setDoc,
  Timestamp,
  serverTimestamp,
  query,
  where,
  getDoc,
  getDocs,
  deleteDoc,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import * as Crypto from 'expo-crypto';
import { hasPaidTier } from '../ticketPricing';
import { backendJson } from './backend';

/**
 * SHA-256 hex of the trimmed raw access code (trim only; case-sensitive).
 * The plaintext code is NEVER stored — only this hash is written to the
 * private/access doc. Returns null for a blank/whitespace-only code so callers
 * can skip the write entirely.
 */
async function hashAccessCode(rawCode: string): Promise<string | null> {
  const trimmed = (rawCode || '').trim();
  if (!trimmed) return null;
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, trimmed);
}

/**
 * Write the hashed access code to `events/{eventId}/private/access`.
 * Client SDK setDoc — firestore.rules (owned by the web agent) must allow the
 * organizer to write this path. Never call this with a plaintext code on the
 * public event doc.
 */
async function writeAccessHash(eventId: string, codeHash: string): Promise<void> {
  await setDoc(doc(db, 'events', eventId, 'private', 'access'), {
    code_hash: codeHash,
    updated_at: serverTimestamp(),
  });
}

export interface CreateEventData {
  title: string;
  description: string;
  category: string;
  banner_image_url: string;
  venue_name: string;
  country?: string;
  /** Haiti département (optional; city stays the discovery-facing value). */
  department?: string;
  city: string;
  commune: string;
  address: string;
  start_date: string;
  start_time: string;
  end_date: string;
  end_time: string;
  timezone: string;
  currency: string;
  ticket_tiers: Array<{
    name: string;
    price: string;
    quantity: string;
    /** Optional per-tier blurb shown on the event detail page. */
    description?: string;
    /** When true the tier has no real cap (quantity carries a large sentinel). */
    unlimited?: boolean;
    /** Optional sale-window start — ISO 8601 datetime; empty/undefined = no lower bound. */
    sale_start?: string;
    /** Optional sale-window end — ISO 8601 datetime; empty/undefined = no upper bound. */
    sale_end?: string;
    /**
     * Optional per-tier ENTRY-admission window (distinct from the sale/purchase
     * window above). ISO 8601 datetime; empty/undefined = admits anytime. Read by
     * the scan/ticket-display layer to gate check-in ("Not valid yet"/"Expired").
     */
    valid_from?: string;
    /** Optional entry-admission end — ISO 8601 datetime; empty/undefined = no upper bound. */
    valid_until?: string;
  }>;
  /** Free RSVP event — no paid tiers; a single free tier caps attendance. */
  is_rsvp?: boolean;
  /** When false the event is hidden from Discover/Explore (share-by-link only). */
  show_on_explore?: boolean;
  /**
   * Organizer poster-theme override. A valid PosterThemeKey pins the poster
   * gradient for this event; '' (default) = Auto (deterministic pick from the
   * seed/category). Persisted so it wins wherever the poster is rendered.
   */
  theme_key?: string;
  /** Optional promo video link. */
  video_url?: string;
  /**
   * Optional Spotify track URL (`https://open.spotify.com/track/{id}`), picked
   * via song search in the composer. Rendered as the official Spotify embed on
   * the event page; anything unparseable is simply ignored there.
   */
  spotify_url?: string;
  /** Whether attendees can see the guest list. */
  show_guestlist?: boolean;
  /**
   * Recurring-event cadence (create-only). When set to a real cadence and
   * `recurrence_count > 1`, createEvent generates that many independent event
   * docs one cadence apart, all sharing a `series_id`. Defaults to 'none'.
   */
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  /** TOTAL occurrences incl. the first. Only meaningful when recurring. Capped at 52. */
  recurrence_count?: number;
  /**
   * Recurring "until date" (create-only). ISO date (YYYY-MM-DD). When set with a
   * real cadence, generate occurrences from the base date forward UNTIL this date
   * (inclusive, capped at 52) INSTEAD of by `recurrence_count`. Empty = use count.
   */
  recurrence_end_date?: string;
  /** When true the event is gated behind an access code (public flag on the doc). */
  is_password_protected?: boolean;
  /**
   * Transient plaintext access code. NEVER written to the public event doc — it
   * is hashed (SHA-256) into the private/access subdoc only. Blank keeps any
   * existing code on update.
   */
  access_code?: string;
}

/** Hard cap on how many occurrences a single recurring series may generate. */
const MAX_RECURRENCE_COUNT = 52;

/**
 * Shift a base datetime by `i` steps of the given cadence, preserving the
 * time-of-day. Monthly steps clamp the day-of-month to the target month's
 * length (e.g. Jan 31 + 1 month → Feb 28/29) so no occurrence rolls into the
 * following month.
 */
function shiftDateByRecurrence(
  base: Date,
  cadence: 'daily' | 'weekly' | 'monthly',
  i: number
): Date {
  const d = new Date(base.getTime());
  if (cadence === 'daily') {
    d.setDate(d.getDate() + i);
  } else if (cadence === 'weekly') {
    d.setDate(d.getDate() + i * 7);
  } else {
    // monthly — clamp day to the target month's length.
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + i);
    const lastDayOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDayOfMonth));
  }
  return d;
}

export interface SaveEventOptions {
  /** When false, the event is saved as an unpublished draft. Defaults to true
   *  (immediate publish) so existing callers keep their behavior. */
  publish?: boolean;
  /**
   * Edit mode only. When true AND the target event carries a `series_id`, the
   * same field updates are applied to every sibling occurrence in the series
   * (EXCEPT each occurrence's own start/end datetimes and the series_id). No-op
   * when the event has no series_id. Defaults to false (edit only this event).
   */
  applyToSeries?: boolean;
}

/**
 * Build a `ticket_tiers` collection document for a given event/tier. Shared by
 * create, update, and series-sync so every path persists the same tier shape,
 * including the sale window and the entry-validity window.
 */
function buildTierCollectionDoc(
  eventId: string,
  tier: CreateEventData['ticket_tiers'][number],
  index: number
) {
  return {
    event_id: eventId,
    name: tier.name,
    price: parseFloat(tier.price) || 0,
    quantity: parseInt(tier.quantity) || 0,
    total_quantity: parseInt(tier.quantity) || 0,
    available: parseInt(tier.quantity) || 0,
    sold_quantity: 0,
    description: tier.description || tier.name,
    unlimited: tier.unlimited || false,
    sort_order: index,
    is_active: true,
    // Per-tier sale/purchase window (ISO 8601 strings, or null for no bound).
    sales_start: tier.sale_start ? tier.sale_start : null,
    sales_end: tier.sale_end ? tier.sale_end : null,
    // Per-tier ENTRY-admission window (ISO 8601 strings, or null for no bound).
    valid_from: tier.valid_from ? tier.valid_from : null,
    valid_until: tier.valid_until ? tier.valid_until : null,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };
}

/**
 * Build the embedded `ticket_tiers` array entry stored on the event doc. Mirrors
 * the collection doc's business fields so readers using the embedded copy see
 * the same sale + validity bounds.
 */
function buildTierEmbedded(tier: CreateEventData['ticket_tiers'][number]) {
  return {
    name: tier.name,
    price: parseFloat(tier.price) || 0,
    quantity: parseInt(tier.quantity) || 0,
    available: parseInt(tier.quantity) || 0,
    description: tier.description || '',
    unlimited: tier.unlimited || false,
    sales_start: tier.sale_start ? tier.sale_start : null,
    sales_end: tier.sale_end ? tier.sale_end : null,
    valid_from: tier.valid_from ? tier.valid_from : null,
    valid_until: tier.valid_until ? tier.valid_until : null,
  };
}

/**
 * Explore/Discover visibility gate.
 *
 * Returns true when an event should appear in the public Discover list.
 * An event is hidden ONLY when `show_on_explore` is explicitly `false`.
 * A missing/undefined field is treated as VISIBLE so the many existing events
 * created before this field shipped are unaffected. Apply this in-memory AFTER
 * the Firestore query — never as a `where('show_on_explore','==',true)` clause,
 * which would silently drop every doc that lacks the field.
 */
export function isVisibleOnExplore(event: { show_on_explore?: boolean } | null | undefined): boolean {
  return (event as any)?.show_on_explore !== false;
}

/**
 * Filter a fetched event list down to what's allowed on Explore/Discover.
 * Excludes only events with `show_on_explore === false` (missing = visible).
 *
 * NOTE: the public Discover/Home queries currently live in the screens
 * (mobile/screens/DiscoverScreen.tsx and mobile/screens/HomeScreen.tsx), which
 * are outside this module's ownership. Those screens should import and apply
 * this helper to the mapped results, e.g. `filterExploreEvents(eventsData)`,
 * right after `getDocs(...).docs.map(...)`. TODO(discovery): wire this into
 * DiscoverScreen/HomeScreen so the toggle takes effect end-to-end.
 */
export function filterExploreEvents<T extends { show_on_explore?: boolean }>(events: T[]): T[] {
  return events.filter(isVisibleOnExplore);
}

/**
 * Publish freshly created events through the server route, which runs the payout
 * gate. Called AFTER the ticket_tiers docs exist, because the gate decides
 * whether an event is paid by reading them.
 *
 * On failure the events simply stay drafts — nothing is rolled back, because a
 * draft is the correct resting state for an event that could not go live. The
 * thrown message says so, since "failed to create event" would be wrong: the
 * event exists and their work is safe.
 */
async function publishCreatedEvents(eventIds: string[]): Promise<void> {
  try {
    for (const id of eventIds) {
      await backendJson(`/api/events/${id}/publish`, {
        method: 'POST',
        body: JSON.stringify({ is_published: true }),
      });
    }
  } catch (error: any) {
    throw new Error(
      error?.message
        ? `Saved as a draft, but not published: ${error.message}`
        : 'Your event was saved as a draft but could not be published.'
    );
  }
}

/**
 * Create a new event in Firestore
 */
export async function createEvent(
  organizerId: string,
  eventData: CreateEventData,
  options: SaveEventOptions = {}
): Promise<string> {
  const publish = options.publish !== false;
  try {
    // Denormalized organizer display name stamped on each event doc so cards can
    // render the organizer WITHOUT an extra profile read. The organization brand
    // name wins over the personal full name (falls back to it when unset). Read
    // from the SAFE public projection; best-effort (empty string on any failure).
    let organizerName = '';
    try {
      const profileSnap = await getDoc(doc(db, 'public_profiles', organizerId));
      if (profileSnap.exists()) {
        const p = profileSnap.data() as any;
        organizerName = String(p.organization_name || p.full_name || '').trim();
      }
    } catch (profileError) {
      console.error('Error loading organizer profile for organizer_name stamp:', profileError);
    }

    // Upload image to Firebase Storage if it's a local URI
    let coverImageUrl = eventData.banner_image_url;
    if (eventData.banner_image_url && eventData.banner_image_url.startsWith('file://')) {
      coverImageUrl = await uploadEventImage(organizerId, eventData.banner_image_url);
    }

    // Parse the base dates/times. Recurring occurrences are shifted from these.
    const baseStartDatetime = parseDateTimeString(
      eventData.start_date,
      eventData.start_time
    );
    const baseEndDatetime = parseDateTimeString(
      eventData.end_date,
      eventData.end_time
    );

    // Calculate total capacity from ticket tiers
    const totalCapacity = eventData.ticket_tiers.reduce(
      (sum, tier) => sum + parseInt(tier.quantity || '0'),
      0
    );

    // Get the lowest ticket price for compatibility ("from" display only).
    const lowestPrice = Math.min(
      ...eventData.ticket_tiers.map(tier => parseFloat(tier.price) || 0)
    );
    // Explicit freeness flag. `lowestPrice` is 0 for ANY event carrying a free
    // tier, so it cannot answer "is this event free" once free and paid tiers
    // coexist — readers must use this instead (see lib/ticketPricing.ts).
    const hasPaidTiers = !eventData.is_rsvp && hasPaidTier(eventData.ticket_tiers);

    // ── Recurrence plan ──────────────────────────────────────────────────
    // A real cadence generates a list of occurrence start/end pairs one cadence
    // apart. Two modes when recurring:
    //  • "Until date": step forward, keeping every occurrence whose START falls
    //    on/before recurrence_end_date (inclusive), capped at MAX.
    //  • "Count" (default): recurrence_count total occurrences, clamped to MAX.
    // Anything else falls back to a single event (unchanged behavior).
    const cadence = eventData.recurrence && eventData.recurrence !== 'none'
      ? eventData.recurrence
      : null;

    const occurrences: Array<{ start: Date; end: Date }> = [];
    if (cadence) {
      const endDateStr = (eventData.recurrence_end_date || '').trim();
      if (endDateStr) {
        // Until-date mode. End-of-day so an occurrence ON the end date counts.
        const untilTime = new Date(`${endDateStr}T23:59:59`).getTime();
        for (let i = 0; i < MAX_RECURRENCE_COUNT; i++) {
          const start = shiftDateByRecurrence(baseStartDatetime, cadence, i);
          if (Number.isFinite(untilTime) && start.getTime() > untilTime) break;
          occurrences.push({ start, end: shiftDateByRecurrence(baseEndDatetime, cadence, i) });
        }
        // Guard against an end date before the base date: always keep occ 0.
        if (occurrences.length === 0) {
          occurrences.push({ start: baseStartDatetime, end: baseEndDatetime });
        }
      } else {
        // Count mode.
        const requestedCount = Math.round(eventData.recurrence_count || 1);
        const count = Math.max(1, Math.min(MAX_RECURRENCE_COUNT, requestedCount));
        for (let i = 0; i < count; i++) {
          occurrences.push({
            start: shiftDateByRecurrence(baseStartDatetime, cadence, i),
            end: shiftDateByRecurrence(baseEndDatetime, cadence, i),
          });
        }
      }
    } else {
      occurrences.push({ start: baseStartDatetime, end: baseEndDatetime });
    }

    const isRecurring = !!cadence && occurrences.length > 1;
    // One shared id ties every occurrence together as a series.
    const seriesId = isRecurring
      ? `series_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      : null;

    // Build one event doc + its ticket_tiers docs for a given occurrence.
    const createOccurrence = async (startDatetime: Date, endDatetime: Date): Promise<string> => {
      const eventDoc = {
        title: eventData.title,
        description: eventData.description,
        category: eventData.category,
        // Both field names for compatibility
        banner_image_url: coverImageUrl,
        cover_image_url: coverImageUrl,
        image_url: coverImageUrl,
        venue_name: eventData.venue_name,
        country: eventData.country || 'HT',
        department: eventData.department || '',
        city: eventData.city,
        commune: eventData.commune || '',
        address: eventData.address,
        location: `${eventData.venue_name}, ${eventData.city}`,
        start_datetime: Timestamp.fromDate(startDatetime),
        end_datetime: Timestamp.fromDate(endDatetime),
        timezone: eventData.timezone,
        currency: eventData.currency,
        // Mirror the per-tier sale + validity windows into the event-doc array so
        // mobile readers that use this embedded copy see the same bounds as the
        // ticket_tiers collection docs. ISO strings stored as-is (or null).
        ticket_tiers: eventData.ticket_tiers.map(buildTierEmbedded),
        // Multiple field names for compatibility with web and mobile.
        // ticket_price is the LOWEST tier price — a "from" figure for display.
        // Never test it for freeness; use has_paid_tiers.
        ticket_price: lowestPrice,
        has_paid_tiers: hasPaidTiers,
        total_capacity: totalCapacity,
        total_tickets: totalCapacity,
        capacity: totalCapacity,
        tickets_sold: 0,
        tickets_available: totalCapacity,
        organizer_id: organizerId,
        // Denormalized organizer display name (org brand preferred). See above.
        organizer_name: organizerName,
        is_rsvp: eventData.is_rsvp || false,
        // Advanced settings — default visible/on when the caller omits them.
        show_on_explore: eventData.show_on_explore !== false,
        video_url: eventData.video_url || '',
        // Song. `null` (not '') when empty, matching the web composer and the
        // lib/data/events.ts field whitelist.
        spotify_url: eventData.spotify_url?.trim() || null,
        show_guestlist: eventData.show_guestlist !== false,
        // Organizer poster-theme override ('' = Auto). Resolvers fall back to the
        // deterministic pick when this is empty/invalid.
        theme_key: eventData.theme_key || '',
        // Password gate — public flag only. The secret lives hashed in the
        // private/access subdoc (written below), never on this doc.
        is_password_protected: !!eventData.is_password_protected,
        // Always created as a DRAFT, matching the web composer. Publishing is a
        // separate, server-gated step (publishCreatedEvent below) so a paid event
        // can never go live without passing the payout gate — and so the
        // Firestore rule can refuse any client write that turns is_published on.
        is_published: false,
        status: 'draft',
        // Moderation defaults — every event must carry these or it goes invisible
        // to the admin events tabs (see event-moderation-data-model). Drafts too.
        rejected: false,
        reports_count: 0,
        // Recurrence metadata — only stamped on generated series occurrences so
        // the single-event path keeps its existing doc shape untouched.
        ...(isRecurring ? { recurrence: cadence, series_id: seriesId } : {}),
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      };

      // Add the event doc to Firestore
      const docRef = await addDoc(collection(db, 'events'), eventDoc);

      // Create separate ticket_tiers documents for each tier. Field shape (incl.
      // the sale + entry-validity windows) is shared via buildTierCollectionDoc.
      const tierPromises = eventData.ticket_tiers.map((tier, index) =>
        addDoc(collection(db, 'ticket_tiers'), buildTierCollectionDoc(docRef.id, tier, index))
      );

      await Promise.all(tierPromises);

      // Password gate — if protected AND a non-empty code was provided, hash it
      // and write the private/access doc for THIS occurrence. Recurring series
      // get one hash doc per occurrence. Plaintext is never persisted.
      if (eventData.is_password_protected) {
        const codeHash = await hashAccessCode(eventData.access_code || '');
        if (codeHash) {
          await writeAccessHash(docRef.id, codeHash);
        }
      }

      return docRef.id;
    };

    // Non-recurring (single occurrence): exactly one event, same as before.
    if (!isRecurring) {
      const id = await createOccurrence(occurrences[0].start, occurrences[0].end);
      console.log('Event created successfully:', id);
      if (publish) await publishCreatedEvents([id]);
      return id;
    }

    // Recurring: create each planned occurrence in order.
    const createdIds: string[] = [];
    for (let i = 0; i < occurrences.length; i++) {
      createdIds.push(await createOccurrence(occurrences[i].start, occurrences[i].end));
    }

    console.log(`Recurring series ${seriesId} created: ${occurrences.length} events`);
    if (publish) await publishCreatedEvents(createdIds);
    // Keep the existing return contract: the FIRST occurrence's id.
    return createdIds[0] || '';
  } catch (error) {
    console.error('Error creating event:', error);
    throw new Error('Failed to create event. Please try again.');
  }
}

/**
 * Update an existing event in Firestore
 */
export async function updateEvent(
  eventId: string,
  organizerId: string,
  eventData: CreateEventData,
  options: SaveEventOptions = {}
): Promise<void> {
  try {
    // Upload image to Firebase Storage if it's a new local URI
    let coverImageUrl = eventData.banner_image_url;
    if (eventData.banner_image_url && eventData.banner_image_url.startsWith('file://')) {
      coverImageUrl = await uploadEventImage(organizerId, eventData.banner_image_url);
    }

    // Parse dates and times into proper datetime
    const startDatetime = parseDateTimeString(
      eventData.start_date,
      eventData.start_time
    );
    const endDatetime = parseDateTimeString(
      eventData.end_date,
      eventData.end_time
    );

    // Calculate total capacity from ticket tiers
    const totalCapacity = eventData.ticket_tiers.reduce(
      (sum, tier) => sum + parseInt(tier.quantity || '0'),
      0
    );

    // Lowest tier price — "from" display only (see createEvent).
    const lowestPrice = Math.min(
      ...eventData.ticket_tiers.map(tier => parseFloat(tier.price) || 0)
    );
    const hasPaidTiers = !eventData.is_rsvp && hasPaidTier(eventData.ticket_tiers);

    // Prepare update data
    const updateData = {
      title: eventData.title,
      description: eventData.description,
      category: eventData.category,
      banner_image_url: coverImageUrl,
      cover_image_url: coverImageUrl,
      image_url: coverImageUrl,
      venue_name: eventData.venue_name,
      country: eventData.country || 'HT',
      department: eventData.department || '',
      city: eventData.city,
      commune: eventData.commune || '',
      address: eventData.address,
      location: `${eventData.venue_name}, ${eventData.city}`,
      start_datetime: Timestamp.fromDate(startDatetime),
      end_datetime: Timestamp.fromDate(endDatetime),
      timezone: eventData.timezone,
      currency: eventData.currency,
      // Mirror the per-tier sale + validity windows into the event-doc array
      // (see createEvent / buildTierEmbedded).
      ticket_tiers: eventData.ticket_tiers.map(buildTierEmbedded),
      ticket_price: lowestPrice,
      has_paid_tiers: hasPaidTiers,
      total_capacity: totalCapacity,
      total_tickets: totalCapacity,
      capacity: totalCapacity,
      is_rsvp: eventData.is_rsvp || false,
      // Advanced settings — default visible/on when the caller omits them.
      show_on_explore: eventData.show_on_explore !== false,
      video_url: eventData.video_url || '',
      // Song — cleared to null when the organizer removes it (see createEvent).
      spotify_url: eventData.spotify_url?.trim() || null,
      show_guestlist: eventData.show_guestlist !== false,
      // Organizer poster-theme override ('' = Auto); see createEvent.
      theme_key: eventData.theme_key || '',
      // Password gate flag. When toggled OFF this becomes false and the old
      // private/access hash is simply left in place (harmless — the gate is off).
      is_password_protected: !!eventData.is_password_protected,
      updated_at: serverTimestamp(),
      // Publication state is NOT written here. Turning it on has to pass the
      // payout gate, and the Firestore rule refuses a client write that does so
      // — it goes through the server route below instead.
    };

    // Update the event document
    const eventRef = doc(db, 'events', eventId);
    await updateDoc(eventRef, updateData);

    // Delete existing ticket_tiers documents
    const tiersQuery = query(
      collection(db, 'ticket_tiers'),
      where('event_id', '==', eventId)
    );
    const existingTiers = await getDocs(tiersQuery);
    const deletePromises = existingTiers.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deletePromises);

    // Create new ticket_tiers documents (shared shape incl. sale + validity).
    const tierPromises = eventData.ticket_tiers.map((tier, index) =>
      addDoc(collection(db, 'ticket_tiers'), buildTierCollectionDoc(eventId, tier, index))
    );

    await Promise.all(tierPromises);

    // ── Apply edits to the whole series ────────────────────────────────────
    // When the caller opts in AND this event belongs to a series, propagate the
    // SAME field updates to every sibling occurrence — EXCEPT each occurrence's
    // own start/end datetimes and the series_id (siblings keep their own dates
    // and stay in the series). Each sibling's ticket_tiers are re-synced too.
    // Capped so a runaway series can't fan out unbounded writes.
    if (options.applyToSeries) {
      const targetSnap = await getDoc(eventRef);
      const seriesId = targetSnap.exists() ? (targetSnap.data() as any)?.series_id : null;
      if (seriesId) {
        const siblingsSnap = await getDocs(
          query(collection(db, 'events'), where('series_id', '==', seriesId))
        );
        // Everything shared across the series: drop the per-occurrence datetimes.
        const { start_datetime, end_datetime, ...seriesShared } = updateData as any;
        let processed = 0;
        for (const sibling of siblingsSnap.docs) {
          if (sibling.id === eventId) continue;        // target already updated
          if (processed >= MAX_RECURRENCE_COUNT) break; // guard huge series
          processed += 1;
          await updateDoc(sibling.ref, seriesShared);
          // Re-sync this sibling's ticket_tiers to match the edited tiers.
          const sibExisting = await getDocs(
            query(collection(db, 'ticket_tiers'), where('event_id', '==', sibling.id))
          );
          await Promise.all(sibExisting.docs.map((d) => deleteDoc(d.ref)));
          await Promise.all(
            eventData.ticket_tiers.map((tier, index) =>
              addDoc(collection(db, 'ticket_tiers'), buildTierCollectionDoc(sibling.id, tier, index))
            )
          );
        }
        console.log(`Series ${seriesId}: applied edits to ${processed} sibling event(s).`);
      }
    }

    // Password gate — only touch the private/access hash when the event is
    // protected AND a new non-empty code was typed. A blank code in protected
    // mode intentionally preserves the existing hash (organizer left it alone).
    // When toggled off we leave the stale hash untouched (flag is false above).
    if (eventData.is_password_protected) {
      const codeHash = await hashAccessCode(eventData.access_code || '');
      if (codeHash) {
        await writeAccessHash(eventId, codeHash);
      }
    }

    // Publication state, when the caller explicitly asked for it (the
    // publish-vs-draft sheet). Last, so the gate judges the edited event — its
    // tiers are already rewritten above, and the gate reads them to decide
    // whether this is a paid event. Unpublishing is never gated.
    if (options.publish !== undefined) {
      await backendJson(`/api/events/${eventId}/publish`, {
        method: 'POST',
        body: JSON.stringify({ is_published: options.publish }),
      });
    }

    console.log('Event updated successfully:', eventId);
  } catch (error: any) {
    console.error('Error updating event:', error);
    // Keep a gate refusal legible ("Reconnect Stripe…") instead of flattening
    // every failure into the same generic sentence.
    throw new Error(error?.message || 'Failed to update event. Please try again.');
  }
}

/**
 * Upload event banner image to Firebase Storage
 */
async function uploadEventImage(
  organizerId: string,
  localUri: string
): Promise<string> {
  try {
    const response = await fetch(localUri);
    const blob = await response.blob();
    
    const filename = `${organizerId}_${Date.now()}.jpg`;
    const storageRef = ref(storage, `event-images/${filename}`);
    
    await uploadBytes(storageRef, blob);
    const downloadUrl = await getDownloadURL(storageRef);
    
    return downloadUrl;
  } catch (error) {
    console.error('Error uploading event image:', error);
    throw new Error('Failed to upload event image');
  }
}

/**
 * Parse date and time strings into a Date object
 */
function parseDateTimeString(dateStr: string, timeStr: string): Date {
  // dateStr format: YYYY-MM-DD
  // timeStr format: HH:MM AM/PM
  
  const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) {
    throw new Error('Invalid time format');
  }

  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3].toUpperCase();

  // Convert to 24-hour format
  if (period === 'PM' && hours !== 12) {
    hours += 12;
  } else if (period === 'AM' && hours === 12) {
    hours = 0;
  }

  const date = new Date(`${dateStr}T00:00:00`);
  date.setHours(hours, minutes, 0, 0);
  
  return date;
}

/**
 * Toggle event publication status (pause/resume ticket sales).
 *
 * Goes through the web publish route rather than writing is_published straight
 * to Firestore. Firestore rules leave that field client-mutable so organizers
 * can legitimately toggle publish, which means a direct write also skipped every
 * pre-publish check — an organizer could resume sales on a paid US/CA/FR event
 * whose Stripe account can no longer accept charges, and the failure would only
 * surface to the buyer at checkout. The route enforces the gate and hands back a
 * message worth showing; resuming is exactly when it needs re-checking.
 *
 * Unpublishing is never gated, so pausing still works regardless of payout state.
 */
export async function toggleEventPublication(
  eventId: string,
  isPublished: boolean
): Promise<void> {
  try {
    console.log(`Toggling event ${eventId} publication to:`, isPublished);
    await backendJson(`/api/events/${eventId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ is_published: isPublished }),
    });
    console.log(`Event ${isPublished ? 'published' : 'unpublished'} successfully. Status set to: ${isPublished ? 'published' : 'draft'}`);
  } catch (error: any) {
    console.error('Error toggling event publication:', error);
    // Preserve the server's explanation (e.g. "Reconnect Stripe in Payout
    // settings...") — the caller shows error.message directly.
    throw new Error(error?.message || 'Failed to update event status');
  }
}

/**
 * Cancel an event
 */
export type CancelEventOutcome = {
  ticketsAffected: number
  refundsSucceeded: number
  refundsQueuedManual: number
  refundsFailed: number
  freeTicketsVoided: number
}

/**
 * Cancelling goes through the SERVER, not a client Firestore write.
 *
 * The old client write flipped a status and left everything else standing:
 * tickets stayed valid, buyers were never told, and the takings stayed
 * withdrawable. Refunds, the payout freeze and buyer notifications can only be
 * done with admin credentials, so the API owns the whole operation and reports
 * back what it did.
 */
export async function cancelEvent(eventId: string, reason?: string): Promise<CancelEventOutcome> {
  return await backendJson<CancelEventOutcome>(`/api/events/${eventId}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason || null }),
  });
}

/**
 * Delete an event and all related data
 */
export async function deleteEvent(eventId: string): Promise<void> {
  try {
    // Delete ticket_tiers
    const tiersQuery = query(
      collection(db, 'ticket_tiers'),
      where('event_id', '==', eventId)
    );
    const tiersSnapshot = await getDocs(tiersQuery);
    const deleteTierPromises = tiersSnapshot.docs.map(doc => deleteDoc(doc.ref));
    await Promise.all(deleteTierPromises);

    // Delete the event document
    await deleteDoc(doc(db, 'events', eventId));
    
    console.log('Event deleted successfully');
  } catch (error) {
    console.error('Error deleting event:', error);
    throw new Error('Failed to delete event');
  }
}
