# Gates — what was asked, and what this build assumed

The build instruction (§2.3) says to ask these once and then proceed on the stated
defaults. Nobody had answered when the build ran, so **every gate below is on its
default**. Each one is changeable later without touching code — most from the Admin
tab inside the app.

Correct anything that is wrong here *before* real seller data goes into production.

| Gate | Assumed | Where to change it |
|---|---|---|
| **G1** Workspace accounts | Everyone who will use the desk has, or will get, an `@twinhomebuyer.com` account. Anyone on a personal gmail.com account **cannot open the app**, and no workaround is permitted — §4.3 forbids weakening identity. | Google Workspace admin |
| **G2** Roster | 11 placeholder users seeded from both name lists: Juan, David, Diego, Era, Barbie, Thea, Cherry, Genesis, Jonathan, Seth, Bryan. All `active=FALSE`, **blank email**, `permission_level=needs_email`, role `REP`. The deploying account is added as the one active `ADMIN`. **No email was invented.** | Admin tab → Users |
| **G3** Team queues | `TEAM:MX`, `TEAM:PH`, `TEAM:CA` | Admin tab → Settings → `team_queues` |
| **G4** Lead visibility | Everyone sees the whole board (the prototype's rule). `rep_sees_all_leads = TRUE`. Set it FALSE and a REP sees only their own, their team's, and unassigned leads — enforced server-side. | Admin tab → Settings |
| **G5** Assignment rights | MANAGER/ADMIN reassign anything. A REP may claim an unassigned lead and reassign one already theirs or their team's — never another rep's. | Code (`canReassign_` in `src/Auth.js`) |
| **G6** Existing data | **Start empty.** No prototype data was imported. | See below |
| **G7** Company ownership | Not set. This blocks production deployment only. | `RUNBOOK.md` → First run |
| **G8** Backup folder | A Drive folder named `THB Acquisitions Desk Backups`, created in the deploying account's Drive on the first backup. | Script Property `BACKUP_FOLDER_ID` |
| **G9** Business timezone | `America/Los_Angeles` | Admin tab → Settings → `business_timezone` |
| **G10** Targets | MAO 70%, monthly deal target 3, monthly budget 0 | Admin tab → Settings, and Numbers tab → Save targets |

## Role default worth a second look

G2 does not say what role a placeholder should get, so every seeded name is a **REP** —
the least privilege. Juan is seeded as a REP like everyone else. Somebody has to set the
real roles in the Admin tab before those accounts are activated, and at minimum Juan
needs `MANAGER` or `ADMIN` to see the rep snapshot and the management dashboard.

## Two names that are deliberately not users

- **"Sales manager"** is a role, not a person. It is not seeded.
- **"Mexico team"** is a queue, not a person. It is `TEAM:MX`, and leads can be assigned to
  it directly.

Tool operators **Christine, Danny and MC** are not app users either. They stay as free
text on the tool record, exactly as in the prototype.

## G6 — if the prototype does hold real data

Nothing was imported, and nothing will be until somebody asks for it. If the prototype was
used for real:

1. Export the JSON for all 8 storage keys (`thb:days`, `thb:leads`, `thb:settings`,
   `thb:me`, `thb:tools`, `thb:runs`, `thb:pillars`, `thb:asked`).
2. Confirm the name → user mapping by hand. Unmapped names are kept as text, never guessed.
3. Run the import against **DEV** first and check it.
4. Only then run it against PROD, after explicit go-ahead from the named admin.

`MIGRATION_MAP.md` has the field-by-field mapping. The importer is not written yet —
it is the one part of §4.9 that was left until a human confirms the data exists.
