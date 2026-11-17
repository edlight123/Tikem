/**
 * @jest-environment node
 *
 * The shared exports (lib/exports): Excel + PDF replaced CSV everywhere
 * (owner, 2026-11-16). What must hold:
 *   - a user string is never a formula (the CSV-era injection guard);
 *   - figures and dates are real typed cells, so the sheet sorts and sums;
 *   - the only formulas are our own SUBTOTAL totals;
 *   - the file names keep accents and carry an ASCII fallback.
 */
import ExcelJS from 'exceljs'
import { renderXlsx } from '@/lib/exports/xlsx'
import { renderReportPdf } from '@/lib/exports/pdf'
import { EXPORT_LABELS } from '@/lib/exports/labels'
import { contentDisposition, exportFileName, fileNameFromDisposition, parseExportFormat } from '@/lib/exports/fileName'
import { safeText } from '@/lib/exports/cells'
import type { ExportReport } from '@/lib/exports/types'

function report(rows: Record<string, any>[]): ExportReport {
  return {
    title: 'Konpa Lakay – Fèt Kreyòl',
    reportLabel: 'Sales audit',
    subtitle: ['Saturday 31 December 2026', 'Pétion-Ville'],
    organizerName: 'Lakou Mizik',
    stats: [{ label: 'Tickets', value: String(rows.length) }],
    sections: [
      {
        name: 'Tickets',
        totals: true,
        columns: [
          { key: 'name', header: 'Name' },
          { key: 'status', header: 'Status', kind: 'status' },
          { key: 'price', header: 'Price', kind: 'money', currency: 'HTG', total: true },
          { key: 'when', header: 'Purchased', kind: 'datetime' },
        ],
        rows,
      },
    ],
    locale: 'fr-FR',
    timeZone: 'America/Port-au-Prince',
    labels: EXPORT_LABELS.fr,
  }
}

async function load(buf: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as any)
  return wb
}

describe('renderXlsx', () => {
  const rows = [
    { name: '=HYPERLINK("http://evil","x")', status: { label: 'Valide', tone: 'positive' }, price: 1500, when: '2026-10-01T15:00:00Z' },
    { name: '+cmd|calc', status: { label: 'Remboursé', tone: 'negative' }, price: 2500.5, when: new Date('2026-10-02T03:30:00Z') },
    { name: 'Wòlguens\u0000 Célestin', status: { label: 'Valide', tone: 'positive' }, price: '-12.50', when: null },
  ]

  it('writes user strings as strings, never formulas', async () => {
    const wb = await load(await renderXlsx(report(rows)))
    const ws = wb.worksheets[0]
    const formulas: string[] = []
    let evil: ExcelJS.Cell | null = null
    ws.eachRow((row) =>
      row.eachCell((c) => {
        if (c.type === ExcelJS.ValueType.Formula) formulas.push(String((c.value as any).formula))
        if (c.value === '=HYPERLINK("http://evil","x")') evil = c
      })
    )
    expect(evil).not.toBeNull()
    expect(evil!.type).toBe(ExcelJS.ValueType.String)
    // Only our own totals formula.
    expect(formulas).toHaveLength(1)
    expect(formulas[0]).toMatch(/^SUBTOTAL\(109,C\d+:C\d+\)$/)
  })

  it('types figures and dates, freezes the header and filters', async () => {
    const wb = await load(await renderXlsx(report(rows)))
    const ws = wb.worksheets[0]
    let header = 0
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'Name' && row.getCell(3).value === 'Price') header = n
    })
    expect(header).toBeGreaterThan(0)
    const first = ws.getRow(header + 1)
    expect(first.getCell(3).value).toBe(1500)
    expect(first.getCell(3).numFmt).toContain('HTG')
    expect(first.getCell(4).value).toBeInstanceOf(Date)
    // 15:00Z is 11:00 on the Port-au-Prince wall clock (EDT, UTC-4).
    expect((first.getCell(4).value as Date).getUTCHours()).toBe(11)
    expect(ws.getRow(header + 3).getCell(3).value).toBe(-12.5)
    expect(ws.getRow(header + 3).getCell(1).value).toBe('Wòlguens Célestin')
    expect((ws.views[0] as any).state).toBe('frozen')
    expect((ws.views[0] as any).ySplit).toBe(header)
    expect(ws.autoFilter).toBeTruthy()
    const total = ws.getRow(header + 4).getCell(3).value as any
    expect(total.result).toBe(3988)
    expect(wb.creator).toBe('Tikèm')
  })

  it('skips the total of a mixed-currency money column', async () => {
    const r = report([
      { name: 'a', price: { amount: 10, currency: 'USD' } },
      { name: 'b', price: { amount: 1000, currency: 'HTG' } },
    ])
    const wb = await load(await renderXlsx(r))
    let formulas = 0
    wb.worksheets[0].eachRow((row) => row.eachCell((c) => void (c.type === ExcelJS.ValueType.Formula && formulas++)))
    expect(formulas).toBe(0)
  })
})

describe('renderReportPdf', () => {
  it('renders a multi-page PDF for a long table', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ name: `Fabienne Dorélien ${i}`, price: 1000 + i, when: '2026-10-01T15:00:00Z' }))
    const bytes = renderReportPdf(report(many))
    const text = Buffer.from(bytes).toString('latin1')
    expect(text.startsWith('%PDF')).toBe(true)
    expect((text.match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1)
  })
})

describe('file names', () => {
  it('keeps accents and gives an ASCII fallback', () => {
    const name = exportFileName({ title: 'Fèt Kreyòl: "2026"/Live', label: 'Participants', day: '2026-12-31', ext: 'xlsx' })
    expect(name).toBe('Fèt Kreyòl 2026 Live – Participants – 2026-12-31.xlsx')
    const cd = contentDisposition(name)
    expect(cd).toContain(`filename="Fet Kreyol 2026 Live - Participants - 2026-12-31.xlsx"`)
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent(name)}`)
    expect(fileNameFromDisposition(cd, 'x')).toBe(name)
  })

  it('parses formats and strips control characters', () => {
    expect(parseExportFormat('excel')).toBe('xlsx')
    expect(parseExportFormat('PDF')).toBe('pdf')
    expect(parseExportFormat('csv')).toBeNull()
    expect(safeText('a\u0001b\u000bc')).toBe('abc')
  })
})
