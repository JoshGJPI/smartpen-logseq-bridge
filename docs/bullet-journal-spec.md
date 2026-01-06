# Bullet Journal Symbol Detection - Technical Specification

**Version:** 1.0.0  
**Status:** Proposed  
**Last Updated:** January 2026  
**Related Documents:** 
- [App Specification](./app-specification.md)
- [Line Detection Algorithm](./line-detection-algorithm.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Bullet Journal Primer](#bullet-journal-primer)
3. [Architecture](#architecture)
4. [Shape Detection Algorithms](#shape-detection-algorithms)
5. [Symbol-to-Line Matching](#symbol-to-line-matching)
6. [State Detection](#state-detection)
7. [Integration Points](#integration-points)
8. [Implementation Phases](#implementation-phases)
9. [Testing Strategy](#testing-strategy)
10. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

Extend the SmartPen-LogSeq Bridge to automatically detect and interpret bullet journal symbols (checkboxes, circles, dashes) in handwritten notes, enabling seamless conversion to LogSeq's native task management format.

### Goals

1. **Detect bullet journal symbols** with high accuracy (>90% for well-formed shapes)
2. **Match symbols to transcribed text lines** using spatial proximity analysis
3. **Preserve user intent** - translate handwritten symbols to LogSeq TODO/DONE/etc.
4. **Maintain existing workflows** - this is an optional enhancement, not a breaking change
5. **Provide visual feedback** - show detected symbols on canvas for verification

### Non-Goals

- Handwriting style training (use MyScript's existing recognition)
- Custom bullet symbol creation (start with standard BuJo symbols)
- Real-time detection during writing (post-transcription analysis only)
- Automatic task scheduling/migration (LogSeq handles this)

---

## Bullet Journal Primer

### Standard Symbols

The official Bullet Journal method uses three primary symbols:

| Symbol | Name | Purpose | Handwritten Appearance |
|--------|------|---------|----------------------|
| `•` | Task (Dot) | Actionable item | Small filled circle or dot |
| `☐` | Task (Box) | Alternative task representation | Hand-drawn square/rectangle |
| `○` | Event | Date-specific occurrence | Open circle |
| `–` | Note | Observation, idea, fact | Horizontal dash or line |

### Task States

Tasks can have multiple states indicated by modifying the symbol:

| State | Visual Representation | LogSeq Equivalent |
|-------|----------------------|-------------------|
| Open | `☐` Empty box | `TODO` |
| Complete | `☑` Filled/crossed box | `DONE` |
| Migrated | `☐→` Box with arrow | `LATER` |
| Scheduled | `☐<` Box with arrow left | `SCHEDULED` |
| Cancelled | `☐/` Box with strike | `CANCELLED` |

### Signifiers (Optional Phase 2)

Additional context markers that appear **before** the bullet:

- `!` Priority/urgent
- `*` Inspiration/important  
- `$` Expense tracking
- Custom user-defined

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Transcription Pipeline                    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  BulletJournalDetector                       │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  1. Shape Classification (analyzeSymbols)             │  │
│  │     • Rectangle detection (checkbox)                  │  │
│  │     • Circle detection (event)                        │  │
│  │     • Dash detection (note)                           │  │
│  │     • Dot detection (task)                            │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  2. Symbol-to-Line Matching (matchToLines)           │  │
│  │     • Spatial proximity analysis                      │  │
│  │     • Y-axis alignment (same baseline)                │  │
│  │     • X-axis ordering (symbol before text)            │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  3. State Detection (optional)                        │  │
│  │     • Analyze overlapping strokes                     │  │
│  │     • Classify completion patterns                    │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Enhanced Line Objects
                    (with bullet metadata)
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    LogSeq Export                             │
│  • Format as TODO/DONE/etc.                                  │
│  • Add signifier tags                                        │
│  • Preserve hierarchy                                        │
└─────────────────────────────────────────────────────────────┘
```

### Data Flow

```javascript
// INPUT: Raw strokes + MyScript transcription
{
  strokes: [/* stroke objects */],
  lines: [
    { text: "Review budget", x: 25.5, baseline: 10.2 },
    { text: "Team meeting", x: 25.3, baseline: 20.8 }
  ]
}

// AFTER DETECTION: Enhanced lines
{
  lines: [
    { 
      text: "Review budget", 
      x: 25.5, 
      baseline: 10.2,
      bullet: {
        type: 'task',           // task | event | note
        state: 'open',          // open | done | migrated | cancelled
        symbol: 'checkbox',     // checkbox | dot | circle | dash
        confidence: 0.92,       // 0-1 detection confidence
        strokeIndices: [3],     // Which strokes form this symbol
        position: { x: 15.2, y: 10.5 }
      }
    },
    { 
      text: "Team meeting", 
      x: 25.3, 
      baseline: 20.8,
      bullet: {
        type: 'event',
        state: 'open',
        symbol: 'circle',
        confidence: 0.88,
        strokeIndices: [7],
        position: { x: 14.8, y: 20.9 }
      }
    }
  ]
}
```

---

## Shape Detection Algorithms

### Core Principles

1. **Small size threshold**: Bullet symbols are typically 2-8mm in size
2. **Distinct shapes**: Leverage geometric properties (closure, corners, straightness)
3. **Confidence scoring**: Return probability to allow user override
4. **Position matters**: Symbols appear **before** text, at same Y-level

### Algorithm: Checkbox Detection

**Leverage existing rectangle detection** from `StrokeAnalyzer`:

```javascript
/**
 * Detect checkbox (small rectangle)
 * Uses existing rectangle detection but adds size constraint
 */
function detectCheckbox(stroke, analysis) {
  // Must pass rectangle detection first
  if (!analysis.isRectangle) {
    return { isCheckbox: false, confidence: 0 };
  }
  
  // Size constraints (in mm)
  const sizeMin = 2.0;   // 2mm minimum
  const sizeMax = 8.0;   // 8mm maximum
  const width = analysis.bounds.width * NCODE_TO_MM;
  const height = analysis.bounds.height * NCODE_TO_MM;
  
  if (width < sizeMin || width > sizeMax || 
      height < sizeMin || height > sizeMax) {
    return { isCheckbox: false, confidence: 0 };
  }
  
  // Aspect ratio should be close to 1:1 (square-ish)
  const aspectRatio = width / height;
  const squareness = 1 - Math.abs(1 - aspectRatio);
  
  if (squareness < 0.6) {  // Allow 40% deviation from perfect square
    return { isCheckbox: false, confidence: 0 };
  }
  
  // Calculate confidence based on rectangle quality
  let confidence = analysis.rectangleConfidence * 0.6;  // Base from rectangle
  confidence += squareness * 0.3;                       // Squareness bonus
  confidence += (1 - (width / sizeMax)) * 0.1;          // Smaller is better
  
  return {
    isCheckbox: true,
    confidence: Math.min(confidence, 1.0),
    bounds: analysis.bounds
  };
}
```

**Key Detection Features:**
- Reuses `analyzeRectangle()` logic (4 corners, straight segments, closed)
- Adds size constraint: 2-8mm (prevents large rectangles from matching)
- Prefers square aspect ratios (but allows rectangles)
- Confidence scoring favors smaller, more square shapes

### Algorithm: Circle Detection

```javascript
/**
 * Detect event circle
 * Analyzes closure, roundness, and size
 */
function detectCircle(stroke, analysis) {
  const dots = stroke.dotArray || [];
  
  // Must be closed
  const closureDistance = getClosureDistance(dots);
  if (closureDistance > 3.0) {  // 3mm tolerance
    return { isCircle: false, confidence: 0 };
  }
  
  // Size constraints
  const sizeMin = 2.0;
  const sizeMax = 8.0;
  const width = analysis.bounds.width * NCODE_TO_MM;
  const height = analysis.bounds.height * NCODE_TO_MM;
  
  if (width < sizeMin || width > sizeMax || 
      height < sizeMin || height > sizeMax) {
    return { isCircle: false, confidence: 0 };
  }
  
  // Calculate circularity (how round it is)
  const circularity = calculateCircularity(analysis.bounds, dots);
  
  if (circularity < 0.65) {  // Must be reasonably round
    return { isCircle: false, confidence: 0 };
  }
  
  // No corners (or very few)
  const corners = findCorners(dots);
  if (corners.length > 2) {  // Allow 2 slight corners for hand-drawn circles
    return { isCircle: false, confidence: 0 };
  }
  
  // Calculate confidence
  let confidence = 0.5;  // Base
  confidence += circularity * 0.3;
  confidence += (1 - closureDistance / 3.0) * 0.2;  // Better closure = higher
  
  return {
    isCircle: true,
    confidence: Math.min(confidence, 1.0),
    bounds: analysis.bounds
  };
}

/**
 * Calculate how circular a shape is (0-1)
 * Perfect circle = 1, square = ~0.785
 */
function calculateCircularity(bounds, dots) {
  // Method 1: Aspect ratio check
  const aspectRatio = bounds.width / bounds.height;
  const aspectScore = 1 - Math.abs(1 - aspectRatio);
  
  // Method 2: Distance variance from center
  const centerX = bounds.centerX;
  const centerY = bounds.centerY;
  
  const distances = dots.map(dot => 
    Math.sqrt(
      Math.pow(dot.x - centerX, 2) + 
      Math.pow(dot.y - centerY, 2)
    )
  );
  
  const avgRadius = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((sum, d) => 
    sum + Math.pow(d - avgRadius, 2), 0
  ) / distances.length;
  
  const radiusStdDev = Math.sqrt(variance);
  const varianceScore = 1 - Math.min(radiusStdDev / avgRadius, 1);
  
  // Combine scores
  return (aspectScore * 0.4) + (varianceScore * 0.6);
}
```

**Key Detection Features:**
- Must be closed (start/end within 3mm)
- Size constrained to 2-8mm
- Circularity test: checks aspect ratio + radius variance
- Allows 0-2 slight corners (hand-drawn circles aren't perfect)
- Confidence based on roundness and closure quality

### Algorithm: Dash Detection

```javascript
/**
 * Detect note dash (short horizontal line)
 */
function detectDash(stroke, analysis) {
  const dots = stroke.dotArray || [];
  
  // Must NOT be closed
  if (analysis.isClosed) {
    return { isDash: false, confidence: 0 };
  }
  
  // Size constraints
  const lengthMin = 2.0;   // 2mm minimum
  const lengthMax = 8.0;   // 8mm maximum
  const heightMax = 1.5;   // Very thin (1.5mm max height)
  
  const width = analysis.bounds.width * NCODE_TO_MM;
  const height = analysis.bounds.height * NCODE_TO_MM;
  
  if (width < lengthMin || width > lengthMax || height > heightMax) {
    return { isDash: false, confidence: 0 };
  }
  
  // Must be mostly horizontal
  const firstDot = dots[0];
  const lastDot = dots[dots.length - 1];
  const dx = Math.abs(lastDot.x - firstDot.x);
  const dy = Math.abs(lastDot.y - firstDot.y);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  if (angle > 20) {  // Allow up to 20° deviation from horizontal
    return { isDash: false, confidence: 0 };
  }
  
  // Calculate straightness
  const straightness = calculateStraightness(dots);
  
  if (straightness < 0.7) {
    return { isDash: false, confidence: 0 };
  }
  
  // Calculate confidence
  let confidence = 0.5;
  confidence += straightness * 0.3;
  confidence += (1 - angle / 20) * 0.2;  // More horizontal = better
  
  return {
    isDash: true,
    confidence: Math.min(confidence, 1.0),
    bounds: analysis.bounds
  };
}
```

**Key Detection Features:**
- Open stroke (not closed)
- Width 2-8mm, height <1.5mm (very thin)
- Nearly horizontal (±20° tolerance)
- Straight (straightness >0.7)
- Shorter and more horizontal = higher confidence

### Algorithm: Dot Detection

```javascript
/**
 * Detect task dot (tiny filled circle)
 */
function detectDot(stroke, analysis) {
  const dots = stroke.dotArray || [];
  
  // Very small size
  const sizeMax = 2.5;  // 2.5mm maximum
  const width = analysis.bounds.width * NCODE_TO_MM;
  const height = analysis.bounds.height * NCODE_TO_MM;
  
  if (width > sizeMax || height > sizeMax) {
    return { isDot: false, confidence: 0 };
  }
  
  // Should be roughly circular (but smaller tolerance than circles)
  const aspectRatio = width / height;
  const roundness = 1 - Math.abs(1 - aspectRatio);
  
  if (roundness < 0.5) {
    return { isDot: false, confidence: 0 };
  }
  
  // Short duration (quick pen tap)
  const duration = (stroke.endTime || 0) - (stroke.startTime || 0);
  if (duration > 500) {  // More than 500ms is too slow for a dot
    return { isDot: false, confidence: 0 };
  }
  
  // Few dots (pen down, maybe a wiggle, pen up)
  if (dots.length > 15) {
    return { isDot: false, confidence: 0 };
  }
  
  let confidence = 0.6;
  confidence += roundness * 0.2;
  confidence += (1 - Math.min(duration / 500, 1)) * 0.2;
  
  return {
    isDot: true,
    confidence: Math.min(confidence, 1.0),
    bounds: analysis.bounds
  };
}
```

**Key Detection Features:**
- Very small (<2.5mm)
- Roundish (but less strict than circles)
- Quick stroke (<500ms)
- Few dots (<15 points)

---

## Symbol-to-Line Matching

### Challenge

Given detected symbols and transcribed text lines, match each symbol to its corresponding line.

**Key Insight:** Bullet symbols appear **immediately to the left** of text, on the **same baseline**.

### Matching Algorithm

```javascript
/**
 * Match symbols to transcribed lines
 * @param {Array} symbols - Detected bullet symbols with positions
 * @param {Array} lines - Transcribed lines from MyScript
 * @returns {Array} Lines enhanced with bullet metadata
 */
function matchSymbolsToLines(symbols, lines) {
  const BASELINE_TOLERANCE = 3.0;  // mm - vertical alignment tolerance
  const MAX_HORIZONTAL_GAP = 12.0; // mm - max distance from symbol to text
  
  return lines.map(line => {
    // Find symbols that could belong to this line
    const candidates = symbols.filter(symbol => {
      // 1. Y-axis check: Symbol should be at same baseline (±3mm)
      const yDiff = Math.abs(symbol.position.y - line.baseline);
      if (yDiff > BASELINE_TOLERANCE) {
        return false;
      }
      
      // 2. X-axis check: Symbol should be LEFT of text
      const xDiff = line.x - symbol.position.x;
      if (xDiff < 0) {
        return false;  // Symbol is to the right of text
      }
      
      // 3. Proximity check: Symbol should be NEAR text (not far left)
      if (xDiff > MAX_HORIZONTAL_GAP) {
        return false;  // Too far away
      }
      
      return true;
    });
    
    if (candidates.length === 0) {
      return line;  // No bullet for this line
    }
    
    // If multiple candidates, choose closest one
    const bestSymbol = candidates.reduce((best, symbol) => {
      const distToBest = line.x - best.position.x;
      const distToCurrent = line.x - symbol.position.x;
      return distToCurrent < distToBest ? symbol : best;
    });
    
    // Remove matched symbol from pool (one symbol per line)
    const symbolIndex = symbols.indexOf(bestSymbol);
    symbols.splice(symbolIndex, 1);
    
    return {
      ...line,
      bullet: {
        type: bestSymbol.type,
        state: bestSymbol.state,
        symbol: bestSymbol.symbolType,  // 'checkbox' | 'circle' | 'dash' | 'dot'
        confidence: bestSymbol.confidence,
        strokeIndices: bestSymbol.strokeIndices,
        position: bestSymbol.position
      }
    };
  });
}
```

### Spatial Constraints Diagram

```
Text baseline: Y = 10.2 ±3mm tolerance
                    │
    ┌───┐           │  "Review budget"
    │ ☐ │  ←────────┤  First word at X = 25.5
    └───┘           │
     │              │
     └──────────────┘
     15.2          25.5
     
     Distance: 25.5 - 15.2 = 10.3mm ✓ (< 12mm max)
```

### Edge Cases

**Case 1: Multiple symbols on same line**
- Choose the closest one to text
- Remove from candidate pool after matching

**Case 2: Symbol with no text**
- Leave unmatched (could be decorative)
- Optional: Report as orphaned symbol

**Case 3: Text with no symbol**
- Common - not every line needs a bullet
- Leave line.bullet as undefined

**Case 4: Indented bullets**
- Match based on Y-axis only
- Indentation is already captured in line.indentLevel
- Bullet position doesn't affect hierarchy

---

## State Detection

### Overview

Detect if a checkbox/task is completed, migrated, or cancelled by analyzing overlapping strokes.

**Note:** This is **Phase 2** - start without state detection, add later.

### Completion Patterns

```
Open:      ☐       No additional strokes inside box
                   State: 'open'

Done:      ☑       X pattern or checkmark inside box
           ☒       State: 'done'
           
Migrated:  ☐→      Arrow pointing right after box
                   State: 'migrated'
                   
Scheduled: ☐<      Arrow pointing left after box
                   State: 'scheduled'
                   
Cancelled: ☐/      Diagonal line through box
                   State: 'cancelled'
```

### Detection Algorithm (Future)

```javascript
/**
 * Detect checkbox state by analyzing overlapping strokes
 * @param {Object} checkboxStroke - The checkbox stroke
 * @param {Array} allStrokes - All strokes in the document
 * @param {number} checkboxIndex - Index of checkbox stroke
 * @returns {string} State: 'open' | 'done' | 'migrated' | 'cancelled'
 */
function detectCheckboxState(checkboxStroke, allStrokes, checkboxIndex) {
  const bbox = calculateBounds(checkboxStroke.dotArray);
  
  // Find strokes that overlap or are adjacent to the checkbox
  const nearbyStrokes = allStrokes.filter((stroke, idx) => {
    if (idx === checkboxIndex) return false;  // Skip the checkbox itself
    
    const strokeBounds = calculateBounds(stroke.dotArray);
    
    // Check temporal proximity (written within 2 seconds)
    const timeDiff = Math.abs(stroke.startTime - checkboxStroke.startTime);
    if (timeDiff > 2000) return false;
    
    // Check spatial overlap
    return boundsOverlap(bbox, strokeBounds, 2.0);  // 2mm tolerance
  });
  
  if (nearbyStrokes.length === 0) {
    return 'open';  // No overlapping strokes
  }
  
  // Analyze pattern of overlapping strokes
  for (const stroke of nearbyStrokes) {
    const pattern = classifyStrokePattern(stroke, bbox);
    
    switch (pattern) {
      case 'X_MARK':
      case 'CHECKMARK':
        return 'done';
      
      case 'RIGHT_ARROW':
        return 'migrated';
      
      case 'LEFT_ARROW':
        return 'scheduled';
      
      case 'DIAGONAL_STRIKE':
        return 'cancelled';
    }
  }
  
  return 'open';  // Default if pattern unclear
}

/**
 * Classify the pattern of a stroke relative to a checkbox
 */
function classifyStrokePattern(stroke, checkboxBounds) {
  const dots = stroke.dotArray || [];
  if (dots.length < 2) return 'UNKNOWN';
  
  const start = dots[0];
  const end = dots[dots.length - 1];
  
  // Calculate direction
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  
  // Check if stroke crosses through box
  const crossesBox = strokeCrossesBox(stroke, checkboxBounds);
  
  if (crossesBox) {
    // Diagonal (45° ±20°)
    if (Math.abs(Math.abs(angle) - 45) < 20) {
      return 'DIAGONAL_STRIKE';  // Cancelled
    }
    
    // Could be X-mark (would need to check for second crossing stroke)
    return 'X_MARK';  // Done
  }
  
  // Check for arrows (extending from box)
  const extendsRight = start.x <= checkboxBounds.maxX && 
                       end.x > checkboxBounds.maxX + 3;
  const extendsLeft = start.x >= checkboxBounds.minX && 
                      end.x < checkboxBounds.minX - 3;
  
  if (extendsRight && Math.abs(angle) < 20) {
    return 'RIGHT_ARROW';  // Migrated
  }
  
  if (extendsLeft && Math.abs(angle - 180) < 20) {
    return 'LEFT_ARROW';  // Scheduled
  }
  
  return 'UNKNOWN';
}
```

---

## Integration Points

### 1. New File: `src/lib/bujo-detector.js`

Complete implementation of `BulletJournalDetector` class.

**Exports:**
```javascript
export class BulletJournalDetector {
  constructor(strokeAnalyzer) { }
  
  // Main API
  detectBullets(strokes, lines) { }
  
  // Shape detection
  classifySymbols(strokes) { }
  detectCheckbox(stroke, analysis) { }
  detectCircle(stroke, analysis) { }
  detectDash(stroke, analysis) { }
  detectDot(stroke, analysis) { }
  
  // Matching
  matchSymbolsToLines(symbols, lines) { }
  
  // State detection (Phase 2)
  detectCheckboxState(stroke, allStrokes, index) { }
}
```

### 2. Modify: `src/lib/myscript-api.js`

Add optional bullet detection to transcription pipeline.

```javascript
import { BulletJournalDetector } from './bujo-detector.js';
import { StrokeAnalyzer } from './stroke-analyzer.js';

export async function transcribeStrokes(strokes, appKey, hmacKey, options = {}) {
  // ... existing transcription code ...
  
  const result = parseMyScriptResponse(data);
  
  // NEW: Detect bullet journal symbols if enabled
  if (options.detectBullets) {
    const analyzer = new StrokeAnalyzer();
    const detector = new BulletJournalDetector(analyzer);
    result.lines = detector.detectBullets(strokes, result.lines);
    
    // Add summary stats
    result.bujoStats = {
      totalBullets: result.lines.filter(l => l.bullet).length,
      byType: {
        task: result.lines.filter(l => l.bullet?.type === 'task').length,
        event: result.lines.filter(l => l.bullet?.type === 'event').length,
        note: result.lines.filter(l => l.bullet?.type === 'note').length
      }
    };
  }
  
  return result;
}
```

### 3. Modify: `src/stores/settings.js`

Add bullet journal detection setting.

```javascript
// NEW: Bullet journal detection
export const detectBulletJournal = writable(
  localStorage.getItem('detectBulletJournal') === 'true'
);

detectBulletJournal.subscribe(value => {
  localStorage.setItem('detectBulletJournal', value);
});
```

### 4. Modify: `src/components/settings/MyScriptSettings.svelte`

Add UI toggle for bullet detection.

```svelte
<div class="setting-group">
  <h3>Bullet Journal Detection</h3>
  <label class="checkbox-label">
    <input 
      type="checkbox" 
      bind:checked={$detectBulletJournal}
    />
    <span>Detect bullet journal symbols (☐, ○, –)</span>
  </label>
  
  <p class="hint">
    Automatically identify checkboxes, circles, and dashes as task/event/note markers.
    Converts to LogSeq TODO/DONE format.
  </p>
</div>
```

### 5. Modify: `src/lib/logseq-api.js`

Transform bullets when sending to LogSeq.

```javascript
export async function sendToLogseq(lines, host, token = '') {
  // ... existing setup ...
  
  for (const line of lines) {
    let content = line.text;
    
    // NEW: Transform based on bullet type
    if (line.bullet) {
      content = formatBulletForLogseq(line.text, line.bullet);
    }
    
    // ... rest of insertion logic ...
  }
}

function formatBulletForLogseq(text, bullet) {
  switch (bullet.type) {
    case 'task':
      const stateMap = {
        'open': 'TODO',
        'done': 'DONE',
        'migrated': 'LATER',
        'scheduled': 'SCHEDULED',
        'cancelled': 'CANCELLED'
      };
      return `${stateMap[bullet.state] || 'TODO'} ${text}`;
    
    case 'event':
      // Events marked with tag
      return `${text} #event`;
    
    case 'note':
      // Notes stay as plain text
      return text;
    
    default:
      return text;
  }
}
```

### 6. New Component: `src/components/transcription/BulletJournalPreview.svelte`

Visual preview of detected bullets.

```svelte
<script>
  export let lines;
  
  const bulletSymbols = {
    'checkbox': '☐',
    'dot': '•',
    'circle': '○',
    'dash': '–'
  };
  
  const stateSymbols = {
    'open': '☐',
    'done': '☑',
    'migrated': '→',
    'cancelled': '☒'
  };
  
  function getBulletDisplay(bullet) {
    if (bullet.type === 'task' && bullet.state !== 'open') {
      return stateSymbols[bullet.state];
    }
    return bulletSymbols[bullet.symbol];
  }
</script>

<div class="bujo-preview">
  {#each lines as line}
    <div 
      class="line" 
      style="margin-left: {line.indentLevel * 20}px"
      class:has-bullet={line.bullet}
    >
      {#if line.bullet}
        <span 
          class="bullet {line.bullet.type}"
          title="Confidence: {(line.bullet.confidence * 100).toFixed(0)}%"
        >
          {getBulletDisplay(line.bullet)}
        </span>
      {/if}
      <span class="text">{line.text}</span>
    </div>
  {/each}
</div>

<style>
  .bujo-preview {
    font-family: 'Courier New', monospace;
    font-size: 0.9rem;
    line-height: 1.8;
  }
  
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .bullet {
    font-size: 1.1rem;
    font-weight: bold;
    min-width: 20px;
    text-align: center;
  }
  
  .bullet.task {
    color: var(--accent);
  }
  
  .bullet.event {
    color: #f59e0b;  /* Orange */
  }
  
  .bullet.note {
    color: var(--text-secondary);
  }
  
  .text {
    flex: 1;
  }
</style>
```

### 7. Modify: `src/components/transcription/TranscriptionView.svelte`

Add toggle to switch between regular and bullet journal preview.

```svelte
<script>
  import LogseqPreview from './LogseqPreview.svelte';
  import BulletJournalPreview from './BulletJournalPreview.svelte';
  
  let showBujoPreview = true;
  
  // ... existing code ...
</script>

<!-- In the preview section -->
{#if pageData.lines && pageData.lines.length > 0}
  <div class="detail-section">
    <div class="section-header">
      <h4>Preview</h4>
      {#if pageData.bujoStats}
        <label class="toggle-label">
          <input 
            type="checkbox" 
            bind:checked={showBujoPreview}
          />
          <span>Bullet Journal Mode</span>
        </label>
      {/if}
    </div>
    
    {#if showBujoPreview && pageData.bujoStats}
      <BulletJournalPreview lines={pageData.lines} />
      <div class="bujo-stats">
        <span>{pageData.bujoStats.byType.task} tasks</span>
        <span>{pageData.bujoStats.byType.event} events</span>
        <span>{pageData.bujoStats.byType.note} notes</span>
      </div>
    {:else}
      <LogseqPreview lines={pageData.lines} />
    {/if}
  </div>
{/if}
```

---

## Implementation Phases

### Phase 1: Core Detection (MVP) - 12-16 hours

**Goal:** Detect checkboxes, circles, and dashes. No state detection yet.

**Tasks:**
1. ✅ Create `src/lib/bujo-detector.js`
   - Implement `BulletJournalDetector` class
   - Add checkbox detection (reuse rectangle detection)
   - Add circle detection (new algorithm)
   - Add dash detection (new algorithm)
   - Add dot detection (new algorithm)
   - Implement symbol-to-line matching

2. ✅ Integrate with transcription
   - Modify `myscript-api.js` to accept `detectBullets` option
   - Call detector after MyScript parsing
   - Add bullet metadata to line objects

3. ✅ Add settings
   - Add `detectBulletJournal` to `settings.js`
   - Add UI toggle in `MyScriptSettings.svelte`

4. ✅ Basic testing
   - Write sample notes with bullets
   - Verify detection accuracy
   - Tune thresholds based on real data

**Success Criteria:**
- [ ] Detects checkboxes with >80% accuracy
- [ ] Detects circles with >80% accuracy
- [ ] Detects dashes with >80% accuracy
- [ ] Correctly matches symbols to lines (>90% accuracy)
- [ ] No false positives for non-bullet shapes

### Phase 2: Visual Feedback - 6-8 hours

**Goal:** Show detected bullets in UI for verification.

**Tasks:**
1. ✅ Create `BulletJournalPreview.svelte`
   - Display lines with bullet symbols
   - Show detection confidence on hover
   - Color-code by type (task/event/note)

2. ✅ Modify `TranscriptionView.svelte`
   - Add toggle between regular and BuJo preview
   - Show bullet statistics
   - Allow switching views

3. ✅ Canvas visualization
   - Highlight detected bullet strokes on canvas
   - Color code by type
   - Show confidence with opacity

**Success Criteria:**
- [ ] Can visually verify detected bullets
- [ ] Easy to spot false positives/negatives
- [ ] Confidence scores help assess quality

### Phase 3: LogSeq Integration - 4-6 hours

**Goal:** Export bullets as LogSeq TODO/DONE items.

**Tasks:**
1. ✅ Modify `logseq-api.js`
   - Implement `formatBulletForLogseq()`
   - Convert tasks to TODO
   - Add #event tag for events
   - Keep notes as plain text

2. ✅ Update `TranscriptionView.svelte`
   - Show LogSeq-formatted preview with TODO/DONE
   - Maintain hierarchy

3. ✅ Testing
   - Verify tasks import as TODO items
   - Check that hierarchy preserved
   - Ensure events tagged correctly

**Success Criteria:**
- [ ] Tasks appear as `TODO` in LogSeq
- [ ] Events have `#event` tag
- [ ] Notes remain plain text
- [ ] Hierarchy preserved

### Phase 4: State Detection (Optional) - 8-12 hours

**Goal:** Detect completed/migrated/cancelled tasks.

**Tasks:**
1. ✅ Implement state detection
   - `detectCheckboxState()` in `bujo-detector.js`
   - Analyze overlapping strokes
   - Classify patterns (X, arrow, strike)

2. ✅ Update LogSeq export
   - Map states to DONE/LATER/CANCELLED
   - Update preview to show states

3. ✅ Extensive testing
   - Test various completion patterns
   - Tune pattern recognition

**Success Criteria:**
- [ ] Detects completed checkboxes (X or checkmark)
- [ ] Detects migrated tasks (right arrow)
- [ ] Detects cancelled tasks (strike-through)
- [ ] State detection >70% accurate

### Phase 5: Signifiers (Future) - 6-8 hours

**Goal:** Detect priority markers (!, *, $).

**Tasks:**
1. ✅ Detect small marks before bullets
   - Character recognition for !, *, $
   - Or simple shape detection (vertical line, star, S-curve)

2. ✅ Convert to LogSeq tags
   - `!` → `#priority`
   - `*` → `#important`
   - `$` → `#expense`

**Success Criteria:**
- [ ] Detects priority markers
- [ ] Adds appropriate tags in LogSeq

---

## Testing Strategy

### Unit Tests

**Test: Checkbox Detection**
```javascript
describe('BulletJournalDetector - Checkbox', () => {
  test('detects 5mm square checkbox', () => {
    const stroke = createRectangleStroke(5, 5);  // 5mm x 5mm
    const detector = new BulletJournalDetector(new StrokeAnalyzer());
    const result = detector.detectCheckbox(stroke);
    
    expect(result.isCheckbox).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.8);
  });
  
  test('rejects large rectangle (15mm x 8mm)', () => {
    const stroke = createRectangleStroke(15, 8);
    const detector = new BulletJournalDetector(new StrokeAnalyzer());
    const result = detector.detectCheckbox(stroke);
    
    expect(result.isCheckbox).toBe(false);
  });
  
  test('rejects very rectangular shape (8mm x 2mm)', () => {
    const stroke = createRectangleStroke(8, 2);  // Too elongated
    const detector = new BulletJournalDetector(new StrokeAnalyzer());
    const result = detector.detectCheckbox(stroke);
    
    expect(result.isCheckbox).toBe(false);
  });
});
```

**Test: Symbol-to-Line Matching**
```javascript
describe('BulletJournalDetector - Matching', () => {
  test('matches checkbox to nearby text line', () => {
    const symbols = [{
      type: 'task',
      symbol: 'checkbox',
      position: { x: 15.0, y: 10.2 }
    }];
    
    const lines = [{
      text: 'Review budget',
      x: 25.5,
      baseline: 10.5  // Within 3mm of symbol Y
    }];
    
    const detector = new BulletJournalDetector(new StrokeAnalyzer());
    const result = detector.matchSymbolsToLines(symbols, lines);
    
    expect(result[0].bullet).toBeDefined();
    expect(result[0].bullet.type).toBe('task');
  });
  
  test('does not match distant symbol', () => {
    const symbols = [{
      type: 'task',
      position: { x: 5.0, y: 10.0 }
    }];
    
    const lines = [{
      text: 'Far away text',
      x: 30.0,  // 25mm away - too far
      baseline: 10.0
    }];
    
    const detector = new BulletJournalDetector(new StrokeAnalyzer());
    const result = detector.matchSymbolsToLines(symbols, lines);
    
    expect(result[0].bullet).toBeUndefined();
  });
});
```

### Integration Tests

**Test: Full Pipeline**
```javascript
describe('Bullet Journal Integration', () => {
  test('end-to-end: handwriting → detection → LogSeq', async () => {
    // 1. Load sample strokes with checkboxes
    const strokes = await loadSampleStrokes('checkbox-list.json');
    
    // 2. Transcribe with bullet detection
    const result = await transcribeStrokes(strokes, appKey, hmacKey, {
      detectBullets: true
    });
    
    // 3. Verify bullets detected
    expect(result.bujoStats.totalBullets).toBeGreaterThan(0);
    expect(result.lines[0].bullet.type).toBe('task');
    
    // 4. Send to LogSeq
    const logseqResult = await sendToLogseq(result.lines, host, token);
    
    // 5. Verify LogSeq format
    const page = await getPage(host, token, logseqResult.page);
    expect(page.blocks[0].content).toContain('TODO');
  });
});
```

### Manual Testing Checklist

**Sample Notes to Test:**

1. **Simple Task List**
   ```
   ☐ Buy groceries
   ☐ Call dentist
   ☐ Review budget
   ```
   - [ ] All checkboxes detected
   - [ ] Matched to correct lines
   - [ ] Exported as TODO items

2. **Mixed Bullets**
   ```
   ☐ Team meeting prep
   ○ Team meeting 2pm
   - Sarah mentioned vendor X
   ☐ Follow up on proposal
   ```
   - [ ] Checkbox, circle, dash, checkbox detected
   - [ ] Correct types assigned
   - [ ] Mixed export (TODO, #event, plain, TODO)

3. **Indented Hierarchy**
   ```
   ☐ Project planning
     ☐ Define milestones
     ☐ Assign resources
   ○ Kickoff meeting Friday
   ```
   - [ ] Bullets detected at all indent levels
   - [ ] Hierarchy preserved in LogSeq
   - [ ] Parent-child relationships correct

4. **Edge Cases**
   ```
   Large rectangle (not checkbox) ▭
   Tiny dot •
   Very long dash ————————
   Wonky circle ⭕
   ```
   - [ ] Large rectangle rejected
   - [ ] Tiny dot detected (or rejected if too small)
   - [ ] Long dash rejected
   - [ ] Imperfect circle still detected

### Performance Testing

**Metrics to Track:**
- Detection time per page: <500ms
- False positive rate: <5%
- False negative rate: <10%
- Memory usage: No leaks

---

## Future Enhancements

### 1. Custom Symbol Training

Allow users to define their own bullet symbols:

```svelte
<!-- SymbolTrainer.svelte -->
<div class="symbol-trainer">
  <h3>Train Custom Symbol</h3>
  <p>Draw your preferred task checkbox 5 times:</p>
  
  <canvas id="training-canvas"></canvas>
  
  <button on:click={analyzeTrainingData}>
    Analyze Pattern
  </button>
</div>
```

Store user's shape characteristics and use for future detection.

### 2. Advanced Signifiers

Detect and interpret more complex markers:
- `→` Follow-up required
- `@` Mention/assign to person
- `#` Tag/category
- `¥` Financial impact

### 3. Confidence Override UI

Let users manually correct false positives/negatives:

```svelte
<div class="bullet-edit">
  {#if line.bullet}
    <select bind:value={line.bullet.type}>
      <option value="task">Task</option>
      <option value="event">Event</option>
      <option value="note">Note</option>
      <option value="">None (remove)</option>
    </select>
  {:else}
    <button on:click={() => addBullet(line)}>
      Add Bullet
    </button>
  {/if}
</div>
```

### 4. Recurring Tasks

Detect special markers for recurring tasks:
- `☐ ⟳` Recurring task
- Export to LogSeq with recurring schedule

### 5. Time-based Events

Parse event text for time information:
- "Meeting 2pm" → LogSeq scheduled block
- "Deadline Friday" → LogSeq deadline property

### 6. Multi-language Support

Bullet journal method is international - ensure detection works regardless of language used for notes.

---

## Appendix A: Test Data Format

### Sample Stroke Data

```javascript
// checkbox-list.json
{
  "strokes": [
    {
      "pageInfo": { "section": 3, "owner": 27, "book": 161, "page": 1 },
      "startTime": 1640000000000,
      "endTime": 1640000000500,
      "dotArray": [
        { "x": 15.0, "y": 10.0, "f": 500, "timestamp": 1640000000000 },
        { "x": 15.0, "y": 15.0, "f": 500, "timestamp": 1640000000100 },
        { "x": 20.0, "y": 15.0, "f": 500, "timestamp": 1640000000200 },
        { "x": 20.0, "y": 10.0, "f": 500, "timestamp": 1640000000300 },
        { "x": 15.0, "y": 10.0, "f": 500, "timestamp": 1640000000400 }
      ]
    },
    // ... more strokes (text, more bullets, etc.)
  ]
}
```

### Expected Detection Output

```javascript
{
  "lines": [
    {
      "text": "Buy groceries",
      "indentLevel": 0,
      "x": 25.5,
      "baseline": 12.0,
      "bullet": {
        "type": "task",
        "state": "open",
        "symbol": "checkbox",
        "confidence": 0.92,
        "strokeIndices": [0],
        "position": { "x": 15.0, "y": 12.5 }
      }
    },
    {
      "text": "Call dentist",
      "indentLevel": 0,
      "x": 25.3,
      "baseline": 20.0,
      "bullet": {
        "type": "task",
        "state": "open",
        "symbol": "checkbox",
        "confidence": 0.88,
        "strokeIndices": [3],
        "position": { "x": 14.8, "y": 20.2 }
      }
    }
  ],
  "bujoStats": {
    "totalBullets": 2,
    "byType": {
      "task": 2,
      "event": 0,
      "note": 0
    }
  }
}
```

---

## Appendix B: Constants Reference

### Size Thresholds (millimeters)

```javascript
const BULLET_CONSTANTS = {
  // Symbol sizes
  CHECKBOX_MIN: 2.0,
  CHECKBOX_MAX: 8.0,
  CIRCLE_MIN: 2.0,
  CIRCLE_MAX: 8.0,
  DASH_LENGTH_MIN: 2.0,
  DASH_LENGTH_MAX: 8.0,
  DASH_HEIGHT_MAX: 1.5,
  DOT_MAX: 2.5,
  
  // Matching
  BASELINE_TOLERANCE: 3.0,     // Vertical alignment tolerance
  MAX_HORIZONTAL_GAP: 12.0,    // Max distance from bullet to text
  
  // Shape detection
  CLOSURE_THRESHOLD: 3.0,      // Max distance for closed shapes
  CIRCULARITY_MIN: 0.65,       // Min roundness for circles
  STRAIGHTNESS_MIN: 0.7,       // Min straightness for dashes
  DASH_ANGLE_MAX: 20,          // Max deviation from horizontal (degrees)
  CHECKBOX_SQUARENESS_MIN: 0.6, // Min aspect ratio quality
  
  // Temporal
  DOT_DURATION_MAX: 500,       // Max stroke duration for dots (ms)
  STATE_TEMPORAL_WINDOW: 2000, // Time window for state strokes (ms)
};
```

### Conversion Factors

```javascript
const NCODE_TO_MM = 2.371;  // 1 Ncode unit = 2.371mm
const MM_TO_PIXELS = 96 / 25.4;  // At 96 DPI
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | Jan 2026 | Initial | Complete specification for bullet journal detection |

---

## References

- [Bullet Journal Official Website](https://bulletjournal.com/)
- [Rapid Logging Guide](https://bulletjournal.com/pages/learn)
- [LogSeq Task Management](https://docs.logseq.com/#/page/tasks)
- [SmartPen-LogSeq Bridge App Specification](./app-specification.md)
