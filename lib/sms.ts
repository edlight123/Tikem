// SMS notifications via Twilio
// Extends the existing WhatsApp integration to support plain SMS

type SmsParams = {
  to: string // Phone number in E.164 format (+1234567890)
  message: string
}

export async function sendSms({ to, message }: SmsParams) {
  // In development or if no Twilio credentials, just log
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_PHONE_NUMBER
  
  if (!accountSid || !authToken || !fromNumber) {
    // Message bodies carry ticket links and verification codes; only print
    // them outside production.
    if (process.env.NODE_ENV === 'production') {
      console.warn('SMS not sent: no Twilio credentials configured')
    } else {
      console.log('📱 SMS would be sent (no Twilio credentials configured):', { to, message })
    }
    return { success: true, messageId: 'dev-mode' }
  }

  try {
    // Twilio API: Send SMS
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: fromNumber,
          To: to,
          Body: message
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Twilio SMS error:', errorText)
      throw new Error(`Twilio API error: ${response.status}`)
    }

    const result = await response.json()
    console.log('SMS sent successfully:', result.sid)
    
    return {
      success: true,
      messageId: result.sid,
      status: result.status
    }
  } catch (error) {
    console.error('Failed to send SMS:', error)
    throw error
  }
}

// Send WhatsApp message (uses same Twilio account)
export async function sendWhatsApp({ to, message }: SmsParams) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886' // Twilio sandbox default
  
  if (!accountSid || !authToken) {
    console.log('📱 WhatsApp would be sent (no Twilio credentials configured):', { to, message })
    return { success: true, messageId: 'dev-mode' }
  }

  try {
    // Ensure WhatsApp prefix
    const toNumber = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`
    
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          From: fromNumber,
          To: toNumber,
          Body: message
        })
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error('Twilio WhatsApp error:', errorText)
      throw new Error(`Twilio API error: ${response.status}`)
    }

    const result = await response.json()
    console.log('WhatsApp sent successfully:', result.sid)
    
    return {
      success: true,
      messageId: result.sid,
      status: result.status
    }
  } catch (error) {
    console.error('Failed to send WhatsApp:', error)
    throw error
  }
}

// Template functions for common SMS messages

export function getEventReminderSms(params: {
  eventTitle: string
  eventDate: string
  eventLocation: string
  ticketId: string
}) {
  return `🎟️ Event Reminder: ${params.eventTitle}

📅 ${new Date(params.eventDate).toLocaleString()}
📍 ${params.eventLocation}

Your ticket: ${params.ticketId.slice(0, 8)}
Bring your QR code for check-in!`
}

/**
 * The ticket itself, by SMS.
 *
 * A QR code can't travel over SMS, so the message carries the LINK that renders it.
 * For a guest that link is their signed retrieval URL — in Haiti the phone number is
 * often the only channel the buyer reliably reads, so this is the ticket's primary
 * delivery, not a nicety.
 */
export function getTicketConfirmationSms(params: {
  eventTitle: string
  eventDate: string
  ticketUrl: string
  quantity?: number
}) {
  const qty = Math.max(1, Number(params.quantity || 1))
  const plural = qty > 1 ? `${qty} tickets` : 'Your ticket'
  return `🎟️ Tikem: ${plural} for ${params.eventTitle}

📅 ${params.eventDate}

Open your QR code: ${params.ticketUrl}

Show it at the entrance.`
}

export function getRefundApprovedSms(params: {
  eventTitle: string
  amount: number
}) {
  return `✅ Refund Approved

Your refund of $${params.amount.toFixed(2)} for ${params.eventTitle} has been approved. You'll receive it in 5-10 business days.`
}

export function getRefundDeniedSms(params: {
  eventTitle: string
}) {
  return `❌ Refund Denied

Your refund request for ${params.eventTitle} was denied. Contact the organizer for more information.`
}

export function getTicketTransferSms(params: {
  senderName: string
  eventTitle: string
  transferUrl: string
}) {
  return `🎟️ Ticket Transfer

${params.senderName} wants to transfer you a ticket for ${params.eventTitle}!

Accept here: ${params.transferUrl}

(Expires in 7 days)`
}

export function getWaitlistAvailableSms(params: {
  eventTitle: string
  quantity: number
  eventUrl: string
}) {
  const plural = params.quantity > 1 ? 's' : ''
  return `🎟️ Tickets Available!

${params.quantity} ticket${plural} now available for ${params.eventTitle}!

Grab ${params.quantity > 1 ? 'them' : 'it'} here: ${params.eventUrl}`
}

export function getEventUpdateSms(params: {
  eventTitle: string
  updateMessage: string
}) {
  return `📢 Event Update: ${params.eventTitle}

${params.updateMessage}`
}
