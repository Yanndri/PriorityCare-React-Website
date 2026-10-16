# PriorityCare

PriorityCare is a web dashboard for disaster preparedness and response at the sitio level. Administrators use it to verify residents, map vulnerable households, declare disaster events, manage evacuation centers, and draft situation and relief reports.

The frontend is built with React, TypeScript, and Vite, and uses Supabase for authentication and data. A small Express API (`prioritycare-api/`) handles privileged Super Admin operations that need the Supabase service-role key.

> **Prototype notice:** Scoring (VPI), relief arithmetic, and the RDANA/DROMIC-style exports are for demonstration only. They are **not** validated for real triage, rescue ordering, or official DSWD submissions. The docs in [`docs/`](docs/) cover the details.

## Features

| Area | What it does |
| --- | --- |
| **Home** | Resident stats, alerts, operations overview, and the prototype **Vulnerability Priority Index (VPI)** |
| **Verification** | Review and verify pending resident registrations; edit resident profiles |
| **Geo Map** | Leaflet map of residents, active disaster events, and weather (OpenWeather) |
| **Disaster Events** | Declare and resolve flood, fire, earthquake, and landslide events for a sitio |
| **Reports** | 24/48-hour RDANA situation-summary drafts and DROMIC-style PDF/Excel exports |
| **Data Mining** | Analytics charts over resident data |
| **Evac Centers** | Register facilities, manage their lifecycle, and plan daily relief requisition demand |
| **Super Admin** | Create admin accounts and view a dashboard across all sitios |

## Project structure

```
src/
  api/          Supabase / backend API calls
  components/   Reusable UI (panels, forms, tables, sidebar)
  pages/        Top-level dashboard sections
  utils/        Pure logic: VPI, RDANA, relief demand, DROMIC export builders
  lib/          Supabase client
prioritycare-api/   Express backend for Super Admin endpoints
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
VITE_API_BASE_URL=http://localhost:3000      # Express backend (defaults to this)
VITE_OPENWEATHER_API_KEY=your-openweather-key # optional, for Geo Map weather
```

Restart Vite after you change `.env.local`.

### 2. Apply database migrations

In the Supabase SQL editor, run the files in [`supabase/migrations/`](supabase/migrations/):

- `20261014_facility_registration.sql`
- `20261014_facility_lifecycle.sql`
- `20261014_resident_profile_editing.sql`
- `20261014_disaster_events.sql`

The matching notes are in [`supabase/`](supabase/) and [`docs/disaster-events.md`](docs/disaster-events.md).

### 3. Run the frontend

```bash
npm run dev
```

Then open the app:

- `/admin/login`: admin login, which leads to the `/admin` dashboard
- `/super-admin/login`: Super Admin login, which leads to the `/super-admin` dashboard

### 4. Run the backend (Super Admin features)

```bash
cd prioritycare-api
npm install
```

Create `prioritycare-api/.env`. **Never commit the service-role key or expose it to the frontend.**

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3000

# Optional MySQL connection (used by the legacy /api/residents endpoints)
DB_HOST=
DB_PORT=3306
DB_USER=
DB_PASSWORD=
DB_NAME=
```

```bash
npm run dev     # with nodemon
npm start       # plain node
```

Main endpoints:

- `GET /api/health`
- `GET /api/super-admin/check`
- `GET /api/super-admin/dashboard`
- `POST /api/super-admin/admins`

Every `/api/super-admin/*` route requires a Supabase bearer token from a Super Admin user.

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
node --test tests/vpi.test.mjs tests/rdana.test.mjs tests/relief-demand.test.mjs
```

The migration integration scripts (`disaster-events.mjs`, `facility-*.mjs`, `resident-profile-migration.mjs`) run the SQL against an in-memory PostgreSQL using [`@electric-sql/pglite`](https://pglite.dev/). That package is not a project dependency. Install it in a temporary directory and pass its path:

```bash
node tests/disaster-events.mjs file:///path/to/node_modules/@electric-sql/pglite/dist/index.js
```

`tests/dromic-export.mjs <output-dir>` generates synthetic PDF and XLSX samples for checking the exports.

## Deployment

Each push to `new-master` triggers [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml), which builds the site and deploys it to GitHub Pages under `/PriorityCare-React-Website/`. Set these as repository secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`
- `VITE_OPENWEATHER_API_KEY`

The Express backend has to be hosted separately. The `MYSQL*` env var names suggest Railway. Point `VITE_API_BASE_URL` at it.

## Documentation

- [Prototype VPI](docs/PROTOTYPE_VPI.md)
- [RDANA situation summaries](docs/RDANA_SUMMARIES.md)
- [DROMIC-style exports](docs/DROMIC_EXPORTS.md)
- [Daily relief demand](docs/DAILY_RELIEF_DEMAND.md)
- [Disaster events](docs/disaster-events.md)
- [Facility registration](supabase/FACILITY_REGISTRATION.md), [facility lifecycle](supabase/FACILITY_LIFECYCLE.md), and [resident editing](supabase/RESIDENT_EDITING.md)
