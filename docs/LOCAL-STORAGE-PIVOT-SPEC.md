# Local Storage Pivot — v2.0 Spec

**Status:** Approved, in implementation
**Target version:** 2.0.0 (foundation) → 2.0.x (fine-tuning)
**Date:** 2026-05-28

This document describes the v2.0 architectural pivot: replacing LogSeq as the storage layer with plain JSON files in a user-chosen local folder.

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

Removed (v2.0.x): `logseqHost`, `logseqToken`, `logseqConnected`, `logseqStatusText`, `getLogseqSettings`, `setLogseqStatus`.

During the transition (Phases 2–3), both sets of settings coexist so the LogSeq save path remains available as a fallback.

---

## 6. UI Changes (Minimal)

**No visible change** to: canvas, pen controls, transcription editor modal, page-card layout, save-confirm dialog, activity log, search dialog.

**Visible changes:**
- Settings dropdown loses LogSeq Host / Token fields, gains a **Data Folder** field with a Browse button and an Open-in-Explorer button.
- Header status pill changes from `LogSeq: Connected` to `Folder: stroke-data` (showing the basename of `dataRoot`).
- The "Data Explorer" tab (renamed from "LogSeq Database") still shows book accordions with page cards, but data comes from `listPages()`.
- "Save to LogSeq" button reads "Save to Folder".
- **Unsaved-changes indicator** in the header (new): a small dot or label next to the save button when the canvas has changes that haven't been flushed to disk. Window-close hook prompts confirmation if unsaved changes exist. (User request #5.)

---

## 7. Migration

A one-shot importer reads existing `jpi/*.md` files and writes the new `pages/B###/P##.json` shape.

### Entry points

- **CLI:** `node scripts/migrate-from-logseq.cjs <jpi-folder> <output-folder>`
- **In-app:** "File → Migrate from LogSeq export…" menu item runs the same code path via IPC.

### Algorithm

For each `Smartpen Data___B{book}___P{page}.md`:

1. Extract page properties at the top of the file (`book::`, `page::`, `section::`, `owner::`).
2. Parse the `## Transcribed Content` outliner subtree:
   - Tab depth → `indentLevel`.
   - `id::` property → `lineId`.
   - `stroke-y-bounds:: {min}-{max}` → `yBounds`.
   - TODO/DONE prefix → `checked: true/false`.
   - Parent linkage from tab depth.
3. Parse the `## Raw Stroke Data` subtree:
   - First child block contains metadata JSON.
   - Subsequent child blocks contain stroke chunks.
   - Concatenate `strokes[]` from all chunks.
4. Write `pages/B{book}/P{page}.json` in the new shape, **preserving all existing IDs** so nothing has to be re-transcribed.
5. Write `pages/_aliases.json` from any LogSeq book-alias info found.

The importer is idempotent and non-destructive: it never deletes the source `jpi/*.md` files.

---

## 8. Implementation Phases

| Phase | Scope | Risk | Version |
|-------|-------|------|---------|
| **1 — Foundation** | PageDoc schema, `local-store.js` + Electron impl, IPC handlers, settings, migration importer. LogSeq save still default. | Low — read-only path, no destructive changes | 2.0.0-alpha |
| **2 — Write path** | `savePage` wired up. "Save to Folder (beta)" alongside LogSeq save. Both run on every save; outputs compared in dev. | Medium — only risk is the writer; mitigated by atomic write + parallel save | 2.0.0-beta |
| **3 — Default switch** | ActionBar, Data Explorer, transcript-updater point at file store. LogSeq save behind a "Legacy" toggle. Unsaved-changes indicator wired up. | Medium — UI rewire | 2.0.0 |
| **4 — Cleanup** | Delete `logseq-api.js`, `logseq-scanner.js`, `logseq-import.js`, LogSeq stores, LogSeq settings UI. Rename `components/logseq-db/` → `components/data-explorer/`. Test pass. | Low — pure deletion once Phase 3 is stable | 2.0.1+ |

---

## 9. Files Deleted in Phase 4

- `src/lib/logseq-api.js`
- `src/lib/logseq-scanner.js`
- `src/lib/logseq-import.js`
- `src/stores/logseqPages.js`
- `src/components/settings/LogseqSettings.svelte`
- `src/components/logseq-db/` (renamed, not deleted — same UI repurposed)
- `src/lib/__tests__/logseq-api.test.js` (replaced by `local-store.test.js`)

Trimmed (chunked-storage helpers removed):
- `src/lib/stroke-storage.js` — `splitStrokesIntoChunks`, `buildChunkedStorageObjects`, `parseChunkedJsonBlocks`, `parseJsonBlock`, `formatJsonBlock`.

Trimmed (block CRUD removed, in-memory mutation kept):
- `src/lib/transcript-updater.js` — drops `getTranscriptBlocks`, `createTranscriptBlockWithProperties`, `updateTranscriptBlockWithPreservation`. Keeps `mergeExistingAndNewLines`, Y-bounds matching.

---

## 10. Out of Scope for v2.0

- Web-build file-system support (FSA API). Electron only for now.
- Multi-root or workspace concept. Single data root.
- Sync / conflict resolution across machines. The user is responsible for syncing the folder (Dropbox, git, etc.).
- Live file-watching (auto-refresh when an external tool edits a `.json`). Listed as a future enhancement.
- Auto-versioning / backups. Out of scope; user owns version control.

---

## 11. Open Items (Tracked Separately)

- [ ] Decide what to do with existing `raw/` folder during migration (deprecate? leave?). Leaning toward leaving in place untouched — no migration action.
- [ ] Decide whether to move existing `processed/` and `reference/` under `exports/`. Leaning toward: do this in a separate one-shot script the user can opt into; not part of the automatic migration.
- [ ] Final unsaved-changes indicator design (dot vs. label vs. button color change).

---

## 12. Reference

- v1 architecture: [docs/QUICK-ARCHITECTURE-REFERENCE.md](QUICK-ARCHITECTURE-REFERENCE.md)
- v1 storage spec: [docs/TRANSCRIPT-STORAGE-SPEC.md](TRANSCRIPT-STORAGE-SPEC.md)
- CLAUDE.md notes for AI assistants — to be updated alongside Phase 3.
