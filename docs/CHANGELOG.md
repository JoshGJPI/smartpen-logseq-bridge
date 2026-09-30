# Changelog and Design Rationale

Newest first. Each entry records *why* a change was made, what was rejected, and the
limitations it left behind; the code and `git log` say *what* changed, so per-entry
file lists have been dropped. Current rules distilled from these entries live in
CLAUDE.md (Invariants); the store and library map is in
[ARCHITECTURE.md](ARCHITECTURE.md).

## v2.10 (spike) — Neo page backgrounds in Book View and the Timeline (September 2026)

**Neo's printed pages are drawn behind the strokes in the two read-only views, and
deliberately not in the Editor.** A planner/notebook page is mostly its printed
structure (ruled lines, dot grid, calendar cells); strokes alone lose it. The
Editor sizes a page from its ink, so a fixed paper frame there would have touched
layout, Fit, the page filter and dragged positions — Book View and the Timeline
fit a page to a pane and lose nothing by using the paper. Josh's call: show
backgrounds where things are *read*, not where they are *edited*.

**Where the images come from.** Neo hosts, per notebook, an `.nproj` (XML: each
page's rectangle and `crop_margin`, in 72-dpi points) and a zip of one JPG per
page, in the same public Firebase bucket `web_pen_sdk` uses (`NoteServer.ts`
`getNoteImage`/`extractMarginInfo` — unused by the app until now). No scanning and
no calibration: Ncode unit = 8×7/600 in = 6.72 pt, the JPG covers the rectangle
inset by `crop_margin`, and the result registers with real ink to the pixel
(verified by overlaying stored strokes on books 387, 388, 390 and 3017). Every
image comes out at ~14 px per Ncode unit (150 dpi).

**Storage.** `scripts/fetch-neo-backgrounds.mjs <data-root> 3_27_388 3_1012_3017`
caches them at `<dataRoot>/pages/_backgrounds/<ncodeBook>/{manifest.json,P<n>.jpg}`
(~21 MB for 388's 144 pages, ~23 MB for 3017's 192). The folder is keyed by **NCode
book number, not book key** — volume 2 is another copy of the same paper — and a
letter-suffixed page (`P151b`) uses its integer page's paper. The `_` prefix keeps
it out of `walkPageFiles`. The script refuses a book whose pages are not all one
frame size or are rotated (all four inspected are uniform). The images are Neo's:
cached for personal display, not for committing or redistributing.

**Rendering.** `stores/backgrounds.js` `resolvePageBackground(book, pageId)` →
`{frame, url}` or null (**never throws** — any failure reads as "no background",
which is how every view behaved before). Manifest per book and object URL per page
are cached for the session and cleared by `refreshBackgrounds()`. `PageSpreadView`
substitutes the printed frame for the ink bounds (`frameToBounds`) so the existing
fit/zoom/pan and `strokeToPathD(stroke, bounds)` projection work unchanged, and
draws the `<image>` first. `FeedPart` does the same through a `frame` (the printed
page, else `{0,0,page.width,page.height}` — identical to the old behaviour), so a
strip is a slice of the sheet and the collapsed/expanded modes both show paper.
A **Paper** toggle in the Book View bar (`backgroundsEnabled`, localStorage) only
appears once any book has backgrounds.

**Side effects to expect.** The printed share/mail/bookmark icons are visible, and
a pen tap on them is recorded as a stray stroke there. Paper width changes how big
handwriting is on a card (388's paper is wider than `PAGE_MIN_WIDTH`, 3017's
narrower). The image resolves asynchronously, so a card paints strokes first and the
paper a beat later.

**What Neo's bucket offers (useful beyond this feature).** The `nproj/` prefix is
publicly *listable* (1,016 notebooks, Sep 2026) and a ranged read of a file's first
2 KB gives its `<title>`, so a notebook's id can be found by name without guessing.
The 2026 planner is `3_1012_3207` ("NEO SMART PLANNER 2026 Pro", 192 pp, A5,
uniform, images present) — found, **deliberately not imported**. Its `.nproj` also
defines 5,089 rectangle symbols whose `param` encodes what they are: `ws_YYYYMMDDHH`
(3,710 hourly writing slots, 08–21h, 2025-12-29→2027-01-01), `ms_YYYYMMDD` (monthly
day cells), `crop`/`share` and `bookmark` icons. A stroke's date and hour is therefore
a rectangle lookup, which is the geometry half of a calendar sync. Not built; see
"Open items" in CLAUDE.md.

**Not done:** Home-grid thumbnails and the Timeline's location glyph don't show
paper; no opacity control; SVG export and the LogSeq graph export are unchanged
(no paper); pages with no Neo image (and books other than 388/3017 until fetched)
render as before; nothing downloads from inside the app — it's the script only;
`FeedDay` heights aren't pre-sized for the paper aspect, so a day can shift a little
as its images arrive.

## v2.9 — Book View Timeline: the Dates range as a scrolling feed (September 2026)

**Book View's second mode shows the Dates range as one scrolling column of ink, a
card per sitting, newest first.** The v2.8 date view could only put a range on the
canvas — right for editing, wrong for reading back through a week. Josh's calls
(from an approved mockup): cards are strips that expand to the whole page, newest
first, and **no transcripts on cards** — stored `lineId`s on pages transcribed
before the August stroke→line fix mostly point at the wrong lines.

**A card is a sitting, not a page.** `daySessions()` chains the day's strokes across
all its pages while each starts within 20 min of the previous one's end. It first
also cut on page changes; that doubled the corpus's card count (738 vs 367) purely
from page turns mid-meeting, so a card now shows a **part** (strip) per page
instead. With the final rule: median 2 cards a day, median sitting 21 min (95th pct
83), 160 of 367 cards span several pages. A part's ink covers a median quarter of
the page height — hence strips, not pages.

**Strips cut out blank paper.** Ticking a TODO at the top of a page and another at the
bottom, seconds apart, made a two-stroke card a page tall. `sessionBands()` drops
any blank stretch over `BAND_MERGE_GAP` (≈3 lines), drawn as a dashed cut.

**Browsing follows the range live; loading is explicit** — a card
(`importSessionFromFolder`, a time window over its pages), a day, or the range. All
three switch to the Editor.

**Endless scroll grows the Dates range itself** (`extendFeedRange()`, next 3 days
with ink), not a feed-private extension, so the grid, tallies and Load range always
match the feed. The feed resets to the top only when its *near* end, order or book
filter changes, and the footer has `overflow-anchor: none` so growth never jumps
the view. It fires only on a user scroll or wheel, so opening the feed never widens
a range you picked.

**Lazy loading.** The outline comes from `_timeline.json`. A `FeedDay` within 1.5
screens reads its pages — a whole day at once, because its cards interleave across
pages — and beyond 4 screens releases them, keeping its measured height. Pages go
through the ref-counted `createFeedPageLoader()`, not the Books LRU. Verified over
30 days of the corpus.

**Also fixed — Fit with dragged pages.** `fitToContent()` centred content as if world
space began at 0, but `applyCustomPositions()` leaves bounds at the dragged offsets,
so any page with a saved position fitted off-screen (383px on one real page).

**Not done:** transcripts on cards; an adjustable pause threshold (`SESSION_GAP_MS`
is a constant); `pageScales` in the feed (cards show paper, not canvas layout).

**Testing note:** over CDP with the window covered, `visibilityState` is `hidden`,
which pauses rAF and IntersectionObserver — the feed looks broken when it isn't.
Launch Electron with `--disable-backgrounding-occluded-windows
--disable-renderer-backgrounding`.

## v2.8 — load the canvas by capture date (September 2026)

**A `Dates` tab that loads a span of days' ink onto the canvas, ordered by day.**
The organising unit everywhere else is the notebook; this cuts across it.

**Capture date needed an index of its own.** Every stroke carries `startTime`,
but nothing at page level records when ink was made. `metadata.lastUpdated` is a
file-write time: across the reference corpus it differs from the page's last
stroke by more than a day on **173 of 289 pages**, worst case 163 days, so it
cannot stand in. The only real source is the strokes, i.e. 162MB of files.

`buildTimeline()` in `electron/main.cjs` caches the answer at
`<dataRoot>/pages/_timeline.json`: one `{day: strokeCount}` histogram per page,
plus mtime+size so a refresh re-reads only what changed. Measured on the real
corpus — **cold 917ms, warm 35ms, 60.5KB on disk**, 307,500 strokes across 179
days. Counts are read by regex off the raw text rather than `JSON.parse`, the
same reason `extractPageMeta` slices the strokes array off. `walkPageFiles()` was
extracted so `listAllPages` and the timeline agree on which files are pages.

**Day keys are LOCAL calendar days**, in main (`dayKeyLocal`), in the renderer
(`timeline.js dayKey`) and in `canvas-renderer.captureDayKey` — all three have to
agree or a canvas row would break on a different boundary than the panel
selected. The user picks "17 Aug" meaning the evening they were writing; UTC
would move that to the 18th.

**Filtering is at stroke level, because date does not line up with pages.**
154 of 289 pages hold ink from more than one day, and **74% of day/page pairs sit
on such a page** — so a page-level date filter would drag in mostly-unrelated
writing. `importDateRangeFromFolder()` splits each touched page on `startTime`.

**The rest of the page comes along as context ink** (`stores/context-ink.js`),
drawn halftoned by `drawContextStroke()`. Without it a day's writing floats with
no page around it and is much harder to read. It is deliberately NOT in the
`strokes` store: the index-keyed stores (`selectedIndices`, `deletedIndices`,
point-edit keys) hold positions into `strokes` alone, and it must never be
selectable, savable, exportable or transcribable. It IS passed to
`calculateBounds()` as a second argument so it counts toward a page's **bounds**
(the tile keeps its real size) but never toward its **capture date**, which is
what orders pages — context ink is out of range by definition, so letting it set
a page's date would file the page under writing the user did not ask to see.

**A partial page is safe to save from**, and that is a property of append-only
rather than anything new: saves are keyed by `s{startTime}`, deletions are
explicit, and the one geometry rewrite is gated on `pointsEdited`. The loader
still primes `noteOnDiskStrokeIds` from the page's **full** stored stroke list,
so the strokes left behind are not reported as pending anything. **Transcription
is the exception** — MyScript only sees what is loaded, so `ActionBar` warns when
a page being transcribed carries context ink.

**Page order became pluggable.** `setPageOrder('date')` sorts pages by the
earliest `startTime` among their *loaded* strokes, and rows break on a change of
day as well as at `pageColumns`, so a range reads as one row per day. The page
label gains the date in that mode — rows group the pages but don't name the day.

**Loading merges, never replaces** — the same rule as "Import Strokes", so a
date load cannot discard unsaved work. Above 12,000 strokes the button asks a
second time (median day ~1,500, median week ~7,900, a busy month ~50,000).

**Phase 1 scope — one tile per page.** A page spanning two selected days appears
once, filed under its first day in range. Splitting it into a tile per day needs
a display-only page key threaded through the renderer without touching
`pageInfo`, which save routing, the page filter and stored page positions all
key on; deferred until this has been used.

## Stroke→line matching — two coordinate spaces, compared as one (August 2026)

**`strokesIntersectingLine()` in `save-page.js` compared a transcript line's
`yBounds` directly against stroke point Y values, which are not in the same
space.** Stroke points are raw Ncode (~2.4mm per unit); `line.yBounds` are
MyScript JIIX **millimetres**, measured from wherever `convertStrokesToMyScript`
put the top of the batch it sent. Across the saved corpus the raw millimetre
values fall outside the page's own stroke bounds on 84 of the 96 transcribed
pages, so the `lineId` written onto each stroke recorded whichever line happened
to collide numerically.

**The fix** converts through `yBoundsToNcode()` (`myscript-api.js`, added for the
transcript editor's stroke preview) before matching. Two things it needed:

- **The origin is the batch's, not the page's.** `yBoundsToNcode` anchors on the
  min Y of the strokes actually *sent* for recognition. The ActionBar sends
  untranscribed strokes only, so a page being topped up has a batch that starts
  partway down and the page's own bounds are the wrong anchor — off by the
  distance between them. **`batchOriginY()` in `myscript-api.js` is the single
  definition of that anchor**: `convertStrokesToMyScript` uses it to build the
  request, and `setPageTranscription` calls it on the strokes it was handed and
  stores the result as `originNcodeY`, so the value is measured once, where it is
  known exactly. `transcriptionOriginY()` prefers that; it re-derives from
  `transcribedStrokeIds` for entries predating the field, and falls back to the
  whole page when there is neither. Measuring at recognition time rather than at
  save time matters because the strokes can change in between — delete or
  point-edit the topmost one and a re-derived anchor slides up the page, taking
  every line's position with it.
- **Ties needed a rule.** With the coordinates right, 56% of matched strokes
  touch more than one line — ascenders, descenders, anything tall. The old code
  let the last line considered win, which on the corpus disagrees with
  "most-overlapping line" 64% of the time. Matching now returns the overlap and
  the largest wins; the value goes negative for a tolerance-only match, so the
  same comparison also means "else nearest".

**Tolerance is `LINE_MATCH_TOLERANCE_NCODE = 1`**, replacing a `tol = 5`
documented as "pen-unit" that was never in any real unit. 5 Ncode units is
~12mm — two lines' worth on either side, on pages whose recognised lines are
2.4–5 units tall. 1 unit matches `TranscriptStrokePreview`'s `Y_TOLERANCE`
deliberately: the preview and the saved link answer the same question and must
not disagree.

**`mergeTranscript`'s duplicate test was left as it stands.** It compares
yBounds to yBounds, so both sides are millimetres and its `3` really is 3mm —
under half a line height, the right order for "the same line, recognised again".
Its blind spot is documented rather than fixed: two batches with different
origins put the same physical line at different millimetre values, so a re-run
over a shifted batch can slip a duplicate past the Y test. Exact text still has
to match, which is what keeps that rare.

**Existing files are left alone — Josh's call, 2026-08-26.** 81% of the 108k
stroke `lineId`s on disk would change under the corrected mapping, but a repair
can only re-derive them where the batch origin is recoverable: 37 of 97 pages
visibly show multiple batches (their line yBounds restart partway down the
list), and pages written before the v2.2 merge-ordering fix had their lines
re-sorted by Y, which *hides* that signal on the other 60. Nothing is at risk in
the meantime — no save path rewrites geometry off a lineId,
`getUntranscribedStrokes()` only checks whether a link *exists*, and LogSeq
export clears them. **Known limitation:** on pages transcribed before this fix,
`TranscriptStrokePreview` highlights the wrong strokes for a line, because it
prefers the stored link over its own (now correct) Y-overlap fallback.
Re-transcribing a page fixes that page.

**The confirming modal's preview uses the real origin** (`TranscriptStrokePreview`
gained a `batchOriginY` prop, threaded through `TranscriptionEditorModal` from the
`pageTranscriptions` entry). It has to be chosen **per line**, not per page: the
editor shows a mix of lines from disk and lines from the batch being confirmed,
and only the latter were measured against it. The flag for that is `fromBatch`,
set in `TranscriptionView.mergeExistingAndNewLines` — deliberately **not**
`syncStatus === 'new'`, which `splitLine` also sets on the second half of a split
whose yBounds it inherited from a disk line. `mergeLines` carries `fromBatch` only
when every merged part had it, since a combined yBounds spanning both sources
belongs to neither origin. A line without it still gets the whole-page guess,
which is all that is available for a saved transcript.

## v2.7 — UI reorganisation: panels, not toolbars (August 2026)

**Every long-lived list got a panel; the canvas toolbar and settings dropdown
stopped being the dumping ground for them.** The toolbar carried twelve controls
across four unrelated concerns; the dropdown had seven sections, two of which
(`BookAliasManager`, `VolumeSettings`) were unbounded lists that grow with every
notebook — the wrong container for a list you scroll.

**Left panel flattened to one tab row.** The outer *Data Explorer / Activity Log*
level went when the log moved to Settings → Troubleshooting, leaving nothing to
switch between. Tabs are now Strokes · Transcripts · Pages · **Books**.

**Books tab** merges aliases and volume routing into one row per NCode book —
they answer the same question. Two things it fixed rather than moved:
- **Volumes are named independently.** Aliases were always keyed by book *key*,
  so `"388"` can be *Site Visits* while `"388v2"` is *Load Calcs*.
  `formatBookName()` falls back to the parent's name + volume suffix only while a
  volume has no name of its own.
- **A volume can be named before it is used.** The old manager listed only
  `knownBookIds` (books with pages on disk), so a notebook you had just made
  active had no row. Volume rows now come from `volumesForBook()`, which includes
  the active volume at zero pages.
- The **destination folder** (`pages/B388v2/`) sits beside the active volume: the
  failure volumes exist to prevent is writing into the wrong notebook.

**Transcripts panel** is Review (incoming MyScript results — the old
`TranscriptionView` unchanged) plus Search (the old modal, unwrapped). Mode lives
in a store so the canvas can route straight to Search and so leaving the tab and
returning keeps your half.

**Canvas split by what each bar acts on.** Top = identity and selection
(Volume ▾ stays there deliberately — it decides which physical notebook a stroke
belongs to and is worth keeping in view). Bottom = rendering, so sketch marking
sits beside the `SketchStylePopover` that tunes it; the popover means the live
preview and the strokes it restyles are finally on screen together, which the
settings dropdown could never manage. Exports folded into one `Export ▾`.

**Two searches, kept separate on purpose** — see "Left panel tabs" above.
`CanvasSearch` matches notebook name, page number and transcript text over loaded
pages only, entirely from memory (fresh MyScript results, else the
`transcriptionText` the metadata-only scan already carries), and **pans** to the
result. It reveals a page hidden by the page filter first, otherwise the view
centres on something not drawn. In text view the term is highlighted on the page
itself via `drawPageText(pageKey, text, highlight)` — word wrapping happens
first, so a phrase broken across a wrap boundary finds the page but marks nothing.

**Unloading one page from the canvas** (hover a page chip in the filter → ✕).
The button was the easy half; the work was index safety — see `stores/canvas.js`
in the Stores section. `adjustDeletionsAfterRemoval()` is the load-bearing part:
an unshifted deletion mark silently deletes a *different* stroke at next save.

**Reset labelling.** "Reset" on the bottom bar read as though it covered page
layout too. It is now **Reset View**, and `⋯` became **Page Resets ▾** with a
hint on each item naming what it acts on.

**Deleted (7):** `SearchTranscriptsDialog`, `TranscriptSearchResult`,
`BookAliasManager`, `VolumeSettings`, `ActivityLog` (the dialog filters entries,
so it renders them itself), and the pre-existing dead `Sidebar` +
`MyScriptSettings` — the latter a near-duplicate of the MyScript block inlined in
`SettingsDropdown`, so editing it appeared to do nothing.
**Known orphan:** `PenInfo.svelte` was only imported by `Sidebar` and is now
unreachable. Left in place pending a decision.

## Volumes — telling apart notebooks that share an NCode book id (August 2026)

**NCode identifies a paper design, not an object.** Two identical Lamy notebooks
report the same `book` id and the same page numbers, so page 12 of the second
merged into `pages/B388/P12.json` alongside page 12 of the first. Nothing was
destroyed (append-only dedupes by `s{startTime}`, and timestamps never collide)
but the two notebooks' strokes were drawn on top of each other, permanently
interleaved, and re-transcribing produced nonsense.

**A volume is a suffix on the book key.** `pages/B388/` is volume 1;
`pages/B388v2/` is volume 2. In memory `pageInfo.book` carries the key as a
**string**; on disk it stays a *number* with an optional `volume` field, omitted
when 1. So `validatePageDoc`'s `typeof book === 'number'` check is unchanged,
`PAGE_DOC_VERSION` stays `"2.0"`, and **every existing file is byte-identical.
There is no migration** — an absent `_volumes.json` means every book is volume 1,
which is exactly how the app behaved before.

**Why the ~30 page-key sites didn't need touching.** They're template literals
(`` `B${pageInfo.book}/P${pageInfo.page}` ``), and a template literal interpolates
a string as happily as a number. What broke was the much smaller set that does
*arithmetic* on `book` or regex-parses a key with `\d+`. Both fail quietly:
- **No match** — `main.cjs`'s directory scan (volume dirs invisible),
  `pending-changes.js`'s lazy backfill (**every volume stroke reports as a new
  addition on every save, forever**), `canvas-renderer`'s page-layout comparator
  (`return 0` against everything → arbitrary left-to-right order).
- **Partial match** — unanchored `/B(\d+)/` matches `B388` *inside* `B388v2` and
  confidently returns 388. A plausible wrong value, which is worse.

`BOOK_KEY_FRAGMENT` in `volumes.js` exists so this can't come back. **Use it;
don't hand-write `\d+` for a book.** A grep sweep after the first round of edits
turned up five more sites than the original inventory — assume any such list is
incomplete.

**Book keys are strings *including* volume 1**, deliberately. A mixed
number/string type would have contained the blast radius, but only by delaying
discovery until volume 2 was actually used — i.e. on the one notebook with the
least redundancy. All-strings makes a missed coercion fail immediately, across
data that's easy to eyeball. (`pageId` was already a string throughout, so this
is an established pattern here, not a new one.)

**Reassignment is a move, not a copy — and that took work.** Selecting strokes
and picking a volume rewrites `pageInfo.book`, which makes them an *addition* to
the target. But under append-only, missing-from-canvas never means
deleted-on-disk, so the source page keeps its copy and the stroke ends up in
**both volumes**, silently — worse than the mis-filing being fixed. The fix is the
in-memory `movedFrom` marker (same shape as `pointsEdited`; `strokeToStored()`
builds from a fixed key list so it can't reach disk).
`getMovedAwayStrokeIdsForPage()` reads it and the caller unions the result into
`deletedStrokeIds` — the same operation, so the existing deletion machinery is
reused rather than extended. Consequences:
- A fourth pending-changes category, `moves`, attributed to the page a stroke
  *left*. It has to synthesise that page's entry: after a whole-page move the
  source has no canvas strokes, so the grouping pass produces nothing for it and
  it would vanish from the save dialog entirely.
- **Move sources are force-included in `SaveConfirmDialog`** (checkbox disabled,
  `required` tag). Saving only the target is exactly the two-volumes failure.
- `startTime`/`endTime` survive so the `s{startTime}` id is stable — the source
  deletion matches on it. `blockUuid` is cleared; it points at a transcript line
  on the source page.

**Whole-page moves work by selecting every stroke** (Josh's call — no separate
page-move tool). Two things strokes don't carry: the **transcript** lives in
`doc.transcript.lines`, and the emptied **file** lingers as a 0-stroke ghost.
`planPageMove()`/`finalizePageMoves()` handle both, running *after* every page
save so they can't race the writes. The transcript is carried only when the
source ends genuinely empty, exactly one target received its strokes, and the
target has no transcript of its own — splitting one by guesswork would be worse
than leaving it put.

**Live preview needed the same remap as capture.** `canvasRenderer.addDot()`
builds its own page-group key from the raw dot, so without it live ink lands in
`B388/P12` while the finalized stroke lands in `B388v2/P12` — two page borders,
ink that jumps on pen-up. Invisible in review, obvious in use. The remap stays
*out* of the transport path (`normalizeBookId`, transfer matching, pen-memory
keys), which must keep the raw NCode id.

**`book` became a path-injection surface.** It used to reach `pagePath()` via
`parseInt` and was inherently safe; as a string it isn't. `requireBookKey()` /
`requirePageId()` in `main.cjs` are what keep page reads and writes inside the
data root.

**Also fixed:** `getAliases()` normalised keys with `Number()` while `main.cjs`
wrote `String(book)` — `Number("388v2")` is `NaN`, so volume aliases would have
been destroyed on every scan. Keys now pass through unchanged (a latent
inconsistency already; `publish-graph.js` hedged around it).

**Known limitation — permanent:** if you write in physical volume 1 while the
active pointer says volume 2, nothing can detect it. The pen cannot tell the
notebooks apart; that's the premise. Reassignment is the remedy, not prevention.

**Verified on hardware (2026-08-07):** live capture with a volume active (ink
stays in one page group through pen-up — the trap where the renderer builds its
own page-group key from the raw dot), volume definition, and canvas reassignment.

**⚠️ Offline import is UNVERIFIED.** Nothing is known broken; it just hasn't been
run against the pen since volumes landed, and it's the riskiest untested path.
The remap was deliberately kept *out* of the transport layer (`normalizeBookId`,
transfer matching, pen-memory keys all still use the raw NCode id) because
multi-book offline import has a history of subtle bugs — see the April 2026
fixes. Check in order: a multi-book batch still imports completely; strokes land
in the active volume; and reassignment works on *imported* strokes (the path
where a copy already exists on disk, so the `movedFrom` deletion actually has to
fire). See docs/VOLUMES-SPEC.md §11.

**Not done:** volume 2+ **LogSeq export is refused** with a readable message
(`requireGraphBook`) — `smartpen-index.json` carries a numeric book and the JPI
Tools plugin needs a matching change. The plugin spec is deliberately deferred
until this has been used against real notebooks. Also deferred: timestamp routing
for offline import (a batch spanning two volumes currently needs manual
reassignment — promote this if it proves annoying), and the per-book selector in
`BookSelectionDialog`.

**See:** [docs/VOLUMES-SPEC.md](docs/VOLUMES-SPEC.md) — full design, plus the
rejected alternatives (arithmetic remap, decimal book ids, volume on the page
suffix) and why each fails.

## Point editing — delete a single stray point from a stroke (August 2026)

**The pen sometimes emits a dot at the Ncode origin partway through an otherwise
sound stroke.** The renderer joins consecutive dots, so one bad sample draws two
long lines out to the page's top-left corner and back, straight through the notes.
The only previous remedy was deleting the whole stroke, losing real handwriting.
The canvas now has an **Edit Points** mode: the selected strokes' individual points
become clickable handles, and single points can be deleted while the rest of the
stroke stays intact.

Note this is a *renderer* artifact of a bad sample, not the SDK's known invalid
pen-down dot — `processDot()` already filters `{x: -1, y: -1}` (see "NeoSmartpen
SDK — Invalid Pen-Down Dot"). These points arrive with plausible-looking data.

**In-canvas, not a modal.** A stray point is identified by *where it sits*
relative to the surrounding writing, and the canvas already has the zoom, pan and
box-select to do that. The numeric half of the job — a point at `0.00, 0.00` is off
in a page corner and easy to miss at fit-to-page zoom — is covered by
`PointEditPanel`, which lists each suspect point with its coordinates and centres
the view on it when clicked.

**Geometry became mutable, in exactly one place.** Everything else about the save
path is unchanged and still append-only:
- `removeStrokePoints()` in `stores/strokes.js` is the sole mutation. It stamps the
  stroke with an in-memory `pointsEdited` marker, and `savePageToFolder()` rewrites
  a stored stroke's `points` **only** for marked strokes. Deliberately *not* keyed
  on "the canvas copy has fewer points than disk": append-only exists so partial
  canvas state cannot destroy stored data, and a count comparison would hand that
  power to any future code path that filters a dotArray for its own purposes. The
  existing test asserting points are never rewritten still passes unchanged —
  which is the point.
- **Identity survives.** `startTime`/`endTime` are preserved even when the first or
  last point goes, so the `s{startTime}` id is stable. Re-deriving it would orphan
  the stroke from its transcript line and re-import it as a duplicate. (The stray
  is usually the pen-down sample, so this is the common case, not an edge one.)
- **Sketch data survives.** Each surviving point keeps its `f` (pen force), so
  `strokeToStored()` re-emits full `[x, y, ts|null, force]` tuples and a flagged
  stroke still tapers. The `_sw` width cache and `_nb` bounds cache are dropped so
  both recompute for the shorter series.
- A stroke can't be reduced below 2 points — there'd be no line to draw. Those
  removals are refused and reported rather than leaving an invisible stroke.

**Reported as its own status.** `additions`/`modifications`/`deletions` gained
`edits`: strokes already on disk whose geometry shrank. Separate from
`modifications` (a sketch-flag toggle) because saving an edit *overwrites captured
data*, so it earns its own amber **Editing** total, a per-page "✎ N edited" stat and
an explicit warning in the save dialog. Every stroke lands in exactly one bucket:
new-and-anything is an addition, edited-and-reflagged is an edit.

**The diff is self-clearing.** `onDiskStrokeIds` entries carry a point *count*
alongside the sketch flag, so an edit is detected by comparing counts and the
post-save index refresh ends the "edited" state on its own — no flag to reset.
`clearPointEditMarkers()` still runs after a successful save to keep the intent
marker honest, guarded by a cheap pre-check so it doesn't republish the strokes
array once per saved page for the common case of no edits.

**Detection is advisory.** `detectStrayPoints()` flags `origin` points (at/near
(0,0), or non-finite) and `jump` points (far from both neighbours). The jump test
needs an absolute floor as well as a relative one: a comma whose points are 0.2mm
apart and whose tail travels 3mm is a 15× jump by the relative measure, and
offering that for deletion would be worse than missing a candidate the user can
still click by hand.

**Known limitation:** a stroke already exported to the LogSeq graph keeps its
uncorrected geometry there. `mergeGraphStrokes()` dedupes by stroke id and lets the
existing published copy win, so a re-export is a no-op. Correcting a published
sketch would need a deliberate overwrite path in `graph-export.js`.

## Pending-changes `modifications` — flag-only edits are reported (August 2026)

**The dirty-state diff grew a third category.** It classified each canvas stroke
as an *addition* or a *deletion*, which was the whole story until sketch strokes
introduced a per-stroke flag the user toggles **after** a stroke is already on
disk. That edit is neither: the stroke count doesn't move, but
`savePageToFolder()` does sync the flag onto the stored stroke, so it is genuinely
unsaved work. It was reported nowhere except the header's amber dot — no `*` on
the canvas page label, no row in the SaveConfirmDialog, undercounted in
`getPendingChangesSummary()`. Data was never at risk (`setStrokesSketch()` calls
`markUnsavedChanges()`, so the beforeunload prompt fired); it was purely a
reporting gap.

**What landed:**
- **`onDiskStrokeIds` now carries state, not just ids** — `pageKey →
  Map<strokeId, {sketch}>` (was `Set<strokeId>`). The perf #3 constraint is
  unchanged and still the reason this index exists: entries are flag-sized
  records, never strokes, so the corpus stays off the heap. `points` is what
  makes strokes expensive and geometry is immutable under append-only, so there
  is nothing to diff there — **keep any future field in this record similarly
  small.** Lazy populate on canvas entry / evict on canvas exit via the
  `canvasPageKeys` subscription is untouched. `noteOnDiskStrokeIds()` keeps its
  signature; both callers (`load-page.js` import, `save-page.js` post-save)
  already held the stored strokes.
- **`computePendingChangesMap()` emits `modifications: number[]`** — stroke
  indices whose id IS on disk but whose sketch flag differs from the stored
  value. **Counted once:** a stroke that is both new and flagged is an addition
  only, since saving writes the stroke and its flag together. A page unknown on
  disk reports no modifications (nothing to differ from), and a stroke marked for
  deletion is excluded from the flag diff. `sketch` is absent rather than `false`
  when off, on disk and on the canvas, so the comparison is boolean-normalised at
  both ends.
- **Threaded through every consumer** — `hasPendingChanges`,
  `getPendingChangesSummary()` (new `totalModifications`; a modification-only page
  now counts toward `pagesWithChanges`), and the `*` label in
  `drawPageBorders()`.
- **`page-changes.js` too** — SaveConfirmDialog does **not** read
  `pendingChanges`; it runs its own diff against the PageDoc on disk via
  `computePageChangesFolder()`. That is a second implementation of the same
  question and needed the same third category, so it returns
  `strokeModifications` (and the error fallback reports `0`). The dialog shows a
  "Restyling: ~N strokes" summary tile and a per-page "✏️ N restyled" stat, and
  its change filter includes modification-only pages so they are selectable and
  actually get saved. `strokeTotal` is unaffected — a flag toggle doesn't change
  how many strokes a page holds.

**Tests:** `pending-changes.test.js` extended (flag on, flag off, absent-vs-false,
matching flag, new-and-flagged counted once, unknown page, deleted stroke,
mixed page, modification-only page enters the map). New `page-changes.test.js`
covers the dialog's diff path, which had no tests at all.

## Sketch strokes — pressure-varying line thickness (August 2026)

**Strokes can be flagged as "sketch" and render with a thickness that follows the
pen force recorded at each point**, rather than one uniform width per stroke.
Handwriting is unaffected and keeps the cheap single-path render.

**The bug this uncovered.** `canvas-renderer.js` assigned `ctx.lineWidth` inside
its `moveTo`/`lineTo` loop. Canvas2D reads `lineWidth` once, at `stroke()` time,
and applies it to the whole path — so the assignment did nothing except leave the
last value in effect, and *every stroke rendered at the width implied by its final
dot's pressure*. The same pattern was in `drawPastedStroke` and
`drawStrokeInternal`. `addDot()` (live capture) stroked each segment separately so
it genuinely did vary, which is why live writing and re-render disagreed. All four
paths now go through explicit, deterministic width handling.

**Storage.** Pressure was previously discarded at the storage boundary
(`strokeToStored` wrote `[x, y, ts]`; load injected a constant). Point tuples are
now `[x, y, ts|null, force]` — variable length, so 2- and 3-element tuples from
existing files still read. Force is written for **every** stroke, not just flagged
ones: flagging happens long after capture, so conditional pressure would make
marking a stroke later silently produce a flat line. `PAGE_DOC_VERSION` stays
`"2.0"` — both additions are backward/forward compatible and bumping it would make
`validatePageDoc()` reject every file on disk. Pages saved before this render at a
constant `flatWidth`; `seriesHasVariation()` detects them (an unvarying force
series is not real data) and `widthsForStrokeSeries()` is the single definition of
that fallback, shared by the canvas and both SVG paths.

**The mapping** (`src/lib/sketch-width.js`, pure, 51 tests) is a pipeline:
normalise against a user-calibrated `pressureFloor`/`pressureCeil` band → smooth →
shape by `gamma` → scale into `minWidth`…`maxWidth` → slew-limit.
- `minWidth`/`maxWidth` are the brush-vs-pen control: a narrow band reads as a
  technical pen, a wide one as a brush.
- `gamma` is the response character: `<1` broadens readily (brush), `>1` stays thin
  until pressed hard (pencil). Exposed in the UI as a Brush↔Pencil slider.
- **Spike suppression** needed its own mechanism. Clamping `maxWidth` only caps how
  fat a jab gets, not how abrupt it is. `smoothSeries()` is a *symmetric* moving
  average (a trailing EMA would make the taper visibly lag the pen path) and
  `limitSlew()` bounds the per-point rate of change, running forward then backward
  so both flanks of a spike are bounded.
- Calibration is user-settable because the pen's real force range is not
  documented anywhere trustworthy — the SDK reads it as a 16-bit short and the
  historical code divided by 500 on what looks like a guess.

**Rendering.** Variable width means splitting the polyline: both Canvas2D and SVG
apply one width per path. `strokeVariableWidth()` (canvas) and
`strokeToWidthRuns()` (SVG) batch consecutive segments whose widths quantise to the
same value into one run; runs share boundary vertices and round caps join them
seamlessly. This collapses a 50-dot stroke from 49 draw calls to a handful. Widths
are cached per stroke, tagged with `profileKey()`, so dragging a slider restyles
the canvas live and anything else reuses. Deleted/decorative sketch strokes fall
back to the uniform path — dash patterns restart per sub-path, so a dashed
variable-width stroke would come out as uneven stipple, and the dash is the more
important signal there.

**Deliberately not done:** no live sketch preview. Strokes aren't flagged until
after they're drawn, so live capture has nothing to consult; it draws at the
uniform handwriting width and flagging changes appearance on the next render.

**Reported as a modification** (was a known gap; closed — see "Pending-changes
`modifications`" below). Toggling the flag on an already-saved stroke is a real
unsaved change that is neither an addition nor a deletion, so the diff grew a
third category rather than mislabelling it as one of the other two.

**Cross-repo:** exported LogSeq assets now carry pressure and the sketch flag
(asserted in `graph-export.test.js`), but the JPI Tools plugin's SVG generator
needs a matching change or graph renders stay flat.

## Copy transcript from the canvas (July 2026)

Copying a transcript for LogSeq used to be possible only in Book View's
`TranscriptPane`, so a page loaded in the Editor had no copy path. The canvas
**text view** (`📝 Show Text`) now offers the same copy:

- **Per-page button** — `renderTranscribedText()` in `StrokeCanvas.svelte` now
  collects `renderer.getPageBoundsScreen(pageKey)` for every page whose text
  actually rendered into `textPageOverlays`, and the markup positions a faint
  `📋 Copy` button (`.page-copy-btn`) in each page's top-right corner. Positions
  are recomputed on every paint, so they follow pan/zoom/page layout; overlays
  are dropped when leaving text view.
- **Header button** — `📋 Copy Transcript` copies every page currently rendered
  in text view (`pagesToLogseqMarkdown`: a single page pastes bare, several nest
  under `- {book} · P{page}` parent bullets).
- **Line source** — MyScript results already carry structured `lines`; saved
  pages are metadata-only records, so `resolveTranscriptLines()` lazily reads the
  PageDoc via `getCachedPage(book, pageId)` (suffix-safe) to get indent levels
  and TODO/DONE state, falling back to `textToTranscriptLines()` on the rendered
  text if neither is available.

## Clear-canvas fixes (July 2026)

Two bugs that only showed up after using **Clear** and then importing again.

- **Stale "In canvas" state.** `importStrokesFromFolder()` stamped
  `syncStatus: 'in-canvas'` onto the `savedPages` record and nothing ever unset it,
  so the badge stayed lit after the canvas was cleared. Canvas membership is now
  derived (`canvasPageKeys` in `stores/strokes.js`) and surfaced by **greying out
  Import Strokes** instead of a badge — the badge pill squeezed the page title out
  of the card header. `SyncStatusBadge.svelte` deleted (no other users);
  `updatePageSyncStatus()` remains for a future `'unsaved'` state but is
  currently uncalled.
- **Pages piled at the origin.** Page layout (`calculateBounds()` → `pageOffsets`)
  is only recomputed by a full-reset render, whose sole trigger in
  `StrokeCanvas.svelte` was `visibleStrokes.length > previousStrokeCount`. Clear
  didn't reset `previousStrokeCount`, so importing a page with fewer strokes than
  were cleared never counted as "strokes added": the renderer kept the cleared
  pages' offsets, the new page had none, and `getScreenCoords()` fell back to
  global bounds — everything drawn on top of everything else until the user hit
  Reset Layout. The reactive block now detects the canvas emptying (via
  `$strokeCount`, so page-filter toggles keep their existing no-repack behaviour),
  full-resets to drop the stale layout, zeroes `previousStrokeCount` so the next
  import is treated as a first load (layout + auto-fit), and clears
  `liveWritingViewSet` so live writing re-anchors on a fresh canvas.

**Known gap:** `handleClearCanvas()` in `ActionBar.svelte` doesn't clear
`selectedIndices`, so a pre-clear selection still holds raw indices that point at
whatever is imported next.

## v2.3.0 — Export to LogSeq: manual, selective, additive (July 2026)

**Replaced auto-publish-on-save with an explicit stroke export.** The graph copy
is no longer a mirror of the notebook — it is a curated *book of sketches*
containing only what the user chose to publish. The bridge's `stroke-data/`
folder remains the complete digital twin.

**Why:** mirroring every save pushed private notes into the graph and offered no
way to publish just a sketch. The user wants to select strokes, send those, and
add more to the same page later.

**What landed:**
- **`graph-export.js` (new)** — the export policy. **Additive**: every export
  merges into the page's existing graph asset, deduplicated by stroke id, so
  sketches accumulate on a page and re-exporting an overlapping selection is a
  no-op. **Transcript-free**: `transcript.lines` is always emptied and every
  `lineId` cleared — recognised text is exactly the private content selective
  export exists to keep out of the graph (the plugin surfaces it via
  `copySmartpenTranscript`). Multi-page selections fan out to one merge+write
  per page; strokes lacking `pageInfo` are counted as orphans, not dropped.
- **`publish-graph.js` (rewritten)** — now transport only: `readGraphPage()` +
  `writeGraphPage()`. Throws on failure (was best-effort/never-throws) because
  export is now a deliberate action, not a background side-effect.
- **`storage:readGraphAsset` IPC (new)** — additive merge needs to *read* the
  published asset; only `readGraphIndex` existed. Book/pageId validation
  extracted into `requireGraphBook`/`requireGraphPageId` and shared with
  `publishToGraph`.
- **Decoupled from save** — the `publishPageToGraph()` call in `local-store.js`
  `savePage()` is gone, along with the `publishToGraph` setting and its toggle.
  `graphRoot` stays as the export target.
- **UI** — "⇪ LogSeq" button in the canvas export toolbar (uses the same
  `$hasSelection ? $selectedStrokes : visibleStrokes` rule as SVG/JSON/MD), and
  a per-page "⇪ LogSeq" button on `PageCard` for whole-page backfill of pages
  saved before this existed. Both disabled until a graph folder is verified.
- **Region cropping stays in LogSeq** — the plugin renders a sub-region from
  bounds in `{{renderer :smartpen-sketch, …, minX, minY, maxX, maxY}}`, chosen in
  the Visualizer where the result is visible. The bridge only decides *which
  strokes exist* in the graph.

**Also fixed:** `selectRange()` in `stores/selection.js` referenced
`removedIndices`/`sorted` — undefined in that scope, so **every Shift+click range
select threw a ReferenceError**. The block was a copy-paste of the tail of
`adjustSelectionAfterDeletion`; `selectRange` now just sets the anchor to the
range end, and the deletion-shift logic was restored to
`adjustSelectionAfterDeletion`, which had been silently leaving
`lastSelectedIndex` stale after a delete.

**Supersedes** the June 2026 "Publish to graph" entry below — the asset/index
file format and the plugin contract are unchanged; only *when* and *what* the
bridge writes changed.

## v2.2.0 — Book View transcript editor: ordering fix + editing UX (July 2026)

**Fixed scrambled transcript order on re-transcribe, plus a batch of Book View
transcript-editor improvements.**

**Transcript merge ordering (bug fix):**
- `mergeTranscript()` in `save-page.js` used to re-sort the **entire** merged
  list (existing + new lines) by `yBounds.minY` after appending. That scrambled
  the established order — new MyScript lines interleaved into the existing
  transcript by vertical page position, and any line missing `yBounds` (→ `0`)
  jumped to the top. Now existing lines keep their order untouched; only the
  **new** lines are sorted among themselves and **appended to the end**. New
  transcription always lands at the bottom, matching the "append" mental model.

**Book View transcript editor (`TranscriptPane.svelte`) UX:**
- **Vertical reordering** — move a line up/down via ↑/↓ row buttons or **Alt+↑ /
  Alt+↓**. `saveTranscriptLines()` → `recomputeParentIds()` keeps the hierarchy
  consistent after a reorder.
- **Strokes shown alongside while editing** — clicking **Edit** on a page's
  transcript makes the companion Book View slot show *that same page's strokes*
  for reference. The editor keeps its slot (draft preserved); only the companion
  slot remounts. Works in Single and Spread modes. Coordinated in
  `BookViewer.svelte` via `editingSide` + slot resolution; `PageSpreadView`
  forwards a `onEditingChange` signal up from `TranscriptPane`.
- **Removed the TODO/DONE toggle** from the editor (existing `checked` state is
  still preserved in data and rendered read-only in display mode).
- **Full-width line inputs** — the per-row action group (reorder/indent) now
  floats over the right edge of the input, revealed on hover / `:focus-within`
  with a feathered white backdrop, so text uses the whole row at rest.
- **Add / Delete block moved to the `.tp-toolbar`** — **Delete** acts on the
  focused line (disabled when nothing selected or only one line remains).
  **Add** is always active: adds a **sibling** after the selected block's whole
  subtree, or **appends to the end** when nothing is selected. Toolbar buttons
  use `on:mousedown|preventDefault` so they don't blur the focused line
  (`activeIndex` tracks it).
- **Page-turn arrows confined to `.tp-body`** — in transcript mode `.pv-nav`
  gets a top offset (`.below-toolbar`) so the prev/next arrows no longer overlap
  the toolbar's Edit/Copy/Save buttons.

## Publish to graph — close the loop with the JPI Tools plugin (June 2026) — SUPERSEDED by v2.3.0

> **Historical.** The auto-mirror-on-save described here was replaced in v2.3.0 by
> the manual, selective, additive **Export to LogSeq** flow. The asset/index file
> format and plugin contract below still apply; the `publishToGraph` setting and
> the `savePage()` hook no longer exist.

**Optionally mirror each saved page into a LogSeq graph as plugin assets.** The
JPI Tools LogSeq plugin (v1.9.66+) went "page-less": it reads smartpen strokes
from graph **assets** and discovers pages from an index manifest, not from
in-page chunked JSON. This feature lets the bridge publish directly into the
graph on every save, so newly-captured pages are renderable in LogSeq without the
one-shot `migrate-smartpen-assets.mjs` step.

**What landed:**
- **Settings:** `graphRoot` (folder picker, mirrors `dataRoot`) + `publishToGraph`
  toggle ("Publish to LogSeq graph on save"), persisted to localStorage. New
  `GraphFolderSettings.svelte` section in the Settings dropdown; boot-time folder
  verification in `App.svelte` (`checkGraphFolder`).
- **On save (when enabled)** the bridge also writes two files into the graph
  (pure filesystem, atomic `.tmp`+rename, no LogSeq runtime):
  1. `<graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-B{book}-P{pageId}.json`
     — the PageDoc **verbatim** (same `serializePageDoc` hybrid serializer).
  2. `<graphRoot>/assets/storages/logseq-plugin-jpi-tools/smartpen-index.json`
     — the discovery manifest, with this page's entry added/replaced and the book
     alias merged (plugin spec §4.6). **No transcript outliner / thin `.md` page**
     — transcript stays inside the asset.
- **Single choke point:** publish is fired from `local-store.js` `savePage()`, so
  every save path (capture save, Book View transcript edits, page-card rewrites)
  mirrors automatically. **Best-effort** — `publishPageToGraph` never throws; a
  graph-write failure logs a warning but never fails the bridge save.
- **Letter-suffixed pages** (`P151b`) preserved on the asset name + index entry;
  identity (`book`+`pageId`) comes from the bridge filename, never `doc.pageInfo`
  (mirrors `migrate-from-logseq.cjs`/`parseFilename`).
- **New files:** `src/lib/storage/graph-index.js` (pure, tested in
  `graph-index.test.js`), `src/lib/storage/publish-graph.js`,
  `src/components/settings/GraphFolderSettings.svelte`. **Edited:** `electron/main.cjs`
  (`storage:readGraphIndex` + `storage:publishToGraph` IPC), `electron/preload.cjs`,
  `settings.js`, `stores/index.js`, `local-store.js`, `SettingsDropdown.svelte`,
  `App.svelte`.

**Design source:** the plugin repo's `spec/smartpen-stroke-asset-externalization.md`
(§4 storage model, §6.1 bridge publish) and `tools/migrate-smartpen-assets.mjs`
(`--from-clean` does this same write batch-wise; `--from-clean`/`--write-index`
remain the way to back-fill already-saved pages that predate this feature).

## v2.1 / v2.0.2 — Book View + Editor handoff (June 2026)

**A read-and-edit "Book View" for saved pages.** The right-hand pane now toggles
between the **Editor** (the existing `StrokeCanvas` capture/edit surface) and **Book
View** (`BookViewer`), letting the user read their notebooks as side-by-side spreads
and view/edit/copy transcripts now that LogSeq is gone.

**What landed:**
- New `src/components/viewer/` — `BookViewer` (home grid + spread layout + page-turn
  nav), `PageSpreadView` (per-page SVG stroke render with zoom/pan/fit, or transcript),
  `TranscriptPane` (inline structured editor + copy)
- New `src/lib/viewer/` — `page-svg.js`, `transcript-markdown.js`, `save-transcript.js`
  (+ unit tests `page-svg.test.js`, `transcript-markdown.test.js`, `save-transcript.test.js`)
- New `src/stores/viewer.js` — pane mode, per-page dirty tracking, persisted selection,
  recents (see Stores section)
- **Strokes ⇄ Transcript toggle** (viewer-wide); transcript shows hierarchy + TODO/DONE
- **Inline transcript editing** — edit text, Tab/Shift+Tab indent, cycle TODO/DONE,
  add/delete lines; saves back to the PageDoc verbatim (separate dirty flag from the
  canvas so a transcript save never masks unsaved strokes)
- **Copy** transcript as LogSeq-pasteable markdown (tab indents, `- TODO`/`- DONE`,
  `::` properties stripped)
- **Single/Spread** with page-turn nav; home grid with recent + collapsible by-book
  thumbnails (collapsed by default so large books don't bury navigation)
- **Load into Editor** (per page) — imports that page's strokes into the live canvas
  and switches to the Editor for editing
- **State persistence** — Book View reopens the last spread across Editor/Book toggles
  and app reloads (`viewerSelection` in localStorage)

**Fixes made along the way:**
- `scan.js` now carries `pageId`/`suffix` and loads by `pageId`, so letter-suffixed
  pages (`P127.json` + `P127b.json`) no longer collide into one duplicate record — this
  also fixed the Saved Pages tab crashing on such books (`BookAccordion` keys by
  `pageName`). `pagesByBook` breaks page-number ties by suffix.
- `StrokeCanvas` `onMount` now seeds the page filter from already-loaded pages and does
  a full render + fit, so "Load into Editor" shows the page immediately. Previously
  `visibleStrokes` (filtered by an initially-empty `selectedPages`) raced the
  `PageSelector` auto-select on a fresh mount, leaving the canvas blank until a filter
  was toggled.

## v2.0.0 — LogSeq → Local Folder Pivot (May 2026)

**The big one.** Replaced LogSeq as the storage backend with plain JSON files in a user-chosen local folder.

**Why:** LogSeq's graph DB performance degraded with dense, frequently-rewritten stroke chunks. The chunking, block CRUD, and inter-chunk-delay machinery was bookkeeping for LogSeq's sake, not user value.

**What landed:**
- New storage layer in `src/lib/storage/` (PageDoc schema, hybrid serializer, IPC-backed local-store, append-only save, Y-bounds transcript merge, folder scanner, page-changes preview)
- IPC handlers in `electron/main.cjs` (`storage:listPages`, `getPage`, `savePage`, etc.) with atomic writes
- Settings: dropped `logseqHost`/`logseqToken`/`logseqConnected`; added `dataRoot`/`dataFolderReady`/`dataFolderStatusText`
- Unsaved-changes indicator: amber dot on the Save button, `beforeunload` confirmation
- Migration importer at `scripts/migrate-from-logseq.cjs` — parses LogSeq's outliner `.md` files (supports letter-suffixed pages like `P151b.md`) and emits v2 PageDocs. Idempotent + non-destructive
- Compact-pretty hybrid serializer: doc shell pretty-printed, each stroke on one line (~40% the size of full pretty-print, still diff-friendly)
- Deleted modules: `logseq-api.js`, `logseq-scanner.js`, `logseq-import.js`, `transcript-updater.js`, `LogseqSettings.svelte`, `LogseqPreview.svelte`, and matching tests
- Trimmed `stroke-storage.js` of chunked-storage helpers
- UI rebrand: "Save to LogSeq (Strokes)" → "Save (Strokes)" / "Save Changes" / "Save (Strokes + Text)"; status pill shows the data folder; "LogSeq DB" tab → "Saved Pages"

**See:** [docs/LOCAL-STORAGE-PIVOT-SPEC.md](docs/LOCAL-STORAGE-PIVOT-SPEC.md) for the full design and phasing.

## Before v2.0 (LogSeq era, through April 2026)

Kept because the offline-import and live-capture fixes still describe how
`src/lib/pen-sdk.js` and `canvas-renderer.js` work. References to LogSeq modules
(`logseq-api.js`, `transcript-updater.js`, the LogSeq DB tab) are historical.

### Major Fixes (March 2026)

**LogSeq DB Tab — PageCard UX Overhaul (2026-03-24):**
- Redesigned `PageCard.svelte` for scalability with growing page lists
- Compact single-row header: sync badge · icon · title · ▶ expand · Import Strokes (inline)
- Transcript section is collapsed by default; expand arrow only appears when transcript data exists — solves the scroll-hijacking problem caused by tall preview boxes
- Transcript section header: `TRANSCRIPTION:` + `[Edit]` + `[↺ Reset]` inline action buttons
- **Reset Transcript**: clears `blockUuid` from session-loaded strokes and in-memory transcription entry so a page can be re-transcribed after a truncated run; logs result to ActivityLog; LogSeq blocks are not deleted
- Removed stale stroke-count/last-updated metadata row (returned 0/Unknown)
- Removed floating inline edit-pencil from `TranscriptionPreview.svelte` (editing via modal only)

**Decorative Stroke Filter — Single-stroke Only (2026-03-24):**
- Rewrote `stroke-filter.js`: removed 2-stroke H+V box detection and vertical-line detection
- Replaced `StrokeAnalyzer` corner-detection with perimeter-fraction + path-ratio heuristic
- All three detectors (underlines, boxes, circles) now operate on individual strokes only
- See: `docs/QUICK-ARCHITECTURE-REFERENCE.md` → Decorative Stroke Filter

**Offline Import — Multi-book Reliability & Progress UI (2026-04-10):**
- Fixed critical bug where earlier books in a multi-book import were skipped after their first data chunk; only the last book was fully imported
- **Three root causes fixed in `src/lib/pen-sdk.js`:**
  1. `offlineTransferResolver` not cleared after use — stale BLE retransmissions resolved the next book's promise immediately; fix: null the global before calling resolver
  2. Book ID mismatch — pen sends data for old book during new book request; `handleOfflineDataReceived()` now returns `false` on mismatch, gating the resolver call on return value
  3. Multiple chunks per book — SDK fires `OFFLINE_DATA_SEND_SUCCESS` once per page, not once per book; code was resolving after first chunk; fix: hold promise open until received ≥ expected
- **Expected stroke count:** `OFFLINE_DATA_RESPONSE` (type 49) is consumed internally by the SDK and never forwarded to the app's `messageCallback`; count estimated from `OFFLINE_DATA_SEND_STATUS` percentage: `total = received / (percent / 100)`
- **Transfer progress UI:** real-time per-book stroke count and percentage in both builds:
  - Web build: `src/components/pen/TransferProgress.svelte`
  - Desktop/Electron build: `src/components/header/ActionBar.svelte` inline popup (class `transfer-popup`) — this is the component the Electron app actually renders
  - Format: `Book X/Y · N/M strokes (P%)` with determinate bar when expected count is known
- See: `docs/QUICK-ARCHITECTURE-REFERENCE.md` → Offline Import — Multi-book Reliability & Progress UI

**Offline Import Performance (2026-03-19):**
- Resolved per-book transfer promise immediately on `OFFLINE_DATA_SEND_SUCCESS` instead of waiting 10s idle timeout — the SDK's own "success" signal is reliable; idle timeout kept as fallback only
- Reduced `INTER_BOOK_DELAY_MS` from 1000ms → 500ms (BLE stabilisation delay between books)
- Result: ~75% reduction in import time for multi-book syncs (e.g. 5 books: ~55s → ~13s)
- Config: `TRANSFER_CONFIG` object in `src/lib/pen-sdk.js:511`
- See: `docs/QUICK-ARCHITECTURE-REFERENCE.md` → Offline Import Performance

**Live Capture & Canvas View Stability (2026-03-11):**
- Fixed invalid SDK pen-down dot `{x:-1, y:-1}` — was causing origin-line artifact and stale book/page on first stroke
- Fixed `calculateBounds` `offsetY` double-subtraction bug — was pushing content off-screen above the canvas
- Removed zoom/pan reset from `clear(resetBounds=true)` — was snapping view back to zoom=1 after every stroke
- Added `setLiveWritingView()` to `canvas-renderer.js` — sets stable 3× zoom anchored to top-left for writing
- Rewrote auto-fit logic in `StrokeCanvas.svelte` — live writing gets `setLiveWritingView()` once; offline import gets `fitContent()` once; no more "every 10 strokes" jump
- See `docs/Archive/2026-03-live-capture-canvas-fixes/LIVE-CAPTURE-CANVAS-FIXES.md`

### Major Fixes (February 2026)

**Data Loss Prevention (commit 0a836ac):**
- Fixed stroke deletion to be explicit only (no phantom deletions from partial imports)
- Updated `updatePageStrokesSingle()` to use append-only strategy
- Changed deletion counting from arithmetic (`existing - current`) to explicit tracking via `deletedStrokeIds`
- Stroke saves now preserve all LogSeq data unless explicitly marked for deletion in `pending-changes.js`

**Edit Structure UI Overhaul (commit 0a836ac):**
- Converted TranscriptionEditorModal to single-column layout
- Improved visual hierarchy and editing experience
- Fixed deletion counts in SaveConfirmDialog to use explicit deletion tracking

**Y-Bounds Preservation (commit 8c129a8):**
- Fixed transcript updates to preserve Y-bounds properties
- Ensures stroke-to-block matching data survives LogSeq round-trips

### Earlier Work
- Electron desktop app conversion (electron/ directory, vite.config.js updates)
- Hierarchical block creation order fix (parent blocks before children)
- Transcript data loss fixes (Y-bounds, blockUuid preservation, merge logic)
- BlockUUID over-assignment bug fix (scoping transcription to correct strokes)
- Persistent UUID implementation to avoid duplicate strokes
- Custom UUID system to avoid conflicts with pen SDK
- Transcript storage v3.0 architecture (see `docs/TRANSCRIPT-STORAGE-SPEC.md`)

When working with stroke management or transcription storage, be aware of these architectural changes.
