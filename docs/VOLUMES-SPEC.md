# Volumes — disambiguating physical notebooks that share an NCode book id

**Status:** **Implemented** (Phases 1–2). Live capture, volume definition and
reassignment verified on hardware. **Offline import is untested** — see §11.
Phase 3 and the JPI Tools plugin spec are deferred.
**Date:** 2026-08-07
**Author:** Claude (spec + implementation), Josh (requirements + design direction)

> **Rev 3:** decisions locked — `v` delimiter, **all-string book keys** (rev 2's
> mixed number/string is rejected, §3.3), aliases carry volume names, `locked`
> dropped. Adds §6.5 (whole-page reassignment completeness) and §9 (why volume
> can't live on the page suffix).
>
> **Rev 2:** switched from rev 1's arithmetic remap (`book + volume × 1,000,000`)
> to the book-key suffix, at Josh's direction. Rev 1's cost estimate for the
> suffix was wrong — see §2.1.

---

## 1. The problem

NCode identifies a *paper design*, not a *physical object*. Two identical Lamy
notebooks emit the same `book` id and the same `page` numbers, so page 12 of the
second notebook merges into `pages/B388/P12.json` alongside page 12 of the first.

Nothing is destroyed — `savePageToFolder()` is append-only and dedupes by
`s{startTime}` ([save-page.js:282](src/lib/storage/save-page.js:282)), and stroke
ids are timestamps that never collide. But the two notebooks' strokes are drawn on
top of each other in one page, permanently interleaved, and re-transcribing the
merged page produces nonsense.

The only current escape is the manual letter-suffix convention (`P151b.json`), a
v1 workflow artifact that disambiguates one *page*, not a notebook.

### Requirements

1. ~~Lock / archive~~ — **dropped**, §5 reassignment covers it (Josh, rev 3).
2. Route new strokes from the duplicate notebook elsewhere.
3. Volumes attached to a book; Volume 1 assumed unless stated.
4. Toggle between volumes to go back and add more writing.
5. Select strokes on the canvas and change their volume — for fixing mis-routed
   imports, for working in two volumes at once, and (§6.5) as the *only*
   mechanism for moving a whole page.

Only one book currently has a duplicate, so the design must cost nothing for
every other book.

---

## 2. Design: volume as a suffix on the book key

```
pages/B388/P12.json      →  Field Notes, Volume 1   (unchanged, existing data)
pages/B388v2/P12.json    →  Field Notes, Volume 2
pages/B388v3/P12.json    →  Field Notes, Volume 3
```

In-memory `pageInfo.book` holds the **book key** — always a string: `"388"`,
`"388v2"`. Grammar: `^(\d+)(?:v(\d+))?$`, volume omitted means 1.

### 2.1 Why not the arithmetic scheme (rev 1)

Rev 1 proposed `logicalBook = ncodeBook + volume × 1,000,000`. Josh rejected it
correctly: it rests on an assumption about data you don't control, fails
**silently** if violated, and produces `pages/B1000388/` — a directory whose
meaning is unrecoverable without the app.

Rev 1's stated reason for rejecting the suffix — "`book` becomes a string,
rippling through ~30 key-construction sites" — was **wrong, and backwards**. Those
30 sites are template literals (`` `B${pageInfo.book}/P${pageInfo.page}` ``), and a
template literal interpolates a string exactly as happily as a number. They are
the part that *doesn't* break. [strokes.js:21](src/stores/strokes.js:21), the
canonical page-key producer, needs zero changes.

What breaks is a smaller, enumerable set — arithmetic/coercion on `book`, and
regexes parsing keys with `\d+` (§4).

### 2.2 Delimiter: `v`

The LogSeq graph asset name already uses `-` as its field separator
([graph-index.js:37](src/lib/storage/graph-index.js:37)):
`smartpen-B{book}-P{pageId}.json`. `smartpen-B388-2-P12.json` is ambiguous to
parse, and that filename is a cross-repo contract with the JPI Tools plugin.
`smartpen-B388v2-P12.json` splits cleanly.

`v` also reads as what it is and stays visually distinct from the page-level
letter suffix: `B388v2/P151b` — volume 2, page variant b, no confusion.

---

## 3. Types

### 3.1 On disk: `book` stays a number, `volume` is a new optional field

```jsonc
"pageInfo": { "section": 3, "owner": 1012, "book": 388, "volume": 2, "page": 12 }
```

`volume` is **omitted entirely when 1**, the convention `sketch: true` already
uses. Therefore:

- Every existing file stays valid and unmodified.
- `validatePageDoc()` ([page-doc.js:194](src/lib/storage/page-doc.js:194)) requires
  `typeof pageInfo.book === 'number'` — **unchanged**, still satisfied.
- `PAGE_DOC_VERSION` stays `"2.0"`. Bumping it would make `validatePageDoc` reject
  every file on disk, same reasoning as the sketch-flag addition.

Identity comes from the **directory name**, not `pageInfo` — the convention
[graph-index.js:15-19](src/lib/storage/graph-index.js:15) already documents for
the page suffix.

### 3.2 Why not a decimal (`388.2`)

Your suggestion. It's genuinely clever — `typeof book === 'number'` survives,
`Number(book)` sites all work, and sorting is free because `388 < 388.2 < 389`
naturally. I evaluated it seriously and it fails on one specific thing:

**Volume 10 collides with volume 1.** `Number("388.10")` is `388.1`, and
`JSON.stringify(388.1)` is `"388.1"` — JS emits the shortest representation, so
the trailing zero is gone the moment it round-trips through the PageDoc. Directory
`B388.10` and directory `B388.1` both load as `388.1`. This is unavoidable in *any*
decimal encoding: decimal fractions cannot hold a fixed-width field, because
trailing zeros don't survive.

Ten volumes of one notebook isn't exotic — fill a notebook every six months and
you're there in five years. And the failure is **silent data merging**, which is
the exact class of flaw you correctly rejected in the 1,000,000 scheme.

Secondary: `388.2` is a number that isn't a quantity. Sorting by subtraction is
meaningful, but so is `Math.round(book)` or `book * 2`, and nothing stops a future
edit from writing one. A string identity can't be accidentally arithmetic'd.

Regarding LogSeq: decimal doesn't help there either. `smartpen-B388.2-P12.json`
puts a dot before the real extension, and `smartpen-index.json` would carry
`book: 388.2` — structurally valid, but the plugin still needs to learn that
`388.2` and `388` are related. Same plugin change as any other scheme (§4.4).

### 3.3 All strings — you were right, and here's what changes

Rev 2 recommended a mixed type (number for Volume 1, string for Volume 2+) on
blast-radius grounds. **Your instinct for consistency is correct and I'm changing
the recommendation.** The reason I under-weighted:

Mixed types don't remove the broken sites — they change *when* you find them. Your
Volume 1 archive is years of notes and gets exercised constantly; Volume 2 is one
new notebook. Under mixed types, a missed coercion site sits dormant until you
actually use Volume 2, then misbehaves quietly on the one notebook whose data you
have the least redundancy for. Under all-strings, the same site breaks on day one,
loudly, across data you can verify at a glance.

**Consistency makes the failures loud and early.** That's worth more here than
containment — especially in a codebase that already carries two live
silent-type-mismatch bugs ([PageCard.svelte:53](src/components/saved-pages/PageCard.svelte:53),
the alias key-type inconsistency in §7.6).

There's supporting precedent: **`pageId` is already a string throughout the app**
([scan.js:38](src/lib/storage/scan.js:38) does `String(meta.pageId)`), keying
`page-cache.js`, `BookViewer`, and `viewer.js`. "Identity field that's a string"
is an established, working pattern here.

**What all-strings changes, concretely:**

- The **on-disk format is unaffected** (§3.1) — the string is purely the in-memory
  book key, composed at the load/capture boundary. So `validatePageDoc` is
  untouched and no file changes.
- The same ~8 coercion sites in §4.3 need fixing, but they now receive strings for
  *every* book, so a missed one fails immediately on existing data.
- `sameBook()` type-insensitive comparison is no longer needed — plain `===` works.
- Sorting must go through `compareBookKeys` everywhere. Naive string sort puts
  `"388v2"` after `"3880"`, so this is not optional.

Helpers, in a new pure `src/lib/volumes.js`:

```js
export function parseBookKey(bookKey);        // "388v2" → {ncodeBook: 388, volume: 2}
export function makeBookKey(ncodeBook, vol);  // (388, 2) → "388v2"; (388, 1) → "388"
export function compareBookKeys(a, b);        // ncodeBook, then volume
export function bookDirName(bookKey);         // "B388v2"
export function parseBookDirName(name);       // "B388v2" → "388v2" | null
```

### 3.4 Registry and names

`<dataRoot>/pages/_volumes.json` holds only what the filesystem can't express:

```jsonc
{
  "version": 1,
  // Which volume new strokes from each NCode book route to.
  // Absent → volume 1 → no suffix. This is what makes the feature
  // free for every book except the one that needs it.
  "active": { "388": 2 },
  // Optional, Phase 3: timestamp windows for automatic offline routing (§5.3)
  "windows": { "388": [ {"volume": 1, "from": null, "to": "2026-08-01T00:00:00.000Z"},
                        {"volume": 2, "from": "2026-08-01T00:00:00.000Z", "to": null} ] }
}
```

**Names live in `_aliases.json`, keyed by book key** — `{"388": "Field Notes Vol
1", "388v2": "Field Notes Vol 2"}`. Volume 2 gets its own name with no new naming
feature to build; this requires the §7.6 key-type fix first, and the naming UI
must list book keys rather than numeric ids.

> **As built (v2.7):** naming moved out of the settings dropdown into the
> **Books** tab (`components/books/BooksTab.svelte`), which replaced both
> `BookAliasManager` and `VolumeSettings`. Volume names are fully independent —
> `"388"` can be *Site Visits* while `"388v2"` is *Load Calcs*; the parent's name
> is only inherited (with a volume suffix) while a volume has none of its own.
> Volume rows come from `volumesForBook()` rather than `knownBookIds`, so the
> active volume can be named before any page has been written to it.

**No `_volumes.json` ⇒ behaviour byte-identical to today.** There is no migration.

---

## 4. What breaks

### 4.1 Unchanged

All ~30 page-key template-literal sites and all six key formats; the PageDoc
schema and `validatePageDoc`; `save-page.js` merge logic, `page-changes.js`,
`page-cache.js`, `scan.js`; localStorage keys in `page-order.js`, `page-scale.js`,
`viewer.js` (Volume 1 keys don't change, so no saved page position or scale is
orphaned); every existing file on disk.

### 4.2 Regexes assuming `\d+` — the silent-failure set

**Corrected in rev 3.** A proper sweep found more sites than rev 2 listed, and —
more importantly — **two distinct failure modes**, one of which rev 2 missed:

- **No match** → the branch is skipped, a value is dropped, a label blanks. Bad,
  but usually visible.
- **Partial match** → an *unanchored* `/B(\d+)/` matches the `B388` prefix inside
  `B388v2` and confidently returns `388`. This is worse: a plausible wrong value
  that silently conflates the two volumes.

Neither throws. All of them need a volume-2 fixture to surface.

| Site | Pattern | Consequence if missed |
|---|---|---|
| [main.cjs:378](electron/main.cjs:378) | `^B(\d+)$` | No match → volume-2 directories invisible to the scan; **pages simply don't appear** |
| [pending-changes.js:243](src/stores/pending-changes.js:243) | `^B(\d+)\/P(\d+)$` | No match → lazy `onDiskStrokeIds` backfill never fires; **every volume-2 stroke reports as a new addition on every save, forever** |
| [strokes.js:41](src/stores/strokes.js:41) | `/B(\d+)\/P(\d+)/` | No match → volume-2 pages dropped from `canvasPageKeys`; "Import Strokes" never greys out |
| [canvas-renderer.js:351-352](src/lib/canvas-renderer.js:351) | `/B(\d+)\/P(\d+)/` | **New in rev 3.** No match → the comparator hits `if (!matchA \|\| !matchB) return 0` ([:354](src/lib/canvas-renderer.js:354)) and returns 0 against *everything*, so volume-2 pages get arbitrary left-to-right canvas layout order |
| [canvas-renderer.js:1321](src/lib/canvas-renderer.js:1321) | `/B(\d+)\/P(\d+)/` | No match → page label and the unsaved `*` marker blank out |
| [canvas-renderer.js:1292](src/lib/canvas-renderer.js:1292) | `/B(\d+)/` | **Partial match** → returns `388` for `B388v2`. Gives both volumes the same border colour, which §7.7 happens to want — but by accident. Make it deliberate |
| [canvas-renderer.js:1382](src/lib/canvas-renderer.js:1382) | `/B(\d+)/` | **Partial match** → same, for the corner handles |
| [PageSelector.svelte:50](src/components/canvas/PageSelector.svelte:50) | `/S(\d+)\/O(\d+)\/B(\d+)\/P(\d+)/` | No match → volume-2 pages missing from the canvas page filter |
| [migrate-from-logseq.cjs:282](scripts/migrate-from-logseq.cjs:282) | `___B(\d+)___` | Low priority — one-shot v1 importer, and v1 data predates volumes |

**Treat this table as a starting point, not a complete inventory.** It was
compiled by grep; the Phase 1 sweep should re-run it and add a lint rule or a
shared `BOOK_KEY_RE` constant so new sites can't reintroduce the pattern.

### 4.3 Numeric coercion on `book`

Under all-strings these receive strings for every book, so a miss fails
immediately rather than lying in wait.

| Site | Fix |
|---|---|
| [main.cjs:380](electron/main.cjs:380) `parseInt` from dir name | return the book key |
| [main.cjs:424](electron/main.cjs:424) sort `a.book - b.book` | `compareBookKeys` |
| [saved-pages.js:43](src/stores/saved-pages.js:43) `.map(Number).sort()` | `compareBookKeys` |
| [local-store.js:130-141](src/lib/storage/local-store.js:130) alias keys → `Number` | **pass through unchanged** — §7.6 |
| [BookAliasManager.svelte:12](src/components/settings/BookAliasManager.svelte:12) numeric sort + `setAlias(Number(bookId))` | book keys + `compareBookKeys` |
| [CreatePageDialog.svelte:88](src/components/dialog/CreatePageDialog.svelte:88) `parseInt` on book | validate against the grammar; add a volume picker |
| [graph-index.js:66](src/lib/storage/graph-index.js:66) `Number(book)` | §4.4 |
| [main.cjs:598](electron/main.cjs:598) `requireGraphBook` / `Number.isFinite` | §4.4 |

### 4.4 The LogSeq graph — cross-repo, and safely blocked today

`smartpen-index.json` records `book: Number(book)` and the IPC validates
`Number.isFinite(book)`. A volume-2 export yields `NaN`.

**The current failure mode is already safe**: `requireGraphBook` throws before
anything is written. Doing nothing means volume-2 export fails loudly rather than
corrupting the manifest.

1. **Phase 1:** replace the throw with a readable refusal — *"Volume 2+ pages can't
   be exported to LogSeq until the JPI Tools plugin supports them."*
2. **Later:** index entry keeps `book: 388` numeric and gains `volume: 2`; the
   asset filename carries `B388v2`. Needs a matching plugin change — the same
   coordination the sketch-pressure work already needs (per CLAUDE.md, the
   plugin's SVG generator still renders flat).

Not on the critical path for capturing into a second notebook.

---

## 5. Capture routing

### 5.1 Live capture

Active volume is persisted per NCode book and shown in a header control
(`Field Notes — Vol 2 ▾`). Switching affects only strokes captured after it.
Going back is: switch to Vol 1, write, switch back. That's requirement 4.

Applied at the two funnels in `src/stores/strokes.js` —
[`addStroke()`](src/stores/strokes.js:60) and
[`addOfflineStrokes()`](src/stores/strokes.js:86) — which already run
`registerBookId`/`registerBookIds` and sit exactly on the transport/data-model
boundary.

**Do not apply it upstream in `pen-sdk.js`.** `normalizeBookId()` returns a String
compared against `pendingOfflineTransfer` for transfer matching
([pen-sdk.js:1170](src/lib/pen-sdk.js:1170)), the pen-memory list keys on
`S{n}/O{n}/B{bookId}` ([:808](src/lib/pen-sdk.js:808)), deletion groups on
`{Section}_{Owner}` ([:632](src/lib/pen-sdk.js:632)). Protocol concerns on the raw
NCode id, and multi-book offline import has a documented history of subtle bugs
there (the April 2026 fixes).

### 5.2 Live preview needs the same treatment — easy to miss

`canvasRenderer.addDot(dot)` ([pen-sdk.js:356](src/lib/pen-sdk.js:356),
[:1115](src/lib/pen-sdk.js:1115)) and
[`currentPageInfo.set()`](src/lib/pen-sdk.js:354) render the **raw** dot. Without
a matching remap, live ink appears in page group `B388/P12` while the finalized
stroke lands in `B388v2/P12` — two page borders, ink that jumps on pen-up.
Invisible in review, immediately obvious in use.

### 5.3 Offline import — the residual hazard

Pen memory can hold both volumes: wrote in Vol 1 Monday, switched Wednesday, sync
Friday. A single volume choice for the batch mis-files half of them.

1. **Timestamp routing** (`windows` in the registry) — automatic and correct for
   anything captured after the app learned about Vol 2.
2. **Per-book selector in `BookSelectionDialog`**
   ([:115](src/components/dialog/BookSelectionDialog.svelte:115)) — it already
   lists each pen book with its page count and blocks on confirmation *before* any
   stroke transfers. Natural UI slot, but one choice per batch.
3. **Canvas reassignment (§6)** — the safety net.

With §6 in place this drops from "must solve up front" to "fixable after the
fact," which is why timestamp routing waits for Phase 3.

---

## 6. Canvas stroke reassignment

Requirement 5, and — per your Q4 — the **only** move mechanism in the design.

### 6.1 The operation

Select strokes → **Volume ▾** → pick target. Rewrites `pageInfo.book` on the
selection. Everything else survives: `startTime`/`endTime` (so the `s{startTime}`
id stays stable, which the source-page deletion depends on), all points, force,
the sketch flag, the `_nb` bounds cache (stroke-local geometry doesn't move).

`lineId` **must be cleared** — it points at a transcript line on the source page.

### 6.2 The hazard: this is a copy, not a move

The single most important thing to get right. Under append-only, **missing from
canvas ≠ deleted on disk** — that invariant is why `pending-changes` exists. For a
stroke already saved under `B388/P12`:

- Reassigning makes it an *addition* to `B388v2/P12` ✓
- `B388/P12` still holds it on disk, and nothing reports a deletion ✗

The stroke ends up in **both volumes**, silently. Worse than the problem it fixes.

### 6.3 Fix: a `movedFrom` marker

Same shape as the existing `pointsEdited` marker — an in-memory, intent-gated flag
the save path consumes, which `strokeToStored()`'s fixed key list can never write
to disk.

```js
stroke.movedFrom = { book: "388", page: 12 }   // set by reassignVolume() only
```

`savePageToFolder()` collects the source page's deletions from **two** sources:
`deletedIndices` as today, plus any stroke elsewhere on the canvas whose
`movedFrom` names this page. If the stroke was never on disk the deletion is a
no-op — so **one code path is correct in both cases**, no gating needed.

This is a fourth pending-changes category (`additions` / `edits` / `modifications`
/ `deletions` → + `moves`). The codebase has added two of these already with the
same pattern.

### 6.4 The source page must be saved too

`SaveConfirmDialog` lets you pick which pages to save. Save only the target and the
source keeps its copy — back to §6.2. **The dialog must force-include the source
page whenever a move is pending**, and say why. A checkbox the user can uncheck
here silently produces duplication.

### 6.5 Whole-page reassignment (your Q4) — yes, with two additions

Selecting every stroke on a page and reassigning does move the ink correctly, and
it does let us skip building a separate page-move tool. Two things it doesn't do
on its own:

**The transcript stays behind.** Transcript lines live in `doc.transcript.lines`,
not on strokes ([save-page.js:340](src/lib/storage/save-page.js:340) carries
`existing.transcript` forward untouched). Move all the strokes and you get ink in
Vol 2, recognised text still in Vol 1, and `lineId`s cleared (§6.1) so nothing
links them. You'd have to re-transcribe.

**The emptied source file remains.** `merged` becomes `[]` and the file is written
with `strokes: []` — a 0-stroke ghost page in Saved Pages and Book View.

Both are small, contained additions to the same save path, and together they make
the simple architecture actually complete:

- **Detect the whole-page case** — every stroke the source page has on disk is
  being moved to one target — and carry `transcript` across, clearing it from the
  source. Cheap, because the save path already holds both docs.
- **Delete the emptied source file** via the existing `deletePage` IPC when it
  ends with zero strokes *and* zero transcript lines. Leave it otherwise; a page
  with a transcript we chose not to move is real data.

**Recommendation: build these in Phase 2 with the rest of reassignment.** Without
them, "volume a whole page" silently loses the transcript, which is exactly the
kind of quiet data cost this spec exists to prevent.

### 6.6 Working in two volumes at once

`B388/P12` and `B388v2/P12` are distinct page keys → distinct page groups:
separate borders, separate `pagePositions` entries, side-by-side layout. Existing
machinery handles it.

- Adding a page group requires a **full-reset render** to compute offsets — the
  same mechanism as the July 2026 clear-canvas fix. Reassignment must trigger it,
  or reassigned strokes land at the origin under whatever else is there.
- Page labels must show the volume, or two same-numbered pages side by side are
  indistinguishable. Covered by the `formatting.js` change.

---

## 7. Watch-outs

**7.1 — The `\d+` regex set fails silently.** §4.2. `pending-changes.js:243` is
the nastiest: no crash, no symptom, just every volume-2 stroke re-reported as new
on every save. Write the volume-2 fixture test first.

**7.2 — Live preview splits from finalized strokes.** §5.2.

**7.3 — Reassignment duplicates rather than moves** unless `movedFrom` lands with
it. §6.2. Don't ship the reassign UI without the deletion half.

**7.4 — Keep the remap out of the transport path.** §5.1.

**7.5 — Sort order.** Naive string sort puts `"388v2"` after `"3880"`.
`compareBookKeys` (ncodeBook, then volume) must be used everywhere, so Vol 2 sits
directly under Vol 1 in the Saved Pages accordion and the Book View home grid.

**7.6 — The alias key-type bug becomes fatal.** `getAliases()`
([local-store.js:130-141](src/lib/storage/local-store.js:130)) normalizes keys to
**numbers** on read while `main.cjs:547` writes **strings** — which is why
`publish-graph.js:131` hedges with `aliasMap[String(book)] ?? aliasMap[book]`.
`Number("388v2")` is `NaN`, so volume-2 aliases would be silently destroyed on
every scan. **Prerequisite for §3.4's "names come free."**

**7.7 — Book colours diverge.** `getBookColor()`
([formatting.js:40](src/utils/formatting.js:40)) hashes the book id, so Vol 1 and
Vol 2 get unrelated colours. Hash `ncodeBook` for hue, vary lightness by volume, so
volumes read as siblings.

**7.8 — Book View page-turn stops at volume boundaries (correct, free).**
Navigation is index-based within one flat per-book array
([BookViewer.svelte:68-79](src/components/viewer/BookViewer.svelte:68)). Distinct
book keys means turning pages never crosses volumes. Noted so nobody "fixes" it —
and note §9 would destroy this property.

**7.9 — `CreatePageDialog` accepts raw book input.** Validate against the book-key
grammar rather than `parseInt`; add a volume picker.

**7.10 — Mis-routing is only detectable by you.** Show the target volume in the
header, on the canvas page label, and in `SaveConfirmDialog` rows — the last moment
before commitment.

**7.11 — The existing page-suffix bug gets more visible.**
[PageCard.svelte:53](src/components/saved-pages/PageCard.svelte:53) compares
`B{book}/P{page}` against the `pageId`-keyed canvas set, so a `P151b` card tracks
`P151`. Volumes don't cause it, but combining volumes and page suffixes surfaces it
more often. Worth fixing independently.

**7.12 — Global dedupe by `startTime`.** `loadStrokesFromStorage`
([strokes.js:329-333](src/stores/strokes.js:329)) dedupes across the whole canvas
by timestamp, not by page. Two volumes loaded together is fine (different sessions,
different timestamps), but it's the one identity check that's page-blind.

---

## 8. Phasing and tests

**Phase 1 — model + routing.** `src/lib/volumes.js`; the `\d+` regex sweep (§4.2);
the coercion fixes (§4.3); `_volumes.json` + IPC cloned from the `_aliases.json`
handlers; the alias key-type fix (§7.6) and book-key aliases; active-volume header
control; remap in `strokes.js` + the live-preview paths; volume-aware labels in
`formatting.js` and `canvas-renderer.js`; graph export refuses volume 2+ with a
clear message (§4.4). Enough to start Volume 2.

**Phase 2 — reassignment.** The `movedFrom` marker; the `moves` category in
`pending-changes` and `page-changes`; source-page force-include in
`SaveConfirmDialog`; whole-page transcript carry + source-file cleanup (§6.5); the
canvas Volume ▾ control; full-reset render on reassign.

**Phase 3 — automation + polish.** Timestamp routing; per-book selector in
`BookSelectionDialog`; archive/collapse in the Book View grid; volume-sibling
colours; graph export once the plugin catches up.

**Tests.** New `src/lib/__tests__/volumes.test.js` — `makeBookKey`/`parseBookKey`
round-trip, grammar rejection (`"388v"`, `"388v0"`, `"v2"`, `"388v2v3"`),
`compareBookKeys` ordering (`"388"` < `"388v2"` < `"3880"` — the case naive string
sort gets wrong), `bookDirName`/`parseBookDirName`.

Then thread a **volume-2 fixture** through the existing suites — this is what
catches §4.2: `pending-changes.test.js` (backfill fires, no phantom additions),
`save-page.test.js` (the `movedFrom` deletion; the marker never reaches disk,
mirroring the existing `pointsEdited` assertions; whole-page transcript carry),
`page-changes.test.js` (the `moves` category), `scan.test.js` (volume directories
discovered).

---

## 9. Why volume can't live on the page suffix

Your other idea: leave the book number alone and append the volume to the *page* —
`B388/P12v2`. It's appealing because `pageId` is already a string everywhere, so
`book` would never change type.

**It pushes the problem down the road and makes it worse.** Three reasons:

**It doesn't avoid the type change — it relocates it to a worse field.** The
letter-suffix mechanism lives *only* in the storage layer: filenames and `scan.js`
records. `pageInfo.page` is **always an integer** — that's why
[graph-index.js:15-19](src/lib/storage/graph-index.js:15) has to state that
identity comes from the filename and never from `pageInfo`, and why
[graph-index.js:70](src/lib/storage/graph-index.js:70) strips the suffix to
recover the number. So the canvas page key `S3/O1012/B388/P12` is identical for
both volumes and **they still collide in memory.** Making it work means
`pageInfo.page` becomes a string — and `page` is used numerically in *more* places
than `book`, including `validatePageDoc`, both scan sorts, and every navigation
path in Book View.

**It loses volume-as-an-object.** A volume is a property of the notebook, not the
page. On the page there's nowhere to hang a name, an active-capture pointer, or a
timestamp window — `_aliases.json` is keyed by book, so Volume 2 could never have
its own name. "Show me everything in Volume 2" becomes a scan of every page's
suffix.

**It breaks reading order.** Pages sort by page number
([saved-pages.js:34-37](src/stores/saved-pages.js:34)), so Volume 2's pages
interleave with Volume 1's, and Book View page-turn would run P12 → P12v2 → P13,
jumping between physical notebooks mid-read. §7.8's boundary property — which the
book-key design gets for free — is destroyed.

It also collides semantically with the existing suffix: `P151b` means "my manual
variant of page 151." `P151v2` on the same axis means something different, and
`P151bv2` is where the grammar stops being defensible.

**The useful insight in it stands, though:** `pageId` being a string throughout the
app is proof that a string identity field already works fine here. That's an
argument *for* §3.3's all-string book keys — which is where it's now used.

---

## 10. Decisions locked (rev 3)

| # | Decision |
|---|---|
| 1 | Delimiter `v` — `B388v2` |
| 2 | **All-string** book keys in memory; `book` stays numeric on disk with a new optional `volume` field. Decimal (`388.2`) rejected — silent volume-10 collision (§3.2) |
| 3 | Volume names in `_aliases.json`, keyed by book key; requires the §7.6 fix |
| 4 | Whole-page moves via multi-select stroke reassignment — plus transcript carry and source-file cleanup (§6.5) |
| 5 | `locked` dropped |

---

## 11. What shipped, and what's still open

### Delivered (Phases 1–2)

**New:** `src/lib/volumes.js` (pure mapping), `src/stores/volumes.js` (registry +
capture routing), `src/components/settings/VolumeSettings.svelte`, and tests
`volumes.test.js` (33) + `volumes-store.test.js` (31).

**Storage:** `electron/main.cjs` — book-key path helpers with `requireBookKey`
/`requirePageId` validation (new: `book` used to arrive via `parseInt` and was
inherently path-safe; as a string it is not), the volume-aware directory regex,
`compareBookKeys` sorting, and the `_volumes.json` IPC pair. Plus `preload.cjs`,
`local-store.js` (alias key-type fix + volume accessors), `scan.js`,
`load-page.js`, `save-page.js`.

**The `\d+` sweep** — every site in §4.2 plus **five the original table missed**,
found by a second grep pass after the first round of edits:
`canvas-renderer.js:1407` (corner handles), `stores/ui.js` (SVG-export sort),
`graph-export.js` (page sort), and `StrokeCanvas.svelte` ×2 (text-view page
matching, where `parseInt("388v2") === 388` would have matched volume 1's page as
well as volume 2's). `CreatePageDialog` also compared `p.book === parseInt(...)`
in three places. **The lesson holds: treat §4.2 as a starting point.** New sites
should use `BOOK_KEY_FRAGMENT` rather than writing `\d+` by hand.

**Reassignment (Phase 2):** `reassignVolume()` + `clearMovedFromMarkers()` in
`stores/strokes.js`; `getMovedAwayStrokeIdsForPage()` and the `moves` category in
`stores/pending-changes.js`; `strokeMoves` in `page-changes.js`;
`planPageMove()` + `finalizePageMoves()` in `save-page.js`; the save loop in
`ActionBar.svelte`; the **Volume ▾** control on the canvas; move sources
force-included (checkbox disabled, `required` tag) in `SaveConfirmDialog`.

One implementation note against §6.3: the moved-away ids are unioned into
`deletedStrokeIds` by the **caller** rather than collected inside
`savePageToFolder`. "Remove this id from the stored page" is the same operation
either way, so this reuses the existing deletion machinery untouched instead of
adding a parameter to the save path.

**563 tests pass; production build clean.**

### Verified against real hardware (2026-08-07, Josh)

- **Live capture with a volume active** — ink stays in one page group through
  pen-up. This was the §5.2 trap (the renderer builds its own page-group key from
  the raw dot), and it's the one thing unit tests can't reach.
- **Defining volumes** — Settings → Notebook Volumes, routing persists.
- **Editing / reassigning volumes** — canvas **Volume ▾**, including the move
  landing in the right place.

### Open

1. **Offline import is UNVERIFIED — test before trusting a pen sync.** Nothing
   about it is known broken; it simply hasn't been run against the pen since
   volumes landed, and it's the riskiest untested path in the feature. Three
   distinct things to check, in order:

   a. **A single-volume sync still works at all.** `handleOfflineDataReceived()`
      resolves the volume once per shared `pageInfo` object and the live-render
      branch remaps separately. Multi-book offline import has a documented
      history of subtle bugs (the April 2026 fixes), which is exactly why the
      remap was kept *out* of the transport path — `normalizeBookId`, transfer
      matching and the pen-memory keys still use the raw NCode id. Confirm a
      multi-book batch still imports completely.

   b. **Strokes land in the active volume.** Import with Volume 2 active and
      confirm the pages appear under `pages/B388v2/`, not `pages/B388/`.

   c. **A batch spanning two volumes mis-files half of it — expected, §5.3.**
      The pen cannot distinguish the notebooks, so one volume choice applies to
      the whole batch. The remedy is canvas reassignment after the fact, not
      prevention. Worth confirming that remedy actually works on imported (rather
      than freshly-captured) strokes, since that's the path with a stored copy on
      disk and therefore the one where the `movedFrom` deletion has to fire.

   If (c) proves annoying in practice, that's the argument for promoting
   timestamp routing (§5.3) out of Phase 3.

2. **JPI Tools plugin spec — deliberately not written yet.** Volume 2+ export is
   refused with a readable message from `requireGraphBook` (§4.4). Writing the
   plugin spec now would direct a second codebase at an integration that hasn't
   been exercised against real notebooks yet. **Write it after this has been used
   in anger and the bugs are out**, so it describes what the bridge actually does
   rather than what this document predicted.
3. **Phase 3** — timestamp routing for offline import (§5.3), the per-book
   selector in `BookSelectionDialog`, archive/collapse in Book View.
4. **§7.11** — the pre-existing `PageCard.svelte:53` page-suffix bug, untouched.

### The permanent limitation

**If you write in physical Volume 1 while the active pointer says Volume 2,
nothing can detect it.** The pen genuinely cannot tell the notebooks apart — that
is the premise of the whole feature. §6 reassignment is the remedy, not
prevention. This is why reassignment matters more than the routing does.
