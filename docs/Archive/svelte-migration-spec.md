# Svelte 4 Migration Specification

## Overview

This document specifies the migration of the SmartPen-LogSeq Bridge from vanilla JavaScript to Svelte 4. The goal is to improve code organization, enable reactive UI updates, and prepare for interactive features like draggable line guides and stroke selection.

## Why Svelte 4 (Not Svelte 5)

- **Stability**: Svelte 4 is mature and well-documented
- **Simpler learning curve**: Traditional reactive syntax vs Runes
- **Proven ecosystem**: More examples and community resources
- **Adequate for our needs**: We don't need Svelte 5's performance optimizations

## Current Architecture

```
src/
├── main.js              # Entry point, event binding
├── state.js             # Global state object
├── elements.js          # DOM element references
├── logger.js            # Console logging utility
├── ui-updates.js        # DOM manipulation functions
├── pen-handlers.js      # Pen SDK callbacks
├── button-handlers.js   # Click event handlers
├── transcription-view.js # Transcription display
├── settings.js          # LocalStorage persistence
├── myscript-api.js      # MyScript API client
├── stroke-analyzer.js   # Stroke shape detection
├── canvas-renderer.js   # Canvas drawing
├── logseq-api.js        # LogSeq API client
└── polyfills.js         # Browser compatibility
```

### Current Pain Points

1. **Manual DOM updates**: Every state change requires explicit DOM manipulation
2. **Scattered event handling**: Event listeners spread across multiple files
3. **No component isolation**: Hard to reason about UI sections independently
4. **Difficult to add interactivity**: Canvas overlays, drag-drop would be complex

## Target Architecture

```
src/
├── App.svelte                    # Root component
├── main.js                       # Svelte app initialization
│
├── components/
│   ├── layout/
│   │   ├── Header.svelte         # Title, pen status
│   │   ├── Sidebar.svelte        # Settings panels
│   │   └── TabContainer.svelte   # Tab switching
│   │
│   ├── pen/
│   │   ├── PenStatus.svelte      # Connection indicator
│   │   ├── PenInfo.svelte        # Battery, firmware info
│   │   └── PenControls.svelte    # Connect/disconnect buttons
│   │
│   ├── canvas/
│   │   ├── StrokeCanvas.svelte   # Main canvas wrapper
│   │   ├── CanvasControls.svelte # Zoom, clear, export buttons
│   │   ├── LineGuides.svelte     # Draggable line overlay
│   │   └── SelectionBox.svelte   # Box select UI
│   │
│   ├── strokes/
│   │   ├── StrokeList.svelte     # List of strokes
│   │   ├── StrokeItem.svelte     # Individual stroke row
│   │   └── SelectionInfo.svelte  # Selection count, actions
│   │
│   ├── transcription/
│   │   ├── TranscriptionView.svelte  # Main transcription display
│   │   ├── LineDisplay.svelte        # Single line with hierarchy
│   │   ├── HierarchyTree.svelte      # Visual tree structure
│   │   ├── CommandList.svelte        # Detected commands
│   │   └── LogseqPreview.svelte      # Formatted output preview
│   │
│   └── settings/
│       ├── LogseqSettings.svelte     # Host, token config
│       ├── MyScriptSettings.svelte   # API keys config
│       └── SettingsPanel.svelte      # Collapsible container
│
├── stores/
│   ├── strokes.js        # Stroke data store
│   ├── selection.js      # Selected stroke indices
│   ├── pen.js            # Pen connection state
│   ├── transcription.js  # Transcription results
│   ├── settings.js       # User settings (persisted)
│   └── ui.js             # UI state (active tab, etc.)
│
├── lib/
│   ├── myscript-api.js   # Keep as-is (pure JS)
│   ├── stroke-analyzer.js # Keep as-is (pure JS)
│   ├── canvas-renderer.js # Adapt for Svelte lifecycle
│   ├── logseq-api.js     # Keep as-is (pure JS)
│   └── pen-sdk.js        # Pen SDK wrapper
│
├── actions/
│   ├── clickOutside.js   # Close dropdowns on outside click
│   ├── draggable.js      # Make elements draggable
│   └── resizable.js      # Resize panels
│
└── utils/
    ├── logger.js         # Keep as-is
    ├── storage.js        # LocalStorage helpers
    └── formatting.js     # Text/number formatting
```

## Store Definitions

### strokes.js
```javascript
import { writable, derived } from 'svelte/store';

// Raw stroke data
export const strokes = writable([]);

// Pages derived from strokes
export const pages = derived(strokes, $strokes => {
  const pageMap = new Map();
  $strokes.forEach(stroke => {
    const key = `S${stroke.pageInfo.section}/O${stroke.pageInfo.owner}/B${stroke.pageInfo.book}/P${stroke.pageInfo.page}`;
    if (!pageMap.has(key)) pageMap.set(key, []);
    pageMap.get(key).push(stroke);
  });
  return pageMap;
});

// Stroke count
export const strokeCount = derived(strokes, $strokes => $strokes.length);

// Actions
export function addStroke(stroke) {
  strokes.update(s => [...s, stroke]);
}

export function clearStrokes() {
  strokes.set([]);
}

export function addOfflineStrokes(offlineData) {
  strokes.update(s => [...s, ...offlineData]);
}
```

### selection.js
```javascript
import { writable, derived } from 'svelte/store';
import { strokes } from './strokes.js';

export const selectedIndices = writable(new Set());
export const lastSelectedIndex = writable(null);

// Selected strokes (actual stroke objects)
export const selectedStrokes = derived(
  [strokes, selectedIndices],
  ([$strokes, $selectedIndices]) => {
    return Array.from($selectedIndices).map(i => $strokes[i]).filter(Boolean);
  }
);

// Selection count
export const selectionCount = derived(selectedIndices, $sel => $sel.size);

// Actions
export function selectStroke(index, multi = false) {
  selectedIndices.update(sel => {
    const newSel = multi ? new Set(sel) : new Set();
    if (newSel.has(index)) {
      newSel.delete(index);
    } else {
      newSel.add(index);
    }
    return newSel;
  });
  lastSelectedIndex.set(index);
}

export function selectRange(fromIndex, toIndex) {
  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  selectedIndices.update(() => {
    const newSel = new Set();
    for (let i = start; i <= end; i++) newSel.add(i);
    return newSel;
  });
}

export function selectAll(count) {
  selectedIndices.update(() => {
    const newSel = new Set();
    for (let i = 0; i < count; i++) newSel.add(i);
    return newSel;
  });
}

export function clearSelection() {
  selectedIndices.set(new Set());
  lastSelectedIndex.set(null);
}
```

### pen.js
```javascript
import { writable } from 'svelte/store';

export const penConnected = writable(false);
export const penAuthorized = writable(false);
export const penInfo = writable(null);
export const penController = writable(null);

// Actions
export function setPenConnected(connected) {
  penConnected.set(connected);
  if (!connected) {
    penAuthorized.set(false);
    penInfo.set(null);
    penController.set(null);
  }
}

export function setPenInfo(info) {
  penInfo.set(info);
}
```

### transcription.js
```javascript
import { writable, derived } from 'svelte/store';

export const lastTranscription = writable(null);

// Derived convenience stores
export const transcribedText = derived(lastTranscription, $t => $t?.text || '');
export const transcribedLines = derived(lastTranscription, $t => $t?.lines || []);
export const detectedCommands = derived(lastTranscription, $t => $t?.commands || []);

// Actions
export function setTranscription(result) {
  lastTranscription.set(result);
}

export function clearTranscription() {
  lastTranscription.set(null);
}
```

### settings.js
```javascript
import { writable } from 'svelte/store';
import { browser } from '$app/environment'; // Or check typeof window

// Load from localStorage
function loadSetting(key, defaultValue) {
  if (typeof window === 'undefined') return defaultValue;
  const stored = localStorage.getItem(`smartpen-${key}`);
  return stored ? JSON.parse(stored) : defaultValue;
}

// Create persisted store
function persistedStore(key, defaultValue) {
  const store = writable(loadSetting(key, defaultValue));
  
  store.subscribe(value => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`smartpen-${key}`, JSON.stringify(value));
    }
  });
  
  return store;
}

export const logseqHost = persistedStore('logseqHost', 'http://localhost:12315');
export const logseqToken = persistedStore('logseqToken', '');
export const myscriptAppKey = persistedStore('myscriptAppKey', '');
export const myscriptHmacKey = persistedStore('myscriptHmacKey', '');
```

### ui.js
```javascript
import { writable } from 'svelte/store';

export const activeTab = writable('strokes'); // 'strokes' | 'raw' | 'analysis' | 'transcription'
export const sidebarCollapsed = writable(false);
export const canvasZoom = writable(1);
export const showLineGuides = writable(false);
```

## Component Specifications

### App.svelte
```svelte
<script>
  import Header from './components/layout/Header.svelte';
  import Sidebar from './components/layout/Sidebar.svelte';
  import TabContainer from './components/layout/TabContainer.svelte';
  import StrokeCanvas from './components/canvas/StrokeCanvas.svelte';
  import { setupPenCallbacks } from './lib/pen-sdk.js';
  import { onMount } from 'svelte';
  
  onMount(() => {
    setupPenCallbacks();
  });
</script>

<main class="app">
  <Header />
  <div class="content">
    <Sidebar />
    <div class="main-area">
      <StrokeCanvas />
      <TabContainer />
    </div>
  </div>
</main>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: var(--bg-primary);
  }
  .content {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
</style>
```

### StrokeCanvas.svelte (Key Component)
```svelte
<script>
  import { onMount, onDestroy } from 'svelte';
  import { strokes } from '../../stores/strokes.js';
  import { selectedIndices, selectStroke, selectRange } from '../../stores/selection.js';
  import { canvasZoom, showLineGuides } from '../../stores/ui.js';
  import { CanvasRenderer } from '../../lib/canvas-renderer.js';
  import LineGuides from './LineGuides.svelte';
  
  let canvasElement;
  let renderer;
  
  onMount(() => {
    renderer = new CanvasRenderer(canvasElement);
    
    // Subscribe to strokes and redraw
    const unsubStrokes = strokes.subscribe($strokes => {
      renderer.clear();
      $strokes.forEach(stroke => renderer.drawStroke(stroke));
    });
    
    // Subscribe to selection for highlighting
    const unsubSelection = selectedIndices.subscribe($sel => {
      renderer.highlightStrokes($sel);
    });
    
    return () => {
      unsubStrokes();
      unsubSelection();
    };
  });
  
  function handleCanvasClick(e) {
    // Hit test to find clicked stroke
    const strokeIndex = renderer.hitTest(e.offsetX, e.offsetY);
    if (strokeIndex !== -1) {
      selectStroke(strokeIndex, e.ctrlKey || e.metaKey);
    }
  }
  
  function handleWheel(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      canvasZoom.update(z => Math.max(0.25, Math.min(4, z + (e.deltaY > 0 ? -0.1 : 0.1))));
    }
  }
</script>

<div class="canvas-container">
  <canvas
    bind:this={canvasElement}
    on:click={handleCanvasClick}
    on:wheel={handleWheel}
    style="transform: scale({$canvasZoom})"
  />
  
  {#if $showLineGuides}
    <LineGuides {renderer} />
  {/if}
</div>

<style>
  .canvas-container {
    position: relative;
    flex: 1;
    overflow: auto;
    background: var(--bg-secondary);
  }
  canvas {
    transform-origin: top left;
  }
</style>
```

### LineGuides.svelte (New Feature)
```svelte
<script>
  import { transcribedLines } from '../../stores/transcription.js';
  import { draggable } from '../../actions/draggable.js';
  
  export let renderer;
  
  let guides = [];
  
  // Initialize guides from transcribed lines
  $: if ($transcribedLines.length > 0) {
    guides = $transcribedLines.map((line, i) => ({
      id: i,
      y: line.baseline,
      label: `Line ${i + 1}`
    }));
  }
  
  function handleGuideDrag(id, newY) {
    guides = guides.map(g => g.id === id ? { ...g, y: newY } : g);
    // Could emit event to recalculate line assignments
  }
  
  function addGuide(y) {
    const id = Math.max(...guides.map(g => g.id), 0) + 1;
    guides = [...guides, { id, y, label: `Line ${guides.length + 1}` }];
  }
  
  function removeGuide(id) {
    guides = guides.filter(g => g.id !== id);
  }
</script>

<div class="line-guides">
  {#each guides as guide (guide.id)}
    <div
      class="guide"
      style="top: {guide.y}px"
      use:draggable={{ axis: 'y', onDrag: (y) => handleGuideDrag(guide.id, y) }}
    >
      <span class="guide-label">{guide.label}</span>
      <button class="guide-remove" on:click={() => removeGuide(guide.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .line-guides {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    pointer-events: none;
  }
  .guide {
    position: absolute;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent);
    opacity: 0.5;
    pointer-events: auto;
    cursor: ns-resize;
  }
  .guide:hover {
    opacity: 1;
  }
  .guide-label {
    position: absolute;
    left: 5px;
    top: -18px;
    font-size: 10px;
    background: var(--bg-tertiary);
    padding: 2px 4px;
    border-radius: 3px;
  }
  .guide-remove {
    position: absolute;
    right: 5px;
    top: -18px;
    width: 16px;
    height: 16px;
    border: none;
    background: var(--error);
    color: white;
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
  }
  .guide:hover .guide-remove {
    opacity: 1;
  }
</style>
```

### TranscriptionView.svelte
```svelte
<script>
  import { lastTranscription, transcribedText, transcribedLines, detectedCommands } from '../../stores/transcription.js';
  import LineDisplay from './LineDisplay.svelte';
  import HierarchyTree from './HierarchyTree.svelte';
  import CommandList from './CommandList.svelte';
  import LogseqPreview from './LogseqPreview.svelte';
  
  $: hasTranscription = $lastTranscription !== null;
  $: summary = $lastTranscription?.summary || {};
  $: lineMetrics = $lastTranscription?.lineMetrics || {};
</script>

{#if !hasTranscription}
  <div class="empty-state">
    <p>Select strokes and click "Transcribe" to convert handwriting to text.</p>
    <a href="https://developer.myscript.com/" target="_blank">
      Get MyScript API keys (free: 2,000 requests/month)
    </a>
  </div>
{:else}
  <section class="transcription">
    <h3>Transcribed Text</h3>
    <pre class="text-output">{$transcribedText}</pre>
  </section>
  
  <section class="lines">
    <h3>Lines with Hierarchy ({$transcribedLines.length})</h3>
    {#each $transcribedLines as line, i (i)}
      <LineDisplay {line} index={i} />
    {/each}
  </section>
  
  <section class="stats">
    <div class="stat">
      <span class="value">{summary.totalLines}</span>
      <span class="label">Lines</span>
    </div>
    <div class="stat">
      <span class="value">{summary.totalWords}</span>
      <span class="label">Words</span>
    </div>
    <div class="stat">
      <span class="value">{summary.hasIndentation ? '✓' : '—'}</span>
      <span class="label">Indentation</span>
    </div>
    <div class="stat">
      <span class="value">{$detectedCommands.length || '—'}</span>
      <span class="label">Commands</span>
    </div>
  </section>
  
  {#if $detectedCommands.length > 0}
    <CommandList commands={$detectedCommands} />
  {/if}
  
  <LogseqPreview lines={$transcribedLines} />
  
  {#if summary.hasIndentation}
    <HierarchyTree lines={$transcribedLines} />
  {/if}
  
  <details>
    <summary>Line Detection Metrics</summary>
    <div class="metrics">
      <div>Median Height: {lineMetrics.medianHeight?.toFixed(2)} px</div>
      <div>Indent Unit: {lineMetrics.indentUnit?.toFixed(2)} px</div>
    </div>
  </details>
{/if}

<style>
  /* Component styles */
</style>
```

## Migration Steps

### Phase 1: Setup (1-2 hours)
1. Install Svelte and configure Vite
   ```bash
   npm install svelte @sveltejs/vite-plugin-svelte
   ```
2. Update `vite.config.js` for Svelte
3. Create initial `App.svelte` and `main.js`
4. Verify build works with empty Svelte app

### Phase 2: Core Stores (2-3 hours)
1. Create `stores/` directory
2. Implement `strokes.js`, `selection.js`, `pen.js`
3. Implement `transcription.js`, `settings.js`, `ui.js`
4. Test stores in isolation with console logging

### Phase 3: Keep Business Logic (1 hour)
1. Move to `lib/` directory:
   - `myscript-api.js` (unchanged)
   - `stroke-analyzer.js` (unchanged)
   - `logseq-api.js` (unchanged)
2. Adapt `canvas-renderer.js` to work with Svelte lifecycle
3. Create `pen-sdk.js` wrapper that updates stores

### Phase 4: Components - Layout (2-3 hours)
1. Create `Header.svelte` with pen status
2. Create `Sidebar.svelte` with settings panels
3. Create `TabContainer.svelte` with tab switching
4. Wire up to stores, verify reactivity

### Phase 5: Components - Canvas (3-4 hours)
1. Create `StrokeCanvas.svelte`
2. Integrate `canvas-renderer.js`
3. Add click-to-select functionality
4. Add zoom controls
5. Create placeholder `LineGuides.svelte`

### Phase 6: Components - Strokes Tab (2 hours)
1. Create `StrokeList.svelte`
2. Create `StrokeItem.svelte` with selection
3. Create `SelectionInfo.svelte`
4. Implement multi-select (Ctrl+click, Shift+click)

### Phase 7: Components - Transcription Tab (2-3 hours)
1. Create `TranscriptionView.svelte`
2. Create `LineDisplay.svelte`
3. Create `HierarchyTree.svelte`
4. Create `CommandList.svelte`
5. Create `LogseqPreview.svelte`

### Phase 8: Components - Settings (1-2 hours)
1. Create `LogseqSettings.svelte`
2. Create `MyScriptSettings.svelte`
3. Create `SettingsPanel.svelte` (collapsible)
4. Wire up persisted stores

### Phase 9: Polish & Testing (2-3 hours)
1. Test all pen functionality
2. Test transcription flow
3. Test selection behavior
4. Fix styling issues
5. Add keyboard shortcuts

### Phase 10: New Features (Future)
1. Implement `LineGuides.svelte` with draggable action
2. Add box selection
3. Add stroke grouping by line

## Files to Delete After Migration

```
src/main.js           → Replaced by Svelte main.js
src/state.js          → Replaced by stores/
src/elements.js       → No longer needed
src/ui-updates.js     → Replaced by components
src/button-handlers.js → Integrated into components
src/pen-handlers.js   → Moved to lib/pen-sdk.js
src/transcription-view.js → Replaced by components
src/settings.js       → Replaced by stores/settings.js
```

## Files to Keep (Move to lib/)

```
src/myscript-api.js    → lib/myscript-api.js (unchanged)
src/stroke-analyzer.js → lib/stroke-analyzer.js (unchanged)
src/canvas-renderer.js → lib/canvas-renderer.js (minor adaptations)
src/logseq-api.js      → lib/logseq-api.js (unchanged)
src/logger.js          → utils/logger.js (unchanged)
src/polyfills.js       → utils/polyfills.js (unchanged)
```

## Vite Configuration

```javascript
// vite.config.js
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      '$lib': '/src/lib',
      '$stores': '/src/stores',
      '$components': '/src/components',
    }
  },
  build: {
    target: 'esnext',
  }
});
```

## Estimated Total Time

| Phase | Time |
|-------|------|
| Setup | 1-2 hours |
| Core Stores | 2-3 hours |
| Business Logic | 1 hour |
| Layout Components | 2-3 hours |
| Canvas Components | 3-4 hours |
| Strokes Tab | 2 hours |
| Transcription Tab | 2-3 hours |
| Settings | 1-2 hours |
| Polish & Testing | 2-3 hours |
| **Total** | **16-23 hours** |

## Success Criteria

1. ✅ All existing functionality works (pen connect, draw, transcribe)
2. ✅ UI updates reactively without manual DOM manipulation
3. ✅ Selection state is properly shared across components
4. ✅ Settings persist to localStorage
5. ✅ Code is organized into logical components
6. ✅ Ready to add interactive line guides feature
