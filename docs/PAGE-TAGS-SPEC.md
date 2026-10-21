# Page tags (v3.1.0)

Status: **specified 2026-10-21, not built.** Mockups: [TAGS-UI-MOCKUPS.html](TAGS-UI-MOCKUPS.html) (live, clickable; the
mockups are the visual source of truth, this file is the behavioural one). Ships as **v3.1.0**.

## 1. Goal

Tag **pages** (only pages, not notebooks) with keywords and project numbers, then read the Library grouped by tag as an
alternative to grouping by notebook, and filter any page grid by tag. Project numbers (`P2026-141` proposals,
`2327-018` jobs, always stored without brackets) found in a page's transcript are **suggested** as tags, never applied
without a click.

Non-goals (v1): tagging notebooks, tag hierarchy or colours, validating a project number against LogSeq/BQE, showing a
project's name on its chip, tags on Timeline cards, editing tags inside the Editor/canvas, syncing tags into LogSeq.

## 2. Decisions (all settled 2026-10-21)

| # | Decision |
|---|---|
| 1 | Reader: a **side strip** beside the page; collapses to a one-line bar under the toolbar on narrow windows. |
| 2 | Tag grouping has an **Untagged** card (dashed, last). |
| 3 | Bulk tagging can **add and remove**. |
| 4 | Suggestions show in **three** places: the reader strip, an amber dot on thumbnails, and a review queue. |
| 5 | Accepting a suggestion tags **only that page**; the queue's *Tag all* is the deliberate many-page path. |
| 6 | Matcher tolerates spaces, dash types and case; it does **not** map letters to digits (`O`→`0`). Revisit after real hits. |
| 7 | A hand-typed project-number-shaped tag is **normalized** (`p2026-141` → `P2026-141`). |
| 8 | Tags are searchable from Ctrl K: a **Tags** result group above Pages. |
| 9 | Showing project names on chips is **deferred**; storage is unaffected. |

## 3. Storage: `<dataRoot>/pages/_tags.json`

Same family as `_orientation.json`, `_aliases.json`, `_volumes.json`: read and written in `electron/main.cjs`, exposed as
`window.storageAPI`, facade in `lib/storage/local-store.js`. **No PageDoc is read or written by anything in this
feature.** Tags are display-style metadata: not an unsaved edit (no `markUnsavedChanges()`, no amber dot, no
`pending-changes`, not in `SaveConfirmDialog`), and no `refreshAfterSave()`.

```jsonc
{
  "version": 1,
  "pages":     { "3017/42": ["beam", "P2026-141"], "388v2/7": ["2327-018"] },
  "dismissed": { "3017/42": ["2327-018"] }
}
```

- Key = `"<bookKey>/<pageId>"` (string book key, so `388v2` works; `pageId` keeps its letter suffix, `151b`). Build keys
  with one helper, as `orientationKey()` does, validated through `requireBookKey()` / `requirePageId()` in main so paths
  never leave the data root (no paths are built from keys here, but keep the validation).
- Missing, empty, or corrupt file = no tags and no dismissals (warn once, never throw, never stop startup). A page with
  no tags has **no entry** (absence, as with portrait).
- Writes: atomic (`.tmp` + rename + fsync via `writeFileAtomic`), serialized through a promise chain like
  `withOrientationLock`, **read-merge-write per call** inside the lock so two quick edits cannot overwrite each other.
  IPC surface (names indicative): `storage:getTags`, `storage:setPageTags(root, book, page, tags)`,
  `storage:bulkTags(root, ops)` (add/remove a tag across many pages in one locked write),
  `storage:renameTag`, `storage:mergeTags` (merge = rename onto an existing name), `storage:deleteTag`,
  `storage:dismissSuggestions(root, book, page, tags)` / `storage:resetDismissed`. Unknown fields in the file are
  preserved on write.
- Unknown `version` greater than 1: read what you can, do not rewrite the file (log it).

### Normalization (`lib/tags.js`, pure, tested)

`normalizeTag(raw)` runs on every write path and in the UI:

- Project number: after trimming, removing internal whitespace and mapping `– — −` to `-`, if it matches
  `^[Pp]?(\d{4})-(\d{3})$` it becomes `P####-###` (when it had a P) or `####-###`. Stored without brackets.
  Brackets typed by the user (`[[P2026-141]]`) are stripped first.
- Keyword: trim, collapse whitespace to `-`, lowercase, keep `a-z 0-9 - _`, max 40 characters. Empty after
  normalizing = rejected (no tag).
- `isProjectTag(t)`. Page tag lists are de-duplicated and sorted (project numbers first, then keywords).

## 4. Suggestions

`suggestProjectNumbers(lines)` in `lib/tags.js`, pure. Input: a page's `transcript.lines[].text`. Output:
`[{ tag, lineId, line }]`, one per distinct normalized number, first occurrence wins.

- Pattern (guideline; settle exact form with tests): not preceded by a letter/digit, optional `P` (any case) and optional
  whitespace, four digits, a dash (`- – — −`), exactly three digits, not followed by a digit. Examples that **match**:
  `P2026-141`, `p2026-141`, `P2026–141`, `P 2026-141`, `2327-018`, `[[P2026-141]]` (as `P2026-141`). Examples that
  **don't**: `2026-10-21` (date), `555-1234`, `12345-678`, `P2O26-141` (letters for digits, decision 6).
- **Pattern only; no validation.** A wrong number costs one ✕.
- **Never stored.** Computed from the stored transcript when needed (reader opens, queue opens), so re-transcribing
  refreshes them. Only **dismissals** persist (`dismissed[pageKey]`).
- Excluded if already a tag on the page or dismissed for that page. A page with no transcript has none. A dismissal
  survives re-transcription; *Reset dismissed suggestions* (Settings → Tags) clears all of them.
- **Where the transcript is read.** The scan stays metadata-only (CLAUDE.md invariant). The reader computes from the
  page it already holds. The queue and the thumbnail dot need the transcript of many pages, so a **background scanner**
  (`lib/tag-suggestions.js`) reads transcribed pages one at a time via `getPage()` **bypassing the reader's page cache**
  (as thumbnails do, so a pass cannot evict the open spread), yields between pages, shows a progress count, is
  cancellable, and caches results in memory keyed by page key + transcript `lastTranscribed`. It runs when the Library
  home or queue is visible and the scan is idle, never during capture. Results feed a store
  `pendingSuggestions: Map<pageKey, tags[]>`; a dismissal or tag-add removes the entry at once.
  `onDiskStrokeIds`-style scalar discipline applies: keep the cached values tiny (strings only, no lines).

## 5. Store and derived data

- `stores/tags.js` (mirror of `stores/orientation.js`): `pageTags` writable `{ key: string[] }`, `dismissedTags`,
  `loadTags()` (called wherever `loadOrientations()` is, and on data-folder change), `setPageTagList()`,
  `addTagToPages()`, `removeTagFromPages()`, `renameTag()`, `mergeTags()`, `deleteTag()`, `dismissSuggestion()`.
  Optimistic update, **rollback on failure with an Activity Log `log(…, 'error')` entry** (roll back only that page's
  change, and only if nothing has changed it since, as `setPageRotation` does). The store, not the write's reply, is the
  truth.
- Derived (in `stores/library.js` or a sibling), rebuilt once per change, never per render: `tagIndex`
  (`tag → pageKeys[]`), `tagCards` (tag, page count, notebook count, most recent pages for the strip),
  `untaggedKeys` (scan records minus tagged keys), `suggestionCount`. Pure logic in `lib/tags.js`.
- `resetForDataFolder()` (`lib/storage/refresh.js`) clears tag state and reloads it for the new folder.
- Display prefs (Group by choice, tag sort) → localStorage through `lib/safe-storage.js`, per-viewer.

## 6. UI

Reference the mockups for look and flow. Components stay under ~300 lines; **`BookViewer` is at 301 and
`NotebookPages` / `LibraryHome` are already substantial. Add new components, do not grow them.**

### 6.1 Tag chips and the editor (mockups 1, 2)

- `TagChip.svelte` (keyword grey, project teal, suggested dashed amber with ✓ ✕), `TagInput.svelte` (chips + input +
  type-ahead popover: existing tags most-used first with page counts, a *Create "…"* row, ↑ ↓ Enter Esc, Backspace on
  empty removes the last chip). Window-level shortcuts stand down while typing (`isTypingTarget`) and under the popover
  (`aria-modal` rule does not apply to a popover; call `preventDefault()` on the Escape it handles so the reader leaves
  it alone).
- `PageTagsStrip.svelte`: the reader's side strip (**Tags** + **Suggested from transcript**, each suggestion with its
  source line, the matched number highlighted). Collapses to a single bar on narrow windows. Shown in the Library
  reader for the focused page of a spread (each page of a spread has its own strip target; decide the exact placement
  against `PageSpreadView` and keep the handwriting's space). Not shown in the Editor or Timeline.
- Disabled with the usual message when the data folder is missing.

### 6.2 Grid, bulk, filter (mockups 3, 5)

- `PageThumb` gains the tag line under the label (first two chips, `+N`), an amber dot for pending suggestions, and a
  hover *+ tag* that opens the chip editor in a small popover. Tags come from `pageTags`, **never from reading the page**;
  the thumbnail loading rules (on screen only, `viewer/thumbs.js`, off the page cache) are unchanged.
- Select mode in the page grid: tick circles, shift-click range, *Select all*, a floating bar (`BulkTagBar.svelte`):
  add a tag to the selection, remove a tag from the selection, Done. A bulk change is one locked write.
- `TagFilterRow.svelte` above any page grid: chips of the tags present in the **current grid** with counts; chosen chips
  highlighted; **Any / All** toggle; Clear. Only tags that still match are offered in All mode so an empty result can't
  be reached by accident. State is per view and not persisted.
- `NotebookPages` currently renders one notebook (`libraryNotebook`). Generalize it (or add a sibling) to take **a list
  of page records from a source**: a notebook or a tag (or a tag filter). In tag mode every label also names its
  notebook. Opening a thumbnail uses the existing `openPageInLibrary()`, so navigation and the unsaved-transcript prompt
  stay in one place (`stores/viewer.js`).

### 6.3 Group by (mockup 4)

- `LibraryHome` gets a **Group by: Notebook | Tag** segmented toggle (state in `stores/library.js`, localStorage via
  safe-storage). Tag mode shows tag cards (`TagCard.svelte`, reuse `NotebookCard` layout) under **Projects** and
  **Keywords** headings, then a dashed **Untagged** card. A tag card: page count, notebook count, strip of the most
  recent pages' thumbnails (on screen only). Sort chips follow the grouping (tag mode: *Most pages · Name · Recently
  tagged*; "recently tagged" can use the newest capture date among its pages from the existing date index, since no
  tag timestamps are stored).
- A *Suggestions (n)* entry appears next to Rescan when `suggestionCount > 0`.
- Back from a tag grid returns to the Library home in the same grouping. Routes go through `navigateTo()`.

### 6.4 Review queue (mockup 6)

- `TagSuggestionQueue.svelte`: pending suggestions **grouped by number**, each group showing the number, the source line,
  thumbnails of its pages (each tick-able to exclude), **Tag all n** and **Dismiss all**. Tag all adds the tag to the
  ticked pages in one bulk write. Empty state: "All caught up". A *Re-check transcripts* control reruns the background
  scanner. Reached from the Library home entry above.

### 6.5 Tag manager (mockup 7)

- `TagManager.svelte` in Settings → Tags: table (tag, pages, notebooks) with **Rename**, **Merge into…**, **Delete**,
  plus *Reset dismissed suggestions*. Renaming onto an existing tag is a merge and asks to confirm. Delete removes the
  label from pages and never touches a page. Counts come from the sidecar.

### 6.6 Search (decision 8)

- `lib/global-search.js` / `lib/search-query.js`: add a **Tags** result group above Pages. A match opens that tag's
  grid (6.2). Tag names are indexed from `tagIndex` (rebuilt when tags change, not per keystroke). A query shaped like a
  project number matches the tag exactly, normalized.

## 7. Interactions with existing invariants (check each)

- **Volumes.** Reassigning a volume is a move that rewrites `pageInfo.book` and re-keys strokes (`movedFrom`,
  `getMovedAwayStrokeIdsForPage()`). Tags are keyed by the page key and live outside the PageDoc, so a move can leave a
  tag on the old key. Rule: tags **stay with the source page key**; if a move leaves the source page with no strokes
  and the destination key has no tags, carry them across. Find where reassignment writes (it touches
  `stores/strokes.js`, `ActionBar`, `SaveConfirmDialog`, `pending-changes.js`) and add the one hook there, with a test.
  If that proves invasive, ship tags-stay-put and note it in Known limitations rather than guess.
- **Page key hygiene.** Never hand-write `\d+` for a book; use `compareBookKeys()` and `BOOK_KEY_FRAGMENT`
  (`lib/volumes.js`). A book key is a string. Never do arithmetic on it.
- **Append-only saves** are untouched: nothing here calls `savePageToFolder()`.
- **Scans are metadata-only.** Tags attach to scan records by key in a derived store; the scan does not read tags from
  PageDocs and gains no new field. Suggestions come only from the background scanner above.
- **Stale copies.** Tag changes need no `refreshAfterSave()` (no PageDoc changed) but must update every view through the
  store: grid thumbnails, tag cards, queue, search index.
- **Capture dates** unaffected. **Page rotation** unaffected (display-only, separate sidecar).
- **Performance.** Tag cards, counts, filters and the search index use the sidecar plus existing scan records only. At
  1,000+ pages nothing renders per-keystroke work. Thumbnail strips on tag cards load only when on screen.
- **Failure modes.** Data folder missing → tag UI disabled with the standard message. Write fails → rollback + Activity
  Log. MyScript is not involved (suggestions read already-stored transcripts). Corrupt `_tags.json` → treated as empty;
  **do not overwrite a corrupt file on a read**: the first successful write replaces it, and say so in the log.

## 8. Tests

Vitest in `src/lib/__tests__/`, following the existing factories and boundaries (empty, zero, null).

- `tags.test.js`: `normalizeTag` (project forms, en dash, spaces, brackets, case, 40-char cap, empty), `isProjectTag`,
  `suggestProjectNumbers` (every row of the mockup 2 table, dedupe across lines, date/phone/long-run rejections,
  excluded when tagged or dismissed), index/cards/untagged derivation, filter any/all with availability, sort orders.
- `tags-store.test.js` (mock `local-store.js` like `orientation-store.test.js`): optimistic update, rollback on failure
  only if unchanged since, bulk add/remove, rename/merge/delete, dismiss, reload on data-folder change.
- Main-process handlers if there is a harness for `main.cjs`; otherwise cover the pure read-merge-write helper by
  extracting it to a testable module, like the orientation helpers.
- Search: tag group appears, project-number query matches exactly.
- Manual checklist additions in `docs/TESTING.md`: tag in reader, suggestion accept/dismiss/persist across
  re-transcribe, bulk, group by, filter, queue, rename/merge/delete, corrupt sidecar, missing folder, a `388v2` page and
  a `151b` page, a 1,000-page data root.

## 9. Docs and release (v3.1.0)

- CLAUDE.md: add `_tags.json` to the sidecar list; the `lib/tags.js`, `stores/tags.js` entries in the code map;
  an invariant bullet ("tags are display metadata in `_tags.json`; never write them into a PageDoc; tags keyed by page
  key, so volume moves must carry them"); update the Library description (Group by, tag grid, suggestions queue).
- `docs/ARCHITECTURE.md` (components, stores, libs), `docs/CHANGELOG.md` (why a sidecar over a PageDoc field, why
  suggestions are pattern-only and never stored, rejected alternatives), `docs/TESTING.md`, README feature list.
- Bump `package.json` (and lockfile) to **3.1.0** in the final commit; CHANGELOG heading `v3.1.0`.
- Known limitations to record: pattern-only suggestions (no validation, letters-for-digits missed); tags don't follow a
  partial volume move; project names not shown; no tags on Timeline cards or in the Editor; tags not exported to
  LogSeq.

## 10. Build order (each step leaves the app working and tested)

1. `lib/tags.js` + tests (normalize, suggest, derive, filter).
2. Storage: main handlers, preload, `local-store.js` facade, `stores/tags.js` + tests; load on start and on folder change.
3. Reader: `TagChip`, `TagInput`, `PageTagsStrip` with suggestions from the open page and dismissals.
4. Grid: tags on `PageThumb`, select mode + `BulkTagBar`, `TagFilterRow`, generalize `NotebookPages` to a page-list source.
5. Group by + tag cards + Untagged; Library home entry state.
6. Background suggestion scanner, thumbnail dot, review queue.
7. Tag manager in Settings; Ctrl K tag results.
8. Volume-move carry hook; docs, version bump, manual pass in the real app.
