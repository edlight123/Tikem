import { redirect } from 'next/navigation'

// The "how was it?" notification opens a rating sheet in the app. On the web
// (bell list, or the app link opened in a browser) the event page asks it
// once the event is over (components/events/AfterEvent).
export default async function EventFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/events/${encodeURIComponent(id)}`)
}
