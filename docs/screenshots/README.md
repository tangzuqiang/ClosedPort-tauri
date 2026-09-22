# Screenshots (maintainer notes)

The PNGs in this folder are real screenshots of ClosedPort running on
**Windows**, captured against the real React UI fed with real `listPorts()`
data — there is no mocking or PS work involved.

> ⚠️ This file documents the **maintainer-only** hook used to regenerate
> these images. End users, contributors who only want to run the app, and
> CI **should not** set `CLOSEDPORT_SCREENSHOT_DIR`. When that variable is
> set, ClosedPort will boot into screenshot mode, drive its own UI for a
> few seconds, write PNGs to that directory, and then `app.quit()` — i.e.
> the window appears briefly and then vanishes. That is by design for
> regenerating docs, not a bug.

Files:

- `main-flat.png`     — Main window, flat view with the `Started by` column
- `main-grouped.png`  — Main window, "Group by App" view, three groups expanded
- `folder-locks.png`  — Folder lock scanner tab. Only meaningful on Windows;
  on macOS / Linux this tab is intentionally inert (see README FAQ).
- `floating.png`      — Always-on-top mini panel

To regenerate them locally (Windows is required for `folder-locks.png` to
have content):

```powershell
# Windows / PowerShell
$env:CLOSEDPORT_SMOKE = $null
$env:CLOSEDPORT_SCREENSHOT_DIR = "$PWD\docs\screenshots"
npm run build
npx electron .

# IMPORTANT: clear it immediately after the run, otherwise the next
# `npx electron .` you launch will silently quit again.
$env:CLOSEDPORT_SCREENSHOT_DIR = $null
```

```bash
# macOS / Linux (folder-locks.png will render the "Windows-only" empty state)
unset CLOSEDPORT_SMOKE
export CLOSEDPORT_SCREENSHOT_DIR="$PWD/docs/screenshots"
npm run build
npx electron .
unset CLOSEDPORT_SCREENSHOT_DIR
```

The hook is implemented in `src/main/index.ts` (`if (process.env.CLOSEDPORT_SCREENSHOT_DIR) ...`).
It boots the real BrowserWindow, walks the four UI states in sequence,
calls `BrowserWindow.capturePage()` for each, writes the PNGs, and exits.
