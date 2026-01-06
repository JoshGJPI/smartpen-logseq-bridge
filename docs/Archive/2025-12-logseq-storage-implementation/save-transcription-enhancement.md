# Save to LogSeq - Transcription Enhancement

## Overview
Updated the "Save to LogSeq" button to automatically save transcription data along with strokes when available, supporting both per-page transcriptions and legacy single-transcription mode.

## What Was Added

### 1. Import Page Transcriptions Store
```javascript
import {
  // ... existing imports
  pageTranscriptions,  // ← Added
} from '$stores';
```

### 2. Updated Button Text Logic
Now checks for **any** available transcriptions (page-specific or legacy):
```javascript
$: saveButtonText = (() => {
  if (isSavingToLogseq) return 'Saving...';
  // Check if any page has transcription available
  if ($hasPageTranscriptions || $hasTranscription) return 'Save to LogSeq (Strokes + Text)';
  return 'Save to LogSeq (Strokes)';
})();
```

### 3. Enhanced Save Logic
For each page being saved, the function now:

1. **Saves strokes** (as before with chunking)
2. **Checks for page-specific transcription** using the pageKey format
3. **Saves transcription if found**

```javascript
// Step 2: Check for page-specific transcription
const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${book}/P${page}`;
const pageTranscription = $pageTranscriptions.get(pageKey);

if (pageTranscription) {
  // Save page-specific transcription
  const transcriptionResult = await updatePageTranscription(
    book,
    page,
    pageTranscription,
    pageTranscription.strokeCount,
    host,
    token
  );
  // ... handle result
}
```

## Workflow

### Multi-Page Transcription Workflow
1. **Import strokes** from multiple pages
2. **Transcribe** → Creates page-specific transcriptions in `pageTranscriptions` Map
3. **Save to LogSeq** → Automatically saves both strokes AND transcriptions for each page

### Example Console Output
```
✓ Saved strokes to Smartpen Data/B3017/P42: 259 new, 259 total (2 chunks)
ℹ Saving transcription to Smartpen Data/B3017/P42...
✓ Saved transcription to Smartpen Data/B3017/P42 (8 lines)

✓ Saved strokes to Smartpen Data/B3017/P43: 1175 new, 1175 total (6 chunks)
ℹ Saving transcription to Smartpen Data/B3017/P43...
✓ Saved transcription to Smartpen Data/B3017/P43 (16 lines)

✓ Saved 2 page(s) with strokes and transcription
```

## LogSeq Page Structure

After saving, each page will have:

```
page:: Smartpen Data/B3017/P42
Book:: 3017
Page:: 42

## Raw Stroke Data
  - Metadata block
  - Stroke chunk 0
  - Stroke chunk 1

## Transcribed Text
  - Meeting notes
  - Action items
    - Review proposal
    - Schedule follow-up
```

## Backward Compatibility

The function maintains backward compatibility with the legacy single-transcription mode:

1. **Checks page-specific transcription first** (new behavior)
2. **Falls back to legacy transcription** if no page-specific one exists
3. **Validates page match** before saving legacy transcription

## Benefits

✅ **Automatic** - No manual steps needed  
✅ **Multi-page support** - Handles multiple pages with different transcriptions  
✅ **Backward compatible** - Works with both old and new transcription workflows  
✅ **Clear feedback** - Logs show exactly what was saved  
✅ **Smart detection** - Only saves transcription if it exists for that page  

## Testing

**Test Case 1: Multi-page transcription**
1. Import strokes from pages P42 and P43
2. Transcribe each page separately
3. Click "Save to LogSeq"
4. Verify both pages have strokes + transcription sections

**Test Case 2: Single page transcription**
1. Import strokes from one page
2. Transcribe
3. Click "Save to LogSeq"
4. Verify page has both strokes and transcription

**Test Case 3: No transcription**
1. Import strokes only
2. Click "Save to LogSeq"
3. Verify only strokes are saved (no transcription section)

## Files Modified
- `src/components/header/ActionBar.svelte` - Enhanced save logic with page-specific transcription support
