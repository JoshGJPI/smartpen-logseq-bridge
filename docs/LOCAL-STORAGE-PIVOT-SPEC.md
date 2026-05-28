# Local Storage Pivot — v2.0 Spec

**Status:** ✅ Shipped in v2.0.0 (2026-05-28). Document retained as architectural reference.
**Version:** 2.0.0+

This document describes the v2.0 architectural pivot: LogSeq has been replaced as the storage layer with plain JSON files in a user-chosen local folder.

---

## 1. Motivation

The v1.x app uses LogSeq's HTTP API as a database — stroke data is chunked into JSON code blocks inside `Smartpen Data/B{book}/P{page}` pages, transcripts live as nested LogSeq blocks with properties.

Two problems:

1. **LogSeq performance degrades** as the stroke dataset grows. The graph DB was never designed to hold dense, frequently-rewritten JSON chunks.
2. **All the LogSeq plumbing is bookkeeping**, not feature value — chunking exists only to dodge block-size limits; markdown formatting exists only so LogSeq can render the page; the 500ms inter-chunk write delay exists only to avoid overwhelming the API. None of it benefits the user.

The pen capture, canvas, MyScript transcription, selection, and exports are all LogSeq-agnostic. Only storage, transcript persistence, and the "scan the database" view talk to LogSeq.

**The pivot:** point storage at a folder of plain JSON files. Keep the UI/UX identical. Drop ~1,200 lines of LogSeq integration code.

---

## 2. Folder Layout

The user picks a **data root** (default: `C:\Users\joshg\Documents\stroke-data` on the existing user's machine). Inside the root:

```
<data-root>/
├── pages/                       # App-managed: one file per pen page
│   ├── B3017/
│   │   ├── P42.json
│   │   ├── P43.json
│   │   └── ...
│   ├── B390/
│   │   └── P74.json
│   └── _aliases.json            # Book ID → friendly name map
└── exports/                     # User-modifiable: named exports, references
    ├── processed/               # Slug-keyed named selections (Gen1-1.json, etc.)
    └── reference/               # Reusable shape library (acorn.json, etc.)
```

**Rules:**
- The app owns `pages/`. It reads and writes freely. Users shouldn't hand-edit these (but it's safe if they do — they're just JSON).
- The app may *write* into `exports/` (via the stroke-selection export feature), but users own that folder afterward.
- Version control (git, etc.) is the user's concern. The app does not initialize, commit, or interact with `.git`.

The existing `jpi/`, `raw/`, `processed/`, `reference/` subfolders are recognized for migration only:
- `jpi/*.md` is parsed by the one-shot migration importer (§7) and written into `pages/`.
- `raw/`, `processed/`, `reference/` are left untouched. After migration, `processed/` and `reference/` can be moved into `exports/` by the user (or by the importer with consent).

---

## 3. File Schema

### `pages/B{book}/P{page}.json` (PageDoc)

```jsonc
{
  "version": "2.0",
  "pageInfo": {
    "section": 3,
    "owner": 1012,
    "book": 3017,
    "page": 42
  },
  "metadata": {
    "lastUpdated": "2026-05-28T14:22:01.000Z",  // ISO 8601
    "totalStrokes": 385,
    "bounds": { "minX": 5.43, "maxX": 60.24, "minY": 36.39, "maxY": 64.74 }
  },
  "transcript": {
    "lastTranscribed": "2026-05-28T14:25:00.000Z",
    "lines": [
      {
        "id": "955e79bf-6de8-4478-8a43-b12ddc2e5eda",
        "text": "12/9/25",
        "indentLevel": 0,
        "parentId": null,
        "checked": null,                  // null | true | false (TODO/DONE)
        "yBounds": { "minY": 1.6, "maxY": 8.6 }
      },
      {
        "id": "38de125d-7452-45c2-aa6a-b12d69faa5d8",
        "text": "TXDOT PEPS conference",
        "indentLevel": 1,
        "parentId": "955e79bf-6de8-4478-8a43-b12ddc2e5eda",
        "checked": null,
        "yBounds": { "minY": 6.4, "maxY": 12.4 }
      }
    ]
  },
  "strokes": [
    {
      "id": "s1765313505107",
      "startTime": 1765313505107,
      "endTime": 1765313505396,
      "lineId": "955e79bf-6de8-4478-8a43-b12ddc2e5eda",  // null until transcribed
      "points": [
        [6.56, 37.25, 1765313505107],
        [6.58, 37.30, 1765313505153]
      ]
    }
  ]
}
```

Notes:
- **One file per page.** Strokes and transcript are co-located. Atomic write (write `P42.json.tmp`, then rename) eliminates partial-write risk.
- **Pretty-printed.** Two-space indent. Diff-friendly; ~30% larger than minified but trivial in practice (~400 strokes typical, biggest current page ~600 KB pretty).
- `lineId` replaces the v1 `blockUuid` on strokes. It still uniquely identifies the transcript line a stroke belongs to, but it's now just an opaque string owned by the app — no LogSeq semantics.
- `transcript.lines` is a flat array. Hierarchy is expressed via `parentId` + `indentLevel`. This is simpler to mutate than a block tree.
- **Existing UUIDs are carried forward** during migration — strokes that have a `blockUuid` today keep that same ID as their `lineId`, so re-transcription is not required.
- `checked` carries TODO/DONE state from the existing format.

### `pages/_aliases.json`

```json
{
  "3017": "Field Notes",
  "390": "Calc Pad",
  "387": "Sketchbook"
}
```

Plain `{ bookId: friendlyName }`. Replaces the LogSeq book-alias pages.

### `exports/processed/{slug}.json` and `exports/reference/{slug}.json`

Existing format from commit 840334f is preserved verbatim:

```jsonc
{
  "id": "Heb1-1-1779113979064",
  "slug": "Heb1-1",
  "inkColor": "",
  "segments": [
    { "kind": "word", "strokes": [...] }
  ]
}
```

This is the user-facing export shape and the app's stroke-selection exporter already writes it.

---

## 4. Storage Module

### Public interface

A new module `src/lib/storage/local-store.js` exposes a single interface, with implementations chosen at runtime:

```js
// PageDoc, PageMeta, SaveResult are JSDoc-typed
listPages():               Promise<PageMeta[]>
getPage(book, page):       Promise<PageDoc | null>
savePage(book, page, doc): Promise<SaveResult>
deletePage(book, page):    Promise<void>
getAliases():              Promise<Record<number, string>>
setAlias(book, alias):     Promise<void>
removeAlias(book):         Promise<void>
pickFolder():              Promise<string | null>  // shows native folder picker
isAvailable():             Promise<boolean>        // can the chosen folder be read?
```

### Implementations

- **`electron-fs-store.js`** — wraps IPC handlers in `electron/main.cjs` that use `fs.promises.readFile / writeFile / readdir / rename / unlink`.
- **`fsa-store.js`** *(future, optional)* — File System Access API for a web build. Out of scope for v2.0.0; deferred until the Electron path is stable.

### Atomic write

```
write(pages/B3017/P42.json.tmp)
fsync
rename(pages/B3017/P42.json.tmp, pages/B3017/P42.json)
```

This guarantees no half-written file is ever visible to the app, even on crash or power loss.

---

## 5. Settings

`src/stores/settings.js` gains:

```js
export const dataRoot = createPersistedStore('dataRoot', '');     // absolute path
export const dataFolderReady = writable(false);                    // updated at boot
```

Removed in v2.0.0: `logseqHost`, `logseqToken`, `logseqConnected`, `logseqStatusText`, `getLogseqSettings`, `setLogseqStatus`.

---

## 6. UI Changes (Minimal)

**No visible change** to: canvas, pen controls, transcription editor modal, page-card layout, save-confirm dialog, activity log, search dialog.

**Visible changes shipped in v2.0:**
- Settings dropdown: LogSeq Host / Token fields removed; added **Data Folder** field with Browse, Verify, and Open-in-Explorer buttons.
- Header status pill: `LogSeq: Connected` → `Folder: stroke-data` (showing the basename of `dataRoot`).
- Tab renamed: "LogSeq DB" → "Saved Pages". Same layout (book accordions with page cards), data sourced from `listPages()`.
- Save button: "Save to LogSeq" → context-aware label — "Save Changes" when there are pending changes, "Save (Strokes + Text)" when a transcription is queued, "Save (Strokes)" otherwise. Hover title: "Save strokes and transcription to the data folder."
- **Unsaved-changes indicator:** amber dot pulses next to the Save button when the canvas has changes that haven't been flushed to disk. Window-close hook prompts confirmation when dirty.

---

## 7. Migration

A one-shot importer reads existing LogSeq-exported `.md` files and writes the new `pages/B###/P##.json` shape.

### Entry point

```
node scripts/migrate-from-logseq.cjs <input-md-folder> <output-data-root>
```

Example:
```
node scripts/migrate-from-logseq.cjs \
  "C:\Users\joshg\Documents\stroke-data\jpi" \
  "C:\Users\joshg\Documents\stroke-data"
```

The script walks `<input-md-folder>` non-recursively, picks up every file matching `Smartpen Data___B{book}___P{page}[suffix].md`, and writes `<output-data-root>/pages/B{book}/P{page}[suffix].json`. Run it multiple times against different source folders to consolidate (e.g. one pass for `jpi/`, one for `raw/`, one for `raw/archive/`).

### Algorithm

For each matching `.md` file:

1. Extract page properties at the top of the file (`book::`, `page::`, `section::`, `owner::`).
2. Parse the `## Transcribed Content` outliner subtree:
   - Tab depth → `indentLevel`.
   - `id::` property → `lineId`.
   - `stroke-y-bounds:: {min}-{max}` → `yBounds`.
   - TODO/DONE prefix → `checked: true/false`.
   - Parent linkage by tab depth.
3. Parse the `## Raw Stroke Data` subtree:
   - First child block contains metadata JSON.
   - Subsequent child blocks contain stroke chunks (each a v1 LogSeq chunked-storage block).
   - Concatenate `strokes[]` from all chunks.
4. Scrub dangling `lineId` references — strokes whose v1 `blockUuid` pointed to a transcript block that no longer exists in the source file (pre-existing v1 corruption from users deleting transcripts without clearing stroke associations).
5. Write `pages/B{book}/P{page}[suffix].json` using the hybrid pretty/compact serializer. **Preserves all existing line IDs** so previously transcribed content stays transcribed.

The importer is **idempotent** (re-runs overwrite cleanly) and **non-destructive** (source `.md` files are never modified or deleted).

### Letter-suffixed pages

User-created variants like `Smartpen Data___B390___P151b.md` are preserved as `pages/B390/P151b.json`. The integer `pageInfo.page` matches the actual NCode page number from inside the file; the filename suffix is the user's identifier and is honored by both the migrator and the Electron file scanner.

### Aliases

The importer does **not** migrate LogSeq book aliases (those lived as page properties on separate LogSeq pages, not in the `Smartpen Data___*.md` files). Re-enter aliases once in Settings → Book Aliases; they're then persisted to `<dataRoot>/pages/_aliases.json` and survive future runs.

### Migration receipts (real run, 2026-05-28)

The user's actual migration:
- `jpi/` → 69 pages, 73,264 strokes, 1,318 transcript lines
- `raw/` → 5 pages (incl. P151b, P151c, P152b suffixes), 1,951 strokes
- `raw/archive/` → 79 pages, 68,348 strokes, 48 transcript lines
- **Total: 154 pages, 145,289 strokes, 1,366 transcript lines, 80 MB on disk**

---

## 8. Implementation Phases (all complete)

| Phase | Scope | Status |
|-------|-------|--------|
| **1 — Foundation** | PageDoc schema, `local-store.js` + Electron impl, IPC handlers, settings, migration importer. | ✅ Shipped |
| **2 — Write path** | `savePage` wired up alongside LogSeq save for parallel verification. | ✅ Shipped |
| **3 — Default switch** | ActionBar, Data Explorer, transcript-updater point at file store. Unsaved-changes indicator wired up. | ✅ Shipped |
| **4 — Cleanup** | Deleted `logseq-api.js`, `logseq-scanner.js`, `logseq-import.js`, `transcript-updater.js`, LogSeq stores, LogSeq settings UI. Tests rewritten. | ✅ Shipped |

All four phases shipped in v2.0.0 (2026-05-28). The `components/logseq-db/` folder was *not* renamed (low value churn); the tab it renders is now labeled "Saved Pages".

---

## 9. Files Deleted in Phase 4

- `src/lib/logseq-api.js`
- `src/lib/logseq-scanner.js`
- `src/lib/logseq-import.js`
- `src/stores/logseqPages.js` — **kept** under the old name (semantically a "saved pages index"; rename was low-value churn)
- `src/components/logseq-db/` — **kept** under the old name; the rendered tab is now labeled "Saved Pages"
- `src/components/settings/LogseqSettings.svelte` — deleted
- `src/components/transcription/LogseqPreview.svelte` — deleted
- `src/lib/__tests__/logseq-api.test.js`, `transcript-updater.test.js` — deleted

Trimmed: `src/lib/stroke-storage.js` dropped `splitStrokesIntoChunks`, `buildChunkedStorageObjects`, `parseChunkedJsonBlocks`, `parseJsonBlock`, `formatJsonBlock`, `buildPageStorageObject`.

The transcript-merge logic (Y-bounds overlap, checkbox preservation, duplicate-line gating) was ported from the deleted `transcript-updater.js` into `src/lib/storage/save-page.js`.

---

## 10. Out of Scope for v2.0

- Web-build file-system support (FSA API). Electron only.
- Multi-root or workspace concept. Single data root.
- Sync / conflict resolution across machines. User syncs the folder externally (Dropbox, git, etc.).
- Live file-watching (auto-refresh when an external tool edits a `.json`). Future enhancement.
- Auto-versioning / backups. Out of scope; user owns version control.
- Renaming `components/logseq-db/` and `stores/logseqPages.js`. Cosmetic; no value churn.

---

## 11. Hybrid Serializer Detail

A pure pretty-printed PageDoc inflates dramatically: with `JSON.stringify(doc, null, 2)`, every point of every stroke spans 5 lines (`[`, `x`, `y`, `ts`, `]`). For a 1,700-stroke page that's ~140k lines of indent whitespace — ~60% of the file is structural noise.

`src/lib/storage/page-doc-format.js` exports `serializePageDoc(doc)` which:
- Pretty-prints the document shell (`version`, `pageInfo`, `metadata`, `transcript`)
- Inlines each entry in `strokes[]` as a single line

Result: structure remains scannable, per-stroke diffs still work, file size is ~40% of full-pretty. Both the migration script and the Electron IPC writer (`writePageDoc` in `electron/main.cjs`) use this serializer.

Measured: largest B3017 page went 2479 KB (full pretty) → 986 KB (hybrid).

---

## 12. Reference

- v1 architecture: [docs/QUICK-ARCHITECTURE-REFERENCE.md](QUICK-ARCHITECTURE-REFERENCE.md) (canvas/pen still apply; storage details are v1)
- v1 storage spec: [docs/TRANSCRIPT-STORAGE-SPEC.md](TRANSCRIPT-STORAGE-SPEC.md) (historical)
- CLAUDE.md — updated for v2.0 (start there for AI-assisted work)
