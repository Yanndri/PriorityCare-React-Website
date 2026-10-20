// Exercises the same browser export builders with synthetic data; never uses live credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { buildDromicReport } from '../src/utils/dromicReport.ts'
import { createDromicWorkbook, createDromicPdf } from '../src/utils/dromicFiles.ts'
import { parseReliefReportDraft } from '../src/utils/reliefReportDraft.ts'

const out=process.argv[2]
if(!out)throw new Error('Pass a temporary QA output directory.')
await fs.mkdir(out,{recursive:true})
const ok=(data)=>({available:true,data})
const data={
  window:{hours:24,start:'2026-10-13T04:00:00Z',end:'2026-10-14T04:00:00Z'},scope:'Barangay Niño',fetchedAt:'2026-10-14T04:00:05Z',
  residents:[{uid:'a',birthdate:'1966-10-14',sex:'male',mobility_status:'non_ambulatory'},
    {uid:'b',birthdate:'2026-01-01',sex:'female',mobility_status:'ambulatory'}],
  profiles:ok([{resident_uid:'a',household_id:'family',is_pregnant:false,vulnerability_needs:'Wheelchair'},
    {resident_uid:'b',household_id:'family',is_pregnant:false,vulnerability_needs:''}]),
  disabilityResidents:ok(['a','a']),sos:ok([]),loggedEvacuations:ok([]),completedEvacuations:ok([]),
  shelters:ok([{center_id:1,center_name:'Niño Covered Court',status:'active',capacity:20,occupied:12},
    {center_id:2,center_name:'Closed Hall',status:'closed',capacity:100,occupied:0},
    {center_id:3,center_name:'Capacity pending',status:'active',capacity:null,occupied:2}]),
}
const relief={date:'2026-10-14',savedAt:data.fetchedAt,scope:'Selected shared facilities',
  rates:{ffpPerHousehold:1,waterPerPerson:2.5,kitsPerHousehold:0.2},
  rows:[{centerId:'1',centerName:'Niño Covered Court',people:101,households:20,stock:{ffps:5,waterLiters:100,hygieneKits:1},source:'Manual planning population'},
    {centerId:'4',centerName:'=1+1',people:7,households:2,stock:{ffps:0,waterLiters:0,hygieneKits:0},source:'Current recorded occupancy'}],excludedCenters:['Closed Hall']}
assert.equal(parseReliefReportDraft(null),null)
assert.throws(()=>parseReliefReportDraft(JSON.stringify({...relief,date:'2026-02-30'})))
assert.throws(()=>parseReliefReportDraft(JSON.stringify({...relief,rows:[relief.rows[0],relief.rows[0]]})),/duplicate/)
const report=buildDromicReport(data,'Assessment notes for demonstration only. '.repeat(35),relief)
assert.deepEqual(report.tables[3].rows.at(-1),['TOTAL PLANNED REQUEST','','',17,171,4])
assert.equal(report.tables[1].rows[1][1],1)
assert.equal(report.tables[2].rows[2][2],'Not set')
const book=await createDromicWorkbook(report)
await book.xlsx.writeFile(path.join(out,'dromic-sample.xlsx'))
const reopened=new ExcelJS.Workbook()
await reopened.xlsx.readFile(path.join(out,'dromic-sample.xlsx'))
assert.deepEqual(reopened.worksheets.map((sheet)=>sheet.name),['Summary','Population','Shelters','Relief'])
assert.ok(reopened.getWorksheet('Summary').getCell('B3').value instanceof Date)
assert.equal(typeof reopened.getWorksheet('Population').getCell('B8').value,'number')
const sheet=reopened.getWorksheet('Relief')
assert.equal(sheet.getCell('D8').value.result,15)
assert.equal(sheet.getCell('E8').value.result,153)
assert.equal(sheet.getCell('F8').value.result,3)
assert.equal(sheet.getCell('D10').value.result,17)
assert.equal(sheet.getCell('E10').value.result,171)
assert.equal(sheet.getCell('A9').type,ExcelJS.ValueType.String)
assert.equal(sheet.getCell('A9').value,'=1+1')
assert.ok(sheet.getCell('D8').value.formula)
const missing=buildDromicReport({...data,shelters:{available:false,reason:'Denied'},profiles:{available:false,reason:'Denied'}},'',null)
assert.equal(missing.tables[3].rows[0][1],'Not available')
assert.equal(missing.tables[2].rows[0][0],'Not available')
const withoutRelief=await createDromicWorkbook(missing)
assert.equal(withoutRelief.getWorksheet('Relief').getCell('B8').value,'Not available')
const font=(await fs.readFile(new URL('../src/assets/fonts/NotoSans-Regular.ttf',import.meta.url))).toString('base64')
const pdf=await createDromicPdf(report,font)
assert.ok(pdf.getNumberOfPages()>=4)
await fs.writeFile(path.join(out,'dromic-sample.pdf'),new Uint8Array(pdf.output('arraybuffer')))
await fs.writeFile(path.join(out,'sample-model.json'),JSON.stringify(report,null,2))
console.log('PASS: typed XLSX round trip, cached formulas/totals, literal text safety, missing data, date values, household deduplication, relief snapshot validation, multipage PDF')
console.log(`QA outputs: ${out}`)
