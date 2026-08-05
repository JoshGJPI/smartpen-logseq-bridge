# SmartPen-LogSeq Bridge - Archive Index

**Last Updated**: August 5, 2026

This document provides an index of archived implementation documentation organized by feature area and date.

---

## Current Active Documents (Root & Docs)

### Root Directory
- `README.md` - Main project documentation
- `CLAUDE.MD` - AI assistant development guide — **authoritative for everything since the
  v2.0 pivot** (architecture, stores, and the "Recent Changes" narrative; this index does
  not duplicate that history, see the note below)

### Docs Directory
- `LOCAL-STORAGE-PIVOT-SPEC.md` - **Start here for storage.** v2.0 local-folder
  architecture; §12 records the amendments since (sketch-stroke pressure data, point editing)
- `QUICK-ARCHITECTURE-REFERENCE.md` - Canvas/pen quick lookups. Storage sections are
  v1/LogSeq-era and stale (self-flagged in the doc); capture/rendering sections still apply
- `app-specification.md` - Original technical specification (LogSeq-era; superseded by the
  pivot spec for storage details)
- `bridge-uuid-system.md` - Custom UUID system documentation
- `NEOSMARTPEN-SDK-USAGE.md`, `Smartpen Web SDK README.md` - Pen SDK reference
- `TRANSCRIPT-STORAGE-SPEC.md` - ⚠️ Historical — v1 transcript architecture (LogSeq blocks
  with properties). Current model is `transcript.lines[]` in the PageDoc; see
  `LOCAL-STORAGE-PIVOT-SPEC.md` §5
- `bullet-journal-spec.md` - Proposed, not implemented — hand-drawn bullet/symbol detection
- `logseq-markup-converter-spec.md` - Proposed, not implemented — handwritten-symbol → LogSeq
  markup conversion (distinct from the shipped `transcript-markdown.js` line-hierarchy copy)
- `temporal-data-specification.md` - Proposed, not implemented — timing-based analysis UI.
  Describes storage as "through LogSeq"; that's pre-pivot wording, though stroke timestamps
  are in fact still preserved in the current point-tuple format

### Implementation Logs
- `docs/implementation-logs/README.md` - Meta-doc describing the active/archive workflow
- `docs/implementation-logs/testing-checklist.md` - ⚠️ Stale — a v1 blockUuid/LogSeq
  manual-test procedure from Jan 2026. CLAUDE.md's own *Testing Considerations* section
  (automated test table + manual scenarios) is the current reference; this file is a
  candidate for archiving rather than "Active Development"

### Proposals
- `docs/proposals/` is currently empty. Its one occupant, `live-transcript-blocks-*`, was
  archived to `docs/Archive/2025-01-live-transcript-blocks-proposal/` — see that entry below

---

## Archive Organization

### Recent Implementations (2026-08)

#### **2026-01-superseded-planning-docs** ⚠️ SUPERSEDED
Pre-v2.0 planning docs, moved out of the root now that they no longer describe live behaviour:

**Files**:
- `FUTURE_ENHANCEMENTS_ROADMAP.md` - Line-consolidation merge/unmerge roadmap (Jan 22, 2026)
- `UUID-REFERENCE-GAP-SPEC.md` - Stroke→Block UUID persistence fix spec (Jan 23, 2026)

**Summary**: Both describe the v1 LogSeq `blockUuid` journal-sync architecture, which the
v2.0 local-storage pivot (May 2026) removed entirely. Neither was still an accurate "current
plans" or "to implement" pointer, so they were archived rather than left at the root
implying open work.

---

### Major Feature Eras (2026-05 – 2026-08) — 📌 Not Archived Here

Nothing below is missing by accident. Starting with the v2.0 pivot, this project stopped
spinning up a new dated `docs/Archive/` folder per feature and started keeping the
authoritative history directly in **CLAUDE.md → "Recent Changes (Git History Context)"**,
updated in place as each feature lands. That section (and `docs/LOCAL-STORAGE-PIVOT-SPEC.md`
for storage specifically) is the real source for everything below — this is only a dated
pointer so this index doesn't look like the trail goes cold in March 2026.

- **v2.0.0 (May 2026)** — LogSeq → Local Folder pivot. Storage replaced entirely: PageDoc
  JSON files, hybrid serializer, IPC-backed local-store, append-only save, migration script.
  See `docs/LOCAL-STORAGE-PIVOT-SPEC.md`.
- **v2.0.1 – v2.0.2 (May – June 2026)** — Book View toggle scaffolding, canvas-rendering and
  close-blocking fixes, RawJSON tab removed, metadata-only page loading (lazy stroke load).
- **v2.1.0 (June 2026)** — Book View: read/edit saved pages as spreads, transcript
  view/edit/copy, "Load into Editor."
- **"Publish to graph" (June 2026)** — auto-mirror every save into a LogSeq graph as plugin
  assets. **Superseded** by v2.3.0 below.
- **v2.2.0 (July 2026)** — Book View transcript editor: line reordering, side-by-side
  strokes-while-editing, a merge-ordering bug fix.
- **v2.3.0 (July 2026)** — Export to LogSeq: replaced auto-publish with a manual, selective,
  additive stroke export (`graph-export.js`); also fixed a `selectRange()` ReferenceError
  that broke every Shift+click range-select.
- **Clear-canvas fixes (July 2026)** — stale "in canvas" badge; pages piling at the origin
  after clearing and re-importing fewer strokes.
- **Copy transcript from canvas (July 2026)** — per-page and header copy-to-LogSeq-markdown
  buttons in the canvas text view.
- **Sketch strokes (August 2026, v2.4)** — pressure-varying line thickness
  (`sketch-width.js`, `stores/sketch.js`).
- **Pending-changes `modifications` (August 2026)** — sketch-flag toggles reported as their
  own dirty-state category, separate from additions/deletions.
- **Point editing (August 2026, v2.5)** — Edit Points mode; the one deliberate exception to
  immutable stored geometry, gated on an explicit `pointsEdited` marker.

---

### Recent Implementations (2026-03)

#### **2026-03-live-capture-canvas-fixes** ✅ COMPLETED
Live pen capture and canvas rendering bug fixes:

**Files**:
- `LIVE-CAPTURE-CANVAS-FIXES.md` - Complete fix summary (4 bugs across 3 files)

**Summary**: Fixed invalid pen-down dot artifact (origin-line + stale pageInfo), `calculateBounds` offsetY double-subtraction, zoom/pan reset on every stroke, and auto-fit viewport jumping during live writing. Added `setLiveWritingView()` method and rewrote StrokeCanvas auto-fit to distinguish live vs. offline sessions.

---

### Recent Implementations (2026-01/02)

#### **2026-02-data-loss-fixes** ✅ RESOLVED
Data loss fixes v3.1 — explicit append-only with tracked deletions:

**Files**:
- `DATA-LOSS-FIXES-SUMMARY.md` - Three data-loss issues and their fixes (commits `0a836ac`, `8c129a8`)

**Summary**: Transitioned from v3.0's implicit deletion detection (arithmetic count diff) to
explicit tracked deletions; fixed phantom stroke deletions, the Edit Structure UI, and
Y-bounds preservation across LogSeq round-trips. This is the v1/LogSeq-era predecessor of
the same "never infer deletions" principle the v2.0+ local-storage layer still follows.

---

#### **2026-01-electron-conversion** ✅ COMPLETED
Electron desktop app conversion guide:

**Files**:
- `ELECTRON_CONVERSION_GUIDE.md` - Step-by-step guide for converting to Electron desktop application

**Summary**: Conversion guide based on LogSeq Project Visualizer experience, covering Vite+Svelte to Electron migration steps.

---

#### **2026-01-hierarchical-blocks-fix** ✅ COMPLETED
Fix for LogSeq block creation order:

**Files**:
- `HIERARCHICAL-BLOCKS-FIX.md` - Block creation order fix documentation

**Summary**: Fixed issue where child blocks were created before parent blocks, breaking LogSeq hierarchy.

---

#### **2026-01-transcript-data-loss-fix** ✅ COMPLETED
Transcript data preservation fixes:

**Files**:
- `IMPLEMENTATION-SUMMARY.md` - Complete fix summary (Y-bounds, blockUuid, merge logic)
- `SESSION-SUMMARY-2026-01-28.md` - Session log with implementation details
- `APPEND-TROUBLESHOOTING-GUIDE.md` - Debugging guide for append transcription issues

**Summary**: Fixed transcript data loss during updates including Y-bounds preservation, blockUuid preservation, merge logic corrections, and read-only UI improvements.

---

#### **2026-01-transcription-blockuuid-bug** ✅ COMPLETED
BlockUUID over-assignment bug analysis:

**Files**:
- `TRANSCRIPTION-BLOCKUUID-ASSIGNMENT-ISSUE.md` - Deep analysis of UUID over-assignment bug

**Summary**: Documented and fixed bug where transcribing 691 strokes resulted in 1127 strokes incorrectly getting blockUuid assigned.

---

#### **2026-01-documentation-organization** ✅ COMPLETED
Documentation reorganization effort:

**Files**:
- `DOCUMENTATION-ORGANIZATION-COMPLETE.md` - January 23, 2026 reorganization summary

**Summary**: Meta-documentation describing the archive structure creation and file movements.

---

#### **2026-01-recent-implementations** ✅ COMPLETED
Latest features implemented in January 2026:

**Files**:
- `EDIT-STRUCTURE-COMPLETE.md` - Pre-save transcription editing
- `PROPERTY-CLEANUP-COMPLETE.md` - Removed unnecessary block properties
- `UUID-IMPLEMENTATION-COMPLETE.md` - Custom Bridge UUID system
- `custom-uuid-addition.md` - UUID implementation details
- `edit-structure-feature.md` - Edit structure feature docs
- `incremental-update-implementation-summary.md` - Incremental transcription updates
- `property-cleanup-and-stroke-fix.md` - Property cleanup + stroke→block fix attempt

**Summary**: Latest transcription system improvements including custom UUIDs, property cleanup, and edit structure feature. Note: the stroke→block UUID persistence gap mentioned here was specific to the v1 LogSeq journal workflow and never got that UI wiring — moot after the v2.0 pivot removed that mechanism entirely (see `docs/Archive/2026-01-superseded-planning-docs/UUID-REFERENCE-GAP-SPEC.md`).

---

#### **2026-01-transcription-editor** ✅ COMPLETED
Transcription editor modal implementation:

**Files**:
- `LINE_CONSOLIDATION_IMPLEMENTATION.md` - Line merge/split implementation
- `LINE_CONSOLIDATION_OPTIONS.md` - Design options for line consolidation
- `TESTING_GUIDE_LINE_CONSOLIDATION.md` - Testing procedures
- `TRANSCRIPTION_EDITOR_MODAL_SPEC.md` - Editor modal specification
- `transcription-editor-incremental-update-spec.md` - Incremental update design

**Summary**: Full transcription editor with merge, split, hierarchy adjustment, and undo/redo support.

---

#### **2026-01-book-aliases** ✅ COMPLETED
Book naming system for human-readable identification:

**Files**: Multiple implementation and fix documents

**Summary**: Book alias system allowing custom names (e.g., "Field Notes" instead of "B3017") with LogSeq property sync.

---

#### **2026-01-delete-strokes-implementation** ✅ COMPLETED
Stroke deletion with undo functionality:

**Files**: Delete feature implementation and fixes

**Summary**: Delete selected strokes with visual feedback, undo support, and proper canvas updates.

---

#### **2026-01-new-stroke-indicator** ✅ COMPLETED
UX improvements for stroke management:

**Files**: UX improvements implementation

**Summary**: Visual indicators for new strokes and improved selection feedback.

---

#### **2026-01-page-resizing** ✅ COMPLETED
Per-page zoom/scale functionality:

**Files**: Page resize feature spec and implementation

**Summary**: Individual page scaling with anchor point control and persistent settings.

---

#### **2026-01-smart-import-db-strokes** ✅ COMPLETED
Import strokes from LogSeq database:

**Files**: Import feature implementation and reference

**Summary**: Load previously saved strokes from LogSeq back into canvas for continued editing.

---

#### **2026-01-stroke-duplication** ✅ COMPLETED
Copy/paste/duplicate stroke functionality:

**Files**: Multiple implementation documents for copy/paste features

**Summary**: Full copy/paste support with clipboard, append mode, and unique timestamp generation.

---

#### **2026-01-stroke-memory-deletion** ✅ COMPLETED
Pen memory management:

**Files**: Pen memory deletion spec and implementation

**Summary**: Delete offline notes from pen memory to free up storage space.

---

#### **2026-01-transcript-search** ✅ COMPLETED
Search and preview transcriptions:

**Files**: Search dialog spec and implementation

**Summary**: Search across all transcriptions with page previews and navigation.

---

#### **2026-01-transcription-saving-clarifications** ✅ COMPLETED
Transcription save workflow improvements:

**Files**: Multiple bug fixes and feature enhancements for transcription saving

**Summary**: Selective page save, double-dash bug fixes, and improved transcription storage.

---

### Earlier Implementations (2025)

#### **2025-12-box-filtering** ✅ COMPLETED
Stroke filtering and preprocessing:

**Files**: Multiple implementation documents

**Summary**: Automatic detection and filtering of decorative elements (boxes, underlines) from transcription.

---

#### **2025-12-box-selection** ✅ COMPLETED
Box selection implementation:

**Files**: Multiple implementation and fix documents

**Summary**: Drag-to-select box selection with Ctrl+click multi-select and proper selection behavior.

---

#### **2025-12-db-import** ✅ COMPLETED
Database import features:

**Files**: Multiple specs and implementations

**Summary**: LogSeq database explorer and import functionality.

---

#### **2025-12-logseq-storage-implementation** ✅ COMPLETED
LogSeq storage system:

**Files**: Chunked storage implementation, line detection, format updates

**Summary**: Efficient chunked storage system (200 strokes/chunk) for large datasets with proper LogSeq integration.

---

#### **2025-12-ui-updates** ✅ COMPLETED
Major UI improvements:

**Files**: Multiple UI fixes and enhancements

**Summary**: Activity log fixes, hierarchy display, indentation detection, left panel consolidation, pen info header, and general UI cleanup.

---

#### **2025-property-based-storage-v2.0** ✅ COMPLETED
Property-based transcription storage architecture:

**Files**:
- `STORAGE_ARCHITECTURE_v2.0.md` - Complete v2.0 architecture
- `IMPLEMENTATION_SUMMARY_v2.0.md` - Implementation summary
- `INTEGRATION_COMPLETE_v2.0.md` - Integration completion
- `INTEGRATION_GUIDE_v2.0.md` - Integration guide
- `TESTING_CHECKLIST_v2.0.md` - Testing procedures
- `v2.0-property-display-import-fix.md` - Property display fix
- `property-filtering-complete.md` - Property filtering
- `property-filtering-display-fix.md` - Display fix
- `IMPLEMENTATION-COMPLETE.md` - General implementation completion
- `README_IMPLEMENTATION_COMPLETE.md` - README update

**Summary**: Major architectural change from code blocks to property-based storage (v2.0). Introduced `stroke-y-bounds`, `canonical-transcript`, and `stroke-ids` properties for intelligent incremental updates. Later refined to v3.0 with only `stroke-y-bounds` property.

---

#### **2025-01-live-transcript-blocks-proposal** ⚠️ SUPERSEDED
Proposal to store each transcribed line as a live LogSeq block:

**Files**:
- `live-transcript-blocks-spec.md` / `live-transcript-blocks-summary.md` / `live-transcript-blocks-visual.md` - v0.1.0 (Jan 2025)
- `live-transcript-blocks-spec-v2.md` / `live-transcript-blocks-summary-v2.md` / `live-transcript-blocks-visual-v2.md` - v0.2.0, added checkbox preservation + simplified properties (Jan 2025)

**Summary**: Proposed giving each transcribed line a LogSeq block with Y-bounds and a
canonical-transcript property, for granular updates and native LogSeq features (checked
tasks, tags) that survive re-transcription. Moved here (Aug 2026) rather than left in
`docs/proposals/` as pending: the v2.0 pivot removed LogSeq as the storage backend the whole
proposal was built on, and Book View's `TranscriptPane` (v2.1, June 2026) independently
delivers the same goal — granular per-line editing with preserved checkbox state — against
the current PageDoc `transcript.lines[]` model instead.

---

## Legacy/Voided Documents

### Archive Root
- `svelte-migration-spec.md` - Svelte 4 migration plan (partially completed)
- `VOIDED-implementation-summary-stroke-id-tracking.md` - Superseded approach
- `Github-Pages-DEPLOYMENT.md` - Deployment guide

---

## Document Type Guide

### Status Markers
- ✅ **COMPLETED** - Feature implemented and tested
- ⚠️ **TO IMPLEMENT** - Specification ready, awaiting implementation
- 🚧 **IN PROGRESS** - Currently under development
- ❌ **VOIDED** - Superseded or abandoned approach

### Document Types
- **SPEC** - Detailed feature specification
- **IMPLEMENTATION** - Implementation summary/guide
- **COMPLETE** - Completion summary with quick reference
- **FIX** - Bug fix documentation
- **SUMMARY** - High-level overview

---

## Finding Documents

### By Feature
Use the folder structure above to locate feature-specific documentation.

### By Date
Folders are organized by YYYY-MM-feature pattern.

### By Type
Look for suffixes: `-spec`, `-implementation`, `-complete`, `-fix`, `-summary`

---

## Notes for Developers

1. **Current State**: See root `CLAUDE.MD` — authoritative for everything since the v2.0
   pivot (architecture, stores, and the "Recent Changes" history)
2. **Architecture**: See `docs/LOCAL-STORAGE-PIVOT-SPEC.md` (storage, current) and
   `docs/QUICK-ARCHITECTURE-REFERENCE.md` (canvas/pen, still applies)
3. **Testing**: See CLAUDE.md → *Testing Considerations* (automated test table + manual
   scenarios, kept current alongside each feature). `docs/implementation-logs/testing-checklist.md`
   is a stale v1 procedure, not this
4. **Future Plans**: No live roadmap document at present. `FUTURE_ENHANCEMENTS_ROADMAP.md`
   was archived as superseded — see `docs/Archive/2026-01-superseded-planning-docs/`

---

## Archive Maintenance

This archive is organized to:
- Keep root directory clean (only active specs and README)
- Preserve implementation history
- Make document discovery easier
- Separate completed features from active development

**When to Archive**:
- Feature is complete and tested
- Document is superseded by newer version
- Quick reference docs after feature integration

**What Stays in Root/Docs**:
- Active specifications
- Current implementation logs
- Main README and roadmap
- Architecture documentation

---

*Archive Index maintained by: Claude Project System*  
*Last major reorganization: February 6, 2026*  
*Last catch-up pass: August 5, 2026 — added the missing `2026-02-data-loss-fixes` entry,
refreshed "Current Active Documents" to match what's actually current, added the
`2026-05`–`2026-08` major-feature-era timeline (v2.0 pivot through point editing, none of
which got dated Archive folders), and archived three superseded document sets: two
root-level docs (`docs/Archive/2026-01-superseded-planning-docs/`) and the
`live-transcript-blocks` proposal (`docs/Archive/2025-01-live-transcript-blocks-proposal/`),
leaving `docs/proposals/` empty. Everything from here forward should keep landing in
CLAUDE.md's "Recent Changes" section as it already has been — update this index only when a
new dated folder is actually archived.*
