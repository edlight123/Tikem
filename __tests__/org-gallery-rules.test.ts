/**
 * The org page's photo gallery rules (lib/gallery.ts) and the app's copy
 * (mobile/lib/galleryRules.ts): reorder menu, read-back filtering, and the
 * banner template keys staying in step.
 */
import {
  availableMoves,
  moveGalleryPhoto,
  ownStorageUrl,
  readGallery,
  sanitizeGallery,
  MAX_GALLERY_PHOTOS,
} from '@/lib/gallery'
import { COVER_TEMPLATES, resolveOrgCover } from '@/lib/organizer/cover'
import * as app from '@/mobile/lib/galleryRules'

const BUCKET = 'tikem-test.appspot.com'
const own = (file: string, org = 'org1') =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(`org-pages/${org}/${file}`)}?alt=media&token=t`

describe('moveGalleryPhoto', () => {
  const list = ['a', 'b', 'c', 'd']

  it.each([
    [2, 'first', ['c', 'a', 'b', 'd']],
    [2, 'up', ['a', 'c', 'b', 'd']],
    [1, 'down', ['a', 'c', 'b', 'd']],
    [1, 'last', ['a', 'c', 'd', 'b']],
    [0, 'last', ['b', 'c', 'd', 'a']],
    [3, 'first', ['d', 'a', 'b', 'c']],
  ] as const)('moves item %i %s', (index, move, expected) => {
    expect(moveGalleryPhoto(list, index, move)).toEqual(expected)
    expect(app.moveGalleryPhoto(list, index, move)).toEqual(expected)
  })

  it('a move that goes nowhere keeps the order (and never mutates the input)', () => {
    expect(moveGalleryPhoto(list, 0, 'up')).toEqual(list)
    expect(moveGalleryPhoto(list, 0, 'first')).toEqual(list)
    expect(moveGalleryPhoto(list, 3, 'down')).toEqual(list)
    expect(moveGalleryPhoto(list, 9, 'up')).toEqual(list)
    expect(moveGalleryPhoto(list, -1, 'down')).toEqual(list)
    expect(moveGalleryPhoto(list, 1.5, 'down')).toEqual(list)
    expect(list).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('availableMoves', () => {
  it('offers only moves that do something', () => {
    expect(availableMoves(0, 4)).toEqual(['down', 'last'])
    expect(availableMoves(3, 4)).toEqual(['first', 'up'])
    expect(availableMoves(1, 4)).toEqual(['first', 'up', 'down', 'last'])
    expect(availableMoves(0, 1)).toEqual([])
    expect(availableMoves(5, 4)).toEqual([])
    for (const [i, n] of [
      [0, 4],
      [3, 4],
      [1, 4],
      [0, 1],
    ]) {
      expect(app.availableMoves(i, n)).toEqual(availableMoves(i, n))
    }
  })
})

describe('reading a stored gallery', () => {
  const check = (u: unknown) => ownStorageUrl(u, BUCKET, 'org-pages/org1/')

  it('keeps only the org own uploads, in order, without duplicates, max 12', () => {
    const stored = [
      own('a.jpg'),
      { url: own('b.jpg'), caption: 'The crowd' },
      own('a.jpg'),
      'https://evil.example/x.jpg',
      own('c.jpg', 'other-org'),
      { url: 'javascript:alert(1)' },
      ...Array.from({ length: 14 }, (_, i) => own(`g${i}.jpg`)),
    ]
    const web = readGallery(stored, check)
    expect(web.slice(0, 2)).toEqual([
      { url: own('a.jpg'), caption: null },
      { url: own('b.jpg'), caption: 'The crowd' },
    ])
    expect(web).toHaveLength(MAX_GALLERY_PHOTOS)
    const mobile = app.readGallery(stored, 'org1')
    expect(mobile).toEqual(web)
  })

  it('is empty for anything that is not a list', () => {
    expect(readGallery(null)).toEqual([])
    expect(readGallery('x')).toEqual([])
    expect(app.readGallery({})).toEqual([])
  })

  it('sanitizeGallery refuses a non-list or a bad URL', () => {
    expect(sanitizeGallery('x').ok).toBe(false)
    expect(sanitizeGallery(['http://insecure.example/a.jpg']).ok).toBe(false)
    expect(sanitizeGallery([own('a.jpg')], { checkUrl: check })).toEqual({ ok: true, gallery: [{ url: own('a.jpg'), caption: null }] })
  })

  it('ownStorageUrl refuses path tricks', () => {
    expect(check(`https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent('org-pages/org1/../org2/x.jpg')}`)).toBeNull()
    expect(check(`https://storage.googleapis.com/${BUCKET}/org-pages/org1/x.jpg`)).toBe(
      `https://storage.googleapis.com/${BUCKET}/org-pages/org1/x.jpg`
    )
  })
})

describe('banner', () => {
  it('web and app share the template keys', () => {
    expect([...app.COVER_TEMPLATES]).toEqual([...COVER_TEMPLATES])
  })

  it('resolves a template or the org own upload, nothing else', () => {
    expect(resolveOrgCover('org1', { coverTemplate: 'mizik' }, BUCKET)).toEqual({
      kind: 'template',
      key: 'mizik',
      src: '/art/world-photos/mizik.jpg',
    })
    expect(resolveOrgCover('org1', { coverImageUrl: own('cover.jpg') }, BUCKET)).toEqual({ kind: 'upload', src: own('cover.jpg') })
    expect(resolveOrgCover('org1', { coverImageUrl: own('cover.jpg', 'org2') }, BUCKET)).toBeNull()
    expect(resolveOrgCover('org1', { coverTemplate: 'nope', coverImageUrl: 'https://evil.example/x.jpg' }, BUCKET)).toBeNull()

    expect(app.readOrgCover('org1', { coverTemplate: 'kilti' })).toEqual({ kind: 'template', key: 'kilti' })
    expect(app.readOrgCover('org1', { coverImageUrl: own('cover.jpg') })).toEqual({ kind: 'upload', url: own('cover.jpg') })
    expect(app.readOrgCover('org1', { coverImageUrl: own('cover.jpg', 'org2') })).toBeNull()
  })
})
