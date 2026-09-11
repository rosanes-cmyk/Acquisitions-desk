# Preview pages

Two standalone HTML files. Open either one in a browser — no build step, no server
required, nothing to install.

| File | What it is |
|---|---|
| `desk.html` | A working preview of the Acquisitions Desk. All five tabs, running the real business rules on sample data. |
| `handoff.html` | The build status report: what exists, what is blocked, what a person still has to do. |

## Just open it

```bash
git pull
open preview/desk.html          # macOS
xdg-open preview/desk.html      # Linux
start preview\desk.html         # Windows
```

That is genuinely all. The pages fetch nothing and store nothing except which tab you
had open.

## Or serve them on localhost

Some browsers treat `file://` pages strictly. If anything looks off, serve the folder
instead — from the repository root:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/preview/desk.html>.

`npx serve` or any other static server works the same way.

## What you are looking at

**Sample data, real rules, running in your browser.** These pages are not connected to a
Google Sheet and contain none of the team's real leads. The names, addresses and phone
numbers are invented.

The behaviour is the real thing: the MAO formula, the work-queue priority order, the tool
streak that survives a weekend, the version conflict that refuses a stale save, the
permission matrix, the compliance rule. Change the role dropdown in the masthead and
controls appear and disappear exactly as they will in production — though in production
the server enforces it, never the browser.

**The visual design is a stand-in.** The real frontend must preserve the prototype's look,
copy and class names, and `acquisitions_desk (1)(1).html` has not been supplied. The Plan
tab says so rather than showing invented text.

## These are not part of the app

`preview/` sits outside `src/`, so clasp never pushes it to Apps Script. Nothing here ships
to production.
