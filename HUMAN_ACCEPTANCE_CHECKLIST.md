# Tier 3 — human acceptance checklist

Tier 1 (Node) and Tier 2 (Apps Script self-tests) are run by the machine. **These are
not.** Every item here needs a real person, and several need two people in two
browsers with two real Google accounts.

**A Tier 3 item is PASS only when a human confirms it.** Anything not yet run is
`READY FOR HUMAN TEST` — never PASS.

Run against the **production `/exec` URL**, unless an item says DEV.

Record: item · PASS/FAIL · who · date · notes.

---

## A. Access and identity

The most important section. If this fails, nothing else matters.

| # | Step | Expected |
|---|---|---|
| A1 | An authorized non-developer employee opens the `/exec` URL | The desk opens, masthead says **Signed in as {their name} · {role}** |
| A2 | Check `AUDIT_LOG` in the spreadsheet after A1 | A `LOGIN` row with **their** email and today's business date |
| A3 | Someone signs in with a personal gmail.com account and opens the URL | Google blocks them before the app loads, **or** the Access page appears. The board is never visible |
| A4 | An admin sets a user's `active` to FALSE; that user reloads | The Access page. An `ACCESS_DENIED` row appears in `AUDIT_LOG` |
| A5 | Someone whose email is not in USERS opens the URL | The Access page, **showing their actual email**, with instructions to send it to an admin |
| A6 | A person signed into two Google accounts opens the URL | The Access page shows which account was detected — enough to work out what went wrong without help |

## B. Identity in actions — nobody can act as somebody else

| # | Step | Expected |
|---|---|---|
| B1 | That employee posts a note on `TEST - 100 Main Street` | The note appears under **their** name |
| B2 | Check the `LEAD_ACTIVITY` row for B1 | `user_id`, `user_name` and `user_email` are theirs |
| B3 | Juan opens Today → Who worked the board today | Their activity is listed under their name, with no one compiling it |
| B4 | Look anywhere in the UI for a way to choose who you are | There is none. No dropdown, no name field, nowhere |

## C. Multi-user — two people, two browsers, at the same time

The point of the whole rebuild. Do not skip these.

| # | Step | Expected |
|---|---|---|
| C1 | A and B edit **different** leads at the same time and save | Both changes are saved. Neither overwrites the other |
| C2 | A and B both open the **same** lead. A changes the status and saves. B then changes the seller name and saves | B is refused with: *"This lead was updated by another team member. Review the latest information before saving your change."* |
| C3 | Check the lead after C2 | A's change is intact. B's was **not** written |
| C4 | B reloads that lead and makes the same edit | It saves normally |
| C5 | A changes a lead. B watches without touching anything | B sees it within `auto_refresh_seconds` (30 by default) |
| C6 | B presses Refresh right after a change by A | It appears immediately. No browser restart, no re-login |
| C7 | B is typing a note while A's change arrives | B's typing is **not** interrupted and the text is not lost. An "updates available" indication appears instead |

## D. It is really saved

| # | Step | Expected |
|---|---|---|
| D1 | Create `TEST - 999 Persistence Way`, close the browser completely, reopen the URL | The lead is there |
| D2 | Change a status, press F5 | The new status holds |
| D3 | Post a note, press F5 | The note holds |
| D4 | Log a contact attempt, press F5 | The count holds |
| D5 | Open the desk on a different computer | The same board, the same data |

## E. Archive and restore

| # | Step | Expected |
|---|---|---|
| E1 | Set a lead's status to **Archived: no equity** | It leaves the Live list |
| E2 | Filter → Archived | It is there, showing the archive reason |
| E3 | Open it | The full history is intact |
| E4 | As a **REP**, look for Restore | There is none |
| E5 | As a **MANAGER**, press Restore | It returns to the Live list and the archive reason is cleared |
| E6 | Look anywhere for a way to permanently delete a lead | There is none, in any role |

## F. Compliance — the one that carries legal risk

| # | Step | Expected |
|---|---|---|
| F1 | On any lead, choose **Mailer or check mentioned** | A red chip on the card. The lead appears under **Waiting on Juan**. It is visually unmistakable |
| F2 | Check the lead's notes | *"Seller mentioned a mailer or check. Conversation stopped, routed to Juan."* |
| F3 | Check the lead's status | Unchanged and still live. It was **not** auto-archived or hidden |
| F4 | As a **REP**, try to clear the mailer note | Refused |
| F5 | As a **MANAGER**, clear it | It clears, and the clearing is recorded |

## G. Today

| # | Step | Expected |
|---|---|---|
| G1 | Open the desk first thing | It opens on **Today**, not The Plan |
| G2 | Before anyone logs the day | "Today has not been logged" |
| G3 | Save today's numbers | "Saved by {your name}" — and only after the save actually completes |
| G4 | Save today again with different numbers | The same row updates. No second row for today |
| G5 | Mark a daily tool as run | It shows done, by you |
| G6 | Press Undo on it | It shows not-run again |
| G7 | Check `TOOL_RUNS` in the sheet after G6 | The row is still there with status `VOIDED`. **Nothing was deleted** |
| G8 | Work queue | Overdue first (in red), then Due today, then Upcoming, then No next action and No due date |
| G9 | Press **Mark done** on a queue item | It is logged, the next action clears, and you are asked for the next one |
| G10 | Choose "Leave without next action" at G9 | The lead stays visible under **No next action** |

## H. Numbers

| # | Step | Expected |
|---|---|---|
| H1 | Pace this month | Matches `deals_closed` summed from the daily log for this month — **not** a count of closed leads |
| H2 | Leave one day's "minutes to first call" blank, fill others | The average ignores the blank day. It does **not** treat it as zero |
| H3 | A metric with nothing entered | Renders empty, not `0` |
| H4 | A ratio whose denominator is zero | Shows `—`, not `0` and not an error |
| H5 | Where the money went | Spend and lead counts both cover the same 30 days; the hint line says so |
| H6 | As a **REP**, look for Save targets | Hidden or disabled |
| H7 | As a **MANAGER**, change the target and save | It saves and the pace line updates |

## I. Lead board

| # | Step | Expected |
|---|---|---|
| I1 | Tally row | Counts cover the **whole** board, not just the page on screen |
| I2 | Search a phone number with dashes and spaces | The lead is found |
| I3 | Search an assignee's name | Their leads are found |
| I4 | Paste 5 leads into Add leads, one per line | All 5 are added, with a summary |
| I5 | Paste a block copied from a spreadsheet (tab separated) | The columns land in the right fields |
| I6 | Include a line with no address, and a duplicate of an existing address | Summary shows **Added X · Duplicates skipped X · Failed X**, with line numbers and reasons. The failed line is put back in the box |
| I7 | Add a lead whose phone matches an existing lead at a different address | It is added, with a "Possible duplicate" chip. The two are **not** merged |
| I8 | Enter ARV and repairs | The MAO line uses the configured percentage, not a hard-coded 70 |
| I9 | Sort by offer room | Highest first; leads with no ARV are last |
| I10 | Open a card, start typing a note, then let the auto-refresh fire | Your typing survives |
| I11 | Press **Show history** on a lead with many notes | The full thread loads |

## J. Tools

| # | Step | Expected |
|---|---|---|
| J1 | As a **REP**, open Tools | You can view, and mark runs. You cannot edit |
| J2 | As **TECHNICAL** or **MANAGER**, edit a tool | It saves |
| J3 | Paste `javascript:alert(1)` into a tool link | Refused. It never becomes a clickable link |
| J4 | Set a tool to "Every weekday", run it Thu and Fri, check the streak on Monday | **The weekend has not broken the streak** |
| J5 | Set a per-tool "asked the builder" date, then reload | The date is still there |
| J6 | Toggle a trained checkbox | It holds after a reload |

## K. Timezone — the Philippines / California case

The single most important cross-border check.

| # | Step | Expected |
|---|---|---|
| K1 | At a moment that is a **different calendar day** in Manila and in California (e.g. 07:00 Manila = 16:00 the previous day in Los Angeles), have a PH user and a CA user each post a note | Both `LEAD_ACTIVITY` rows carry the **same** `business_date` |
| K2 | Both open the Today tab at that moment | Both see the same company day and the same daily log |

## L. It works where people actually are

| # | Step | Expected |
|---|---|---|
| L1 | Open on a desktop | Usable |
| L2 | Open on a laptop | Usable |
| L3 | Open on a phone (~400px wide) | Usable — no horizontal scrolling of the page body |
| L4 | Open from California, Mexico and the Philippines | Works from all three, over an ordinary internet connection. No VPN, no office network |
| L5 | Open in Chrome and in one other modern browser | Both work |

## M. Errors and recovery

| # | Step | Expected |
|---|---|---|
| M1 | Turn off wifi and try to save | A clear message, and a Retry. Not a blank page, not a permanent "Opening the desk…" |
| M2 | Turn wifi back on and press Retry | It saves |
| M3 | Admin tab → Run backup now | A new file in the backup folder, and a `SUCCESS` row in `BACKUP_LOG` |
| M4 | The morning after `installTriggers()` | A backup from about 02:00, logged |
| M5 | Admin tab → Error log | Readable, and free of seller data |

---

## Sign-off

| | |
|---|---|
| Tested by | |
| Date | |
| Production URL | |
| App version | |
| Items PASSED | |
| Items FAILED | |
| Items not yet run | |

Anything FAILED is a bug, and it belongs in a list with the item number — not in
somebody's memory.
