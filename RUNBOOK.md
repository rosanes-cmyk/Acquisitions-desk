# Runbook — THB Acquisitions Desk

Plain-language operating instructions. Everything here is a human step; none of it
can be done from a code sandbox.

---

## What you need once

- **Node 18 or newer**, and clasp: `npm install -g @google/clasp`
- A **company-controlled Google account** that will own the script projects, both
  spreadsheets, the backup folder and the backup trigger. Never a personal account
  that disappears when someone leaves. (Gate G7.)
- `clasp login` run once as that account.

---

## First run — do this twice, once for DEV and once for PROD

DEV and PROD are **two separate Apps Script projects** with two separate
spreadsheets. Script Properties are per project, so one project cannot safely serve
both. Do DEV first, all the way through, before touching PROD.

### 1. Create the script project

In the company account, create an Apps Script project:

- DEV: **THB Acquisitions Desk — DEV**
- PROD: **THB Acquisitions Desk — PROD**

Copy its **Script ID** (Project Settings → IDs) into `.clasp.dev.json` or
`.clasp.prod.json`, replacing the `REPLACE_WITH_..._SCRIPT_ID` placeholder.

### 2. Push the code

```bash
npm test            # must be green before any push
npm run push:dev    # or: npm run push:prod
```

### 3. Set the Script Properties

In the editor: **Project Settings → Script Properties → Add**

| Property | Value |
|---|---|
| `ENV` | `DEV` or `PROD` — **get this right; it is what keeps the test functions away from real data** |
| `DB_SPREADSHEET_ID` | Leave **blank** the first time. `setupDatabase()` creates the spreadsheet and fills this in |
| `BACKUP_FOLDER_ID` | Optional. Leave blank and a folder named "THB Acquisitions Desk Backups" is created in this account's Drive |

### 4. Build the database

In the editor, choose `setupDatabase` and press **Run**.

Google will ask you to authorize the script. **You have to click this** — it cannot be
done any other way. Review the permissions and accept.

The execution log tells you what it did: the spreadsheet it created, the sheets, the
columns and the seeds. Running it again is always safe; it repairs the schema and
never rewrites data.

> The first run allows any account with edit access to the script, because there is no
> ADMIN to check against yet. From the second run on, only an active ADMIN in the USERS
> sheet can run it.

### 5. Install the daily backup trigger

Run `installTriggers` from the editor. It creates one daily trigger at about 02:00
business time, owned by whoever runs it. Running it twice does nothing the second time.

### 6. Deploy

**Deploy → New deployment → Web app**

| Setting | Value |
|---|---|
| Execute as | **Me** (the company owner account) |
| Who has access | **Anyone within twinhomebuyer.com** |

Not "Anyone". Not "Anyone with a Google account". Those settings return a blank email
for outside accounts, and the app then has to deny them anyway — you would only have
made the lockout worse and the diagnosis harder.

**Write the deployment ID down and keep it forever.** To publish a change later use
**Manage deployments → (the existing one) → Edit → New version**. Creating a *new*
deployment gives you a different `/exec` URL, and everyone's bookmark breaks.

The `/dev` URL is for the developer only. Never give it to employees.

### 7. Check that identity works, before anything else

Have an **authorized non-developer employee** open the `/exec` URL.

- They should see "Signed in as {their name}".
- `AUDIT_LOG` should have a `LOGIN` row carrying their email.

If they get the Access page instead, it shows the email Google actually reported —
usually they are signed into a personal account in the same browser. Fix identity
before anything else. Do not call the project finished until this passes.

---

## Everyday jobs

### Add a user

Admin tab → Users → Add. Name, company email, team, role. Set active.

An account with **no email can never be active** — the email *is* the identity. Users
seeded without one are marked `needs_email` and highlighted.

### Deactivate a user

Admin tab → Users → Deactivate. Nobody is ever deleted; history keeps pointing at a
real person. You cannot deactivate yourself, and you cannot deactivate the last
active admin.

### Change a setting

Admin tab → Settings. Every value is validated. `schema_version` is maintained by
`setupDatabase()` and cannot be edited by hand.

MAO %, the monthly deal target and the budget all live here. Nothing in the app is
hard-coded to 70% or to 3 deals.

### Publish a new version

```bash
npm test
npm run push:prod
```

Then **Manage deployments → Edit → New version**, bump `app_version` in Admin →
Settings to match, and add a line to `CHANGELOG.md`.

### Read the logs

Admin tab → Audit log (who did what) and Error log (what broke). Both show the most
recent 200. Neither ever contains a password or a token.

### Restore from a backup

1. Open the backup folder in Drive and find the copy you want. Backups are named
   `THB Acquisitions Desk Backup - yyyy-MM-dd HHmm`.
2. Make a copy of it, and name the copy clearly.
3. In the script project, set `DB_SPREADSHEET_ID` to the copy's id.
4. Run `setupDatabase()` to make sure the schema is current.
5. Open the app and check the Lead Board and Today tabs before telling anyone it is back.

Backups older than `backup_retention_days` (60 by default) are removed automatically,
**except the first backup of each month, which is always kept**.

### Someone sees the Access page

The page shows the Google account it detected. Almost always they are signed into more
than one account in that browser. Ask them to use a private window with only their work
account. If the email shown is correct, add it in the Admin tab and set it active.

---

## Human-approval gate

Do these **only** after explicit go-ahead from the named admin:

- importing any real seller data into PROD
- any change to USERS in PROD
- any change to SETTINGS in PROD

---

## Transfer of ownership

If the owning account is ever retired, before that account is deleted:

1. Transfer both Apps Script projects to the new owner (Share → change owner).
2. Transfer both spreadsheets and the backup folder in Drive.
3. The new owner runs `installTriggers()` — **triggers belong to the account that
   created them and do not transfer**. Delete the old trigger.
4. Re-deploy as the new owner, editing the existing deployment so the `/exec` URL
   does not change.
5. Confirm a backup runs the next morning and that `BACKUP_LOG` says SUCCESS.

---

## Things that are true and worth knowing

- Reps and managers have **no access to the spreadsheet at all**. The script writes as
  the deploying account. That is deliberate: the dashboard is the only way in.
- No role can hard-delete anything. Leads are archived, users are deactivated, tool
  runs are voided. Every history sheet is append-only.
- The app has no office-network or VPN requirement. An employee needs an internet
  connection, an approved company account, and the production URL — from California,
  Mexico, the Philippines, home, or a phone.
