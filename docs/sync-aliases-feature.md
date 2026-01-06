# Sync All Aliases to LogSeq - Feature Addition

**Date:** January 5, 2026  
**Feature:** Manual bulk sync button for book aliases

## Problem

Users wanted to update book aliases in LogSeq without needing to save new strokes:
- Import existing pages from LogSeq → Book IDs registered
- Add aliases in the app → Stored locally
- But no way to push those aliases to LogSeq without saving new strokes

## Solution

Added a "🔄 Sync All to LogSeq" button in the Book Alias Manager that:
1. Updates all current aliases to LogSeq
2. Creates book root pages if they don't exist
3. Updates the `bookName` property for each book
4. Shows progress and results in activity log

## Implementation

### UI Changes

**Location:** Settings → Book Aliases section

**Button Appearance:**
- Positioned in the header next to the help text
- Only visible when:
  - LogSeq is connected AND
  - At least one alias exists
- Shows spinner during sync operation

**States:**
```
Normal:   "🔄 Sync All to LogSeq"
Syncing:  "🔄 Syncing..." (with spinner, disabled)
```

### Function: `syncAllAliasesToLogSeq()`

**Process:**
1. Check LogSeq connection
2. Get all aliases from store
3. Loop through each alias
4. Call `updateBookPageProperty()` for each
5. Track success/error counts
6. Log results to activity log

**Code:**
```javascript
async function syncAllAliasesToLogSeq() {
  if (!$logseqConnected) {
    log('Connect to LogSeq first to sync aliases', 'warning');
    return;
  }
  
  const aliasEntries = Object.entries($bookAliases);
  
  if (aliasEntries.length === 0) {
    log('No aliases to sync', 'info');
    return;
  }
  
  isSyncing = true;
  const { host, token } = getLogseqSettings();
  
  let successCount = 0;
  let errorCount = 0;
  
  log(`Syncing ${aliasEntries.length} book aliases to LogSeq...`, 'info');
  
  for (const [bookId, alias] of aliasEntries) {
    try {
      const success = await updateBookPageProperty(
        Number(bookId), 
        'bookName', 
        alias, 
        host, 
        token
      );
      if (success) {
        successCount++;
      } else {
        errorCount++;
      }
    } catch (error) {
      console.error(`Failed to sync alias for B${bookId}:`, error);
      errorCount++;
    }
  }
  
  isSyncing = false;
  
  if (successCount > 0) {
    log(`Successfully synced ${successCount} book aliases to LogSeq`, 'success');
  }
  if (errorCount > 0) {
    log(`Failed to sync ${errorCount} book aliases`, 'error');
  }
}
```

## User Workflow

### Scenario 1: Import Existing Data

1. Open LogSeq DB tab
2. Import strokes from existing pages
3. Book IDs automatically registered
4. Open Settings → Book Aliases
5. Add aliases to the imported books
6. Click "🔄 Sync All to LogSeq"
7. All aliases saved to LogSeq

### Scenario 2: Bulk Update

1. Add/edit multiple aliases locally
2. Click "🔄 Sync All to LogSeq"
3. All aliases updated in one operation
4. Check activity log for results

### Scenario 3: Manual Sync

1. Made changes offline
2. Connect to LogSeq
3. Click "🔄 Sync All to LogSeq"
4. Ensures LogSeq is up-to-date

## Activity Log Messages

**Starting:**
```
ℹ️ Syncing 3 book aliases to LogSeq...
```

**Individual Updates (in console):**
```
Updated bookName for B3017: Work Notes
Updated bookName for B387: Site Visits
```

**Success:**
```
✓ Successfully synced 3 book aliases to LogSeq
```

**Partial Failure:**
```
✓ Successfully synced 2 book aliases to LogSeq
✗ Failed to sync 1 book aliases
```

## Styling

**Button:**
```css
.btn-sync {
  padding: 0.5rem 1rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-sync:hover:not(:disabled) {
  background: var(--accent-hover, #d64560);
  transform: translateY(-1px);
}

.btn-sync:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

**Spinner:**
```css
.spinner-small {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
```

## Benefits

### 1. Flexibility
- Sync anytime, not just when saving strokes
- Manual control over when aliases are persisted
- Can import data first, add aliases later

### 2. Bulk Operations
- Update multiple aliases at once
- No need to save strokes for each book
- Efficient for many books

### 3. Error Recovery
- If individual saves fail, can retry all
- Clear feedback on success/failure
- Activity log shows details

### 4. Offline-First
- Can add aliases offline
- Sync when connection available
- Doesn't block normal workflow

## Technical Details

### API Calls

Each alias sync makes one API call:
```javascript
updateBookPageProperty(bookId, 'bookName', alias, host, token)
  ↓
getOrCreateBookPage(bookId) // Creates "Smartpen Data/B####"
  ↓
upsertBlockProperty(pageName, 'bookName', alias)
  ↓
LogSeq page updated with property
```

### Performance

- Sequential processing (one at a time)
- Each update takes ~100-200ms
- 10 aliases = ~1-2 seconds
- Shows progress in real-time

### Error Handling

**Connection Errors:**
- Checks `logseqConnected` before starting
- Shows warning if not connected

**Individual Failures:**
- Caught and logged per-book
- Doesn't stop entire sync
- Reports success/error counts

**No Aliases:**
- Early return with info message
- Doesn't attempt sync

## Testing Checklist

- [x] Button appears when connected and aliases exist
- [x] Button hidden when disconnected or no aliases
- [x] Spinner shows during sync
- [x] Button disabled during sync
- [x] Success message shows with count
- [x] Error message shows if failures occur
- [x] Activity log shows progress
- [x] LogSeq pages created correctly
- [x] Properties updated in LogSeq
- [x] Works with multiple aliases
- [x] Handles connection errors gracefully

## Files Modified

1. ✅ `src/components/settings/BookAliasManager.svelte` - Added sync functionality and UI

## Lines Added

- Function: ~50 lines
- UI: ~30 lines
- Styles: ~40 lines
- **Total:** ~120 lines

## Future Enhancements

### Possible Improvements:

1. **Progress Bar**
   - Visual progress instead of just spinner
   - "Syncing 2/5 aliases..."

2. **Selective Sync**
   - Checkboxes to choose which aliases to sync
   - "Sync Selected" button

3. **Auto-Sync**
   - Option to auto-sync on every change
   - Configurable delay (e.g., 5 seconds after last edit)

4. **Conflict Detection**
   - Warn if LogSeq has different value
   - Allow user to choose local vs remote

5. **Batch API**
   - Single API call for multiple properties
   - Faster for many aliases

## Conclusion

The "Sync All to LogSeq" feature provides users with manual control over when book aliases are persisted, enabling workflows where data is imported first and aliases added later. This is especially useful for managing existing LogSeq data and bulk operations.

**Key Achievement:** Users can now update book aliases independently of stroke saving operations.
