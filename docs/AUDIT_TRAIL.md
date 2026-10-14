# Evacuation audit trail & operational timestamp log

Apply `supabase/migrations/20261014_operational_audit_trail.sql` after the disaster-events, facility and missing-persons migrations. It adds `evacuation_record_audit`, a trigger on `evacuation_records`, and the read-only `get_operational_timeline(from, to)` RPC. Existing rows are not changed.

Open **Reports → Evacuation Audit Trail & Operational Timestamp Log**, choose a date range (Philippine time, inclusive), and **Load log**. Filter by category, sitio (or facility-wide only) and free-text search, then download **CSV**, **PDF** or **Excel**. Exports contain every event matching the filters; the on-screen preview shows the first 200.

| Category | Source | Who ("By") |
| --- | --- | --- |
| Evacuation status | each `evacuation_records` row, with the previous status for that resident | signed-in user who entered it (from the trigger), else the assigned rescuer |
| Evacuation record edit/delete | `evacuation_record_audit` (trigger) | signed-in user; service-role/SQL edits say so |
| Evacuation center | `facility_status_audit`, `facility_capacity_audit` | admin who changed it |
| Disaster event | `disaster_event_audit` | admin who declared/resolved |
| Missing person | `missing_person_report_audit` | admin who filed/closed |
| Verification | `verification_documents` upload + review | resident / reviewer |
| SOS alert | `sos_alerts.created_at` | the resident |

Limits: edits/deletions of evacuation records and "entered by" exist only from when the trigger was installed; earlier edits cannot be recovered. SOS alerts store only their creation time. "Not recorded" means the source stores no actor.

Access: admins see their assigned sitio plus facility-wide center changes; super admins see everything. Ranges are limited to one year and 20,000 events. Browser roles cannot read the audit table directly.

Excel has a Summary sheet (scope, range, filters, counts per category) and a Timeline sheet with PHT text and real UTC date cells, frozen header and filters. PDF is landscape A4 with the bundled Noto Sans font. CSV cells starting with `= + - @` are prefixed to prevent formula injection.

Validation:

```powershell
npm run build
node --test tests/audit-trail-utils.test.mjs
node tests/audit-trail.mjs <PGlite-module-path-or-file-URL>
```
