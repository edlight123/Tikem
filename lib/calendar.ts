import { format } from 'date-fns'

interface Event {
  id: string
  title: string
  description: string | null
  start_datetime: string
  end_datetime: string | null
  venue_name: string
  address: string | null
  city: string
}

/**
 * Escape a value for an RFC 5545 TEXT property. Without this an organizer-typed
 * title containing CRLF could end the SUMMARY line and inject its own
 * properties (an ATTACH, an ORGANIZER, a second VEVENT) into the file.
 */
export function escapeICSText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    // Any remaining control character (other than tab) has no place in a line.
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

/** A URI/identifier property value: no escaping syntax exists, so strip line breaks and controls. */
function icsSafeValue(value: string): string {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, '')
}

export function generateICSFile(event: Event): string {
  const startDate = new Date(event.start_datetime)
  const endDate = event.end_datetime 
    ? new Date(event.end_datetime)
    : new Date(startDate.getTime() + 2 * 60 * 60 * 1000) // Default 2 hours

  // Format dates as YYYYMMDDTHHMMSSZ
  const formatICSDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const location = [event.venue_name, event.address, event.city]
    .filter(Boolean)
    .join(', ')

  const description = event.description || ''
  const eventUrl = icsSafeValue(
    `${process.env.NEXT_PUBLIC_APP_URL}/events/${encodeURIComponent(event.id)}`
  )

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tikèm//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icsSafeValue(event.id)}@tikem.co`,
    `DTSTAMP:${formatICSDate(new Date())}`,
    `DTSTART:${formatICSDate(startDate)}`,
    `DTEND:${formatICSDate(endDate)}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(description)}\\n\\nView event: ${escapeICSText(eventUrl)}`,
    `LOCATION:${escapeICSText(location)}`,
    `URL:${eventUrl}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n')

  return icsContent
}

export function generateGoogleCalendarUrl(event: Event): string {
  const startDate = new Date(event.start_datetime)
  const endDate = event.end_datetime 
    ? new Date(event.end_datetime)
    : new Date(startDate.getTime() + 2 * 60 * 60 * 1000)

  const formatGoogleDate = (date: Date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  }

  const location = [event.venue_name, event.address, event.city]
    .filter(Boolean)
    .join(', ')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
    details: event.description || '',
    location: location,
    sprop: `website:${process.env.NEXT_PUBLIC_APP_URL}`,
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

export function generateOutlookCalendarUrl(event: Event): string {
  const startDate = new Date(event.start_datetime)
  const endDate = event.end_datetime 
    ? new Date(event.end_datetime)
    : new Date(startDate.getTime() + 2 * 60 * 60 * 1000)

  const formatOutlookDate = (date: Date) => {
    return date.toISOString()
  }

  const location = [event.venue_name, event.address, event.city]
    .filter(Boolean)
    .join(', ')

  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: formatOutlookDate(startDate),
    enddt: formatOutlookDate(endDate),
    body: event.description || '',
    location: location,
  })

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

export function generateAppleCalendarData(event: Event): string {
  // Apple Calendar uses the same ICS format
  return generateICSFile(event)
}
