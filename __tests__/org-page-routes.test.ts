/**
 * The organization page's banner and photos (/api/organizer/settings/cover,
 * /api/organizer/settings/gallery): only the org's owner or a team admin may
 * change them (requireOrg('manage_settings')), they land on
 * public_profiles/{orgId}, and only a known template or the org's OWN uploads
 * (org-pages/{orgId}/ in our bucket) are accepted.
 *
 * @jest-environment node
 */
const store = new Map<string, any>()

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    get: async () => ({ exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path) }),
    set: async (data: any, opts?: any) => {
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data)
    },
    delete: async () => {
      store.delete(path)
    },
    collection: (name: string) => colRef(`${path}/${name}`),
  }
}

function colRef(path: string): any {
  return {
    doc: (id: string) => docRef(`${path}/${id}`),
    where: () => colRef(path),
    limit: () => colRef(path),
    get: async () => ({ docs: [], empty: true, size: 0 }),
  }
}

const saved: string[] = []
const deleted: string[] = []
const BUCKET = 'tikem-test.appspot.com'

jest.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => colRef(name),
    batch: () => {
      const ops: (() => Promise<void>)[] = []
      return {
        set: (ref: any, data: any, opts?: any) => ops.push(() => ref.set(data, opts)),
        commit: async () => {
          for (const op of ops) await op()
        },
      }
    },
  },
  adminAuth: {},
  adminStorage: {
    bucket: () => ({
      name: 'tikem-test.appspot.com',
      file: (name: string) => ({
        name,
        bucket: { name: 'tikem-test.appspot.com' },
        save: async () => {
          saved.push(name)
        },
        setMetadata: async () => undefined,
        delete: async () => {
          deleted.push(name)
        },
      }),
    }),
  },
}))

let orgHeader: string | null = null
jest.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => (name.toLowerCase() === 'x-tikem-org' ? orgHeader : null) }),
  cookies: async () => ({ get: () => undefined }),
}))

let currentUser: any = null
jest.mock('@/lib/auth', () => ({
  getCurrentUser: async () => currentUser,
  requireAuth: async () => (currentUser ? { user: currentUser, error: null } : { user: null, error: 'Not authenticated' }),
}))

import { GET as coverGET, POST as coverPOST, PUT as coverPUT } from '@/app/api/organizer/settings/cover/route'
import { GET as galleryGET, POST as galleryPOST, PUT as galleryPUT } from '@/app/api/organizer/settings/gallery/route'

const OWNER = { id: 'owner1', role: 'organizer' }
const ADMIN_MEMBER = { id: 'adm1', role: 'attendee' }
const MANAGER = { id: 'mgr1', role: 'attendee' }
const STRANGER = { id: 'eve', role: 'attendee' }

const own = (file: string, org = 'owner1') =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`org-pages/${org}/${file}`)}?alt=media&token=t`

// A tiny valid PNG (the sniffer checks the magic bytes).
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c10000000049454e44ae426082',
  'hex'
)

function json(method: string, body: any) {
  return new Request('https://www.tikem.co/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function upload(bytes: Buffer = PNG) {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'p.png')
  return new Request('https://www.tikem.co/api/x', { method: 'POST', body: form })
}

beforeAll(() => {
  process.env.FIREBASE_STORAGE_BUCKET = BUCKET
})

beforeEach(() => {
  store.clear()
  saved.length = 0
  deleted.length = 0
  orgHeader = null
  currentUser = null
  store.set('organizers/owner1/team/adm1', { uid: 'adm1', role: 'admin', status: 'active' })
  store.set('organizers/owner1/team/mgr1', { uid: 'mgr1', role: 'manager', status: 'active' })
})

describe('cover route permissions', () => {
  it('401 signed out', async () => {
    expect((await coverGET()).status).toBe(401)
    expect((await coverPUT(json('PUT', { template: 'mizik' }))).status).toBe(401)
  })

  it('403 for a manager acting for the org and for a stranger', async () => {
    currentUser = MANAGER
    orgHeader = 'owner1'
    expect((await coverPUT(json('PUT', { template: 'mizik' }))).status).toBe(403)
    currentUser = STRANGER
    orgHeader = 'owner1'
    expect((await coverPUT(json('PUT', { template: 'mizik' }))).status).toBe(403)
    expect(store.get('public_profiles/owner1')).toBeUndefined()
  })

  it('the owner picks a template; a team admin can change it for the org', async () => {
    currentUser = OWNER
    const res = await coverPUT(json('PUT', { template: 'mizik' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ coverTemplate: 'mizik', coverImageUrl: null })
    expect(store.get('public_profiles/owner1')).toMatchObject({ coverTemplate: 'mizik', coverImageUrl: null })

    currentUser = ADMIN_MEMBER
    orgHeader = 'owner1'
    expect((await coverPUT(json('PUT', { template: 'kilti' }))).status).toBe(200)
    expect(store.get('public_profiles/owner1')).toMatchObject({ coverTemplate: 'kilti' })
    // Nothing landed on the admin's own page.
    expect(store.get('public_profiles/adm1')).toBeUndefined()
  })

  it('refuses an unknown template and a URL that is not the org own upload', async () => {
    currentUser = OWNER
    expect((await coverPUT(json('PUT', { template: 'beach' }))).status).toBe(400)
    for (const bad of [
      'https://evil.example/x.jpg',
      own('cover_1.jpg', 'someone-else'),
      `https://firebasestorage.googleapis.com/v0/b/other-bucket/o/${encodeURIComponent('org-pages/owner1/x.jpg')}`,
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent('profile-images/owner1/x.jpg')}`,
      'javascript:alert(1)',
    ]) {
      expect((await coverPUT(json('PUT', { coverImageUrl: bad }))).status).toBe(400)
    }
    expect((await coverPUT(json('PUT', { coverImageUrl: own('cover_1.jpg') }))).status).toBe(200)
    expect(store.get('public_profiles/owner1')).toMatchObject({ coverTemplate: null, coverImageUrl: own('cover_1.jpg') })
  })

  it('null clears the banner', async () => {
    currentUser = OWNER
    store.set('public_profiles/owner1', { coverTemplate: 'mizik' })
    expect((await coverPUT(json('PUT', { template: null }))).status).toBe(200)
    expect(store.get('public_profiles/owner1')).toMatchObject({ coverTemplate: null, coverImageUrl: null })
  })

  it('an upload is stored under the org path, never the uploader', async () => {
    currentUser = ADMIN_MEMBER
    orgHeader = 'owner1'
    const res = await coverPOST(upload())
    expect(res.status).toBe(200)
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatch(/^org-pages\/owner1\/cover_\d+_[0-9a-f]{8}\.png$/)
    expect(store.get('public_profiles/owner1').coverImageUrl).toContain(encodeURIComponent('org-pages/owner1/'))
  })

  it('an upload that is not an image is refused', async () => {
    currentUser = OWNER
    const res = await coverPOST(upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')))
    expect(res.status).toBe(400)
    expect(saved).toHaveLength(0)
  })

  it('a manager cannot upload', async () => {
    currentUser = MANAGER
    orgHeader = 'owner1'
    expect((await coverPOST(upload())).status).toBe(403)
    expect(saved).toHaveLength(0)
  })
})

describe('gallery route', () => {
  it('401 / 403 for the wrong people', async () => {
    expect((await galleryGET()).status).toBe(401)
    currentUser = MANAGER
    orgHeader = 'owner1'
    expect((await galleryPUT(json('PUT', { gallery: [] }))).status).toBe(403)
    expect((await galleryPOST(upload())).status).toBe(403)
  })

  it('saves the whole ordered list of the org own uploads, captions clipped', async () => {
    currentUser = OWNER
    const gallery = [{ url: own('gallery_2.jpg'), caption: '  Day party\n at the beach ' }, own('gallery_1.jpg')]
    const res = await galleryPUT(json('PUT', { gallery }))
    expect(res.status).toBe(200)
    expect(store.get('public_profiles/owner1').gallery).toEqual([
      { url: own('gallery_2.jpg'), caption: 'Day party at the beach' },
      { url: own('gallery_1.jpg'), caption: null },
    ])
  })

  it('refuses a photo that is not one of the org uploads, and more than 12', async () => {
    currentUser = OWNER
    expect((await galleryPUT(json('PUT', { gallery: ['https://evil.example/a.jpg'] }))).status).toBe(400)
    expect((await galleryPUT(json('PUT', { gallery: [own('a.jpg', 'other-org')] }))).status).toBe(400)
    const thirteen = Array.from({ length: 13 }, (_, i) => own(`g${i}.jpg`))
    expect((await galleryPUT(json('PUT', { gallery: thirteen }))).status).toBe(400)
    expect((await galleryPUT(json('PUT', { gallery: 'nope' }))).status).toBe(400)
  })

  it('a removed photo is deleted from storage too', async () => {
    currentUser = OWNER
    store.set('public_profiles/owner1', { gallery: [{ url: own('a.jpg'), caption: null }, { url: own('b.jpg'), caption: null }] })
    expect((await galleryPUT(json('PUT', { gallery: [own('b.jpg')] }))).status).toBe(200)
    expect(deleted).toEqual(['org-pages/owner1/a.jpg'])
  })

  it('an admin upload appends to the org gallery; a full gallery is refused before storing', async () => {
    currentUser = ADMIN_MEMBER
    orgHeader = 'owner1'
    const res = await galleryPOST(upload())
    expect(res.status).toBe(200)
    expect((await res.json()).gallery).toHaveLength(1)
    expect(saved[0]).toMatch(/^org-pages\/owner1\/gallery_/)

    store.set('public_profiles/owner1', { gallery: Array.from({ length: 12 }, (_, i) => ({ url: own(`g${i}.jpg`), caption: null })) })
    saved.length = 0
    const full = await galleryPOST(upload())
    expect(full.status).toBe(409)
    expect(saved).toHaveLength(0)
  })

  it('reads back only the org own uploads', async () => {
    currentUser = OWNER
    store.set('public_profiles/owner1', { gallery: [own('a.jpg'), 'https://evil.example/x.jpg', { url: 'javascript:alert(1)' }] })
    const res = await galleryGET()
    expect((await res.json()).gallery).toEqual([{ url: own('a.jpg'), caption: null }])
  })
})
