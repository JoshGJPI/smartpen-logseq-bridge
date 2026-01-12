# Fix: Append Mode Not Duplicating Strokes

## Problem
When appending duplicated strokes to an existing page, the existing strokes were being duplicated in the local canvas store, causing confusion about which strokes were which.

## Root Cause
The append logic was:
1. Fetching existing strokes from LogSeq
2. Combining them with new strokes
3. Saving the COMBINED array to LogSeq ✅ (correct)
4. Adding the COMBINED array to local store ❌ (wrong - existing strokes already there)

This caused the existing strokes to appear twice in the canvas.

## Solution
Separated the data flow into two paths:

### Path 1: Save to LogSeq
- **Overwrite mode**: Save only new strokes
- **Append mode**: Save COMBINED (existing + new with offset)

### Path 2: Update Local Canvas Store
- **Both modes**: Add only NEW strokes (never re-add existing ones)

## Code Changes

### Before (Buggy):
```javascript
let strokesToSave = newStrokes;

if (mode === 'append') {
  const existingFullFormat = ...;
  const offsetNewStrokes = ...;
  strokesToSave = [...existingFullFormat, ...offsetNewStrokes]; // Combined
}

// Save to LogSeq
await updatePageStrokes(book, page, strokesToSave, host, token);

// Add to local store
addOfflineStrokes(strokesToSave); // ❌ Adds existing strokes again!
```

### After (Fixed):
```javascript
let strokesToSaveToLogSeq = newStrokes;
let strokesToAddToLocalStore = newStrokes;

if (mode === 'append') {
  const existingFullFormat = ...;
  const offsetNewStrokes = ...;
  
  // For LogSeq: combined array
  strokesToSaveToLogSeq = [...existingFullFormat, ...offsetNewStrokes];
  
  // For local store: only new strokes
  strokesToAddToLocalStore = offsetNewStrokes;
}

// Save to LogSeq
await updatePageStrokes(book, page, strokesToSaveToLogSeq, host, token);

// Add to local store
addOfflineStrokes(strokesToAddToLocalStore); // ✅ Only new strokes!
```

## Data Flow Diagram

### Overwrite Mode:
```
New Strokes (340)
    ├─→ LogSeq: Save 340 new strokes (replaces old)
    └─→ Canvas: Add 340 new strokes
```

### Append Mode:
```
Existing Strokes (447) + New Strokes (340)
    ├─→ LogSeq: Save 787 combined strokes
    └─→ Canvas: Add only 340 new strokes
```

## Why This Matters

### Without the fix:
```
Initial state: 447 strokes in canvas from Page B123/P2

After append:
- LogSeq: 787 strokes (447 old + 340 new) ✅
- Canvas: 894 strokes (447 old + 447 again + 340 new) ❌
```

### With the fix:
```
Initial state: 447 strokes in canvas from Page B123/P2

After append:
- LogSeq: 787 strokes (447 old + 340 new) ✅
- Canvas: 787 strokes (447 old + 340 new) ✅
```

## Console Output

You'll now see these logs during append:
```
💾 Saving 340 strokes as B 123 /P 2 (append)
📎 Appending to 447 existing strokes
📄 Existing strokes bottom Y: 502.34
🆕 New strokes top Y: 33.67
⬇️ Applying Y offset: 573.67 to new strokes
📦 Total strokes to save to LogSeq: 787
💾 Adding 340 new strokes to local store    ← NEW LOG
[SUCCESS] Appended to page B123/P2 with 340 strokes
✅ Save successful, closing dialog
```

Key differences:
- **"Total strokes to save to LogSeq: 787"** - Combined array for persistence
- **"Adding 340 new strokes to local store"** - Only new ones for canvas display

## Testing Checklist

- [ ] Duplicate strokes from Page A
- [ ] Append to existing Page B (with existing strokes)
- [ ] Verify Page B shows old + new strokes (no duplicates)
- [ ] Verify Page A still has all its original strokes
- [ ] Verify LogSeq shows correct combined count
- [ ] Verify canvas shows correct combined count
- [ ] Append multiple times to same page
- [ ] Verify each append adds correctly without duplication

## Related Files Modified

- `src/components/dialog/CreatePageDialog.svelte`
  - Function: `performSave(book, page, mode)`
  - Split `strokesToSave` into two variables:
    - `strokesToSaveToLogSeq` - for persistence
    - `strokesToAddToLocalStore` - for canvas display
