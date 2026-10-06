// Email service for sending notifications
// Using Resend API (direct fetch, no SDK) for production-ready email delivery
import { escapeHtml } from '@/lib/html'

type EmailParams = {
  to: string | null | undefined
  subject: string
  html: string
}

/**
 * What every caller gets back. `success: false` is ALWAYS a returned value, never a
 * throw: the Stripe webhook calls this inline, and a throw there surfaces to Stripe as
 * a failed delivery — retried forever for a problem no retry can fix.
 */
export type SendEmailResult = {
  success: boolean
  error?: string
  messageId?: string
  /** Machine-readable reason, so callers can distinguish "no address" from "Resend is down". */
  code?: 'missing_recipient' | 'no_api_key' | 'dummy_api_key' | 'provider_error'
}

// Premium brand colors
const BRAND = {
  primary: '#f97316',
  primaryDark: '#ea580c',
  secondary: '#8b5cf6',
  accent: '#ec4899',
  success: '#10b981',
  warning: '#f59e0b',
  error: '#ef4444',
  dark: '#0f172a',
  gray: '#64748b',
  lightGray: '#f1f5f9',
  white: '#ffffff',
}

// Shared email styles
const emailStyles = {
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  monoFont: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
}

// Premium footer component
function getEmailFooter() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  return `
    <tr>
      <td style="padding: 32px 40px; background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%); border-top: 1px solid #e2e8f0;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center">
              <div style="margin-bottom: 16px;">
                <a href="${appUrl}" style="text-decoration: none;">
                  <span style="font-size: 20px; font-weight: 800; background: linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">Tikèm</span>
                </a>
              </div>
              <div style="margin-bottom: 20px;">
                <a href="${appUrl}/discover" style="display: inline-block; margin: 0 8px; color: #64748b; text-decoration: none; font-size: 13px; font-weight: 500;">Discover</a>
                <span style="color: #cbd5e1;">•</span>
                <a href="${appUrl}/tickets" style="display: inline-block; margin: 0 8px; color: #64748b; text-decoration: none; font-size: 13px; font-weight: 500;">My Tickets</a>
                <span style="color: #cbd5e1;">•</span>
                <a href="${appUrl}/support" style="display: inline-block; margin: 0 8px; color: #64748b; text-decoration: none; font-size: 13px; font-weight: 500;">Help</a>
              </div>
              <div style="margin-bottom: 16px;">
                <a href="https://instagram.com/tikem" style="display: inline-block; margin: 0 6px; width: 32px; height: 32px; background-color: #e2e8f0; border-radius: 8px; text-align: center; line-height: 32px; text-decoration: none; color: #64748b; font-size: 14px;">📷</a>
                <a href="https://facebook.com/tikem" style="display: inline-block; margin: 0 6px; width: 32px; height: 32px; background-color: #e2e8f0; border-radius: 8px; text-align: center; line-height: 32px; text-decoration: none; color: #64748b; font-size: 14px;">📘</a>
                <a href="https://twitter.com/tikem" style="display: inline-block; margin: 0 6px; width: 32px; height: 32px; background-color: #e2e8f0; border-radius: 8px; text-align: center; line-height: 32px; text-decoration: none; color: #64748b; font-size: 14px;">🐦</a>
              </div>
              <p style="margin: 0; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                © ${new Date().getFullYear()} Tikèm. All rights reserved.<br>
                <a href="${appUrl}/privacy" style="color: #94a3b8; text-decoration: underline;">Privacy Policy</a> · <a href="${appUrl}/terms" style="color: #94a3b8; text-decoration: underline;">Terms of Service</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `
}

// Premium button component
function getButton(text: string, url: string, color: string = BRAND.primary, fullWidth: boolean = false) {
  return `
    <a href="${escapeHtml(url)}" style="display: inline-block; ${fullWidth ? 'width: 100%; text-align: center;' : ''} padding: 14px 28px; background: linear-gradient(135deg, ${color} 0%, ${adjustColor(color, -15)} 100%); color: #ffffff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 14px; letter-spacing: 0.3px; box-shadow: 0 4px 14px ${color}40; transition: all 0.2s;">
      ${escapeHtml(text)}
    </a>
  `
}

// Helper to darken/lighten colors
function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16)
  const amt = Math.round(2.55 * percent)
  const R = (num >> 16) + amt
  const G = (num >> 8 & 0x00FF) + amt
  const B = (num & 0x0000FF) + amt
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1)
}

/**
 * Escape text that a USER typed before it lands in an email's HTML.
 *
 * Most templates below interpolate values we generated ourselves. Free-text
 * written by one person and delivered to another (an organizer's reply, the
 * attendee's original question) is different: unescaped, a `<a href>` or a
 * `<style>` in the message body would render as live markup in the recipient's
 * mail client.
 */
export { escapeHtml }

export async function sendEmail({ to, subject, html }: EmailParams): Promise<SendEmailResult> {
  // NULL-GUARD THE RECIPIENT FIRST.
  //
  // A user document without an `email` (and a guest order whose contact resolution
  // failed) used to reach Resend as `to: undefined`. Resend answers 4xx, we threw,
  // and in the Stripe webhook that throw became a webhook FAILURE — Stripe then
  // retries an event whose tickets were already issued. There is nothing to retry:
  // the address doesn't exist. Report it and move on.
  const recipient = typeof to === 'string' ? to.trim() : ''
  if (!recipient) {
    console.warn('⚠️  sendEmail called with no recipient address — nothing sent', { subject })
    return { success: false, error: 'No recipient email address', code: 'missing_recipient' }
  }

  // Check API key configuration
  const apiKey = process.env.RESEND_API_KEY

  if (!apiKey) {
    console.warn('❌ RESEND_API_KEY not configured - email will not be sent')
    console.warn('   Add RESEND_API_KEY to your environment variables')
    console.warn(`   Would send to: ${recipient}`)
    console.warn(`   Subject: ${subject}`)
    return { success: false, error: 'No API key configured', messageId: undefined, code: 'no_api_key' }
  }

  if (apiKey === 're_dummy_key_for_build') {
    console.warn('❌ RESEND_API_KEY is set to dummy value - email will not be sent')
    console.warn('   Replace with a real API key from https://resend.com')
    console.warn(`   Would send to: ${recipient}`)
    console.warn(`   Subject: ${subject}`)
    return { success: false, error: 'Dummy API key - replace with real key from Resend', messageId: undefined, code: 'dummy_api_key' }
  }

  try {
    console.log(`📧 Sending email to ${recipient}: ${subject}`)

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'Tikem <noreply@tikem.co>',
        to: recipient,
        subject,
        html,
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('❌ Email API error:', data)
      throw new Error(data.message || 'Failed to send email')
    }

    console.log('✅ Email sent successfully! Message ID:', data.id)
    return { success: true, messageId: data.id }
  } catch (error: any) {
    console.error('❌ Failed to send email:', error)
    return { success: false, error: error.message, code: 'provider_error' }
  }
}

// Email templates
export function getTicketConfirmationEmail(params: {
  attendeeName: string
  eventTitle: string
  eventDate: string
  eventVenue: string
  ticketId: string
  qrCodeDataURL?: string
  ticketTier?: string
  ticketPrice?: number
  currency?: string
  /**
   * Where "View My Tickets" points. A GUEST has no /tickets page to log into, so
   * the caller passes their signed retrieval link instead. Omitted ⇒ the normal
   * account page, exactly as before.
   */
  ticketsUrl?: string
  /** Buyer-facing note under the button (e.g. "this link is yours — keep it"). */
  ticketsUrlNote?: string
}) {
  const ticketCode = String(params.ticketId || '').slice(0, 12).toUpperCase()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const ticketsUrl = params.ticketsUrl || `${appUrl}/tickets`
  const tier = params.ticketTier || 'General Admission'
  const price = params.ticketPrice ? `${params.currency || 'HTG'} ${params.ticketPrice.toLocaleString()}` : 'Free'

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <meta name="color-scheme" content="light">
        <meta name="supported-color-schemes" content="light">
        <title>Your Tikèm Ticket</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              
              <!-- Preheader text (hidden) -->
              <div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">
                Your ticket for ${escapeHtml(String(params.eventTitle ?? ""))} is confirmed! Show this QR code at entry.
              </div>
              
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Premium Header with Gradient -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #f97316 0%, #ec4899 50%, #8b5cf6 100%); padding: 40px 40px 100px; position: relative;">
                      <table role="presentation" style="width: 100%; border-collapse: collapse;">
                        <tr>
                          <td>
                            <div style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Tikèm</div>
                          </td>
                          <td align="right">
                            <div style="display: inline-block; padding: 8px 14px; background: rgba(255, 255, 255, 0.2); border-radius: 20px; backdrop-filter: blur(10px);">
                              <span style="font-size: 12px; font-weight: 600; color: #ffffff; letter-spacing: 0.5px;">✓ CONFIRMED</span>
                            </div>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>
                
                <!-- Ticket Card (overlapping header) -->
                <tr>
                  <td style="padding: 0 32px;">
                    <div style="margin-top: -70px; background: #ffffff; border-radius: 20px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1); border: 1px solid #e2e8f0; overflow: hidden;">
                      
                      <!-- Event Info Section -->
                      <div style="padding: 28px 28px 20px;">
                        <div style="font-size: 11px; font-weight: 700; color: #f97316; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 8px;">YOUR EVENT</div>
                        <div style="font-size: 22px; font-weight: 800; color: #0f172a; line-height: 1.3; margin-bottom: 16px;">${escapeHtml(String(params.eventTitle ?? ""))}</div>
                        
                        <table role="presentation" style="width: 100%; border-collapse: collapse;">
                          <tr>
                            <td style="padding: 12px 0; border-top: 1px solid #f1f5f9;">
                              <div style="display: flex; align-items: center;">
                                <span style="font-size: 18px; margin-right: 10px;">📅</span>
                                <div>
                                  <div style="font-size: 11px; color: #64748b; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">Date & Time</div>
                                  <div style="font-size: 15px; color: #0f172a; font-weight: 600; margin-top: 2px;">${escapeHtml(String(params.eventDate ?? ""))}</div>
                                </div>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 12px 0; border-top: 1px solid #f1f5f9;">
                              <div style="display: flex; align-items: center;">
                                <span style="font-size: 18px; margin-right: 10px;">📍</span>
                                <div>
                                  <div style="font-size: 11px; color: #64748b; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">Location</div>
                                  <div style="font-size: 15px; color: #0f172a; font-weight: 600; margin-top: 2px;">${escapeHtml(String(params.eventVenue ?? ""))}</div>
                                </div>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding: 12px 0; border-top: 1px solid #f1f5f9;">
                              <div style="display: flex; align-items: center;">
                                <span style="font-size: 18px; margin-right: 10px;">🎫</span>
                                <div>
                                  <div style="font-size: 11px; color: #64748b; font-weight: 600; letter-spacing: 0.5px; text-transform: uppercase;">Ticket Type</div>
                                  <div style="font-size: 15px; color: #0f172a; font-weight: 600; margin-top: 2px;">${escapeHtml(tier)} · ${escapeHtml(price)}</div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        </table>
                      </div>
                      
                      <!-- Dashed Divider -->
                      <div style="position: relative; height: 24px; background: linear-gradient(90deg, #f1f5f9 50%, transparent 50%); background-size: 12px 2px; background-position: center; background-repeat: repeat-x;">
                        <div style="position: absolute; left: -12px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; background: #ffffff; border-radius: 50%;"></div>
                        <div style="position: absolute; right: -12px; top: 50%; transform: translateY(-50%); width: 24px; height: 24px; background: #ffffff; border-radius: 50%;"></div>
                      </div>
                      
                      <!-- QR Code Section -->
                      <div style="padding: 20px 28px 28px; text-align: center; background: linear-gradient(180deg, #fafafa 0%, #ffffff 100%);">
                        <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px;">Scan at Entry</div>
                        ${params.qrCodeDataURL ? `
                          <div style="display: inline-block; padding: 16px; background: #ffffff; border-radius: 16px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);">
                            <img src="${escapeHtml(params.qrCodeDataURL)}" alt="Ticket QR Code" style="width: 180px; height: 180px; display: block;">
                          </div>
                        ` : `
                          <div style="display: inline-block; padding: 40px; background: #f1f5f9; border-radius: 16px;">
                            <span style="font-size: 48px;">🎫</span>
                          </div>
                        `}
                        <div style="margin-top: 16px; font-family: ${emailStyles.monoFont}; font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: 2px;">${escapeHtml(ticketCode)}</div>
                        <div style="margin-top: 6px; font-size: 12px; color: #94a3b8;">Show this code if QR won't scan</div>
                      </div>
                    </div>
                  </td>
                </tr>
                
                <!-- Greeting & Tips -->
                <tr>
                  <td style="padding: 32px 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hi ${escapeHtml(String(params.attendeeName ?? ""))}! 👋</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      You're all set for <strong style="color: #0f172a;">${escapeHtml(String(params.eventTitle ?? ""))}</strong>. We can't wait to see you there!
                    </div>
                    
                    <div style="background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 14px; padding: 20px; border-left: 4px solid #f59e0b;">
                      <div style="font-size: 13px; font-weight: 700; color: #92400e; margin-bottom: 10px;">💡 Entry Tips</div>
                      <ul style="margin: 0; padding-left: 18px; font-size: 14px; color: #78350f; line-height: 1.8;">
                        <li>Arrive 15–30 minutes early</li>
                        <li>Have your QR code ready (screenshot this email)</li>
                        <li>Bring a valid ID if requested</li>
                      </ul>
                    </div>
                    
                    <div style="text-align: center; margin-top: 28px;">
                      ${getButton('View My Tickets', ticketsUrl, '#0f172a')}
                      ${params.ticketsUrlNote ? `
                        <div style="margin-top: 12px; font-size: 12px; color: #94a3b8; line-height: 1.6;">
                          ${escapeHtml(params.ticketsUrlNote)}
                        </div>
                      ` : ''}
                    </div>
                  </td>
                </tr>

                <!-- Footer -->
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getEventCreatedEmail(params: {
  organizerName: string
  eventTitle: string
  eventDate: string
  eventId: string
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const manageUrl = `${appUrl}/organizer/events/${encodeURIComponent(String(params.eventId))}`
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Event Published Successfully</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header with Celebration -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #10b981 0%, #059669 50%, #047857 100%); padding: 50px 40px; text-align: center;">
                      <div style="font-size: 64px; line-height: 1;">🎊</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Your Event is Live!</div>
                      <div style="margin-top: 8px; font-size: 14px; color: rgba(255, 255, 255, 0.85);">Tikèm</div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 24px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">
                      Félicitations, ${escapeHtml(params.organizerName)}! 🎉
                    </div>
                    <div style="font-size: 16px; color: #64748b; line-height: 1.7; margin-bottom: 28px;">
                      Your event has been published and is now visible to thousands of potential attendees on Tikèm.
                    </div>
                    
                    <!-- Event Card -->
                    <div style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 16px; padding: 24px; border: 1px solid #e2e8f0;">
                      <div style="font-size: 11px; font-weight: 700; color: #10b981; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 8px;">NOW LIVE</div>
                      <div style="font-size: 20px; font-weight: 800; color: #0f172a; line-height: 1.3; margin-bottom: 16px;">${escapeHtml(params.eventTitle)}</div>
                      <div style="display: flex; align-items: center; color: #64748b; font-size: 14px;">
                        <span style="margin-right: 8px;">📅</span>
                        <span>${escapeHtml(params.eventDate)}</span>
                      </div>
                    </div>
                    
                    <!-- Tips Section -->
                    <div style="margin-top: 28px; padding: 20px; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); border-radius: 14px; border-left: 4px solid #3b82f6;">
                      <div style="font-size: 14px; font-weight: 700; color: #1e40af; margin-bottom: 12px;">🚀 Next Steps</div>
                      <ul style="margin: 0; padding-left: 18px; font-size: 14px; color: #1e3a8a; line-height: 1.9;">
                        <li>Share your event link on social media</li>
                        <li>Invite your audience via email or WhatsApp</li>
                        <li>Monitor ticket sales from your dashboard</li>
                      </ul>
                    </div>
                    
                    <div style="text-align: center; margin-top: 32px;">
                      ${getButton('Manage Your Event', manageUrl, '#0f172a')}
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getRefundRequestEmail(params: {
  organizerName: string
  eventTitle: string
  attendeeEmail: string
  reason: string
  ticketId: string
  amount: number
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Refund Request</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 40px; text-align: center;">
                      <div style="display: inline-block; padding: 10px 18px; background: rgba(0, 0, 0, 0.15); border-radius: 30px; margin-bottom: 16px;">
                        <span style="font-size: 13px; font-weight: 600; color: #ffffff; letter-spacing: 0.5px;">⚠️ ACTION REQUIRED</span>
                      </div>
                      <div style="font-size: 22px; font-weight: 800; color: #ffffff;">Refund Request Received</div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hi ${escapeHtml(params.organizerName)},</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 28px;">
                      An attendee has requested a refund for your event <strong style="color: #0f172a;">${escapeHtml(params.eventTitle)}</strong>. Please review the details below.
                    </div>
                    
                    <!-- Request Details Card -->
                    <div style="background: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
                      <div style="padding: 20px; border-bottom: 1px solid #e2e8f0;">
                        <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 1px; text-transform: uppercase;">Attendee</div>
                        <div style="font-size: 16px; color: #0f172a; font-weight: 600; margin-top: 6px;">${escapeHtml(params.attendeeEmail)}</div>
                      </div>
                      <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);">
                        <div style="font-size: 11px; font-weight: 700; color: #92400e; letter-spacing: 1px; text-transform: uppercase;">Refund Amount</div>
                        <div style="font-size: 28px; color: #78350f; font-weight: 800; margin-top: 6px;">$${params.amount.toFixed(2)}</div>
                      </div>
                      <div style="padding: 20px;">
                        <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 1px; text-transform: uppercase;">Reason Given</div>
                        <div style="font-size: 15px; color: #0f172a; margin-top: 6px; line-height: 1.6;">${escapeHtml(params.reason)}</div>
                      </div>
                    </div>
                    
                    <div style="font-family: ${emailStyles.monoFont}; font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px;">
                      Ticket ID: ${escapeHtml(params.ticketId)}
                    </div>
                    
                    <div style="text-align: center; margin-top: 28px;">
                      ${getButton('Review Request', `${appUrl}/organizer/events`, '#f59e0b')}
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getRefundProcessedEmail(params: {
  attendeeName: string
  eventTitle: string
  status: 'approved' | 'denied'
  refundAmount: number
  ticketId: string
}) {
  const isApproved = params.status === 'approved'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Refund ${isApproved ? 'Approved' : 'Update'}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: ${isApproved ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #64748b 0%, #475569 100%)'}; padding: 50px 40px; text-align: center;">
                      <div style="font-size: 56px; line-height: 1;">${isApproved ? '✅' : '📋'}</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff;">
                        Refund ${isApproved ? 'Approved' : 'Denied'}
                      </div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hi ${escapeHtml(params.attendeeName)},</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 28px;">
                      Your refund request for <strong style="color: #0f172a;">${escapeHtml(params.eventTitle)}</strong> has been reviewed.
                    </div>
                    
                    ${isApproved ? `
                      <!-- Approved Amount Card -->
                      <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 16px; padding: 28px; text-align: center; border: 1px solid #a7f3d0;">
                        <div style="font-size: 11px; font-weight: 700; color: #059669; letter-spacing: 1.2px; text-transform: uppercase;">Refund Amount</div>
                        <div style="font-size: 42px; font-weight: 800; color: #047857; margin-top: 8px;">$${params.refundAmount.toFixed(2)}</div>
                        <div style="font-size: 13px; color: #10b981; margin-top: 8px;">Processing to your original payment method</div>
                      </div>
                      
                      <div style="margin-top: 24px; padding: 20px; background: #f8fafc; border-radius: 14px;">
                        <div style="font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 10px;">⏱️ What happens next?</div>
                        <div style="font-size: 14px; color: #64748b; line-height: 1.8;">
                          Your refund will appear on your statement within <strong>5-10 business days</strong>, depending on your bank or payment provider.
                        </div>
                        <div style="font-size: 13px; color: #64748b; line-height: 1.6; margin-top: 8px;">
                          Service fee is non-refundable unless the event is cancelled.
                        </div>
                      </div>
                    ` : `
                      <!-- Denied Card -->
                      <div style="background: #f8fafc; border-radius: 16px; padding: 24px; border-left: 4px solid #64748b;">
                        <div style="font-size: 15px; color: #475569; line-height: 1.7;">
                          Unfortunately, the organizer was unable to approve your refund request for this event. 
                          If you have questions, please contact the organizer directly.
                        </div>
                      </div>
                      
                      <div style="text-align: center; margin-top: 28px;">
                        ${getButton('Browse Other Events', appUrl, '#0f172a')}
                      </div>
                    `}
                    
                    <div style="font-family: ${emailStyles.monoFont}; font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
                      Reference: ${escapeHtml(params.ticketId)}
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getWaitlistNotificationEmail(params: {
  eventTitle: string
  eventDate: string
  quantity: number
  eventId: string
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const eventUrl = `${appUrl}/events/${encodeURIComponent(String(params.eventId))}`
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Tickets Now Available!</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Exciting Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #4f46e5 100%); padding: 50px 40px; text-align: center;">
                      <div style="font-size: 56px; line-height: 1;">🎟️</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff;">Tickets Available!</div>
                      <div style="margin-top: 8px; font-size: 14px; color: rgba(255, 255, 255, 0.85);">You're off the waitlist</div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 12px; text-align: center;">
                      Great News! 🎉
                    </div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 28px; text-align: center;">
                      Tickets are now available for the event you were waiting for!
                    </div>
                    
                    <!-- Event Card -->
                    <div style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border-radius: 16px; padding: 24px; border: 1px solid #e9d5ff;">
                      <div style="font-size: 11px; font-weight: 700; color: #8b5cf6; letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 10px;">🔥 HOT EVENT</div>
                      <div style="font-size: 20px; font-weight: 800; color: #0f172a; line-height: 1.3; margin-bottom: 16px;">${escapeHtml(params.eventTitle)}</div>
                      <div style="padding-top: 16px; border-top: 1px solid #e9d5ff;">
                        <div style="display: flex; align-items: center; color: #7c3aed; font-size: 14px; font-weight: 600;">
                          <span style="margin-right: 8px;">📅</span>
                          <span>${new Date(params.eventDate).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                    
                    <!-- Urgency Notice -->
                    <div style="margin-top: 24px; padding: 16px 20px; background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%); border-radius: 12px; text-align: center;">
                      <div style="font-size: 14px; color: #92400e;">
                        ⏰ <strong>Don't wait!</strong> You requested <strong>${escapeHtml(params.quantity)}</strong> ticket${params.quantity > 1 ? 's' : ''} - grab ${params.quantity > 1 ? 'them' : 'it'} before ${params.quantity > 1 ? "they're" : "it's"} gone!
                      </div>
                    </div>
                    
                    <div style="text-align: center; margin-top: 28px;">
                      ${getButton('Get My Tickets Now', eventUrl, '#8b5cf6')}
                    </div>
                    
                    <div style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 20px;">
                      Tickets are available on a first-come, first-served basis.
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getTicketTransferRequestEmail(params: {
  senderName: string
  senderEmail: string
  eventTitle: string
  eventDate: string
  message: string
  transferToken: string
  expiresAt: string
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const acceptUrl = `${appUrl}/tickets/transfer/${encodeURIComponent(String(params.transferToken))}`
  const declineUrl = `${appUrl}/tickets/transfer/${encodeURIComponent(String(params.transferToken))}?action=reject`
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Someone Sent You a Ticket!</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%); padding: 50px 40px; text-align: center;">
                      <div style="font-size: 56px; line-height: 1;">🎁</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff;">You've Received a Ticket!</div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      <strong style="color: #0f172a;">${escapeHtml(params.senderName)}</strong> wants to send you a ticket for an upcoming event!
                    </div>
                    
                    ${params.message ? `
                      <!-- Personal Message -->
                      <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border-left: 4px solid #3b82f6; padding: 16px 20px; margin-bottom: 24px; border-radius: 0 12px 12px 0;">
                        <div style="font-size: 12px; font-weight: 600; color: #3b82f6; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;">Message from ${escapeHtml(params.senderName)}</div>
                        <div style="font-size: 15px; color: #0f172a; font-style: italic; line-height: 1.6;">"${escapeHtml(params.message)}"</div>
                      </div>
                    ` : ''}
                    
                    <!-- Event Card -->
                    <div style="background: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #e2e8f0;">
                      <div style="padding: 20px; border-bottom: 1px solid #e2e8f0;">
                        <div style="font-size: 11px; font-weight: 700; color: #3b82f6; letter-spacing: 1px; text-transform: uppercase;">Event</div>
                        <div style="font-size: 18px; color: #0f172a; font-weight: 800; margin-top: 6px;">${escapeHtml(params.eventTitle)}</div>
                      </div>
                      <div style="padding: 20px; border-bottom: 1px solid #e2e8f0;">
                        <div style="font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: 1px; text-transform: uppercase;">When</div>
                        <div style="font-size: 15px; color: #0f172a; font-weight: 600; margin-top: 6px;">${new Date(params.eventDate).toLocaleString()}</div>
                      </div>
                      <div style="padding: 20px; background: linear-gradient(135deg, #fef2f2 0%, #fecaca 100%);">
                        <div style="font-size: 11px; font-weight: 700; color: #dc2626; letter-spacing: 1px; text-transform: uppercase;">⏰ Expires</div>
                        <div style="font-size: 14px; color: #b91c1c; font-weight: 600; margin-top: 6px;">${new Date(params.expiresAt).toLocaleString()}</div>
                      </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div style="text-align: center; margin-top: 32px;">
                      <table role="presentation" style="display: inline-block;">
                        <tr>
                          <td style="padding-right: 12px;">
                            ${getButton('Accept Ticket', acceptUrl, '#10b981')}
                          </td>
                          <td>
                            <a href="${escapeHtml(declineUrl)}" style="display: inline-block; padding: 14px 28px; background-color: #f1f5f9; color: #475569; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 15px;">
                              Decline
                            </a>
                          </td>
                        </tr>
                      </table>
                    </div>
                    
                    <div style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
                      This transfer will expire automatically if not accepted within 7 days.
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getTicketTransferResponseEmail(params: {
  recipientName: string
  eventTitle: string
  action: 'accepted' | 'rejected'
  ticketId: string
}) {
  const isAccepted = params.action === 'accepted'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Transfer ${isAccepted ? 'Accepted' : 'Declined'}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: ${isAccepted ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #64748b 0%, #475569 100%)'}; padding: 50px 40px; text-align: center;">
                      <div style="font-size: 56px; line-height: 1;">${isAccepted ? '🎉' : '↩️'}</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff;">
                        Transfer ${isAccepted ? 'Successful!' : 'Declined'}
                      </div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">Transfer Update</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      <strong style="color: #0f172a;">${escapeHtml(params.recipientName)}</strong> has ${isAccepted ? 'accepted' : 'declined'} your ticket transfer for <strong style="color: #0f172a;">${escapeHtml(params.eventTitle)}</strong>.
                    </div>
                    
                    ${isAccepted ? `
                      <!-- Success Message -->
                      <div style="background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border-radius: 16px; padding: 24px; text-align: center; border: 1px solid #a7f3d0;">
                        <div style="font-size: 14px; color: #065f46; line-height: 1.7;">
                          ✅ The ticket has been successfully transferred.<br>
                          The new owner will receive their own ticket confirmation.
                        </div>
                      </div>
                    ` : `
                      <!-- Ticket Still Yours -->
                      <div style="background: #f8fafc; border-radius: 16px; padding: 24px; border: 1px solid #e2e8f0;">
                        <div style="font-size: 14px; color: #475569; line-height: 1.7; margin-bottom: 20px;">
                          Your ticket is still yours. You can try transferring it to someone else or keep it for yourself!
                        </div>
                        <div style="text-align: center;">
                          ${getButton('View My Ticket', `${appUrl}/tickets/${encodeURIComponent(String(params.ticketId))}`, '#f97316')}
                        </div>
                      </div>
                    `}
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getTicketTransferCancelledEmail(params: {
  eventTitle: string
  senderName: string
}) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Transfer Cancelled</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #64748b 0%, #475569 100%); padding: 50px 40px; text-align: center;">
                      <div style="font-size: 48px; line-height: 1;">🚫</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff;">Transfer Cancelled</div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 12px;">Transfer Withdrawn</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      <strong style="color: #0f172a;">${escapeHtml(params.senderName)}</strong> has cancelled the ticket transfer for <strong style="color: #0f172a;">${escapeHtml(params.eventTitle)}</strong>.
                    </div>
                    
                    <div style="background: #f8fafc; border-radius: 14px; padding: 20px; text-align: center;">
                      <div style="font-size: 14px; color: #64748b;">
                        No action is needed on your part. If you're still interested in attending this event, you can purchase tickets directly.
                      </div>
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getEventUpdateEmail(params: {
  attendeeName: string
  eventTitle: string
  updateTitle: string
  updateMessage: string
  eventId: string
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const eventUrl = `${appUrl}/events/${encodeURIComponent(String(params.eventId))}`
  
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Event Update - ${escapeHtml(params.eventTitle)}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
                
                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #f59e0b 0%, #f97316 100%); padding: 40px; text-align: center;">
                      <div style="display: inline-block; padding: 10px 18px; background: rgba(0, 0, 0, 0.15); border-radius: 30px; margin-bottom: 16px;">
                        <span style="font-size: 13px; font-weight: 600; color: #ffffff; letter-spacing: 0.5px;">📢 EVENT UPDATE</span>
                      </div>
                      <div style="font-size: 20px; font-weight: 800; color: #ffffff;">${escapeHtml(params.eventTitle)}</div>
                    </div>
                  </td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">Hi ${escapeHtml(params.attendeeName)}! 👋</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      The organizer has posted an important update about your event.
                    </div>
                    
                    <!-- Update Card -->
                    <div style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-radius: 16px; padding: 24px; border-left: 4px solid #f59e0b;">
                      <div style="font-size: 18px; font-weight: 800; color: #78350f; margin-bottom: 12px;">${escapeHtml(params.updateTitle)}</div>
                      <div style="font-size: 15px; color: #92400e; line-height: 1.8; white-space: pre-line;">${escapeHtml(params.updateMessage)}</div>
                    </div>
                    
                    <div style="text-align: center; margin-top: 32px;">
                      ${getButton('View Event Details', eventUrl, '#0f172a')}
                    </div>
                    
                    <div style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
                      This update was sent by the event organizer to all ticket holders.
                    </div>
                  </td>
                </tr>
                
                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

/**
 * The organizer answered an attendee's question about an event.
 *
 * The reply text is the point of this email — someone asked "is this real?" and
 * this is the answer, so it is quoted in full rather than teased with a "you
 * have a new message" stub that forces a round trip.
 *
 * `to` is resolved server-side from the thread's sender_id. It is never taken
 * from a request body: the organizer types the words, never the address.
 */
export function getOrganizerReplyEmail(params: {
  attendeeName: string
  organizerName: string
  eventTitle: string
  eventId: string
  question: string
  reply: string
}) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const eventUrl = `${appUrl}/events/${encodeURIComponent(String(params.eventId))}`

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${escapeHtml(params.organizerName)} replied - ${escapeHtml(params.eventTitle)}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); padding: 40px; text-align: center;">
                      <div style="display: inline-block; padding: 10px 18px; background: rgba(0, 0, 0, 0.15); border-radius: 30px; margin-bottom: 16px;">
                        <span style="font-size: 13px; font-weight: 600; color: #ffffff; letter-spacing: 0.5px;">💬 THE ORGANIZER REPLIED</span>
                      </div>
                      <div style="font-size: 20px; font-weight: 800; color: #ffffff;">${escapeHtml(params.eventTitle)}</div>
                    </div>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">Hi ${escapeHtml(params.attendeeName)} 👋</div>
                    <div style="font-size: 15px; color: #64748b; line-height: 1.7; margin-bottom: 24px;">
                      ${escapeHtml(params.organizerName)} answered the question you sent about this event.
                    </div>

                    <!-- Your question -->
                    <div style="border-left: 3px solid #e2e8f0; padding: 4px 0 4px 16px; margin-bottom: 24px;">
                      <div style="font-size: 12px; font-weight: 700; color: #94a3b8; letter-spacing: 0.5px; margin-bottom: 6px;">YOU ASKED</div>
                      <div style="font-size: 14px; color: #64748b; line-height: 1.7; white-space: pre-line;">${escapeHtml(params.question)}</div>
                    </div>

                    <!-- The reply -->
                    <div style="background: linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%); border-radius: 16px; padding: 24px; border-left: 4px solid #14b8a6;">
                      <div style="font-size: 12px; font-weight: 700; color: #0f766e; letter-spacing: 0.5px; margin-bottom: 10px;">${escapeHtml(String(params.organizerName ?? "").toUpperCase())} REPLIED</div>
                      <div style="font-size: 15px; color: #134e4a; line-height: 1.8; white-space: pre-line;">${escapeHtml(params.reply)}</div>
                    </div>

                    <div style="text-align: center; margin-top: 32px;">
                      ${getButton('View the event', eventUrl, '#0f172a')}
                    </div>

                    <div style="font-size: 12px; color: #94a3b8; text-align: center; margin-top: 24px;">
                      Reply to this organizer from the event page. Your email address stays private.
                    </div>
                  </td>
                </tr>

                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}

export function getBankVerificationDecisionEmail(params: {
  organizerName: string
  decision: 'approve' | 'reject'
  reason?: string
}) {
  const isApproved = params.decision === 'approve'
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'
  const payoutUrl = `${appUrl}/organizer/payout-settings`

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Bank Verification ${isApproved ? 'Approved' : 'Update'}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: ${emailStyles.fontFamily}; background-color: #0f172a; -webkit-font-smoothing: antialiased;">
        <table role="presentation" style="width: 100%; border-collapse: collapse;">
          <tr>
            <td align="center" style="padding: 48px 16px;">
              <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">

                <!-- Header -->
                <tr>
                  <td style="padding: 0;">
                    <div style="background: linear-gradient(135deg, ${isApproved ? '#10b981 0%, #059669 50%, #047857 100%' : '#ef4444 0%, #dc2626 50%, #b91c1c 100%'}); padding: 50px 40px; text-align: center;">
                      <div style="font-size: 64px; line-height: 1;">${isApproved ? '✅' : '⚠️'}</div>
                      <div style="margin-top: 20px; font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                        Bank Account ${isApproved ? 'Verified' : 'Verification Update'}
                      </div>
                      <div style="margin-top: 8px; font-size: 14px; color: rgba(255, 255, 255, 0.85);">Tikèm</div>
                    </div>
                  </td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px;">
                    <div style="font-size: 22px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">
                      Hi ${escapeHtml(params.organizerName)},
                    </div>
                    ${isApproved ? `
                    <div style="font-size: 16px; color: #64748b; line-height: 1.7; margin-bottom: 28px;">
                      Great news! Your bank account has been verified. You can now receive payouts directly to your bank account for tickets sold on Tikèm.
                    </div>
                    <div style="background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border-radius: 14px; padding: 20px; border-left: 4px solid #10b981; margin-bottom: 28px;">
                      <div style="font-size: 14px; font-weight: 700; color: #166534; margin-bottom: 8px;">✓ What this means for you</div>
                      <ul style="margin: 0; padding-left: 18px; font-size: 14px; color: #15803d; line-height: 1.9;">
                        <li>Payouts will be processed to your verified bank account</li>
                        <li>Funds settle within 2–5 business days after withdrawal</li>
                        <li>You can request a payout from your organizer dashboard</li>
                      </ul>
                    </div>
                    <div style="text-align: center;">
                      ${getButton('Go to Payout Settings', payoutUrl, '#10b981')}
                    </div>
                    ` : `
                    <div style="font-size: 16px; color: #64748b; line-height: 1.7; margin-bottom: 28px;">
                      We were unable to verify your bank account at this time. Please review the details below and resubmit your verification.
                    </div>
                    ${params.reason ? `
                    <div style="background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); border-radius: 14px; padding: 20px; border-left: 4px solid #ef4444; margin-bottom: 28px;">
                      <div style="font-size: 14px; font-weight: 700; color: #991b1b; margin-bottom: 8px;">Reason</div>
                      <div style="font-size: 14px; color: #b91c1c;">${escapeHtml(params.reason)}</div>
                    </div>
                    ` : ''}
                    <div style="text-align: center;">
                      ${getButton('Resubmit Verification', payoutUrl, '#ef4444')}
                    </div>
                    `}
                  </td>
                </tr>

                ${getEmailFooter()}
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `
}
