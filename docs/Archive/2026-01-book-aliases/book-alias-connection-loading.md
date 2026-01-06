# Book Alias Loading - Connection-Based Approach

**Date:** January 5, 2026  
**Approach:** Load aliases when connecting to LogSeq, not during import  
**Rationale:** Single scan when connecting is more efficient than scanning per-import

## Architecture

Book aliases are now loaded at two key connection points:

### 1. When Testing LogSeq Connection
**Location:** `LogseqSettings.svelte` → `handleTestConnection()`

```javascript
if (result.success) {
  setLogseqStatus(true, `LogSeq: ${result.graphName || 'Connected'}`);
  log(`Connected to LogSeq graph: ${result.graphName}`, 'success');
  
  // Load book aliases when connection succeeds
  const aliases = await scanBookAliases(host, token);
  if (Object.keys(aliases).length > 0) {
    setBookAliases(aliases);
    log(`Loaded ${Object.keys(aliases).length} book aliases`, 'info');
  }
}
```

**When:** User clicks "🔗 Test Connection" in Settings

### 2. When Scanning LogSeq Database
**Location:** `logseq-scanner.js` → `scanLogSeqPages()`

```javascript
// First, scan for book aliases
const aliases = await scanBookAliases(host, token);
setBookAliases(aliases);

if (Object.keys(aliases).length > 0) {
  log(`Loaded ${Object.keys(aliases).length} book aliases`, 'info');
}

// Then scan for pages...
```

**When:** 
- Auto-scan on first opening LogSeq DB tab
- User clicks "Refresh" in LogSeq DB tab

### 3. Import Uses Existing Aliases
**Location:** `logseq-import.js` → `importStrokesFromLogSeq()`

```javascript
// Register book IDs from imported strokes
const bookIds = [...new Set(canvasStrokes
  .map(s => s.pageInfo?.book)
  .filter(Boolean))];
if (bookIds.length > 0) {
  registerBookIds(bookIds);
  // Aliases already loaded from connection/scan - just use them!
}
```

**When:** User imports strokes from LogSeq DB

## User Workflows

### Workflow 1: Test Connection First
```
1. User opens Settings
2. User clicks "🔗 Test Connection"
3. Connection succeeds
4. ✓ Aliases automatically loaded
5. User opens LogSeq DB tab
6. (Auto-scan runs but aliases already loaded)
7. User imports strokes
8. ✓ Book names appear (aliases already in store)
```

### Workflow 2: Open DB Tab First
```
1. User opens LogSeq DB tab
2. Auto-scan runs
3. ✓ Aliases automatically loaded
4. User imports strokes
5. ✓ Book names appear (aliases already in store)
```

### Workflow 3: Refresh DB Tab
```
1. User clicks "Refresh" in LogSeq DB
2. Full scan runs
3. ✓ Aliases reloaded from LogSeq
4. All book names updated
```

### Workflow 4: After Browser Refresh
```
1. User refreshes browser (F5)
2. All stores reset (aliases cleared)
3. User opens LogSeq DB tab OR tests connection
4. ✓ Aliases automatically loaded
5. User imports strokes
6. ✓ Book names appear
```

## Benefits

### 1. Efficiency
- **Single scan** when connecting (not per-import)
- **Cached in store** for entire session
- **No redundant API calls** during imports

### 2. Consistency
- Aliases loaded at **well-defined connection points**
- Same data available **throughout session**
- **Predictable behavior** for users

### 3. Performance
- **Fast imports** (no alias scanning overhead)
- **Minimal LogSeq API calls**
- **Better UX** with instant feedback

### 4. Maintainability
- **Clear separation of concerns**
  - Connection → Load aliases
  - Scan → Load aliases
  - Import → Use aliases
- **Single source of truth** (bookAliases store)
- **Easy to debug** (clear flow)

## Activity Log Messages

### On Connection Test Success:
```
✓ Connected to LogSeq graph: My Graph
ℹ️ Loaded 3 book aliases
```

### On LogSeq DB Scan:
```
ℹ️ Scanning LogSeq for smartpen pages...
ℹ️ Loaded 3 book aliases
✓ Loaded 5 smartpen pages from LogSeq (3 books)
```

### On Import (No Alias Loading):
```
ℹ️ Fetching stroke data for B3017/P42...
✓ Imported 156 strokes from B3017/P42
```

Notice: No "Loaded X book aliases" message during import!

## Store State Management

```javascript
// bookAliases store lifecycle:

1. App starts → bookAliases = {} (empty)

2. User tests connection → scanBookAliases()
   bookAliases = { "3017": "Work Notes", "387": "Site Visits" }

3. User imports strokes → registerBookIds()
   bookAliases unchanged (already has data)
   knownBookIds updated with any new books

4. User refreshes browser → bookAliases = {} (reset)

5. User opens DB tab → auto-scan → scanBookAliases()
   bookAliases = { "3017": "Work Notes", "387": "Site Visits" }
```

## Error Handling

### Connection Test Alias Loading Fails:
```javascript
try {
  const aliases = await scanBookAliases(host, token);
  setBookAliases(aliases);
} catch (aliasError) {
  console.warn('Failed to load book aliases:', aliasError);
  // Connection still succeeds, just no aliases
}
```

**Result:** Connection succeeds, but aliases not loaded. User can:
- Open LogSeq DB tab (triggers scan with alias loading)
- Click Refresh (retries alias loading)

### DB Scan Alias Loading Fails:
Already has error handling in `scanLogSeqPages()`:
```javascript
try {
  const aliases = await scanBookAliases(host, token);
  setBookAliases(aliases);
} catch (error) {
  console.error('Failed to scan book aliases:', error);
  return {}; // Return empty object, scan continues
}
```

## API Call Analysis

### Before (Import-Based Approach):
```
User connects → 0 API calls
User imports Page 1 → 1 alias scan
User imports Page 2 → 1 alias scan (redundant!)
User imports Page 3 → 1 alias scan (redundant!)
Total: 3 alias scans for 3 imports
```

### After (Connection-Based Approach):
```
User connects → 1 alias scan
User imports Page 1 → 0 alias scans
User imports Page 2 → 0 alias scans
User imports Page 3 → 0 alias scans
Total: 1 alias scan for 3 imports
```

**Savings:** 67% fewer API calls for typical multi-import session!

## Files Modified

1. ✅ `src/components/settings/LogseqSettings.svelte`
   - Import `scanBookAliases` from logseq-api
   - Import `setBookAliases` from stores
   - Add alias loading in `handleTestConnection()`

2. ✅ `src/lib/logseq-import.js`
   - Remove `scanBookAliases` import
   - Remove `setBookAliases` import
   - Remove `getLogseqSettings` import
   - Simplify import to just register book IDs

3. ✅ `src/lib/logseq-scanner.js`
   - Already scans aliases (no changes needed)

## Testing

### Test 1: Connection Test Loads Aliases
1. Restart app
2. Settings → LogSeq → Test Connection
3. Check activity log: "Loaded X book aliases"
4. Verify aliases appear in Book Alias Manager

### Test 2: DB Scan Loads Aliases
1. Restart app
2. Open LogSeq DB tab
3. Check activity log: "Loaded X book aliases"
4. Verify aliases appear in Book Alias Manager

### Test 3: Import Uses Cached Aliases
1. Test connection (loads aliases)
2. Import strokes
3. Activity log should NOT show "Loaded X book aliases"
4. Book names should appear correctly

### Test 4: Refresh Updates Aliases
1. Add new alias in LogSeq directly
2. Click Refresh in LogSeq DB
3. New alias should appear

## Future Enhancements

### Possible Improvements:

1. **Background Refresh**
   - Periodically re-scan aliases (e.g., every 5 minutes)
   - Keep aliases fresh during long sessions

2. **Smart Cache Invalidation**
   - Track when aliases were last loaded
   - Re-scan if data is "stale" (e.g., > 1 hour)

3. **LocalStorage Persistence**
   - Save aliases to localStorage
   - Load on app startup
   - Avoid needing to re-scan every session

4. **Real-time Sync**
   - Use LogSeq WebSocket API (if available)
   - Listen for page property changes
   - Auto-update aliases when changed

## Conclusion

The connection-based approach provides optimal performance by loading aliases once when connecting to LogSeq, rather than repeatedly during imports. This results in:

- ✅ **Fewer API calls** (67% reduction in typical usage)
- ✅ **Faster imports** (no scanning overhead)
- ✅ **Better UX** (immediate feedback)
- ✅ **Cleaner code** (clear separation of concerns)

**Key Achievement:** Aliases load automatically at connection time and remain available for the entire session, providing fast, efficient imports with correct book names displayed throughout the UI.
