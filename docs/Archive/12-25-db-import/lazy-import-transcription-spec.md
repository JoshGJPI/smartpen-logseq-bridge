# Lazy Import Transcription Specification

**Date:** December 2025  
**Status:** Draft  
**Purpose:** Define a dual-mode transcription system that balances quick capture with full-context accuracy

---

## Problem Statement

When follow-up strokes are added to an existing page after the initial data within the pen has been removed, MyScript has no context for the new strokes. This leads to:

1. **Reduced transcription accuracy** - No context for writing style, spacing, or word patterns
2. **Orphaned content** - New text may not logically connect to existing content
3. **Inconsistent hierarchy** - Indentation detection suffers without full-page baseline

## Solution Overview

Implement a **Lazy Import** approach with two distinct workflows:

| Mode | When to Use | Data Source | Performance | Accuracy |
|------|-------------|-------------|-------------|----------|
| **Quick Capture** (default) | Real-time notes, quick additions | Current strokes only | Fast | Good |
| **Full Page Refresh** | Final transcription, accuracy needed | LogSeq + current strokes | Slower | Best |

Additionally, maintain a **Local Stroke Cache** to provide session context even when LogSeq is unavailable.

---

## Architecture

### Data Flow: Quick Capture (Default)

```
Pen Strokes → Local Cache (append) → MyScript → LogSeq (append)
```

- Transcribes only current session strokes
- Appends new content to existing LogSeq page
- Fast, works without LogSeq connection
- Local cache grows incrementally

### Data Flow: Full Page Refresh

```
LogSeq Strokes ─┬─► Merge & Dedupe → MyScript → LogSeq (replace)
                │
Local Cache ────┘
```

- Fetches all stored strokes from LogSeq
- Merges with local cache (handles strokes not yet saved)
- Re-transcribes entire page
- Replaces LogSeq content with fresh transcription
- Clears and rebuilds local cache from merged data

---

## Local Stroke Cache

### Purpose

Maintain stroke context across browser sessions without requiring LogSeq connection. Acts as a buffer, not a source of truth.

### Storage

**Technology:** IndexedDB (via idb-keyval or raw API)

**Rationale:** 
- Larger storage limits than localStorage (~50MB+ vs 5MB)
- Async API won't block UI
- Structured data support
- Persists across browser sessions

### Schema

```typescript
interface CachedPage {
  key: string;              // "book:page" e.g., "3017:42"
  strokes: SimplifiedStroke[];
  lastUpdated: number;      // Unix timestamp
  lastSyncedToLogSeq: number | null;  // When last saved to LogSeq
  version: string;          // Schema version for migrations
}

interface SimplifiedStroke {
  id: string;               // "s{startTime}"
  startTime: number;
  endTime: number;
  points: [number, number, number][];  // [x, y, timestamp]
}
```

### Cache Operations

| Operation | Trigger | Behavior |
|-----------|---------|----------|
| **Append** | Stroke received from pen | Add to page cache, update `lastUpdated` |
| **Get** | Transcription requested | Return all strokes for page |
| **Sync** | After successful LogSeq save | Update `lastSyncedToLogSeq` timestamp |
| **Replace** | After Full Page Refresh | Clear and rebuild from merged strokes |
| **Prune** | App startup (optional) | Remove pages older than 30 days |

### Cache vs LogSeq Relationship

```
┌─────────────────────────────────────────────────────────────┐
│                    Local Stroke Cache                        │
│  • Always updated when strokes arrive                        │
│  • May contain strokes not yet in LogSeq                     │
│  • Used as fallback when LogSeq unavailable                  │
│  • Rebuilt from LogSeq during Full Page Refresh              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Sync (one-way, cache → LogSeq)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    LogSeq Storage                            │
│  • Source of truth for persisted data                        │
│  • Contains stroke JSON + transcription                      │
│  • May lag behind cache if saves fail                        │
│  • Authoritative for Full Page Refresh operations            │
└─────────────────────────────────────────────────────────────┘
```

---

## Workflow Details

### Workflow 1: Quick Capture (Default)

**Trigger:** User clicks "Transcribe" with strokes in canvas

**Steps:**

1. Get current strokes from Svelte store (selected or all)
2. Convert strokes to MyScript format
3. Send to MyScript API
4. Parse transcription result
5. Display in UI
6. If LogSeq connected:
   - Append new strokes to existing page stroke JSON
   - Append new transcription blocks
7. Update local cache `lastSyncedToLogSeq`

**Error Handling:**

| Error | Behavior |
|-------|----------|
| MyScript fails | Show error, strokes remain in cache |
| LogSeq unreachable | Transcription shows in UI, save skipped, cache intact |
| Partial save | Log warning, cache marks as unsynced |

### Workflow 2: Full Page Refresh

**Trigger:** User clicks "Refresh Full Page" button (new UI element)

**Prerequisites:** 
- LogSeq must be connected (button disabled otherwise)
- Page must exist in LogSeq (or fall back to cache-only)

**Steps:**

1. **Fetch from LogSeq**
   - Get page by name (`Smartpen Data/B{book}/P{page}`)
   - Parse stroke JSON from "Raw Stroke Data" block
   - Handle missing page gracefully

2. **Merge with Local Cache**
   - Get cached strokes for same page
   - Deduplicate by stroke ID (`s{startTime}`)
   - Sort merged strokes by `startTime`

3. **Merge with Current Session**
   - Include any strokes in Svelte store not yet in cache
   - Deduplicate again

4. **Transcribe Full Page**
   - Convert all merged strokes to MyScript format
   - Send to MyScript API
   - Parse complete transcription

5. **Update LogSeq (Replace)**
   - Archive previous stroke JSON (optional, see Data Safety)
   - Write new stroke JSON with all merged strokes
   - Replace transcription data completely
   - Update page properties (stroke count, last updated)

6. **Rebuild Local Cache**
   - Clear cache for this page
   - Repopulate with merged stroke set
   - Update `lastSyncedToLogSeq`

7. **Update UI**
   - Show complete transcription
   - Update stroke list if needed

**Error Handling:**

| Error | Behavior |
|-------|----------|
| LogSeq fetch fails | Fall back to cache + current strokes, warn user |
| MyScript fails | Abort, no changes to LogSeq or cache |
| LogSeq save fails | Show transcription in UI, warn about save failure |

---

## UI Changes

### Transcription Panel

```
┌─────────────────────────────────────────────────┐
│  Transcription                                   │
├─────────────────────────────────────────────────┤
│                                                  │
│  [Transcribe Selected]  [Transcribe All]        │
│                                                  │
│  ─────────────────────────────────────────────  │
│                                                  │
│  [🔄 Refresh Full Page]                         │
│    ↳ Imports stored strokes from LogSeq,        │
│      re-transcribes entire page                 │
│                                                  │
│  ─────────────────────────────────────────────  │
│                                                  │
│  (transcription results here)                   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Button States

| Button | Condition | State |
|--------|-----------|-------|
| Transcribe Selected | No strokes selected | Disabled |
| Transcribe All | No strokes in canvas | Disabled |
| Refresh Full Page | LogSeq not connected | Disabled with tooltip |
| Refresh Full Page | Multiple pages in canvas | Disabled with tooltip "Select single page" |
| Refresh Full Page | LogSeq connected, single page | Enabled |

### Activity Log Messages

```
Quick Capture:
  ✓ Transcribed 45 strokes → 12 lines
  ✓ Saved to LogSeq: Smartpen Data/B3017/P42

Full Page Refresh:
  ↓ Importing strokes from LogSeq: Smartpen Data/B3017/P42
  ↓ Found 234 stored strokes
  ⟳ Merging with 45 new strokes (279 total, 0 duplicates)
  → Transcribing full page...
  ✓ Full page transcription: 52 lines
  ✓ Updated LogSeq with complete data
```

---

## Data Safety

### Archive Strategy

When performing Full Page Refresh, optionally preserve previous data:

```markdown
- ## Raw Stroke Data
  collapsed:: true
  - ```json
    { "version": "1.0", "strokes": [...], ... }
    ```

- ## Previous Stroke Data (Archived 2024-12-18T14:30:00)
  collapsed:: true
  - ```json
    { "version": "1.0", "strokes": [...], ... }
    ```
```

**Retention:** Keep only the most recent archive. Overwrite on next Full Page Refresh.

**Configuration:** Add setting `archivePreviousStrokes: boolean` (default: true)

### Version Tracking

Include metadata for debugging data issues:

```json
{
  "version": "1.0",
  "metadata": {
    "lastUpdated": 1734567890123,
    "lastRefreshType": "full",      // "quick" | "full"
    "sourceVersion": "0.2.1",       // App version
    "strokeCount": 279,
    "mergeInfo": {                   // Only for full refresh
      "fromLogSeq": 234,
      "fromCache": 45,
      "duplicatesRemoved": 0
    }
  }
}
```

### Recovery Scenarios

| Scenario | Recovery |
|----------|----------|
| LogSeq data corrupted | Use local cache as source, Full Page Refresh to rebuild |
| Local cache lost | Next Full Page Refresh will rebuild from LogSeq |
| Both lost | Data gone; export feature (future) would help |
| App crash during save | Cache and LogSeq may be out of sync; Full Page Refresh fixes |

---

## Implementation Phases

### Phase 1: Local Stroke Cache (2-3 hours)

1. Add IndexedDB utility module (`lib/stroke-cache.js`)
2. Implement cache operations (append, get, replace, prune)
3. Hook into stroke reception flow
4. Add cache status to UI (optional indicator)

**Files:**
- New: `src/lib/stroke-cache.js`
- Modify: `src/lib/pen-sdk.js` (add cache writes)
- Modify: `src/stores/strokes.js` (trigger cache on update)

### Phase 2: Full Page Refresh Workflow (3-4 hours)

1. Add LogSeq stroke fetch function
2. Implement merge and deduplication logic
3. Add "Refresh Full Page" button and UI
4. Implement replace-mode LogSeq save
5. Add activity log messaging

**Files:**
- Modify: `src/lib/logseq-api.js` (add fetch, replace methods)
- Modify: `src/lib/stroke-storage.js` (add merge logic)
- Modify: `src/components/transcription/TranscriptionView.svelte`
- Modify: `src/stores/ui.js` (add log messages)

### Phase 3: Polish and Safety (1-2 hours)

1. Add archive block creation
2. Add version/merge metadata
3. Handle edge cases (multi-page canvas, missing pages)
4. Add settings for archive behavior
5. Test error scenarios

**Files:**
- Modify: `src/lib/stroke-storage.js`
- Modify: `src/components/settings/LogseqSettings.svelte`
- Modify: `src/stores/settings.js`

### Phase 4: Cache Management UI (Optional, 1 hour)

1. Show cache status per page
2. Manual cache clear button
3. Cache size indicator
4. Prune old pages

---

## Testing Checklist

### Quick Capture Tests

- [ ] Transcribe new strokes on fresh page
- [ ] Transcribe additional strokes on existing page
- [ ] Transcribe without LogSeq connection
- [ ] Verify cache updated after transcription
- [ ] Verify LogSeq append (not replace)

### Full Page Refresh Tests

- [ ] Refresh page with only LogSeq data (no new strokes)
- [ ] Refresh page with LogSeq + new strokes
- [ ] Refresh page with only cache data (LogSeq page missing)
- [ ] Verify deduplication works correctly
- [ ] Verify archive block created
- [ ] Verify cache rebuilt after refresh
- [ ] Button disabled when LogSeq disconnected
- [ ] Button disabled when multiple pages in canvas

### Edge Cases

- [ ] Very large page (500+ strokes)
- [ ] Corrupted LogSeq JSON (parse error)
- [ ] Network timeout during refresh
- [ ] Browser closed mid-operation
- [ ] Stroke ID collision (same startTime - unlikely but possible)

### Data Integrity

- [ ] No duplicate strokes after multiple refreshes
- [ ] Stroke order preserved (by startTime)
- [ ] Transcription hierarchy correct after refresh
- [ ] Previous data recoverable from archive

---

## Future Considerations

### Potential Enhancements

1. **Background sync** - Periodically sync cache to LogSeq in background
2. **Conflict detection** - Warn if LogSeq data differs unexpectedly from cache
3. **Selective refresh** - Refresh only pages modified since last sync
4. **Export/Import** - Download all stroke data as backup ZIP
5. **Multi-device sync** - Use LogSeq as sync mechanism between devices

### Not In Scope

- Real-time collaboration
- Cloud backup (beyond LogSeq)
- Automatic transcription on stroke arrival
- Undo/redo for transcription operations

---

## Appendix: Decision Rationale

### Why Not Always Import from LogSeq?

1. **Circular dependency** - Can't transcribe without LogSeq running
2. **Latency** - Every transcription requires network read first
3. **Failure modes** - LogSeq issues block all transcription

### Why Not Skip LogSeq Entirely?

1. **Persistence** - Local cache could be cleared by browser
2. **Integration** - LogSeq is the knowledge management target
3. **Queryability** - LogSeq properties enable page queries

### Why IndexedDB Over localStorage?

1. **Size limits** - localStorage caps at ~5MB; IndexedDB allows 50MB+
2. **Async API** - Won't block UI thread
3. **Structure** - Native object storage vs. JSON serialization

---

**End of Specification**
