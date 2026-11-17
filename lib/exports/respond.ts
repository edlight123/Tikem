import { NextResponse } from 'next/server'
import { EXPORT_MIME, contentDisposition, exportFileName } from './fileName'
import { renderReportPdf } from './pdf'
import { renderXlsx } from './xlsx'
import type { ExportFormat, ExportReport } from './types'

/**
 * Render a report in the asked format and return it as a download with the
 * readable file name ("<title> – <label> – <day>.<ext>"). Server only.
 */
export async function exportResponse(
  report: ExportReport,
  format: ExportFormat,
  name: { title: string; label: string; day?: string }
): Promise<NextResponse> {
  const bytes = format === 'xlsx' ? await renderXlsx(report) : renderReportPdf(report)
  return fileResponse(bytes, format, exportFileName({ ...name, ext: format }))
}

export function fileResponse(bytes: Uint8Array | Buffer, format: ExportFormat, fileName: string): NextResponse {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': EXPORT_MIME[format],
      'Content-Disposition': contentDisposition(fileName),
      'Cache-Control': 'private, no-store',
    },
  })
}
