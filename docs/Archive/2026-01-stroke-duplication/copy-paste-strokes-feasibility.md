# Copy/Paste Strokes - Feasibility Specification

**Version:** 1.1.0  
**Status:** Feasibility Analysis  
**Created:** January 2026  
**Updated:** January 2026 (v1.1 - unified canvas approach)
**Related Documents:** 
- [App Specification](./app-specification.md)
- [Bullet Journal Spec](./bullet-journal-spec.md)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Use Case Analysis](#use-case-analysis)
3. [Current Architecture Assessment](#current-architecture-assessment)
4. [Proposed Solution](#proposed-solution)
5. [Technical Requirements](#technical-requirements)
6. [Implementation Complexity](#implementation-complexity)
7. [Risk Assessment](#risk-assessment)
8. [Implementation Roadmap](#implementation-roadmap)

---

## Executive Summary

### Feature Request

Enable users to:
1. **Copy** selected strokes from page previews
2. **Paste** them into the same canvas as independent, movable strokes
3. **Reposition** pasted strokes individually or as selected groups
4. **Group** pasted strokes into a new virtual page
5. **Save** grouped strokes to LogSeq with user-defined book/page numbers

### Key Clarifications (v1.1)

- ✅ Pasted strokes appear in the **same canvas** as original page strokes
- ✅ Pasted strokes are **individually movable** (not page-locked)
- ✅ Selected groups can be **moved together**
- ✅ User can **create new pages** from pasted strokes with manual book/page assignment
- ✅ Original page strokes remain **untouched and non-movable**

### Feasibility Assessment

**Overall: FEASIBLE with MEDIUM-HIGH complexity**

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Feasibility | ✅ High | Architecture supports this pattern |
| Implementation Complexity | 🟡 Medium-High | ~24-32 hours development time |
| Integration Risk | 🟢 Low | Pasted strokes isolated from originals |
| UI/UX Complexity | 🟡 Medium | New interaction modes for moving strokes |
| Value vs. Effort | ✅ High | Enables powerful composition workflows |

---

## Use Case Analysis

### Primary Use Cases

#### 1. Curated Note Compilation
**Scenario:** User copies specific content from multiple pages, repositions them in the canvas, then saves as a new organized page.

```
Original Canvas:
  ┌─────────────┐  ┌─────────────┐  
  │ B161/P1     │  │ B161/P2     │  
  │ ☐ Task A    │  │ Meeting     │  
  │ ☐ Task B    │  │ notes...    │  
  │ ☐ Task C    │  │             │  
  └─────────────┘  └─────────────┘  

After Copy/Paste + Reposition:
  ┌─────────────┐  ┌─────────────┐  ┌ ─ ─ ─ ─ ─ ─ ┐
  │ B161/P1     │  │ B161/P2     │    PASTED      
  │ ☐ Task A    │  │ Meeting     │  │ ☐ Task A    │ ← individually
  │ ☐ Task B    │  │ notes...    │    ☐ Task C      ← movable
  │ ☐ Task C    │  │             │  │ Meeting...  │
  └─────────────┘  └─────────────┘  └ ─ ─ ─ ─ ─ ─ ┘

Save as New Page → User enters: Book 200, Page 1
```

#### 2. Daily Log Assembly
**Scenario:** User copies tasks/events from multiple days into a weekly summary page.

#### 3. Sketch Composition
**Scenario:** User copies drawing elements from various pages, repositions them to create a composite illustration.

### Interaction Model

| Action | Behavior |
|--------|----------|
| Select + Copy (Ctrl+C) | Copies selected strokes to clipboard |
| Paste (Ctrl+V) | Adds strokes to canvas as "pasted" (movable) |
| Click pasted stroke | Select it (highlight) |
| Drag pasted stroke | Move individual stroke |
| Select multiple + Drag | Move group together |
| Click original stroke | Select it (for copying, not moving) |
| Drag original stroke | No effect (originals are locked) |

---

## Current Architecture Assessment

### Stroke Data Model

```javascript
// Current stroke structure
{
  pageInfo: {
    section: 3,
    owner: 1012,
    book: 161,
    page: 1
  },
  dotArray: [
    { x: 15.0, y: 10.0, f: 500, timestamp: ... },
    // ... more dots
  ]
}
```

**For pasted strokes, we'll add metadata:**
```javascript
{
  pageInfo: { ... },      // Will be null or virtual for pasted
  dotArray: [ ... ],
  _pasted: true,          // Flag: this is a pasted stroke
  _pastedAt: 1640000000,  // When it was pasted
  _offset: { x: 0, y: 0 } // Position offset from original coords
}
```

### Canvas Renderer Capabilities

The `CanvasRenderer` already supports:
- ✅ Multi-page rendering with offsets
- ✅ Per-stroke coordinate transformation
- ✅ Hit testing for stroke selection
- ✅ Custom page positions

**Needs addition:**
- Per-stroke position offsets (for pasted strokes)
- Visual distinction for pasted vs. original strokes

### Selection System

Current system tracks indices into the `strokes` array. This will work for pasted strokes since they'll be added to the same array (or a parallel array that's rendered together).

---

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         STROKE CANVAS                                │
│                                                                      │
│   ┌───────────────────────────────────────────────────────────────┐ │
│   │                                                               │ │
│   │   ┌─────────────┐  ┌─────────────┐                           │ │
│   │   │ B161/P1     │  │ B161/P2     │   ← Original pages        │ │
│   │   │ (locked)    │  │ (locked)    │     (not movable)         │ │
│   │   └─────────────┘  └─────────────┘                           │ │
│   │                                                               │ │
│   │        ┌ ─ ─ ─ ─ ─ ┐                                         │ │
│   │          Pasted     ← Pasted strokes                         │ │
│   │        │ strokes   │   (individually movable)                │ │
│   │          (free)                                               │ │
│   │        └ ─ ─ ─ ─ ─ ┘                                         │ │
│   │                                                               │ │
│   └───────────────────────────────────────────────────────────────┘ │
│                                                                      │
│   [Copy Selected] [Paste] [Group as Page...] [Clear Pasted]         │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘

                              │
                              │ "Group as Page..."
                              ▼
                    ┌─────────────────────┐
                    │  Create New Page    │
                    │                     │
                    │  Book: [___200___]  │
                    │  Page: [____1____]  │
                    │                     │
                    │  [Cancel] [Create]  │
                    └─────────────────────┘
```

### Data Model

#### Pasted Strokes Store

```javascript
// src/stores/pasted-strokes.js

import { writable, derived, get } from 'svelte/store';

/**
 * Pasted strokes - separate from original page strokes
 * These are movable and can be grouped into new pages
 */
export const pastedStrokes = writable([]);

/**
 * Selection within pasted strokes (indices)
 */
export const pastedSelection = writable(new Set());

/**
 * Count of pasted strokes
 */
export const pastedCount = derived(
  pastedStrokes,
  $strokes => $strokes.length
);

/**
 * Selected pasted strokes
 */
export const selectedPastedStrokes = derived(
  [pastedStrokes, pastedSelection],
  ([$strokes, $selection]) =>
    Array.from($selection).map(i => $strokes[i]).filter(Boolean)
);

/**
 * Add strokes from clipboard to pasted collection
 * @param {Array} strokes - Strokes to paste
 * @param {Object} initialOffset - Starting position offset
 */
export function pasteStrokes(strokes, initialOffset = { x: 0, y: 0 }) {
  const normalized = normalizeAndOffset(strokes, initialOffset);
  
  pastedStrokes.update(existing => [...existing, ...normalized]);
}

/**
 * Move selected pasted strokes by delta
 * @param {number} deltaX - X movement in Ncode units
 * @param {number} deltaY - Y movement in Ncode units
 */
export function movePastedStrokes(deltaX, deltaY) {
  const selection = get(pastedSelection);
  if (selection.size === 0) return;
  
  pastedStrokes.update(strokes => 
    strokes.map((stroke, index) => {
      if (!selection.has(index)) return stroke;
      
      return {
        ...stroke,
        _offset: {
          x: (stroke._offset?.x || 0) + deltaX,
          y: (stroke._offset?.y || 0) + deltaY
        }
      };
    })
  );
}

/**
 * Remove selected pasted strokes
 */
export function deleteSelectedPasted() {
  const selection = get(pastedSelection);
  
  pastedStrokes.update(strokes =>
    strokes.filter((_, index) => !selection.has(index))
  );
  pastedSelection.set(new Set());
}

/**
 * Clear all pasted strokes
 */
export function clearPastedStrokes() {
  pastedStrokes.set([]);
  pastedSelection.set(new Set());
}

/**
 * Get pasted strokes formatted for saving as a new page
 * Applies offsets to create final coordinates
 * @param {number} book - Target book number
 * @param {number} page - Target page number
 */
export function getPastedAsNewPage(book, page) {
  const strokes = get(pastedStrokes);
  
  return strokes.map(stroke => ({
    ...stroke,
    pageInfo: {
      section: 0,
      owner: 0,
      book: book,
      page: page
    },
    // Apply offset to dotArray coordinates
    dotArray: stroke.dotArray.map(dot => ({
      ...dot,
      x: dot.x + (stroke._offset?.x || 0),
      y: dot.y + (stroke._offset?.y || 0)
    })),
    // Remove pasted metadata
    _pasted: undefined,
    _pastedAt: undefined,
    _offset: undefined
  }));
}

// Helper: Normalize coordinates and apply initial offset
function normalizeAndOffset(strokes, offset) {
  // Find bounds
  let minX = Infinity, minY = Infinity;
  strokes.forEach(stroke => {
    stroke.dotArray?.forEach(dot => {
      minX = Math.min(minX, dot.x);
      minY = Math.min(minY, dot.y);
    });
  });
  
  return strokes.map(stroke => ({
    ...stroke,
    pageInfo: null,  // Detach from original page
    _pasted: true,
    _pastedAt: Date.now(),
    _sourcePageInfo: stroke.pageInfo,  // Remember where it came from
    // Normalize coordinates (start from 0,0) then apply offset
    dotArray: stroke.dotArray.map(dot => ({
      ...dot,
      x: dot.x - minX,
      y: dot.y - minY
    })),
    _offset: { ...offset }
  }));
}
```

#### Clipboard Store

```javascript
// src/stores/clipboard.js

import { writable, derived } from 'svelte/store';

export const clipboardStrokes = writable([]);

export const hasClipboardContent = derived(
  clipboardStrokes,
  $strokes => $strokes.length > 0
);

export function copyToClipboard(strokes) {
  // Deep clone to avoid mutation
  const cloned = strokes.map(stroke => ({
    ...stroke,
    pageInfo: stroke.pageInfo ? { ...stroke.pageInfo } : null,
    dotArray: stroke.dotArray.map(dot => ({ ...dot }))
  }));
  
  clipboardStrokes.set(cloned);
}

export function clearClipboard() {
  clipboardStrokes.set([]);
}
```

### Rendering Approach

The `StrokeCanvas` will render both:
1. **Original strokes** - from `strokes` store, grouped by page, with page borders
2. **Pasted strokes** - from `pastedStrokes` store, rendered separately with visual distinction

```javascript
// In StrokeCanvas.svelte renderStrokes function:

function renderStrokes(fullReset = false) {
  // ... existing setup ...
  
  // 1. Draw original page strokes (existing logic)
  visibleStrokes.forEach((stroke, index) => {
    const fullIndex = visibleToFullIndexMap[index];
    const isSelected = $selectedIndices.has(fullIndex);
    const isDeleted = $deletedIndices.has(fullIndex);
    renderer.drawStroke(stroke, isSelected, false, isDeleted);
  });
  
  // 2. Draw pasted strokes (NEW)
  $pastedStrokes.forEach((stroke, index) => {
    const isSelected = $pastedSelection.has(index);
    renderer.drawPastedStroke(stroke, isSelected);
  });
}
```

#### New Renderer Method: `drawPastedStroke`

```javascript
// In canvas-renderer.js

/**
 * Draw a pasted stroke with offset applied
 * Visual distinction: dashed border or different color when selected
 */
drawPastedStroke(stroke, highlighted = false) {
  const dots = stroke.dotArray || [];
  if (dots.length < 2) return;
  
  const offset = stroke._offset || { x: 0, y: 0 };
  
  // Apply offset to coordinates during rendering
  const color = highlighted ? '#4ade80' : '#333333';  // Green when selected
  const baseWidth = highlighted ? 3 : 2;
  
  this.ctx.strokeStyle = color;
  this.ctx.lineCap = 'round';
  this.ctx.lineJoin = 'round';
  this.ctx.setLineDash([]);  // Solid line
  
  this.ctx.beginPath();
  
  // Transform first dot with offset
  const firstDot = { 
    x: dots[0].x + offset.x, 
    y: dots[0].y + offset.y,
    f: dots[0].f 
  };
  const firstScreen = this.ncodeToScreenDirect(firstDot);
  this.ctx.moveTo(firstScreen.x, firstScreen.y);
  
  for (let i = 1; i < dots.length; i++) {
    const dot = {
      x: dots[i].x + offset.x,
      y: dots[i].y + offset.y,
      f: dots[i].f
    };
    const screenDot = this.ncodeToScreenDirect(dot);
    this.ctx.lineWidth = Math.max(0.5, ((dot.f || 500) / 500) * baseWidth * this.zoom);
    this.ctx.lineTo(screenDot.x, screenDot.y);
  }
  
  this.ctx.stroke();
}

/**
 * Convert ncode to screen without page offset lookup
 * Used for pasted strokes that aren't attached to a page
 */
ncodeToScreenDirect(dot) {
  const x = dot.x * this.scale * this.zoom + this.panX;
  const y = dot.y * this.scale * this.zoom + this.panY;
  return { x, y, pressure: dot.f };
}
```

### Interaction Handling

#### Mouse Events for Pasted Strokes

```javascript
// In StrokeCanvas.svelte

let isDraggingPasted = false;
let dragStartX = 0;
let dragStartY = 0;

function handleMouseDown(event) {
  // ... existing pan/box-select/page-drag logic ...
  
  // Check if clicking on a pasted stroke
  if (event.button === 0 && !event.altKey) {
    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    const pastedIndex = renderer.hitTestPasted(x, y, $pastedStrokes);
    
    if (pastedIndex !== -1) {
      event.preventDefault();
      
      // Handle selection
      if (event.ctrlKey || event.metaKey) {
        // Toggle selection
        pastedSelection.update(sel => {
          const newSel = new Set(sel);
          if (newSel.has(pastedIndex)) {
            newSel.delete(pastedIndex);
          } else {
            newSel.add(pastedIndex);
          }
          return newSel;
        });
      } else if (!$pastedSelection.has(pastedIndex)) {
        // Replace selection
        pastedSelection.set(new Set([pastedIndex]));
      }
      
      // Start drag if selected
      if ($pastedSelection.size > 0) {
        isDraggingPasted = true;
        dragStartX = event.clientX;
        dragStartY = event.clientY;
        canvasElement.style.cursor = 'move';
      }
      
      return;
    }
  }
  
  // ... rest of existing logic ...
}

function handleMouseMove(event) {
  // Handle dragging pasted strokes
  if (isDraggingPasted && $pastedSelection.size > 0) {
    const deltaX = event.clientX - dragStartX;
    const deltaY = event.clientY - dragStartY;
    
    // Convert screen delta to Ncode delta
    const ncodeDeltaX = deltaX / (renderer.scale * renderer.zoom);
    const ncodeDeltaY = deltaY / (renderer.scale * renderer.zoom);
    
    movePastedStrokes(ncodeDeltaX, ncodeDeltaY);
    
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    
    renderStrokes(false);
    return;
  }
  
  // ... existing logic ...
}

function handleMouseUp(event) {
  if (isDraggingPasted) {
    isDraggingPasted = false;
    canvasElement.style.cursor = 'default';
    return;
  }
  
  // ... existing logic ...
}
```

### New Page Creation Dialog

```svelte
<!-- src/components/dialog/CreatePageDialog.svelte -->

<script>
  import { pastedStrokes, getPastedAsNewPage, clearPastedStrokes } from '$stores/pasted-strokes.js';
  import { saveStrokesToLogSeq } from '$lib/logseq-api.js';
  import { log } from '$stores';
  
  export let isOpen = false;
  
  let bookNumber = '';
  let pageNumber = '';
  let isSaving = false;
  let error = '';
  
  $: strokeCount = $pastedStrokes.length;
  $: canSave = bookNumber && pageNumber && strokeCount > 0;
  
  function close() {
    isOpen = false;
    bookNumber = '';
    pageNumber = '';
    error = '';
  }
  
  async function handleCreate() {
    if (!canSave) return;
    
    const book = parseInt(bookNumber, 10);
    const page = parseInt(pageNumber, 10);
    
    if (isNaN(book) || isNaN(page) || book < 0 || page < 0) {
      error = 'Please enter valid book and page numbers';
      return;
    }
    
    isSaving = true;
    error = '';
    
    try {
      // Get strokes formatted for the new page
      const newPageStrokes = getPastedAsNewPage(book, page);
      
      // Save to LogSeq
      await saveStrokesToLogSeq(newPageStrokes, book, page);
      
      log(`Created new page B${book}/P${page} with ${strokeCount} strokes`, 'success');
      
      // Clear pasted strokes after successful save
      clearPastedStrokes();
      close();
      
    } catch (err) {
      error = `Failed to save: ${err.message}`;
      log(`Failed to create page: ${err.message}`, 'error');
    } finally {
      isSaving = false;
    }
  }
</script>

{#if isOpen}
  <div class="dialog-overlay" on:click={close}>
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-header">
        <h3>Create New Page</h3>
        <button class="close-btn" on:click={close}>×</button>
      </div>
      
      <div class="dialog-content">
        <p class="info">
          Save {strokeCount} pasted stroke{strokeCount !== 1 ? 's' : ''} as a new page in LogSeq.
        </p>
        
        <div class="form-row">
          <label>
            Book Number
            <input 
              type="number" 
              bind:value={bookNumber}
              placeholder="e.g., 200"
              min="0"
            />
          </label>
          
          <label>
            Page Number
            <input 
              type="number" 
              bind:value={pageNumber}
              placeholder="e.g., 1"
              min="0"
            />
          </label>
        </div>
        
        {#if error}
          <p class="error">{error}</p>
        {/if}
        
        <p class="hint">
          This will create a new page entry at <code>B{bookNumber || '?'}/P{pageNumber || '?'}</code>
          and save the stroke data to LogSeq.
        </p>
      </div>
      
      <div class="dialog-actions">
        <button class="btn btn-secondary" on:click={close}>Cancel</button>
        <button 
          class="btn btn-primary" 
          on:click={handleCreate}
          disabled={!canSave || isSaving}
        >
          {isSaving ? 'Saving...' : 'Create Page'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  
  .dialog {
    background: var(--bg-secondary);
    border-radius: 12px;
    border: 1px solid var(--border);
    width: 400px;
    max-width: 90vw;
  }
  
  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border);
  }
  
  .dialog-header h3 {
    margin: 0;
    font-size: 1.1rem;
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 1.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  
  .close-btn:hover {
    color: var(--text-primary);
  }
  
  .dialog-content {
    padding: 20px;
  }
  
  .info {
    margin: 0 0 16px;
    color: var(--text-secondary);
  }
  
  .form-row {
    display: flex;
    gap: 16px;
  }
  
  .form-row label {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }
  
  .form-row input {
    padding: 10px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--bg-tertiary);
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  .form-row input:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  .error {
    color: var(--error);
    font-size: 0.85rem;
    margin: 12px 0 0;
  }
  
  .hint {
    margin: 16px 0 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  
  .hint code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: 4px;
  }
  
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 16px 20px;
    border-top: 1px solid var(--border);
  }
</style>
```

### Toolbar Updates

Add new buttons to StrokeCanvas header:

```svelte
<!-- In StrokeCanvas.svelte header-actions -->

<div class="header-actions">
  <!-- Existing buttons... -->
  
  {#if $selectionCount > 0}
    <button 
      class="header-btn copy-btn"
      on:click={handleCopy}
      title="Copy selected strokes (Ctrl+C)"
    >
      📋 Copy
    </button>
  {/if}
  
  {#if $hasClipboardContent}
    <button 
      class="header-btn paste-btn"
      on:click={handlePaste}
      title="Paste strokes (Ctrl+V)"
    >
      📥 Paste
    </button>
  {/if}
  
  {#if $pastedCount > 0}
    <button 
      class="header-btn group-btn"
      on:click={() => showCreatePageDialog = true}
      title="Group pasted strokes as a new page"
    >
      📄 Save as Page...
    </button>
    
    <button 
      class="header-btn clear-pasted-btn"
      on:click={clearPastedStrokes}
      title="Clear all pasted strokes"
    >
      🗑️ Clear Pasted
    </button>
  {/if}
</div>
```

---

## Technical Requirements

### Coordinate System

**Challenge:** Pasted strokes need to be positioned independently of page offsets.

**Solution:** Pasted strokes use a direct coordinate system:
- On paste: Normalize coordinates (subtract min bounds)
- Store `_offset` for position adjustments
- Render using `ncodeToScreenDirect()` which bypasses page offset lookup

```
Original stroke (in page):
  pageInfo: { book: 161, page: 1 }
  dot.x = 150.5  (absolute Ncode in page context)
  
Pasted stroke (free-floating):
  pageInfo: null
  dot.x = 0.0    (normalized to 0)
  _offset.x = 50 (user moved it)
  
  Rendered at: (0 + 50) * scale * zoom + panX
```

### Hit Testing

New method to detect clicks on pasted strokes:

```javascript
// In canvas-renderer.js

hitTestPasted(screenX, screenY, pastedStrokes) {
  const hitRadius = 10 / this.zoom;
  
  // Test in reverse order (top strokes first)
  for (let i = pastedStrokes.length - 1; i >= 0; i--) {
    const stroke = pastedStrokes[i];
    const dots = stroke.dotArray || [];
    const offset = stroke._offset || { x: 0, y: 0 };
    
    for (const dot of dots) {
      const screenDot = this.ncodeToScreenDirect({
        x: dot.x + offset.x,
        y: dot.y + offset.y,
        f: dot.f
      });
      
      const dx = screenDot.x - screenX;
      const dy = screenDot.y - screenY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= hitRadius) {
        return i;
      }
    }
  }
  
  return -1;
}
```

### Visual Distinction

Pasted strokes should be visually distinguishable from original page strokes:

| State | Original Strokes | Pasted Strokes |
|-------|------------------|----------------|
| Normal | Black, solid | Dark gray, solid |
| Selected | Red (#e94560) | Green (#4ade80) |
| Hover | - | Subtle highlight |

Optional: Draw a subtle bounding box around all pasted strokes to indicate "composition area."

### LogSeq Integration

New function to save pasted strokes as a page:

```javascript
// In logseq-api.js

/**
 * Save stroke data to LogSeq as a new page
 * @param {Array} strokes - Strokes with applied coordinates
 * @param {number} book - Book number
 * @param {number} page - Page number
 */
export async function saveStrokesToLogSeq(strokes, book, page) {
  const pageTitle = `Handwriting/B${book}/P${page}`;
  
  // Create or get page
  const pageData = await getOrCreatePage(pageTitle);
  
  // Store stroke data in chunks (reuse existing chunked storage pattern)
  await storeStrokeChunks(pageData.uuid, strokes);
  
  // Optionally trigger transcription
  // ...
}
```

---

## Implementation Complexity

### Effort Estimates

| Component | Complexity | Hours | Dependencies |
|-----------|------------|-------|--------------|
| `clipboard.js` store | Low | 1-2 | None |
| `pasted-strokes.js` store | Medium | 3-4 | None |
| Renderer: `drawPastedStroke()` | Low | 2-3 | None |
| Renderer: `hitTestPasted()` | Low | 1-2 | None |
| Renderer: `ncodeToScreenDirect()` | Low | 1 | None |
| StrokeCanvas: Copy/Paste handlers | Medium | 3-4 | Stores |
| StrokeCanvas: Drag pasted strokes | Medium | 4-5 | Stores, Renderer |
| StrokeCanvas: Selection integration | Medium | 3-4 | Stores |
| CreatePageDialog component | Medium | 3-4 | Stores, LogSeq API |
| LogSeq save integration | Medium | 3-4 | Existing patterns |
| UI polish & testing | Medium | 4-6 | All components |

**Total Estimated Effort:** 28-38 hours (4-5 days)

---

## Risk Assessment

### Low Risk ✅

1. **Data Isolation** - Pasted strokes are in a separate store. Original strokes are never modified.

2. **Renderer Extension** - Adding new draw methods is straightforward and doesn't affect existing rendering.

3. **Selection System** - Parallel selection tracking for pasted strokes avoids conflicts.

### Medium Risk 🟡

1. **Interaction Complexity** - Users need to understand the difference between original (locked) and pasted (movable) strokes.
   - **Mitigation:** Clear visual distinction, helpful tooltips, status indicators.

2. **Coordinate Edge Cases** - Very large paste operations or extreme zoom levels could cause rendering issues.
   - **Mitigation:** Test with large stroke counts, add bounds checking.

3. **Hit Testing Priority** - Need to decide: if pasted stroke overlaps original, which gets selected?
   - **Mitigation:** Pasted strokes take priority (they're "on top").

### Potential Issues

1. **Accidental Clear** - User might accidentally clear pasted strokes before saving.
   - **Mitigation:** Confirmation dialog for clear action.

2. **Book/Page Conflicts** - User might enter a book/page that already exists.
   - **Mitigation:** Check for conflicts and warn before overwriting.

3. **Large Pastes** - Pasting hundreds of strokes could be slow.
   - **Mitigation:** Use batch rendering, consider progress indicator.

---

## Implementation Roadmap

### Phase 1: Core Stores (4-6 hours)

**Goal:** Clipboard and pasted strokes data management

**Tasks:**
1. Create `src/stores/clipboard.js`
   - `clipboardStrokes` writable
   - `copyToClipboard()` function
   - `hasClipboardContent` derived

2. Create `src/stores/pasted-strokes.js`
   - `pastedStrokes` writable
   - `pastedSelection` writable
   - `pasteStrokes()`, `movePastedStrokes()`, `clearPastedStrokes()`
   - `getPastedAsNewPage()` for export

3. Add exports to `src/stores/index.js`

**Deliverable:** Stores ready for integration

### Phase 2: Rendering (5-7 hours)

**Goal:** Display pasted strokes in canvas

**Tasks:**
1. Add `ncodeToScreenDirect()` to canvas-renderer.js
2. Add `drawPastedStroke()` method
3. Add `hitTestPasted()` method
4. Modify `StrokeCanvas.svelte` to render pasted strokes
5. Add visual distinction (green selection color)

**Deliverable:** Pasted strokes visible and selectable

### Phase 3: Interaction (8-10 hours)

**Goal:** Copy, paste, and drag functionality

**Tasks:**
1. Add copy handler (Ctrl+C, button)
2. Add paste handler (Ctrl+V, button)
3. Implement pasted stroke selection
4. Implement drag-to-move for pasted strokes
5. Add delete selected (Delete key)
6. Add clear all pasted button

**Deliverable:** Full copy/paste/move workflow

### Phase 4: Save to LogSeq (6-8 hours)

**Goal:** Create new pages from pasted strokes

**Tasks:**
1. Create `CreatePageDialog.svelte`
2. Add book/page input validation
3. Implement `saveStrokesToLogSeq()` in logseq-api.js
4. Handle success/error states
5. Clear pasted strokes after successful save

**Deliverable:** Complete end-to-end workflow

### Phase 5: Polish (4-6 hours)

**Goal:** Production-ready feature

**Tasks:**
1. Add confirmation for destructive actions
2. Improve visual feedback (toast notifications)
3. Add keyboard shortcuts help
4. Test edge cases (large pastes, zoom extremes)
5. Update documentation

**Deliverable:** Feature ready for use

---

## Appendix A: Keyboard Shortcuts

| Shortcut | Context | Action |
|----------|---------|--------|
| Ctrl+C | Any stroke selected | Copy to clipboard |
| Ctrl+V | Clipboard has content | Paste strokes |
| Delete | Pasted stroke selected | Delete selected pasted |
| Escape | Pasted stroke selected | Clear pasted selection |
| Ctrl+A | Canvas focused | Select all (original behavior) |

---

## Appendix B: Visual Mockup

```
┌──────────────────────────────────────────────────────────────────────┐
│  SmartPen-LogSeq Bridge                              [Connect Pen]   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ Stroke Preview        [📋 Copy] [📥 Paste] [📄 Save as Page...]││
│  │                                            [🗑️ Clear Pasted]   ││
│  │ ┌─────────────────────────────────────────────────────────────┐ ││
│  │ │                                                             │ ││
│  │ │  ┌─────────────┐  ┌─────────────┐                          │ ││
│  │ │  │ B161/P1     │  │ B161/P2     │   ← Original pages       │ ││
│  │ │  │ ☐ Task A    │  │ Meeting     │     (locked, red select) │ ││
│  │ │  │ ☐ Task B    │  │ notes...    │                          │ ││
│  │ │  └─────────────┘  └─────────────┘                          │ ││
│  │ │                                                             │ ││
│  │ │                    ☐ Task A    ← Pasted stroke              │ ││
│  │ │                    ╭─────────╮   (movable, green select)    │ ││
│  │ │                    │ Meeting │ ← Selected pasted group      │ ││
│  │ │                    │ notes   │   (can drag to move)         │ ││
│  │ │                    ╰─────────╯                              │ ││
│  │ │                                                             │ ││
│  │ │  Pasted: 3 strokes • Drag pasted strokes to reposition     │ ││
│  │ └─────────────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────────────┘│
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: State Diagram

```
                    ┌─────────────┐
                    │   IDLE      │
                    │ (no pasted) │
                    └──────┬──────┘
                           │ Paste
                           ▼
                    ┌─────────────┐
           ┌───────▶│  HAS PASTED │◀───────┐
           │        │  (movable)  │        │
           │        └──────┬──────┘        │
           │               │               │
      Paste more      Select + Drag    Deselect
           │               │               │
           │               ▼               │
           │        ┌─────────────┐        │
           └────────│  DRAGGING   │────────┘
                    │  (moving)   │
                    └──────┬──────┘
                           │ Mouse up
                           ▼
                    ┌─────────────┐
                    │  HAS PASTED │
                    │ (new pos)   │
                    └──────┬──────┘
                           │ Save as Page
                           ▼
                    ┌─────────────┐
                    │   SAVING    │
                    └──────┬──────┘
                           │ Success
                           ▼
                    ┌─────────────┐
                    │    IDLE     │
                    │ (cleared)   │
                    └─────────────┘
```

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | Jan 2026 | Initial feasibility analysis (separate canvas) |
| 1.1.0 | Jan 2026 | Updated: unified canvas, individual stroke movement, save as page |

---

## Conclusion

The unified canvas approach with individually movable pasted strokes is **technically feasible** and provides a more intuitive user experience than a separate composition canvas. The key architectural insight is maintaining two parallel data structures (original strokes and pasted strokes) that render to the same canvas with distinct visual treatment and interaction behaviors.

**Key Benefits of This Approach:**
- Single canvas view - no context switching
- Clear visual distinction between locked originals and movable pastes
- Flexible composition - arrange strokes freely
- User-defined page creation for organized storage

**Total estimated effort: 28-38 hours** for full implementation.
