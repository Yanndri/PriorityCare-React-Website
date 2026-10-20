# Resident demographics, shared households, and vulnerability editing

Apply `migrations/20261014_resident_profile_editing.sql` in the project's Supabase SQL Editor before using the expanded Edit Resident form. Review the migration first. It creates two tables, access policies, and guarded PostgreSQL functions; it does not migrate or rewrite existing resident records. Existing accounts start without a household.

The form edits structured names, contact information, sex, full birthdate, GPS, emergency contacts, address, landmark, pregnancy, mobility, disability categories, and assistance notes. Verification, roles, account status, assigned barangay, and VPI are not changed by this save. Mobility uses the database's three actual enum values.

Create a household by editing a resident and entering a new household name. That resident becomes its head. Edit another resident in the same barangay and select the existing household to join it. Each account keeps its own resident details. Dependents without accounts are stored once in the shared household. Do not add registered residents as dependents. A head cannot leave its household through this form; head reassignment requires a separate future workflow.

All writes occur in one database transaction. A concurrent household or profile change prevents an outdated draft from overwriting it. Authenticated active admins can only edit residents in their assigned barangay; active super admins can edit across barangays. The new tables have RLS enabled and direct writes are not granted to browser roles.

No VPI formula was supplied, so this change does not calculate vulnerability scores. Household totals are not yet integrated into shelter occupancy or statutory reports. Do not sum dependent counts across linked accounts: the shared household must be counted once.

Validation performed: TypeScript/production build, ESLint on the new editor/API, and the isolated PostgreSQL integration suite in `tests/resident-profile-migration.mjs`. The test uses PGlite (https://pglite.dev/docs/api), synthetic accounts, and no live credentials. It checks migration repeatability, shared membership, head protection, invalid values, authorization, RLS, stale revisions, exact dates, preserved roles/verification, and rollback after a late failure. Passing this suite does not replace a smoke test against the real project's existing triggers and policies.

To run without adding a dependency to the application's package manifest (PowerShell from the repository):

```powershell
$testRuntimeDir = Join-Path $env:TEMP 'prioritycare-sql-tests'
npm install --prefix $testRuntimeDir --no-save --no-package-lock @electric-sql/pglite
$testModule = [Uri]::new((Join-Path $testRuntimeDir 'node_modules/@electric-sql/pglite/dist/index.js')).AbsoluteUri
node tests/resident-profile-migration.mjs $testModule
```
