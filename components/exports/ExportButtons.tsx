'use client'

import { useState } from 'react'
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import type { ExportFormat } from '@/lib/exports/types'

/**
 * The one export control (owner, 2026-11-16: Excel + PDF everywhere, no CSV).
 * A filled, segmented pair: PDF | Excel. Each half fetches its own file and
 * saves it under the server's name; the half that's working shows a spinner.
 *
 * `variant="organizer"` sits on the dark organizer canvas; `variant="console"`
 * uses the admin Control Room tokens.
 */
export interface ExportButtonsProps {
  /** Starts the download for a format; reject to show `onError`. */
  onExport: (format: ExportFormat) => Promise<void>
  labels: { pdf: string; excel: string; group: string }
  variant?: 'organizer' | 'console'
  size?: 'md' | 'sm'
  disabled?: boolean
  onError?: (error: unknown) => void
  className?: string
}

export function ExportButtons({
  onExport,
  labels,
  variant = 'organizer',
  size = 'md',
  disabled = false,
  onError,
  className = '',
}: ExportButtonsProps) {
  const [busy, setBusy] = useState<ExportFormat | null>(null)

  const run = async (format: ExportFormat) => {
    if (busy) return
    setBusy(format)
    try {
      await onExport(format)
    } catch (e) {
      onError?.(e)
    } finally {
      setBusy(null)
    }
  }

  const isConsole = variant === 'console'
  const h = size === 'sm' ? 'h-9' : isConsole ? 'h-9' : 'h-11'
  const group = isConsole ? 'bg-console-raise' : 'bg-surface-raised'
  const btn = isConsole
    ? 'text-console-mut hover:text-console-text hover:bg-surface focus-visible:ring-console-mut text-meta'
    : 'text-fg-soft hover:text-fg hover:bg-surface-raised focus-visible:ring-brand-500 text-sm'
  const divider = isConsole ? 'bg-console-ground/70' : 'bg-scrim-light'

  const item = (format: ExportFormat, label: string, Icon: typeof FileText) => (
    <button
      type="button"
      onClick={() => run(format)}
      disabled={disabled || busy !== null}
      aria-busy={busy === format}
      className={`inline-flex ${h} items-center gap-2 px-3.5 font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50 ${btn}`}
    >
      {busy === format ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
      <span>{label}</span>
    </button>
  )

  return (
    <div role="group" aria-label={labels.group} className={`inline-flex shrink-0 items-stretch overflow-hidden rounded ${group} ${className}`}>
      {item('pdf', labels.pdf, FileText)}
      <span className={`w-px self-stretch ${divider}`} aria-hidden />
      {item('xlsx', labels.excel, FileSpreadsheet)}
    </div>
  )
}
