# Pre-emptive Evacuation Status & Intended Destination

Before or early in a hazard, each household says whether it is staying home, getting ready to leave, on the way, or has arrived, and where it is going. Staff log it on the website; residents report it from the app.

Database: `supabase/migrations/20261020_01_preemptive_evacuation.sql` (run after `20261019_14`).

## Statuses and destinations

| Status | Value | Needs a destination |
| --- | --- | --- |
| Staying home | `staying_home` | no |
| Preparing to leave | `preparing` | yes |
| On the way | `evacuating` | yes |
| Arrived at destination | `arrived` | yes |
| Returned home | `returned_home` | no |

Destination types: `evacuation_center` (pick a center), `relative_friend` or `other` (type an address or place).

Every report is kept (`preemptive_evacuation_logs`); the newest one is the household's current status. A report is linked to the barangay's active disaster event when there is one.

When the destination is an evacuation center, "On the way" also writes an `in_transit` evacuation record and "Arrived" writes a `safely_evacuated` one, so center occupancy, the Evacuation Centers page and the reports include them. "Returned home" does not check anyone out of a center, because evacuation records have no "left the center" state yet.

## Website

Sidebar tab **Pre-emptive Evacuation** (admins: their barangay; super admin: the selected scope). It lists every resident with their latest status, destination and who logged it, with filter buttons per status (including "No report yet"), search, **Log update** and **History**.

## Resident app

Both functions need the resident to be signed in (Supabase Auth). Call them with `supabase.rpc(...)`.

### `get_my_preemptive_evacuation()`

Returns:

```json
{
  "latest": { "status": "preparing", "destination_type": "evacuation_center", "destination_center_id": 9003,
              "destination_center_name": "Alegria Barangay Hall", "destination_address": "", "headcount": 4,
              "note": "", "event_name": "Hillside landslide", "source": "resident", "logged_at": "..." },
  "household_size": 4,
  "active_event": { "event_id": "...", "name": "Hillside landslide", "hazard_type": "landslide" },
  "centers": [ { "center_id": 9003, "center_name": "Alegria Barangay Hall", "gps_lat": 10.2554, "gps_long": 123.9578,
                 "capacity": 60, "assigned": true, "is_primary": true } ]
}
```

`latest` and `active_event` are `null` when there is none. `centers` lists open centers with the barangay's assigned shelters first (`is_primary`, then `assigned`), so the app can preselect the first one.

### `report_my_preemptive_evacuation(p_status, p_destination_type, p_center_id, p_destination_address, p_headcount, p_note)`

| Parameter | Type | Notes |
| --- | --- | --- |
| `p_status` | text | one of the status values above |
| `p_destination_type` | text | `evacuation_center`, `relative_friend`, `other`; `null` for staying/returned home |
| `p_center_id` | integer | required when the type is `evacuation_center`, else `null` |
| `p_destination_address` | text | required for `relative_friend` / `other` (max 300 chars), else `null` |
| `p_headcount` | integer | 1–50; `null` = the whole household |
| `p_note` | text | optional, max 500 chars |

Returns the same object as `get_my_preemptive_evacuation()`. Errors come back as plain messages to show the user (for example "Choose the evacuation center.").

```js
const { data, error } = await supabase.rpc('report_my_preemptive_evacuation', {
  p_status: 'evacuating',
  p_destination_type: 'relative_friend',
  p_center_id: null,
  p_destination_address: 'Tita Nena, Purok 2, Pilipog',
  p_headcount: null,
  p_note: 'Leaving at 5 PM',
})
```

## Rescuer app / staff

`log_preemptive_evacuation(p_resident_uid, p_event_id, p_status, p_destination_type, p_center_id, p_destination_address, p_headcount, p_note)` logs for a resident. Rescuers can log for anyone; admins only for their barangay. `get_preemptive_evacuation_board(p_barangay)` and `get_preemptive_evacuation_history(p_resident_uid)` are what the website reads.

## Also fixed in this migration

`evacuation_records.record_id` had no default value, so `record_evacuation` and `admit_walk_in` failed on every call. The migration gives it `gen_random_uuid()` as the default.
