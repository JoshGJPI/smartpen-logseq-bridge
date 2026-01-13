# Transcription Save Improvements

**Date**: 2026-01-13  
**Version**: 0.2.0+

## Overview

Enhanced the save-to-LogSeq functionality to properly detect and display transcription changes, and added the ability to edit transcriptions before saving.

## Problem Statement

The application had three key issues:

1. **Transcription-only changes not detected**: When a user transcribed a page that already had strokes saved in LogSeq, the app showed "no changes to save" because it only checked for stroke changes, not transcription changes.

2. **Save dialog didn't show transcription changes**: Even when transcription would be saved, the confirmation dialog only displayed stroke additions/deletions, not transcription updates.

3. **No way to edit transcription before saving**: Users couldn't correct or adjust transcription text before committing it to LogSeq storage.

## Changes Made

### 1. Enhanced `logseq-api.js` - Transcription Change Detection

**File**: `src/lib/logseq-api.js`

#### Added: `getExistingTranscription()` function
- Retrieves existing transcription text from a LogSeq page
- Extracts text from the "Transcribed Text" section
- Handles code block formatting (`\`\`\`` markers)

#### Modified: `computePageChanges()` function
- **New signature**: Now accepts `transcription` parameter (previously only compared strokes)
- **Returns**: Extended change object with transcription status:
  ```javascript
  {
    strokeAdditions: number,
    strokeDeletions: number,
    strokeTotal: number,
    hasNewTranscription: boolean,      // NEW
    transcriptionChanged: boolean      // NEW
  }
  ```
- **Logic**: Compares formatted transcription text against existing LogSeq transcription
- Detects two states:
  - `hasNewTranscription`: No existing transcription in LogSeq (first save)
  - `transcriptionChanged`: Transcription exists but content differs (update)

### 2. Updated Save Confirmation Dialog

**File**: `src/components/dialog/SaveConfirmDialog.svelte`

#### State Changes
```javascript
// OLD
let totalAdditions = 0;
let totalDeletions = 0;

// NEW
let totalStrokeAdditions = 0;
let totalStrokeDeletions = 0;
let totalNewTranscriptions = 0;
let totalChangedTranscriptions = 0;
```

#### Dialog Display Updates

**Summary Section**: Now shows four categories of changes
```html
<!-- Stroke changes -->
Adding: +X strokes
Deleting: -X strokes

<!-- Transcription changes (NEW) -->
New Text: X page(s)        (purple badge)
Updated Text: X page(s)    (amber badge)
```

**Per-Page Changes**: Each page now displays:
```html
📄 Book 3017 / Page 1
  +5 strokes
  -2 strokes
  ✨ New transcription
  📝 Updated transcription
```

#### Change Detection Logic
```javascript
// Now checks all four types of changes
changesList = results.filter(item => 
  item.strokeAdditions > 0 || 
  item.strokeDeletions > 0 || 
  item.hasNewTranscription ||     // NEW
  item.transcriptionChanged       // NEW
);
```

#### New CSS Styles
```css
.stat.transcription-new {
  color: #8b5cf6;           /* Purple */
  background: rgba(139, 92, 246, 0.1);
}

.stat.transcription-changed {
  color: #f59e0b;           /* Amber */
  background: rgba(245, 158, 11, 0.1);
}
```

### 3. Editable Transcription Preview

**File**: `src/components/logseq-db/TranscriptionPreview.svelte`

#### New Props
```javascript
export let editable = false;  // Enable editing
```

#### Edit Mode Features
- **Edit Button**: Appears in top-right corner when `editable={true}`
- **Textarea Editor**: Full-featured text editing with:
  - Monospace font (Courier New)
  - Preserved whitespace/indentation
  - Vertical resize handle
  - Minimum 150px height
  
#### Keyboard Shortcuts
- **Ctrl/Cmd + Enter**: Save changes
- **Escape**: Cancel editing

#### Actions
```javascript
// Save button
function handleSave() {
  isEditing = false;
  dispatch('change', editedText);
}

// Cancel button
function handleCancel() {
  isEditing = false;
  editedText = text;  // Reset to original
}
```

#### Visual Design
- Edit button: Blue accent color, fades in on hover
- Save button: Green success color
- Cancel button: Secondary gray color
- Keyboard hint: Subtle gray text

### 4. PageCard Integration

**File**: `src/components/logseq-db/PageCard.svelte`

#### Change Handling
```javascript
function handleTranscriptionChange(event) {
  const newText = event.detail;
  
  // Reconstruct lines from edited text
  const lines = newText.split('\n').map((line, index) => ({
    text: line,
    lineNumber: index,
    indentLevel: 0,
    parent: null,
    children: []
  }));
  
  // Update pageTranscriptions store
  pageTranscriptions.update(pt => {
    const newMap = new Map(pt);
    newMap.set(pageKey, {
      ...trans,
      text: newText,
      lines
    });
    return newMap;
  });
}
```

#### Component Usage
```html
<TranscriptionPreview 
  text={editedTranscription} 
  editable={true}
  on:change={handleTranscriptionChange}
/>
```

## User Workflows

### Workflow 1: Transcribe and Save New Page
1. User writes on paper with smartpen
2. Imports strokes to canvas
3. Clicks "Transcribe" → MyScript processes handwriting
4. Clicks "Save to LogSeq"
5. **Dialog shows**: "+42 strokes, ✨ New transcription on 1 page"
6. Confirms save → Both strokes and text saved to LogSeq

### Workflow 2: Update Existing Page Transcription
1. User imports page from LogSeq (already has strokes + transcription)
2. User notices transcription error, clicks "Edit" on preview
3. Makes corrections in editor
4. Clicks Save or presses Ctrl+Enter
5. Clicks "Save to LogSeq"
6. **Dialog shows**: "📝 Updated transcription on 1 page"
7. Confirms save → Corrected transcription saved to LogSeq

### Workflow 3: Transcription-Only Update
1. User imports page with strokes (no transcription yet)
2. Clicks "Transcribe" → Gets transcription
3. Clicks "Save to LogSeq"
4. **Dialog shows**: "✨ New transcription on 1 page" (no stroke changes)
5. Confirms save → Only transcription updated in LogSeq

### Workflow 4: Edit Before First Save
1. User transcribes handwriting
2. Immediately notices errors in transcription preview
3. Clicks "Edit" button
4. Fixes errors in textarea
5. Saves changes
6. Then saves to LogSeq with corrected text

## Technical Details

### Change Detection Flow

```
User clicks "Save to LogSeq"
    ↓
SaveConfirmDialog.computeChanges()
    ↓
For each page with strokes:
    ├─ Get activeStrokes (from canvas, excluding deleted)
    ├─ Get transcription (from pageTranscriptions store)
    └─ Call computePageChanges(book, page, strokes, transcription)
        ↓
        ├─ Compare strokes → strokeAdditions, strokeDeletions
        └─ Compare transcription:
            ├─ Format new transcription text
            ├─ Fetch existing from LogSeq
            └─ Compare:
                ├─ No existing → hasNewTranscription = true
                └─ Different text → transcriptionChanged = true
    ↓
Filter to pages with ANY changes (strokes OR transcription)
    ↓
Display in confirmation dialog with badges
    ↓
User confirms → handleSaveToLogseq() saves both
```

### Store Updates on Edit

```
User edits transcription in PageCard
    ↓
TranscriptionPreview fires 'change' event
    ↓
PageCard.handleTranscriptionChange()
    ↓
Find matching entry in pageTranscriptions store
    ↓
Update with new text and reconstructed lines array
    ↓
Store updated, reactive components re-render
    ↓
SaveConfirmDialog will detect change on next open
```

## Testing Checklist

- [x] Import page with strokes only, transcribe, save → Shows "New transcription"
- [x] Import page with strokes + transcription, edit text, save → Shows "Updated transcription"
- [x] Transcribe page already in LogSeq, save → Detects change correctly
- [x] Edit button appears in PageCard transcription preview
- [x] Textarea editor allows full text editing with preserved formatting
- [x] Ctrl+Enter saves changes, Escape cancels
- [x] Changes in editor update pageTranscriptions store
- [x] Save dialog shows all four types of changes correctly
- [x] Color coding: Green (additions), Red (deletions), Purple (new text), Amber (updated text)

## Benefits

1. **No more "no changes" false negatives**: Transcription changes are properly detected
2. **Better visibility**: Users see exactly what will be saved (strokes + text)
3. **Quality control**: Users can fix transcription errors before committing to LogSeq
4. **Flexible workflow**: Can transcribe-then-edit-then-save in one session
5. **Clear feedback**: Color-coded badges show type of change at a glance

## Backward Compatibility

- All changes are additive/non-breaking
- Old code calling `computePageChanges()` with 4 args still works (transcription defaults to `null`)
- Pages without transcription continue to work normally
- Existing LogSeq data structure unchanged

## Future Enhancements

Potential improvements for future versions:

1. **Undo/Redo in editor**: Add history stack for transcription edits
2. **Diff view**: Show side-by-side comparison of old vs new transcription
3. **Spell check**: Integrate browser spell checker in textarea
4. **Line-by-line editing**: Edit individual lines with indentation controls
5. **Batch editing**: Edit transcriptions for multiple pages at once
6. **Auto-save drafts**: Persist edited transcription locally before save to LogSeq
7. **Transcription confidence**: Show MyScript confidence scores, highlight uncertain words
8. **Voice input**: Allow voice-to-text corrections for faster editing

## Files Modified

1. `src/lib/logseq-api.js` - Added transcription comparison logic
2. `src/components/dialog/SaveConfirmDialog.svelte` - Enhanced change display
3. `src/components/logseq-db/TranscriptionPreview.svelte` - Added edit functionality
4. `src/components/logseq-db/PageCard.svelte` - Enabled editing and store updates

## Related Documentation

- `docs/app-specification.md` - Overall app architecture
- `docs/line-detection-algorithm.md` - How transcription line detection works
- `src/lib/stroke-storage.js` - Storage format for transcriptions in LogSeq
