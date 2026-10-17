# Digital rescue dispatch tickets (Module 5.5)

Apply `supabase/migrations/20261017_rescue_dispatch_tickets.sql` (after the disaster-events and missing-persons migrations). It adds `rescue_units`, `dispatch_tickets`, `dispatch_ticket_events` (history) and guarded RPCs. Existing SOS, resident and evacuation rows are never modified.

Open **Dispatch** in the admin sidebar.

## Board

- **Needs a ticket** — active SOS alerts and open missing-person reports in your scope that have no live ticket. **Create ticket** pre-fills the form (resident, location, suggested priority and equipment).
- **New ticket** — sitio, optional disaster event, optional resident, what is needed, priority, location (coordinates and/or landmark), equipment to bring, instructions, and optionally a unit to assign immediately.
  - Suggested priority: SOS level 3 or a High VPI → **Critical**; SOS level 2 or Moderate VPI → **High**; else **Normal**.
  - Suggested equipment comes from mobility (non-ambulatory → stretcher, semi-ambulatory → wheelchair), pregnancy and infants in the household. Suggestions only — trained personnel confirm.
  - Units are listed with how many of the needed items they carry and how many live tickets they already have.
- Columns: **Unassigned → Assigned → In progress (acknowledged / en route / on scene) → Closed (last 7 days)**. Critical first.
- Actions: Assign unit · Reassign (a reason is required once the unit has acknowledged) · Mark next status (normally done by the unit from the app) · Resolve (outcome required) · Cancel (reason required) · History (every step, who, when).
- Tickets are numbered `D-0001`, `D-0002`, …

Safety rules enforced by the database: only one live ticket per SOS alert or missing report (two dispatchers cannot send two teams by accident); status only moves forward; closed tickets cannot change; a unit with live tickets cannot be deactivated.

## Units

Create responder units with a name, home sitio (or barangay-wide — super admin only), capabilities/equipment carried, and members (active **rescuer** accounts). Sitio admins manage their sitio's units; any admin can assign any active unit (to borrow a team from another sitio).

## For the rescuer app (Module 5.6)

`update_dispatch_status(ticket_id, status, note)` can be called by an active rescuer who is a member of the ticket's assigned unit, to move it `acknowledged → en_route → on_scene → resolved`. Rescuers cannot cancel. Members can read their unit's tickets through a future app RPC; the web board refreshes on demand (Refresh button).

## Access

Admins see and act on their sitio's tickets; super admins on all. Browsers have no direct table access.

Mock data: three active SOS alerts for mock residents, units "Barangay Rescue 1" and "Sitio 3 Alpha Team", one critical ticket en route and one resolved ticket.

Validation:

```powershell
npm run build
node --test tests/dispatch-utils.test.mjs
node tests/rescue-dispatch.mjs <PGlite-module-path-or-file-URL>
```

## Equipment matching (Module 5.4)

Equipment suggestions come from **editable rules** (`supabase/migrations/20261017_equipment_matching_rules.sql`, **Dispatch → Equipment rules**). A rule says *when* (mobility is …, has disability …, is pregnant, age under / at least …, assistance-needs text mentions a word) → *suggest* equipment, with a reason shown to dispatchers. Defaults include: non-ambulatory → stretcher; semi-ambulatory, physical disability or age ≥ 80 → wheelchair; visual → guide rope / sighted escort; hearing → written cards / light signals; intellectual or psychosocial → familiar companion / calm escort; pregnant → first aid kit; under 5 → infant kit; needs mentioning oxygen → oxygen, bedridden → stretcher, dialysis → medical transport, insulin → medicine cooler, seizure → first aid kit, cane → walking aid.

- Household dependents without accounts are checked too (age, pregnancy, their needs text), labelled by name.
- Keyword matching is whole-word and case-insensitive (“cane” does not match “hurricane”).
- Only super admins change rules (they apply to every sitio); rules are turned off rather than removed, and every change is audited. Everyone else can read them.
- The ticket form lists each suggested item with why. Residents' **Verification** detail shows **Disabilities** and **Rescue Equipment Needs**, including which profile facts are still unknown.
- If the rules can't be loaded, the built-in defaults (same as the seeded rules) are used.

Validation: `node --test tests/equipment-match.test.mjs tests/dispatch-utils.test.mjs` and `node tests/equipment-rules.mjs <PGlite>`.
