// Demo mode configuration and helpers

// Demo user credentials
export const DEMO_USERS = {
  organizer: {
    email: 'demo-organizer@tikem.co',
    password: 'demo123',
    name: 'Demo Organizer',
    id: 'demo-organizer-id'
  },
  attendee: {
    email: 'demo-attendee@tikem.co',
    password: 'demo123',
    name: 'Demo Attendee',
    id: 'demo-attendee-id'
  }
}

// Demo events data
export const DEMO_EVENTS = [
  {
    id: 'demo-event-1',
    organizer_id: 'demo-organizer-id',
    title: 'Haiti Jazz Festival 2025',
    description: 'Experience the vibrant sounds of Haitian jazz with international and local artists. Three days of music, culture, and celebration under the stars.',
    category: 'Music',
    venue_name: 'Parc de Martissant',
    city: 'Port-au-Prince',
    commune: 'Turgeau',
    address: 'Parc de Martissant, Route de Martissant',
    start_datetime: '2025-12-15T18:00:00',
    end_datetime: '2025-12-17T23:00:00',
    banner_image_url: 'https://images.unsplash.com/photo-1514320291840-2e0a9bf2a9ae?w=800',
    ticket_price: 2500,
    currency: 'HTG',
    total_tickets: 500,
    tickets_sold: 158,
    is_published: true,
    created_at: '2025-10-01T10:00:00',
    updated_at: '2025-10-01T10:00:00'
  },
  {
    id: 'demo-event-2',
    organizer_id: 'demo-organizer-id',
    title: 'Tech Summit Haiti',
    description: 'Join entrepreneurs, developers, and innovators for a full day of talks, workshops, and networking. Learn about the latest trends in tech and startups.',
    category: 'Conference',
    venue_name: 'Karibe Hotel Convention Center',
    city: 'Pétion-Ville',
    commune: 'Pétion-Ville',
    address: 'Juvenat 7, Pétion-Ville',
    start_datetime: '2025-11-25T09:00:00',
    end_datetime: '2025-11-25T18:00:00',
    banner_image_url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800',
    ticket_price: 1500,
    currency: 'HTG',
    total_tickets: 200,
    tickets_sold: 113,
    is_published: true,
    created_at: '2025-09-15T14:00:00',
    updated_at: '2025-09-15T14:00:00'
  },
  {
    id: 'demo-event-3',
    organizer_id: 'demo-organizer-id',
    title: 'Haitian Food Festival',
    description: 'Celebrate Haitian cuisine with cooking demonstrations, tastings, and competitions. Featuring renowned chefs and traditional recipes passed down through generations.',
    category: 'Food & Drink',
    venue_name: 'Place Boyer',
    city: 'Pétion-Ville',
    commune: 'Pétion-Ville',
    address: 'Place Boyer, Centre-Ville',
    start_datetime: '2025-12-01T11:00:00',
    end_datetime: '2025-12-01T20:00:00',
    banner_image_url: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=800',
    ticket_price: 1000,
    currency: 'HTG',
    total_tickets: 300,
    tickets_sold: 144,
    is_published: true,
    created_at: '2025-10-10T12:00:00',
    updated_at: '2025-10-10T12:00:00'
  },
  {
    id: 'demo-event-4',
    organizer_id: 'demo-organizer-id',
    title: 'Caribbean Art Exhibition',
    description: 'Explore contemporary art from Haiti and the Caribbean. Gallery opening featuring 40+ artists, live painting, and cultural performances.',
    category: 'Arts',
    venue_name: 'Musée du Panthéon National',
    city: 'Port-au-Prince',
    commune: 'Port-au-Prince',
    address: 'Champ de Mars, Port-au-Prince',
    start_datetime: '2025-11-30T17:00:00',
    end_datetime: '2025-11-30T22:00:00',
    banner_image_url: 'https://images.unsplash.com/photo-1460661419201-fd4cecdf8a8b?w=800',
    ticket_price: 500,
    currency: 'HTG',
    total_tickets: 150,
    tickets_sold: 58,
    is_published: true,
    created_at: '2025-09-20T16:00:00',
    updated_at: '2025-09-20T16:00:00'
  },
  {
    id: 'demo-event-5',
    organizer_id: 'demo-organizer-id',
    title: 'Charity Marathon for Education',
    description: '5K and 10K run to raise funds for schools in rural Haiti. Family-friendly event with activities for all ages.',
    category: 'Sports',
    venue_name: 'Champ de Mars',
    city: 'Port-au-Prince',
    commune: 'Port-au-Prince',
    address: 'Champ de Mars, Downtown',
    start_datetime: '2025-11-28T06:00:00',
    end_datetime: '2025-11-28T11:00:00',
    banner_image_url: 'https://images.unsplash.com/photo-1452626038306-9aae5e071dd3?w=800',
    ticket_price: 750,
    currency: 'HTG',
    total_tickets: 400,
    tickets_sold: 400,
    is_published: true,
    created_at: '2025-08-05T08:00:00',
    updated_at: '2025-08-05T08:00:00'
  },
  {
    id: 'demo-event-6',
    organizer_id: 'demo-organizer-id',
    title: 'New Year\'s Eve Gala',
    description: 'Ring in 2026 with an elegant evening of dinner, dancing, and live entertainment. Formal attire required.',
    category: 'Party',
    venue_name: 'Royal Oasis Hotel',
    city: 'Pétion-Ville',
    commune: 'Pétion-Ville',
    address: 'Route de Kenscoff',
    start_datetime: '2025-12-31T20:00:00',
    end_datetime: '2026-01-01T02:00:00',
    banner_image_url: 'https://images.unsplash.com/photo-1467810563316-b5476525c0f9?w=800',
    ticket_price: 5000,
    currency: 'HTG',
    total_tickets: 250,
    tickets_sold: 67,
    is_published: true,
    created_at: '2025-10-15T10:00:00',
    updated_at: '2025-10-15T10:00:00'
  },
  // Pay at the door (lib/tickets/pay-at-door): reserve free, pay on arrival.
  // Dated from today so the demo always shows it on sale.
  {
    id: 'demo-event-door',
    organizer_id: 'demo-organizer-id',
    title: 'Kanaval Kominote',
    description: 'A neighbourhood carnival night. Reserve your spot online and pay at the door.',
    category: 'Party',
    venue_name: 'Place Boyer',
    city: 'Pétion-Ville',
    commune: 'Pétion-Ville',
    address: 'Place Boyer, Pétion-Ville',
    ...demoDates(14, 19, 5),
    banner_image_url: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800',
    ticket_price: 0,
    currency: 'HTG',
    pay_at_door: true,
    door_price_from: 500,
    amenities: ['parking', 'step_free'],
    venue_setting: 'outdoor',
    age_policy: '18+',
    dress_code: 'All white',
    ticket_tiers: [
      { name: 'General', price: 0, door_price: 500 },
      { name: 'VIP', price: 0, door_price: 1500 },
    ],
    total_tickets: 300,
    tickets_sold: 42,
    is_published: true,
    created_at: '2026-11-01T10:00:00',
    updated_at: '2026-11-01T10:00:00'
  },
  // Family registration (lib/events/family) on a free event with two types.
  {
    id: 'demo-event-family',
    organizer_id: 'demo-organizer-id',
    title: 'Jou Fanmi nan Pak la',
    description: 'A free family day in the park. One person registers the whole family.',
    category: 'Community',
    venue_name: 'Parc Historique de la Canne à Sucre',
    city: 'Port-au-Prince',
    commune: 'Tabarre',
    address: 'Route de Tabarre',
    ...demoDates(21, 10, 6),
    banner_image_url: 'https://images.unsplash.com/photo-1511895426328-dc8714191300?w=800',
    ticket_price: 0,
    currency: 'HTG',
    family_registration: true,
    family_max: 6,
    ticket_tiers: [
      { name: 'Adults', price: 0 },
      { name: 'Children', price: 0 },
    ],
    total_tickets: 400,
    tickets_sold: 120,
    is_published: true,
    created_at: '2026-11-01T10:00:00',
    updated_at: '2026-11-01T10:00:00'
  }
]

/** Start/end ISO strings `days` from now at `hour` local, lasting `hours`. */
function demoDates(days: number, hour: number, hours: number) {
  const start = new Date()
  start.setDate(start.getDate() + days)
  start.setHours(hour, 0, 0, 0)
  const end = new Date(start.getTime() + hours * 3_600_000)
  return { start_datetime: start.toISOString(), end_datetime: end.toISOString() }
}

// Demo tickets for the demo attendee
export const DEMO_TICKETS = [
  {
    id: 'demo-ticket-1',
    event_id: 'demo-event-1',
    attendee_id: 'demo-attendee-id',
    qr_code: 'ticket:demo-ticket-1|event:demo-event-1',
    status: 'active' as const,
    purchased_at: '2025-11-01T14:30:00',
    created_at: '2025-11-01T14:30:00',
    updated_at: '2025-11-01T14:30:00'
  },
  {
    id: 'demo-ticket-2',
    event_id: 'demo-event-3',
    attendee_id: 'demo-attendee-id',
    qr_code: 'ticket:demo-ticket-2|event:demo-event-3',
    status: 'active' as const,
    purchased_at: '2025-11-05T09:15:00',
    created_at: '2025-11-05T09:15:00',
    updated_at: '2025-11-05T09:15:00'
  }
]

// Helper to check if we're in demo mode
export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === 'true'
}

// Helper to check if an email is a demo account
export function isDemoEmail(email: string): boolean {
  return email === DEMO_USERS.organizer.email || email === DEMO_USERS.attendee.email
}

// The demo organizer's public page (app/profile/organizer/[organizerId], demo
// mode only): banner, photos and links, so the page can be reviewed without
// Firestore. Photos are the bundled world photos.
export const DEMO_ORG_PAGE = {
  id: 'demo-organizer-id',
  name: 'Kompa Nights HT',
  personalName: 'Demo Organizer',
  description: 'Konpa nights and day parties in Port-au-Prince and Miami.',
  website: 'https://kompanights.example.com/',
  instagram: 'https://www.instagram.com/kompanights',
  facebook: 'https://www.facebook.com/kompanights',
  coverTemplate: 'lavi-lannwit' as const,
  gallery: ['mizik', 'kilti', 'gastronomi', 'eksperyans'].map((k) => ({ url: `/art/world-photos/${k}.jpg`, caption: null })),
  followers: 248,
  created_at: '2025-03-01T00:00:00.000Z',
}
