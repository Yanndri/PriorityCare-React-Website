# Barangay catchments → designated shelters (Module 2.2)

Apply `supabase/migrations/20261017_sitio_shelter_catchments.sql` (after the disaster-events migration). It adds `barangay_shelter_plans` (one row per barangay), a private audit table, and two RPCs. Existing data is not changed.

**Evac Centers → Barangay → Designated Shelters**

- For each barangay choose a **primary shelter** and up to **3 alternates** in order (used when the primary is full or unreachable), plus an optional note (e.g. which puroks or which road). Save per barangay.
- Admins edit only their assigned barangay and can view the others; super admins edit all. Closed centers cannot be primary (they may stay listed as alternates). Each change is audited (previous and new plan, who, when).
- **Shelter load** table: for each shelter, which barangays use it as primary, the planned population (registered residents + listed household dependents of those barangays) versus its maximum safe capacity — *Within / Near (≥ 85 %) / Over capacity* or *Capacity not set*. This is a planning estimate, not current occupancy (use the center cards above for live occupancy).

**Geo Map**: each barangay with a plan is shown as a navy dot at its residents' average location, with a solid line to its primary shelter and dashed lines to alternates. Hover for the straight-line distance. These are not road routes. Barangays without resident GPS, or shelters without coordinates, are skipped.

There are no drawn barangay boundary polygons yet — that is Module 4.1 (app). When boundaries exist, the catchment centre can switch from the resident average to the boundary's centerpoint.

Mock data (`supabase/seed/mock_data.sql`) assigns Barangay 3 → San Isidro Elementary School (alt: Barangay 3 Covered Court) and Barangay 1 → Barangay 1 Barangay Hall (alt: Barangay San Roque Sports Complex).

Validation:

```powershell
npm run build
node --test tests/shelter-catchments.test.mjs
node tests/sitio-shelter-catchments.mjs <PGlite-module-path-or-file-URL>
```
