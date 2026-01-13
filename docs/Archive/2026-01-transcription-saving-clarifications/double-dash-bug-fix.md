# Double Dash Bug Fix

**Date**: 2026-01-13  
**Issue**: Transcriptions being saved with duplicate dash prefixes (`- - text` instead of `- text`)

## Problem Description

When updating or appending transcriptions to LogSeq, each line was getting an extra `- ` prefix, resulting in:

```markdown
Incorrect:
- - 12/12/25
- - 8:00 Safety Meeting
-   - "Ergo"- work "Nomos"

Correct:
- 12/12/25
- 8:00 Safety Meeting
  - "Ergo"- work "Nomos"
```

## Root Causes

There were two issues causing this bug:

### Issue 1: LogSeq Block Prefix Inclusion

When reading block content from LogSeq's API, the block dash prefix was being included in the content string:

```javascript
// What we insert:
'```\n- 12/12/25\n```'

// What LogSeq may store:
'- ```\n- 12/12/25\n```'  // Block dash prefix included

// What we read back:
'- ```\n- 12/12/25\n```'  // Extra dash!
```

When the transcription was extracted and saved again, this extra dash caused double prefixes.

### Issue 2: Lost Indentation on Re-save

When transcription text was edited in the UI, the line reconstruction code was setting all lines to `indentLevel: 0`, which caused indented lines to lose their indentation and get re-formatted incorrectly.

## Solutions Implemented

### Fix 1: Strip Block Prefix When Reading (`logseq-api.js`)

```javascript
async function getExistingTranscription(book, page, host, token = '') {
  // ... code to get blocks ...
  
  // Extract text from code block
  let childContent = block.children[0].content;
  if (childContent) {
    // NEW: Strip LogSeq block dash prefix if present
    childContent = childContent.replace(/^-\s+/, '');
    
    // Remove code block markers
    const match = childContent.match(/```\n([\s\S]*)\n```/);
    if (match) {
      return match[1].trim();
    }
    return childContent.trim();
  }
}
```

**What it does**: Removes any leading `- ` from the block content before extracting the transcription text.

### Fix 2: Preserve Indentation When Reconstructing Lines (`PageCard.svelte`)

```javascript
function handleTranscriptionChange(event) {
  const newText = event.detail;
  
  // Parse lines from edited text and preserve indentation
  const lines = newText.split('\n').map((line, index) => {
    // Calculate indentation level from leading spaces
    // Each 2 spaces = 1 indent level
    const leadingSpaces = line.match(/^\s*/)[0].length;
    const indentLevel = Math.floor(leadingSpaces / 2);
    
    // Get the text without leading/trailing whitespace
    const trimmedText = line.trimStart();
    
    return {
      text: trimmedText,
      lineNumber: index,
      indentLevel: indentLevel,  // Now properly calculated!
      parent: null,
      children: []
    };
  });
  
  // Update store with new lines...
}
```

**What it does**: 
- Parses indentation from leading whitespace (2 spaces = 1 indent level)
- Stores trimmed text (without leading spaces)
- Preserves indentation level for proper reformatting

## How the Fix Works

### Complete Flow Example

**1. Initial Transcription (from MyScript)**
```javascript
Line object: {text: "12/12/25", indentLevel: 0}
            ↓
formatTranscribedText()
            ↓
Output: "- 12/12/25"
            ↓
Saved to LogSeq: ```
                 - 12/12/25
                 ```
```

**2. Reading Back from LogSeq**
```javascript
LogSeq block content: "- ```\n- 12/12/25\n```" (may include dash)
                     ↓
Strip leading dash: "```\n- 12/12/25\n```"
                     ↓
Extract from code block: "- 12/12/25"
                     ↓
Displayed in preview: "- 12/12/25" ✓
```

**3. User Edits and Saves**
```javascript
Edited text: "- 12/12/25"
           ↓
Parse line:
  - leadingSpaces: 0
  - indentLevel: 0
  - trimmedText: "- 12/12/25"
           ↓
Line object: {text: "- 12/12/25", indentLevel: 0}
           ↓
formatTranscribedText():
  - Check startsWithDash: true
  - Return: "" + "- 12/12/25" = "- 12/12/25" ✓
           ↓
Saved to LogSeq (no double dash!)
```

### Indented Lines Example

**1. Initial (from MyScript)**
```javascript
Line: {text: "Ergo definition", indentLevel: 1}
     ↓
Output: "  - Ergo definition"
```

**2. Read Back**
```javascript
Text: "  - Ergo definition"
```

**3. Parse After Edit**
```javascript
Line: "  - Ergo definition"
     ↓
Parse:
  - leadingSpaces: 2
  - indentLevel: 1
  - trimmedText: "- Ergo definition"
     ↓
Line object: {text: "- Ergo definition", indentLevel: 1}
```

**4. Save Again**
```javascript
formatTranscribedText():
  - indent: "  " (2 spaces for indentLevel 1)
  - text: "- Ergo definition"
  - startsWithDash: true
  - Return: "  " + "- Ergo definition" = "  - Ergo definition" ✓
```

## Key Design Principles

### 1. Separation of Concerns
- **Indentation**: Stored as `indentLevel` numeric value
- **Text content**: Stored trimmed (no leading/trailing spaces)
- **Formatting**: Applied by `formatTranscribedText()` when saving

### 2. Dash Detection Logic
```javascript
// In formatTranscribedText()
const startsWithDash = text.trimStart().startsWith('-');

if (startsWithDash) {
  // Already has dash - don't add another
  return indent + text.trimStart();
} else {
  // No dash - add one
  return indent + '- ' + text;
}
```

This prevents double dashes while allowing manual dash editing.

### 3. Whitespace Handling
- **Reading**: Trim after extracting from code block
- **Parsing**: Calculate indent level, then trim text
- **Formatting**: Add indent spaces back based on level

## Testing Verification

### Test Case 1: Basic Line
```
Initial:  {text: "Test", indentLevel: 0}
Format:   "- Test"
Save:     → LogSeq
Read:     "- Test" (dash stripped from block prefix)
Parse:    {text: "- Test", indentLevel: 0}
Re-save:  "- Test" ✓ (no double dash)
```

### Test Case 2: Indented Line
```
Initial:  {text: "Test", indentLevel: 2}
Format:   "    - Test" (4 spaces)
Save:     → LogSeq
Read:     "    - Test"
Parse:    {text: "- Test", indentLevel: 2}
Re-save:  "    - Test" ✓ (indentation preserved)
```

### Test Case 3: Multiple Updates
```
Save 1:   "- Test"     → LogSeq
Save 2:   "- Test" ✓   (not "- - Test")
Save 3:   "- Test" ✓   (not "- - - Test")
```

## Files Modified

1. **`src/lib/logseq-api.js`**
   - Modified `getExistingTranscription()` to strip block dash prefix
   
2. **`src/components/logseq-db/PageCard.svelte`**
   - Modified `handleTranscriptionChange()` to parse indentation correctly

## Benefits

- ✅ No more duplicate dash prefixes
- ✅ Indentation properly preserved across edits
- ✅ Works for unlimited update cycles
- ✅ Compatible with manual text editing
- ✅ Maintains LogSeq markdown structure

## Edge Cases Handled

1. **Manual dash editing**: User can add/remove dashes manually - detected correctly
2. **Mixed indentation**: Different indent levels handled properly
3. **Empty lines**: Handled gracefully (0 spaces = indent level 0)
4. **Trailing spaces**: Trimmed during parsing
5. **Multiple re-saves**: No accumulation of dashes
