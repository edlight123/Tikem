import type { Metadata } from 'next'
import type { ReactNode } from 'react'

// The page is a client component, so its title lives here.
export const metadata: Metadata = {
  title: 'Create your account | Tikèm',
  description: 'Sign up for Tikèm to buy tickets, save events and follow organizers.',
}

export default function SignupLayout({ children }: { children: ReactNode }) {
  return children
}
