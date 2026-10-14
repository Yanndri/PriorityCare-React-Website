import type { DromicReport, ReportTable } from './dromicReport'
import { calculateReliefDemand } from './reliefDemand.ts'

export async function createDromicWorkbook(report: DromicReport) {
  const { default: ExcelJS } = await import('exceljs')
  const book = new ExcelJS.Workbook()
  book.creator = 'PriorityCare'; book.created = new Date(report.generatedAt)
  book.calcProperties.fullCalcOnLoad = true
  for (const table of report.tables) {
    const sheet = book.addWorksheet(table.name, { views: [{ state: 'frozen', ySplit: 7, showGridLines:false }],
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
      headerFooter: { oddFooter: 'PriorityCare DRAFT | Page &P of &N' } })
    sheet.columns = table.headers.map((_, index) => ({ width: index === 0 ? 44 : table.name === 'Population' || table.name === 'Summary' ? (index === 1 ? 24 : 75) : 22 }))
    sheet.mergeCells(1,1,1,table.headers.length); sheet.getCell('A1').value = `PriorityCare / ${table.name}`
    sheet.getCell('A1').font = { name: 'Calibri', size: 18, bold: true, color: { argb: 'FF183153' } }; sheet.getRow(1).height = 30
    sheet.mergeCells(2,1,2,table.headers.length); sheet.getCell('A2').value = 'DROMIC-style prototype DRAFT - not an official DSWD form'
    sheet.getCell('A2').font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF92400E' } }
    for (const [row, label, value] of [[3,'Period start (UTC)',report.start],[4,'Period end (UTC)',report.end],[5,'Retrieved (UTC)',report.generatedAt]] as const) {
      sheet.getCell(row,1).value=label; sheet.getCell(row,2).value=new Date(value); sheet.getCell(row,2).numFmt='yyyy-mm-dd hh:mm:ss'
      sheet.getColumn(2).width=Math.max(sheet.getColumn(2).width ?? 22, 24)
    }
    sheet.mergeCells(6,1,6,table.headers.length); sheet.getCell('A6').value=table.scope
    sheet.getCell('A6').alignment={ wrapText:true, vertical:'top' }; sheet.getRow(6).height=45
    const header=sheet.getRow(7); header.values=table.headers; header.height=32
    header.eachCell((cell)=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF183153'}};cell.font={name:'Calibri',bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true,vertical:'middle'}})
    for (const values of table.rows) {
      // Long manual notes continue on subsequent rows rather than clipping at Excel's height limit.
      const parts=values.map((value)=>typeof value==='string' ? value.split('\n').flatMap((line)=>line.match(/[\s\S]{1,160}/g) ?? ['']) : [value])
      for(let part=0;part<Math.max(...parts.map((value)=>value.length));part++) {
        const row=sheet.addRow(parts.map((value)=>value[part] === '' || value[part] === undefined ? null : value[part]))
        let lineCount=1
        row.eachCell((cell,col)=>{
          const text=String(cell.value ?? '')
          lineCount=Math.max(lineCount,...text.split('\n').map((line)=>Math.ceil(line.length / Math.max(8,(sheet.getColumn(col).width ?? 20)-2))))
          cell.font={name:'Calibri',size:11};cell.alignment={wrapText:true,vertical:'top'}
          if(typeof cell.value==='number')cell.numFmt='#,##0'
          if(row.number%2===0)cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F5FA'}}
        })
        row.height=Math.min(400,Math.max(34,(lineCount+1)*15))
      }
    }
    sheet.autoFilter={from:{row:7,column:1},to:{row:7,column:table.headers.length}}
    sheet.pageSetup.printTitlesRow='1:7'
    sheet.pageSetup.printArea=`A1:${sheet.getColumn(table.headers.length).letter}${sheet.rowCount}`
  }
  if (report.relief) {
    const table = book.getWorksheet('Relief')!
    // Use a separate visible calculation area below the exported request summary.
    const start = table.rowCount + 3
    table.getCell(start,1).value='Daily planning inputs (not distribution records)'
    for (const [offset,label,value] of [[1,'FFPs per household/day',report.relief.rates.ffpPerHousehold],[2,'Water L per person/day',report.relief.rates.waterPerPerson],[3,'Kits per household/day',report.relief.rates.kitsPerHousehold]] as const) {
      table.getCell(start+offset,1).value=label; table.getCell(start+offset,2).value=value; table.getCell(start+offset,2).numFmt='0.000'
    }
    const heading=start+5
    table.getRow(heading).values=['Facility','People','Households','FFP stock','Water L stock','Kit stock','Gross FFPs','Gross water L','Gross kits','Request FFPs','Request water L','Request kits']
    table.getRow(heading).height=34
    table.getRow(heading).eachCell((cell)=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF183153'}};cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.alignment={wrapText:true}})
    report.relief.rows.forEach((input,index)=>{
      const r=heading+1+index
      const {gross,request}=calculateReliefDemand({people:input.people,households:input.households},report.relief!.rates,input.stock)
      table.getRow(r).values=[input.centerName,input.people,input.households,input.stock.ffps,input.stock.waterLiters,input.stock.hygieneKits,
        {formula:`ROUNDUP(C${r}*ROUND($B$${start+1}*1000,0)/1000,0)`,result:gross.ffps},{formula:`ROUNDUP(B${r}*ROUND($B$${start+2}*1000,0)/1000,0)`,result:gross.waterLiters},{formula:`ROUNDUP(C${r}*ROUND($B$${start+3}*1000,0)/1000,0)`,result:gross.hygieneKits},
        {formula:`MAX(0,G${r}-D${r})`,result:request.ffps},{formula:`MAX(0,H${r}-E${r})`,result:request.waterLiters},{formula:`MAX(0,I${r}-F${r})`,result:request.hygieneKits}]
      table.getRow(r).height=40
      table.getRow(r).eachCell((cell)=>{cell.alignment={wrapText:true,vertical:'top'};cell.numFmt='#,##0'})
      for (const [summaryCol,calcCol,result] of [[4,'J',request.ffps],[5,'K',request.waterLiters],[6,'L',request.hygieneKits]] as const) table.getCell(8+index,summaryCol).value={formula:`${calcCol}${r}`,result}
    })
    const totalRow=8+report.relief.rows.length
    for (let col=4;col<=6;col++) {
      const letter=table.getColumn(col).letter
      table.getCell(totalRow,col).value={formula:`SUM(${letter}8:${letter}${totalRow-1})`,result:report.tables[3].rows.at(-1)![col-1] as number}
    }
    table.getColumn(1).width=36
    table.getColumn(2).width=16;table.getColumn(3).width=16
    for (let col=4;col<=12;col++)table.getColumn(col).width=14
    table.pageSetup.paperSize=5 // Legal landscape for the twelve-column calculation schedule.
    // The detailed calculation schedule prints separately, at readable width.
    table.addRow(['Population sources'])
    for(const input of report.relief.rows) {
      const row=table.addRow([input.centerName,input.source]);table.mergeCells(row.number,2,row.number,12)
      row.height=45;row.alignment={wrapText:true,vertical:'top'}
    }
    table.addRow(['Excluded facilities'])
    for(const name of report.relief.excludedCenters.length?report.relief.excludedCenters:['None']) {
      const row=table.addRow([name]);table.mergeCells(row.number,1,row.number,12);row.height=30;row.alignment={wrapText:true}
    }
    table.pageSetup.printArea=`A1:L${table.rowCount}`
  }
  return book
}

export async function createDromicPdf(report: DromicReport, fontBase64: string) {
  const [{jsPDF},{autoTable}]=await Promise.all([import('jspdf'),import('jspdf-autotable')])
  const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
  doc.addFileToVFS('NotoSans-Regular.ttf',fontBase64);doc.addFont('NotoSans-Regular.ttf','NotoSans','normal');doc.setFont('NotoSans')
  doc.setProperties({title:'PriorityCare DROMIC-style prototype draft',author:'PriorityCare'})
  const tables:ReportTable[]=report.tables.map((table)=>({...table,rows:[...table.rows]}))
  tables[0].rows.unshift(['Period start (UTC)',report.start,'Start inclusive'],['Period end (UTC)',report.end,'End exclusive'],['Retrieved (UTC)',report.generatedAt,'Current snapshots retrieved after window selection'])
  if(report.relief)tables[3].rows.push(['Actual relief distributions','Not recorded','','','',''])
  for(const [index,table] of tables.entries()) {
    if(index)doc.addPage()
    const widths=table.name==='Summary'?[70,65,134]:table.name==='Population'?[75,26,168]:table.name==='Shelters'?[90,35,45,45,54]:[80,28,34,42,43,42]
    const scopeLines=doc.splitTextToSize(table.scope,269)
    const top=Math.max(44,32+scopeLines.length*4+6)
    const drawHeader=()=>{
      doc.setFont('NotoSans','normal');doc.setTextColor(24,49,83);doc.setFontSize(17);doc.text(`PriorityCare / ${table.name}`,14,16)
      doc.setFontSize(9);doc.setTextColor(146,64,14);doc.text('DROMIC-style prototype DRAFT - not an official DSWD form',14,24)
      doc.setTextColor(65,75,90);doc.setFontSize(8.5);doc.text(scopeLines,14,32)
    }
    autoTable(doc,{head:[table.headers],body:table.name==='Summary'?table.rows.filter((row)=>row[0]!=='Incident notes'):table.rows,margin:{top,bottom:18,left:14,right:14},
      columnStyles:Object.fromEntries(widths.map((cellWidth,column)=>[column,{cellWidth}])),
      styles:{font:'NotoSans',fontStyle:'normal',fontSize:8.5,cellPadding:2.5,overflow:'linebreak'},
      headStyles:{fontStyle:'normal',fillColor:[24,49,83]},alternateRowStyles:{fillColor:[240,245,250]},
      rowPageBreak:'avoid',
      didDrawPage:drawHeader,
      didParseCell:(hook)=>{if(typeof hook.cell.raw==='number')hook.cell.styles.halign='right'},
    })
    if(table.name==='Summary'&&report.context.trim()) {
      const finalY=(doc as typeof doc & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY
      autoTable(doc,{startY:finalY+6,head:[['Administrator-provided incident notes (not independently verified)']],body:[[report.context]],
        margin:{top,bottom:18,left:14,right:14},styles:{font:'NotoSans',fontStyle:'normal',fontSize:8.5,cellPadding:3},
        headStyles:{fontStyle:'normal',fillColor:[24,49,83]},didDrawPage:drawHeader})
    }
  }
  const pages=doc.getNumberOfPages()
  for(let page=1;page<=pages;page++){doc.setPage(page);doc.setFontSize(8);doc.setTextColor(90);doc.text(`PriorityCare DRAFT | ${page} / ${pages} | Review scope and assessment gaps before distribution.`,14,201)}
  return doc
}
