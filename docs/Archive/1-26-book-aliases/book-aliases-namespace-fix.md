# Book Aliases Namespace Fix

**Date:** January 5, 2026  
**Issue:** Book aliases not persisting when importing strokes from LogSeq  
**Root Cause:** Namespace mismatch between book pages and stroke data

## Problem

The original implementation stored book pages and stroke data in different namespaces:
- **Book root pages** (with aliases): `smartpen/B3017`
- **Stroke/page data**: `Smartpen Data/B3017/P42`

This caused issues when:
1. Importing strokes from LogSeq - book IDs weren't registered
2. Aliases saved to different namespace than actual data
3. Scanning only found aliases in `smartpen/` not connected to data

## Solution

Consolidated everything under the `Smartpen Data/` namespace:
- **Book root pages**: `Smartpen Data/B3017` (with bookName property)
- **Individual pages**: `Smartpen Data/B3017/P42` (with stroke data)

### Page Structure in LogSeq

```
Smartpen Data/
├── B3017                           ← Root book page
│   bookName:: Work Notes          ← Alias stored here
│   book:: 3017
│   ├── P42                        ← Individual page
│   │   └── [stroke data blocks]
│   └── P43
│       └── [stroke data blocks]
└── B387                           ← Another book
    bookName:: Site Visits
    book:: 387
    └── P12
        └── [stroke data blocks]
```

## Changes Made

### 1. Updated Book Page Paths

**File:** `src/lib/logseq-api.js`

```javascript
// Before
const pageName = `smartpen/B${book}`;

// After
const pageName = `Smartpen Data/B${book}`;
```

**Functions Updated:**
- `getOrCreateBookPage()` - Creates book root pages
- `getBookPageProperties()` - Reads book properties
- `scanBookAliases()` - Queries for book pages

### 2. Updated Query Pattern

**File:** `src/lib/logseq-api.js`

```javascript
// Before
[(re-matches #"smartpen/b\\d+" ?name)]

// After  
[(re-matches #"smartpen data/b\\d+" ?name)]
```

**Pattern Matching:**
- Matches: `Smartpen Data/B3017` ✓
- Extracts: Book ID using `B(\d+)$` regex

### 3. Added Book ID Registration on Import

**File:** `src/lib/logseq-import.js`

```javascript
// Register book IDs from imported strokes
const bookIds = [...new Set(canvasStrokes
  .map(s => s.pageInfo?.book)
  .filter(Boolean))];
if (bookIds.length > 0) {
  registerBookIds(bookIds);
}
```

**Effect:** When importing strokes from LogSeq, book IDs are automatically registered in the alias manager.

### 4. Added Book ID Registration on Scan

**File:** `src/lib/logseq-scanner.js`

```javascript
// Extract and register unique book IDs from discovered pages
const uniqueBookIds = [...new Set(validPages.map(p => String(p.book)))];
if (uniqueBookIds.length > 0) {
  registerBookIds(uniqueBookIds);
}
```

**Effect:** When scanning LogSeq, all discovered book IDs are registered for alias management.

## Files Modified

1. ✅ `src/lib/logseq-api.js` - Updated namespace paths and query
2. ✅ `src/lib/logseq-import.js` - Added book ID registration on import
3. ✅ `src/lib/logseq-scanner.js` - Added book ID registration on scan

## Testing Checklist

- [x] Create alias for book with pen strokes → Works
- [x] Import strokes from LogSeq → Book ID registered
- [x] Add alias for imported book → Saves to `Smartpen Data/B####`
- [x] Refresh LogSeq DB tab → Aliases loaded correctly
- [x] Alias persists across sessions → Yes (stored in LogSeq)
- [x] Multiple books work correctly → Yes
- [x] Namespace hierarchy is consistent → Yes

## Benefits of This Fix

### 1. Consistency
- All smartpen data under single namespace
- Book pages are parents of their page data
- Logical hierarchy in LogSeq

### 2. Discoverability
- Easy to find all smartpen data in LogSeq
- Book pages group their child pages naturally
- Aliases visible in correct namespace

### 3. Reliability
- Book IDs always registered when discovered
- Aliases persist correctly
- No namespace confusion

### 4. User Experience
- Import strokes → Can immediately add aliases
- Aliases work for all books
- Persistent across devices (via LogSeq sync)

## Migration Notes

### For Existing Users

If you have existing aliases saved under `smartpen/B####`:

**Option 1 - Manual Migration (Recommended):**
1. Open LogSeq
2. Find pages like `smartpen/B3017`
3. Copy the `bookName::` property value
4. Delete the old page
5. Open Settings in the app
6. Re-add the alias (will create under new namespace)

**Option 2 - Keep Both:**
- Old aliases under `smartpen/` won't be discovered
- Add new aliases and they'll work correctly
- Old pages can be deleted manually when convenient

### For New Users
- No action needed
- Everything works under `Smartpen Data/` namespace

## Technical Notes

### Why `Smartpen Data` with Capital Letters?

The namespace uses capital letters (`Smartpen Data` not `smartpen data`) because:
1. Matches existing page data convention (already used for stroke pages)
2. Consistent with LogSeq page naming conventions
3. More readable in LogSeq interface

### Query Pattern Details

The Datalog query uses case-insensitive regex:
```clojure
[(re-matches #"smartpen data/b\\d+" ?name)]
```

This matches:
- `Smartpen Data/B3017` ✓
- `smartpen data/b3017` ✓ (case insensitive)
- `SMARTPEN DATA/B3017` ✓ (case insensitive)

The `$` anchor in extraction ensures we only get the book ID at the end:
```javascript
const match = pageName.match(/B(\d+)$/i);
```

## Verification

After the fix, you should see:
1. **In App:**
   - All books appear in alias manager (from pen + LogSeq)
   - Can add/edit aliases for any book
   - Aliases persist after refresh

2. **In LogSeq:**
   - Book pages at `Smartpen Data/B####`
   - Properties include `bookName::` 
   - Child pages properly nested

3. **In Activity Log:**
   - "Loaded X book aliases" message on scan
   - "Updated bookName for B####" on save
   - No errors about missing pages

## Future Enhancements

Now that all data is under one namespace, we can:
1. Add LogSeq graph queries for smartpen data
2. Create automatic book page links
3. Add navigation between book page and child pages
4. Implement book-level properties (tags, dates, etc.)

## Conclusion

The namespace fix ensures book aliases work correctly for both:
- ✅ Strokes captured directly from pen
- ✅ Strokes imported from LogSeq storage

All smartpen data is now consistently stored under `Smartpen Data/` making the system more intuitive and reliable.
