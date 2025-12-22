# Chunked Storage Implementation

## Overview

The SmartPen-LogSeq Bridge now uses **chunked storage** to overcome LogSeq's block size limitations. Instead of storing all strokes in a single JSON block, strokes are split across multiple child blocks under a metadata header.

## Problem Solved

**Before:** Pages with >800 strokes would cause `ERR_CONNECTION_ABORTED` errors because:
- Each write operation rewrote the ENTIRE dataset
- JSON payload grew with each batch until LogSeq's HTTP API rejected it
- Connection would fail mid-import, leaving partial data

**After:** Pages can store unlimited strokes with no size limits because:
- Each chunk contains only 800 strokes (manageable size)
- Multiple chunks can be added as child blocks
- Read operations concatenate all chunks into a single array

## Storage Structure

### Old Format (Single Block)
```
## Raw Stroke Data
  ```json
  {
    "version": "1.0",
    "pageInfo": { "section": 3, "owner": 1012, "book": 3017, "page": 43 },
    "strokes": [...1175 strokes...],
    "metadata": { "lastUpdated": 1234567890, "strokeCount": 1175, "bounds": {...} }
  }
  ```
```

### New Format (Chunked)
```
## Raw Stroke Data
  ```json
  {
    "version": "1.0",
    "pageInfo": { "section": 3, "owner": 1012, "book": 3017, "page": 43 },
    "metadata": {
      "lastUpdated": 1234567890,
      "totalStrokes": 1175,
      "bounds": { "minX": 0, "maxX": 100, "minY": 0, "maxY": 100 },
      "chunks": 2,
      "chunkSize": 800
    }
  }
  ```
  ```json
  {
    "chunkIndex": 0,
    "strokeCount": 800,
    "strokes": [strokes 0-799]
  }
  ```
  ```json
  {
    "chunkIndex": 1,
    "strokeCount": 375,
    "strokes": [strokes 800-1174]
  }
  ```
```

## Key Features

### Backward Compatibility
- **Old single-block pages are still readable**
- Reader detects format by checking `metadata.chunks` field
- Pages will auto-migrate to chunked format on next write

### Deduplication Safety
- Strokes are sorted chronologically by `startTime`
- New strokes always append to the end
- No risk of duplicates across chunk boundaries

### Efficient Reading
- `getPageStrokes()` concatenates all chunks transparently
- Returns data in original format for compatibility
- Logs chunk count for debugging: `"Reading chunked format: 2 chunks, 1175 total strokes"`

### Efficient Writing
- `updatePageStrokesSingle()` splits strokes into 800-stroke chunks
- Deletes old "Raw Stroke Data" block completely
- Writes new metadata + N chunk blocks
- Logs chunk info: `"Writing 1175 strokes in 2 chunks"`

## Implementation Details

### New Functions in `stroke-storage.js`

#### `splitStrokesIntoChunks(strokes, chunkSize = 800)`
Splits stroke array into manageable chunks.

```javascript
const chunks = splitStrokesIntoChunks(allStrokes, 800);
// Returns: [[strokes 0-799], [strokes 800-1174]]
```

#### `buildChunkedStorageObjects(pageInfo, strokes, chunkSize = 800)`
Creates metadata + stroke chunk objects ready for storage.

```javascript
const { metadata, strokeChunks } = buildChunkedStorageObjects(pageInfo, allStrokes);
// metadata: { version, pageInfo, metadata: { totalStrokes, chunks, ... } }
// strokeChunks: [{ chunkIndex: 0, strokeCount: 800, strokes: [...] }, ...]
```

#### `parseChunkedJsonBlocks(childBlocks)`
Reconstructs full stroke array from multiple child blocks.

```javascript
const data = parseChunkedJsonBlocks(block.children);
// Returns: { version, pageInfo, strokes: [...all strokes...], metadata }
```

### Updated Functions in `logseq-api.js`

#### `getPageStrokes(book, page, host, token)`
- Auto-detects format (single-block vs chunked)
- Parses metadata from first child block
- Concatenates strokes from remaining children
- Returns unified data structure

#### `updatePageStrokesSingle(book, page, newStrokes, host, token)`
- Merges and deduplicates strokes
- Splits into chunks (800 strokes each)
- Deletes old "Raw Stroke Data" block
- Writes new metadata + chunk blocks
- Returns chunk count in result

#### `updatePageStrokes(book, page, newStrokes, host, token)`
- Removed size limit check (no longer needed)
- Single operation handles all strokes
- No batching delays required

## Example Output

### Console Logs (Writing)
```
Writing 1175 strokes in 2 chunks
Updated smartpen data/b3017/p43: 1175 new strokes, 1175 total (2 chunks)
```

### Console Logs (Reading)
```
Reading chunked format: 2 chunks, 1175 total strokes
```

### UI Logs
```
✓ Saved strokes to Smartpen Data/B3017/P43: 1175 new, 1175 total (2 chunks)
```

## Benefits

1. **No Size Limits** - Can store thousands of strokes per page
2. **Reliable Imports** - No more connection aborts during large imports
3. **Single Write Operation** - Faster than old batching approach
4. **Backward Compatible** - Existing pages continue to work
5. **Auto-Migration** - Old pages upgrade to chunked format on next write
6. **Efficient Storage** - Each chunk stays under LogSeq's practical limits

## Testing Checklist

- [x] Write 1175 strokes to new page (creates 2 chunks)
- [ ] Write additional strokes to existing chunked page (appends properly)
- [ ] Read old single-block page (backward compatible)
- [ ] Write to old page (auto-migrates to chunked format)
- [ ] Verify deduplication works across chunks
- [ ] Test with very large datasets (2000+ strokes)

## Migration Path

**Existing Pages:**
- Old single-block pages remain functional
- Next write operation auto-migrates to chunked format
- No manual migration required

**New Pages:**
- Always use chunked format
- Even small pages (<800 strokes) use 1 chunk for consistency

## Future Enhancements

1. **Adjustable Chunk Size** - Make configurable per user preference
2. **Parallel Chunk Writing** - Write chunks concurrently for speed
3. **Chunk Compression** - Compress individual chunks to save space
4. **Smart Chunking** - Split at natural boundaries (e.g., between writing sessions)
