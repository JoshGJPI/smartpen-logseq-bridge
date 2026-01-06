# Book Alias Auto-Loading Fix

**Date:** January 5, 2026  
**Issue:** Book aliases not appearing after app refresh + import  
**Root Cause:** Aliases only loaded when scanning LogSeq DB, not when importing strokes

## Problem Flow

**Before Fix:**
1. User syncs aliases to LogSeq ✓
2. User refreshes browser → All stores reset
3. User imports strokes from LogSeq
4. Book IDs registered but aliases NOT loaded ✗
5. Book names don't appear in UI ✗

**Why It Happened:**
- Aliases are stored in a Svelte writable store (in-memory)
- Not persisted in localStorage
- Only loaded when `scanLogSeqPages()` is called
- Importing strokes only registered book IDs, didn't scan for aliases

## Solution

Updated `logseq-import.js` to automatically scan for aliases when importing strokes:

```javascript
// After registering book IDs
if (bookIds.length > 0) {
  registerBookIds(bookIds);
  
  // NEW: Load aliases from LogSeq for the imported books
  try {
    const { host, token } = getLogseqSettings();
    const aliases = await scanBookAliases(host, token);
    if (Object.keys(aliases).length > 0) {
      setBookAliases(aliases);
      log(`Loaded ${Object.keys(aliases).length} book aliases from LogSeq`, 'info');
    }
  } catch (error) {
    console.warn('Failed to load book aliases:', error);
    // Don't fail the import if aliases can't be loaded
  }
}
```

## How Aliases Are Now Loaded

### Scenario 1: Open LogSeq DB Tab First
```
1. User refreshes app
2. User opens LogSeq DB tab
3. Auto-scan runs (onMount)
   → scanLogSeqPages()
   → scanBookAliases()
   → setBookAliases()
4. Aliases loaded ✓
5. User imports strokes
6. Aliases already available ✓
```

### Scenario 2: Import Strokes Directly
```
1. User refreshes app
2. User imports strokes (without opening LogSeq DB)
3. Import function registers book IDs
4. Import function scans for aliases (NEW)
   → scanBookAliases()
   → setBookAliases()
5. Aliases loaded ✓
6. Book names appear in UI ✓
```

### Scenario 3: Manual Refresh
```
1. User clicks "Refresh" in LogSeq DB tab
2. scanLogSeqPages() runs
3. Aliases loaded at start of scan
4. All book names update ✓
```

## Auto-Scan Behavior

The LogSeq DB tab has automatic scanning:

```javascript
// LogSeqDbTab.svelte
onMount(() => {
  if ($logseqConnected && $logseqPages.length === 0) {
    handleRefresh(); // Auto-scan on first mount
  }
});
```

This means:
- First time opening the tab → auto-scan
- Subsequent visits → no auto-scan (uses cached data)
- Manual refresh button → always re-scans

## Complete Alias Loading Points

Aliases are now loaded from LogSeq in these situations:

1. ✅ **LogSeq DB auto-scan** (first mount, if connected)
2. ✅ **LogSeq DB manual refresh** (user clicks refresh button)
3. ✅ **Import strokes** (NEW - automatic alias load)
4. ✅ **Bulk sync** (when saving aliases, they're immediately in store)

## Activity Log Messages

When importing strokes, you'll now see:

```
ℹ️ Fetching stroke data for B3017/P42...
ℹ️ Loaded 3 book aliases from LogSeq
✓ Imported 156 strokes from B3017/P42
```

The "Loaded X book aliases" message confirms aliases were scanned.

## Error Handling

If alias scanning fails during import:
- Error logged to console (warning level)
- Import continues successfully
- Book IDs still registered
- User can manually refresh to retry

This ensures imports don't fail just because alias scanning has issues.

## Performance Impact

**Additional API Call Per Import:**
- 1 Datalog query to scan all book pages
- Typical time: ~100-200ms
- Only runs if books are imported
- Results cached in store for session

**Optimization:**
- Could check if aliases already loaded before scanning
- Currently always scans to ensure fresh data
- Acceptable overhead for better UX

## Testing

### Test Case 1: Fresh Import After Refresh
1. Save aliases to LogSeq
2. Refresh browser (F5)
3. Import strokes from LogSeq DB
4. **Expected:** Book names appear immediately

### Test Case 2: Multiple Imports
1. Import strokes from Book A
2. Import strokes from Book B
3. **Expected:** Both book names appear (aliases loaded once)

### Test Case 3: Import Before Opening DB Tab
1. Refresh app
2. Don't open LogSeq DB tab
3. Import strokes directly
4. **Expected:** Aliases still load and appear

### Test Case 4: Offline Import
1. Disconnect from LogSeq
2. Try to import strokes
3. **Expected:** Import fails gracefully, no alias errors

## Files Modified

1. ✅ `src/lib/logseq-import.js` - Added automatic alias scanning
   - Import `setBookAliases` from stores
   - Import `scanBookAliases` from logseq-api
   - Import `getLogseqSettings` from stores
   - Call `scanBookAliases()` after registering book IDs
   - Update aliases store with results
   - Log success message

## Future Enhancements

### Possible Improvements:

1. **Cache Check**
   - Only scan if aliases not already loaded
   - Reduces unnecessary API calls

2. **Differential Update**
   - Only scan for aliases of new books
   - Skip books already in alias store

3. **LocalStorage Persistence**
   - Save aliases to localStorage
   - Load on app startup
   - Sync with LogSeq in background

4. **Lazy Loading**
   - Load aliases on-demand per book
   - When book first appears in UI
   - Reduces initial scan time

5. **WebSocket Updates**
   - Listen for LogSeq page changes
   - Auto-update aliases when changed in LogSeq
   - Real-time sync

## Conclusion

With this fix, book aliases now load automatically when importing strokes, ensuring they're always available regardless of whether the LogSeq DB tab has been opened. This provides a seamless user experience where book names appear as expected after setting them up.

**Key Achievement:** Users no longer need to manually refresh the LogSeq DB tab to see book aliases after importing strokes.
