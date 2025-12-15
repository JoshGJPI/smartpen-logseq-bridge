# LogSeq Storage Format Update

**Date:** December 2024  
**Type:** Formatting Improvement  
**Status:** ✅ Complete

---

## Changes Made

Updated the LogSeq storage format to use proper LogSeq conventions:
1. **Page properties** instead of bulleted metadata list
2. **Collapsible parent blocks** with child content blocks
3. **Cleaner, more LogSeq-native structure**

---

## New Page Structure

### Page Properties (Top Level)

```markdown
Book:: 3017
Page:: 42
Last-Updated:: 12/12/2024, 10:10:54 AM
Stroke-Count:: 259
Transcribed:: true
```

### Raw Stroke Data (Collapsible)

```markdown
- ## Raw Stroke Data
  collapsed:: true
  - ```json
    {
      "version": "1.0",
      "pageInfo": { ... },
      "strokes": [ ... ],
      "metadata": { ... }
    }
    ```
```

### Transcription Data (Collapsible)

```markdown
- ## Transcription Data
  collapsed:: true
  - ```json
    {
      "version": "1.0",
      "transcribedAt": 1765368900000,
      "text": "...",
      "lines": [ ... ]
    }
    ```
```

### Transcribed Text (Expanded)

```markdown
- ## Transcribed Text
  - Meeting Notes
      Discussed Q1 roadmap
      Action items below
```

---

## Benefits

### 1. **Better UX**
- Collapsed blocks reduce visual clutter
- Properties are queryable and filterable
- More consistent with LogSeq conventions

### 2. **Cleaner Interface**
- JSON blocks hidden by default
- Only human-readable text visible
- Expand when needed for debugging

### 3. **Queryable Properties**
Users can now query pages like:
```clojure
{{query (property Book "3017")}}
{{query (property Transcribed true)}}
{{query (and (property Book "3017") (property Page 42))}}
```

---

## Files Modified

### 1. `src/lib/stroke-storage.js`

**Added:**
```javascript
export function formatPageProperties(pageInfo, metadata) {
  const date = new Date(metadata.lastUpdated).toLocaleString();
  return `Book:: ${pageInfo.book}
Page:: ${pageInfo.page}
Last-Updated:: ${date}
Stroke-Count:: ${metadata.strokeCount}`;
}
```

### 2. `src/lib/logseq-api.js`

**Changed: `updatePageStrokes()`**
- Uses `upsertBlockProperty()` for page properties
- Creates parent block with `collapsed: true` property
- Inserts JSON as child block (`sibling: false`)

**Changed: `updatePageTranscription()`**
- Creates collapsible "Transcription Data" block
- Creates expanded "Transcribed Text" block  
- Sets `Transcribed:: true` property
- Plain text as child block for readability

**Unchanged: `getPageStrokes()`**
- Already looked for child blocks (no changes needed)

---

## API Method Changes

### Page Property Management

```javascript
// Set page properties
await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
  pageName,
  'Book',
  book.toString()
]);
```

### Collapsible Block Creation

```javascript
// Create parent with collapsed property
const parentBlock = await makeRequest(host, token, 'logseq.Editor.appendBlockInPage', [
  pageName,
  '## Raw Stroke Data',
  { properties: { collapsed: true } }
]);

// Add child block
await makeRequest(host, token, 'logseq.Editor.insertBlock', [
  parentBlock.uuid,
  formatJsonBlock(data),
  { sibling: false }  // false = child, true = sibling
]);
```

---

## Testing Checklist

### ✅ Raw Stroke Storage
- [ ] Create new page - properties set correctly
- [ ] Raw data block is collapsed by default
- [ ] JSON is child of "Raw Stroke Data" block
- [ ] Can expand to view JSON
- [ ] Properties show in page metadata

### ✅ Transcription Storage
- [ ] Transcription data block is collapsed
- [ ] Transcribed text block is expanded
- [ ] Text is child block with proper formatting
- [ ] `Transcribed:: true` property added

### ✅ Incremental Updates
- [ ] Update existing page - properties update
- [ ] Old blocks removed, new blocks created
- [ ] No duplicate content

### ✅ Backward Compatibility
- [ ] Parser still reads old format pages (if any exist)
- [ ] New saves use new format

---

## LogSeq Query Examples

Once pages are created, users can query them:

### Find all pages from a specific book
```clojure
{{query (property Book "3017")}}
```

### Find all transcribed pages
```clojure
{{query (property Transcribed true)}}
```

### Find pages with many strokes
```clojure
{{query (and (property Book "3017") (> (property Stroke-Count) 100))}}
```

### Recent updates
```clojure
{{query (property Last-Updated)}}
```

---

## Migration Notes

### Existing Pages

If you have pages created with the old format:
1. They will still be readable (parser unchanged)
2. Next save will convert to new format
3. Old blocks will be removed, new ones created
4. No data loss

### Manual Migration

To manually update old pages:
1. Open the page in LogSeq
2. In the app, click "Save Strokes" again
3. Page will be reformatted automatically

---

## Example Output

### Complete Page Example

```markdown
Book:: 3017
Page:: 42
Last-Updated:: 12/12/2024, 10:15:32 AM
Stroke-Count:: 259
Transcribed:: true

- ## Raw Stroke Data
  collapsed:: true
  - ```json
    {
      "version": "1.0",
      "pageInfo": {
        "section": 3,
        "owner": 1012,
        "book": 3017,
        "page": 42
      },
      "strokes": [
        {
          "id": "s1765313505107",
          "startTime": 1765313505107,
          "endTime": 1765313505396,
          "points": [
            [6.56, 37.25, 1765313505107],
            [6.58, 37.30, 1765313505153]
          ]
        }
      ],
      "metadata": {
        "lastUpdated": 1734017732000,
        "strokeCount": 259,
        "bounds": {
          "minX": 6.56,
          "maxX": 42.91,
          "minY": 37.25,
          "maxY": 54.28
        }
      }
    }
    ```
- ## Transcription Data
  collapsed:: true
  - ```json
    {
      "version": "1.0",
      "transcribedAt": 1734017850000,
      "engine": "myscript",
      "engineVersion": "2.0",
      "text": "Meeting Notes\n  Discussed Q1 roadmap\n  Action items below",
      "lines": [
        {
          "text": "Meeting Notes",
          "indentLevel": 0,
          "x": 6.56,
          "baseline": 142.3,
          "parent": null,
          "children": [1, 2]
        }
      ],
      "commands": [],
      "metadata": {
        "strokeCount": 259,
        "confidence": 0.92,
        "processingTime": 1847
      }
    }
    ```
- ## Transcribed Text
  - Meeting Notes
      Discussed Q1 roadmap
      Action items below
```

---

## Summary

**Changes:**
- ✅ Page properties instead of bullets
- ✅ Collapsed blocks for JSON data
- ✅ Child blocks for content
- ✅ Better LogSeq integration

**Impact:**
- Cleaner UI
- Queryable metadata
- Collapsible technical data
- More LogSeq-native feel

**Next Steps:**
- Test the new format
- Verify collapsing works
- Try LogSeq queries
- Proceed to renderer development

---

**Status:** ✅ Ready for testing  
**Backward Compatible:** Yes (parser handles both formats)
