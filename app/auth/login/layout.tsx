import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The page is a client component, so its title lives here.
export const metadata: Metadata = {
  title: 'Log in | Tikèm',
  description: 'Log in to Tikèm to see your tickets and buy for upcoming events.',
}

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children
}
