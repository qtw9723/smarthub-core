/**
 * Serializes a parsed workbook (array of sheets) into a plain-text string.
 * Each non-empty sheet becomes a header line followed by tab-separated rows.
 * Empty cells are preserved as empty strings between tabs (no fabrication).
 * Sheets with no non-empty rows are omitted from the output.
 * Irregular row lengths and null/undefined cells are handled gracefully.
 */
export function serializeWorkbook(sheets) {
  if (!Array.isArray(sheets) || sheets.length === 0) return ""
  const parts = []
  for (const sheet of sheets) {
    const text = serializeSheet(sheet)
    if (text) parts.push(text)
  }
  return parts.join("\n\n")
}

function serializeSheet(sheet) {
  if (!sheet || typeof sheet.name !== "string" || !Array.isArray(sheet.rows)) return ""
  const nonEmptyRows = sheet.rows.filter(
    (row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""),
  )
  if (nonEmptyRows.length === 0) return ""
  const header = `=== ${sheet.name} ===`
  const body = nonEmptyRows
    .map((row) => (Array.isArray(row) ? row : []).map((cell) => String(cell ?? "")).join("\t"))
    .join("\n")
  return `${header}\n${body}`
}
