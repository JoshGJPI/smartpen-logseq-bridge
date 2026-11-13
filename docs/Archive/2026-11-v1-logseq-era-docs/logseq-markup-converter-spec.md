# LogSeq Markup Converter - Technical Specification

**Version:** 1.0.0  
**Status:** Proposed  
**Last Updated:** January 2026  
**Related Documents:** 
- [App Specification](./app-specification.md)
- [Bullet Journal Symbol Detection](./bullet-journal-spec.md)

---

## Table of Contents

1. [Overview](#overview)
2. [Relationship to Bullet Journal Detection](#relationship-to-bullet-journal-detection)
3. [Pattern Definitions](#pattern-definitions)
4. [Architecture](#architecture)
5. [Implementation Details](#implementation-details)
6. [Integration Points](#integration-points)
7. [Configuration & Settings](#configuration--settings)
8. [Testing Strategy](#testing-strategy)
9. [Implementation Phases](#implementation-phases)
10. [Future Enhancements](#future-enhancements)

---

## Overview

### Purpose

Add a text transformation layer between MyScript transcription and LogSeq export that converts common handwritten patterns into LogSeq-native syntax. This enables seamless conversion of handwritten task lists, checkboxes, and other markup into structured LogSeq blocks.

### Goals

1. **Transform text patterns** - Convert transcribed text like `[]` or `[x]` into LogSeq TODO/DONE markers
2. **Preserve original text** - Keep the line content after the pattern marker
3. **Configurable patterns** - Allow users to enable/disable specific conversions
4. **Extensible design** - Support adding new patterns (tags, priorities, etc.)
5. **Non-destructive** - Original transcription preserved; conversion applied at export time

### Non-Goals

- Stroke-based shape detection (covered by [bullet-journal-spec.md](./bullet-journal-spec.md))
- Real-time conversion during transcription (applied at export only)
- Custom pattern definition by users (start with predefined patterns)

### Key Distinction from Bullet Journal Detection

| Feature | Bullet Journal Detection | LogSeq Markup Converter |
|---------|-------------------------|------------------------|
| **Input** | Raw stroke data | Transcribed text (strings) |
| **Detection** | Geometric shape analysis | Text pattern matching (regex) |
| **Purpose** | Identify drawn symbols (☐, ○, –) | Transform text sequences (`[]`, `[x]`) |
| **When Applied** | During/after transcription | At LogSeq export time |

These two features are **complementary**:
- Bullet Journal Detection: "I drew a checkbox symbol → detect it as a task"
- LogSeq Markup Converter: "I wrote `[]` or `[ ]` → convert to TODO"

---

## Relationship to Bullet Journal Detection

### Use Cases

**Scenario A: User draws checkboxes**
- User draws a square box (☐) followed by text
- Bullet Journal Detector identifies the shape
- Exports as `TODO Task name`

**Scenario B: User writes bracket notation**
- User writes `[] Buy groceries` or `[ ] Buy groceries`
- MyScript transcribes as `[] Buy groceries` (text)
- LogSeq Markup Converter transforms to `TODO Buy groceries`

**Scenario C: Both methods**
- User might mix approaches on the same page
- Both systems work together
- No conflicts (shape detection marks strokes; text conversion transforms strings)

### Processing Order

```
Strokes → MyScript API → Transcription Result
                              │
                              ├─→ Bullet Journal Detector (optional)
                              │     Adds bullet metadata to lines
                              │
                              ▼
                         lines[] with text + bullet info
                              │
                              ├─→ LogSeq Markup Converter
                              │     Transforms text patterns
                              │
                              ▼
                         Transformed lines ready for LogSeq
```

---

## Pattern Definitions

### Core Patterns (Phase 1)

#### Task Patterns (TODO/DONE)

| Handwritten | Transcribed Text | LogSeq Output | Notes |
|-------------|------------------|---------------|-------|
| Empty box text | `[] Task name` | `TODO Task name` | Open task |
| Empty box with space | `[ ] Task name` | `TODO Task name` | Alternative empty |
| Checked box | `[x] Task name` | `DONE Task name` | Completed task |
| Checked box (caps) | `[X] Task name` | `DONE Task name` | Alternative checked |
| Checkmark | `[✓] Task name` | `DONE Task name` | Unicode checkmark |
| Crossed | `[×] Task name` | `DONE Task name` | Unicode cross |

#### Pattern Regex

```javascript
const TASK_PATTERNS = {
  // Empty checkbox → TODO
  emptyCheckbox: {
    regex: /^\s*\[\s*\]\s*/,
    replacement: 'TODO ',
    logseqMarker: 'TODO'
  },
  
  // Checked checkbox → DONE  
  checkedCheckbox: {
    regex: /^\s*\[[xX✓✔×✗]\]\s*/,
    replacement: 'DONE ',
    logseqMarker: 'DONE'
  }
};
```

### Extended Patterns (Phase 2)

#### Additional Task States

| Handwritten | Transcribed Text | LogSeq Output | Notes |
|-------------|------------------|---------------|-------|
| Forward migrate | `[>] Task name` | `LATER Task name` | Bullet journal forward |
| Backward migrate | `[<] Task name` | `SCHEDULED Task name` | Bullet journal backward |
| Cancelled | `[-] Task name` | `CANCELLED Task name` | Struck task |
| In progress | `[/] Task name` | `DOING Task name` | Half-done |
| Question/waiting | `[?] Task name` | `WAITING Task name` | Blocked/waiting |

#### Priority Markers

| Handwritten | Transcribed Text | LogSeq Output | Notes |
|-------------|------------------|---------------|-------|
| High priority | `[!] Task name` | `TODO Task name #priority/high` | Or `[#A]` |
| Medium priority | `[*] Task name` | `TODO Task name #priority/medium` | Or `[#B]` |
| Low priority | `[~] Task name` | `TODO Task name #priority/low` | Or `[#C]` |

### Extended Patterns (Phase 3)

#### Tags and References

| Handwritten | Transcribed Text | LogSeq Output | Notes |
|-------------|------------------|---------------|-------|
| Hashtag | `#project` | `#project` | Pass-through |
| Page reference | `[[Page Name]]` | `[[Page Name]]` | Pass-through |
| Date | `@2025-01-15` | `[[2025-01-15]]` | Date page link |

---

## Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    TranscriptionView.svelte                  │
│  handleSendToLogseq() calls sendToLogseq(lines, ...)        │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      logseq-api.js                           │
│  sendToLogseq(lines, host, token)                            │
│                              │                               │
│                              ▼                               │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           NEW: applyMarkupConversions(lines)          │  │
│  │                                                        │  │
│  │  For each line:                                        │  │
│  │    1. Check if line.bullet already set (skip if so)   │  │
│  │    2. Apply text pattern matching                      │  │
│  │    3. Transform line.text                              │  │
│  │    4. Set line.logseqMarker if matched                 │  │
│  └───────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│  Insert blocks with transformed text                         │
└─────────────────────────────────────────────────────────────┘
```

### Module Structure

```
src/
├── lib/
│   ├── logseq-api.js              # Existing - add integration call
│   └── logseq-markup-converter.js # NEW - conversion logic
├── stores/
│   └── settings.js                # Add converter settings
└── components/
    └── settings/
        └── LogseqSettings.svelte  # Add converter toggles
```

### Line Object Enhancement

```javascript
// Before conversion
{
  text: "[] Buy groceries",
  indentLevel: 0,
  x: 25.5,
  baseline: 10.2,
  // bullet: undefined (no shape detected)
}

// After conversion
{
  text: "Buy groceries",           // Text without pattern prefix
  indentLevel: 0,
  x: 25.5,
  baseline: 10.2,
  logseqMarker: "TODO",            // NEW: LogSeq keyword to prepend
  originalText: "[] Buy groceries" // NEW: Preserve original
}
```

---

## Implementation Details

### New File: `src/lib/logseq-markup-converter.js`

```javascript
/**
 * LogSeq Markup Converter
 * Transforms text patterns in transcribed lines to LogSeq-compatible syntax
 */

/**
 * Pattern definitions for text conversion
 * Each pattern has: regex, replacement, logseqMarker
 */
const PATTERNS = {
  // Task states
  emptyCheckbox: {
    id: 'emptyCheckbox',
    name: 'Empty Checkbox',
    description: '[] or [ ] → TODO',
    regex: /^\s*\[\s*\]\s*/,
    logseqMarker: 'TODO',
    enabled: true,
    category: 'tasks'
  },
  
  checkedCheckbox: {
    id: 'checkedCheckbox',
    name: 'Checked Checkbox',
    description: '[x] or [X] → DONE',
    regex: /^\s*\[[xX✓✔×✗]\]\s*/,
    logseqMarker: 'DONE',
    enabled: true,
    category: 'tasks'
  },
  
  // Extended task states (Phase 2)
  forwardMigrate: {
    id: 'forwardMigrate',
    name: 'Forward Migrate',
    description: '[>] → LATER',
    regex: /^\s*\[>\]\s*/,
    logseqMarker: 'LATER',
    enabled: false, // Off by default
    category: 'tasks'
  },
  
  backwardMigrate: {
    id: 'backwardMigrate',
    name: 'Backward Migrate',
    description: '[<] → SCHEDULED',
    regex: /^\s*\[<\]\s*/,
    logseqMarker: 'SCHEDULED',
    enabled: false,
    category: 'tasks'
  },
  
  cancelled: {
    id: 'cancelled',
    name: 'Cancelled Task',
    description: '[-] → CANCELLED',
    regex: /^\s*\[-\]\s*/,
    logseqMarker: 'CANCELLED',
    enabled: false,
    category: 'tasks'
  },
  
  inProgress: {
    id: 'inProgress',
    name: 'In Progress',
    description: '[/] → DOING',
    regex: /^\s*\[\/\]\s*/,
    logseqMarker: 'DOING',
    enabled: false,
    category: 'tasks'
  },
  
  waiting: {
    id: 'waiting',
    name: 'Waiting/Blocked',
    description: '[?] → WAITING',
    regex: /^\s*\[\?\]\s*/,
    logseqMarker: 'WAITING',
    enabled: false,
    category: 'tasks'
  }
};

/**
 * Get all available patterns
 * @returns {Object} All pattern definitions
 */
export function getAvailablePatterns() {
  return { ...PATTERNS };
}

/**
 * Get patterns grouped by category
 * @returns {Object} Patterns grouped by category
 */
export function getPatternsByCategory() {
  const categories = {};
  
  Object.values(PATTERNS).forEach(pattern => {
    const cat = pattern.category || 'other';
    if (!categories[cat]) {
      categories[cat] = [];
    }
    categories[cat].push(pattern);
  });
  
  return categories;
}

/**
 * Convert a single line using enabled patterns
 * @param {Object} line - Line object with text property
 * @param {Object} enabledPatterns - Map of pattern IDs to enabled state
 * @returns {Object} Converted line with logseqMarker if matched
 */
export function convertLine(line, enabledPatterns = {}) {
  // Skip if line already has bullet metadata from shape detection
  if (line.bullet && line.bullet.type) {
    return line;
  }
  
  // Skip if no text
  if (!line.text || typeof line.text !== 'string') {
    return line;
  }
  
  const originalText = line.text;
  
  // Try each enabled pattern
  for (const [patternId, pattern] of Object.entries(PATTERNS)) {
    // Check if pattern is enabled (use pattern default if not specified)
    const isEnabled = enabledPatterns[patternId] ?? pattern.enabled;
    
    if (!isEnabled) continue;
    
    const match = pattern.regex.exec(line.text);
    
    if (match) {
      // Found a match - transform the line
      const textAfterPattern = line.text.slice(match[0].length).trim();
      
      return {
        ...line,
        text: textAfterPattern,
        originalText: originalText,
        logseqMarker: pattern.logseqMarker,
        matchedPattern: patternId
      };
    }
  }
  
  // No pattern matched - return unchanged
  return line;
}

/**
 * Convert all lines using enabled patterns
 * @param {Array} lines - Array of line objects
 * @param {Object} enabledPatterns - Map of pattern IDs to enabled state
 * @returns {Array} Converted lines
 */
export function convertLines(lines, enabledPatterns = {}) {
  if (!Array.isArray(lines)) {
    return lines;
  }
  
  return lines.map(line => convertLine(line, enabledPatterns));
}

/**
 * Format a line for LogSeq block content
 * Prepends the logseqMarker if present
 * @param {Object} line - Line object (possibly converted)
 * @returns {string} Formatted block content
 */
export function formatLineForLogseq(line) {
  if (!line || !line.text) {
    return '';
  }
  
  // If line has a LogSeq marker from conversion, prepend it
  if (line.logseqMarker) {
    return `${line.logseqMarker} ${line.text}`;
  }
  
  // If line has bullet metadata from shape detection, format accordingly
  if (line.bullet && line.bullet.type === 'task') {
    const stateMap = {
      'open': 'TODO',
      'done': 'DONE',
      'migrated': 'LATER',
      'scheduled': 'SCHEDULED',
      'cancelled': 'CANCELLED'
    };
    const marker = stateMap[line.bullet.state] || 'TODO';
    return `${marker} ${line.text}`;
  }
  
  // No conversion needed
  return line.text;
}

/**
 * Preview conversion results for display
 * Shows what will be converted before sending to LogSeq
 * @param {Array} lines - Original lines
 * @param {Object} enabledPatterns - Enabled patterns
 * @returns {Array} Preview objects with before/after comparison
 */
export function previewConversions(lines, enabledPatterns = {}) {
  if (!Array.isArray(lines)) {
    return [];
  }
  
  return lines.map((line, index) => {
    const converted = convertLine(line, enabledPatterns);
    const hasConversion = converted.logseqMarker || converted.bullet;
    
    return {
      index,
      original: line.text,
      converted: formatLineForLogseq(converted),
      hasConversion,
      marker: converted.logseqMarker || null,
      pattern: converted.matchedPattern || null,
      indentLevel: line.indentLevel || 0
    };
  });
}

/**
 * Get conversion statistics
 * @param {Array} lines - Lines to analyze
 * @param {Object} enabledPatterns - Enabled patterns
 * @returns {Object} Statistics about conversions
 */
export function getConversionStats(lines, enabledPatterns = {}) {
  const conversions = previewConversions(lines, enabledPatterns);
  
  const stats = {
    total: lines.length,
    converted: 0,
    byMarker: {}
  };
  
  conversions.forEach(conv => {
    if (conv.hasConversion) {
      stats.converted++;
      const marker = conv.marker || 'other';
      stats.byMarker[marker] = (stats.byMarker[marker] || 0) + 1;
    }
  });
  
  return stats;
}
```

### Modify: `src/lib/logseq-api.js`

```javascript
// Add import at top
import { 
  convertLines, 
  formatLineForLogseq 
} from './logseq-markup-converter.js';

// Modify sendToLogseq function
export async function sendToLogseq(lines, host, token = '', options = {}) {
  try {
    if (!lines || lines.length === 0) {
      throw new Error('No lines to send');
    }
    
    // NEW: Apply markup conversions if enabled
    const { enableMarkupConversion = true, enabledPatterns = {} } = options;
    
    let processedLines = lines;
    if (enableMarkupConversion) {
      processedLines = convertLines(lines, enabledPatterns);
    }
    
    // Use today's journal page
    const pageName = getTodayPageName();
    
    // Ensure the page exists
    await getOrCreatePage(host, token, pageName);
    
    // Create header block for this import
    const timestamp = new Date().toLocaleTimeString();
    const headerContent = `Transcribed from SmartPen - ${timestamp}`;
    const headerBlock = await makeRequest(
      host, 
      token,
      'logseq.Editor.appendBlockInPage', 
      [pageName, headerContent, { properties: { source: 'smartpen' } }]
    );
    
    if (!headerBlock) {
      throw new Error('Failed to create header block');
    }
    
    // Build hierarchy by maintaining a stack of parent blocks
    const blockStack = [{ uuid: headerBlock.uuid, indent: -1 }];
    let blockCount = 0;
    
    for (const line of processedLines) {
      const indent = line.indentLevel || 0;
      
      // Pop stack until we find a parent with lower indent
      while (blockStack.length > 1 && blockStack[blockStack.length - 1].indent >= indent) {
        blockStack.pop();
      }
      
      const parentBlock = blockStack[blockStack.length - 1];
      
      // NEW: Format line content with LogSeq marker if applicable
      const content = formatLineForLogseq(line);
      
      // Insert as child of parent
      const newBlock = await makeRequest(
        host,
        token,
        'logseq.Editor.insertBlock',
        [
          parentBlock.uuid,
          content,  // Use formatted content
          { sibling: false }
        ]
      );
      
      if (newBlock) {
        blockStack.push({ uuid: newBlock.uuid, indent });
        blockCount++;
      }
    }
    
    console.log(`Sent ${blockCount} blocks to LogSeq page: ${pageName}`);
    return { 
      success: true, 
      blockCount,
      page: pageName 
    };
    
  } catch (error) {
    console.error('Failed to send to LogSeq:', error);
    return { 
      success: false, 
      error: error.message 
    };
  }
}
```

---

## Integration Points

### 1. Settings Store Enhancement

**File:** `src/stores/settings.js`

```javascript
// Add new settings for markup conversion

// Enable/disable markup conversion globally
export const enableMarkupConversion = writable(
  localStorage.getItem('enableMarkupConversion') !== 'false' // Default: true
);

enableMarkupConversion.subscribe(value => {
  localStorage.setItem('enableMarkupConversion', value);
});

// Per-pattern enable/disable
export const markupPatternSettings = writable(
  JSON.parse(localStorage.getItem('markupPatternSettings') || '{}')
);

markupPatternSettings.subscribe(value => {
  localStorage.setItem('markupPatternSettings', JSON.stringify(value));
});

// Helper to get current pattern settings
export function getMarkupSettings() {
  let globalEnabled, patterns;
  enableMarkupConversion.subscribe(v => globalEnabled = v)();
  markupPatternSettings.subscribe(v => patterns = v)();
  
  return {
    enabled: globalEnabled,
    patterns
  };
}
```

### 2. Settings UI Component

**File:** `src/components/settings/MarkupConverterSettings.svelte`

```svelte
<!--
  MarkupConverterSettings.svelte - Configure text-to-LogSeq markup conversions
-->
<script>
  import { enableMarkupConversion, markupPatternSettings } from '$stores';
  import { getPatternsByCategory } from '$lib/logseq-markup-converter.js';
  
  const patternsByCategory = getPatternsByCategory();
  
  // Category display names
  const categoryNames = {
    tasks: 'Task States',
    priorities: 'Priorities',
    other: 'Other'
  };
  
  function togglePattern(patternId) {
    markupPatternSettings.update(settings => {
      return {
        ...settings,
        [patternId]: !settings[patternId]
      };
    });
  }
  
  function isPatternEnabled(patternId, defaultEnabled) {
    return $markupPatternSettings[patternId] ?? defaultEnabled;
  }
</script>

<div class="markup-settings">
  <div class="setting-header">
    <h3>LogSeq Markup Conversion</h3>
    <label class="toggle-label">
      <input 
        type="checkbox" 
        bind:checked={$enableMarkupConversion}
      />
      <span>Enable</span>
    </label>
  </div>
  
  <p class="description">
    Automatically convert handwritten patterns like <code>[]</code> and <code>[x]</code> 
    into LogSeq TODO/DONE markers when sending to LogSeq.
  </p>
  
  {#if $enableMarkupConversion}
    <div class="pattern-categories">
      {#each Object.entries(patternsByCategory) as [category, patterns]}
        <div class="category">
          <h4>{categoryNames[category] || category}</h4>
          <div class="pattern-list">
            {#each patterns as pattern}
              <label class="pattern-item">
                <input 
                  type="checkbox"
                  checked={isPatternEnabled(pattern.id, pattern.enabled)}
                  on:change={() => togglePattern(pattern.id)}
                />
                <span class="pattern-info">
                  <span class="pattern-name">{pattern.name}</span>
                  <span class="pattern-desc">{pattern.description}</span>
                </span>
              </label>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .markup-settings {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: 15px;
  }
  
  .setting-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  
  .setting-header h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  
  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }
  
  .description {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 15px;
  }
  
  .description code {
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Courier New', monospace;
  }
  
  .pattern-categories {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  
  .category h4 {
    font-size: 0.85rem;
    color: var(--text-secondary);
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  
  .pattern-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .pattern-item {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    cursor: pointer;
    padding: 8px;
    background: var(--bg-secondary);
    border-radius: 6px;
    transition: background 0.2s;
  }
  
  .pattern-item:hover {
    background: var(--bg-primary);
  }
  
  .pattern-item input {
    margin-top: 2px;
  }
  
  .pattern-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .pattern-name {
    font-weight: 500;
    font-size: 0.9rem;
  }
  
  .pattern-desc {
    font-size: 0.8rem;
    color: var(--text-secondary);
    font-family: 'Courier New', monospace;
  }
</style>
```

### 3. TranscriptionView Enhancement

**Modify:** `src/components/transcription/TranscriptionView.svelte`

Add conversion preview before sending:

```svelte
<script>
  // Add imports
  import { previewConversions, getConversionStats } from '$lib/logseq-markup-converter.js';
  import { enableMarkupConversion, markupPatternSettings } from '$stores';
  
  // Reactive conversion preview for expanded pages
  $: getPageConversionPreview = (pageData) => {
    if (!$enableMarkupConversion) return null;
    return previewConversions(pageData.lines, $markupPatternSettings);
  };
  
  $: getPageConversionStats = (pageData) => {
    if (!$enableMarkupConversion) return null;
    return getConversionStats(pageData.lines, $markupPatternSettings);
  };
</script>

<!-- In expanded page details, add conversion preview -->
{#if isExpanded}
  <div class="page-details">
    <!-- Existing sections... -->
    
    <!-- NEW: Conversion Preview -->
    {#if $enableMarkupConversion}
      {@const stats = getPageConversionStats(pageData)}
      {#if stats && stats.converted > 0}
        <div class="detail-section conversion-preview">
          <h4>
            LogSeq Conversion Preview
            <span class="conversion-count">
              {stats.converted} item{stats.converted !== 1 ? 's' : ''} will be converted
            </span>
          </h4>
          <div class="conversion-list">
            {#each getPageConversionPreview(pageData) as preview}
              {#if preview.hasConversion}
                <div class="conversion-item" style="margin-left: {preview.indentLevel * 16}px">
                  <span class="original">{preview.original}</span>
                  <span class="arrow">→</span>
                  <span class="converted">{preview.converted}</span>
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}
```

### 4. LogseqPreview Enhancement

**Modify:** `src/components/transcription/LogseqPreview.svelte`

Show conversion markers inline:

```svelte
<script>
  import { enableMarkupConversion, markupPatternSettings } from '$stores';
  import { convertLine, formatLineForLogseq } from '$lib/logseq-markup-converter.js';
  
  export let lines;
  
  // Apply conversions for preview
  $: previewLines = $enableMarkupConversion 
    ? lines.map(line => {
        const converted = convertLine(line, $markupPatternSettings);
        return {
          ...converted,
          displayText: formatLineForLogseq(converted)
        };
      })
    : lines.map(line => ({ ...line, displayText: line.text }));
</script>

<div class="logseq-preview">
  {#each previewLines as line, i}
    <div 
      class="line"
      class:has-marker={line.logseqMarker}
      style="padding-left: {(line.indentLevel || 0) * 20}px"
    >
      <span class="bullet">•</span>
      {#if line.logseqMarker}
        <span class="marker marker-{line.logseqMarker.toLowerCase()}">{line.logseqMarker}</span>
      {/if}
      <span class="text">{line.text}</span>
    </div>
  {/each}
</div>

<style>
  /* Existing styles... */
  
  .marker {
    font-weight: 600;
    font-size: 0.75rem;
    padding: 2px 6px;
    border-radius: 3px;
    margin-right: 6px;
  }
  
  .marker-todo {
    background: var(--warning);
    color: var(--bg-primary);
  }
  
  .marker-done {
    background: var(--success);
    color: white;
  }
  
  .marker-later {
    background: var(--accent);
    color: white;
  }
  
  .marker-cancelled {
    background: var(--error);
    color: white;
    text-decoration: line-through;
  }
  
  .marker-doing {
    background: #8b5cf6;
    color: white;
  }
  
  .marker-waiting {
    background: #f97316;
    color: white;
  }
</style>
```

---

## Configuration & Settings

### Default Settings

```javascript
// Global enable (default: true)
enableMarkupConversion: true

// Pattern defaults
patterns: {
  emptyCheckbox: true,    // [] → TODO
  checkedCheckbox: true,  // [x] → DONE
  forwardMigrate: false,  // [>] → LATER
  backwardMigrate: false, // [<] → SCHEDULED
  cancelled: false,       // [-] → CANCELLED
  inProgress: false,      // [/] → DOING
  waiting: false          // [?] → WAITING
}
```

### Settings Persistence

- Stored in `localStorage`
- Applied per-browser (not synced)
- Survives page refresh

---

## Testing Strategy

### Unit Tests

```javascript
// logseq-markup-converter.test.js

import { convertLine, convertLines, formatLineForLogseq } from './logseq-markup-converter.js';

describe('LogSeq Markup Converter', () => {
  describe('convertLine', () => {
    test('converts [] to TODO', () => {
      const line = { text: '[] Buy groceries', indentLevel: 0 };
      const result = convertLine(line, { emptyCheckbox: true });
      
      expect(result.logseqMarker).toBe('TODO');
      expect(result.text).toBe('Buy groceries');
      expect(result.originalText).toBe('[] Buy groceries');
    });
    
    test('converts [ ] with space to TODO', () => {
      const line = { text: '[ ] Buy groceries', indentLevel: 0 };
      const result = convertLine(line, { emptyCheckbox: true });
      
      expect(result.logseqMarker).toBe('TODO');
      expect(result.text).toBe('Buy groceries');
    });
    
    test('converts [x] to DONE', () => {
      const line = { text: '[x] Completed task', indentLevel: 0 };
      const result = convertLine(line, { checkedCheckbox: true });
      
      expect(result.logseqMarker).toBe('DONE');
      expect(result.text).toBe('Completed task');
    });
    
    test('converts [X] uppercase to DONE', () => {
      const line = { text: '[X] Completed task', indentLevel: 0 };
      const result = convertLine(line, { checkedCheckbox: true });
      
      expect(result.logseqMarker).toBe('DONE');
    });
    
    test('skips line with existing bullet metadata', () => {
      const line = { 
        text: '[] Buy groceries', 
        bullet: { type: 'task', state: 'open' }
      };
      const result = convertLine(line, { emptyCheckbox: true });
      
      expect(result.logseqMarker).toBeUndefined();
      expect(result.text).toBe('[] Buy groceries'); // Unchanged
    });
    
    test('skips disabled patterns', () => {
      const line = { text: '[] Buy groceries', indentLevel: 0 };
      const result = convertLine(line, { emptyCheckbox: false });
      
      expect(result.logseqMarker).toBeUndefined();
      expect(result.text).toBe('[] Buy groceries');
    });
    
    test('handles leading whitespace', () => {
      const line = { text: '  [] Indented task', indentLevel: 1 };
      const result = convertLine(line, { emptyCheckbox: true });
      
      expect(result.logseqMarker).toBe('TODO');
      expect(result.text).toBe('Indented task');
    });
    
    test('returns unchanged if no pattern matches', () => {
      const line = { text: 'Regular text', indentLevel: 0 };
      const result = convertLine(line, { emptyCheckbox: true });
      
      expect(result.logseqMarker).toBeUndefined();
      expect(result.text).toBe('Regular text');
    });
  });
  
  describe('formatLineForLogseq', () => {
    test('prepends logseqMarker to text', () => {
      const line = { text: 'Buy groceries', logseqMarker: 'TODO' };
      const result = formatLineForLogseq(line);
      
      expect(result).toBe('TODO Buy groceries');
    });
    
    test('formats bullet metadata for tasks', () => {
      const line = { 
        text: 'Buy groceries', 
        bullet: { type: 'task', state: 'done' }
      };
      const result = formatLineForLogseq(line);
      
      expect(result).toBe('DONE Buy groceries');
    });
    
    test('returns plain text if no marker', () => {
      const line = { text: 'Regular note' };
      const result = formatLineForLogseq(line);
      
      expect(result).toBe('Regular note');
    });
  });
  
  describe('convertLines', () => {
    test('converts array of lines', () => {
      const lines = [
        { text: '[] Task 1', indentLevel: 0 },
        { text: '[x] Task 2', indentLevel: 0 },
        { text: 'Regular line', indentLevel: 0 }
      ];
      
      const results = convertLines(lines, { 
        emptyCheckbox: true, 
        checkedCheckbox: true 
      });
      
      expect(results[0].logseqMarker).toBe('TODO');
      expect(results[1].logseqMarker).toBe('DONE');
      expect(results[2].logseqMarker).toBeUndefined();
    });
  });
});
```

### Integration Tests

```javascript
describe('LogSeq API with Markup Conversion', () => {
  test('sends converted lines to LogSeq', async () => {
    const lines = [
      { text: '[] Buy groceries', indentLevel: 0 },
      { text: '[x] Already done', indentLevel: 1 }
    ];
    
    const result = await sendToLogseq(lines, host, token, {
      enableMarkupConversion: true,
      enabledPatterns: { emptyCheckbox: true, checkedCheckbox: true }
    });
    
    expect(result.success).toBe(true);
    
    // Verify blocks in LogSeq
    const page = await getPage(host, token, result.page);
    expect(page.blocks[1].content).toContain('TODO Buy groceries');
    expect(page.blocks[2].content).toContain('DONE Already done');
  });
});
```

### Manual Testing Checklist

**Test Cases:**

1. **Empty checkbox basic**
   - Write: `[] Buy groceries`
   - Transcribe and send to LogSeq
   - Verify: Block shows `TODO Buy groceries`

2. **Checked checkbox variations**
   - Write: `[x] Done task` and `[X] Also done`
   - Both should convert to `DONE`

3. **Mixed content**
   - Write mix of checkboxes and regular text
   - Only checkbox lines should have markers

4. **Indented tasks**
   - Write nested checkboxes
   - Verify hierarchy preserved with markers

5. **Settings toggle**
   - Disable conversion in settings
   - Lines should pass through unchanged

6. **Individual pattern toggle**
   - Enable only empty checkbox
   - `[]` converts, `[x]` does not

---

## Implementation Phases

### Phase 1: Core TODO/DONE (MVP) - 4-6 hours

**Deliverables:**
- [ ] Create `logseq-markup-converter.js` with basic patterns
- [ ] Integrate conversion into `sendToLogseq()`
- [ ] Add global enable/disable setting
- [ ] Basic unit tests

**Patterns:**
- `[]` / `[ ]` → `TODO`
- `[x]` / `[X]` → `DONE`

### Phase 2: Settings UI - 2-3 hours

**Deliverables:**
- [ ] Create `MarkupConverterSettings.svelte`
- [ ] Add per-pattern toggles
- [ ] Integrate into Settings panel
- [ ] Persist settings in localStorage

### Phase 3: Preview Integration - 2-3 hours

**Deliverables:**
- [ ] Enhance `LogseqPreview.svelte` with marker display
- [ ] Add conversion preview to `TranscriptionView.svelte`
- [ ] Show conversion stats before sending

### Phase 4: Extended Patterns - 3-4 hours

**Deliverables:**
- [ ] Add extended task states (`[>]`, `[<]`, `[-]`, `[/]`, `[?]`)
- [ ] Update settings UI for new patterns
- [ ] Additional unit tests

### Phase 5: Documentation & Polish - 2 hours

**Deliverables:**
- [ ] Update README with feature documentation
- [ ] Add tooltips/help text in UI
- [ ] Edge case handling and error messages

---

## Future Enhancements

### 1. Custom Patterns

Allow users to define their own text patterns:

```javascript
// User-defined pattern
{
  name: "Important",
  regex: /^\s*\[!\]\s*/,
  logseqMarker: "TODO",
  suffix: " #priority/high",
  enabled: true
}
```

### 2. Smart Date Parsing

Convert date-like text to LogSeq date links:

```javascript
// "Meeting @tomorrow" → "Meeting [[2025-01-16]]"
// "Due @next-friday" → "Due [[2025-01-17]]"
```

### 3. Tag Extraction

Detect and preserve/enhance hashtags:

```javascript
// "#project-alpha" → "#project-alpha" (pass-through)
// Or convert to: "[[project-alpha]]" (page link)
```

### 4. Undo/History

Track conversions for potential undo:

```javascript
// Store original text for reversal
{
  original: "[] Buy groceries",
  converted: "TODO Buy groceries",
  timestamp: 1705332000000
}
```

### 5. Batch Pattern Learning

Analyze user's handwriting patterns over time:

- "User often writes `()` for tasks - suggest adding pattern"
- "User never uses `[>]` - suggest disabling"

---

## Appendix A: LogSeq Task Keywords

### Standard Keywords

| Keyword | Purpose | Color (default theme) |
|---------|---------|----------------------|
| `TODO` | Open task | Orange |
| `DOING` | In progress | Blue |
| `DONE` | Completed | Green |
| `LATER` | Deferred | Gray |
| `NOW` | Current focus | Red |
| `WAITING` | Blocked | Yellow |
| `CANCELLED` | Cancelled | Strikethrough |

### Custom Keywords

LogSeq supports custom keywords via config:

```clojure
;; config.edn
:todo/keywords ["TODO" "DOING" "DONE" "WAITING" "CANCELLED" "DELEGATED"]
```

---

## Appendix B: MyScript Transcription Behavior

### Bracket Recognition

MyScript typically transcribes brackets accurately:
- `[` → `[`
- `]` → `]`
- `x` inside brackets → `x`

### Common Variations

| Handwritten | Possible Transcription |
|-------------|----------------------|
| Square checkbox | `[]` or `[ ]` |
| Checked box | `[x]`, `[X]`, `[✓]` |
| Crossed box | `[×]`, `[X]` |
| Empty parens | `()` (not converted) |

### Edge Cases

- Very small brackets may be missed
- Connected brackets (no space) may merge with text
- Cursive X may transcribe as other characters

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | Jan 2026 | Initial | Complete specification for text-based markup conversion |

---

## References

- [LogSeq Tasks Documentation](https://docs.logseq.com/#/page/tasks)
- [Bullet Journal Method](https://bulletjournal.com/)
- [SmartPen-LogSeq Bridge App Specification](./app-specification.md)
- [Bullet Journal Symbol Detection](./bullet-journal-spec.md)
