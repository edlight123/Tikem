import { notFound } from 'next/navigation'
import TestNotificationsClient from './TestNotificationsClient'

/* Dev-only tool: never served in production. */
export default function TestNotificationsPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <TestNotificationsClient />
}
