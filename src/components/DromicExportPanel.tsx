import { useState } from 'react'
import { fetchRdanaData } from '../api/rdanaApi'
import { buildDromicReport, type DromicReport } from '../utils/dromicReport'
import { parseReliefReportDraft, RELIEF_REPORT_KEY } from '../utils/reliefReportDraft'

export function DromicExportPanel() {
  const [hours,setHours]=useState<24|48>(24)
  const [context,setContext]=useState('')
  const [attach,setAttach]=useState(true)
  const [report,setReport]=useState<DromicReport|null>(null)
  const [reviewed,setReviewed]=useState(false)
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')
  const [notice,setNotice]=useState('')
  function reset(){setReport(null);setReviewed(false);setNotice('');setError('')}
  async function generate(){
    if(busy)return
    setBusy('Preparing report…');setError('');setNotice('');setReport(null);setReviewed(false)
    try {
      let relief=null
      if(attach) {
        try {relief=parseReliefReportDraft(sessionStorage.getItem(RELIEF_REPORT_KEY))}
        catch {throw new Error('The saved relief draft could not be read. Save it again in Evacuation Centers, or uncheck the relief attachment.')}
      }
      const data=await fetchRdanaData(hours)
      setReport(buildDromicReport(data,context,relief))
      if(!relief)setNotice('No relief-planning draft attached. Relief quantities will be marked Not available, and actual distributions Not recorded.')
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to prepare report.')}
    finally{setBusy('')}
  }
  async function download(format:'pdf'|'xlsx'){
    if(!report||!reviewed||busy)return
    setBusy(`Creating ${format.toUpperCase()}…`);setError('')
    try {
      const {createDromicWorkbook,createDromicPdf}=await import('../utils/dromicFiles')
      let bytes:Uint8Array
      if(format==='xlsx'){
        const workbook=await createDromicWorkbook(report)
        bytes=new Uint8Array(await workbook.xlsx.writeBuffer())
      }else{
        const {default:fontUrl}=await import('../assets/fonts/NotoSans-Regular.ttf?url')
        const response=await fetch(fontUrl)
        if(!response.ok)throw new Error('PDF font could not load. Try again, or download Excel.')
        const font=new Uint8Array(await response.arrayBuffer())
        let binary=''
        for(let index=0;index<font.length;index+=8192)binary+=String.fromCharCode(...font.subarray(index,index+8192))
        const pdf=await createDromicPdf(report,btoa(binary))
        bytes=new Uint8Array(pdf.output('arraybuffer'))
      }
      const url=URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>],{type:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}))
      const link=document.createElement('a');link.href=url;link.download=`prioritycare-DROMIC-style-DRAFT-${report.end.replaceAll(':','-').slice(0,19)}.${format}`
      document.body.appendChild(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000)
      setNotice(`${format.toUpperCase()} draft downloaded. No report was submitted and no stock was changed.`)
    }catch(reason){setError(reason instanceof Error?reason.message:'Export failed. Try again.')}
    finally{setBusy('')}
  }
  return <section className="panel rdana-panel">
    <div className="section-header"><div><span className="panel-kicker">POPULATION & RELIEF EXPORTS</span><h3>DROMIC-style PDF / Excel Reports</h3></div><span>Prototype draft</span></div>
    <p>Export a population, shelter, and relief-planning report. An official DSWD-DROMIC template has not been supplied, so this layout is a prototype draft.</p>
    <fieldset className="resident-edit-fields" disabled={Boolean(busy)}><div className="edit-form-grid">
      <label><span>Activity reporting window</span><select value={hours} onChange={(e)=>{setHours(Number(e.target.value) as 24|48);reset()}}><option value={24}>Last 24 hours</option><option value={48}>Last 48 hours</option></select></label>
    </div><label className="resident-notes">Incident / assessment notes (optional)<textarea maxLength={2000} value={context} onChange={(e)=>{setContext(e.target.value);reset()}} placeholder="Use aggregate assessment notes. Do not enter personal identifiers."/></label>
      <label className="resident-check"><input type="checkbox" checked={attach} onChange={(e)=>{setAttach(e.target.checked);reset()}}/><span>Attach the latest relief draft saved for Reports in this browser tab</span></label>
      <p>Save a complete draft using Evacuation Centers → Relief requisition demand → Save Draft for Reports. Its planning date and facility scope are shown separately from this report’s population scope.</p>
      <button type="button" className="verify-button" onClick={()=>void generate()}>Prepare Export Preview</button>
    </fieldset>
    {busy&&<p role="status">{busy}</p>}{error&&<p role="alert" className="dashboard-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {report&&<>
      <p><strong>Population scope:</strong> {report.scope}. <strong>Shared shelter scope:</strong> all barangays. Retrieved {new Date(report.generatedAt).toLocaleString('en-PH',{timeZone:'Asia/Manila'})} (Asia/Manila).</p>
      {report.relief&&<p><strong>Attached relief planning date:</strong> {report.relief.date}; {report.relief.rows.length} selected facilities. These are requisition estimates, not distributions.</p>}
      {report.tables.map((table)=><details className="relief-facility" key={table.name}><summary>{table.name} preview</summary><p>{table.scope}</p><div className="relief-table-wrap"><table className="relief-table"><thead><tr>{table.headers.map((header)=><th key={header}>{header}</th>)}</tr></thead><tbody>{table.rows.map((row,index)=><tr key={index}>{row.map((cell,col)=><td key={col}>{cell}</td>)}</tr>)}</tbody></table></div></details>)}
      <label className="resident-check"><input disabled={Boolean(busy)} type="checkbox" checked={reviewed} onChange={(e)=>setReviewed(e.target.checked)}/><span>I reviewed the scope, planning date, figures, and missing assessments. This is a prototype draft.</span></label>
      <div className="request-modal-actions"><button type="button" className="secondary-button" disabled={!reviewed||Boolean(busy)} onClick={()=>void download('pdf')}>Download PDF</button><button type="button" className="verify-button" disabled={!reviewed||Boolean(busy)} onClick={()=>void download('xlsx')}>Download Excel (.xlsx)</button></div>
    </>}
  </section>
}
