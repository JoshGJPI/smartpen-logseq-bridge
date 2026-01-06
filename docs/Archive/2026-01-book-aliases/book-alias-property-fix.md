# Book Alias Property Fix - upsertBlockProperty API

**Date:** January 5, 2026  
**Issue:** Book aliases not saving to LogSeq  
**Root Cause:** Using page name instead of block UUID for property updates

## Problem

The `upsertBlockProperty` API call doesn't work with page names - it requires a block UUID. In LogSeq, page properties are stored in the first block of a page (the properties block), not on the page object itself.

**Previous Code (Incorrect):**
```javascript
await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
  pageName,        // ❌ This doesn't work - needs block UUID
  propertyName,
  value
]);
```

## Solution

Updated `updateBookPageProperty()` to:
1. Get or create the book page
2. Get the page's block tree
3. Find the first block (or create it if page is empty)
4. Use that block's UUID for the property update

## How It Works

### Case 1: New Page (No Blocks)
```
1. Create book page: "Smartpen Data/B3017"
2. Page exists but has no blocks
3. Create first block with empty content
4. Get that block's UUID
5. Set property on that block
   → bookName:: Work Notes
```

### Case 2: Existing Page (Has Blocks)
```
1. Get book page: "Smartpen Data/B3017"
2. Get page blocks tree
3. Use blocks[0].uuid (first block)
4. Set property on that block
   → bookName:: Work Notes
```

## LogSeq Page Structure

**After Fix:**
```
Smartpen Data/B3017
  - [First block - holds properties]
    bookName:: Work Notes
    book:: 3017
```

## Testing

After applying the fix:

1. **Add a new alias:**
   - Settings → Book Aliases
   - Add alias to any book
   - Check activity log for success
   - Open LogSeq → Verify property exists

2. **Sync existing aliases:**
   - Click "🔄 Sync All to LogSeq"
   - Check activity log
   - Open LogSeq → Verify all properties exist

3. **Refresh and reload:**
   - Refresh the app
   - Click "Refresh" in LogSeq DB tab
   - Verify aliases still appear

## Migration Note

**For Existing Failed Saves:**
If you tried to save aliases before this fix:
1. They were stored locally (in memory)
2. But not saved to LogSeq
3. After fixing, click "🔄 Sync All to LogSeq"
4. All aliases will now save correctly

## Conclusion

The fix ensures that page properties are correctly set on the first block of each book page, following LogSeq's internal structure requirements. This allows book aliases to persist correctly and sync across sessions.

**Key Achievement:** Book aliases now save reliably to LogSeq and persist across sessions.
