# Temporal Data Specification
## SmartPen-LogSeq Bridge - Timing Information & Use Cases

**Version:** 1.0  
**Last Updated:** January 2026  
**Status:** Available but not currently implemented in UI

---

## Overview

Every stroke captured by the SmartPen contains comprehensive temporal (timing) information that is **fully preserved** throughout the entire data pipeline—from pen capture through LogSeq storage and retrieval. This temporal metadata enables powerful chronological analysis, session detection, and workflow insights.

### Key Insight

**All timestamp data survives the round-trip:**
1. Pen → Application (full timestamps captured)
2. Application → LogSeq Database (timestamps preserved in storage format)
3. LogSeq Database → Application (timestamps restored when reading)

This means we have complete temporal context for both:
- **New strokes** imported directly from the pen
- **Stored strokes** retrieved from the LogSeq database

---

## Timestamp Data Structure

### 1. Stroke-Level Timestamps

Every stroke has two primary timestamps:

```javascript
{
  startTime: 1765403005055,  // Unix timestamp (milliseconds) - pen down
  endTime: 1765403005892,    // Unix timestamp (milliseconds) - pen up
  // ... other stroke data
}
```

**Derived Information:**
- **Stroke Duration**: `endTime - startTime` (milliseconds)
- **Absolute Time**: Convert to human-readable date/time
- **Chronological Order**: Sort by `startTime` for writing sequence

### 2. Point-Level Timestamps

Each individual point (dot) within a stroke has its own timestamp:

```javascript
{
  points: [
    [234.567, 123.456, 1765403005055],  // [x, y, timestamp]
    [235.123, 123.789, 1765403005072],
    [235.891, 124.234, 1765403005089],
    // ... more points
  ]
}
```

**Derived Information:**
- **Writing Speed**: Distance between points ÷ time difference
- **Acceleration/Deceleration**: Speed changes within a stroke
- **Pauses**: Large time gaps between points indicate hesitation

### 3. Storage Format (LogSeq Database)

The simplified storage format preserves all temporal data:

```javascript
{
  id: "s1765403005055",           // Generated from startTime
  startTime: 1765403005055,       // Preserved
  endTime: 1765403005892,         // Preserved
  points: [
    [234.567, 123.456, 1765403005055],  // [x, y, timestamp] - all preserved
    [235.123, 123.789, 1765403005072],
    [235.891, 124.234, 1765403005089]
  ]
}
```

**Storage Efficiency:**
- Timestamps stored as Unix milliseconds (numbers, not strings)
- ~60% storage reduction compared to full stroke data
- No loss of temporal precision

---

## Temporal Granularity

### Precision Levels

| Level | Precision | Data Source | Use Cases |
|-------|-----------|-------------|-----------|
| **Stroke** | Milliseconds | `startTime`, `endTime` | Session detection, chronological sorting |
| **Point** | Milliseconds | Individual point timestamps | Speed analysis, writing dynamics |
| **Session** | Derived | Time gaps between strokes | Identify distinct writing periods |
| **Page** | Derived | Aggregate of stroke times | Page completion time, multi-page sequences |

### Time Resolution

```
Millisecond precision examples:
1765403005055 = Tuesday, January 6, 2026 11:50:05.055 AM CST

Typical point interval: 10-20ms (50-100 points per second)
Typical stroke duration: 100-2000ms (0.1-2 seconds)
Typical stroke gap: 200-800ms (brief pause between letters/words)
```

---

## Use Cases by Category

### 1. Chronological Analysis

#### **Use Case 1.1: True Writing Order**
**Problem:** Canvas rendering shows spatial layout, not writing sequence  
**Solution:** Sort strokes by `startTime` to see what was written first

```javascript
// Get strokes in writing order
const chronological = strokes.sort((a, b) => a.startTime - b.startTime);

// Example: Show sequential stroke numbers
chronological.forEach((stroke, index) => {
  console.log(`Stroke ${index + 1} written at ${new Date(stroke.startTime)}`);
});
```

**Value:**
- Understand the author's thought process
- Identify corrections and additions
- See how ideas developed over time

---

#### **Use Case 1.2: Timeline Visualization**
**Problem:** No way to see temporal distribution of writing  
**Solution:** Create visual timeline showing when strokes occurred

```
Timeline View (horizontal):
|-----|-----------|------|----------------------|
9:00  9:15       9:30   9:45                  10:00
  ██   ████████    ██     ████████████████████
  
Burst 1: Quick notes at start
Burst 2: Main content (9:15-9:30)
Burst 3: Brief addition
Burst 4: Extended session
```

**Value:**
- Identify productive writing periods
- Detect workflow interruptions
- Optimize writing habits

---

#### **Use Case 1.3: Temporal Filtering**
**Problem:** Want to see only recent additions or specific time ranges  
**Solution:** Filter strokes by time window

```javascript
// Show only strokes from last 5 minutes
const now = Date.now();
const recent = strokes.filter(s => (now - s.startTime) < 5 * 60 * 1000);

// Show strokes from specific date range
const start = new Date('2026-01-06T09:00:00').getTime();
const end = new Date('2026-01-06T10:00:00').getTime();
const rangeStrokes = strokes.filter(s => 
  s.startTime >= start && s.startTime <= end
);
```

**Value:**
- Isolate recent edits
- Compare before/after versions
- Find specific meeting notes by time

---

### 2. Session Detection

#### **Use Case 2.1: Automatic Session Grouping**
**Problem:** Multiple writing sessions on same page aren't distinguished  
**Solution:** Detect natural breaks (>2 min gaps) to group related strokes

```javascript
const SESSION_GAP_MS = 2 * 60 * 1000; // 2 minutes

function detectSessions(strokes) {
  const sorted = strokes.sort((a, b) => a.startTime - b.startTime);
  const sessions = [];
  let currentSession = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i].startTime - sorted[i-1].endTime;
    
    if (gap > SESSION_GAP_MS) {
      // New session started
      sessions.push(currentSession);
      currentSession = [sorted[i]];
    } else {
      currentSession.push(sorted[i]);
    }
  }
  
  sessions.push(currentSession);
  return sessions;
}
```

**Value:**
- Separate meeting notes from review comments
- Identify distinct thought sessions
- Track productivity patterns

---

#### **Use Case 2.2: Session Metadata**
**Problem:** No summary of writing activity  
**Solution:** Calculate session statistics

```javascript
function analyzeSession(strokes) {
  const sorted = strokes.sort((a, b) => a.startTime - b.startTime);
  
  return {
    startTime: sorted[0].startTime,
    endTime: sorted[sorted.length - 1].endTime,
    duration: sorted[sorted.length - 1].endTime - sorted[0].startTime,
    strokeCount: strokes.length,
    avgStrokeDuration: strokes.reduce((sum, s) => 
      sum + (s.endTime - s.startTime), 0) / strokes.length,
    writingTime: strokes.reduce((sum, s) => 
      sum + (s.endTime - s.startTime), 0), // Active writing
    pauseTime: null // Calculate from gaps
  };
}

// Example output:
// {
//   startTime: 1765403005055,
//   endTime: 1765403245892,
//   duration: 240837,          // ~4 minutes total
//   strokeCount: 47,
//   avgStrokeDuration: 234,    // ~234ms per stroke
//   writingTime: 10998,        // ~11 seconds actual writing
//   pauseTime: 229839          // ~3:50 thinking/pausing
// }
```

**Value:**
- Understand writing vs. thinking ratio
- Measure productivity
- Compare session efficiency

---

### 3. Correction & Edit Detection

#### **Use Case 3.1: Identify Later Additions**
**Problem:** Can't tell what was added after initial writing  
**Solution:** Find strokes significantly later than page's main content

```javascript
function detectLateAdditions(strokes, thresholdMinutes = 5) {
  const sorted = strokes.sort((a, b) => a.startTime - b.startTime);
  
  // Find the bulk of content (first 80% of strokes)
  const bulkEndIndex = Math.floor(sorted.length * 0.8);
  const bulkEndTime = sorted[bulkEndIndex].endTime;
  
  const threshold = thresholdMinutes * 60 * 1000;
  
  return sorted.filter(s => 
    (s.startTime - bulkEndTime) > threshold
  );
}
```

**Value:**
- Highlight review comments
- Show corrections made later
- Track iterative refinement

---

#### **Use Case 3.2: Stroke Density Heatmap**
**Problem:** No visual indication of editing intensity  
**Solution:** Show temporal density of strokes on canvas

```javascript
// Color strokes by age (newest = bright, oldest = faded)
function getStrokeOpacity(stroke, allStrokes) {
  const sorted = allStrokes.sort((a, b) => a.startTime - b.startTime);
  const minTime = sorted[0].startTime;
  const maxTime = sorted[sorted.length - 1].startTime;
  const range = maxTime - minTime;
  
  // Normalize to 0-1 (oldest = 0, newest = 1)
  const age = (stroke.startTime - minTime) / range;
  
  // Opacity: oldest = 0.3, newest = 1.0
  return 0.3 + (age * 0.7);
}
```

**Value:**
- See which areas were edited most
- Identify problematic sections (lots of rewrites)
- Visualize revision history

---

### 4. Writing Speed Analysis

#### **Use Case 4.1: Per-Stroke Speed**
**Problem:** No insight into writing fluency  
**Solution:** Calculate speed metrics for each stroke

```javascript
function analyzeStrokeSpeed(stroke) {
  const points = stroke.points;
  let totalDistance = 0;
  let totalTime = 0;
  
  for (let i = 1; i < points.length; i++) {
    const [x1, y1, t1] = points[i-1];
    const [x2, y2, t2] = points[i];
    
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx*dx + dy*dy);
    const time = t2 - t1;
    
    totalDistance += distance;
    totalTime += time;
  }
  
  return {
    avgSpeed: totalDistance / totalTime,  // Units per millisecond
    totalDistance: totalDistance,
    totalTime: totalTime,
    classification: classifySpeed(totalDistance / totalTime)
  };
}

function classifySpeed(speed) {
  if (speed < 0.5) return 'slow/careful';
  if (speed < 2.0) return 'normal';
  return 'fast/fluent';
}
```

**Value:**
- Identify confident vs. uncertain writing
- Detect fatigue (slowing over time)
- Measure skill improvement

---

#### **Use Case 4.2: Acceleration Patterns**
**Problem:** Can't see hesitation or uncertainty within strokes  
**Solution:** Analyze speed changes within individual strokes

```javascript
function detectHesitation(stroke) {
  const points = stroke.points;
  const slowdowns = [];
  
  for (let i = 2; i < points.length; i++) {
    const [x1, y1, t1] = points[i-2];
    const [x2, y2, t2] = points[i-1];
    const [x3, y3, t3] = points[i];
    
    // Speed before and after
    const speed1 = distance(x1, y1, x2, y2) / (t2 - t1);
    const speed2 = distance(x2, y2, x3, y3) / (t3 - t2);
    
    // Significant slowdown (>50% reduction)
    if (speed2 < speed1 * 0.5) {
      slowdowns.push({
        pointIndex: i-1,
        speedDrop: speed1 - speed2
      });
    }
  }
  
  return slowdowns;
}
```

**Value:**
- Identify difficult letters/words
- Detect cognitive load points
- Improve handwriting recognition accuracy

---

### 5. Multi-Page Temporal Context

#### **Use Case 5.1: Cross-Page Chronology**
**Problem:** Pages rendered independently, losing temporal sequence  
**Solution:** Create unified timeline across all pages

```javascript
function buildPageTimeline(pages) {
  // Flatten all strokes across pages with page reference
  const allStrokes = [];
  
  for (const [pageKey, pageStrokes] of pages.entries()) {
    pageStrokes.forEach(stroke => {
      allStrokes.push({
        ...stroke,
        pageKey: pageKey
      });
    });
  }
  
  // Sort by time
  allStrokes.sort((a, b) => a.startTime - b.startTime);
  
  // Group into page-switch events
  const pageSequence = [];
  let currentPage = null;
  
  allStrokes.forEach(stroke => {
    if (stroke.pageKey !== currentPage) {
      pageSequence.push({
        pageKey: stroke.pageKey,
        startTime: stroke.startTime
      });
      currentPage = stroke.pageKey;
    }
  });
  
  return pageSequence;
}
```

**Value:**
- Understand notebook usage patterns
- See how ideas flowed across pages
- Reconstruct meeting flow

---

#### **Use Case 5.2: Page Completion Detection**
**Problem:** Don't know when a page was "finished"  
**Solution:** Detect large time gaps after last stroke on page

```javascript
function detectPageCompletion(pageStrokes, allStrokes) {
  const sorted = pageStrokes.sort((a, b) => a.startTime - b.startTime);
  const lastStroke = sorted[sorted.length - 1];
  
  // Find next stroke on ANY page
  const allSorted = allStrokes.sort((a, b) => a.startTime - b.startTime);
  const lastStrokeIndex = allSorted.findIndex(s => s === lastStroke);
  
  if (lastStrokeIndex < allSorted.length - 1) {
    const nextStroke = allSorted[lastStrokeIndex + 1];
    const gap = nextStroke.startTime - lastStroke.endTime;
    
    // Large gap = page likely complete
    return {
      completed: gap > 5 * 60 * 1000, // 5+ min gap
      lastActivity: lastStroke.endTime,
      gap: gap
    };
  }
  
  return {
    completed: true,
    lastActivity: lastStroke.endTime,
    gap: null
  };
}
```

**Value:**
- Mark pages as "done"
- Trigger transcription workflows
- Archive old content

---

### 6. Playback & Animation

#### **Use Case 6.1: Stroke Replay**
**Problem:** Want to see writing process unfold  
**Solution:** Animate strokes in chronological order

```javascript
async function playbackStrokes(strokes, canvasRenderer, speedMultiplier = 1) {
  const sorted = strokes.sort((a, b) => a.startTime - b.startTime);
  const startTime = sorted[0].startTime;
  
  canvasRenderer.clear();
  
  for (const stroke of sorted) {
    const relativeTime = stroke.startTime - startTime;
    const playbackDelay = relativeTime / speedMultiplier;
    
    await new Promise(resolve => setTimeout(resolve, playbackDelay));
    
    // Animate each point in the stroke
    for (const [x, y, timestamp] of stroke.points) {
      canvasRenderer.addPoint(x, y);
      await new Promise(resolve => setTimeout(resolve, 5 / speedMultiplier));
    }
  }
}
```

**Value:**
- Review writing process
- Educational demonstrations
- Debug recognition issues

---

#### **Use Case 6.2: Time-Lapse Export**
**Problem:** Want to share writing process  
**Solution:** Generate time-lapse video of stroke creation

```javascript
function generateTimeLapse(strokes, fps = 30, speedup = 10) {
  const sorted = strokes.sort((a, b) => a.startTime - b.startTime);
  const startTime = sorted[0].startTime;
  const endTime = sorted[sorted.length - 1].endTime;
  const totalDuration = endTime - startTime;
  
  const playbackDuration = (totalDuration / speedup) / 1000; // seconds
  const frameCount = Math.ceil(playbackDuration * fps);
  
  const frames = [];
  
  for (let i = 0; i < frameCount; i++) {
    const playbackTime = (i / frameCount) * totalDuration;
    const currentTime = startTime + (playbackTime * speedup);
    
    // Get all strokes that should be visible at this time
    const visibleStrokes = sorted.filter(s => s.startTime <= currentTime);
    
    frames.push({
      frameNumber: i,
      timestamp: currentTime,
      strokes: visibleStrokes
    });
  }
  
  return frames;
}
```

**Value:**
- Create engaging content
- Show creative process
- Time-lapse note reviews

---

### 7. Productivity Analytics

#### **Use Case 7.1: Daily Writing Statistics**
**Problem:** No insights into writing habits  
**Solution:** Aggregate temporal data across sessions

```javascript
function calculateDailyStats(strokes) {
  const byDate = {};
  
  strokes.forEach(stroke => {
    const date = new Date(stroke.startTime).toDateString();
    
    if (!byDate[date]) {
      byDate[date] = {
        strokeCount: 0,
        totalWritingTime: 0,
        sessions: detectSessions(strokes.filter(s => 
          new Date(s.startTime).toDateString() === date
        ))
      };
    }
    
    byDate[date].strokeCount++;
    byDate[date].totalWritingTime += (stroke.endTime - stroke.startTime);
  });
  
  return byDate;
}
```

**Value:**
- Track writing consistency
- Identify productive times
- Measure output trends

---

#### **Use Case 7.2: Focus Score**
**Problem:** Can't measure distraction levels  
**Solution:** Calculate focus based on stroke continuity

```javascript
function calculateFocusScore(session) {
  const strokes = session.sort((a, b) => a.startTime - b.startTime);
  
  let totalGapTime = 0;
  let gapCount = 0;
  
  for (let i = 1; i < strokes.length; i++) {
    const gap = strokes[i].startTime - strokes[i-1].endTime;
    totalGapTime += gap;
    gapCount++;
  }
  
  const avgGap = totalGapTime / gapCount;
  const writingTime = strokes.reduce((sum, s) => 
    sum + (s.endTime - s.startTime), 0);
  
  // Lower avg gap = better focus
  const focusScore = writingTime / (writingTime + totalGapTime);
  
  return {
    score: focusScore,          // 0-1, higher = more focused
    avgGap: avgGap,             // milliseconds
    interpretation: focusScore > 0.2 ? 'focused' : 'distracted'
  };
}
```

**Value:**
- Quantify attention quality
- Compare session effectiveness
- Optimize work environment

---

## Implementation Roadmap

### Phase 1: Basic Chronological Features
**Effort:** 4-6 hours  
**Priority:** High

1. Add chronological sort toggle to stroke list
2. Display absolute timestamp on stroke hover
3. Show stroke sequence numbers in canvas
4. Add "Time" tab to data explorer with simple timeline

### Phase 2: Session Detection
**Effort:** 6-8 hours  
**Priority:** Medium

1. Implement session detection algorithm
2. Add session boundaries to canvas (visual dividers)
3. Display session statistics panel
4. Color-code strokes by session

### Phase 3: Advanced Visualization
**Effort:** 12-16 hours  
**Priority:** Medium

1. Create interactive timeline chart
2. Add temporal filtering (date range picker)
3. Implement age-based opacity/color schemes
4. Build page-switch timeline view

### Phase 4: Analytics & Playback
**Effort:** 16-20 hours  
**Priority:** Low

1. Implement playback controls
2. Add speed analysis metrics
3. Create productivity dashboard
4. Export time-lapse functionality

---

## Technical Considerations

### Performance

**Large Datasets:**
- Sorting 1,000+ strokes: ~1-2ms (negligible)
- Timeline rendering: Use virtualization for >10,000 points
- Session detection: O(n) complexity, fast even for large sets

**Caching:**
```javascript
// Cache derived temporal data
const temporalCache = new Map();

function getCachedSessions(strokes) {
  const key = strokes.map(s => s.id).join(',');
  
  if (!temporalCache.has(key)) {
    temporalCache.set(key, detectSessions(strokes));
  }
  
  return temporalCache.get(key);
}
```

### Browser Compatibility

All temporal features use standard JavaScript `Date` APIs:
- `Date.now()` - current timestamp
- `new Date(timestamp)` - timestamp to Date object
- `date.toLocaleString()` - formatted display

No special polyfills required.

### Storage Impact

**No Additional Storage:**
- Timestamps already stored in LogSeq
- No new database fields required
- Derived calculations done on-demand

**Optional Caching:**
- Store computed session boundaries
- Cache daily statistics
- ~1KB per page of temporal metadata

---

## User Interface Mockups

### Timeline View (Proposed)

```
┌─────────────────────────────────────────────────────────────────┐
│ Timeline  [▸ Play]  Speed: [1x ▾]  [📅 Date Range]  [🔍 Filter] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  9:00 AM                    10:00 AM                  11:00 AM   │
│  ├───┬────────┬─────────────┬───┬──────────────────────────┤   │
│  │   │        │             │   │                          │   │
│  ███  █████████              ███  ██████████████████████████   │
│  │    │                      │                                  │
│  │    └─ Session 2          └─ Session 3                       │
│  └─ Session 1                  47 strokes                       │
│     12 strokes                 4:23 duration                    │
│     1:15 duration                                               │
│                                                                  │
│  Selected: Session 2 (9:15 - 9:35 AM)                          │
│  • 23 strokes                                                   │
│  • 20min 15sec total, 47sec active writing                     │
│  • Focus score: 0.24 (focused)                                 │
│                                                                  │
│  [🎯 Jump to Canvas]  [📊 Detailed Stats]  [💾 Export]         │
└─────────────────────────────────────────────────────────────────┘
```

### Stroke Properties Panel (Enhanced)

```
┌──────────────────────────────────┐
│ Stroke #47                       │
├──────────────────────────────────┤
│ Position:                        │
│   X: 234.5 - 289.1               │
│   Y: 123.4 - 156.8               │
│                                  │
│ Timing:                          │
│   Started: 10:34:15.055 AM      │
│   Ended:   10:34:15.892 AM      │
│   Duration: 837ms               │
│   Sequence: #47 of 89           │
│                                  │
│ Speed:                           │
│   Avg: 1.8 units/ms (normal)    │
│   Distance: 67.3 units          │
│   Points: 42 (50 fps)           │
│                                  │
│ Session:                         │
│   Session 3 (10:15 - 10:45)     │
│   23 strokes into session       │
│                                  │
│ [📍 Show on Timeline]           │
└──────────────────────────────────┘
```

---

## API Reference

### Temporal Utilities (Proposed)

```javascript
// Sort strokes chronologically
import { sortByTime } from './lib/temporal-utils.js';
const sorted = sortByTime(strokes);

// Detect sessions
import { detectSessions } from './lib/session-detector.js';
const sessions = detectSessions(strokes, { gapMinutes: 2 });

// Analyze session
import { analyzeSession } from './lib/session-analyzer.js';
const stats = analyzeSession(session);

// Calculate speed
import { analyzeStrokeSpeed } from './lib/speed-analyzer.js';
const speed = analyzeStrokeSpeed(stroke);

// Playback
import { playbackStrokes } from './lib/playback.js';
await playbackStrokes(strokes, canvasRenderer, { speed: 10 });
```

---

## Conclusion

The SmartPen-LogSeq Bridge captures and preserves **complete temporal information** for every stroke at multiple granularities:

- ✅ **Stroke-level**: Start/end timestamps
- ✅ **Point-level**: Individual dot timestamps  
- ✅ **Storage**: Full preservation in LogSeq database
- ✅ **Retrieval**: Complete restoration when reading back

This enables a rich set of **chronological analysis features** that are currently **not exposed in the UI** but are **ready to implement** using the existing data foundation.

**Next Steps:**
1. Prioritize which temporal features to add first
2. Design UI components for temporal visualization
3. Implement session detection and basic timeline view
4. Iterate based on user feedback

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial specification - temporal data availability and use cases |
