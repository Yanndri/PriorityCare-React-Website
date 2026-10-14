# Automated 24–48 hour RDANA situation-summary drafts

Open Reports → RDANA Situation Summary. Choose the last 24 or 48 hours, optionally add non-identifying incident/assessment context, and generate a draft. Review or edit the text, check the review acknowledgement, and download the text document. No report is submitted or saved as an official assessment. No AI service or new database migration is required.

The reporting window ends when generation starts. UTC timestamps are used for filtering; the text shows Asia/Manila times. The interval includes its starting instant and excludes its ending instant. SOS uses created_at, evacuation logging uses logged_at, and timestamped completions use evacuated_at plus the current safely_evacuated status. Multiple records/alerts are separated from unique resident-account counts.

Scope is derived from the signed-in active administrator's current assigned sitio, not from search filters or a user-supplied site ID. The population is the set of residents currently registered there. Activity may involve multiple incidents: event attribution is not available. Status labels reflect retrieval-time records, not immutable transition history.

Registered-population figures include age groups, mobility, recorded pregnancy, disability linkage, and distinct registered households. They are not counts of disaster-affected families or a census of dependent household members. Supplemental assessments and household linkages that are missing are reported explicitly. Counts contain no individual names, phone numbers, coordinates, or free-text medical notes. Manually entered incident context is labeled administrator-provided, not independently verified.

The shelter snapshot is explicitly shared across all sitios and current at retrieval. It excludes closed facilities from available capacity, keeps unknown capacity separate, and sums per-center free slots without letting one overcrowded shelter cancel another's availability. These figures must not be added to registered-population totals. They do not reconstruct occupancy 24/48 hours ago.

Damage, deaths/injuries, missing-person counts, assessed affected population, and disaster-event attribution are Not assessed. Failed evacuations do not imply missing persons, and SOS status does not prove extraction. Relief-planner drafts are not stored, so the report states Not available and advises attaching the reviewed daily requisition export.

Retrieval uses deterministic ordering, 500-row pages, and 100-resident ID chunks. It throws instead of returning truncated results at its safety limit. Failure of a secondary section becomes Not available, never an inferred zero. Failure to authenticate, verify scope, or retrieve the scoped population prevents generation entirely. Queries are read-only and are not one transactional snapshot; concurrent edits can affect subsequent drafts.

An official LGU/adviser template has not been supplied. The generated document is a prototype RDANA-oriented situation summary, not a claim of compliance with a prescribed official RDANA form. Exports retain DRAFT labeling even after review.

Validation: `node --test tests/rdana.test.mjs` (Node 24), production build, and targeted ESLint. Tests cover 24/48-hour boundaries, deduplication, timestamp semantics, unavailable-versus-zero results, current snapshot scope, age/household calculations, closed/unknown shelter capacities, and pagination failures.
