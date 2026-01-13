# Editable Imported Transcriptions Fix

**Date**: 2026-01-13  
**Issue**: Edited transcriptions from imported LogSeq pages weren't registering as changes

## Problem Description

When a user imported a page from LogSeq that already had transcription text:

1. The transcription would display correctly in the UI
2. User could click "Edit" and modify the text
3. Changes were visible in the preview
4. **BUT** clicking "Save to LogSeq" showed "No changes to save"

The edited transcription wasn't being saved back to LogSeq.

## Root Cause

The issue was a mismatch between how transcriptions are tracked:

### The Two Transcription Sources

1. **`pageTranscriptions` store**: Contains transcriptions from the *current session*
   - Populated when user clicks "Transcribe" button
   - Used by SaveConfirmDialog to detect changes
   
2. **`logseqPages` store**: Contains pages imported from LogSeq DB
   - Populated when scanning LogSeq database
   - Contains existing transcription text from past saves
   - NOT used for change detection

### The Bug

When editing a transcription from an imported page:

```javascript
// PageCard.handleTranscriptionChange (OLD CODE)
for (const [pageKey, trans] of $pageTranscriptions) {
  if (trans.pageInfo.book === page.book && trans.pageInfo.page === page.page) {
    // Update transcription
    pageTranscriptions.update(...);  // ✓ Updates
    break;
  }
}
// If not found in pageTranscriptions → Does nothing! ❌
```

**Result**: The edit was lost because the page wasn't in `pageTranscriptions`.

## Solution

Updated `PageCard.handleTranscriptionChange` to **create** a transcription entry if it doesn't exist:

```javascript
// Check if transcription exists in store
let existingTranscription = null;
for (const [key, trans] of $pageTranscriptions) {
  if (trans.pageInfo.book === page.book && trans.pageInfo.page === page.page) {
    existingTranscription = trans;
    break;
  }
}

// Update or create transcription in store
pageTranscriptions.update(pt => {
  const newMap = new Map(pt);
  
  if (existingTranscription) {
    // Update existing entry
    newMap.set(pageKey, {
      ...existingTranscription,
      text: newText,
      lines
    });
  } else {
    // ✨ NEW: Create entry for imported page
    newMap.set(pageKey, {
      text: newText,
      lines,
      pageInfo: {
        section: 0,
        owner: 0,
        book: page.book,
        page: page.page
      },
      strokeCount: page.strokeCount || 0,
      timestamp: Date.now()
    });
  }
  
  return newMap;
});
```

## Additional Fix: Consistent Dash Stripping

Also updated `logseq-scanner.js` to strip block dash prefix when reading transcriptions, matching the behavior in `logseq-api.js`:

```javascript
function extractTranscriptionText(blocks) {
  // ...
  let content = contentBlock.content || '';
  
  // ✨ NEW: Strip block dash prefix
  content = content.replace(/^-\s+/, '');
  
  // Extract text from code fence
  const match = content.match(/```\s*\n([\s\S]*?)\n```/);
  // ...
}
```

This ensures transcriptions are read consistently whether:
- Scanning the database (scanner)
- Computing changes for save dialog (logseq-api)

## How It Works Now

### Workflow: Edit Imported Transcription

**1. Import Page from LogSeq**
```
LogSeq DB → Scanner → logseqPages store
Page data includes: transcriptionText = "- 12/12/25\n- Meeting notes"
```

**2. Display in UI**
```
PageCard renders:
- Shows page.transcriptionText in TranscriptionPreview
- Transcription is editable (editable={true})
```

**3. User Clicks Edit**
```
TranscriptionPreview → Edit mode
User modifies text: "- 12/12/25\n- Updated meeting notes"
```

**4. User Saves Edit**
```
handleTranscriptionChange() called
  ↓
Check pageTranscriptions: Not found (never transcribed this session)
  ↓
✨ CREATE new entry in pageTranscriptions:
  {
    text: "- 12/12/25\n- Updated meeting notes",
    lines: [...],
    pageInfo: { book: 3017, page: 1 },
    strokeCount: 42,
    timestamp: 1736789123456
  }
```

**5. User Clicks "Save to LogSeq"**
```
SaveConfirmDialog.computeChanges()
  ↓
Lookup transcription for B3017/P1 in pageTranscriptions
  ↓
✅ FOUND! (created in step 4)
  ↓
Compare with LogSeq version:
  - Old: "- 12/12/25\n- Meeting notes"
  - New: "- 12/12/25\n- Updated meeting notes"
  - Changed: true
  ↓
Dialog shows: "📝 Updated transcription"
  ↓
User confirms → Save to LogSeq
```

## Comparison: Before vs After

### Before (Broken)

```
Import Page → Edit Text → Save to Store? NO ❌
                             ↓
                      Lost in void 💀
                             ↓
                    "No changes to save"
```

### After (Fixed)

```
Import Page → Edit Text → Create Store Entry ✅
                             ↓
                    Detected by dialog ✅
                             ↓
                    Save to LogSeq ✅
```

## Edge Cases Handled

### Case 1: Edit Multiple Times Before Save
```
Import → Edit 1 → Creates store entry
      → Edit 2 → Updates store entry
      → Edit 3 → Updates store entry
      → Save   → Saves final version
```

### Case 2: Transcribe Then Edit
```
Import → Transcribe → Creates store entry
      → Edit       → Updates store entry (exists)
      → Save       → Saves with changes
```

### Case 3: Import, Edit, Save, Edit Again
```
Import → Edit → Save to LogSeq
      → Edit again → Updates store entry
      → Save       → Detects change vs LogSeq
```

### Case 4: Multiple Pages
```
Import Page 1 → Edit → Creates entry for P1
Import Page 2 → Edit → Creates entry for P2
Save → Both pages show changes
```

## Testing Verification

✅ Import page with transcription → Edit → Shows change in dialog  
✅ Import page with transcription → Edit multiple times → Shows final change  
✅ Import page → Transcribe → Edit → Shows change  
✅ Import multiple pages → Edit both → Shows both changes  
✅ Edit → Save → Edit again → Shows second change  
✅ No double dashes when saving edited transcription  

## Files Modified

1. **`src/components/logseq-db/PageCard.svelte`**
   - Modified `handleTranscriptionChange()` to create transcription entries
   - Ensures edited imported transcriptions are tracked for save

2. **`src/lib/logseq-scanner.js`**
   - Modified `extractTranscriptionText()` to strip block dash prefix
   - Ensures consistent transcription format across codebase

## Benefits

- ✅ **Edit imported transcriptions**: Full editing support for pages from LogSeq
- ✅ **Change detection works**: SaveConfirmDialog properly detects edited text
- ✅ **Consistent formatting**: Dash stripping applied uniformly
- ✅ **Multiple edits**: Can edit multiple times before saving
- ✅ **Multi-page support**: Works across multiple imported pages

## Technical Details

### Store Entry Structure

When creating a transcription entry for an imported page:

```javascript
{
  text: string,              // Full transcription text with formatting
  lines: Array<{             // Parsed line objects
    text: string,            // Line text (trimmed)
    lineNumber: number,      // Line index
    indentLevel: number,     // Indentation level (0-N)
    parent: null,
    children: []
  }>,
  pageInfo: {                // Page identification
    section: 0,              // Default section
    owner: 0,                // Default owner
    book: number,            // Book ID from imported page
    page: number             // Page number from imported page
  },
  strokeCount: number,       // Stroke count from imported page
  timestamp: number          // When edit was made
}
```

This matches the structure created by MyScript transcription, ensuring compatibility with the save logic.

### Page Key Format

The page key used for store lookup follows the pattern:
```
S{section}/O{owner}/B{book}/P{page}

Example: "S0/O0/B3017/P1"
```

This consistent format ensures proper lookup across the codebase.

## Related Issues

This fix complements the double-dash bug fix by ensuring:
1. Transcriptions are read with consistent dash stripping
2. Edits are properly tracked in the store
3. Changes are detected for save operations

Together, these fixes provide a complete solution for editing transcriptions from imported pages.
