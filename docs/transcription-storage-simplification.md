# Transcription Storage Simplification

**Date:** December 2024  
**Decision:** Remove Transcription Data JSON, keep only readable text in code block

---

## Rationale

### Why Remove Transcription Data JSON?

**It was redundant:**
- Raw strokes are the source of truth for re-processing
- Transcribed text contains the actual content
- Hierarchy is already visible in text indentation
- Commands can be parsed from text if needed later

**Better workflow:**
- Raw Strokes → Re-transcribe/render when needed
- Transcribed Text → Read/search/reference
- No intermediate JSON needed

---

## New Storage Structure

### Complete Page Format

```markdown
Book:: 3017
Page:: 42

- ## Raw Stroke Data
  collapsed:: true
  - ```json
    {
      "version": "1.0",
      "pageInfo": {...},
      "strokes": [...],
      "metadata": {...}
    }
    ```
    
- ## Transcribed Text
  - ```
    Meeting Notes
      Discussed Q1 roadmap
      Action items below
    ```
```

**That's it!** Just two sections:
1. Raw Stroke Data (for re-processing)
2. Transcribed Text (for reading)

---

## Benefits

### 1. **Simpler**
- Only essential data stored
- Less visual clutter
- Faster saves (fewer blocks)

### 2. **Clearer Purpose**
- Raw data = machine processing
- Text = human reading
- No ambiguity

### 3. **Better UX**
- Code block preserves indentation
- Monospace font for alignment
- Easy to copy/paste

---

## What Happens to Hierarchy?

**It's preserved in the text indentation:**

```
Meeting Notes
  Discussed Q1 roadmap
    Budget concerns
    Timeline issues
  Action items
```

The indentation already shows the hierarchy visually. If we need the structured data later, we can:
1. Parse the indented text
2. Re-transcribe from raw strokes
3. Use MyScript API again

---

## What Happens to Commands?

Commands like `[page: Meeting Notes]` are in the transcribed text:

```
[page: Meeting Notes]
  Discussed Q1 roadmap
```

If we implement command processing later:
1. Parse commands from the text
2. Or re-transcribe with command detection enabled

---

## Code Changes

### `logseq-api.js`

**Removed:**
- `buildTranscriptionStorageObject()` usage
- "Transcription Data" block creation
- JSON formatting for transcription

**Added:**
- Code block wrapper for text: `` ```\n${text}\n``` ``

**Result:**
```javascript
// Old - Two blocks (JSON + text)
'## Transcription Data' + JSON
'## Transcribed Text' + text

// New - One block (text only)
'## Transcribed Text' + '```\n' + text + '\n```'
```

---

## Migration

### Existing Pages

If you have pages with "Transcription Data" blocks:
- They won't be deleted automatically
- Next transcription will remove old blocks
- Only "Transcribed Text" will be saved

### Clean Up

To clean up old "Transcription Data" blocks manually:
1. Open page in LogSeq
2. Delete the "## Transcription Data" section
3. Or just re-transcribe and save (will auto-clean)

---

## Use Cases Covered

### ✅ Reading Notes
- Transcribed text is right there in code block
- Preserves indentation and formatting
- Easy to read and search

### ✅ Re-transcribing
- Raw strokes are still available
- Can re-run MyScript with different settings
- Can implement different parsing logic

### ✅ Rendering Strokes
- Raw stroke data has everything needed
- Can build renderer from stroke coordinates
- No need for transcription data

### ✅ Command Processing (Future)
- Parse commands from transcribed text
- Or re-transcribe with command detection
- No need to store intermediate JSON

---

## What We're NOT Losing

**Hierarchy:** Visible in indentation  
**Commands:** Present in text  
**Quality:** Can re-transcribe anytime  
**Metadata:** Raw strokes have all data  

**What we ARE losing:**
- MyScript confidence scores (rarely used)
- Processing time (diagnostic only)
- Pre-parsed command structures (can parse again)

**Worth it?** Yes - simpler is better!

---

## Example Page

### Before (Complex)
```markdown
Book:: 3017
Page:: 42

- ## Raw Stroke Data
  collapsed:: true
  - ```json
    {...}
    ```
- ## Transcription Data
  collapsed:: true
  - ```json
    {
      "engine": "myscript",
      "confidence": 0.92,
      "lines": [{...}],
      "commands": [{...}]
    }
    ```
- ## Transcribed Text
  - Meeting Notes
      Discussed roadmap
```

### After (Simple)
```markdown
Book:: 3017
Page:: 42

- ## Raw Stroke Data
  collapsed:: true
  - ```json
    {...}
    ```
- ## Transcribed Text
  - ```
    Meeting Notes
      Discussed roadmap
    ```
```

Much cleaner!

---

## Summary

**Storage Model:**
- **Raw Strokes** = Source of truth (JSON, collapsed)
- **Transcribed Text** = Human output (code block, expanded)

**Philosophy:**
- Keep what's essential
- Raw data for machines
- Clean text for humans

**Result:**
- ✅ Simpler code
- ✅ Cleaner pages
- ✅ Faster operations
- ✅ Same functionality

---

**Status:** ✅ Implemented and ready for testing
