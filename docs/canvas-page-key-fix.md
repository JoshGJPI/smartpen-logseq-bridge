# Canvas Page Key Fix

**Issue:** New strokes not showing in canvas or page dropdown  
**Cause:** Page key format mismatch  
**Status:** ✅ Fixed

---

## The Problem

### Page Key Mismatch

**Strokes Store (`strokes.js`):**
```javascript
const key = `S${section}/O${owner}/B${book}/P${page}`;
// Example: "S3/O1012/B3017/P42"
```

**Canvas Renderer (before fix):**
```javascript
const pageKey = `B${book}/P${page}`;
// Example: "B3017/P42"
```

**Result:** Canvas couldn't find page offsets because keys didn't match!

---

## The Fix

Updated canvas renderer to use the same full key format:

### Files Changed

**`canvas-renderer.js`**

1. **`calculateBounds()`** - Now uses full key format:
```javascript
const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
```

2. **`ncodeToScreen()`** - Now looks up with full key:
```javascript
const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
const pageOffset = this.pageOffsets.get(pageKey);
```

3. **Added fallback for invalid strokes:**
```javascript
if (!pageInfo || pageInfo.book === undefined || pageInfo.page === undefined) {
  console.warn('Stroke missing valid pageInfo:', stroke);
  // Use fallback key: 'S0/O0/B0/P0'
}
```

---

## What This Fixes

✅ **Canvas rendering** - All strokes now render correctly  
✅ **Page dropdown** - All pages appear in the filter  
✅ **Horizontal layout** - Multiple books/pages position correctly  
✅ **Error handling** - Warns about invalid strokes instead of silently failing

---

## Testing

After refreshing the page:

### ✅ Check Canvas
1. All strokes should be visible
2. Different books should appear side-by-side
3. Click "Fit" to see all pages

### ✅ Check Page Dropdown
1. Open the "Page:" dropdown
2. Should show all pages with format: `S3/O1012/B3017/P42`
3. Select a specific page to filter

### ✅ Check Console
1. Open browser console (F12)
2. Should see: `Page offsets calculated: ["S3/O1012/B3017/P42", "S3/O1012/B4567/P1", ...]`
3. No warnings about missing pageInfo (unless strokes are actually invalid)

---

## Summary

**Before:**
- Canvas used simplified keys: `B3017/P42`
- Store used full keys: `S3/O1012/B3017/P42`
- Mismatch → strokes not positioned correctly

**After:**
- Canvas uses full keys: `S3/O1012/B3017/P42`
- Store uses full keys: `S3/O1012/B3017/P42`
- Match ✅ → all strokes render and filter correctly

---

**Status:** ✅ Fixed! Refresh your browser and all pages should now appear.
