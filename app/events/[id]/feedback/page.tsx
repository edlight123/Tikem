import { redirect } from 'next/navigation'

// The "how was it?" notification opens a rating sheet in the app. On the web
// (bell list, or the app link opened in a browser) the event page is the
// closest thing; rating is app-only for now.
export default async function EventFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/events/${encodeURIComponent(id)}`)
}
