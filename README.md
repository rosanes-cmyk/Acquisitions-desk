# THB Acquisitions Desk

One shared production application for Twin Home Buyer: the acquisitions dashboard served
by Google Apps Script, over one Master Google Sheet as the database.

```
Dashboard (Apps Script HtmlService)
      |  google.script.run -> api(action, payload)
Apps Script backend (auth, validation, locks, versioning, activity, audit)
      |  targeted row reads/writes
ONE Master Google Spreadsheet
```

Employees never open the raw Sheet. Identity is the signed-in `@twinhomebuyer.com`
Google account, resolved on the server. Nothing is ever hard-deleted.

## Status

| Part | State |
|---|---|
| Database schema, setup, migrations, seeds | Done |
| Backend: auth, dispatcher, all services | Done |
| Tier 1 tests (Node) | **Green** |
| Tier 2 self-tests (Apps Script, DEV) | Written — a human runs them |
| Tier 3 acceptance | Written — humans run them |
| Frontend | **Blocked**, see below |
| Deployment | Human steps, see `RUNBOOK.md` |

### What is blocked, and on what

The frontend is derived from the prototype file `acquisitions_desk (1)(1).html`, which is
not in this repo. It is the only source for the CSS and class names, the exact UI copy,
the verbatim "The Plan" tab, the 22 seeded tools, and the five pillar descriptions. Three
things wait on it:

- `Index.html`, `Styles.html`, `Scripts.html`, `Admin.html`
- `BASE_TOOLS_SEED_` in `src/Setup.js` — `setupDatabase()` reports the skip and seeds them
  on a later run, without touching anything else
- the pillar descriptions

`src/Access.html` does not depend on it and is finished. **Until the frontend lands,
`doGet` has no `Index.html` to render** — the backend is complete and testable, but the
app does not open yet.

## Layout

```
src/                  everything here is pushed to Apps Script by clasp
  appsscript.json     manifest (must live in rootDir)
  Code.js             doGet, include_, api() - the ONE client entry point
  Auth.js             identity and the permission matrix
  Db.js               the only code that touches the spreadsheet
  Ids.js Dates.js Validate.js Calc.js     PURE - no platform services, Tier 1 runs these
  *Service.js         Lead, Activity, Appointment, Metrics, Tool, Dashboard, Admin, Backup
  Setup.js            schema, setupDatabase, seeds, migrations, installTriggers
  Tests.js            Tier 2 self-tests (DEV only)
  Access.html         shown when identity cannot be resolved
test/                 Tier 1, node --test
tools/                check-globals.js, check-references.js, use-env.js
```

## Commands

```bash
npm test            # Tier 1 + both static checks. Must be green before any push.
npm run push:dev    # clasp push to the DEV project
npm run push:prod   # npm test, then clasp push to PROD
```

## The rule that matters most

In Apps Script **every top-level function is callable from the browser** via
`google.script.run` by anyone who can open the web app. So there is exactly one callable
action surface — `api(action, payload)`, driven by a whitelist — and every other function
in the project ends with `_`.

`tools/check-globals.js` fails the build if that ever stops being true. Only these may be
global:

`api` · `doGet` · `setupDatabase` · `installTriggers` · `createDatabaseBackup` ·
`runSelfTests` · `createTestData`

The five editor-run functions resolve `Session.getActiveUser()` against USERS — never
`getEffectiveUser()`. Under `executeAs: USER_DEPLOYING` the effective user is the owner
for every browser call, so a guard written against it would pass for every rep on the team.

## Documentation

| File | What it is for |
|---|---|
| `RUNBOOK.md` | Deploying, adding users, restoring a backup, transferring ownership |
| `GATES.md` | The ten decisions, and what this build assumed for each |
| `MIGRATION_MAP.md` | Prototype → production, field by field, and the bugs not carried over |
| `HUMAN_ACCEPTANCE_CHECKLIST.md` | Tier 3, click by click |
| `CHANGELOG.md` | Versions, and every deliberate deviation with its reason |
