'use client'

import { useState } from 'react'
import { Check, Link2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * A ticket link the organizer shares by hand (a guest with no email, or a
 * ticket email that did not go out). `full` shows the link itself above the
 * button; otherwise it is a compact copy action for a table row.
 */
export function CopyTicketLink({ url, full = false }: { url: string; full?: boolean }) {
  const { t } = useTranslation('organizer')
  const [copied, setCopied] = useState(false)

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard blocked (http, old WebView): select the text so it can be copied by hand.
      const input = document.getElementById(`ticket-link-${url}`) as HTMLInputElement | null
      input?.select()
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const button = (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded bg-white/[0.08] px-2.5 py-1.5 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.14] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Link2 className="h-3.5 w-3.5" />}
      {copied ? t('event_tools.link_copied') : t('event_tools.copy_ticket_link')}
    </button>
  )

  if (!full) return button

  return (
    <div className="space-y-2">
      <input
        id={`ticket-link-${url}`}
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded bg-black/30 px-3 py-2.5 font-mono text-xs text-white/80 focus:outline-none focus:ring-2 focus:ring-brand-500/60"
      />
      {button}
    </div>
  )
}
