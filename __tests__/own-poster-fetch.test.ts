/**
 * @jest-environment node
 *
 * Server-side poster fetches (share card, Apple Wallet background) read only
 * OUR posters, as a capped stream: lib/posters/hosts.
 */
process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'tikem-test.appspot.com'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { isOwnPoster, fetchOwnPoster } = require('@/lib/posters/hosts')

const OURS = 'https://firebasestorage.googleapis.com/v0/b/tikem-test.appspot.com/o/events%2Fa.jpg?alt=media'

function streamResponse(chunks: Uint8Array[], headers: Record<string, string>) {
  let i = 0
  const cancel = jest.fn()
  const body = {
    getReader: () => ({
      read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined }),
      cancel,
    }),
  }
  return {
    res: { ok: true, status: 200, headers: new Headers(headers), body } as any,
    cancel,
    reads: () => i,
  }
}

describe('isOwnPoster', () => {
  it('accepts our bucket and Unsplash photos only', () => {
    expect(isOwnPoster(OURS)).toBe(true)
    expect(isOwnPoster('https://storage.googleapis.com/tikem-test.appspot.com/x.jpg')).toBe(true)
    expect(isOwnPoster('https://images.unsplash.com/photo-123?w=800')).toBe(true)
  })
  it('refuses another bucket on the same storage host, and other hosts', () => {
    expect(isOwnPoster('https://firebasestorage.googleapis.com/v0/b/someone-else/o/x.jpg')).toBe(false)
    expect(isOwnPoster('https://storage.googleapis.com/someone-else/x.jpg')).toBe(false)
    expect(isOwnPoster('https://images.unsplash.com/profile-1')).toBe(false)
    expect(isOwnPoster('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isOwnPoster('http://firebasestorage.googleapis.com/v0/b/tikem-test.appspot.com/o/a.jpg')).toBe(false)
    expect(isOwnPoster('https://evil.example/a.jpg')).toBe(false)
  })
})

describe('fetchOwnPoster', () => {
  const realFetch = global.fetch
  afterEach(() => {
    global.fetch = realFetch
  })

  it('never fetches a URL that is not ours', async () => {
    const f = jest.fn()
    global.fetch = f as any
    await expect(fetchOwnPoster('https://evil.example/a.jpg')).resolves.toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses redirects and passes a timeout signal when asked', async () => {
    const s = streamResponse([new Uint8Array([1, 2, 3])], { 'content-type': 'image/jpeg' })
    const f = jest.fn().mockResolvedValue(s.res)
    global.fetch = f as any
    const buf = await fetchOwnPoster(OURS, { timeoutMs: 5000 })
    expect(buf?.length).toBe(3)
    expect(f.mock.calls[0][1].redirect).toBe('error')
    expect(f.mock.calls[0][1].signal).toBeDefined()
  })

  it('rejects a declared oversize body before reading it', async () => {
    const s = streamResponse([new Uint8Array(10)], {
      'content-type': 'image/png',
      'content-length': String(16 * 1024 * 1024),
    })
    global.fetch = jest.fn().mockResolvedValue(s.res) as any
    await expect(fetchOwnPoster(OURS)).rejects.toThrow('too large')
    expect(s.reads()).toBe(0)
  })

  it('stops reading an undeclared stream once it passes 15MB', async () => {
    const MB = new Uint8Array(1024 * 1024)
    const s = streamResponse(Array.from({ length: 40 }, () => MB), { 'content-type': 'image/jpeg' })
    global.fetch = jest.fn().mockResolvedValue(s.res) as any
    await expect(fetchOwnPoster(OURS)).rejects.toThrow('too large')
    expect(s.reads()).toBe(16)
    expect(s.cancel).toHaveBeenCalled()
  })

  it('rejects a non-image', async () => {
    const s = streamResponse([new Uint8Array(1)], { 'content-type': 'text/html' })
    global.fetch = jest.fn().mockResolvedValue(s.res) as any
    await expect(fetchOwnPoster(OURS)).rejects.toThrow('not an image')
  })
})
