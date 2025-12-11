# MyScript Stroke Format Fix

## Problem
Transcription failed with error:
```
MyScript API error (400): {"code":"recognition.strokegroup.empty","message":"Strokegroup empty at 0"}
```

## Root Cause
The stroke format was incorrect. MyScript expects:

### Wrong Format (What we were sending):
```javascript
strokeGroups: [
  { x: [...], y: [...], t: [...], p: [...] },  // stroke 1
  { x: [...], y: [...], t: [...], p: [...] },  // stroke 2
  ...
]
```

### Correct Format (What MyScript expects):
```javascript
strokeGroups: [{
  strokes: [
    { x: [...], y: [...], t: [...], p: [...] },  // stroke 1
    { x: [...], y: [...], t: [...], p: [...] },  // stroke 2
    ...
  ]
}]
```

**Key difference**: Strokes must be wrapped in a `strokeGroups` array with a `strokes` property inside.

## Solution

Updated `convertStrokesToMyScript()` function in `myscript-api.js`:

### Changes Made:
1. ✅ Wrapped strokes in correct structure: `[{ strokes: [...] }]`
2. ✅ Added filter to skip empty strokes (strokes with no dots)
3. ✅ Added safety check for missing `dotArray`

### Code Changes:
```javascript
// BEFORE
const strokeGroups = strokes.map(stroke => {
  // convert stroke
  return { x, y, t, p };
});

// AFTER
const msStrokes = strokes
  .filter(stroke => stroke.dotArray && stroke.dotArray.length > 0)
  .map(stroke => {
    // convert stroke
    return { x, y, t, p };
  });

const strokeGroups = [{
  strokes: msStrokes
}];
```

## Files Modified
- ✅ `src/lib/myscript-api.js` - `convertStrokesToMyScript()` function

## Test

```bash
npm run build && npm run dev
```

### Steps:
1. Connect pen
2. Write some strokes
3. Select strokes (or select all)
4. Click "Transcribe"
5. Should succeed without "empty strokegroup" error

### Expected Result:
- ✅ Transcription completes successfully
- ✅ Text appears in Transcription tab
- ✅ Lines show proper indentation
- ✅ No 400 errors in console

## Technical Details

### MyScript API Structure:
```javascript
{
  xDPI: 96,
  yDPI: 96,
  contentType: 'Text',
  configuration: { ... },
  strokeGroups: [{           // Array of stroke groups
    strokes: [{              // Array of strokes in this group
      x: [10, 20, 30],       // X coordinates
      y: [10, 10, 10],       // Y coordinates
      t: [0, 100, 200],      // Timestamps
      p: [0.5, 0.5, 0.5]     // Pressure (0-1)
    }]
  }],
  width: 800,
  height: 600
}
```

### Why This Structure?
MyScript supports grouping strokes into multiple groups for complex documents. Each group can contain multiple strokes. For our use case, we put all strokes into a single group.

## Related Info

### Test Credentials Format:
The test function already used the correct format:
```javascript
strokeGroups: [{
  x: [10, 20, 30],
  y: [10, 10, 10],
  t: [0, 100, 200],
  p: [0.5, 0.5, 0.5]
}]
```

This works because it's a single stroke test. For multiple strokes, we need the `strokes` array.

## Prevention

Added these safety checks:
1. Check if `stroke.dotArray` exists before accessing
2. Check if `stroke.dotArray.length > 0` before processing
3. Filter out invalid strokes before conversion

This prevents:
- ❌ Null pointer errors
- ❌ Empty stroke errors
- ❌ Invalid data being sent to API

## Summary

✅ **Fixed**: Stroke format now matches MyScript API spec  
✅ **Added**: Safety filters for empty/invalid strokes  
✅ **Result**: Transcription should work correctly  

The key insight: MyScript expects `strokeGroups[0].strokes[...]`, not `strokeGroups[...]` directly.
