# Evacuation facility registration and maximum safe capacity

Review and apply `migrations/20261014_facility_registration.sql` before using registration or capacity saving. Existing centers are retained with unknown capacity; the old UI's invented default of 100 has been removed.

Go to Evacuation Centers → Register Facility. Enter a name, facility type, GPS coordinates, and an administrator-approved maximum safe capacity in people. Types match the project's existing enum: school, covered court, barangay hall, church, or other. Existing cards have Set Safe Capacity. The website records the approved value; it does not certify structural safety.

The RPCs require an authenticated active admin or super admin. Facilities are shared across sitios, so these admins manage the common inventory. Registrations with the same normalized name and exact GPS are rejected. Capacity saves reject stale edits and limits below current recorded occupancy, and add an audit record in `facility_capacity_audit`. These protections are enforced by the new functions. This migration does not change the pre-existing evacuation_centers table's RLS/policies or legacy direct-write paths.

The catalog counts each resident once using the latest evacuation record across the database and includes only safely_evacuated status. Resident names shown on the website remain restricted by the existing sitio filter. This is a record-based count, not a gate check-in/out system. Updates from other devices require refresh. Enforcing capacity during new admissions is a separate workflow; setting a limit does not prevent a legacy client from inserting extra admission records.

Existing records are not edited by the migration, and no capacity is guessed. New functions and metadata columns are created, and PostgREST is asked to reload its schema. The migration runs in a transaction.

Verification: production build, targeted lint, and `tests/facility-registration.mjs`, an isolated PGlite PostgreSQL test. It covers legacy unknown capacity, registration, duplicates, validation, edits, global latest-record occupancy, stale saves, audit records, and unauthorized callers. Run it with the temporary PGlite module URL as documented in `RESIDENT_EDITING.md`.
