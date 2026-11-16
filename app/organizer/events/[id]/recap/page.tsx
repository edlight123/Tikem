import { redirect } from 'next/navigation'

// The recap notification opens the recap screen in the app. On the web the
// event's command center carries the same numbers (sales, check-ins).
export default async function EventRecapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/organizer/events/${encodeURIComponent(id)}`)
}
