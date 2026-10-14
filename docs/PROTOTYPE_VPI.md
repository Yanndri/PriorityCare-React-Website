# Prototype Vulnerability Priority Index

This is an illustrative feature for a project demonstration. The weights and bands have not been validated for real emergency response, rescue order, or medical triage.

Open Home → Automated VPI. Expand a resident to see its contribution breakdown. Expand Demo scoring rules & settings to change weights and thresholds. Settings are browser-local, versioned under `prioritycare.prototype-vpi.v1`; Reset defaults restores the demonstration formula. They do not modify database records or other administrators' settings.

Default formula (`prototype-v1`):

| Factor | Points |
| --- | ---: |
| Age under 5 or at least 60 | 2 |
| Semi-ambulatory | 2 |
| Non-ambulatory | 4 |
| Any recorded disability | 2 |
| Recorded pregnancy | 3 |

Use only the maximum mobility/disability contribution to avoid overlapping scores. Age and pregnancy are added to it. The default maximum is 9. Low is 0–2, moderate 3–5, high 6–9. These are demonstration bands.

The score uses the actual birthdate, actual mobility enum, recorded disability links, and saved pregnancy assessment. Missing values yield Incomplete and a known-factor subtotal. Old profiles without an assessment are not assumed to have no disability or pregnancy. Save a reviewed profile to record these assessments.

Calculations run when dashboard data changes, weights are applied, or the calendar date changes in Asia/Manila. Saving a resident reloads the dashboard. Changes made outside the website appear after a dashboard refresh. Scores are derived in the browser, not persisted, so they cannot become stale database values.

Verification status, GPS presence, free-text medical notes, and household size do not contribute. Each registered resident is scored individually; shared dependents are not duplicated into account scores. No dispatch assignment or SOS workflow uses this demo score. No database migration is required beyond the existing household-editing migration.

The original placeholder formula (mobility label plus points for pending verification) has been removed from the Home overview. It also no longer interprets presence of GPS coordinates as a reason to enter that VPI list. Other existing mapping/hazard logic is outside this change.

Validation: `node --test tests/vpi.test.mjs` (Node 24), production build, and targeted lint. The tests cover birthday boundaries, invalid dates, missing assessments, overlapping mobility/disability points, thresholds, custom rules, and irrelevant attributes.
