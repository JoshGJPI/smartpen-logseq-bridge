# Chunked Storage Import Fix

## Problem
When trying to import strokes from LogSeq back into the canvas, the import failed with:
```
Error: Invalid stroke data: missing strokes array
```

## Root Cause
The `fetchStrokeData()` function in `logseq-scanner.js` was only reading the **first child block**, which now contains metadata instead of strokes:

```javascript
// OLD CODE (broken with chunked storage)
const jsonBlock = strokeBlock.children[0];
return extractJsonFromBlock(jsonBlock.content);
```

With chunked storage:
- **Child 0** = Metadata (no strokes)
- **Children 1-N** = Stroke chunks

So it returned metadata without strokes, causing the "missing strokes array" error.

## Solution
Updated `logseq-scanner.js` to handle both formats:

### 1. Import Chunked Parsing Functions
```javascript
import { parseJsonBlock, parseChunkedJsonBlocks } from './stroke-storage.js';
```

### 2. Auto-Detect Format in `fetchStrokeData()`
```javascript
// Check if this is chunked format (first child has metadata.chunks)
const firstChild = parseJsonBlock(strokeBlock.children[0].content);
if (firstChild && firstChild.metadata && firstChild.metadata.chunks !== undefined) {
  // New chunked format - parse all child blocks
  console.log(`Reading chunked format: ${firstChild.metadata.chunks} chunks, ${firstChild.metadata.totalStrokes} total strokes`);
  return parseChunkedJsonBlocks(strokeBlock.children);
} else {
  // Old single-block format - just parse first child
  console.log('Reading legacy single-block format');
  return firstChild;
}
```

## Result
The import function now:
- ✅ Detects chunked vs legacy format automatically
- ✅ Parses all chunk blocks and concatenates strokes
- ✅ Returns unified stroke array to `transformStoredToCanvasFormat()`
- ✅ Backward compatible with old single-block pages

## Files Changed
- `src/lib/logseq-scanner.js` - Added chunked format parsing to `fetchStrokeData()`

## Related Files (Already Implemented)
- `src/lib/stroke-storage.js` - Contains `parseChunkedJsonBlocks()` function
- `src/lib/logseq-api.js` - Uses same chunked parsing for `getPageStrokes()`

## Testing
1. Import page with chunked storage (6 chunks, 1175 strokes)
2. Verify console shows: "Reading chunked format: 6 chunks, 1175 total strokes"
3. Verify all 1175 strokes appear on canvas
4. Test with old single-block page (backward compatibility)
