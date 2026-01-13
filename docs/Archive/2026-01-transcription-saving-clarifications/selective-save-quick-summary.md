# Selective Page Save - Quick Summary

**Added**: 2026-01-13

## What Changed

Added checkboxes to the Save Confirmation Dialog so you can choose which pages to save to LogSeq instead of saving all changes at once.

## How to Use

1. Click "Save to LogSeq" button
2. **All pages are selected by default** (same as before)
3. **Uncheck pages you don't want to save**
4. Summary updates to show only selected changes
5. Click "Confirm & Save (N)" to save selected pages

## Key Features

✅ **All selected by default** - Quick save still works the same  
✅ **Checkboxes** on each page item  
✅ **Select All / Deselect All** buttons  
✅ **Live summary** - Counts update as you select/deselect  
✅ **Visual feedback** - Selected pages have blue highlight  
✅ **Smart confirm button** - Shows count, disabled if nothing selected  

## UI Elements

**Selection Controls**
```
[✓ Select All]  [✗ Deselect All]  3 of 5 selected
```

**Page Items**
```
☑ 📄 Book 3017 / Page 1           ← Selected (blue)
   +42 strokes  ✨ New transcription

☐ 📄 Book 3017 / Page 2           ← Not selected
   +25 strokes  📝 Updated transcription
```

**Summary** (updates based on selection)
```
Pages: 1
Adding: +42 strokes
New Text: 1 page(s)
```

**Confirm Button**
```
[Confirm & Save (1)]  ← Shows count of selected pages
```

## Example Use Cases

**Verify Each Page Individually**
- Deselect all
- Select Page 1 → Save → Check in LogSeq
- Select Page 2 → Save → Check in LogSeq
- Etc.

**Skip Pages with Errors**
- Uncheck pages that need fixing
- Save the good ones
- Fix errors later
- Save again

**Separate Books**
- Uncheck Book B pages
- Save Book A only
- Later save Book B

## Files Modified

- `src/components/dialog/SaveConfirmDialog.svelte` - Added selection UI and logic
- `src/components/header/ActionBar.svelte` - Filter save to selected pages only

## Backward Compatible

✅ Default behavior unchanged (all selected)  
✅ Quick save workflow still works  
✅ No breaking changes  

---

**Documentation**: See `selective-page-save-feature.md` for complete technical details.
