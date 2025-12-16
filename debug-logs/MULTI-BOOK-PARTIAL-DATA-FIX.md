# Fix: Multi-Book Import Partial Data Issue

## Date: December 16, 2025

## Problem
When importing offline data from multiple pen books:
- One book's data would load successfully
- Other books would show no data or partial data
- The sequential transfer approach was timing out instead of completing

## Root Causes Identified

### 1. Type Mismatch in Book ID Comparison
The critical comparison used strict equality (`===`):
```javascript
if (detectedBook && pendingOfflineTransfer === detectedBook)
```

- `pendingOfflineTransfer` = `note.Note` from note list (could be number or string)
- `detectedBook` = `pageInfo.book` from stroke data (could be different type)

If one was a number (390) and the other a string ("390"), strict equality failed!

### 2. No Fallback Completion Detection
When the expected stroke count wasn't set (message type 49 didn't fire), the code:
- Just logged a warning
- Waited for full 30-second timeout
- Didn't recognize that data was actually received

### 3. No Data-Received Tracking
The code didn't track whether ANY data was received for a transfer, so it couldn't make intelligent timeout decisions.

## Solution Applied

### 1. Normalized Book IDs
Added `normalizeBookId()` function that converts all book IDs to strings:
```javascript
function normalizeBookId(bookId) {
  if (bookId === null || bookId === undefined) {
    return 'unknown';
  }
  return String(bookId);
}
```

All comparisons now use normalized IDs:
```javascript
const normalizedBookId = normalizeBookId(note.Note);
pendingOfflineTransfer = normalizedBookId;
// ...later...
const bookId = normalizeBookId(bookIdRaw);
if (detectedBook === pendingOfflineTransfer) { ... }
```

### 2. Idle Detection
Added a "data idle" check that monitors for completion:
```javascript
const idleCheckInterval = setInterval(() => {
  if (dataReceivedForCurrentTransfer && lastDataReceivedTime) {
    const idleTime = Date.now() - lastDataReceivedTime;
    if (idleTime > 3000) {
      // No new data for 3 seconds - consider complete
      resolve({ idleTimeout: true });
    }
  }
}, 1000);
```

### 3. Multiple Completion Paths
Transfer can now complete via:
- **Normal completion**: Received stroke count >= expected count
- **Idle detection**: No new data for 3 seconds after receiving some
- **Empty book**: Expected count is 0
- **Graceful timeout**: 30s timeout but data was received

### 4. Improved Debugging
Added comprehensive type logging:
```javascript
console.log('%c🔍 Transfer Matching Debug:', 'color: #FF5722;', {
  detectedBook,
  detectedBookRaw,
  detectedBookType: typeof detectedBookRaw,
  pendingOfflineTransfer,
  pendingType: typeof pendingOfflineTransfer,
  match: detectedBook === pendingOfflineTransfer
});
```

## New State Variables
```javascript
let lastDataReceivedTime = null;       // Track when last chunk arrived
let dataReceivedForCurrentTransfer = false;  // Track if ANY data received
```

## Console Output Changes

### Before (Mismatch Case):
```
⚠️ Received data for book 390, but waiting for book 390
```
(Both show "390" but types differed!)

### After (With Type Info):
```
🔍 Transfer Matching Debug: {
  detectedBook: "390",
  detectedBookRaw: 390,
  detectedBookType: "number",
  pendingOfflineTransfer: "390",
  pendingType: "string",
  match: true
}
```

## Expected Behavior

1. **First book request** starts
2. Data arrives, timing tracked
3. Either:
   - Expected count reached → immediate completion
   - 3 seconds of idle → idle completion
   - 30 seconds timeout but data received → graceful completion
4. Canvas updates
5. 500ms delay
6. **Second book request** starts
7. Same completion logic
8. All books imported successfully

## Testing

1. Clear canvas
2. Connect pen with multiple offline books
3. Click "Fetch Stored Notes"
4. Watch console for:
   - Type matching debug info
   - Idle detection messages
   - Per-book completion reasons

### Success Indicators:
- `✅ Book X completed via idle detection`
- `✅ Book X transfer completed normally`
- Both books visible in page selector

### Warning Signs (still working but suboptimal):
- `⚠️ Book X timed out but had data` - Idle detection didn't trigger (3s threshold may need adjustment)
- `⚠️ BOOK ID MISMATCH!` - Type normalization issue (shouldn't happen now)

## Additional Fix: Explicit Batch Mode Transition Handler

Added to `StrokeCanvas.svelte` to ensure canvas updates when batch mode ends:

```javascript
// Track previous batch mode state
let wasBatchMode = false;

// Explicitly handle batch mode transitions
$: {
  const batchModeJustEnded = wasBatchMode && !$batchMode;
  wasBatchMode = $batchMode;
  
  if (batchModeJustEnded && renderer && filteredStrokes.length > 0) {
    console.log('🎨 Batch mode ended - forcing canvas update');
    setTimeout(() => {
      renderStrokes(true);
      fitContent();
      previousStrokeCount = filteredStrokes.length;
    }, 50);
  }
}
```

This provides a belt-and-suspenders approach - even if the normal reactive flow has timing issues, this explicit transition detector will force the canvas update.

---

**Status**: Fix applied and ready for testing
