/**
 * Browser side of the exports: ask the server for the file and save it under
 * the name the server gave it ("Event – Sales audit – 2026-12-31.xlsx").
 * Client-safe (no renderer imports).
 */
import { fileNameFromDisposition } from './fileName'
import type { ExportFormat } from './types'

export async function downloadExport(url: string, init: RequestInit | undefined, fallbackName: string): Promise<void> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    let message = ''
    try {
      const data = await res.json()
      message = data?.message || data?.error || ''
    } catch {
      // not JSON
    }
    throw new Error(message || `Export failed (${res.status})`)
  }
  const blob = await res.blob()
  const name = fileNameFromDisposition(res.headers.get('content-disposition'), fallbackName)
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Give Safari a beat to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(href), 4000)
}

/** POST a table to the admin renderer and save the result. */
export function downloadAdminTable(format: ExportFormat, body: Record<string, unknown>, fallbackName: string): Promise<void> {
  return downloadExport(
    '/api/admin/exports/render',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, format }) },
    `${fallbackName}.${format}`
  )
}
