# Line Detection and Indentation Algorithm

## Overview

This document explains how the SmartPen-LogSeq Bridge determines line boundaries and calculates indentation levels from handwritten text recognized by MyScript.

## Key Insight: Trust MyScript's Line Detection

MyScript's handwriting recognition engine already performs sophisticated line detection using:
- Stroke timing and pen lifts
- Spatial analysis of the entire page
- Machine learning models trained on handwriting

**We trust MyScript's line breaks (the `\n` characters in the `label` field) rather than trying to re-calculate lines from bounding boxes.**

### Why Not Re-Calculate Lines?

Our previous approach sorted all words by Y position and grouped them. This failed because:

1. **Capital letters have higher tops** - "The" vs "the" have different top Y
2. **Descenders extend below baseline** - Words with g, j, p, q, y are taller
3. **Handwriting slant** - The page might not be perfectly level
4. **Small variations** - Natural handwriting wobbles

MyScript has access to timing data, stroke order, and pen-lift information that we don't have access to in the bounding boxes alone.

## Algorithm Steps

### Step 1: Parse MyScript Response

MyScript returns:
```javascript
{
  label: "Line 1\nLine 2\nLine 3",  // Text with line breaks!
  words: [
    { label: "Line", "bounding-box": {x, y, width, height} },
    { label: "1", "bounding-box": {...} },
    // ... more words
  ]
}
```

### Step 2: Build Lines from Label

We split the `label` by `\n` to get MyScript's detected lines:

```javascript
const lineTexts = label.split('\n').filter(line => line.trim() !== '');
// ["Line 1", "Line 2", "Line 3"]
```

### Step 3: Match Words to Lines

For each line text, we find which words belong to it:

```javascript
matchWordsToLine(lineText, availableWords) {
  const matchedWords = [];
  const normalizedLine = lineText.toLowerCase();
  
  for (const word of availableWords) {
    if (normalizedLine.includes(word.text.toLowerCase())) {
      matchedWords.push(word);
    }
  }
  
  return matchedWords;
}
```

Words are removed from the available pool once matched to prevent double-assignment.

### Step 4: Calculate Line Position

Once words are matched to a line, we calculate position from their bounding boxes:

```javascript
{
  text: "Line 1",
  words: [word1, word2],
  x: Math.min(...words.map(w => w.boundingBox.x)),  // Leftmost word
  baseline: average(words.map(w => w.boundingBox.y + w.boundingBox.height))
}
```

### Step 5: Detect Indentation

Indentation is calculated from X positions:

```javascript
detectIndentation(lines, metrics) {
  const baseX = Math.min(...lines.map(l => l.x));  // Leftmost line
  
  return lines.map(line => ({
    ...line,
    indentPixels: line.x - baseX,
    indentLevel: Math.round((line.x - baseX) / metrics.indentUnit)
  }));
}
```

### Step 6: Calculate Indent Unit Dynamically

Instead of a fixed indent unit, we calculate it from the actual data:

```javascript
calculateLineMetricsFromLines(lines) {
  // Get smallest significant X difference between lines
  const xPositions = lines.map(l => l.x).sort();
  const baseX = xPositions[0];
  
  const xDiffs = xPositions
    .map(x => x - baseX)
    .filter(diff => diff > medianWordHeight * 0.5);
  
  // Smallest significant difference = 1 indent level
  const indentUnit = xDiffs.length > 0 ? xDiffs[0] : medianWordHeight * 2;
}
```

### Step 7: Build Line Hierarchy

Parent/child relationships are built from indentation:

```javascript
buildLineHierarchy(lines) {
  for (let i = 1; i < lines.length; i++) {
    // Look backwards for a parent (lower indent level)
    for (let j = i - 1; j >= 0; j--) {
      if (lines[j].indentLevel < lines[i].indentLevel) {
        lines[i].parent = j;
        lines[j].children.push(i);
        break;
      }
    }
  }
}
```

## Data Structure

Each parsed line contains:

```javascript
{
  // Content (from MyScript's label)
  text: "The recognized text",
  words: [...],              // Matched word objects with positions
  
  // Position (calculated from matched words)
  x: 25.5,                   // Leftmost word X position
  baseline: 142.3,           // Average baseline of words
  
  // Indentation
  indentLevel: 1,            // Calculated indent level (0, 1, 2, ...)
  indentPixels: 15.2,        // Raw pixel offset from leftmost line
  
  // Hierarchy (for command scope)
  lineIndex: 3,              // Position in lines array
  parent: 1,                 // Index of parent line (or null)
  children: [4, 5]           // Indices of child lines
}
```

## Handling Edge Cases

### Duplicate Words

If a word appears multiple times across lines (e.g., "the"), we use Y-position clustering to determine which instance belongs to which line.

### Unmatched Words

Words that don't match any line text are logged for debugging. This can happen if MyScript's word-level and character-level recognition differ slightly.

### No Position Data

If a line has no matched words with bounding boxes, we use the line index as a fallback for baseline ordering.

## Command Scope

The hierarchy enables commands like `[page: Meeting Notes]` to affect descendant lines:

```javascript
// Get all lines affected by a command on line 1
const affected = api.getDescendants(lines, 1);
// Returns: [1, 2, 3] - the line with the command plus all children

// Apply command to all affected lines
affected.forEach(idx => {
  lines[idx].page = "Meeting Notes";
});
```

## Tuning Parameters

If indentation detection isn't working well:

| Symptom | Adjustment |
|---------|------------|
| Too many indent levels | Increase indent unit minimum multiplier |
| Too few indent levels | Decrease indent unit calculation |
| Wrong parent/child | Check if lines are in correct order |

## Comparison: Old vs New Approach

### Old Approach (Baseline Grouping)
- Sorted all words by Y position
- Grouped words within threshold
- ❌ Scrambled words from different lines

### New Approach (Trust MyScript)
- Uses `\n` in label for line breaks
- Matches words to lines by text
- ✅ Preserves MyScript's intelligent detection

## Future Improvements

1. **Interactive line adjustment** - Let users correct line assignments
2. **Better word matching** - Handle punctuation and spacing differences
3. **Learn from corrections** - Improve matching over time
