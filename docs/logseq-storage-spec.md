# LogSeq Storage Specification - SmartPen Data

**Version:** 1.0.0  
**Date:** December 2024  
**Purpose:** Define how SmartPen stroke data and transcriptions are stored in LogSeq for archival, incremental updates, and future rendering

---

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [Namespace Structure](#namespace-structure)
4. [Data Schema](#data-schema)
5. [Incremental Update Algorithm](#incremental-update-algorithm)
6. [LogSeq Page Template](#logseq-page-template)
7. [Renderer Macro Requirements](#renderer-macro-requirements)
8. [Implementation Plan](#implementation-plan)

---

## Overview

### Goals

1. **Archive raw stroke data** for future reprocessing (improved ML models, different transcription engines)
2. **Store transcribed text** with hierarchy for searchability and reference
3. **Enable incremental updates** as new strokes are captured from the same page
4. **Minimize storage overhead** by excluding artistic metadata (pen tilt, pressure sensitivity)
5. **Support macro rendering** of stroke data for visual preview in LogSeq

### Non-Goals

- Real-time collaborative editing (single user, append-only)
- Artistic rendering quality (basic line sketches only)
- Undo/redo history (stored data is immutable once written)

---

## Design Principles

### 1. Database Pages, Not Working Notes

Storage pages in `Smartpen Data/*` namespace are **archive/database pages**, not where users read or edit notes. Think of them like:
- Git repository data (`.git/objects/`)
- Database tables (for querying/referencing elsewhere)
- Build artifacts (generated, not hand-edited)

Users reference or embed content from these pages into their actual notes.

### 2. Separation of Concerns

```
┌─────────────────────────────────────────┐
│ Smartpen Data/B3017/P42                 │  ← Storage page
│ ├── Raw Strokes (JSON)                  │     (machine-readable)
│ ├── Transcription Metadata (JSON)       │
│ └── Transcribed Text (plain text)       │
└─────────────────────────────────────────┘
                    ▲
                    │ (reference/embed)
                    │
┌─────────────────────────────────────────┐
│ 2024-12-12 (Journal)                    │  ← Working notes
│ [[Smartpen Data/B3017/P42]]             │     (human-readable)
│ {{renderer smartpen, B3017, P42}}       │
└─────────────────────────────────────────┘
```

### 3. Incremental, Append-Only Updates

Storage pages are updated incrementally:
- **Existing strokes** remain untouched (by `strokeId`)
- **New strokes** are appended to the JSON array
- **Transcriptions** are regenerated on-demand (not stored per-stroke)

This approach:
- Handles offline pen uploads (batches of old strokes)
- Avoids duplicate storage when pen is synced multiple times
- Maintains stroke order by timestamp

---

## Namespace Structure

### Page Naming Convention

```
Smartpen Data/[Book ID]/[Page ID]
```

**Examples:**
```
Smartpen Data/B3017/P42
Smartpen Data/B3017/P43
Smartpen Data/B1234/P1
```

### Components

| Component | Source | Format | Example |
|-----------|--------|--------|---------|
| `Book ID` | `pageInfo.book` | `B{book}` | `B3017` |
| `Page ID` | `pageInfo.page` | `P{page}` | `P42` |

**Note:** `section` and `owner` are excluded from the page name because:
- **Section** is rarely used (typically 3 for most Ncode paper)
- **Owner** is pen-specific (same physical page can have different owners)
- Including them creates excessive namespace fragmentation

We store `section` and `owner` in the JSON metadata for completeness but don't use them for page identification.

### Example Hierarchy

```
Smartpen Data/
├── B3017/
│   ├── P42
│   ├── P43
│   └── P44
├── B1234/
│   ├── P1
│   └── P2
└── Index
```

The `Smartpen Data/Index` page lists all books with metadata (optional enhancement).

---

## Data Schema

### Essential vs Non-Essential Data

After reviewing the raw pen data, here's what we need for note-taking:

#### ✅ Essential (Store)

| Field | Purpose | Storage Impact |
|-------|---------|----------------|
| `x, y` | Stroke coordinates | **High** - core data |
| `timestamp` | Stroke ordering, animation | **Medium** |
| `pageInfo` | Book/page identification | **Low** - once per page |
| `startTime, endTime` | Stroke timing metadata | **Low** - once per stroke |

#### ❌ Non-Essential (Exclude)

| Field | Reason for Exclusion |
|-------|---------------------|
| `angle.tx, ty, twist` | Pen tilt - artistic rendering only |
| `f` (pressure) | Pressure sensitivity - not needed for line notes |
| `color` | Always black for notes (4278190080) |
| `dotType` | Pen hardware detail (0=down, 1=move, 2=up) |
| `penTipType` | Pen hardware detail |

**Storage Savings:** Excluding these fields reduces storage by ~60% for typical note pages.

### Simplified Stroke Schema

```json
{
  "version": "1.0",
  "pageInfo": {
    "section": 3,
    "owner": 1012,
    "book": 3017,
    "page": 42
  },
  "strokes": [
    {
      "id": "s1765313505107",
      "startTime": 1765313505107,
      "endTime": 1765313505396,
      "points": [
        [6.56, 37.25, 1765313505107],
        [6.58, 37.30, 1765313505153],
        [6.60, 37.46, 1765313505177]
      ]
    }
  ],
  "metadata": {
    "lastUpdated": 1765368883377,
    "strokeCount": 145,
    "bounds": {
      "minX": 6.56,
      "maxX": 42.91,
      "minY": 37.25,
      "maxY": 54.28
    }
  }
}
```

#### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `version` | string | Schema version for future compatibility |
| `pageInfo` | object | Ncode page identification (section, owner, book, page) |
| `strokes` | array | Array of stroke objects |
| `strokes[].id` | string | Unique stroke ID: `s{startTime}` |
| `strokes[].startTime` | number | Unix timestamp (ms) when stroke began |
| `strokes[].endTime` | number | Unix timestamp (ms) when stroke ended |
| `strokes[].points` | array | Array of `[x, y, timestamp]` tuples |
| `metadata.lastUpdated` | number | Last update timestamp |
| `metadata.strokeCount` | number | Total stroke count (for quick checks) |
| `metadata.bounds` | object | Bounding box for canvas dimensions |

**Points Format:** Each point is `[x, y, timestamp]` where:
- `x, y` are in Ncode millimeters (float)
- `timestamp` is Unix milliseconds (integer)

### Transcription Schema

```json
{
  "version": "1.0",
  "transcribedAt": 1765368900000,
  "engine": "myscript",
  "engineVersion": "2.0",
  "text": "Meeting Notes\n  Discussed Q1 roadmap\n  Action items",
  "lines": [
    {
      "text": "Meeting Notes",
      "indentLevel": 0,
      "x": 6.56,
      "baseline": 142.3,
      "parent": null,
      "children": [1, 2]
    },
    {
      "text": "Discussed Q1 roadmap",
      "indentLevel": 1,
      "x": 22.4,
      "baseline": 158.7,
      "parent": 0,
      "children": []
    }
  ],
  "commands": [
    {
      "type": "page",
      "value": "Meeting Notes",
      "lineIndex": 0,
      "scope": [0, 1, 2]
    }
  ],
  "metadata": {
    "strokeCount": 145,
    "confidence": 0.92,
    "processingTime": 1847
  }
}
```

#### Field Definitions

| Field | Type | Description |
|-------|------|-------------|
| `transcribedAt` | number | When transcription was generated |
| `engine` | string | Recognition engine used (`myscript`) |
| `engineVersion` | string | Engine version for reprocessing |
| `text` | string | Full transcribed text with `\n` line breaks |
| `lines` | array | Structured lines with hierarchy |
| `lines[].text` | string | Line content (no command markers) |
| `lines[].indentLevel` | number | Hierarchy level (0, 1, 2, ...) |
| `lines[].x` | number | X position (for indent calculation) |
| `lines[].baseline` | number | Y baseline (for rendering) |
| `lines[].parent` | number\|null | Parent line index (null for root) |
| `lines[].children` | array | Child line indices |
| `commands` | array | Detected commands ([page:], [sketch:], etc.) |
| `metadata.strokeCount` | number | Strokes transcribed (should match raw) |
| `metadata.confidence` | number | Overall confidence (0.0-1.0) |

---

## Incremental Update Algorithm

### Stroke Deduplication

**Problem:** When downloading offline strokes, the pen may contain strokes already uploaded in real-time.

**Solution:** Use `strokeId` (based on `startTime`) as a unique identifier.

```javascript
async function updatePageStrokes(pageId, newStrokes) {
  // 1. Fetch existing page
  const page = await logseq.getPage(`Smartpen Data/${pageId}`);
  
  // 2. Parse existing stroke data
  const existingData = page ? parseJsonBlock(page) : { strokes: [] };
  const existingIds = new Set(existingData.strokes.map(s => s.id));
  
  // 3. Filter out duplicates
  const uniqueStrokes = newStrokes.filter(s => !existingIds.has(s.id));
  
  if (uniqueStrokes.length === 0) {
    console.log('No new strokes to add');
    return;
  }
  
  // 4. Merge and sort by timestamp
  const allStrokes = [...existingData.strokes, ...uniqueStrokes]
    .sort((a, b) => a.startTime - b.startTime);
  
  // 5. Update metadata
  const bounds = calculateBounds(allStrokes);
  const updatedData = {
    ...existingData,
    strokes: allStrokes,
    metadata: {
      lastUpdated: Date.now(),
      strokeCount: allStrokes.length,
      bounds
    }
  };
  
  // 6. Write back to LogSeq
  await updateJsonBlock(page, updatedData);
}
```

### Update Flow

```
New strokes captured
    │
    ├─→ Group by (book, page)
    │
    ├─→ For each page:
    │   │
    │   ├─→ Get or create LogSeq page
    │   │
    │   ├─→ Parse existing JSON block
    │   │
    │   ├─→ Filter duplicates (by strokeId)
    │   │
    │   ├─→ Append new strokes
    │   │
    │   ├─→ Sort by startTime
    │   │
    │   ├─→ Update metadata
    │   │
    │   └─→ Write JSON block
    │
    └─→ Log summary to activity panel
```

---

## LogSeq Page Template

### Example Page: `Smartpen Data/B3017/P42`

```markdown
## Page Information

- **Book:** 3017
- **Page:** 42
- **Last Updated:** 2024-12-12 14:32:15
- **Stroke Count:** 145
- **Status:** Transcribed

## Raw Stroke Data

```json
{
  "version": "1.0",
  "pageInfo": {
    "section": 3,
    "owner": 1012,
    "book": 3017,
    "page": 42
  },
  "strokes": [
    {
      "id": "s1765313505107",
      "startTime": 1765313505107,
      "endTime": 1765313505396,
      "points": [
        [6.56, 37.25, 1765313505107],
        [6.58, 37.30, 1765313505153]
      ]
    }
  ],
  "metadata": {
    "lastUpdated": 1765368883377,
    "strokeCount": 145,
    "bounds": {
      "minX": 6.56,
      "maxX": 42.91,
      "minY": 37.25,
      "maxY": 54.28
    }
  }
}
```

## Transcription Data

```json
{
  "version": "1.0",
  "transcribedAt": 1765368900000,
  "engine": "myscript",
  "text": "Meeting Notes\n  Discussed Q1 roadmap",
  "lines": [
    {
      "text": "Meeting Notes",
      "indentLevel": 0,
      "x": 6.56,
      "parent": null,
      "children": [1]
    }
  ]
}
```

## Transcribed Text

Meeting Notes
  Discussed Q1 roadmap
  Action items below
```

### Block Structure

```
Smartpen Data/B3017/P42
├── Heading: Page Information (metadata bullets)
├── Heading: Raw Stroke Data
│   └── Code block: JSON (language: json)
├── Heading: Transcription Data
│   └── Code block: JSON (language: json)
└── Heading: Transcribed Text
    └── Plain text block (for readability)
```

### Properties (Optional Enhancement)

```clojure
book:: 3017
page:: 42
stroke-count:: 145
transcribed:: true
last-updated:: [[2024-12-12]]
```

These properties enable queries like:
- All pages from book 3017
- Untranscribed pages
- Recently updated pages

---

## Renderer Macro Requirements

### Concept

A LogSeq macro (`{{renderer smartpen, B3017, P42}}`) that reads stroke data and renders an SVG preview inline.

### Macro Usage

```markdown
## My Meeting Notes

See handwritten notes: {{renderer smartpen, B3017, P42}}

Key takeaways:
- Action item 1
- Action item 2
```

### Renderer Implementation Needs

#### 1. Data Access

The renderer needs to:
1. Parse the macro arguments (`book`, `page`)
2. Find the page `Smartpen Data/B{book}/P{page}`
3. Extract JSON from the "Raw Stroke Data" code block
4. Parse JSON and render strokes

#### 2. SVG Generation

```javascript
function renderStrokes(strokeData) {
  const { strokes, metadata } = strokeData;
  const { bounds } = metadata;
  
  // Calculate viewBox
  const padding = 5;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const height = bounds.maxY - bounds.minY + padding * 2;
  
  // Generate SVG paths
  const paths = strokes.map(stroke => {
    const points = stroke.points
      .map(([x, y]) => `${x - bounds.minX + padding},${y - bounds.minY + padding}`)
      .join(' ');
    return `<polyline points="${points}" stroke="black" fill="none" stroke-width="0.5"/>`;
  });
  
  return `
    <svg viewBox="0 0 ${width} ${height}" width="400">
      ${paths.join('\n')}
    </svg>
  `;
}
```

#### 3. Renderer Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Static render | Show all strokes at once | ✅ MVP |
| Stroke order | Render in chronological order | ⭐ Nice-to-have |
| Animation | Playback strokes over time | ⭐ Nice-to-have |
| Zoom/pan | Interactive canvas controls | ⭐ Nice-to-have |
| Overlay transcription | Show text overlaid on strokes | ⭐ Advanced |

#### 4. Example Renderer Code (Skeleton)

```javascript
// LogSeq plugin macro handler
logseq.Editor.registerSlashCommand('smartpen', async (uuid) => {
  const block = await logseq.Editor.getBlock(uuid);
  const match = block.content.match(/{{renderer smartpen,\s*([^,]+),\s*([^}]+)}}/);
  
  if (!match) return;
  
  const [_, book, page] = match;
  const pageId = `Smartpen Data/${book.trim()}/${page.trim()}`;
  
  // Fetch page
  const strokePage = await logseq.Editor.getPage(pageId);
  if (!strokePage) {
    return `<div>Page not found: ${pageId}</div>`;
  }
  
  // Extract JSON from code block
  const jsonBlock = findCodeBlock(strokePage, 'Raw Stroke Data');
  const strokeData = JSON.parse(jsonBlock.content);
  
  // Render SVG
  const svg = renderStrokes(strokeData);
  
  // Insert into block
  await logseq.Editor.updateBlock(uuid, svg);
});
```

### Alternative: iFrame Renderer

Instead of inline SVG, use an iframe to the bridge app:

```html
<iframe 
  src="http://localhost:5173/render?book=3017&page=42" 
  width="600" 
  height="400"
></iframe>
```

The bridge app hosts a `/render` route that displays strokes from LogSeq data.

**Pros:**
- Reuse existing canvas rendering code
- Full interactivity (pan, zoom, selection)
- No need for separate plugin development

**Cons:**
- Requires bridge app running
- Less integrated into LogSeq

---

## Implementation Plan

### Phase 1: Storage Implementation (3-4 hours)

#### Tasks

1. **Create LogSeq API methods** (`lib/logseq-api.js`)
   - `getOrCreateSmartpenPage(book, page)`
   - `getPageStrokes(book, page)`
   - `updatePageStrokes(book, page, newStrokes)`
   - `updatePageTranscription(book, page, transcription)`

2. **Add data transformation utilities** (`lib/stroke-storage.js`)
   - `convertToStorageFormat(strokes)` - simplify pen data
   - `generateStrokeId(stroke)` - create unique IDs
   - `calculateBounds(strokes)` - compute bounding box
   - `deduplicateStrokes(existing, new)` - filter duplicates

3. **Update UI flow**
   - Add "Save to LogSeq" button in transcription panel
   - Add "Save Raw Strokes" button in canvas panel
   - Show storage status (saved, updating, error)

4. **Test incremental updates**
   - Write real-time strokes → verify storage
   - Download offline strokes → verify deduplication
   - Add more strokes to same page → verify append

### Phase 2: Transcription Integration (2-3 hours)

#### Tasks

1. **Modify transcription workflow**
   - After MyScript transcription completes
   - Automatically save transcription data to LogSeq
   - Link strokes → transcription in storage

2. **Add transcription display**
   - Show plain text transcription in LogSeq page
   - Format with proper indentation
   - Optionally preserve commands for reference

3. **Test workflow**
   - Write → Transcribe → Verify storage
   - Re-transcribe → Verify update (not duplicate)

### Phase 3: Renderer Macro (4-6 hours)

**Options:**

#### Option A: LogSeq Plugin (More Work)
- Create new LogSeq plugin project
- Implement macro handler
- Parse stroke JSON and render SVG
- Publish to LogSeq marketplace

#### Option B: iFrame Integration (Less Work)
- Add `/render` route to bridge app
- Parse `?book=X&page=Y` query params
- Fetch data from LogSeq HTTP API
- Render using existing canvas code

**Recommendation:** Start with Option B (iFrame) for quick validation, then build Option A if users want native integration.

### Phase 4: Enhanced Features (Optional)

- Page index generation (`Smartpen Data/Index`)
- Bulk operations (transcribe all untranscribed pages)
- Export utilities (download all data as ZIP)
- Advanced queries (find pages by date, stroke count, etc.)

---

## File Changes Summary

### New Files

```
src/
├── lib/
│   └── stroke-storage.js          # Data transformation utilities
└── stores/
    └── storage.js                 # Storage state (saved pages, status)
```

### Modified Files

```
src/
├── lib/
│   └── logseq-api.js              # Add storage methods
├── components/
│   ├── canvas/
│   │   └── CanvasPanel.svelte     # Add "Save Raw Strokes" button
│   └── transcription/
│       └── TranscriptionPanel.svelte  # Add storage status display
└── App.svelte                     # Wire up storage workflow
```

---

## Example Usage Scenarios

### Scenario 1: Real-Time Note Taking

1. Connect pen to bridge app
2. Write on page 42 of book 3017
3. Strokes appear in real-time
4. Click "Save to LogSeq"
5. Page `Smartpen Data/B3017/P42` created with stroke JSON
6. Click "Transcribe"
7. Transcription added to same page
8. Plain text appears in "Transcribed Text" section

### Scenario 2: Offline Batch Upload

1. Write 5 pages offline (pen not connected)
2. Connect pen
3. Download offline notes (145 strokes from page 42)
4. Strokes saved to `Smartpen Data/B3017/P42`
5. Transcribe all 5 pages in batch
6. All pages now have raw + transcribed data

### Scenario 3: Using Stored Data

1. Open journal page `2024-12-12`
2. Write: `Notes from meeting: [[Smartpen Data/B3017/P42]]`
3. Link opens storage page
4. Copy transcribed text into journal
5. Optionally: `{{renderer smartpen, B3017, P42}}` to embed visual

---

## Appendix: Storage Size Estimates

### Typical Note Page

- **Strokes:** 100-200 (10-15 minutes of writing)
- **Points per stroke:** 10-50
- **Raw JSON:** ~15-30 KB per page
- **Transcription JSON:** ~2-5 KB per page

### 1-Year Usage

- **Pages per day:** 2-3
- **Total pages:** ~900
- **Total storage:** 15-30 MB

LogSeq can easily handle this - it's smaller than a typical PDF book.

---

## References

- [LogSeq HTTP API Documentation](https://docs.logseq.com/#/page/api)
- [LogSeq Block Properties](https://docs.logseq.com/#/page/properties)
- [Ncode Paper Coordinate System](https://neosmartpen.com/en/support/)
- MyScript JIIX Format (internal reference)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2024-12-12 | Initial specification |

---

**End of Specification**
