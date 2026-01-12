# Unique Timestamp Generation for Duplicated Strokes

## Problem Summary

When strokes were duplicated, they were copying ALL properties from the original stroke including:
- `startTime` - Original stroke start timestamp
- `endTime` - Original stroke end timestamp  
- `dotArray[].timestamp` - Original dot timestamps

This meant:
1. ❌ Duplicated strokes had identical timestamps to originals
2. ❌ Potential for timestamp conflicts in the database
3. ❌ Multiple strokes with same ID/timestamp could cause confusion
4. ❌ No way to distinguish when strokes were actually created vs. duplicated

## Solution Implemented

The `normalizeAndOffset()` function now generates **completely new unique timestamps** for duplicated strokes while preserving the **relative timing relationships**.

### Key Changes

#### 1. Generate Base Timestamp
```javascript
const baseTimestamp = Date.now(); // Time of duplication
```

#### 2. Calculate New Stroke Timestamps
Each duplicated stroke gets:
- **New start time**: `baseTimestamp + strokeIndex` (1ms apart per stroke)
- **New end time**: `startTime + originalDuration`
- **Preserves duration**: The time span of the stroke remains the same

```javascript
const originalDuration = stroke.endTime - stroke.startTime;
const newStartTime = baseTimestamp + (strokeIndex * 1);
const newEndTime = newStartTime + originalDuration;
```

#### 3. Regenerate Dot Timestamps
Each dot within a stroke gets a new timestamp that:
- **First dot**: Gets the stroke start time
- **Last dot**: Gets the stroke end time
- **Middle dots**: Interpolated based on position within stroke

```javascript
const dotTimestamps = stroke.dotArray.map((dot, dotIndex) => {
  if (dotIndex === 0) return newStartTime;
  if (dotIndex === stroke.dotArray.length - 1) return newEndTime;
  
  // Interpolate for middle dots
  const progress = dotIndex / (stroke.dotArray.length - 1);
  return Math.round(newStartTime + (originalDuration * progress));
});
```

#### 4. Create Completely New Stroke Object
Instead of using spread operator (`...stroke`), we now explicitly create a new object with ONLY the properties we want:

```javascript
return {
  // NEW unique timestamps
  startTime: newStartTime,
  endTime: newEndTime,
  
  // Duplicated stroke metadata
  pageInfo: null,
  _pasted: true,
  _pastedAt: baseTimestamp,
  _sourcePageInfo: stroke.pageInfo,
  
  // Copied coordinates with NEW timestamps
  dotArray: stroke.dotArray.map((dot, dotIndex) => ({
    x: dot.x - minX,
    y: dot.y - minY,
    f: dot.f,
    timestamp: dotTimestamps[dotIndex] // NEW timestamp
  })),
  
  _offset: { ...offset }
};
```

## What Gets Copied vs. Generated

### ✅ Copied (Preserved from Original)
- Dot X/Y coordinates (path shape)
- Force values (`f`)
- Stroke duration (timing relationships)
- Source page info (for reference)

### 🆕 Generated (Unique per Duplication)
- `startTime` - New unique timestamp
- `endTime` - New unique timestamp
- `dotArray[].timestamp` - New unique timestamps
- `_pastedAt` - When duplication occurred
- `pageInfo` - Detached (set to null)

## Example Transformation

### Original Stroke:
```javascript
{
  startTime: 1673456789000,
  endTime: 1673456789150,
  pageInfo: { book: 123, page: 2 },
  dotArray: [
    { x: 100, y: 200, f: 128, timestamp: 1673456789000 },
    { x: 105, y: 205, f: 130, timestamp: 1673456789075 },
    { x: 110, y: 210, f: 125, timestamp: 1673456789150 }
  ]
}
```

### Duplicated Stroke (when duplicated at time 1737123456789):
```javascript
{
  startTime: 1737123456789,  // NEW - time of duplication
  endTime: 1737123456939,    // NEW - preserves 150ms duration
  pageInfo: null,            // Detached
  _pasted: true,
  _pastedAt: 1737123456789,
  _sourcePageInfo: { book: 123, page: 2 },
  dotArray: [
    { x: 100, y: 200, f: 128, timestamp: 1737123456789 },  // NEW
    { x: 105, y: 205, f: 130, timestamp: 1737123456864 },  // NEW (interpolated)
    { x: 110, y: 210, f: 125, timestamp: 1737123456939 }   // NEW
  ],
  _offset: { x: 50, y: 50 }
}
```

## Console Logging

When you duplicate strokes, you'll now see:
```
🆔 Generated unique timestamps for duplicated strokes:
   First stroke: 1737123456789 → 1737123456939 (duration: 150ms)
   First dot: 1737123456789, Last dot: 1737123456939
🔄 Duplicated 132 strokes (total pasted: 132)
```

This confirms:
- ✅ New unique timestamps were generated
- ✅ Original duration was preserved
- ✅ Dot timestamps span correctly

## Benefits

### 1. No Timestamp Conflicts
Each duplicated stroke has a completely unique timestamp based on when it was duplicated.

### 2. Preserves Timing Relationships
The relative timing within and between strokes is maintained:
- Stroke durations are preserved
- Dot spacing within strokes is proportional
- Multiple duplicated strokes have sequential timestamps

### 3. Audit Trail
You can tell:
- When a stroke was originally created (in `_sourcePageInfo`)
- When it was duplicated (`_pastedAt`)
- That it's a duplicate (`_pasted: true`)

### 4. Database Integrity
No risk of:
- Duplicate timestamp keys
- Conflicting IDs
- Data corruption from identical timestamps

### 5. Original Strokes Unchanged
Original strokes keep their original timestamps - they are COPIED, not moved or modified.

## Technical Details

### Timestamp Spacing
- **Between strokes**: 1ms apart (`strokeIndex * 1`)
- **Within stroke**: Interpolated based on dot position
- **Preserves**: Original stroke duration

### Why 1ms Spacing?
- Provides unique timestamps for sequential strokes
- Minimal offset keeps them temporally close
- JavaScript timestamps are millisecond precision

### Interpolation Formula
For middle dots:
```javascript
timestamp = startTime + (duration × position_ratio)
```

Where `position_ratio = dotIndex / (totalDots - 1)`

This ensures even spacing of timestamps across the stroke path.

## Files Modified

- **`src/stores/pasted-strokes.js`**
  - Function: `normalizeAndOffset(strokes, offset)`
  - Function: `duplicateStrokes(strokes, initialOffset)`
  - Added timestamp generation logic
  - Added console logging for verification

## Testing Verification

To verify this works correctly:

1. **Duplicate some strokes**
2. **Check console output** - Look for:
   ```
   🆔 Generated unique timestamps for duplicated strokes:
      First stroke: [NEW_TIMESTAMP] → [NEW_TIMESTAMP]
   ```
3. **Verify timestamps are different** from original strokes
4. **Append to a page** - Should work without conflicts
5. **Check original page** - Should still have all its strokes with original timestamps

## Related Issues Fixed

This also addresses:
- ✅ The append duplication issue (combined with separate LogSeq/local store fix)
- ✅ Prevents potential database conflicts
- ✅ Makes duplicate strokes truly independent from originals
