/**
 * Export file names, shared by every export route and the clients that save
 * them (web download, mobile share sheet).
 *
 * Shape: "Konpa Night 2026 – Sales audit – 2026-12-31.xlsx": the event's own
 * title (accents kept), a localized label and a day, so a folder of exports
 * sorts and reads at a glance. Only filesystem-illegal characters are
 * dropped. Content-Disposition carries the UTF-8 name in filename* and an
 * ASCII fallback in filename= for clients that ignore filename*.
 *
 * Client-safe: no server imports.
 */
import type { ExportFormat } from './types'

const ILLEGAL = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g

/** Drop characters a filesystem won't take; keep accents; cap the length. */
export function cleanFilePart(raw: unknown, max = 80): string {
  return String(raw ?? '')
    .normalize('NFC')
    .replace(ILLEGAL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
}

/** YYYY-MM-DD in a timezone (sortable, locale-neutral). */
export function isoDay(d: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || undefined,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
}

/** "<title> – <label> – <day>.<ext>", falling back to "Tikèm" for an empty title. */
export function exportFileName(opts: { title: string; label: string; day?: string; ext: ExportFormat }): string {
  const title = cleanFilePart(opts.title) || 'Tikèm'
  const parts = [title, cleanFilePart(opts.label, 40), cleanFilePart(opts.day || '', 20)].filter(Boolean)
  return `${parts.join(' – ')}.${opts.ext}`
}

/** An ASCII-only version of a file name for the plain filename= parameter. */
export function asciiFileName(fileName: string, fallback = 'export'): string {
  const ascii = fileName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]+/g, '')
    .replace(/["\\]/g, '')
    .trim()
  return ascii || fallback
}

export function contentDisposition(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1] || 'bin'
  return `attachment; filename="${asciiFileName(fileName, `export.${ext}`)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

/** The file name from a Content-Disposition header (RFC 6266), preferring filename*. */
export function fileNameFromDisposition(header: string | null | undefined, fallback: string): string {
  const h = header || ''
  let name = ''
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h)
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim())
    } catch {
      name = ''
    }
  }
  if (!name) {
    const plain = /filename\s*=\s*"([^"]+)"/.exec(h) || /filename\s*=\s*([^;]+)/.exec(h)
    name = plain ? plain[1].trim() : ''
  }
  name = name.replace(ILLEGAL, ' ').trim()
  return name || fallback
}

export function parseExportFormat(raw: string | null | undefined): ExportFormat | null {
  const v = String(raw || '').toLowerCase()
  if (v === 'xlsx' || v === 'excel') return 'xlsx'
  if (v === 'pdf') return 'pdf'
  return null
}
