# PriorityCare

PriorityCare is a web dashboard for disaster preparedness and response at the barangay level. Administrators use it to verify residents, map vulnerable households, declare disaster events, manage evacuation centers, and draft situation reports.

The frontend is built with React, TypeScript, and Vite, and uses Supabase for authentication and data. Privileged Super Admin operations (creating staff and responder accounts) run in the `super-admin` Supabase Edge Function, so no separate server is needed.

> **Prototype notice:** Scoring (VPI) and the RDANA summaries are for demonstration only. They are **not** validated for real triage, rescue ordering, or official DSWD submissions. The docs in [`docs/`](docs/) cover the details.

## Features

| Area | What it does |
| --- | --- |
| **Home** | Resident stats, alerts, operations overview, and the prototype **Vulnerability Priority Index (VPI)** |
| **Verification** | Review and verify pending resident registrations; edit resident profiles |
| **Geo Map** | Leaflet map of residents, active disaster events, and weather (OpenWeather) |
| **Disaster Events** | Declare and resolve flood, fire, earthquake, and landslide events for a barangay |
| **Reports** | 24/48-hour RDANA situation-summary drafts and the evacuation audit trail |
| **Data Mining** | Analytics charts over resident data |
| **Evac Centers** | Register facilities, manage their lifecycle, and set each barangay's shelter |
| **Super Admin** | Create admin accounts and view a dashboard across all barangays |

## Project structure

```
src/
  api/          Supabase / backend API calls
  components/   Reusable UI (panels, forms, tables, sidebar)
  pages/        Top-level dashboard sections
  utils/        Pure logic: VPI, RDANA, audit trail
  lib/          Supabase client
supabase/
  migrations/   SQL migrations to apply in the Supabase SQL editor
  *.md          Notes for each migration
docs/           Feature documentation
tests/          Node test scripts
```

## Getting started

### Prerequisites

- Node.js 22.18 or later. The tests import `.ts` files directly, which needs Node's built-in type stripping.
- A Supabase project

### 1. Install and configure the frontend

```bash
npm install
```

Create `.env.local` in the project root. It is git-ignored.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-publishable-key
VITE_OPENWEATHER_API_KEY=your-openweather-key # optional, for Geo Map weather
```

Restart Vite after you change `.env.local`.

### 2. Apply database migrations

In the Supabase SQL editor, run the files in [`supabase/migrations/`](supabase/migrations/):

- `20261014_facility_registration.sql`
- `20261014_facility_lifecycle.sql`
- `20261014_resident_profile_editing.sql`
- `20261014_disaster_events.sql`

The barangay is the operational unit (scoping, maps, reports). Sitio is only a free-text address detail on residents and households. A database created before 2026-10-19 used `sitios`/`sitio_id`; bring it up to date with `20261019_01_sitio_to_barangay.sql`, then `20261019_02_seed_cordova_barangays.sql` (Cordova's 13 barangays with boundaries) and `20261019_03_security_rls.sql` (Row Level Security on the older tables).

`20261019_04_households_and_accounts.sql` makes household dependents real rows (`household_members`, `member_disabilities`), links every `users` row to a Supabase Auth login, and makes the `verification-docs` and `house-facades` buckets private (files live under `<user id>/...`; the web shows them through signed URLs). `20261019_05_resident_signup_and_test_logins.sql` adds resident sign-up (contact number + 6-digit PIN, through the `register-resident` Edge Function in `supabase/functions/`), the app's self-service RPCs (`get_my_profile`, `update_my_household`, `set_my_house_photo`, `submit_my_verification_document`) and test logins for every role. `20261019_06_sos_hazards_evacuation.sql` makes `sos_alerts` the app's SOS record (resident uuid, household, GPS, type, headcount, cancel reason; `raise_sos`, `cancel_my_sos`, `get_my_sos`), adds `hazard_reports` (`report_hazard`, `review_hazard`), lets evacuation records cover household members and walk-in groups (`record_evacuation`, `admit_walk_in`, `set_my_member_missing`, `get_my_household_status`), and adds `get_rescuer_feed` and `get_public_map` for the app.

For rescuer registration and accreditation renewal, apply [`20261019_11_responder_accreditation.sql`](supabase/migrations/20261019_11_responder_accreditation.sql), then [`20261020_03_responder_accreditation_service_role.sql`](supabase/migrations/20261020_03_responder_accreditation_service_role.sql). If registration already fails with “The accreditation record could not be saved” and the logs say “permission denied for table responder_accreditations,” run the second migration in the Supabase project and retry registration.

The matching notes are in [`supabase/`](supabase/) and [`docs/disaster-events.md`](docs/disaster-events.md).

### 3. Run the frontend

```bash
npm run dev
```

Then open the app:

- `/admin/login`: admin login, which leads to the `/admin` dashboard
- `/super-admin/login`: Super Admin login, which leads to the `/super-admin` dashboard

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |

## Testing

Unit tests use Node's built-in test runner:

```bash
node --test tests/vpi.test.mjs tests/rdana.test.mjs
```

The migration integration scripts (`disaster-events.mjs`, `facility-*.mjs`, `resident-profile-migration.mjs`) run the SQL against an in-memory PostgreSQL using [`@electric-sql/pglite`](https://pglite.dev/). That package is not a project dependency. Install it in a temporary directory and pass its path:

```bash
node tests/disaster-events.mjs file:///path/to/node_modules/@electric-sql/pglite/dist/index.js
```


## Deployment

Each push to `new-master` triggers [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which builds the site and deploys it to GitHub Pages under `/PriorityCare-React-Website/`. Set these as repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`
- `VITE_OPENWEATHER_API_KEY`

Super Admin account features use the `super-admin` Edge Function (deploy it with the Supabase CLI); nothing else needs hosting.

## Documentation

- [Prototype VPI](docs/PROTOTYPE_VPI.md)
- [RDANA situation summaries](docs/RDANA_SUMMARIES.md)
- [Disaster events](docs/disaster-events.md)
- [Facility registration](supabase/FACILITY_REGISTRATION.md), [facility lifecycle](supabase/FACILITY_LIFECYCLE.md), and [resident editing](supabase/RESIDENT_EDITING.md)
