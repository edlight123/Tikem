import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/auth'
import { adminDb } from '@/lib/firebase/admin'
import { adminError, adminOk } from '@/lib/api/admin-response'
import { logAdminAction } from '@/lib/admin/audit-log'

export const runtime = 'nodejs'

type Seed20Request = {
  // Organizer email to own the events.
  organizerEmail?: string
  organizerName?: string
  // Optional label so you can search/filter seeded events later.
  batchTag?: string
  // When true, newly created events are published.
  publish?: boolean
}

function isoInDays(days: number, hourLocal = 19): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hourLocal, 0, 0, 0)
  return d.toISOString()
}

function addHours(iso: string, hours: number): string {
  const d = new Date(iso)
  d.setHours(d.getHours() + hours)
  return d.toISOString()
}

async function ensureOrganizerUser(options: {
  email: string
  fullName: string
  default_country: string
}): Promise<string> {
  const snapshot = await adminDb
    .collection('users')
    .where('email', '==', options.email)
    .limit(1)
    .get()

  if (!snapshot.empty) {
    const doc = snapshot.docs[0]
    await doc.ref.set(
      {
        full_name: options.fullName,
        role: 'organizer',
        is_organizer: true,
        is_verified: true,
        verification_status: 'approved',
        default_country: options.default_country,
        updated_at: new Date(),
      },
      { merge: true }
    )
    return doc.id
  }

  const ref = adminDb.collection('users').doc()
  await ref.set({
    email: options.email,
    full_name: options.fullName,
    role: 'organizer',
    is_organizer: true,
    is_verified: true,
    verification_status: 'approved',
    default_country: options.default_country,
    created_at: new Date(),
    updated_at: new Date(),
  })

  return ref.id
}

function pick<T>(arr: T[], index: number): T {
  return arr[index % arr.length]
}

async function seed20(options: { admin: { id: string; email: string | null | undefined }; input: Seed20Request }) {

  const organizerEmail = String(options.input?.organizerEmail || 'info@edlight.org')
    .trim()
    .toLowerCase()
  const organizerName =
    String(options.input?.organizerName || 'EdLight Initiative').trim() || 'EdLight Initiative'

  const publish = options.input?.publish !== false
  const batchTag = String(options.input?.batchTag || `seed20_${new Date().toISOString()}`).slice(
    0,
    80
  )

  // Use Haiti as default_country for the organizer profile (does not affect event country routing).
  const organizerId = await ensureOrganizerUser({
    email: organizerEmail,
    fullName: organizerName,
    default_country: 'HT',
  })

  const usCities = [
    { city: 'Miami', commune: 'Miami', venue: 'Wynwood Warehouse', address: 'Wynwood, Miami, FL' },
    { city: 'New York', commune: 'Manhattan', venue: 'Midtown Loft', address: 'Midtown, New York, NY' },
    { city: 'Boston', commune: 'Boston', venue: 'Seaport Hall', address: 'Seaport, Boston, MA' },
    { city: 'Atlanta', commune: 'Atlanta', venue: 'Downtown Venue', address: 'Downtown, Atlanta, GA' },
    { city: 'Orlando', commune: 'Orlando', venue: 'Lake Eola Pavilion', address: 'Orlando, FL' },
  ]

  const caCities = [
    { city: 'Toronto', commune: 'Toronto', venue: 'Downtown Hub', address: 'Downtown, Toronto, ON' },
    { city: 'Montreal', commune: 'Montreal', venue: 'Old Port Pavilion', address: 'Vieux-Port, Montréal, QC' },
    { city: 'Ottawa', commune: 'Ottawa', venue: 'ByWard Hall', address: 'ByWard Market, Ottawa, ON' },
    { city: 'Vancouver', commune: 'Vancouver', venue: 'Gastown Studio', address: 'Gastown, Vancouver, BC' },
  ]

  const htCities = [
    { city: 'Port-au-Prince', commune: 'Port-au-Prince', venue: 'Champ de Mars', address: 'Place des Héros, Port-au-Prince' },
    { city: 'Petion-Ville', commune: 'Petion-Ville', venue: 'Hotel Montana', address: 'Rue Frank Cardozo, Pétion-Ville' },
    { city: 'Cap-Haitien', commune: 'Cap-Haitien', venue: 'Place d’Armes', address: 'Centre-ville, Cap-Haïtien' },
    { city: 'Les Cayes', commune: 'Les Cayes', venue: 'Centre Culturel', address: 'Les Cayes, Sud' },
  ]

  const categories = [
    'Music',
    'Food & Drink',
    'Business',
    'Technology',
    'Arts & Culture',
    'Community',
    'Education',
  ]

  const banners = [
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&h=600&fit=crop',
    'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200&h=600&fit=crop',
    'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=1200&h=600&fit=crop',
    'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=1200&h=600&fit=crop',
    'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1200&h=600&fit=crop',
    'https://images.unsplash.com/photo-1557426272-fc759fdf7a8d?w=1200&h=600&fit=crop',
  ]

  const eventsToCreate: any[] = []

  // 7 US events (USD)
  for (let i = 0; i < 7; i++) {
    const loc = pick(usCities, i)
    const category = pick(categories, i)
    const start = isoInDays(2 + i, 20)
    eventsToCreate.push({
      organizer_id: organizerId,
      organizer_name: organizerName,
      title: `[${batchTag}] US ${loc.city} ${category} Night (USD) #${i + 1}`,
      description: `Seed event in ${loc.city}, USA for testing discover + payments.`,
      category,
      country: 'US',
      city: loc.city,
      commune: loc.commune,
      venue_name: loc.venue,
      address: loc.address,
      start_datetime: start,
      end_datetime: addHours(start, 3),
      currency: 'USD',
      ticket_price: 25 + i * 5,
      total_tickets: 250,
      banner_image_url: pick(banners, i),
      is_published: publish,
      status: publish ? 'published' : 'draft',
      tags: ['seed', batchTag, 'US', 'USD'],
      created_at: new Date(),
      updated_at: new Date(),
    })
  }

  // 7 CA events (USD)
  for (let i = 0; i < 7; i++) {
    const loc = pick(caCities, i)
    const category = pick(categories, i + 3)
    const start = isoInDays(3 + i, 19)
    eventsToCreate.push({
      organizer_id: organizerId,
      organizer_name: organizerName,
      title: `[${batchTag}] CA ${loc.city} ${category} Event (USD) #${i + 1}`,
      description: `Seed event in ${loc.city}, Canada for testing discover + payments.`,
      category,
      country: 'CA',
      city: loc.city,
      commune: loc.commune,
      venue_name: loc.venue,
      address: loc.address,
      start_datetime: start,
      end_datetime: addHours(start, 2),
      currency: 'USD',
      ticket_price: 20 + i * 4,
      total_tickets: 300,
      banner_image_url: pick(banners, i + 2),
      is_published: publish,
      status: publish ? 'published' : 'draft',
      tags: ['seed', batchTag, 'CA', 'USD'],
      created_at: new Date(),
      updated_at: new Date(),
    })
  }

  // 6 HT events (HTG)
  for (let i = 0; i < 6; i++) {
    const loc = pick(htCities, i)
    const category = pick(categories, i + 1)
    const start = isoInDays(1 + i, 18)
    eventsToCreate.push({
      organizer_id: organizerId,
      organizer_name: organizerName,
      title: `[${batchTag}] HT ${loc.city} ${category} (HTG) #${i + 1}`,
      description: `Seed event in ${loc.city}, Haiti for testing discover + HTG currency.`,
      category,
      country: 'HT',
      city: loc.city,
      commune: loc.commune,
      venue_name: loc.venue,
      address: loc.address,
      start_datetime: start,
      end_datetime: addHours(start, 4),
      currency: 'HTG',
      ticket_price: 750 + i * 250,
      total_tickets: 500,
      banner_image_url: pick(banners, i + 1),
      is_published: publish,
      status: publish ? 'published' : 'draft',
      tags: ['seed', batchTag, 'HT', 'HTG'],
      created_at: new Date(),
      updated_at: new Date(),
    })
  }

  const batch = adminDb.batch()
  const created: Array<{ id: string; title: string; country: string; city: string; currency: string }> = []

  for (const e of eventsToCreate) {
    const ref = adminDb.collection('events').doc()
    batch.set(ref, { ...e, id: ref.id })

    // Create a default tier so tier-based purchase flows work out of the box.
    const tierId = `seed_${ref.id}_ga`
    const tierRef = adminDb.collection('ticket_tiers').doc(tierId)
    batch.set(tierRef, {
      id: tierId,
      event_id: ref.id,
      name: 'General Admission',
      description: null,
      price: typeof e.ticket_price === 'number' ? e.ticket_price : Number(e.ticket_price || 0),
      total_quantity: typeof e.total_tickets === 'number' ? e.total_tickets : Number(e.total_tickets || 0),
      sold_quantity: 0,
      sales_start: null,
      sales_end: null,
      sort_order: 0,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    created.push({
      id: ref.id,
      title: e.title,
      country: e.country,
      city: e.city,
      currency: e.currency,
    })
  }

  await batch.commit()

  await logAdminAction({
    action: 'admin.backfill',
    adminId: options.admin.id,
    adminEmail: options.admin.email || 'unknown',
    resourceType: 'events',
    details: {
      name: 'events.seed-20',
      organizerEmail,
      organizerId,
      batchTag,
      publish,
      createdCount: created.length,
    },
  })

  return adminOk({
    organizerEmail,
    organizerId,
    batchTag,
    publish,
    createdCount: created.length,
    created,
    tips: {
      discover: 'Visit /discover. Seeded events have titles prefixed with the batchTag.',
      admin: 'Visit /admin/events and search by batchTag.',
    },
  })
}

/**
 * Informational only. Seeding used to run from `GET ?run=1`, which made a
 * state-changing write reachable by a plain link or <img> (a top-level GET
 * carries SameSite=Lax cookies). It now runs only from POST.
 */
export async function GET() {
  const { user, error } = await requireSuperAdmin()
  if (error || !user) {
    return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
  }
  return adminOk({
    message: 'This endpoint seeds 20 events. Send a POST with a JSON body to run it.',
    defaults: {
      organizerEmail: 'info@edlight.org',
      organizerName: 'EdLight Initiative',
      publish: true,
    },
    body: { organizerEmail: 'string?', organizerName: 'string?', batchTag: 'string?', publish: 'boolean?' },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: 'GET, POST, OPTIONS',
    },
  })
}

export async function POST(request: NextRequest) {
  try {
    const { user, error } = await requireSuperAdmin()
    if (error || !user) {
      return adminError(error || 'Unauthorized', error === 'Not authenticated' ? 401 : 403)
    }
    // JSON only: a cross-site form/text POST cannot send this content type
    // without a CORS preflight, which we never grant.
    if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return adminError('Content-Type must be application/json', 415)
    }

    const body = (await request.json().catch(() => ({}))) as Seed20Request
    return await seed20({ admin: { id: user.id, email: user.email }, input: body })
  } catch (e: any) {
    console.error('seed-20 failed:', e)
    return adminError('Internal server error', 500)
  }
}
