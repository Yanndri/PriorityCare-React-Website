import { calculateReliefDemand, type ReliefRates, type ReliefStock } from './reliefDemand.ts'

export const RELIEF_REPORT_KEY = 'prioritycare.relief-report-draft.v1'
export type ReliefReportDraft = {
  date: string
  savedAt: string
  scope: string
  rates: ReliefRates
  rows: { centerId: string; centerName: string; people: number; households: number; stock: ReliefStock; source: string }[]
  excludedCenters: string[]
}
export function parseReliefReportDraft(value: string | null): ReliefReportDraft | null {
  if (!value) return null
  const draft = JSON.parse(value) as ReliefReportDraft
  if (!draft || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(`${draft.date}T00:00:00Z`))
    || new Date(`${draft.date}T00:00:00Z`).toISOString().slice(0,10)!==draft.date
    || !Number.isFinite(Date.parse(draft.savedAt)) || typeof draft.scope !== 'string'
    || !Array.isArray(draft.rows) || draft.rows.length === 0 || !Array.isArray(draft.excludedCenters)
    || draft.excludedCenters.some((name) => typeof name !== 'string')) throw new Error('The saved relief draft is invalid. Save a complete draft from the relief planner again.')
  const ids = new Set<string>()
  for (const row of draft.rows) {
    if (!row || typeof row.centerId !== 'string' || typeof row.centerName !== 'string' || typeof row.source !== 'string' || ids.has(row.centerId)) throw new Error('Relief draft contains invalid or duplicate facilities.')
    ids.add(row.centerId)
    calculateReliefDemand({ people: row.people, households: row.households }, draft.rates, row.stock)
  }
  return draft
}
