# Changelog

## 1.0.0 — in progress

First production build. Converts the single-file `window.storage` prototype into one
shared Apps Script web app over one Master Google Sheet.

### Deliberate deviations from the build instruction

Each of these departs from the letter of the spec. The reason is recorded here, as
§2.2 requires.

1. **`appsscript.json` lives in `src/`, not the repo root.** clasp requires the manifest
   inside `rootDir`. The layout in §4.1 shows it at the root, which does not push.

2. **The static globals check runs inside `npm test`.** §7 lists it as Tier 2 case 17 but
   notes it is a repo script. Wiring it into `npm test` makes it block every push, which
   is the point of having it. Case 17 in `runSelfTests()` therefore reports INFO and
   points at the Tier 1 output, because Apps Script cannot inspect its own global scope.

3. **`tools/check-references.js` was added.** Not in the spec. Apps Script shares one
   global scope across files and resolves nothing until a line runs, so a cross-file typo
   would surface as a live `SERVER_ERROR` in production. It caught a real one during the
   build.

4. **Header-row protection is warning-only.** A hard protection belongs to the account
   that created it, which would stop a second admin from running `setupDatabase()` to add
   a column. The real defence is §3.2.9 — reps and managers have no access to the
   spreadsheet at all.

5. **`setupDatabase()` allows a first run with no active ADMIN.** There is no ADMIN to
   authorize against before anyone is provisioned. During that window the app denies every
   user, so nobody can reach the desk through it, and only someone with edit access to the
   script project can run the function. From the second run on the ordinary ADMIN guard
   applies.

6. **`stripIdentityFields_` keeps `userId`.** §4.3 says any `user*` field in a payload is
   ignored, but §4.10 defines `userId` as the target of `updateUser`, `disableUser` and
   `setToolTraining` — the person being acted on, not the caller. Stripping it would break
   three documented actions. Caller-identity keys are stripped by name instead, and a test
   asserts that no service reads identity from a payload.

7. **Clearing the Juan flag is refused while the compliance flag is set.** Not stated in
   the spec. §6.2 requires a compliance lead to stay in Waiting on Juan; without this, a
   routine "clear flag" would quietly remove it from the one list that exists to catch it.
   Clearing the mailer note (MANAGER+) clears both.

8. **A `saveTargets` action was added.** §5.8 requires a Save targets button; §4.10 folds
   targets into `saveSetting`. `saveTargets` is a thin MANAGER+ wrapper that saves the two
   keys together, so one button is one request.

9. **Placeholder users are seeded as `REP`.** Gate G2's default does not name a role.
   REP is the least privilege. Roles must be set in the Admin tab before those accounts
   are activated — including Juan's.

### Still to come in 1.0.0

- The frontend (`Index.html`, `Styles.html`, `Scripts.html`, `Admin.html`), which is
  derived from the prototype HTML.
- `BASE_TOOLS_SEED_`, the 22 seeded tools, which only exist in that file.
- The five pillar descriptions, likewise.
- `importPrototypeJson_()`, deliberately left until a human confirms under Gate G6 that
  the prototype holds real data.
