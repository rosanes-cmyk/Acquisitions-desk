# Migration map — prototype → production

Every prototype feature has a disposition. Nothing is dropped silently; where behaviour
changed, the reason is stated (§2.2).

## Storage keys

The prototype kept 8 keys in `window.storage`. All 8 are accounted for.

| Prototype key | Production home |
|---|---|
| `thb:days` | `DAILY_METRICS` |
| `thb:leads` | `LEADS` (+ `LEAD_ACTIVITY` for notes, `APPOINTMENTS` for appointment history) |
| `thb:settings` | `SETTINGS` |
| `thb:me` | **Removed.** Identity is the signed-in Google account, resolved server-side |
| `thb:tools` | `TOOL_INVENTORY` (+ `TOOL_TRAINING` for the trained list) |
| `thb:runs` | `TOOL_RUNS` |
| `thb:pillars` | `PILLARS` |
| `thb:asked` | `BUILDER_ROLLCALL` |

`localStorage` survives only for harmless UI preferences: last tab, filter, sort, search
text, collapsed cards. Never leads, notes, activity, metrics, tools, runs, assignments,
underwriting, compliance, settings or identity.

## Lead fields

| Prototype | Production |
|---|---|
| `id` | `lead_id` — a new permanent `LEAD-yyyyMMdd-XXXXX` id; the old one is kept in `legacy_id` on import |
| `addr` | `address` |
| `owner` | `seller_name` |
| `phone` | `phone` (+ `phone_normalized`) |
| `source` | `source` |
| `equity` | `equity_note` |
| `status` | `status` (codes below) |
| `owner_by` | `assigned_to` — a `user_id` or a `TEAM:` queue |
| `flag` | `flag_juan` (+ `flagged_at`) |
| `comply` | `compliance_mailer_check` (+ `compliance_flagged_at`) |
| `attempts` | `contact_attempts` |
| `next` | `next_action` |
| `due` | `due_date` |
| `arv`, `repairs` | `arv`, `repairs` |
| `ask` | `asking_price` |
| `offer` | `offer` |
| `apptDate` | `appointment_date` (+ `appointment_time`) |
| `apptOutcome` | `appointment_outcome` |
| `touched` | `last_touched_at` |
| `notes[]` | `LEAD_ACTIVITY` rows; the last 4 are denormalized into `recent_notes_json` |

## Status codes

| Prototype | Production | Label |
|---|---|---|
| `new` | `NEW` | New |
| `investigating` | `INVESTIGATING` | Investigating |
| `contact` | `CONTACT_MADE` | Contact made |
| `appt` | `APPOINTMENT_SET` | Appointment set |
| `contract` | `UNDER_CONTRACT` | Under contract |
| `closed` | `CLOSED` | Closed |
| `a_sold` | `ARCHIVED_SOLD` | Archived: sold |
| `a_equity` | `ARCHIVED_NO_EQUITY` | Archived: no equity |
| `a_no` | `ARCHIVED_NOT_INTERESTED` | Archived: not interested |
| `a_bad` | `ARCHIVED_BAD_DATA` | Archived: bad data |

LIVE is the first five. `CLOSED` is not live and is not archived.

## Prototype bugs that were deliberately not carried over

| # | Prototype behaviour | What happens now |
|---|---|---|
| 1 | `mergeTools()` dropped the per-tool "asked the builder" date on every reload | `asked_builder_date` is a real column that survives |
| 2 | The tool streak broke every weekend for "Every weekday" tools | A weekday-only tool is not *due* at the weekend, so the weekend does not break the streak |
| 3 | Blur handlers saved even when nothing had changed | A patch equal to the stored value writes nothing and does not bump the version |
| 4 | Every save re-rendered the whole lead list, losing focus and scroll | Only the affected card is patched *(frontend — pending)* |
| 5 | "Today" came from the browser clock | `businessToday` comes from the server, in the company timezone |
| 6 | The channel table compared 30-day spend with all-time lead counts | Both sides are bounded to the same 30 days |
| 7 | A tool link accepted any string, so `javascript:` was possible | http(s) only, validated server-side; anything else is rendered as plain text |
| 8 | Search covered address and owner only | Address, seller, phone digits and assignee |
| 9 | The app always opened on The Plan tab | Opens on Today, remembers the last tab *(frontend — pending)* |

Two more from the plan review:

- **Tool run "Undo"** deleted the run. It now sets status `VOIDED`; the row stays, so the
  record of who marked what and when is never destroyed.
- **`reassignLeo()`**, a one-off fix for a mis-attributed builder name, is not ported. If
  prototype data is ever imported, the rename is applied once inside the importer.

## Changes that go beyond the prototype, and why

| Change | Reason |
|---|---|
| Admin tab added | Rule 1.2 requires user and settings management inside the app. Without it an admin edits the raw Sheet, which §3.2.9 forbids |
| MAO percentage is a setting | The prototype hard-coded 70 with no way to change it |
| "target 200" in the tally is a setting | It was hard-coded |
| Save targets restricted to MANAGER+ | Anyone could change the company's targets |
| Clearing the mailer note restricted to MANAGER+ | A compliance flag should not be cleared by the person who raised it |
| Appointment time added | The prototype had a date but no time |
| Bulk import reports every row | The prototype discarded what it could not parse |
