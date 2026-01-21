# Live Transcript Blocks - Executive Summary (Updated)

**Version:** 0.2.0  
**Updated:** January 2025 (simplified properties + checkbox preservation)

---

## Quick Reference

### Properties Schema (Simplified)

```javascript
{
  "stroke-y-bounds": "1234.56-1289.34",        // Y-coordinate range
  "canonical-transcript": "[ ] Review mockups" // Normalized MyScript output
}
```

**Removed properties:**
- ❌ `stroke-count` - Not needed for update detection
- ❌ `last-transcribed` - Timestamp not used
- ❌ `transcription-version` - Unnecessary for simple schema

---

## Critical Feature: Checkbox Preservation

### The Problem

```
User writes: ☐ Task
Create block: "TODO Task"
User checks off: "DONE Task"
Re-transcribe: MyScript returns "☐ Task" again
Naive update: Overwrites "DONE" → "TODO" 😱
```

### The Solution

Store **canonical transcript** (normalized MyScript output) separately from user-editable content:

```javascript
// LogSeq block
{
  content: "DONE Task #urgent @john",  // User can edit freely
  properties: {
    "canonical-transcript": "[ ] Task"  // Compare against this
  }
}
```

**Update logic:**
- Compare new transcript against `canonical-transcript`
- If match → SKIP (preserve user edits)
- If different → UPDATE (try to preserve markers)

---

## Update Scenarios

### Scenario 1: User Checks Task

```
Strokes unchanged, MyScript returns "☐ Task"
Canonical: "[ ] Task" (unchanged)
Block: "DONE Task" (user changed)
→ Canonical match → SKIP update ✅
→ User's DONE preserved ✅
```

### Scenario 2: New Strokes Added

```
Old strokes: "☐ Task"
New strokes: "☐ Task - update mockups"
Canonical: "[ ] Task" → "[ ] Task - update mockups" (changed!)
Block: "DONE Task"
→ Canonical different → UPDATE needed
→ Preservation logic: "DONE Task - update mockups" ✅
```

### Scenario 3: User Adds Tags

```
Strokes unchanged, MyScript returns "☐ Task"
Canonical: "[ ] Task" (unchanged)
Block: "TODO Task #urgent @john" (user added tags)
→ Canonical match → SKIP update ✅
→ User's tags preserved ✅
```

---

## Checkbox Normalization

### Input → Canonical

```javascript
function normalizeTranscript(text) {
  return text
    .replace(/☐/g, '[ ]')   // Empty checkbox
    .replace(/☑/g, '[x]')   // Checked
    .replace(/☒/g, '[x]')   // Checked (alt)
    .replace(/\s+/g, ' ')   // Normalize spaces
    .trim();
}
```

### Canonical → LogSeq Markers

```javascript
"[ ] Task"     → "TODO Task"
"[x] Task"     → "DONE Task"
"Regular text" → "Regular text"
```

---

## LogSeq Block Operations

### Creating Blocks

```javascript
await makeRequest(host, token, 'logseq.Editor.insertBlock', [
  parentUuid,
  "TODO Review mockups",  // Content
  {
    sibling: false,
    properties: {
      'stroke-y-bounds': '1234.5-1289.3',
      'canonical-transcript': '[ ] Review mockups'
    }
  }
]);
```

### Updating Blocks

**Separate operations for content and properties:**

```javascript
// 1. Update content
await makeRequest(host, token, 'logseq.Editor.updateBlock', [
  blockUuid,
  newContent
]);

// 2. Upsert properties (preserves other properties)
await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
  blockUuid,
  'stroke-y-bounds',
  '1234.5-1300.0'
]);

await makeRequest(host, token, 'logseq.Editor.upsertBlockProperty', [
  blockUuid,
  'canonical-transcript',
  '[ ] Task - updated'
]);
```

**Why separate?**
- `updateBlock` replaces content
- `upsertBlockProperty` preserves other properties user may have added
- This ensures we only touch what we need to

---

## Implementation Summary

### New Files

**`lib/transcript-updater.js`:**
- `updateTranscriptBlocks()` - Main orchestrator
- `detectBlockActions()` - CREATE/UPDATE/SKIP logic
- `normalizeTranscript()` - Checkbox normalization

### Modified Files

**`myscript-api.js`:**
- Add `canonical` field to line objects
- Add `normalizeTranscript()` helper

**`logseq-api.js`:**
- `createTranscriptBlockWithProperties()` - Create with both properties
- `updateTranscriptBlockWithPreservation()` - Update content + properties
- `convertCheckboxToMarker()` - ☐ → TODO, ☑ → DONE
- `updateBlockWithPreservation()` - Preserve TODO/DONE when possible

**`stores/transcription.js`:**
- Add `canonical` to line type
- Add `blockUuid` for tracking

---

## Key Improvements Over v0.1.0

1. **Simplified properties** - Only 2 properties instead of 5
2. **Checkbox preservation** - User edits never lost
3. **Clear update logic** - Compare canonical forms, not final content
4. **Proper API usage** - Separate content/property updates
5. **Marker preservation** - Try to keep TODO/DONE during updates

---

## Testing Priority

### Must Test

1. **Checkbox workflow:**
   - Write ☐ Task → transcribe → check off → re-transcribe → verify DONE preserved

2. **Tag addition:**
   - Write Task → transcribe → add #tags → re-transcribe → verify tags preserved

3. **Typo correction:**
   - Write Taks → transcribe → fix to Task → re-transcribe → verify fix preserved

4. **Incremental addition:**
   - Write Task → transcribe → add " - details" → transcribe → verify update works

### Edge Cases

- Very tight handwriting (overlapping Y-bounds)
- Multiple checkbox variants (☐, ☑, ☒)
- Mixed content (some with checkboxes, some without)
- Long blocks with many properties

---

## Migration Path

1. Scan for pages with old code block format
2. Re-transcribe to get canonical forms
3. Create live blocks with canonical-transcript property
4. Archive old code block
5. Validate all text preserved

**Important:** Block content may differ from canonical after migration if user previously edited. This is expected.

---

## Next Steps

1. Implement `normalizeTranscript()` in `myscript-api.js`
2. Implement `createTranscriptBlockWithProperties()` in `logseq-api.js`
3. Implement `updateTranscriptBlocks()` in new `transcript-updater.js`
4. Add checkbox parsing logic
5. Test with real handwriting samples
6. Build migration tool

---

**Full details:** See [live-transcript-blocks-spec-v2.md](./live-transcript-blocks-spec-v2.md)
