# Closing and reopening evacuation facilities

Apply `20261014_facility_registration.sql` first, then `20261014_facility_lifecycle.sql`. The second migration adds lifecycle metadata, a private audit table, the status-change function, and a trigger that rejects admission records into closed facilities. Existing facilities start active; no evacuation records are rewritten.

On Evacuation Centers, choose Close Center, enter a reason, and confirm the action. The database requires an active admin or super admin. It blocks closure if any resident's latest record still points to this center with pending, in_transit, or safely_evacuated status. Transfers or genuine departures must be recorded by an appropriate workflow before closing; this form never marks residents departed or failed just to make closure possible.

Closing is reversible and retains the center, capacity, and evacuation history. The card records the reason and closure time; the audit table stores actor, old/new status, reason, and timestamp. Use Include closed centers to find closed facilities. Reopening requires a reviewed safe capacity and another reason. The audit retains earlier closure details even though current closure metadata is cleared on reopening.

The Home capacity totals and daily relief planner exclude closed centers. The admission trigger applies to other clients too, including legacy record inserts/updates. Historical records remain present. The migration doesn't redesign existing table permissions or implement gate checkout; those are separate workflows. Applications that previously wrote admission records into a closed center will now receive an error.

Validation: production build, targeted lint, and `tests/facility-lifecycle.mjs` in isolated PostgreSQL. Cases include close/reopen, metadata, pending/in-transit/occupied blockers, transfers, history preservation, admission rejection, missing capacity, reasons, stale status, audit, and unauthorized callers.
