# Canvas Page Layout - Horizontal Offset Implementation

**Date:** December 2024  
**Change:** Pages now display side-by-side instead of overlapping

---

## What Changed

### Before
- All strokes rendered in same coordinate space
- Multiple pages would overlap on canvas
- No page separation

### After
- Each page gets its own horizontal offset
- Pages laid out left-to-right with spacing
- All pages aligned at same baseline (top)

---

## How It Works

### 1. Page Grouping
When `calculateBounds()` is called, strokes are grouped by page:
```javascript
const pageKey = `B${pageInfo.book}/P${pageInfo.page}`;
// e.g., "B3017/P42", "B3017/P43"
```

### 2. Horizontal Layout
Each page is positioned with increasing X offset:
```javascript
Page 1: offsetX = 0
Page 2: offsetX = page1Width + 50mm spacing
Page 3: offsetX = page1Width + page2Width + 100mm spacing
```

### 3. Coordinate Transform
When drawing, each dot's coordinates are transformed:
```javascript
x = (dot.x - pageMinX + offsetX) * scale
y = (dot.y - pageMinY) * scale
```

This:
1. Makes each page start at its own origin (subtracting pageMinX)
2. Shifts it horizontally by its offset
3. Converts from Ncode units to millimeters

---

## Configuration

**Page Spacing:** 50mm between pages (defined in `this.pageSpacing`)

To adjust spacing, modify in `canvas-renderer.js`:
```javascript
this.pageSpacing = 50; // Change this value
```

---

## Expected Behavior

### Single Page
- Renders normally, centered
- No offset applied

### Multiple Pages
- Page 42: Appears on left
- Page 43: Appears to the right with 50mm gap
- Page 44: Further right with another 50mm gap

### Canvas View
- Zoom and pan work across all pages
- "Fit to Content" shows all pages
- Selection works across pages

---

## Testing Checklist

### ✅ Visual Layout
- [ ] Two pages appear side-by-side (not overlapping)
- [ ] Clear spacing visible between pages
- [ ] Pages aligned at top (same baseline)

### ✅ Interaction
- [ ] Can select strokes from either page
- [ ] Zoom affects all pages equally
- [ ] Pan moves view across all pages
- [ ] Box selection works across page boundaries

### ✅ Edge Cases
- [ ] Single page renders normally
- [ ] 3+ pages lay out correctly
- [ ] Empty pages don't break layout
- [ ] Mixed book/page numbers handled correctly

---

## Troubleshooting

### Pages Still Overlapping?

**Check 1:** Verify strokes have pageInfo
```javascript
// In browser console:
$strokes[0].pageInfo
// Should show: { section: 3, owner: 1012, book: 3017, page: 42 }
```

If pageInfo is missing, strokes won't get offsets.

**Check 2:** Look at page offset calculation
```javascript
// The renderer should have pageOffsets:
renderer.pageOffsets
// Should be a Map with entries like "B3017/P42" -> {offsetX: 0, ...}
```

**Check 3:** Try "Fit to Content"
- Click the "Fit" button in canvas controls
- Should show all pages laid out horizontally
- If pages still overlap, there may be an issue with bounds calculation

### Pages Too Close/Far Apart?

Adjust spacing in `canvas-renderer.js`:
```javascript
this.pageSpacing = 100; // Increase for more space
this.pageSpacing = 20;  // Decrease for less space
```

---

## Code Changes Summary

### `canvas-renderer.js`

**Added:**
- `this.pageOffsets` - Map storing offset for each page
- `this.pageSpacing` - Spacing between pages (50mm)

**Modified:**
- `calculateBounds()` - Now groups by page and assigns offsets
- `ncodeToScreen()` - Now accepts pageInfo parameter for offset
- `drawStroke()` - Passes pageInfo to ncodeToScreen
- `getStrokeBounds()` - Passes pageInfo to ncodeToScreen
- `hitTest()` - Passes pageInfo to ncodeToScreen

**Algorithm:**
```
For each page:
  1. Calculate page bounds (minX, maxX, minY, maxY)
  2. Assign horizontal offset: currentOffsetX
  3. Store in pageOffsets Map
  4. Increment: currentOffsetX += pageWidth + spacing
  
When drawing:
  1. Look up page offset from pageInfo
  2. Transform: x = (dot.x - pageMinX + offsetX) * scale
  3. Result: page shifted horizontally
```

---

## Example Calculation

### Input: 2 Pages

**Page 42 (B3017/P42):**
- Bounds: minX=10, maxX=110 (width=100)
- offsetX = 0
- Strokes render at: x * scale

**Page 43 (B3017/P43):**
- Bounds: minX=10, maxX=110 (width=100)
- offsetX = 100 + 50 = 150
- Strokes render at: (x + 150) * scale

**Result:**
- Page 42: Appears at x=0 to x=100mm
- Gap: x=100mm to x=150mm (50mm spacing)
- Page 43: Appears at x=150mm to x=250mm

---

## Visual Representation

```
Canvas View (Top Down):

┌────────────┐     ┌────────────┐     ┌────────────┐
│  Page 42   │ 50mm│  Page 43   │ 50mm│  Page 44   │
│            │ gap │            │ gap │            │
│   Strokes  │     │   Strokes  │     │   Strokes  │
│            │     │            │     │            │
└────────────┘     └────────────┘     └────────────┘
    0-100mm        150-250mm          300-400mm
```

---

## Status

✅ **Implemented** - Pages should now appear side-by-side horizontally

**Next:** Test with your 2-page data and verify separation is correct.

If pages are still overlapping after this update:
1. Check browser console for errors
2. Verify strokes have valid pageInfo
3. Try hard refresh (Ctrl+Shift+R)
4. Check if renderer.pageOffsets is populated

---

**Spacing Configuration:** 50mm (adjustable in code)  
**Alignment:** Top-aligned (all pages same baseline)  
**Layout:** Left-to-right, in order encountered
