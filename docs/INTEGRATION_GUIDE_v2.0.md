# Quick Integration Guide: v2.0 Transcription

## Basic Usage

### 1. Import the New Updater

```javascript
import { updateTranscriptBlocks } from './lib/transcript-updater.js';
import { updatePageStrokes } from './lib/logseq-api.js';
```

### 2. Save Strokes First (Same as Before)

```javascript
// Save strokes to LogSeq
const strokeResult = await updatePageStrokes(book, page, strokes, host, token);

if (!strokeResult.success) {
  console.error('Failed to save strokes:', strokeResult.error);
  return;
}
```

### 3. Update Transcription (NEW METHOD)

```javascript
// NEW: Use v2.0 method with property-based blocks
const transcriptResult = await updateTranscriptBlocks(
  book,
  page,
  strokes,           // Pass all strokes for Y-bounds calculation
  transcription,     // MyScript result with lines array
  host,
  token
);

if (transcriptResult.success) {
  console.log('Transcription updated:', transcriptResult.stats);
  // { created: 5, updated: 2, skipped: 3, merged: 0, errors: 0 }
} else {
  console.error('Failed to update transcription:', transcriptResult.error);
}
```

### 4. Display Results to User

```javascript
const { stats } = transcriptResult;

if (stats.created > 0) {
  console.log(`✨ Created ${stats.created} new blocks`);
}

if (stats.updated > 0) {
  console.log(`📝 Updated ${stats.updated} blocks`);
}

if (stats.skipped > 0) {
  console.log(`✅ Preserved ${stats.skipped} blocks (your edits kept)`);
}

if (stats.errors > 0) {
  console.warn(`⚠️ ${stats.errors} blocks failed to update`);
}
```

---

## Finding the Code to Change

### Likely Location 1: Transcription Component

Look for code that calls `updatePageTranscription()`:

```javascript
// OLD CODE (find this)
await updatePageTranscription(book, page, transcription, strokeCount, host, token);
```

Replace with:

```javascript
// NEW CODE (v2.0)
await updateTranscriptBlocks(book, page, strokes, transcription, host, token);
```

### Likely Location 2: Save/Import Functions

Search for:
- `updatePageTranscription`
- `sendToLogseq`
- Any function handling transcription saves

---

## Complete Example

```javascript
async function savePageToLogSeq(book, page, strokes, transcription, host, token) {
  try {
    // Step 1: Save strokes
    console.log('Saving strokes...');
    const strokeResult = await updatePageStrokes(book, page, strokes, host, token);
    
    if (!strokeResult.success) {
      throw new Error(`Failed to save strokes: ${strokeResult.error}`);
    }
    
    console.log(`✅ Strokes saved: ${strokeResult.added} added, ${strokeResult.deleted} deleted`);
    
    // Step 2: Save transcription (v2.0 method)
    if (transcription && transcription.lines && transcription.lines.length > 0) {
      console.log('Saving transcription...');
      const transcriptResult = await updateTranscriptBlocks(
        book,
        page,
        strokes,
        transcription,
        host,
        token
      );
      
      if (!transcriptResult.success) {
        throw new Error(`Failed to save transcription: ${transcriptResult.error}`);
      }
      
      const { stats } = transcriptResult;
      console.log(`✅ Transcription saved: ${stats.created} created, ${stats.updated} updated, ${stats.skipped} preserved`);
      
      return {
        success: true,
        page: transcriptResult.page,
        strokeStats: {
          added: strokeResult.added,
          deleted: strokeResult.deleted,
          total: strokeResult.total
        },
        transcriptStats: stats
      };
    }
    
    return {
      success: true,
      page: strokeResult.page,
      strokeStats: {
        added: strokeResult.added,
        deleted: strokeResult.deleted,
        total: strokeResult.total
      }
    };
    
  } catch (error) {
    console.error('Failed to save page:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
```

---

## Compatibility

### v2.0 (New) vs v1.0 (Old)

| Feature | v1.0 (Old) | v2.0 (New) |
|---------|-----------|-----------|
| Format | Code block with plain text | Individual blocks with properties |
| Checkbox | Text only | TODO/DONE markers |
| User edits | Lost on re-transcribe | Preserved automatically |
| Updates | Full replacement | Incremental (CREATE/UPDATE/SKIP) |
| LogSeq features | None | Full (tags, queries, etc.) |

### Can I Use Both?

Yes! The systems are independent:
- Old pages keep working with code blocks
- New transcriptions use property-based blocks
- No automatic migration (you can re-transcribe to upgrade)

---

## Troubleshooting

### Issue: Blocks Not Being Created

Check that:
1. Page has "Raw Stroke Data" section (save strokes first)
2. Transcription has `canonical` field in lines
3. LogSeq HTTP API is running

### Issue: All Blocks Being Created (None Skipped)

Check that:
1. Existing blocks have `canonical-transcript` property
2. Y-bounds are being calculated correctly
3. Canonical normalization is working (☐ → [ ])

### Issue: Y-Bounds Not Matching

The Y-bounds calculation uses word bounding boxes from MyScript. If words are missing or sparse, bounds may be inaccurate. This is a known limitation.

Workaround: Use wider overlap tolerance (future enhancement)

---

## Testing

### Test Case 1: First Transcription
1. Write on paper
2. Capture strokes
3. Transcribe
4. Save to LogSeq
5. Verify: All blocks created with properties

### Test Case 2: User Edits Preserved
1. Open existing page in LogSeq
2. Check off a TODO task
3. Add tags to another line
4. Fix a typo in a third line
5. Re-transcribe same strokes in app
6. Save to LogSeq
7. Verify: DONE status kept, tags kept, typo fix kept

### Test Case 3: Incremental Update
1. Start with existing transcription
2. Add more handwriting on same page
3. Re-transcribe
4. Save to LogSeq
5. Verify: Old blocks untouched, new blocks created

---

## Performance

### Expected Behavior

- **Small updates** (< 10 lines): Instant
- **Medium updates** (10-50 lines): 1-3 seconds
- **Large updates** (50+ lines): 3-10 seconds

### Bottlenecks

1. **Block creation** - Sequential API calls (0.1-0.2s each)
2. **Property updates** - 3 calls per update (content + 2 properties)
3. **Block retrieval** - One call per page

### Future Optimization

- Batch property updates
- Parallel block creation for independent blocks
- Cache existing blocks

---

## Next Steps

1. **Find the save function** - Search for `updatePageTranscription` or `sendToLogseq`
2. **Replace with new code** - Use `updateTranscriptBlocks` instead
3. **Test with one page** - Try with existing page first
4. **Add UI feedback** - Show the stats to user
5. **Roll out gradually** - Keep old method as fallback initially

---

Questions? Check:
- Full spec: `docs/Proposals/live-transcript-blocks-spec-v2.md`
- Implementation: `docs/IMPLEMENTATION_SUMMARY_v2.0.md`
- Visual guide: `docs/Proposals/live-transcript-blocks-visual-v2.md`
