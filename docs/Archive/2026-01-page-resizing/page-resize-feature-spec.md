# Page Corner Resize Feature - Feasibility Specification

**Version:** 1.0  
**Date:** January 2026  
**Status:** Feasibility Analysis

---

## Table of Contents

1. [Overview](#overview)
2. [Current State Analysis](#current-state-analysis)
3. [Feature Requirements](#feature-requirements)
4. [Technical Design](#technical-design)
5. [Implementation Approach](#implementation-approach)
6. [Feasibility Assessment](#feasibility-assessment)
7. [Risks and Challenges](#risks-and-challenges)
8. [Implementation Timeline](#implementation-timeline)
9. [Alternatives Considered](#alternatives-considered)
10. [Recommendations](#recommendations)

---

## Overview

### Purpose

Enable users to resize page boundaries within the stroke preview canvas by dragging corner handles. This would allow for:
- Adjusting page display size for better visualization
- Fitting multiple pages within view at different scales
- Creating custom layouts with pages at varying sizes

### Current Capability

The application currently supports:
- **Page dragging**: Click and drag page labels to reposition entire pages
- **Global zoom**: Ctrl+scroll to zoom the entire canvas
- **Page positioning**: Custom X,Y coordinates stored in Ncode space per page

### Proposed Enhancement

Add interactive corner handles to each page border that allow users to:
- Click and drag corners to resize the page bounding box
- Maintain or adjust aspect ratio during resize
- Persist resize scaling per page
- Visually distinguish resized pages from original size

---

## Current State Analysis

### Existing Architecture

#### Canvas Rendering (`canvas-renderer.js`)

**Page Border System:**
```javascript
drawPageBorders() {
  this.pageOffsets.forEach((offset, pageKey) => {
    const { offsetX, offsetY, bounds } = offset;
    
    // Calculate screen coordinates
    const left = offsetX * this.scale * this.zoom + this.panX;
    const top = offsetY * this.scale * this.zoom + this.panY;
    const width = (bounds.maxX - bounds.minX) * this.scale * this.zoom;
    const height = (bounds.maxY - bounds.minY) * this.scale * this.zoom;
    
    // Draw border and label
    this.ctx.strokeRect(left, top, width, height);
  });
}
```

**Key Data Structures:**
- `pageOffsets`: Map of pageKey → `{offsetX, offsetY, bounds}`
- `bounds`: Contains `{minX, minY, maxX, maxY}` in Ncode units
- `scale`: Fixed conversion factor (2.371) from Ncode to mm
- `zoom`: Global zoom level applied to all pages

#### Page Positioning (`page-order.js`)

**Current Storage:**
```javascript
// Persisted to localStorage
pagePositions = {
  "S3/O27/B161/P1": { x: 1000, y: 500 },  // Ncode coordinates
  "S3/O27/B161/P2": { x: 2500, y: 500 }
}
```

**Capabilities:**
- Store custom X,Y position per page (Ncode space)
- Enable/disable custom positioning
- Reset to automatic horizontal layout

#### Stroke Canvas (`StrokeCanvas.svelte`)

**Existing Mouse Handlers:**
```javascript
// Page dragging (lines 385-394)
handleMouseDown(event) {
  const pageKey = renderer.hitTestPageHeader(x, y);
  if (pageKey) {
    isDraggingPage = true;
    // Drag logic...
  }
}
```

**Hit Testing:**
- `hitTestPageHeader()`: Detects clicks on page label region (30px tall)
- `hitTest()`: Detects clicks on individual strokes
- No current hit testing for corner regions

---

## Feature Requirements

### Functional Requirements

1. **Corner Handle Visualization**
   - Display visible corner handles on each page border
   - Handles appear on hover or when page is selected
   - Minimum size: 8x8px for easy clicking
   - Distinct visual style (filled circles, squares, or icons)

2. **Resize Interaction**
   - Click and drag any corner to resize
   - Live preview during drag (show resize outline)
   - Release to commit resize
   - Escape to cancel ongoing resize

3. **Resize Behavior Options**
   
   **Option A: Scale Display Only (Non-destructive)**
   - Store scale factor per page (e.g., 1.5x, 0.75x)
   - Apply scale factor during rendering
   - Original stroke data unchanged
   - Can reset to 1.0x at any time
   
   **Option B: Scale Strokes (Destructive)**
   - Multiply all stroke dot coordinates by scale factor
   - Permanently modifies stroke data
   - Cannot undo (unless tracked separately)
   - Affects transcription results

4. **Aspect Ratio Handling**
   - **Shift+Drag**: Maintain original aspect ratio
   - **Default Drag**: Free resize (any aspect ratio)

5. **Minimum/Maximum Constraints**
   - Minimum size: 50x50px screen space
   - Maximum size: 5x original size
   - Prevents invisible or unmanageable pages

6. **Visual Feedback**
   - Cursor changes to resize cursors (nwse-resize, nesw-resize)
   - Ghost outline shows new size during drag
   - Corner handles highlight on hover

### Non-Functional Requirements

1. **Performance**
   - Smooth dragging at 60fps
   - Efficient redraw only affected regions
   - No lag with 100+ strokes per page

2. **Persistence**
   - Scale factors persist across sessions
   - Stored in localStorage alongside page positions
   - Clear association between page and its scale

3. **Compatibility**
   - Works with existing page drag feature
   - Compatible with global zoom (scale is independent)
   - Doesn't break transcription or export

4. **Discoverability**
   - Visible affordance (handles or hover state)
   - Tooltip on hover explaining function
   - Consistent with existing interaction patterns

---

## Technical Design

### Recommended Approach: Scale Display (Non-Destructive)

**Rationale:**
- Preserves original stroke data integrity
- Reversible (can reset to 1.0x)
- Doesn't affect transcription accuracy
- Simpler to implement and reason about
- Consistent with "preview" nature of canvas

### Data Model Extension

#### Page Scale Store (`page-scale.js`)

```javascript
// New store in src/stores/page-scale.js
import { writable, derived, get } from 'svelte/store';

// Map of pageKey -> scale factor (default: 1.0)
export const pageScales = writable(
  JSON.parse(localStorage.getItem('pageScales') || '{}')
);

// Persist to localStorage
pageScales.subscribe(scales => {
  localStorage.setItem('pageScales', JSON.stringify(scales));
});

export function setPageScale(pageKey, scale) {
  pageScales.update(scales => ({
    ...scales,
    [pageKey]: Math.max(0.25, Math.min(5.0, scale))
  }));
}

export function getPageScale(pageKey) {
  return get(pageScales)[pageKey] || 1.0;
}

export function resetPageScale(pageKey) {
  pageScales.update(scales => {
    const newScales = { ...scales };
    delete newScales[pageKey];
    return newScales;
  });
}
```

### Renderer Modifications

#### Corner Handle Drawing

```javascript
// In canvas-renderer.js
drawPageBorders() {
  this.pageOffsets.forEach((offset, pageKey) => {
    // ... existing border drawing ...
    
    // Draw corner handles if enabled
    if (this.showCornerHandles) {
      this.drawCornerHandles(pageKey, left, top, width, height);
    }
  });
}

drawCornerHandles(pageKey, left, top, width, height) {
  const handleSize = 8;
  const handles = [
    { x: left, y: top, corner: 'nw' },
    { x: left + width, y: top, corner: 'ne' },
    { x: left, y: top + height, corner: 'sw' },
    { x: left + width, y: top + height, corner: 'se' }
  ];
  
  handles.forEach(h => {
    // Draw filled circle
    this.ctx.fillStyle = 'rgba(233, 69, 96, 0.8)';
    this.ctx.beginPath();
    this.ctx.arc(h.x, h.y, handleSize / 2, 0, Math.PI * 2);
    this.ctx.fill();
    
    // Store for hit testing
    if (!this.cornerHandles) this.cornerHandles = new Map();
    if (!this.cornerHandles.has(pageKey)) {
      this.cornerHandles.set(pageKey, []);
    }
    this.cornerHandles.get(pageKey).push({
      x: h.x,
      y: h.y,
      corner: h.corner,
      radius: handleSize
    });
  });
}
```

#### Hit Testing for Corners

```javascript
// In canvas-renderer.js
hitTestCorner(x, y) {
  if (!this.cornerHandles) return null;
  
  for (const [pageKey, handles] of this.cornerHandles) {
    for (const handle of handles) {
      const dx = x - handle.x;
      const dy = y - handle.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= handle.radius) {
        return { pageKey, corner: handle.corner, handle };
      }
    }
  }
  
  return null;
}
```

#### Scale Application During Rendering

```javascript
// In canvas-renderer.js
ncodeToScreen(dot, pageInfo = null) {
  // ... existing offset calculation ...
  
  // Apply per-page scale if available
  let pageScale = 1.0;
  if (pageInfo && this.pageScales) {
    const pageKey = `S${pageInfo.section || 0}/O${pageInfo.owner || 0}/B${pageInfo.book}/P${pageInfo.page}`;
    pageScale = this.pageScales[pageKey] || 1.0;
  }
  
  // Transform with scale
  x = (dot.x - bounds.minX + offsetX) * this.scale * pageScale;
  y = (dot.y - bounds.minY + offsetY) * this.scale * pageScale;
  
  // Apply zoom and pan
  return {
    x: x * this.zoom + this.panX,
    y: y * this.zoom + this.panY
  };
}

// Also update bounds calculation to account for scale
getPageBoundsScreen(pageKey) {
  const offset = this.pageOffsets.get(pageKey);
  if (!offset) return null;
  
  const pageScale = this.pageScales?.[pageKey] || 1.0;
  const { offsetX, offsetY, bounds } = offset;
  
  const width = (bounds.maxX - bounds.minX) * this.scale * pageScale * this.zoom;
  const height = (bounds.maxY - bounds.minY) * this.scale * pageScale * this.zoom;
  const left = offsetX * this.scale * pageScale * this.zoom + this.panX;
  const top = offsetY * this.scale * pageScale * this.zoom + this.panY;
  
  return { left, top, right: left + width, bottom: top + height, width, height };
}
```

### Canvas Component Integration

#### Mouse Event Handlers

```javascript
// In StrokeCanvas.svelte

// State for corner resize
let isResizingPage = false;
let resizeStartX = 0;
let resizeStartY = 0;
let resizePageKey = null;
let resizeCorner = null;
let resizeOriginalBounds = null;
let resizeOriginalScale = 1.0;
let resizePreviewScale = 1.0;

function handleMouseDown(event) {
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  
  // Check for corner handle first (highest priority)
  if (renderer && !event.ctrlKey && !event.shiftKey) {
    const cornerHit = renderer.hitTestCorner(x, y);
    if (cornerHit) {
      event.preventDefault();
      isResizingPage = true;
      resizeStartX = event.clientX;
      resizeStartY = event.clientY;
      resizePageKey = cornerHit.pageKey;
      resizeCorner = cornerHit.corner;
      resizeOriginalBounds = renderer.getPageBoundsScreen(resizePageKey);
      resizeOriginalScale = getPageScale(resizePageKey);
      resizePreviewScale = resizeOriginalScale;
      return;
    }
  }
  
  // ... existing page header drag check ...
  // ... existing pan/select logic ...
}

function handleMouseMove(event) {
  if (isResizingPage && renderer && resizePageKey) {
    const deltaX = event.clientX - resizeStartX;
    const deltaY = event.clientY - resizeStartY;
    
    // Calculate new scale based on corner and delta
    const newScale = calculateScaleFromDrag(
      resizeCorner,
      deltaX,
      deltaY,
      resizeOriginalBounds,
      resizeOriginalScale,
      event.shiftKey  // Maintain aspect ratio
    );
    
    // Update preview
    resizePreviewScale = newScale;
    renderer.setTempPageScale(resizePageKey, newScale);
    renderStrokes();
    return;
  }
  
  // ... existing pan/drag logic ...
  
  // Update cursor for corner hover
  if (!isResizingPage && !isDraggingPage && !isPanning && renderer) {
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const cornerHit = renderer.hitTestCorner(x, y);
    
    if (cornerHit) {
      // Set resize cursor based on corner
      const cursors = {
        'nw': 'nwse-resize',
        'ne': 'nesw-resize',
        'sw': 'nesw-resize',
        'se': 'nwse-resize'
      };
      canvasElement.style.cursor = cursors[cornerHit.corner];
    } else if (canvasElement.style.cursor.includes('resize')) {
      canvasElement.style.cursor = 'default';
    }
  }
}

function handleMouseUp(event) {
  if (isResizingPage && resizePageKey) {
    // Commit the resize
    setPageScale(resizePageKey, resizePreviewScale);
    renderer.clearTempPageScale();
    log(`Resized ${resizePageKey} to ${(resizePreviewScale * 100).toFixed(0)}%`, 'info');
    
    isResizingPage = false;
    resizePageKey = null;
    resizeCorner = null;
    canvasElement.style.cursor = 'default';
    return;
  }
  
  // ... existing mouse up logic ...
}

// Helper to calculate scale from drag delta
function calculateScaleFromDrag(corner, deltaX, deltaY, originalBounds, originalScale, maintainAspectRatio) {
  const { width, height } = originalBounds;
  
  // Determine which dimension to use based on corner
  let scaleChange = 0;
  
  if (maintainAspectRatio) {
    // Use diagonal distance
    const diagonal = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const sign = (corner === 'se' || corner === 'nw') ? 1 : -1;
    scaleChange = (diagonal * sign) / Math.max(width, height);
  } else {
    // Free resize - use larger dimension change
    const xChange = deltaX / width;
    const yChange = deltaY / height;
    scaleChange = Math.max(Math.abs(xChange), Math.abs(yChange)) * Math.sign(xChange + yChange);
  }
  
  const newScale = originalScale + scaleChange;
  
  // Clamp to reasonable range
  return Math.max(0.25, Math.min(5.0, newScale));
}
```

### UI Enhancements

#### Reset Scale Button

Add to page controls or context menu:
```svelte
{#if $useCustomPositions || hasAnyScaledPages()}
  <button 
    class="header-btn layout-btn" 
    on:click={resetAllScales}
    title="Reset all pages to original size"
  >
    📏 Reset Sizes
  </button>
{/if}
```

#### Scale Indicator

Show current scale in page label:
```javascript
// In drawPageBorders
const scale = this.pageScales?.[pageKey] || 1.0;
if (scale !== 1.0) {
  const scaleText = `${(scale * 100).toFixed(0)}%`;
  this.ctx.fillText(`${label} (${scaleText})`, left + 4, labelY);
}
```

---

## Implementation Approach

### Phase 1: Foundation (2-3 hours)

1. **Create page-scale.js store**
   - Define writable store for page scales
   - Add persistence to localStorage
   - Export helper functions (get, set, reset)

2. **Add scale storage to renderer**
   - Add `pageScales` property to CanvasRenderer
   - Modify `ncodeToScreen()` to apply per-page scale
   - Update `getPageBoundsScreen()` to account for scale

3. **Basic testing**
   - Manually set scale via console
   - Verify strokes render at correct size
   - Confirm bounds calculations are accurate

### Phase 2: Corner Handles (3-4 hours)

1. **Implement corner handle rendering**
   - Add `drawCornerHandles()` method
   - Create corner handle data structure
   - Show handles on all visible pages

2. **Add hit testing**
   - Implement `hitTestCorner()` method
   - Test with various zoom levels and pan positions
   - Verify accuracy at page edges

3. **Visual polish**
   - Design handle appearance (size, color, shape)
   - Add hover state (larger or different color)
   - Ensure visibility against page borders

### Phase 3: Resize Interaction (4-5 hours)

1. **Mouse event handling**
   - Add resize state variables to StrokeCanvas
   - Implement mousedown corner detection
   - Wire up mousemove for drag preview
   - Handle mouseup to commit resize

2. **Scale calculation**
   - Implement `calculateScaleFromDrag()` helper
   - Handle all four corners correctly
   - Add aspect ratio lock (Shift key)
   - Apply min/max constraints

3. **Live preview**
   - Show resize outline during drag
   - Update corner positions during drag
   - Smooth rendering at 60fps

### Phase 4: Polish & Integration (2-3 hours)

1. **UI additions**
   - Add reset scale button
   - Show scale percentage in page labels
   - Add cursor feedback (resize cursors)
   - Tooltip explanations

2. **Edge cases**
   - Handle resize during zoom changes
   - Coordinate with page dragging
   - Prevent conflicts with selection
   - Test with filtered pages

3. **Documentation**
   - Update user hints on canvas
   - Add to keyboard shortcuts list
   - Document in README

### Phase 5: Testing & Refinement (2-3 hours)

1. **Functional testing**
   - Test all four corners
   - Verify aspect ratio lock
   - Check persistence across reload
   - Test with multiple pages

2. **Performance testing**
   - Profile rendering with scaled pages
   - Ensure smooth dragging
   - Check memory usage

3. **UX refinement**
   - Adjust handle size for usability
   - Fine-tune scale calculation sensitivity
   - Improve visual feedback

**Total Estimated Time: 13-18 hours**

---

## Feasibility Assessment

### ✅ Highly Feasible Aspects

1. **Rendering System Ready**
   - Existing coordinate transformation pipeline easily accommodates scale factor
   - `ncodeToScreen()` already centralizes coordinate conversion
   - Canvas redraw system can handle incremental updates

2. **Storage Pattern Established**
   - `page-order.js` provides template for per-page state
   - localStorage persistence is proven
   - Store architecture supports new derived stores

3. **Mouse Interaction Framework Exists**
   - Page dragging demonstrates page-level interaction
   - Hit testing patterns are established
   - Event flow is well-structured

4. **Non-Destructive Approach**
   - Original stroke data remains unchanged
   - Can be toggled on/off easily
   - No impact on transcription or export

### ⚠️ Moderate Complexity Areas

1. **Corner Handle Positioning**
   - Must account for zoom and pan transformations
   - Need to track handles through viewport changes
   - Hit testing accuracy critical for UX

2. **Scale Calculation**
   - Different behavior for each corner
   - Aspect ratio math can be tricky
   - Need to feel natural and predictable

3. **Visual Feedback**
   - Live preview requires efficient redraw
   - Handle rendering adds overhead
   - Must remain performant with many pages

4. **Interaction Conflicts**
   - Must not interfere with stroke selection
   - Priority ordering with page drag, pan, select
   - Clear mode indication (what am I doing?)

### ⚠️ Minor Challenges

1. **Small Handle Targets**
   - 8x8px handles may be hard to click at low zoom
   - May need to scale with zoom or use larger hit areas
   - Accessibility consideration

2. **Mobile/Touch Support**
   - No touch events currently implemented
   - Corner handles may be too small for touch
   - Would require separate interaction pattern

3. **Multi-Select Resize**
   - Current spec doesn't address selecting multiple pages
   - Would require additional state management
   - Could be deferred to future enhancement

---

## Risks and Challenges

### Technical Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Performance degradation with many pages | Medium | Low | Profile early, optimize if needed |
| Zoom/pan coordinate math errors | High | Medium | Extensive testing, unit tests for transform |
| Handle occlusion by strokes | Low | Medium | Z-index ordering, render handles last |
| Conflict with existing interactions | Medium | Medium | Clear priority hierarchy, mode indication |

### UX Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Unintuitive resize behavior | High | Medium | User testing, adjust sensitivity |
| Accidental resizes | Medium | Medium | Require deliberate drag distance |
| Hidden/lost handles at extreme zoom | Medium | Low | Scale handles with zoom, minimum size |
| Confusion with global zoom | Medium | Medium | Clear labeling, show percentage |

### Integration Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Breaking existing page drag | High | Low | Thorough testing of priority ordering |
| Storage format conflicts | Low | Low | Use separate key in localStorage |
| Export/transcription issues | Low | Very Low | Scale only affects display, not data |

---

## Implementation Timeline

### Realistic Timeline (Assuming Focused Development)

| Phase | Duration | Dependencies | Deliverable |
|-------|----------|--------------|-------------|
| Phase 1: Foundation | 2-3 hours | None | Working scale store, basic rendering |
| Phase 2: Corner Handles | 3-4 hours | Phase 1 | Visible handles, hit testing |
| Phase 3: Resize Interaction | 4-5 hours | Phase 2 | Functional resize with preview |
| Phase 4: Polish & Integration | 2-3 hours | Phase 3 | Complete UI, all features |
| Phase 5: Testing & Refinement | 2-3 hours | Phase 4 | Production-ready |

**Total: 13-18 hours of focused development**

### Milestone Checkpoints

1. **Day 1 End**: Manual scale setting works, strokes render correctly
2. **Day 2 End**: Corner handles visible and clickable
3. **Day 3 End**: Full resize interaction functional
4. **Day 4**: Polish, testing, documentation

---

## Alternatives Considered

### Alternative 1: Edge Resize (Not Just Corners)

**Description:** Allow dragging any edge (top, bottom, left, right) in addition to corners.

**Pros:**
- More resize options
- Easier to change width or height independently

**Cons:**
- More complex hit testing
- More visual clutter (8 handles vs 4)
- Aspect ratio handling becomes more complex

**Decision:** Start with corners only, can add edges later if needed.

### Alternative 2: Resize Handles Only on Selected Page

**Description:** Show handles only when a page is explicitly selected.

**Pros:**
- Cleaner visual when not resizing
- Reduces clutter with many pages
- Clear interaction mode

**Cons:**
- Requires page selection mechanism
- Extra click to enable resize
- Less discoverable

**Decision:** Show handles on all pages initially, reconsider if too cluttered.

### Alternative 3: Modal Resize Tool

**Description:** Add a "Resize Mode" button that activates resize capability.

**Pros:**
- No accidental resizes
- Can show more aggressive UI in resize mode
- Clear separation of concerns

**Cons:**
- Extra mode switching
- Less fluid interaction
- Mode confusion

**Decision:** Avoid modal tools, keep interaction direct.

### Alternative 4: Numerical Input for Scale

**Description:** Allow typing exact scale percentage (e.g., "150%") in addition to dragging.

**Pros:**
- Precise control
- Useful for matching specific sizes
- Accessible alternative

**Cons:**
- Requires additional UI
- Less direct manipulation
- May not be worth complexity

**Decision:** Consider for future enhancement if users request it.

---

## Recommendations

### ✅ Proceed with Implementation

**Recommendation: Implement the feature using the Scale Display (Non-Destructive) approach.**

**Justification:**

1. **Technical Feasibility: High**
   - All required infrastructure exists
   - Clear implementation path
   - Manageable complexity

2. **User Value: Medium-High**
   - Enables custom layout creation
   - Improves multi-page visualization
   - Complements existing drag functionality

3. **Risk: Low-Medium**
   - No data modification risks
   - Can be reverted easily
   - Limited scope for bugs

4. **Effort: Reasonable**
   - 13-18 hours for complete implementation
   - Fits within 3-4 day sprint
   - Clear milestone structure

### Implementation Guidelines

1. **Start with Simplest Version**
   - Implement basic scale factor storage and rendering first
   - Add corner handles once rendering works
   - Polish interaction last

2. **Test Continuously**
   - Test at each phase before proceeding
   - Verify no regressions in existing features
   - Get user feedback early on feel/behavior

3. **Maintain Non-Destructive Philosophy**
   - Never modify original stroke data
   - Keep all scales reversible
   - Provide easy reset option

4. **Document Thoroughly**
   - Update architecture docs
   - Add user-facing documentation
   - Comment complex coordinate math

5. **Consider Future Extensions**
   - Design with edge resize in mind
   - Leave room for numerical input
   - Plan for multi-select resize

### Success Criteria

The feature is successful if:

- ✅ Users can resize pages smoothly at 60fps
- ✅ Scale factors persist across sessions
- ✅ Original stroke data is preserved
- ✅ Interaction feels natural and predictable
- ✅ No performance degradation with 10+ pages
- ✅ Works correctly with existing zoom/pan/drag features
- ✅ Clear visual feedback during resize
- ✅ Can be reset to original size easily

### Potential Future Enhancements

1. **Edge Resize** - Drag any edge, not just corners
2. **Multi-Page Resize** - Resize multiple pages simultaneously
3. **Aspect Ratio Lock Toggle** - Persistent preference for aspect ratio behavior
4. **Resize Presets** - Quick buttons for 50%, 100%, 150%, 200%
5. **Numerical Input** - Type exact percentage
6. **Resize to Fit** - Auto-scale to fill available space
7. **Scale Indicators** - Visual grid or ruler showing scale
8. **Undo/Redo** - Track resize history

---

## Conclusion

The page corner resize feature is **highly feasible** and **recommended for implementation**. The existing architecture provides excellent foundation for this enhancement, and the non-destructive approach minimizes risk while providing significant user value.

The estimated 13-18 hours of development time is reasonable for the functionality gained, and the clear phase structure provides good checkpoints for validation and adjustment.

**Next Steps:**
1. Review and approve this specification
2. Create implementation branch
3. Begin Phase 1 (Foundation) development
4. Iterate based on testing and feedback

---

## Document Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 2026 | Claude | Initial feasibility specification |

