# Duplicate Strokes Feature - Final Implementation

## Summary of Changes

### 1. **Fixed Dialog Overflow** ✅
- Increased dialog width from `400px` to `480px`
- Text now has proper spacing and won't overflow
- Added `line-height: 1.5` to info text for better readability

### 2. **Single "Duplicate" Button** ✅
- Replaced Copy/Paste workflow with one-click **🔄 Duplicate** button
- Keyboard shortcut: **Ctrl+D**
- Automatically positions duplicates with slight offset
- Auto-selects newly duplicated strokes
- Clears original selection

### 3. **Autocomplete for Book/Page Numbers** ✅
- **Book Number Autocomplete**:
  - Shows up to 5 existing book numbers from LogSeq
  - Filters as you type
  - Click to select
  - Shows on focus

- **Page Number Autocomplete**:
  - Shows pages for the selected book
  - Disabled until book is selected
  - Filters based on input
  - Click to select

### 4. **Conflict Detection & Resolution** ✅
- **Automatic Detection**: Checks if B{book}/P{page} already exists
- **Warning Indicator**: Shows ⚠️ message when page exists
- **Conflict Dialog**: Two clear options:
  - **🔄 Overwrite**: Replace all existing strokes
  - **➕ Append**: Add new strokes to existing ones

### 5. **Converted Strokes Appear as Pages** ✅
- After saving, strokes appear as regular pages with book/page borders
- Fully integrated with existing page system
- Can be viewed, repositioned, and scaled like other pages

### 6. **Move Cursor on Hover** ✅
- Cursor changes to `move` when hovering over selected duplicated strokes
- Clear visual feedback for draggable elements

## Complete Workflow

### Step-by-Step Usage:

1. **Select Source Strokes**
   - Use box select to drag over strokes
   - Or Ctrl+click individual strokes
   - Or use Select All

2. **Duplicate**
   - Click **🔄 Duplicate** button (or press Ctrl+D)
   - Green duplicated strokes appear with slight offset
   - Original selection is cleared
   - Duplicates are auto-selected

3. **Arrange Duplicates**
   - Hover over selected duplicates → cursor shows `move`
   - Drag to reposition
   - Box select multiple duplicates to move as group
   - Deselect and reselect different combinations

4. **Save as Page**
   - Click **📄 Save as Page (N)** where N = selected count
   - Dialog opens showing stroke count

5. **Enter Book/Page**
   - **Book Number**: Type or select from autocomplete
   - **Page Number**: Type or select from autocomplete (filtered by book)
   - See suggestions from existing LogSeq data
   - If page exists, warning appears: ⚠️ "This page already exists"

6. **Handle Conflicts** (if page exists)
   - Conflict dialog shows two options:
   
   **🔄 Overwrite**
   - Replaces ALL existing strokes on that page
   - Use when you want to completely replace the page
   
   **➕ Append**
   - Adds new strokes to existing strokes
   - Use when you want to add more content to a page
   - Existing strokes remain untouched

7. **Result**
   - Page is saved to LogSeq
   - Strokes appear as a regular page with B{book}/P{page} border
   - Duplicated strokes are removed from canvas
   - Other duplicated strokes (not saved) remain

## UI Components

### Main Dialog ("Create New Page")
```
┌─────────────────────────────────────────┐
│ Create New Page                      × │
├─────────────────────────────────────────┤
│ Save 447 selected duplicated strokes   │
│ as a new page in LogSeq.               │
│                                         │
│ Coordinates will be normalized with    │
│ the top-left corner at (0, 0).         │
│                                         │
│ Book Number      Page Number           │
│ ┌────────────┐  ┌────────────┐        │
│ │ 123       ▼│  │ 2         ▼│        │
│ └────────────┘  └────────────┘        │
│ │ Book 123    │  │ Page 1     │       │
│ │ Book 200    │  │ Page 2     │       │
│ └─────────────┘  │ Page 3     │       │
│                  └─────────────┘       │
│                                         │
│ ⚠️ This page already exists - you'll    │
│    be asked to overwrite or append     │
│                                         │
│ This will create entry at B123/P2      │
│ and save the stroke data to LogSeq.   │
│                                         │
│           [Cancel]  [Create Page]      │
└─────────────────────────────────────────┘
```

### Conflict Dialog
```
┌─────────────────────────────────────────┐
│ ⚠️ Page Already Exists                × │
├─────────────────────────────────────────┤
│ Page B123/P2 already has stroke data   │
│ in LogSeq.                              │
│                                         │
│ Choose how to proceed:                  │
│                                         │
│ ┌─────────────────────────────────────┐│
│ │ 🔄  Overwrite                       ││
│ │     Replace existing strokes with   ││
│ │     new ones                        ││
│ └─────────────────────────────────────┘│
│                                         │
│ ┌─────────────────────────────────────┐│
│ │ ➕  Append                           ││
│ │     Add new strokes to existing     ││
│ │     ones                            ││
│ └─────────────────────────────────────┘│
│                                         │
│                        [Go Back]        │
└─────────────────────────────────────────┘
```

## Technical Details

### Autocomplete Implementation
```javascript
// Book suggestions filtered by input
$: {
  if (bookNumber) {
    const num = parseInt(bookNumber);
    bookSuggestions = allBooks.filter(b => 
      b.toString().startsWith(bookNumber) && b !== num
    ).slice(0, 5);
  } else {
    bookSuggestions = allBooks.slice(0, 5);
  }
}

// Page suggestions filtered by book and input
$: {
  if (pageNumber && bookNumber) {
    const num = parseInt(pageNumber);
    pageSuggestions = allPagesForBook.filter(p => 
      p.toString().startsWith(pageNumber) && p !== num
    ).slice(0, 5);
  } else if (bookNumber) {
    pageSuggestions = allPagesForBook.slice(0, 5);
  }
}
```

### Conflict Resolution Flow
```javascript
async function handleCreate() {
  // ...validate input...
  
  if (pageExists) {
    // Store pending strokes and show conflict dialog
    pendingStrokes = getPastedAsNewPage(book, page, indicesToConvert);
    showConflictDialog = true;
    return;
  }
  
  // No conflict, proceed normally
  await performSave(book, page, 'overwrite');
}

async function performSave(book, page, mode) {
  if (mode === 'append') {
    // Fetch existing strokes
    const existingData = await getPageStrokes(book, page, host, token);
    if (existingData && existingData.strokes) {
      // Combine with new strokes
      strokesToSave = [...existingData.strokes, ...strokesToSave];
    }
  }
  
  // Save to LogSeq
  await updatePageStrokes(book, page, strokesToSave, host, token);
  
  // Add to main strokes so they appear as a page
  addOfflineStrokes(strokesToSave);
}
```

### Modified Files

1. **`pasted-strokes.js`**
   - Renamed `pasteStrokes()` to `duplicateStrokes()`
   - Returns count of duplicated strokes

2. **`stores/index.js`**
   - Updated export from `pasteStrokes` to `duplicateStrokes`

3. **`StrokeCanvas.svelte`**
   - Removed Copy/Paste buttons
   - Added single Duplicate button
   - Changed keyboard shortcut from Ctrl+C/V to Ctrl+D
   - Added move cursor on hover for selected duplicates
   - Updated canvas hints

4. **`CreatePageDialog.svelte`** (completely rewritten)
   - Increased dialog width to 480px
   - Added autocomplete for book/page numbers
   - Added conflict detection logic
   - Added conflict resolution dialog
   - Added page exists warning indicator
   - Improved text layout to prevent overflow

## Benefits

✅ **Streamlined Workflow**: One button instead of two  
✅ **Smart Suggestions**: Autocomplete prevents typos and shows existing pages  
✅ **Conflict Prevention**: Clear warning before overwriting data  
✅ **User Choice**: Overwrite OR append - you decide  
✅ **Visual Feedback**: Move cursor, page exists warnings, clear dialogs  
✅ **Professional Output**: Converted pages look like regular pages  
✅ **Better Layout**: Wider dialog accommodates longer text without overflow  

## Testing Checklist

- [ ] Select strokes and click Duplicate (Ctrl+D)
- [ ] Duplicates appear in green with slight offset
- [ ] Hover over selected duplicate shows move cursor
- [ ] Drag selected duplicates to reposition
- [ ] Click "Save as Page"
- [ ] Book autocomplete shows existing books
- [ ] Page autocomplete filters by selected book
- [ ] Click autocomplete suggestion to select
- [ ] Enter book/page that exists → warning appears
- [ ] Click "Create Page" → conflict dialog shows
- [ ] Test "Overwrite" option
- [ ] Test "Append" option
- [ ] Verify page appears with proper border in canvas
- [ ] Verify only converted strokes are removed
- [ ] Verify other duplicates remain on canvas

## Known Behavior

- **Autocomplete delay**: Blur event has 200ms delay to allow clicking suggestions
- **Page detection**: Only checks pages currently loaded in `logseqPages` store
- **Append mode**: Fetches existing strokes from LogSeq before combining
- **Coordinate normalization**: Always normalizes to (0,0) anchor regardless of mode
