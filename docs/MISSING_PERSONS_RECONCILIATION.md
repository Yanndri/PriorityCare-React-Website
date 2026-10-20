# Missing persons manifest reconciliation

Apply `supabase/migrations/20261014_missing_person_reconciliation.sql` after `20261014_disaster_events.sql` (it reuses that migration's admin check and links reports to disaster events). The migration is transactional and repeatable. It adds the `missing_person_reports` table, a private audit table and guarded RPCs; it does not change resident, evacuation, SOS or account records.

Open **Missing Persons** in the admin sidebar.

## Two lists

- **Master Rescued Directory** — registered residents whose *latest* evacuation record (by `logged_at`) is `safely_evacuated`, with the evacuation center. A later `failed` or `in_transit` record removes someone from the directory.
- **Missing Persons Manifest** — open reports in `missing_person_reports`. A report can be linked to a registered resident or describe someone who is not registered (name, sex, approximate age, last-seen place and time, reporter, notes). It can optionally be linked to an active disaster event in the same barangay. A registered resident can have only one open report at a time.

## Reconciliation

Each open report is compared with every person in the rescued directory in the admin's scope:

| Result | Meaning |
| --- | --- |
| Confirmed in rescued directory | The report is linked to a registered resident who is safely evacuated. Confirm to close it. |
| Probable match (score ≥ 85) | Similar name (word order, accents, middle names, small typos tolerated) with agreeing sex and age. |
| Possible match (score 60–84) | Similar name, but sex or age is unknown or only roughly agrees. |
| Still missing | Nobody in the directory resembles the report. |

Different sex, or an age gap over 10 years, rules a candidate out. Scores are suggestions only. Nothing is closed automatically: an administrator presses **Confirm match**, and the server re-checks that the resident is still safely evacuated and in the same barangay. Reports can also be closed as **Found outside directory** (note required) or **Withdrawn** (reason required, e.g. duplicate). Closed reports, the actor and timestamps are retained with an audit trail. There is no delete.

**Unaccounted registered residents** lists residents of barangays with an active disaster event who are not in the rescued directory and have no open report. Use it to spot people nobody has reported yet.

**Export CSV** downloads the open manifest with best matches, closed reports, unaccounted residents and the rescued directory. Cells that start with `= + - @` are prefixed so spreadsheets do not run them as formulas.

## Access

Active admins see and change reports only for their assigned barangay; active super admins see all barangays. Residents, suspended users, admins without a barangay and anonymous clients are refused. Browser roles have no direct table access; all reads and writes go through the RPCs. The manifest refuses to load more than 5,000 reports (or 20,000 residents) rather than silently truncating; pagination is needed before then.

## Validation

```powershell
npm run build
node --test tests/rescue-reconciliation.test.mjs
node tests/missing-persons.mjs <PGlite-module-path-or-file-URL>
```

The SQL test runs against an isolated synthetic database: repeat migration, latest-record logic, filing and validation, duplicate open reports, confirm/found-elsewhere/withdraw, rescued-directory checks, own/cross-barangay scope, super admin, inactive/anonymous access, direct-table denial and audit rows.
