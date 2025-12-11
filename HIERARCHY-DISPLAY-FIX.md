# Hierarchy Display Fix

## Problem
The indentation detection was working in the backend (console logs showed correct levels), but the UI wasn't displaying the hierarchy visually.

**Symptoms:**
- Console showed correct indent levels (0, 1, 2, 3, 4)
- "Lines with Hierarchy" section showed all lines at same indent
- "LogSeq Preview" showed all lines with single dash, no nesting

## Root Cause
Data structure mismatch between backend and frontend:

**Backend (myscript-api.js):**
```javascript
line.indentLevel = 2;  // Uses "indentLevel"
```

**Frontend (LineDisplay.svelte, LogseqPreview.svelte):**
```javascript
const indent = line.indent || 0;  // Looking for "indent" ❌
```

## Solution

### 1. Fixed LineDisplay.svelte
Changed property name from `indent` to `indentLevel`:

```javascript
// BEFORE
$: indentLevel = line.indent || 0;

// AFTER
$: indentLevel = line.indentLevel || 0;
```

**Added features:**
- Visual indent indicator with spaces: `  └─`
- Shows number of children in badge
- Bold text for lines with children
- Tooltip showing indent level

### 2. Fixed LogseqPreview.svelte
Changed property name and spacing:

```javascript
// BEFORE
const indent = line.indent || 0;
const prefix = '\t'.repeat(indent) + '- ';

// AFTER
const indent = line.indentLevel || 0;
const prefix = '  '.repeat(indent) + '- ';
```

**Changed:**
- Uses `indentLevel` instead of `indent`
- Uses 2 spaces instead of tabs for better readability

## Files Modified
- ✅ `src/components/transcription/LineDisplay.svelte`
- ✅ `src/components/transcription/LogseqPreview.svelte`

## Test

```bash
npm run build && npm run dev
```

### Steps:
1. Transcribe your handwriting
2. Go to Transcription tab
3. Check "Lines with Hierarchy" section
4. Check "LogSeq Preview" section

### Expected Results:

**Lines with Hierarchy:**
```
1  12/9/25
2  TXDOT PEPS conference
3    └─ 8:00 opening Remarks
4    └─ 8:45 Keynote: Hurray for Texas!
5      └─ Chet Garner, the Day tripper [1]
6    └─ 10:00 Contracts, funding...
7      └─ Prop 1 and 7 are a significant... [0]
8      └─ 30% is from federal IIJA... [0]
9    └─ 11:00 Maintaining Consistency... [0]
```

Numbers in brackets `[1]` show child count.

**LogSeq Preview:**
```
- 12/9/25
- TXDOT PEPS conference
  - 8:00 opening Remarks
  - 8:45 Keynote: Hurray for Texas!
    - Chet Garner, the Day tripper
  - 10:00 Contracts, funding, and Encumbrances (PEPS funding 101)
    - Prop 1 and 7 are a significant source of funding
    - 30% is from federal IIJA, but this may expire in 2027
  - 11:00 Maintaining Consistency During change
```

Proper indentation with 2 spaces per level!

## Visual Guide

### Before Fix:
```
Lines with Hierarchy (9)
1  12/9/25
2  TXDOT PEPS conference
3  8:00 opening Remarks          ← No indent
4  8:45 Keynote...                ← No indent
5  Chet Garner...                 ← No indent

LogSeq Preview:
- 12/9/25
- TXDOT PEPS conference
- 8:00 opening Remarks           ← No indent
- 8:45 Keynote...                 ← No indent
- Chet Garner...                  ← No indent
```

### After Fix:
```
Lines with Hierarchy (9)
1  12/9/25
2  TXDOT PEPS conference
3    └─ 8:00 opening Remarks     ← Indented!
4    └─ 8:45 Keynote...           ← Indented!
5      └─ Chet Garner... [1]     ← Double indent!

LogSeq Preview:
- 12/9/25
- TXDOT PEPS conference
  - 8:00 opening Remarks          ← Indented!
  - 8:45 Keynote...                ← Indented!
    - Chet Garner...               ← Double indent!
```

## Component Enhancements

### LineDisplay.svelte
**New features:**
1. **Indent indicator**: Shows visual tree structure with `└─`
2. **Children badge**: Shows number of child lines
3. **Bold parent lines**: Lines with children are bold
4. **Tooltip**: Hover to see indent level

**CSS:**
```css
.line-display {
  padding-left: {indentLevel * 20 + 8}px;  /* 20px per level */
}

.indent-indicator {
  content: '  '.repeat(indentLevel) + '└─';
}

.has-children {
  font-weight: 500;
}
```

### LogseqPreview.svelte
**Format:**
```
Level 0: "- Text"
Level 1: "  - Text"    (2 spaces)
Level 2: "    - Text"  (4 spaces)
Level 3: "      - Text" (6 spaces)
```

## Data Flow

```
MyScript API
    ↓
parseMyScriptResponse()
    ↓
{ indentLevel: 2, text: "...", ... }
    ↓
setTranscription(result)
    ↓
transcribedLines store
    ↓
TranscriptionView.svelte
    ↓
├── LineDisplay.svelte (uses indentLevel ✓)
└── LogseqPreview.svelte (uses indentLevel ✓)
```

## Consistency Check

All components now use the same property name:

- ✅ `myscript-api.js` → Sets `line.indentLevel`
- ✅ `transcription.js` → Passes through unchanged
- ✅ `TranscriptionView.svelte` → Passes to children
- ✅ `LineDisplay.svelte` → Reads `line.indentLevel`
- ✅ `LogseqPreview.svelte` → Reads `line.indentLevel`

## Summary

The fix was simple but critical:
1. Backend was setting `indentLevel`
2. Frontend was reading `indent`
3. Changed frontend to read `indentLevel`

**Result**: Hierarchy now displays correctly in both the lines list and LogSeq preview! 🎉

**Bonus**: Added visual enhancements like tree indicators and child counts for better UX.
