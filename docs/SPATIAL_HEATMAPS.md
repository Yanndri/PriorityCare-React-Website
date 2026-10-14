# Spatial vulnerability & incident heatmaps

Open **Geo Map** and use the **Heatmaps** panel (top-right of the map).

- **Layer:** Off, Vulnerability, or Incidents. Only one layer is shown at a time.
- **Style:** **Circles** draws one solid circle per location (co-located points are merged; bigger and darker = more intense, hover for the breakdown); **Grid** bins points into ~250 m cells, each with a hover tooltip (count, breakdown, relative intensity). Grid is easier to read with little data and does not pinpoint individual homes.

## Vulnerability

Each mapped resident is weighted by their prototype VPI score ÷ maximum score (`src/utils/vpi.ts`: age, mobility/disability, pregnancy) at their registered home GPS. Residents with a score of 0 add nothing. Filter to *Moderate + high* or *High only*. Residents with incomplete assessments are scored with known factors only and counted in the panel.

## Incidents

| Signal | Weight | Time window applies |
| --- | --- | --- |
| Failed / not reached (latest evacuation record) | 1.0 | yes |
| Open missing-person report linked to a resident | 1.0 | no — current state |
| Active disaster event reference point | 1.0 | no — current state |
| Active SOS alert (by level 1–3) | 0.6–1.0 | yes |
| Rescue pending | 0.6 | yes |
| In transit | 0.4 | yes |

Resident-linked incidents are plotted at the resident's registered home, not a live position. Missing reports without a linked resident, and residents without GPS, are counted as "without GPS" instead of being guessed. Incident data loads when the layer is first chosen; use **Refresh incidents** for newer data. If a source fails (for example the missing-persons migration is not applied), the other sources still render and a warning is shown.

Colors are single-hue sequential ramps (violet = vulnerability, orange = incidents); darker means denser. Intensity is relative to the current view's data, not an absolute risk threshold.

## Validation

```powershell
npm run build
node --test tests/spatial-heatmap.test.mjs
```
