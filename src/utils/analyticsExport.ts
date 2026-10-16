// Shared download helpers for the Disaster Analytics module exports.
// ExcelJS is already a project dependency (used by the DROMIC exports) and is
// imported only when a workbook is actually created.

export type ExportCell = string | number | null
export type ExportSheet = { name: string; headers: string[]; rows: ExportCell[][] }
export type ExportMeta = [label: string, value: string][]

export function downloadFile(content: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function fileStamp(iso = new Date().toISOString()) {
  return iso.replaceAll(':', '-').slice(0, 19)
}

export async function createTableWorkbook(title: string, meta: ExportMeta, sheets: ExportSheet[]) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'PriorityCare'
  book.created = new Date()
  for (const table of sheets) {
    const headerRow = meta.length + 3
    const sheet = book.addWorksheet(table.name.slice(0, 31), {
      views: [{ state: 'frozen', ySplit: headerRow, showGridLines: false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      headerFooter: { oddFooter: `PriorityCare | ${table.name} | Page &P of &N` },
    })
    sheet.columns = table.headers.map((header) => ({ width: Math.min(60, Math.max(14, header.length + 4)) }))
    sheet.getCell(1, 1).value = `PriorityCare — ${title}`
    sheet.getCell(1, 1).font = { size: 16, bold: true, color: { argb: 'FF183153' } }
    meta.forEach(([label, value], index) => {
      sheet.getCell(index + 2, 1).value = label
      sheet.getCell(index + 2, 1).font = { bold: true }
      sheet.getCell(index + 2, 2).value = value
    })
    const header = sheet.getRow(headerRow)
    header.values = table.headers
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF183153' } }
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.alignment = { wrapText: true, vertical: 'middle' }
    })
    if (!table.rows.length) sheet.addRow(['No records in this export.'])
    for (const values of table.rows) {
      // Literal strings stay strings: ExcelJS writes them as text, never formulas.
      const row = sheet.addRow(values)
      row.eachCell((cell) => { cell.alignment = { wrapText: true, vertical: 'top' } })
    }
    sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: table.headers.length } }
    sheet.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`
  }
  return new Uint8Array(await book.xlsx.writeBuffer())
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const CSV_TYPE = 'text/csv;charset=utf-8'
