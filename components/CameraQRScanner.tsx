'use client'

// Live Camera QR Code Scanner Component
// Uses browser MediaDevices API to scan QR codes in real-time
// Alternative to file upload for ticket check-in

import { useEffect, useRef, useState, useCallback } from 'react'
import jsQR from 'jsqr'

interface CameraQRScannerProps {
  onScan: (data: string) => void
  onError?: (error: Error) => void
  className?: string
  width?: number
  height?: number
}

export function CameraQRScanner({
  onScan,
  onError,
  className = '',
  width = 640,
  height = 480
}: CameraQRScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isScanning, setIsScanning] = useState(false)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [debugInfo, setDebugInfo] = useState<string>('')
  const [frameCount, setFrameCount] = useState(0)
  const [consoleLog, setConsoleLog] = useState<string[]>([])
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)

  // Helper to add to console log
  const addLog = (msg: string) => {
    console.log(msg)
    setConsoleLog(prev => [...prev.slice(-4), msg]) // Keep last 5 messages
  }

  
  const scanFrame = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current

    if (!video) {
      addLog('scanFrame: no video')
      return
    }
    
    if (!canvas) {
      addLog('scanFrame: no canvas')
      return
    }
    
    // Don't check isScanning here - the interval controls when we scan
    
    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      addLog(`scanFrame: video readyState=${video.readyState}`)
      return
    }

    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return

    // Set canvas internal resolution to match video
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      console.log(`Canvas sized: ${canvas.width}x${canvas.height}`)
      
      // Also set CSS size to match parent
      const parent = canvas.parentElement
      if (parent) {
        canvas.style.width = '100%'
        canvas.style.height = '100%'
      }
    }

    if (canvas.width === 0 || canvas.height === 0) {
      console.log('Canvas has zero dimensions, skipping frame')
      return
    }

    try {
      // Clear canvas first
      context.clearRect(0, 0, canvas.width, canvas.height)
      
      // Draw video frame
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      
      // Update frame counter for debugging
      setFrameCount(prev => prev + 1)
      
      // Get image data
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
      
      // Scan for QR code
      const code = jsQR(imageData.data, canvas.width, canvas.height, {
        inversionAttempts: 'attemptBoth'
      })

      if (code?.data) {
        console.log('✓ QR Code found:', code.data)
        
        // Stop scanning
        if (scanIntervalRef.current) {
          clearInterval(scanIntervalRef.current)
          scanIntervalRef.current = null
        }
        setIsScanning(false)
        
        // Call handler
        onScan(code.data)
      }
    } catch (err) {
      console.error('Scan frame error:', err)
    }
  }, [onScan])

  const startScanning = useCallback(() => {
    addLog('startScanning called')
    setDebugInfo('Starting scan interval...')
    
    // Scan for QR codes every 100ms
    scanIntervalRef.current = setInterval(() => {
      scanFrame()
    }, 100)
    
    addLog(`Scan interval set: ${scanIntervalRef.current}`)
  }, [scanFrame])

  const startCamera = useCallback(async () => {
    try {
      setError(null)
      setHasPermission(null)
      setDebugInfo('Requesting camera...')
      
      console.log('Requesting camera access...')
      
      // Try simpler constraints first for iOS compatibility
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const constraints = isIOS 
        ? { video: { facingMode: 'environment' } }
        : {
            video: {
              facingMode: 'environment',
              width: { ideal: 1280 },
              height: { ideal: 720 }
            }
          }
      
      console.log('Using constraints:', constraints)
      setDebugInfo('Requesting with iOS constraints...')
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      
      setDebugInfo('Stream obtained!')
      console.log('Camera stream obtained', stream)

      const video = videoRef.current
      if (!video) {
        setDebugInfo('ERROR: No video element')
        console.error('No video element found')
        return
      }

      setDebugInfo('Setting stream to video...')
      video.srcObject = stream
      
      console.log('Stream tracks:', stream.getTracks().map(t => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState,
        label: t.label
      })))
      
      // Force play on mobile
      video.setAttribute('autoplay', 'true')
      video.setAttribute('muted', 'true')
      video.setAttribute('playsinline', 'true')
      video.muted = true
      video.playsInline = true
      video.style.display = 'block'
      
      setDebugInfo('Waiting for metadata...')
      
      // Wait for the video to actually start
      return new Promise<void>((resolve, reject) => {
        let resolved = false
        
        video.onloadedmetadata = async () => {
          setDebugInfo(`Metadata! ${video.videoWidth}x${video.videoHeight}`)
          console.log('Video metadata loaded:', {
            width: video.videoWidth,
            height: video.videoHeight,
            readyState: video.readyState
          })
          
          try {
            await video.play()
            setDebugInfo('Video playing!')
            console.log('Video playing')
            
            // Give it a moment to actually render
            setTimeout(() => {
              if (!resolved) {
                resolved = true
                setHasPermission(true)
                setIsScanning(true)
                startScanning()
                // Show video dimensions in debug
                const debugMsg = `Active: ${video.videoWidth}x${video.videoHeight}`
                setDebugInfo(debugMsg)
                console.log('Scanning active with dimensions:', debugMsg)
                
                // Force Safari to render the video - trigger repaint
                video.style.transform = 'translateZ(0)'
                ;(video.style as any).webkitTransform = 'translateZ(0)'
                
                // Try forcing a layout recalculation
                void video.offsetHeight
                
                resolve()
              }
            }, 500)
          } catch (playError) {
            setDebugInfo(`Play error: ${playError}`)
            console.error('Play error:', playError)
            if (!resolved) {
              resolved = true
              reject(playError)
            }
          }
        }
        
        video.onerror = (err) => {
          setDebugInfo(`Video error: ${err}`)
          console.error('Video element error:', err)
          if (!resolved) {
            resolved = true
            reject(new Error('Video element error'))
          }
        }
        
        // Timeout after 10 seconds
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            setDebugInfo('Timeout - video did not load')
            // Don't reject on timeout, just mark as ready and try anyway
            setHasPermission(true)
            setIsScanning(true)
            startScanning()
            resolve()
          }
        }, 10000)
      })
    } catch (err) {
      console.error('Camera access error:', err)
      setDebugInfo(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
      let errorMessage = 'Failed to access camera'
      
      if (err instanceof Error) {
        errorMessage = err.message
        // Check for common permission/HTTPS errors
        if (err.name === 'NotAllowedError') {
          errorMessage = 'Camera access denied. Please allow camera permissions in your browser settings.'
        } else if (err.name === 'NotFoundError') {
          errorMessage = 'No camera found on this device.'
        } else if (err.name === 'NotSupportedError' || err.message.includes('secure')) {
          errorMessage = 'Camera requires HTTPS. Please access this page via a secure connection.'
        }
      }
      
      setError(errorMessage)
      setHasPermission(false)
      onError?.(err instanceof Error ? err : new Error(errorMessage))
    }
  }, [onError, startScanning])

  const stopCamera = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }

    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach(track => track.stop())
      videoRef.current.srcObject = null
    }

    setIsScanning(false)
  }, [])
  
  // Don't auto-start on iOS - wait for user interaction
  useEffect(() => {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (!isIOS) {
      startCamera()
    } else {
      setHasPermission(null)
    }
    return () => {
      stopCamera()
    }
  }, [startCamera, stopCamera])

  const drawBox = (
    context: CanvasRenderingContext2D,
    location: {
      topLeftCorner: { x: number; y: number }
      topRightCorner: { x: number; y: number }
      bottomRightCorner: { x: number; y: number }
      bottomLeftCorner: { x: number; y: number }
    }
  ) => {
    context.strokeStyle = '#10b981'
    context.lineWidth = 4
    context.beginPath()
    context.moveTo(location.topLeftCorner.x, location.topLeftCorner.y)
    context.lineTo(location.topRightCorner.x, location.topRightCorner.y)
    context.lineTo(location.bottomRightCorner.x, location.bottomRightCorner.y)
    context.lineTo(location.bottomLeftCorner.x, location.bottomLeftCorner.y)
    context.lineTo(location.topLeftCorner.x, location.topLeftCorner.y)
    context.stroke()
  }

  if (hasPermission === false) {
    return (
      <div className={`rounded-lg border-2 border-dashed border-red-300 p-8 text-center ${className}`}>
        <svg
          className="mx-auto h-12 w-12 text-red-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <h3 className="mt-2 text-sm font-medium text-red-300">Camera Access Denied</h3>
        <p className="mt-1 text-sm text-red-600">
          {error || 'Please allow camera access to scan QR codes'}
        </p>
        {debugInfo && (
          <p className="mt-2 text-xs text-red-500 font-mono">{debugInfo}</p>
        )}
        <button
          onClick={startCamera}
          className="mt-4 inline-flex items-center rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500"
        >
          Try Again
        </button>
      </div>
    )
  }

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  return (
    <div className={`relative rounded-lg overflow-hidden bg-gray-900 ${className}`} style={{ aspectRatio: '1/1', width: '100%', maxWidth: '500px', margin: '0 auto' }}>
      {/* Video element - hidden, used for stream */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-0 h-0 opacity-0 pointer-events-none"
        playsInline
        muted
        autoPlay
      />
      
      {/* Canvas - visible, shows video feed and QR detection */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ objectFit: 'cover' }}
      />

      {/* iOS Start Button Overlay */}
      {isIOS && hasPermission === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/95 backdrop-blur-sm">
          <div className="text-center p-8">
            <svg
              className="mx-auto h-16 w-16 text-brand-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-semibold text-white">Start Camera</h3>
            <p className="mt-2 text-sm text-white/40">
              Tap the button below to enable camera scanning
            </p>
            {debugInfo && (
              <p className="mt-2 text-xs text-brand-400 font-mono">{debugInfo}</p>
            )}
            <button
              onClick={startCamera}
              className="mt-6 inline-flex items-center rounded-lg bg-brand-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-brand-700"
            >
              📷 Start Camera
            </button>
          </div>
        </div>
      )}

      {/* Loading overlay - hide on iOS when button is showing */}
      {!isIOS && hasPermission === null && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="text-center text-white">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-white"></div>
            <p className="mt-4 text-sm">Requesting camera access...</p>
            {debugInfo && (
              <p className="mt-2 text-xs font-mono opacity-70">{debugInfo}</p>
            )}
          </div>
        </div>
      )}

      {/* Scanning indicator */}
      {isScanning && (
        <>
          <div className="absolute top-4 right-4 flex items-center gap-2 rounded bg-green-500 px-3 py-1 text-sm font-medium text-white shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-white/[0.03]"></span>
            </span>
            Scanning...
          </div>
          
          {/* Scanning frame indicator */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute inset-8 border-4 border-white/30 rounded-lg">
              <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-white rounded-tl-lg"></div>
              <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-white rounded-tr-lg"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-white rounded-bl-lg"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-white rounded-br-lg"></div>
            </div>
          </div>
        </>
      )}

      {/* Instructions overlay */}
      {isScanning && (
        <div className="absolute bottom-4 left-4 right-4 space-y-2">
          <div className="rounded-lg bg-black/70 p-3 text-center backdrop-blur-sm">
            <p className="text-sm font-medium text-white">
              Point camera at QR code to scan
            </p>
          </div>
          {debugInfo && (
            <div className="rounded-lg bg-brand-600/80 px-3 py-2 text-center backdrop-blur-sm">
              <p className="text-xs font-mono text-white">
                {debugInfo} | Frames: {frameCount}
              </p>
            </div>
          )}
          {/* Console Log Display */}
          {consoleLog.length > 0 && (
            <div className="rounded-lg bg-brand-700/90 px-2 py-2 backdrop-blur-sm">
              {consoleLog.map((log, i) => (
                <p key={i} className="text-xs font-mono text-white">
                  {log}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default CameraQRScanner
