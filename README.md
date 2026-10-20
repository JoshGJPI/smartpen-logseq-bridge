# smartpen-bridge

A Windows desktop app (Electron) for reading, finding and editing your handwritten
notes from a NeoSmartpen (Lamy Safari). It captures strokes from the pen over
Bluetooth, transcribes them with MyScript, and keeps every page as a plain JSON file
in a folder you choose: `<data folder>/pages/B###/P##.json`.

> **v3.0.0 (October 2026): reading first.** The app opens on your writing, not on an
> empty canvas. Three destinations, **Library**, **Timeline** and **Editor**, replace
> the old Book View / Books / Timeline modes; the Library opens on your notebooks;
> a header search (Ctrl K) finds pages by text, date or notebook. Your data folder
> opens unchanged: PageDoc files stay at version `"2.0"`. The repository is still
> called `smartpen-logseq-bridge` for history's sake; v1 stored notes in LogSeq, v2
> moved them to the local folder.

## Quick start

1. Build the installer (`npm install && npm run electron:build:win`, output in
   `release/`) or run from source (`npm install && npm run dev`).
2. Settings (gear) → **Data Folder** → Browse, and pick a folder, e.g.
   `Documents/stroke-data`. An existing folder from v2 works as it is.
3. Click **Connect** in the header and pair your pen in the Bluetooth dialog.
4. Write. Live ink switches to the **Editor**; click **Save** when done.
5. Optional: add your MyScript keys (Settings → MyScript Configuration) to
   transcribe handwriting. The free tier allows 2,000 requests a month.

## Finding your way around

The header holds the three destinations, the search field, an **Unsaved** marker
when anything is unsaved, the pen chip (state, battery, Connect) and Settings. The
capture bar (Save, Undo, Delete, Clear, Transcribe, Fetch Notes) appears only when
there is capture work: in the Editor, with the pen connected, or with unsaved work.
The left panel follows the destination and folds to a rail with the chevron or `[`.

### Library: read your notebooks
- **Home**: a card per notebook, with a fan of its most recently written pages, page
  count, when it was written, a **Vol 2** badge for a second volume, and how much is
  transcribed. Sort by Recently written, Name or Most pages. **Recent pages** shows
  what you last opened.
- **A notebook**: every page as a thumbnail, with the day it was written and ✓ when
  transcribed. **Go to page** takes `42`, `P42` or `151b`.
- **Reading a page**: a two-page spread or a single page, as **Strokes**,
  **Transcript** or **Ink + text** (View ▾). Zoom and Fit act on both pages; ← / →
  turn pages. The header says when each page was written; hover a day chip to light
  that day's ink, click it to open that day in the Timeline. With **Times** on
  (View ▾), hovering ink shows when it was written.
- **Transcripts**: edit in place (Tab / Shift+Tab indent), **Copy all** as LogSeq
  markdown, or copy one line and everything under it.
- **Rotate** a page written sideways with the control on its corner (display only).
- **Load into Editor** (the pencil in a page's header) puts the page on the canvas.
- The **Contents** tab in the left panel lists every notebook and page.

### Timeline: read by date
The writing in a date range as one scrolling feed, a card per sitting (writing with
no pause longer than 20 minutes). **Range ▾** picks the span (Latest day, 1, 7 or 30
days, or From / To); the activity strip under it shows every day with ink and lets
you drag the range. **All books ▾** filters notebooks. **Open page** opens a card's
page in the Library; ⋯ loads a sitting, a day or the whole range into the Editor.

### Editor: capture and edit
The live canvas. Strokes from the pen, Fetch Notes (pen memory), pages loaded from
the **Pages** or **Dates** tab, or a Library / Timeline load all land here.
- Select: drag a box (Ctrl adds, Shift removes), Ctrl/Shift+click single strokes,
  Ctrl+A for everything visible.
- Duplicate (Ctrl+D), drag duplicates, and **Create page** from them.
- Delete strokes (marked until Save; 15-minute undo), **Edit Points** to remove a
  single stray point, **Decorative** to filter boxes and underlines.
- Pan with Alt+drag, zoom with Ctrl+scroll; drag page labels to move pages and
  corner handles to resize them (display only).
- **Transcribe** selected strokes or the whole canvas with MyScript; review the
  result in the Transcripts tab.
- **Save** writes each page atomically and append-only: only strokes you deleted are
  removed from disk, and new strokes are de-duplicated by id. The save dialog shows
  exactly what changes per page.
- Export: SVG, JSON or Markdown, and **Export to LogSeq** (see below).

### Search
- **Header field / Ctrl K** (any destination): words in transcripts, dates (`Oct 14`,
  `2026-10-14`, `10/14`, `yesterday`) and notebook names. Results are grouped Pages /
  Notebooks / Days. **Enter** opens the page in the Library (and lights the matching
  line where the page's line links are reliable), a notebook's pages, or a day in
  the Timeline; **Shift+Enter** loads a page into the Editor; **Esc** closes.
- **Transcripts → Search** in the left panel (Ctrl+Shift+F in the Editor) lists every
  transcribed page with Import and Open buttons.
- **Ctrl+F** in the Editor finds a page that is already on the canvas and pans to it.

### Notebooks and volumes
Settings → **Notebooks** names each notebook and, when two physical notebooks share
an NCode book id, says which volume new writing goes to. A volume is its own
notebook everywhere (folder `B388v2`).

### Export to LogSeq (optional)
Settings → **Publish to LogSeq Graph** → choose your graph folder (the JPI Tools
plugin, v1.9.66+, renders the sketches). **Export to LogSeq** in the Editor
publishes only the strokes you select, adds to what the page already has, and never
includes the transcript. LogSeq does not need to be running.

## Data folder

```
<data folder>/pages/
  B3017/P42.json        one PageDoc per pen page (P151b.json: a variant page)
  B388v2/P1.json        volume 2 of NCode book 388
  _aliases.json         notebook names
  _volumes.json         active volume per NCode book
  _orientation.json     page rotations (display only)
  _timeline.json        capture-date index (a cache; safe to delete)
```

Writes are atomic (`.tmp`, rename, fsync). Settings and display preferences live in
the app's local storage; strokes and transcripts live only in the PageDocs. The
format is in [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) and
[CLAUDE.md](CLAUDE.md). A v1 LogSeq export can be imported with
`node scripts/migrate-from-logseq.cjs <folder-of-md-files> <data folder>`.

## Development

```bash
npm install
npm run dev              # Vite dev server on localhost:3000; opens the Electron window on it
npm run build            # production build into dist/, which Electron loads
npx electron .           # run the desktop app from dist/
npm test                 # Vitest, single pass
npm run electron:build   # Windows installer into release/
```

Stack: Svelte 4, Vite, Electron, web_pen_sdk (NeoSmartpen Web SDK), MyScript Cloud
API (proxied through the main process), Canvas and SVG. Web Bluetooth needs Chromium,
which Electron provides.

Debug tracing (pen messages, recognition dumps, render steps) is off by default. In
DevTools run `localStorage.setItem('smartpen-debug', '1')` and reload; errors and
the Activity Log (Settings → Troubleshooting) are always on.

Documentation:

| Doc | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Rules that must not be broken (storage, book keys, dates, rendering) |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Component tree, stores, libraries |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Why each feature is built the way it is |
| [docs/TESTING.md](docs/TESTING.md) | Test inventory and the manual checklist |
| [docs/READING-UX-SPEC.md](docs/READING-UX-SPEC.md) | The v3.0.0 reading-first design |
| [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) | Notebook volumes |
| [docs/NEOSMARTPEN-SDK-USAGE.md](docs/NEOSMARTPEN-SDK-USAGE.md) | Pen SDK usage |

## Troubleshooting

**The pen won't connect.** Check Bluetooth is on, turn the pen off and on, make sure
no other app (Neo's phone app) holds the pen, or remove it from Windows Bluetooth
devices and pair again. A low battery can cause timeouts.

**Ink doesn't appear.** Use Ncode paper and check the pen chip says connected. Ink
written while a Library transcript edit is unsaved is still captured; switch to the
Editor to see it.

**"Folder: not set" or "Folder: missing".** Settings → Data Folder → Browse, or
Verify after moving the folder. Choosing a different folder reloads the Library,
search and Timeline from it.

**A page or notebook is missing from the Library.** Click **Rescan** on the Library
home. Saves made in the app refresh it automatically.

**MyScript fails.** Check both keys in Settings → MyScript Configuration (Test
Keys), that the application is active and has Text recognition, and the monthly
quota. Transcribe fewer strokes at a time if a page returns nothing.

**The canvas is slow.** Above about 2,000 strokes per page, use the page selector to
show fewer pages.

## Version history

- **3.0.0** - Reading first: Library | Timeline | Editor; Library home with notebook
  cards and page grids; page reader with shared toolbar, Go to page, written-on
  ribbon and Ink + text; Timeline range menu and activity strip; global search
  (Ctrl K); slim header, capture bar on demand, collapsible left panel. No data
  format change.
- **2.10.0** - Hover times in Book View; page rotation for pages written sideways
- **2.9.0** - Opens on the Timeline at your most recent day with ink
- **2.8.0** - Neo page backgrounds behind the ink; Timeline order
- **2.7.0** - Book View Timeline: the Dates range as a scrolling feed of sittings
- **2.6.0** - Load the canvas by capture date with stroke-level filtering
- **2.3.0** - Export to LogSeq: manual, selective, additive
- **2.2.0** - Book View transcript editor
- **2.1.0** - Book View: saved pages as spreads, Load into Editor
- **2.0.0** - LogSeq → local-folder storage (PageDoc JSON files)
- **0.3.0** - Electron desktop app
- **0.2.0** - Svelte 4, stroke manipulation, LogSeq database integration
- **0.1.0** - Pen connection, capture, MyScript transcription

## Credits

[NeoSmartpen Web SDK](https://github.com/NeoSmartpen/WEB-SDK2.0) ·
[MyScript](https://www.myscript.com/) · [Svelte](https://svelte.dev/) ·
[Vite](https://vitejs.dev/) · [Electron](https://www.electronjs.org/).
Developed by Josh Gannon.
