# Cross-facility evacuee lookup for family reunification (Module 2.6)

Apply `supabase/migrations/20261017_family_reunification_lookup.sql` (after the disaster-events and missing-persons migrations). It is read-only over existing data and adds a private `reunification_lookup_audit` table plus three functions.

Open **Family Reunification** in the admin sidebar.

- **Search by name** (at least 2 letters; every word must match; case- and accent-insensitive, so `jose` finds `José`). Searches **all evacuation centers and the resident registry across every sitio** — families get separated across sitios, so this is intentionally not limited to the admin's own sitio.
- **Or pick an evacuation center** to list everyone currently sheltered there (optionally narrowed by name).
- Each result shows sex/age, home sitio, current status (Sheltered / In transit / Rescue pending / Not reached / No record), the center and since when, household, and a **Reported missing** flag when an open missing-person report exists.
- **View family** shows every registered household member and where each one is, warns when the family is split across centers or when members are not confirmed in a shelter, and lists the household's dependents who have no account (their location is unknown — check with the household head).

Location = the resident's latest evacuation record. Only `safely_evacuated` with a center counts as "in a shelter".

Privacy: results include only what is needed to reunite people — no contact numbers, addresses, GPS or medical details. Any active admin or super admin can search; residents, suspended users and anonymous clients cannot. Every search and household view is written to `reunification_lookup_audit` (who, what, when, result count), which browsers cannot read. Results are capped at 100.

Validation:

```powershell
npm run build
node tests/family-reunification.mjs <PGlite-module-path-or-file-URL>
```
