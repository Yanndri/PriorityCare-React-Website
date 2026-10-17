# Household triage pins color-coded by VPI urgency (Module 4.3)

The **Geo Map** now shows one pin per **household** instead of one violet pin per resident.

| Pin | Meaning |
| --- | --- |
| 🔴 **H** Red | The household's most urgent member has a High VPI (≥ 6 with the default rules) |
| 🟡 **M** Yellow | Most urgent member is Moderate (3–5) |
| 🟢 **L** Green | Everyone assessed is Low (0–2) |

- The small number on a pin is how many people are in the household (registered members plus listed dependents without accounts).
- A dashed outline and **?** mean at least one member's profile is incomplete (missing birthdate, mobility, disability or pregnancy assessment). They are scored on known factors only, so the color is a **minimum** — completing the assessment can only raise it. A known High score is always red.
- Dependents in `households.household_members` (e.g. infants) are scored on what is known: age band (< 5 or ≥ 60) and pregnancy.
- Location: the household head's GPS; if the head has none, another member's. Households with no valid GPS (missing or 0,0) are counted in the legend, not guessed.
- Red pins are drawn on top. Click a pin for each member's level, score, contributing factors and missing data, plus the emergency contact.
- The legend (bottom-right of the map) has checkboxes to show/hide each color and counts per color.

VPI is the existing prototype index in `src/utils/vpi.ts` (age, mobility/disability, pregnancy). It supports, not replaces, responder judgement.

Data: `dashboardApi.ts` now also sets `householdId` and `isHouseholdHead` on residents (heads are linked via `households.head_uid` even without a profile-details row). No database change.

Validation: `node --test tests/triage-pins.test.mjs`, then `npm run build`.
