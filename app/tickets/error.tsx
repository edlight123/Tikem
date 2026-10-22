'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'

export default function TicketsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('My Tickets page error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white/[0.055] rounded-2xl p-8 text-center">
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 bg-red-500/15 rounded flex items-center justify-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
        </div>

        <h1 className="font-display lowercase !text-[26px] !leading-tight text-white mb-3">
          We couldn&apos;t load your tickets
        </h1>

        <p className="text-white/70 mb-6">
          Something went wrong while loading your tickets. This is usually a
          temporary network issue, please try again in a moment.
        </p>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={reset}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-white text-black font-semibold rounded hover:bg-white/90 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>

          <Link
            href="/"
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-white/[0.07] text-white rounded hover:bg-white/[0.12] transition-colors"
          >
            <Home className="w-4 h-4" />
            Go Home
          </Link>
        </div>
      </div>
    </div>
  )
}
