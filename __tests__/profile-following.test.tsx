import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import {
  normalizePageParams,
  orderFollowedOrganizerIds,
  pageOfIds,
  toFollowedOrganizer,
} from '@/lib/profile/following'
import { FollowingCard } from '@/components/profile/FollowingCard'

// Keys come back as-is, with {{name}} filled in, so assertions read the key.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && typeof opts.name === 'string' ? `${key}:${opts.name}` : key,
    i18n: { language: 'en' },
  }),
}))

describe('following helpers', () => {
  it('orders distinct organizer ids newest follow first, undated last', () => {
    expect(
      orderFollowedOrganizerIds([
        { organizer_id: 'old', created_at: '2026-01-01T00:00:00Z' },
        { organizer_id: 'undated' },
        { organizer_id: 'new', created_at: { toDate: () => new Date('2026-10-01T00:00:00Z') } },
        { organizer_id: 'camel', createdAt: '2026-05-01T00:00:00Z' },
        { organizer_id: 'old', created_at: '2025-01-01T00:00:00Z' }, // duplicate keeps its latest
        { organizer_id: '' },
      ])
    ).toEqual(['new', 'camel', 'old', 'undated'])
  })

  it('builds a row from public_profiles, brand name and logo first', () => {
    expect(
      toFollowedOrganizer('a', {
        organization_name: ' Kanaval Co ',
        full_name: 'Jean',
        organization_logo: 'https://x/logo.png',
        photo_url: 'https://x/me.png',
        is_verified: true,
        email: 'never@leaks.example',
      })
    ).toEqual({ id: 'a', name: 'Kanaval Co', avatar: 'https://x/logo.png', isVerified: true })
    expect(toFollowedOrganizer('b', { full_name: 'Jean', photo_url: 'p' })).toEqual({
      id: 'b',
      name: 'Jean',
      avatar: 'p',
      isVerified: false,
    })
    expect(toFollowedOrganizer('c', null)).toEqual({ id: 'c', name: null, avatar: null, isVerified: false })
  })

  it('pages ids and clamps page params', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    expect(pageOfIds(ids, 0, 2)).toEqual({ ids: ['a', 'b'], nextOffset: 2 })
    expect(pageOfIds(ids, 4, 2)).toEqual({ ids: ['e'], nextOffset: null })
    expect(pageOfIds(ids, 9, 2)).toEqual({ ids: [], nextOffset: null })
    expect(normalizePageParams('-3', '500')).toEqual({ offset: 0, limit: 50 })
    expect(normalizePageParams(null, null)).toEqual({ offset: 0, limit: 20 })
  })
})

describe('FollowingCard', () => {
  const fetchMock = jest.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    ;(global as any).fetch = fetchMock
  })

  const ok = (body: unknown) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) })

  it('shows the empty state when the reader follows nobody', async () => {
    fetchMock.mockReturnValueOnce(ok({ items: [], total: 0, nextOffset: null }))
    render(<FollowingCard />)
    expect(await screen.findByText('dashboard.following.empty_title')).toBeInTheDocument()
  })

  it('lists organizers with profile links, pages, and unfollows / refollows', async () => {
    fetchMock
      .mockReturnValueOnce(
        ok({
          items: [
            { id: 'org1', name: 'Kanaval Co', avatar: null, isVerified: true },
            { id: 'org2', name: null, avatar: null, isVerified: false },
          ],
          total: 3,
          nextOffset: 2,
        })
      )
      .mockReturnValueOnce(ok({ items: [{ id: 'org3', name: 'Rara Nou', avatar: null, isVerified: false }], total: 3, nextOffset: null }))
      .mockReturnValueOnce(ok({ isFollowing: false }))
      .mockReturnValueOnce(ok({ isFollowing: true }))

    const onCountChange = jest.fn()
    render(<FollowingCard onCountChange={onCountChange} />)

    const first = await screen.findByText('Kanaval Co')
    expect(first.closest('a')).toHaveAttribute('href', '/profile/organizer/org1')
    expect(screen.getByText('dashboard.following.unknown')).toBeInTheDocument()

    fireEvent.click(screen.getByText('dashboard.following.show_more'))
    expect(await screen.findByText('Rara Nou')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/profile/following?offset=2&limit=20', expect.anything())
    expect(screen.queryByText('dashboard.following.show_more')).not.toBeInTheDocument()

    // Unfollow is a DELETE (never the POST toggle), and the row stays to undo.
    fireEvent.click(screen.getByLabelText('dashboard.following.unfollow_name:Kanaval Co'))
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(-1))
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE', body: JSON.stringify({ organizerId: 'org1' }) })
    const refollow = await screen.findByLabelText('dashboard.following.follow_name:Kanaval Co')

    fireEvent.click(refollow)
    await waitFor(() => expect(onCountChange).toHaveBeenCalledWith(1))
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: 'POST' })
    expect(await screen.findByLabelText('dashboard.following.unfollow_name:Kanaval Co')).toBeInTheDocument()
  })
})
