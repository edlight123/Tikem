import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { createNotification } from '@/lib/notifications/helpers'
import { sendPushNotification } from '@/lib/notification-triggers'
import { sendEmail } from '@/lib/email'

/**
 * Test notification endpoint
 * Creates sample notifications for testing purposes
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    // Test tooling: sends real pushes and emails, so admins only.
    if (user.role !== 'admin' && user.role !== 'super_admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { type } = await request.json()

    let result: any = { success: true, sent: [] }

    switch (type) {
      case 'ticket_purchase':
        // Create ticket purchase notification
        await createNotification(
          user.id,
          'ticket_purchased',
          'Test: Ticket Purchase Confirmed! 🎉',
          'This is a test notification. Your ticket for "Sample Event" has been confirmed.',
          '/tickets',
          { eventId: 'test-event-123', ticketCount: 2 }
        )
        
        await sendPushNotification(
          user.id,
          '🎫 Test Ticket Purchase',
          'Your test ticket is ready!',
          '/tickets',
          { type: 'test_ticket' }
        )
        
        result.sent.push('ticket_purchase')
        break

      case 'verification':
        // Create verification approved notification
        await createNotification(
          user.id,
          'verification',
          'Test: ✅ Verification Approved!',
          'This is a test notification. Your account has been verified!',
          '/organizer/verify',
          { status: 'approved' }
        )
        
        await sendPushNotification(
          user.id,
          '✅ Test Verification',
          'Your account is now verified!',
          '/organizer/verify',
          { type: 'test_verification' }
        )
        
        result.sent.push('verification')
        break

      case 'event_reminder':
        // Create event reminder notification
        await createNotification(
          user.id,
          'event_reminder_24h',
          'Test: ⏰ Event Reminder',
          'This is a test notification. Sample Event starts in 24 hours!',
          '/tickets',
          { eventId: 'test-event-123' }
        )
        
        await sendPushNotification(
          user.id,
          '⏰ Test Event Reminder',
          'Sample Event starts in 24 hours',
          '/tickets',
          { type: 'test_reminder' }
        )
        
        result.sent.push('event_reminder')
        break

      case 'new_event':
        // Create new event notification (follower)
        await createNotification(
          user.id,
          'event_updated',
          'Test: 📅 New Event Available',
          'This is a test notification. A new event has been published!',
          '/discover',
          { eventId: 'test-event-123' }
        )
        
        await sendPushNotification(
          user.id,
          '📅 Test New Event',
          'Check out this new event!',
          '/discover',
          { type: 'test_new_event' }
        )
        
        result.sent.push('new_event')
        break

      case 'email':
        // Send test email
        const emailResult = await sendEmail({
          to: user.email || '',
          subject: 'Test Email from Tikèm',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); padding: 40px 20px; text-align: center;">
                <h1 style="color: white; margin: 0; font-size: 28px;">🧪 Test Email</h1>
              </div>
              
              <div style="padding: 40px 20px; background: #f9fafb;">
                <div style="background: white; border-radius: 12px; padding: 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                  <p style="font-size: 18px; color: #111827; margin-bottom: 10px;">Hi ${user.user_metadata?.full_name || user.email}!</p>
                  
                  <p style="font-size: 16px; color: #374151; line-height: 1.6;">
                    This is a <strong>test email</strong> from Tikèm. If you're seeing this, email notifications are working correctly! 🎉
                  </p>
                  
                  <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
                    <p style="margin: 0; color: #6b7280; font-size: 14px;">
                      <strong>Sent at:</strong> ${new Date().toLocaleString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  
                  <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
                    You can now test other notification types like ticket purchases, event reminders, and verification updates.
                  </p>
                  
                  <div style="text-align: center; margin-top: 30px;">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://tikem.co'}/notifications"
                       style="display: inline-block; background: #0d9488; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                      View All Notifications
                    </a>
                  </div>
                </div>
              </div>
              
              <div style="padding: 20px; text-align: center; color: #6b7280; font-size: 12px;">
                <p>Tikèm - Experience Haiti's Best Events</p>
              </div>
            </div>
          `,
        })
        
        result.email = emailResult
        result.sent.push('email')
        break

      case 'all':
        // Send multiple test notifications
        await createNotification(
          user.id,
          'ticket_purchased',
          'Test: Multiple Notifications',
          'Testing all notification types at once!',
          '/notifications'
        )
        result.sent = ['all']
        break

      default:
        return NextResponse.json({ error: 'Invalid notification type' }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Test notification error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send test notification' },
      { status: 500 }
    )
  }
}
