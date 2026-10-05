import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { sendEmail } from '@/lib/email'

/**
 * A developer tool: off in production. The GET served a public test page, and
 * the POST lets any signed-in account send Tikèm-branded mail to an arbitrary
 * address. Previews and local dev keep it.
 */
function isDisabled(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV !== 'preview'
}

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/**
 * GET /api/test-email
 * Show test email form
 */
export async function GET() {
  if (isDisabled()) return notFound()

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>Test Email - Tikèm</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #f3f4f6;
          }
          .card {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          }
          h1 {
            color: #0d9488;
            margin-top: 0;
          }
          .info {
            background: #dbeafe;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
          }
          .warning {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
          }
          .success {
            background: #d1fae5;
            border-left: 4px solid #10b981;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
          }
          .error {
            background: #fee2e2;
            border-left: 4px solid #ef4444;
            padding: 15px;
            margin: 20px 0;
            border-radius: 6px;
          }
          button {
            background: #0d9488;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 16px;
            cursor: pointer;
            width: 100%;
            font-weight: 600;
          }
          button:hover {
            background: #0f766e;
          }
          button:disabled {
            background: #9ca3af;
            cursor: not-allowed;
          }
          input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e5e7eb;
            border-radius: 8px;
            font-size: 16px;
            margin: 10px 0;
            box-sizing: border-box;
          }
          label {
            color: #374151;
            font-weight: 600;
            display: block;
            margin-top: 15px;
          }
          #result {
            margin-top: 20px;
          }
          code {
            background: #f3f4f6;
            padding: 2px 6px;
            border-radius: 4px;
            font-family: monospace;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>📧 Email Test</h1>
          
          <div class="info">
            <strong>ℹ️ Info:</strong> This endpoint tests the email notification system.
            You must be logged in to use it.
          </div>

          <form id="testForm">
            <label for="email">Recipient Email (optional - uses your email by default)</label>
            <input type="email" id="email" name="email" placeholder="you@example.com">
            
            <button type="submit" id="submitBtn">Send Test Email</button>
          </form>

          <div id="result"></div>
        </div>

        <script>
          const form = document.getElementById('testForm');
          const submitBtn = document.getElementById('submitBtn');
          const result = document.getElementById('result');

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            submitBtn.disabled = true;
            submitBtn.textContent = 'Sending...';
            result.innerHTML = '<div class="info">⏳ Sending test email...</div>';

            try {
              const email = document.getElementById('email').value;
              const response = await fetch('/api/test-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(email ? { to: email } : {})
              });

              const data = await response.json();

              if (data.success) {
                result.innerHTML = \`
                  <div class="success">
                    <strong>✅ Success!</strong> Email sent successfully.
                    <br><br>
                    <strong>To:</strong> \${data.to}<br>
                    <strong>Message ID:</strong> <code>\${data.messageId}</code><br>
                    <strong>Email From:</strong> <code>\${data.emailFrom}</code>
                  </div>
                \`;
              } else if (data.isDummyKey) {
                result.innerHTML = \`
                  <div class="warning">
                    <strong>⚠️ Dummy API Key Detected</strong>
                    <br><br>
                    The <code>RESEND_API_KEY</code> is set to a dummy value.
                    <br><br>
                    <strong>To fix:</strong>
                    <ol>
                      <li>Get a real API key from <a href="https://resend.com" target="_blank">resend.com</a></li>
                      <li>Add it to Vercel environment variables</li>
                      <li>Redeploy or wait for automatic deployment</li>
                    </ol>
                    <strong>Error:</strong> \${data.error}
                  </div>
                \`;
              } else if (!data.resendConfigured) {
                result.innerHTML = \`
                  <div class="warning">
                    <strong>⚠️ No API Key Configured</strong>
                    <br><br>
                    <code>RESEND_API_KEY</code> environment variable is not set.
                    <br><br>
                    <strong>Error:</strong> \${data.error}
                  </div>
                \`;
              } else {
                result.innerHTML = \`
                  <div class="error">
                    <strong>❌ Error</strong>
                    <br><br>
                    \${data.error}
                  </div>
                \`;
              }
            } catch (err) {
              result.innerHTML = \`
                <div class="error">
                  <strong>❌ Request Failed</strong>
                  <br><br>
                  \${err.message}
                </div>
              \`;
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Send Test Email';
            }
          });
        </script>
      </body>
    </html>
  `;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * POST /api/test-email
 * Test email sending functionality
 */
export async function POST(request: Request) {
  if (isDisabled()) return notFound()

  try {
    const user = await getCurrentUser()
    
    if (!user || !user.email) {
      return NextResponse.json({ error: 'Unauthorized or no email' }, { status: 401 })
    }

    const { to } = await request.json().catch(() => ({ to: null }))
    const recipient = to || user.email

    console.log(`📧 Attempting to send test email to: ${recipient}`)
    console.log(`📧 RESEND_API_KEY configured: ${process.env.RESEND_API_KEY ? 'Yes' : 'No'}`)
    console.log(`📧 EMAIL_FROM: ${process.env.EMAIL_FROM || 'Not set'}`)

    const result = await sendEmail({
      to: recipient,
      subject: 'Test Email from Tikèm',
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Test Email</title>
          </head>
          <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tr>
                <td align="center" style="padding: 40px 0;">
                  <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                    <tr>
                      <td style="background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); padding: 40px; text-align: center;">
                        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold;">🧪 Test Email</h1>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 40px;">
                        <h2 style="margin: 0 0 16px; color: #111827; font-size: 24px;">Email System Test</h2>
                        <p style="margin: 0 0 24px; color: #6b7280; font-size: 16px; line-height: 1.6;">
                          This is a test email from Tikèm. If you're receiving this, the email notification system is working correctly! 🎉
                        </p>
                        
                        <div style="background: #f3f4f6; border-radius: 12px; padding: 24px; margin: 24px 0;">
                          <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;"><strong>Sent to:</strong> ${recipient}</p>
                          <p style="margin: 0 0 8px; color: #6b7280; font-size: 14px;"><strong>Sent at:</strong> ${new Date().toLocaleString('en-US', {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            timeZoneName: 'short'
                          })}</p>
                          <p style="margin: 0; color: #6b7280; font-size: 14px;"><strong>User:</strong> ${user.user_metadata?.full_name || 'Unknown'}</p>
                        </div>

                        <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 16px; border-radius: 8px; margin: 24px 0;">
                          <p style="margin: 0; color: #1e40af; font-size: 14px;">
                            <strong>✅ Success!</strong> Your email notification system is properly configured and working.
                          </p>
                        </div>

                        <div style="text-align: center; margin-top: 32px;">
                          <a href="${process.env.NEXT_PUBLIC_APP_URL}/notifications" 
                             style="display: inline-block; background: #0d9488; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                            View Notifications
                          </a>
                        </div>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 24px 40px; background-color: #f9fafb; border-top: 1px solid #e5e7eb;">
                        <p style="margin: 0; color: #6b7280; font-size: 14px; text-align: center;">
                          Tikèm - Experience Haiti's Best Events 🇭🇹
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </body>
        </html>
      `,
    })

    console.log(`📧 Email send result:`, result)

    return NextResponse.json({
      success: result.success,
      to: recipient,
      messageId: result.messageId,
      error: result.error,
      resendConfigured: !!process.env.RESEND_API_KEY,
      isDummyKey: process.env.RESEND_API_KEY === 're_dummy_key_for_build',
      emailFrom: process.env.EMAIL_FROM || 'Not configured'
    })
  } catch (error: any) {
    console.error('❌ Test email error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        resendConfigured: !!process.env.RESEND_API_KEY,
        isDummyKey: process.env.RESEND_API_KEY === 're_dummy_key_for_build'
      },
      { status: 500 }
    )
  }
}
