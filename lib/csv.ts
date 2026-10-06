/**
 * One CSV cell encoder for every export, server or browser.
 *
 * Two problems it closes:
 * - Quoting. A cell is always wrapped in double quotes with inner quotes
 *   doubled, so a comma, quote or newline in a buyer's name cannot shift columns.
 * - Formula injection. A spreadsheet treats a cell starting with = + - @ (or a
 *   tab / carriage return) as a formula, so a buyer named `=HYPERLINK(...)`
 *   would execute in the organizer's Excel. Such cells get a leading
 *   apostrophe. Plain numbers (including negatives like -12.50) are left alone
 *   so financial columns stay numeric.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'
  let text = typeof value === 'string' ? value : String(value)
  if (typeof value !== 'number' && FORMULA_LEAD.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`
  }
  return `"${text.replace(/"/g, '""')}"`
}

export function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(',')
}

/** Rows joined with CRLF, the line ending RFC 4180 and Excel expect. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvRow).join('\r\n')
}
