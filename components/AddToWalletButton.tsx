'use client'

import { useEffect, useState } from 'react'
import { Wallet, Download, Smartphone } from 'lucide-react'
import { format } from 'date-fns'
import { escapeHtml } from '@/lib/html'

interface AddToWalletButtonProps {
  ticket: any
  event: any
  /** DOM id of this ticket's QR container. Must match the QRCodeDisplay id so
   *  PDF capture grabs THIS ticket's QR, not the first one on the page. */
  qrElementId?: string
}

export default function AddToWalletButton({ ticket, event, qrElementId = 'ticket-qr-code' }: AddToWalletButtonProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  /**
   * What the server can actually issue (GET /api/wallet/generate — booleans
   * only). `null` = not known yet. A wallet row is hidden outright once we know
   * this deployment has no certificates for it, so the menu never offers a
   * click that must fail. "Download PDF" is unaffected and always available.
   */
  const [walletCapability, setWalletCapability] = useState<{ apple: boolean; google: boolean } | null>(null)
  const [isAddingToWallet, setIsAddingToWallet] = useState<'ios' | 'android' | null>(null)

  // Close dropdown when clicking outside
  const dropdownRef = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/wallet/generate')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setWalletCapability({ apple: Boolean(data.apple), google: Boolean(data.google) })
      })
      .catch(() => {
        // Leave it unknown; the rows stay visible and explain themselves on click.
      })
    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Ask the server for a wallet link for THIS ticket and follow it.
   * The server re-verifies that the signed-in user owns the ticket and re-reads
   * the ticket's existing QR payload — nothing here is trusted.
   */
  const addToWallet = async (platform: 'ios' | 'android') => {
    setIsAddingToWallet(platform)
    try {
      const response = await fetch('/api/wallet/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticketId: ticket?.id, platform }),
      })
      const data = await response.json().catch(() => ({} as any))

      if (!response.ok) {
        if (data?.code === 'apple_wallet_not_configured' || data?.code === 'google_wallet_not_configured') {
          // Permanent for this deployment — say so, and stop offering it.
          setWalletCapability((prev) => ({
            apple: platform === 'ios' ? false : Boolean(prev?.apple),
            google: platform === 'android' ? false : Boolean(prev?.google),
          }))
          alert('Wallet passes aren’t available yet. Use "Download PDF" to save your ticket.')
          return
        }
        alert(data?.error || 'Could not create your wallet pass.')
        return
      }

      const url = platform === 'ios' ? data?.passUrl : data?.saveUrl
      if (!url) {
        alert('Wallet passes aren’t available yet. Use "Download PDF" to save your ticket.')
        return
      }
      window.location.href = url
    } catch (error) {
      console.error('Error adding to wallet:', error)
      alert('Could not create your wallet pass.')
    } finally {
      setIsAddingToWallet(null)
      setShowOptions(false)
    }
  }

  const handleDownloadPDF = async () => {
    setIsDownloading(true)
    
    // Validate required fields
    if (!event || !ticket) {
      alert('Ticket data is incomplete')
      setIsDownloading(false)
      return
    }
    
    // Give the page time to render the QR code if it hasn't yet
    await new Promise(resolve => setTimeout(resolve, 500))
    
    try {
      // Find the QR code SVG element by its container
      const qrContainer = document.getElementById(qrElementId)
      const qrCodeElement = qrContainer?.querySelector('svg') as SVGElement
      
      if (!qrCodeElement) {
        console.error('QR code not found. Container:', qrContainer)
        alert('QR code not found. Please wait a moment and try again.')
        setIsDownloading(false)
        return
      }

      // Convert SVG to PNG for better PDF compatibility
      const svgData = new XMLSerializer().serializeToString(qrCodeElement)
      console.log('SVG data length:', svgData.length)
      
      // Create canvas to convert SVG to PNG
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      const img = new Image()
      
      // Wait for image to load
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          canvas.width = img.width || 300
          canvas.height = img.height || 300
          console.log('Canvas size:', canvas.width, 'x', canvas.height)
          ctx?.drawImage(img, 0, 0)
          resolve()
        }
        img.onerror = (error) => {
          console.error('Image load error:', error)
          reject(error)
        }
        img.src = 'data:image/svg+xml;base64,' + btoa(svgData)
      })
      
      // Get QR code as PNG data URL
      const qrDataUrl = canvas.toDataURL('image/png')
      console.log('QR Data URL length:', qrDataUrl.length)
      console.log('QR Data URL preview:', qrDataUrl.substring(0, 100))

      // Create a clean, printable version
      const printWindow = window.open('', '_blank')
      if (!printWindow) {
        alert('Please allow popups to download your ticket')
        setIsDownloading(false)
        return
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Ticket - ${escapeHtml(event.title)}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              padding: 40px;
              background: white;
            }
            .ticket {
              max-width: 600px;
              margin: 0 auto;
              border: 3px solid #000;
              border-radius: 20px;
              overflow: hidden;
            }
            .header {
              background: linear-gradient(135deg, #0D9488 0%, #F97316 100%);
              color: white;
              padding: 30px;
              text-align: center;
            }
            .header h1 { font-size: 28px; margin-bottom: 10px; }
            .header p { font-size: 14px; opacity: 0.9; }
            .qr-section {
              background: #f9fafb;
              padding: 40px;
              text-align: center;
              border-bottom: 3px dashed #e5e7eb;
            }
            .qr-code {
              display: inline-block;
              padding: 20px;
              background: white;
              border-radius: 15px;
              border: 2px solid #e5e7eb;
            }
            .qr-code img { display: block; width: 250px; height: 250px; }
            .status {
              display: inline-block;
              margin-top: 20px;
              padding: 10px 20px;
              background: #dcfce7;
              color: #166534;
              border-radius: 20px;
              font-weight: bold;
              font-size: 14px;
            }
            .details {
              padding: 30px;
              background: white;
            }
            .event-title {
              font-size: 24px;
              font-weight: bold;
              margin-bottom: 20px;
              color: #111827;
            }
            .detail-row {
              display: flex;
              align-items: start;
              margin-bottom: 15px;
              padding-bottom: 15px;
              border-bottom: 1px solid #f3f4f6;
            }
            .detail-row:last-child { border-bottom: none; }
            .detail-label {
              font-weight: 600;
              color: #6b7280;
              min-width: 120px;
              font-size: 13px;
            }
            .detail-value {
              color: #111827;
              font-size: 14px;
              flex: 1;
            }
            .footer {
              background: #f9fafb;
              padding: 20px 30px;
              text-align: center;
              border-top: 1px solid #e5e7eb;
            }
            .ticket-id {
              font-family: 'Courier New', monospace;
              font-size: 11px;
              color: #6b7280;
              word-break: break-all;
            }
            .instructions {
              margin-top: 30px;
              padding: 20px;
              background: #eff6ff;
              border: 2px solid #3b82f6;
              border-radius: 10px;
            }
            .instructions h3 {
              font-size: 16px;
              color: #1e40af;
              margin-bottom: 10px;
            }
            .instructions ul {
              list-style: none;
              font-size: 13px;
              color: #1e3a8a;
            }
            .instructions li {
              margin: 5px 0;
              padding-left: 20px;
              position: relative;
            }
            .instructions li:before {
              content: "✓";
              position: absolute;
              left: 0;
              color: #3b82f6;
              font-weight: bold;
            }
            @media print {
              body { padding: 0; }
              .instructions { page-break-before: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="ticket">
            <div class="header">
              <h1>Event Ticket</h1>
              <p>Present this QR code at the venue entrance</p>
            </div>
            
            <div class="qr-section">
              <div class="qr-code">
                <img src="${escapeHtml(qrDataUrl)}" alt="QR Code" />
              </div>
              <div class="status">${ticket.checked_in_at ? 'USED' : 'VALID'}</div>
            </div>
            
            <div class="details">
              <h2 class="event-title">${escapeHtml(event.title)}</h2>
              
              <div class="detail-row">
                <div class="detail-label">Date:</div>
                <div class="detail-value">${event.start_datetime ? format(new Date(event.start_datetime), 'EEEE, MMMM d, yyyy') : 'TBA'}</div>
              </div>
              
              <div class="detail-row">
                <div class="detail-label">Time:</div>
                <div class="detail-value">${event.start_datetime && event.end_datetime ? `${format(new Date(event.start_datetime), 'h:mm a')} - ${format(new Date(event.end_datetime), 'h:mm a')}` : 'TBA'}</div>
              </div>
              
              <div class="detail-row">
                <div class="detail-label">Venue:</div>
                <div class="detail-value">${escapeHtml(event.venue_name || 'TBA')}<br>${event.commune ? escapeHtml(event.commune) + ', ' : ''}${escapeHtml(event.city || 'TBA')}</div>
              </div>
              
              <div class="detail-row">
                <div class="detail-label">Purchased:</div>
                <div class="detail-value">${ticket.purchased_at ? format(new Date(ticket.purchased_at), 'MMM d, yyyy h:mm a') : 'N/A'}</div>
              </div>
            </div>
            
            <div class="footer">
              <div class="ticket-id">Ticket ID: ${escapeHtml(ticket.id)}</div>
            </div>
          </div>
          
          <div class="instructions">
            <h3>📱 How to Use Your Ticket</h3>
            <ul>
              <li>Show the QR code above at the venue entrance</li>
              <li>Keep this ticket on your phone or print it</li>
              <li>Each ticket can only be scanned once</li>
              <li>Arrive early to avoid queues</li>
            </ul>
          </div>
          
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 500);
            }
          </script>
        </body>
        </html>
      `)
      printWindow.document.close()
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Failed to generate ticket PDF')
    } finally {
      setIsDownloading(false)
    }
  }

  const handleAddToAppleWallet = () => addToWallet('ios')
  const handleAddToGooglePay = () => addToWallet('android')

  return (
    <div className="relative">
      {/* Main Button */}
      <button
        onClick={() => setShowOptions(!showOptions)}
        disabled={isDownloading}
        className="w-full inline-flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 text-white rounded-xl font-bold shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all"
      >
        <Wallet className="w-5 h-5" />
        {isDownloading ? 'Preparing...' : 'Save Ticket'}
        <svg 
          className={`w-4 h-4 transition-transform ${showOptions ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Options Dropdown */}
      {showOptions && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#111] rounded-xl shadow-2xl border-2 border-white/10 overflow-hidden z-50">
          <button
            onClick={handleDownloadPDF}
            className="w-full flex items-center gap-3 px-6 py-4 hover:bg-white/[0.03] transition-colors text-left border-b border-white/10"
          >
            <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
              <Download className="w-5 h-5 text-white/90" />
            </div>
            <div>
              <div className="font-bold text-white">Download PDF</div>
              <div className="text-xs text-white/65">Print or save to device</div>
            </div>
          </button>

          {walletCapability?.apple !== false && (
            <button
              onClick={handleAddToAppleWallet}
              disabled={isAddingToWallet !== null}
              className="w-full flex items-center gap-3 px-6 py-4 hover:bg-white/[0.03] transition-colors text-left border-b border-white/10 disabled:opacity-50"
            >
              <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="font-bold text-white">Apple Wallet</div>
                <div className="text-xs text-white/65">
                  {isAddingToWallet === 'ios' ? 'Preparing your pass…' : 'For iPhone users'}
                </div>
              </div>
            </button>
          )}

          {walletCapability?.google !== false && (
            <button
              onClick={handleAddToGooglePay}
              disabled={isAddingToWallet !== null}
              className="w-full flex items-center gap-3 px-6 py-4 hover:bg-white/[0.03] transition-colors text-left disabled:opacity-50"
            >
              <div className="w-10 h-10 bg-white/[0.06] rounded-lg flex items-center justify-center">
                <Smartphone className="w-5 h-5 text-white/90" />
              </div>
              <div>
                <div className="font-bold text-white">Google Wallet</div>
                <div className="text-xs text-white/65">
                  {isAddingToWallet === 'android' ? 'Preparing your pass…' : 'For Android users'}
                </div>
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
