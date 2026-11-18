import { render, screen, waitFor, act } from '@testing-library/react'
import { NotificationBell } from '../NotificationBell'
import { collection, onSnapshot, query, where } from 'firebase/firestore'

// Mock Firebase
jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  onSnapshot: jest.fn(),
}))

jest.mock('@/lib/firebase/client', () => ({
  db: {},
}))

// Mock Next.js Link
jest.mock('next/link', () => {
  const MockLink = ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  )
  MockLink.displayName = 'Link'
  return MockLink
})

// Mock lucide-react
jest.mock('lucide-react', () => ({
  Bell: () => <svg data-testid="bell-icon" />,
}))

describe('NotificationBell', () => {
  const mockUserId = 'test-user-123'
  let mockUnsubscribe: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    mockUnsubscribe = jest.fn()
  })

  it('renders the bell icon', () => {
    render(<NotificationBell userId={mockUserId} />)
    expect(screen.getByTestId('bell-icon')).toBeInTheDocument()
  })

  it('renders as a link to /notifications', () => {
    render(<NotificationBell userId={mockUserId} />)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/notifications')
  })

  it('does not show badge when no unread notifications', async () => {
    const mockSnapshot = { size: 0 }
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      onSuccess(mockSnapshot)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(screen.queryByText(/\d+/)).not.toBeInTheDocument()
    })
  })

  it('shows correct unread count when notifications exist', async () => {
    const mockSnapshot = { size: 5 }
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      onSuccess(mockSnapshot)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(screen.getByText('5')).toBeInTheDocument()
    })
  })

  it('shows "99+" when count exceeds 99', async () => {
    const mockSnapshot = { size: 150 }
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      onSuccess(mockSnapshot)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(screen.getByText('99+')).toBeInTheDocument()
    })
  })

  it('sets up Firestore listener with correct query', async () => {
    const mockSnapshot = { size: 0 }
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      onSuccess(mockSnapshot)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(collection).toHaveBeenCalledWith({}, 'users', mockUserId, 'notifications')
      expect(where).toHaveBeenCalledWith('isRead', '==', false)
      expect(query).toHaveBeenCalled()
    })
  })

  it('cleans up listener on unmount', async () => {
    const mockSnapshot = { size: 0 }
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      onSuccess(mockSnapshot)
      return mockUnsubscribe
    })

    const { unmount } = render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalled()
    })

    unmount()

    expect(mockUnsubscribe).toHaveBeenCalled()
  })

  it('handles permission-denied error gracefully', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const mockError = { code: 'permission-denied' }
    
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess, onError) => {
      onError(mockError)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('permission denied')
      )
    })

    // Should not crash, should show 0 count
    expect(screen.queryByText(/\d+/)).not.toBeInTheDocument()

    consoleWarnSpy.mockRestore()
  })

  it('handles unavailable error gracefully', async () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation()
    const mockError = { code: 'unavailable' }
    
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess, onError) => {
      onError(mockError)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('temporarily unavailable')
      )
    })

    consoleWarnSpy.mockRestore()
  })

  it('handles other errors gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation()
    const mockError = { code: 'unknown-error', message: 'Something went wrong' }
    
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess, onError) => {
      onError(mockError)
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error listening to notifications:',
        mockError
      )
    })

    consoleErrorSpy.mockRestore()
  })

  it('does not set up listener when userId is empty', () => {
    render(<NotificationBell userId="" />)
    expect(onSnapshot).not.toHaveBeenCalled()
  })

  it('updates count in real-time when notifications change', async () => {
    let snapshotCallback: ((snapshot: any) => void) | null = null
    
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      snapshotCallback = onSuccess
      onSuccess({ size: 3 })
      return mockUnsubscribe
    })

    render(<NotificationBell userId={mockUserId} />)

    // Initial count
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument()
    })

    // Simulate real-time update
    await act(async () => {
      if (snapshotCallback) {
        snapshotCallback({ size: 7 })
      }
    })

    // Updated count
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument()
    })
  })

  it('prevents hydration mismatch by not showing count initially', () => {
    const mockSnapshot = { size: 5 }
    ;(onSnapshot as jest.Mock).mockImplementation((q, onSuccess) => {
      // Delay the callback to simulate async behavior
      setTimeout(() => onSuccess(mockSnapshot), 0)
      return mockUnsubscribe
    })

    const { container } = render(<NotificationBell userId={mockUserId} />)
    
    // Initially should not show badge (prevents hydration mismatch)
    expect(container.querySelector('.bg-danger-strong')).not.toBeInTheDocument()
  })
})
