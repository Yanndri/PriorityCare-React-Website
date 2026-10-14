# Disaster event declarations

Apply `supabase/migrations/20261014_disaster_events.sql` in the project's Supabase SQL editor before using this feature. The migration is transactional and repeatable. It adds new tables and guarded RPCs; it does not alter SOS, resident, evacuation, role, or account records.

Open **Disaster Events** in the website sidebar. Choose flood, fire, earthquake, or landslide; give the incident a name, affected sitio, location description, and onset time. Onset is entered in Philippine time (UTC+8) regardless of the browser's time zone. GPS coordinates and notes are optional. GPS requires both latitude and longitude. The server records declaration time and the authenticated actor.

Active admins can declare, list, and resolve events only for their assigned sitio. Active super admins are permitted all sitios through the RPCs. The existing Super Admin dashboard has its own interface; this change adds navigation to the normal admin dashboard. Residents, suspended users, admins without a sitio, and anonymous clients cannot access the register. Browser roles have no direct table access; server functions enforce these checks.

Distinct active incidents can coexist. A second active event with the same trimmed, case-insensitive name and hazard in the same sitio is rejected by a unique index. After resolution, the name can be reused for a later event. Resolving requires a reason and preserves the declaration, actor, timestamps, and private audit records. A repeated resolution is rejected to protect against stale submissions. There is no delete operation.

The **Geo Map** shows reference points for active events in the signed-in administrator's scope. Reopen the map to load the latest declarations. A point is not an affected-area boundary. Events without GPS remain in the register and are counted separately on the map. Read failures remain visible instead of appearing as an empty register.

Declarations do not notify responders, change VPI, dispatch teams, associate earlier SOS alerts or admissions, or establish official disaster attribution in RDANA/DROMIC exports. A future incident-linking workflow must explicitly associate those records. Multi-sitio incidents currently require separate declarations for each sitio. The register refuses to load more than 2,000 records rather than silently truncating history; pagination is needed before that limit is reached.

Validation:

```powershell
npm run build
npx eslint src/pages/DisasterEventsPage.tsx src/components/DisasterEventMarkers.tsx src/api/disasterEventsApi.ts
node tests/disaster-events.mjs <PGlite-module-path-or-file-URL>
```

The SQL test runs against an isolated synthetic database, including repeat migration, all four hazards, invalid input, same-name duplicate handling, own/cross-sitio access, inactive/anonymous access, direct-table denial, resolution and audit retention. It does not create incidents in the live project.
