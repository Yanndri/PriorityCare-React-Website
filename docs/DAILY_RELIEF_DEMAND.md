# Daily relief requisition demand — prototype

Open Evacuation Centers → Relief requisition demand. Select the planning date, enter the approved daily rates, and confirm each included center's population, distinct households, and dedicated usable stock. Rates deliberately have no defaults: this feature supplies arithmetic, not official food, water, or hygiene standards.

Formulas, per facility:

- FFPs = round up(households × FFPs per household/day)
- Potable water liters = round up(people × liters per person/day)
- Hygiene kits = round up(households × kits per household/day)
- Each item's request = maximum(gross demand − assigned usable stock, 0)

Fractional daily rates with up to three decimal places are allowed; zero explicitly disables an item for the day. Rates are converted to integer thousandths before multiplication to avoid floating point ceiling errors. Supplies and liters round up to whole units per center; totals add those center requests.

Facility-wide recorded occupancy is suggested only when the catalog provides it. If the facility registration migration is not yet applied, people must be entered manually. Household counts are manual because registered accounts and family groups do not provide a reliable facility-wide admission household count. Count each household once for distribution and avoid duplicating shared warehouse stock across center rows. A reliable admission/check-in module is a prerequisite for automatically resolving evacuated households.

Changing the planning date does not load historical occupancy. For another date, enter confirmed counts for that date. If a center has missing or invalid data, its row is flagged and the summary explicitly says partial subtotal. Export is blocked until all included rows are valid. Centers can be explicitly excluded and are listed as excluded in the CSV.

Export produces a dated CSV draft with input rates, population source, gross demand, stock, per-center requests, totals, and export time. It does not submit a requisition, change inventory, write personal data, or allocate supplies. Draft inputs reset when leaving the page. Save Draft for Reports stores a validated aggregate copy in this browser tab's session storage for the DROMIC-style PDF/Excel exporter; it is not a shared database record. No additional database migration is needed for this calculator.

Validation: `node --test tests/relief-demand.test.mjs` (Node 24), production build, and targeted lint. Fixtures use hypothetical rates solely to verify arithmetic. Tests cover units, integer rounding, stock deductions, zero demand, unknown data, count consistency, bad rates/stock, and safe CSV formatting.
