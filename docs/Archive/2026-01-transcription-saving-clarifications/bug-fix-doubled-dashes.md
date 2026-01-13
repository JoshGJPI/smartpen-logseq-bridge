# Bug Fix: Doubled Dashes in Transcription

**Date**: 2026-01-13  
**Issue**: Transcription bullet points were being doubled when saved to LogSeq

## Problem

When transcribing handwritten bullet journal entries, MyScript would correctly recognize the handwritten dashes and include them in the transcribed text:

```
- 12/12/25
- 8:00 Safety Meeting
  - Subtopic here
```

However, the `formatTranscribedText()` function was blindly adding another dash to every line:

```javascript
// OLD CODE
return lines.map(line => {
  const indent = '  '.repeat(line.indentLevel || 0);
  const dash = '- ';
  return indent + dash + line.text;  // Always adds dash!
}).join('\n');
```

This resulted in doubled dashes:

```
- - 12/12/25
- - 8:00 Safety Meeting
  - - Subtopic here
```

## Root Cause

MyScript's handwriting recognition is smart enough to recognize bullet points and includes them as part of the transcribed text. The app was then adding *another* dash for LogSeq's block formatting, not realizing the dash was already there.

## Solution

Updated `formatTranscribedText()` to detect if a line already starts with a dash before adding formatting:

```javascript
// NEW CODE
return lines.map(line => {
  const indent = '  '.repeat(line.indentLevel || 0);
  const text = line.text;
  
  // Check if the line already starts with a dash
  const startsWithDash = text.trimStart().startsWith('-');
  
  if (startsWithDash) {
    // Line already has a dash, just add indentation
    return indent + text.trimStart();
  } else {
    // Line doesn't have a dash, add one
    return indent + '- ' + text;
  }
}).join('\n');
```

## How It Works

1. **Check for existing dash**: Uses `trimStart().startsWith('-')` to detect if the line already begins with a dash (after trimming whitespace)

2. **Conditional formatting**:
   - **Has dash**: Only add indentation, use existing dash
   - **No dash**: Add both indentation and a new dash

3. **Trim whitespace**: Uses `trimStart()` to remove any leading spaces from MyScript's output before adding our controlled indentation

## Examples

### Input from MyScript
```
- Meeting notes
  - Subtopic 1
Regular text without dash
    - Deep nested item
```

### Output (correctly formatted)
```
- Meeting notes
  - Subtopic 1
- Regular text without dash
    - Deep nested item
```

## Edge Cases Handled

✅ **Lines with existing dash**: No doubling  
✅ **Lines without dash**: Dash added automatically  
✅ **Mixed content**: Each line handled independently  
✅ **Indented items**: Indentation preserved correctly  
✅ **Whitespace**: Leading spaces normalized

## Testing

Confirmed with the user's example:

**Input (from MyScript)**:
```
- 12/12/25
- 8:00 Safety Meeting- Ergonomics
  - "Ergo"- work "Nomos" - Laws fitting the job to the worker
  - 50lbs is typically the max you can lift on your own
```

**Output (saved to LogSeq)**: ✅ Correct formatting, no doubled dashes

## Files Changed

- `src/lib/stroke-storage.js` - Updated `formatTranscribedText()` function

## Related

- Original issue discovered during transcription editing feature testing
- Part of the transcription save improvements (v0.2.0+)
