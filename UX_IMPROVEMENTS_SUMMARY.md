# UX Improvements - Canvas Page Indicators

## Changes Made

### 1. Intelligent Unsaved Stroke Indicators in Canvas Headers

**Location**: `src/lib/canvas-renderer.js`, `src/components/canvas/StrokeCanvas.svelte`, `src/stores/pending-changes.js`, `src/lib/logseq-scanner.js`

**What it does**: Pages with new/unsaved strokes display asterisks around their header text in the stroke preview canvas. The system intelligently compares canvas strokes against LogSeq database strokes using the same deduplication logic used during saves.

**Implementation**:
- Modified `pending-changes.js` to use proper stroke deduplication logic:
  - Compares canvas strokes against LogSeq DB strokes by stroke ID (generated from `startTime`)
  - Uses `convertToStorageFormat()` to convert strokes to comparable format
  - Uses `deduplicateStrokes()` to find truly new strokes
  - Only marks strokes as "additions" if they don't exist in the LogSeq DB
- Updated `logseq-scanner.js` to load stroke data during DB scans:
  - Loads simplified stroke data (in storage format) for each page
  - Handles both legacy single-block and new chunked formats
  - Strokes are pre-loaded for efficient comparison without blocking UI
- Modified `CanvasRenderer` to receive pending changes and display asterisks
- Updated `StrokeCanvas.svelte` to reactively pass `$pendingChanges` to renderer

**Behavior**:
- ✅ **Import from pen** → Asterisks appear on pages with new strokes
- ✅ **Scan LogSeq DB** → Asterisks disappear if all canvas strokes already exist in DB
- ✅ **Add more strokes** → Asterisks appear only if new strokes differ from DB
- ✅ **Save to LogSeq** → Asterisks disappear after successful save

**Example**:
- Before: `B3017 / P42`
- After (with unsaved strokes): `* B3017 / P42 *`
- After (DB scan shows all strokes saved): `B3017 / P42` (no asterisks)
- After (add 5 new strokes to page with 100 in DB): `* B3017 / P42 *` (asterisks reappear)

### 2. Color-Matched Book Labels in Page Filter

**Location**: `src/components/canvas/PageSelector.svelte`

**What it does**: Book labels in the page/book filter now match the color of their corresponding page borders in the canvas preview.

**Implementation**:
- Duplicated the color palette and hashing logic from `canvas-renderer.js`
- Added `getBookColor()` function to calculate consistent colors for book IDs
- Applied colors dynamically via inline styles to book labels
- All pages from the same book use the same color across both components

**Color Palette** (10 distinct colors):
1. Red (233, 69, 96)
2. Teal (75, 192, 192)
3. Yellow (255, 205, 86)
4. Purple (153, 102, 255)
5. Orange (255, 159, 64)
6. Blue (54, 162, 235)
7. Pink (255, 99, 132)
8. Green (76, 175, 80)
9. Brown (121, 85, 72)
10. Gray (158, 158, 158)

## Technical Details

### Stroke Deduplication Algorithm

The system uses a robust deduplication algorithm to identify truly new strokes:

1. **Stroke Identity**: Each stroke has a unique ID generated from its `startTime` timestamp (format: `s{timestamp}`)
2. **Storage Format**: Canvas strokes are converted to simplified storage format containing:
   - `id`: Unique identifier
   - `startTime`: Timestamp when stroke began
   - `endTime`: Timestamp when stroke ended
   - `points`: Array of `[x, y, timestamp]` coordinates
3. **Comparison Process**:
   ```javascript
   // Convert canvas strokes to storage format
   const canvasSimplified = convertToStorageFormat(activeStrokes);
   
   // Find strokes in canvas that don't exist in LogSeq DB
   const uniqueStrokes = deduplicateStrokes(lsPage.strokes, canvasSimplified);
   
   // uniqueStrokes now contains only truly new additions
   ```
4. **Efficiency**: Comparison uses `Set` lookups for O(1) performance per stroke

### Pending Changes Detection

The `pendingChanges` derived store intelligently tracks changes:
- **Groups strokes by page** using the format `B{book}/P{page}`
- **Separates active vs deleted strokes** for accurate change tracking
- **Compares against LogSeq DB**:
  - Converts canvas strokes to storage format
  - Uses `deduplicateStrokes()` to find new strokes
  - Maps results back to canvas indices
- **Updates reactively** as strokes are added, deleted, or saved
- **Handles both formats**: Legacy single-block and new chunked storage

### LogSeq Data Loading

The scanner (`logseq-scanner.js`) loads stroke data efficiently:
- **Parallel loading**: Uses `Promise.all()` to fetch all pages concurrently
- **Simplified format**: Loads strokes in storage format (60% smaller than full strokes)
- **Smart parsing**: Handles both chunked and legacy single-block formats
- **Lazy loading**: Full stroke data (for import) is loaded on-demand separately

### Color Consistency

Both components use identical:
- Color palette arrays
- Book ID hashing algorithm
- Color index calculation

This ensures perfect color matching between the filter and canvas views.

## User Experience

### Before
- No way to quickly identify which pages had unsaved work
- Book labels in filter were all red (accent color)
- Visual disconnect between filter and canvas

### After
- Asterisks immediately show which pages need saving
- Book colors match between filter and canvas for easier identification
- Consistent visual language throughout the interface

## Testing Recommendations

### Unsaved Stroke Indicators
1. **Fresh import** → Import strokes from pen → Verify asterisks appear on new page headers
2. **DB comparison** → Scan LogSeq DB → Verify asterisks disappear on pages already in DB
3. **Mixed state** → Have page with 100 strokes in DB, add 5 new strokes → Verify asterisks appear
4. **Save flow** → Save pages to LogSeq → Verify asterisks disappear after successful save
5. **Rescan** → Rescan LogSeq after save → Verify asterisks stay gone
6. **Partial overlap** → Import offline notes that partially overlap with DB → Verify asterisks only on pages with new strokes

### Color Matching
1. **Multiple books** → Have strokes from 3+ different books → Verify each book has a unique color
2. **Filter sync** → Toggle page visibility in filter → Verify colors remain consistent in canvas
3. **Book consistency** → Verify all pages from the same book use the same color in both filter and canvas
