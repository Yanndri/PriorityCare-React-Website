// Excel / PDF builders for the operational timestamp log. Loaded on demand (same libraries as DROMIC exports).
import {
  categoryCounts, formatPht, TIMELINE_HEADERS, timelineTableRows, type TimelineEvent,
} from './auditTrail.ts'

export type TimelineExportMeta = {
  scope: string
  from: string
  to: string
  generatedAt: string
  filters: string
}

const NAVY = 'FF183153'

export async function createTimelineWorkbook(events: TimelineEvent[], barangayName: (id: number) => string, meta: TimelineExportMeta) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'PriorityCare'
  book.created = new Date(meta.generatedAt)

  const summary = book.addWorksheet('Summary', { views: [{ showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  summary.columns = [{ width: 34 }, { width: 60 }]
  summary.getCell('A1').value = 'PriorityCare / Operational timestamp log'
  summary.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: NAVY } }
  const info: [string, string | number][] = [
    ['Scope', meta.scope],
    ['From (Philippine time)', formatPht(meta.from)],
    ['To (Philippine time, exclusive)', formatPht(meta.to)],
    ['Generated (Philippine time)', formatPht(meta.generatedAt)],
    ['Filters', meta.filters],
    ['Events exported', events.length],
  ]
  info.forEach(([k, v], i) => {
    summary.getCell(3 + i, 1).value = k
    summary.getCell(3 + i, 1).font = { bold: true }
    summary.getCell(3 + i, 2).value = v
  })
  const start = 4 + info.length
  summary.getRow(start).values = ['Category', 'Events']
  summary.getRow(start).eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } } })
  categoryCounts(events).forEach(([label, n], i) => { summary.getRow(start + 1 + i).values = [label, n] })
  summary.getCell(start + 9, 1).value = 'Notes'
  summary.getCell(start + 9, 1).font = { bold: true }
  summary.getCell(start + 10, 1).value = 'Evacuation record edits/deletions and "entered by" are captured only after the audit-trail migration was applied. SOS alerts record only their creation time. "Not recorded" means the source table stores no actor.'
  summary.mergeCells(start + 10, 1, start + 10, 2)
  summary.getCell(start + 10, 1).alignment = { wrapText: true, vertical: 'top' }
  summary.getRow(start + 10).height = 48

  const sheet = book.addWorksheet('Timeline', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: 'PriorityCare operational log | Page &P of &N' },
  })
  const headers = [...TIMELINE_HEADERS.slice(0, 1), 'Time (UTC)', ...TIMELINE_HEADERS.slice(1)]
  sheet.columns = [20, 20, 22, 30, 24, 18, 16, 18, 22, 12, 60, 38].map(width => ({ width }))
  const header = sheet.getRow(1)
  header.values = headers
  header.height = 22
  header.eachCell(c => { c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }; c.alignment = { vertical: 'middle' } })
  const rows = timelineTableRows(events, barangayName)
  rows.forEach((r, i) => {
    const row = sheet.addRow([r[0], new Date(events[i].occurred_at), ...r.slice(1)])
    row.getCell(2).numFmt = 'yyyy-mm-dd hh:mm:ss'
    row.eachCell(c => { c.alignment = { wrapText: true, vertical: 'top' } })
    if (i % 2) row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F5FA' } } })
  })
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } }
  sheet.pageSetup.printTitlesRow = '1:1'
  return book
}

export async function createTimelinePdf(events: TimelineEvent[], barangayName: (id: number) => string, meta: TimelineExportMeta, fontBase64: string) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  doc.addFileToVFS('NotoSans-Regular.ttf', fontBase64)
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
  doc.setFont('NotoSans')
  doc.setProperties({ title: 'PriorityCare operational timestamp log', author: 'PriorityCare' })
  const subtitle = `${meta.scope} · ${formatPht(meta.from)} to ${formatPht(meta.to)} PHT (end exclusive) · Generated ${formatPht(meta.generatedAt)} PHT · ${events.length} events`
  const filterLines = doc.splitTextToSize(`Filters: ${meta.filters}`, 269)
  const top = 30 + filterLines.length * 4
  const drawHeader = () => {
    doc.setFont('NotoSans', 'normal')
    doc.setTextColor(24, 49, 83); doc.setFontSize(15); doc.text('PriorityCare / Operational timestamp log', 14, 14)
    doc.setTextColor(65, 75, 90); doc.setFontSize(8.5); doc.text(subtitle, 14, 21)
    doc.text(filterLines, 14, 26)
  }
  // Reference IDs are left to the Excel/CSV exports to keep the PDF readable.
  const head = [TIMELINE_HEADERS.slice(0, 10)]
  const body = timelineTableRows(events, barangayName).map(r => r.slice(0, 10))
  autoTable(doc, {
    head, body: body.length ? body : [['No events match the selected filters.', '', '', '', '', '', '', '', '', '']],
    margin: { top, bottom: 14, left: 10, right: 10 },
    columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 24 }, 2: { cellWidth: 32 }, 3: { cellWidth: 28 }, 4: { cellWidth: 20 },
      5: { cellWidth: 20 }, 6: { cellWidth: 20 }, 7: { cellWidth: 26 }, 8: { cellWidth: 16 }, 9: { cellWidth: 65 } },
    styles: { font: 'NotoSans', fontStyle: 'normal', fontSize: 7, cellPadding: 1.5, overflow: 'linebreak' },
    headStyles: { fontStyle: 'normal', fillColor: [24, 49, 83] },
    alternateRowStyles: { fillColor: [240, 245, 250] },
    didDrawPage: () => {
      drawHeader()
      doc.setFontSize(8); doc.setTextColor(100, 116, 139)
      doc.text(`Page ${doc.getNumberOfPages()}`, 287, 203, { align: 'right' })
    },
  })
  return doc
}
