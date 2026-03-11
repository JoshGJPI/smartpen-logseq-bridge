# Live Capture & Canvas Fixes — March 2026

**Date**: 2026-03-11
**Status**: ✅ COMPLETED
**Affected Files**:
- `src/lib/pen-sdk.js`
- `src/lib/canvas-renderer.js`
- `src/components/canvas/StrokeCanvas.svelte`

---

## Background

Two sessions of debugging live stroke capture and canvas rendering surfaced three distinct bugs plus a UX problem. All four issues were fixed in sequence.

---

## Bug 1: Invalid Pen-Down Dot (`pen-sdk.js`)

### Symptom
Every stroke drawn from the live pen started with a straight line from the canvas origin (0,0) to the actual writing position. The first stroke after connecting also had the wrong book/page (stale from the previous session).

### Root Cause
The NeoSmartpen SDK emits a placeholder dot `{x: -1, y: -1, f: 0, dotType: 0}` when pen-down is first detected — before it has resolved the actual position. The `pageInfo` attached to this dot is stale from the last page used in the prior connection.

### Fix (`processDot()` in `pen-sdk.js`)
- Added `isInvalidDot` check: `dot.x === -1 && dot.y === -1`
- On pen-down with invalid dot: create the stroke object but leave `pageInfo: null` and `dotArray: []`
- On first real pen-move dot: latch the correct `pageInfo` from that dot
- Skip invalid dots entirely for canvas renderer and `currentPageInfo` store
- Only call `addStroke()` if `pageInfo` is confirmed and `dotArray` has at least one real dot

---

## Bug 2: `calculateBounds` offsetY Double-Subtraction (`canvas-renderer.js`)

### Symptom
After completing a stroke, the canvas would render content at negative y-coordinates — off-screen above the visible canvas area. The auto-fit would zoom in to content that was invisible.

### Root Cause
`calculateBounds()` (line ~339) set `offset.offsetY = -globalMinY` for each page. Then `ncodeToScreen()` computed:

```
y = (dot.y - bounds.minY + offsetY) * scale
  = (dot.y - bounds.minY + (-globalMinY)) * scale
```

Since `bounds.minY === globalMinY` for a single-page session, this produced:
```
y = (dot.y - 42.7 - 42.7) * 2.371 ≈ -101px  ← off screen
```

### Fix
Changed to `offset.offsetY = offset.bounds.minY - globalMinY`.

Now `ncodeToScreen` computes:
```
y = (dot.y - bounds.minY + (bounds.minY - globalMinY)) * scale
  = (dot.y - globalMinY) * scale
  = (42.7 - 42.7) * 2.371 = 0px  ✓ starts at top of canvas
```

---

## Bug 3: Zoom/Pan Reset on Every Stroke (`canvas-renderer.js`)

### Symptom
The canvas view snapped back to `zoom=1, pan=(0,0)` at the end of every stroke during live writing — causing the view to continuously jump.

### Root Cause
`renderStrokes(true)` is called on every stroke completion. It calls `clear(resetBounds=true)`, which contained:
```javascript
this.zoom = 1;
this.panX = 0;
this.panY = 0;
```
These three lines reset the view state every time bounds were reset.

### Fix
Removed the zoom/pan reset from `clear(resetBounds=true)`. View state (`zoom`, `panX`, `panY`) is now managed exclusively by `fitToContent()` and the new `setLiveWritingView()`.

---

## Feature: Stable Live Writing View (`canvas-renderer.js` + `StrokeCanvas.svelte`)

### Problem
During live writing, the auto-fit logic in `StrokeCanvas.svelte` fired:
1. On the first stroke (correct)
2. Every 10 strokes thereafter (bad — caused repeated viewport jumps while writing)

The `fitToContent()` called during live writing also zoomed to fit all content, which at low stroke counts meant an inappropriate zoom level.

### Solution

**New `setLiveWritingView()` method in `canvas-renderer.js`:**
```javascript
setLiveWritingView() {
  this.zoom = 3;
  this.panX = 20;  // left padding px
  this.panY = 50;  // top padding px
  return this.zoom;
}
```
Sets a comfortable 3× zoom with the writing area anchored at the top-left of the canvas.

**Rewritten auto-fit logic in `StrokeCanvas.svelte`:**
- Added `penConnected` import from `$stores`
- Added `liveWritingViewSet` boolean flag (reset to `false` when pen disconnects)
- When **pen is connected** (live writing): calls `setLiveWritingView()` only on the first stroke of a session; view is then left stable for the entire writing session
- When **pen is disconnected** (offline import / manual load): calls `fitContent()` only on the first batch of strokes (`previousStrokeCount === 0`), not every 10 strokes
- `liveWritingViewSet` resets when `$penConnected` goes false, so each new connection gets a fresh initial zoom

---

## Testing

After these fixes, during live pen writing:
1. No straight line from canvas origin on stroke start
2. First stroke appears at the correct book/page location
3. Canvas stays at 3× zoom with writing visible in the top portion
4. View does not jump or reset between strokes
5. Disconnecting and reconnecting the pen resets the live view zoom correctly

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/pen-sdk.js` | Skip `{x:-1,y:-1}` pen-down placeholder dots; latch `pageInfo` from first real dot |
| `src/lib/canvas-renderer.js` | Fix `offsetY` formula in `calculateBounds()`; remove zoom/pan reset from `clear(true)`; add `setLiveWritingView()` |
| `src/components/canvas/StrokeCanvas.svelte` | Import `penConnected`; add `liveWritingViewSet` flag; rewrite auto-fit reactive block |

---

*Session date: 2026-03-11*
