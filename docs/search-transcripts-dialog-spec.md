# Search Transcripts Dialog - Feature Specification

**Quick Implementation: 4-6 hours**  
**Version:** 1.0  
**Date:** January 2026

---

## Overview

Add a **"Search Transcripts"** button to the Stroke Preview header that opens a dialog allowing users to search through transcribed text from pages stored in LogSeq, view matching results with highlighted search terms, and import selected pages into the canvas.

### Key Features
- 🔍 Bag-of-words search (case-insensitive, handles OCR imperfections)
- 💡 Highlighted search terms in results
- ✅ Multi-select pages for batch import
- 📊 Shows page metadata (book, page, stroke count, date)
- ⚡ Real-time search results (debounced <100ms)

---

## User Flow

```
[Stroke Preview Canvas] → Click "🔍 Search Transcripts" button
                         ↓
                  [Dialog Opens]
                         ↓
              Enter "roadmap meeting"
                         ↓
         [Real-time filtered results appear]
         Shows 3 pages with "roadmap" or "meeting"
         Terms highlighted in yellow
                         ↓
              Select 2 pages (checkboxes)
                         ↓
              Click "Import Selected"
                         ↓
         [Progress indicator shows import]
                         ↓
         Import complete → Dialog closes
         → Strokes appear in canvas
```

### Alternative: Cancel
```
[Dialog Open] → Click "Cancel" or [X]
              → Dialog closes
              → No changes made
```

---

## UI Design

### 1. Stroke Preview Header (Updated)

**Before:**
```
┌─────────────────────────────────────────────────────────────┐
│ Stroke Preview                                              │
│ [Clear] [Select All] [🎨 Deselect Decorative]  47 strokes  │
└─────────────────────────────────────────────────────────────┘
```

**After:**
```
┌─────────────────────────────────────────────────────────────┐
│ Stroke Preview                                              │
│ [Clear] [Select All] [🎨 Deselect Decorative]              │
│ [🔍 Search Transcripts] ← NEW                   47 strokes  │
└─────────────────────────────────────────────────────────────┘
```

**Button Behavior:**
- Enabled only when LogSeq is connected AND pages have been scanned
- Shows tooltip: "Search transcribed text in LogSeq database"
- Click → Opens SearchTranscriptsDialog

---

### 2. Search Transcripts Dialog

**Dialog Layout:**
```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 Search Transcripts                                      [×] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [Search: "meeting roadmap"                              ]  🔍  │
│  ↑ Instant search, case-insensitive                            │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Found 3 pages with matching text:                       │ │
│  ├───────────────────────────────────────────────────────────┤ │
│  │  ☐ Book 161 - Page 3                    47 strokes      │ │
│  │     Jan 6, 2026 10:34 AM                                 │ │
│  │     "Discussed Q1 roadmap with team. Action items:      │ │
│  │      ▸ Review meeting notes...                          │ │
│  │      ▸ Follow up with..."                               │ │
│  │     ─────────────────────────────────────────────────    │ │
│  │  ☑ Book 161 - Page 7                    23 strokes      │ │
│  │     Jan 6, 2026 11:15 AM                                 │ │
│  │     "Follow-up meeting on budget constraints. Need to   │ │
│  │      revise roadmap based on..."                        │ │
│  │     ─────────────────────────────────────────────────    │ │
│  │  ☐ Book 162 - Page 2                    31 strokes      │ │
│  │     Jan 7, 2026 9:00 AM                                  │ │
│  │     "Project roadmap draft. Timeline: Q1 kickoff..."    │ │
│  │                                                           │ │
│  │  [Scroll for more results...]                            │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│                            [Cancel]  [Import Selected (1)] ← Disabled if none selected │
└─────────────────────────────────────────────────────────────────┘
```

**Key Elements:**

#### Search Input
- Full-width text input at top
- Placeholder: "Search transcribed text..."
- Debounced 200ms (updates results as you type)
- Clear button (×) appears when text entered

#### Results List
- Scrollable container (max height: 60vh)
- Empty state: "No pages with transcription text found" (if no pages)
- No results state: "No matches found for 'xyz'" (if no matches)
- Virtual scrolling if >50 results (unlikely but future-proof)

#### Individual Result Card
- Checkbox for selection
- **Header:** `Book {id} - Page {num}` with book alias if available
- **Metadata:** `{date} {time} • {strokeCount} strokes`
- **Transcript Preview:** 
  - First 200 characters
  - **Matched terms highlighted in yellow background**
  - Ellipsis (...) if truncated
  - Multiple lines preserved with indentation
- Clickable → toggles checkbox
- Hover effect: slight background color change

#### Actions
- **Cancel:** Close dialog without importing
- **Import Selected (N):** Import checked pages, shows count
  - Disabled if no pages selected
  - Shows loading spinner during import
  - Progress: "Importing 1/3..." updates in real-time

---

## Component Structure

### New Components

```
src/components/dialog/
└── SearchTranscriptsDialog.svelte       # Main dialog component
    └── TranscriptSearchResult.svelte     # Individual search result card
```

### Component Hierarchy
```
App.svelte
└── StrokeCanvas.svelte
    ├── [Existing canvas controls...]
    └── SearchTranscriptsDialog.svelte (conditional: {#if showSearchDialog})
        ├── Dialog overlay
        ├── Search input
        └── Results list
            └── TranscriptSearchResult.svelte (multiple)
                ├── Checkbox
                ├── Page header
                ├── Metadata
                └── Transcript preview (with highlighting)
```

---

## Implementation Details

### 1. Store Updates (stores/ui.js)

```javascript
// Add to existing ui.js store
export const showSearchTranscriptsDialog = writable(false);

// Helper functions
export function openSearchTranscriptsDialog() {
  showSearchTranscriptsDialog.set(true);
}

export function closeSearchTranscriptsDialog() {
  showSearchTranscriptsDialog.set(false);
}
```

---

### 2. Search Algorithm (lib/transcript-search.js)

```javascript
/**
 * Tokenize text for search (bag-of-words)
 * @param {string} text - Text to tokenize
 * @returns {Set<string>} Set of lowercase tokens
 */
export function tokenize(text) {
  if (!text) return new Set();
  
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')  // Remove punctuation
      .split(/\s+/)               // Split on whitespace
      .filter(word => word.length > 2) // Ignore short words (a, to, is, etc.)
  );
}

/**
 * Search pages by transcription text (bag-of-words)
 * @param {Array} pages - Array of LogSeqPageData objects
 * @param {string} query - Search query
 * @returns {Array} Matching pages with match scores
 */
export function searchPages(pages, query) {
  if (!query || !query.trim()) return pages;
  
  const queryTokens = Array.from(tokenize(query));
  
  if (queryTokens.length === 0) return pages;
  
  return pages
    .filter(page => page.transcriptionText) // Only pages with transcription
    .map(page => {
      const pageTokens = tokenize(page.transcriptionText);
      
      // Count how many query tokens match (OR search)
      const matchCount = queryTokens.filter(queryToken =>
        Array.from(pageTokens).some(pageToken =>
          pageToken.includes(queryToken) || queryToken.includes(pageToken)
        )
      ).length;
      
      return {
        ...page,
        matchScore: matchCount
      };
    })
    .filter(page => page.matchScore > 0) // Only pages with at least one match
    .sort((a, b) => b.matchScore - a.matchScore); // Rank by relevance
}

/**
 * Highlight matching terms in text
 * @param {string} text - Original text
 * @param {string} query - Search query
 * @returns {string} HTML with <mark> tags around matches
 */
export function highlightMatches(text, query) {
  if (!query || !query.trim()) return escapeHtml(text);
  
  const queryTokens = Array.from(tokenize(query));
  if (queryTokens.length === 0) return escapeHtml(text);
  
  let highlighted = text;
  
  // Create regex for each query token (case-insensitive)
  queryTokens.forEach(token => {
    // Match whole words or parts of words (flexible for OCR errors)
    const regex = new RegExp(`(${escapeRegex(token)})`, 'gi');
    highlighted = highlighted.replace(regex, '<mark>$1</mark>');
  });
  
  return highlighted;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

---

### 3. SearchTranscriptsDialog.svelte

```svelte
<!--
  SearchTranscriptsDialog.svelte - Search and import pages by transcription text
-->
<script>
  import { onMount } from 'svelte';
  import { logseqPages } from '$stores';
  import { showSearchTranscriptsDialog, closeSearchTranscriptsDialog, log } from '$stores';
  import { importStrokesFromLogSeq } from '$lib/logseq-import.js';
  import { searchPages } from '$lib/transcript-search.js';
  import TranscriptSearchResult from './TranscriptSearchResult.svelte';
  
  let searchQuery = '';
  let selectedPages = new Set();
  let importing = false;
  let importProgress = { current: 0, total: 0, message: '' };
  
  // Filter pages with transcription text
  $: pagesWithTranscription = $logseqPages.filter(p => p.transcriptionText);
  
  // Search results (debounced)
  let searchResults = [];
  let debounceTimer;
  
  $: {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (searchQuery.trim()) {
        searchResults = searchPages(pagesWithTranscription, searchQuery);
      } else {
        searchResults = pagesWithTranscription;
      }
    }, 200);
  }
  
  function toggleSelection(page) {
    const key = `B${page.book}/P${page.page}`;
    if (selectedPages.has(key)) {
      selectedPages.delete(key);
    } else {
      selectedPages.add(key);
    }
    selectedPages = selectedPages; // Trigger reactivity
  }
  
  function isSelected(page) {
    return selectedPages.has(`B${page.book}/P${page.page}`);
  }
  
  async function handleImport() {
    if (selectedPages.size === 0) return;
    
    importing = true;
    const pagesToImport = searchResults.filter(p => isSelected(p));
    importProgress = { current: 0, total: pagesToImport.length, message: '' };
    
    let successCount = 0;
    
    for (let i = 0; i < pagesToImport.length; i++) {
      const page = pagesToImport[i];
      importProgress = {
        current: i + 1,
        total: pagesToImport.length,
        message: `Importing B${page.book}/P${page.page}...`
      };
      
      try {
        const result = await importStrokesFromLogSeq(page);
        if (result.success) {
          successCount++;
        }
      } catch (error) {
        console.error('Import error:', error);
      }
    }
    
    log(`Import complete: ${successCount}/${pagesToImport.length} pages`, 'success');
    importing = false;
    closeSearchTranscriptsDialog();
  }
  
  function handleClose() {
    if (!importing) {
      closeSearchTranscriptsDialog();
    }
  }
  
  function handleKeydown(event) {
    if (event.key === 'Escape' && !importing) {
      handleClose();
    }
  }
  
  // Focus search input on mount
  let searchInput;
  onMount(() => {
    if (searchInput) {
      searchInput.focus();
    }
  });
</script>

<svelte:window on:keydown={handleKeydown} />

{#if $showSearchTranscriptsDialog}
  <div class="dialog-overlay" on:click={handleClose}>
    <div class="dialog" on:click|stopPropagation>
      <div class="dialog-header">
        <h3>🔍 Search Transcripts</h3>
        <button class="close-btn" on:click={handleClose} disabled={importing}>×</button>
      </div>
      
      <div class="search-section">
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="text"
          placeholder="Search transcribed text..."
          disabled={importing}
        />
        {#if searchQuery}
          <button class="clear-search" on:click={() => searchQuery = ''}>×</button>
        {/if}
      </div>
      
      <div class="results-section">
        {#if importing}
          <div class="importing-overlay">
            <div class="spinner">⏳</div>
            <div class="import-message">
              {importProgress.message}
              <br>
              <small>({importProgress.current}/{importProgress.total})</small>
            </div>
          </div>
        {/if}
        
        {#if pagesWithTranscription.length === 0}
          <div class="empty-state">
            <div class="icon">📄</div>
            <p>No pages with transcription text found in LogSeq.</p>
            <p class="hint">Transcribe and save pages first.</p>
          </div>
        {:else if searchQuery && searchResults.length === 0}
          <div class="empty-state">
            <div class="icon">🔍</div>
            <p>No matches found for "<strong>{searchQuery}</strong>"</p>
          </div>
        {:else}
          <div class="results-header">
            Found {searchResults.length} {searchResults.length === 1 ? 'page' : 'pages'}
            {#if searchQuery}with matching text{/if}
          </div>
          
          <div class="results-list">
            {#each searchResults as page (page.pageName)}
              <TranscriptSearchResult
                {page}
                query={searchQuery}
                selected={isSelected(page)}
                on:toggle={() => toggleSelection(page)}
                disabled={importing}
              />
            {/each}
          </div>
        {/if}
      </div>
      
      <div class="dialog-actions">
        <button class="btn btn-secondary" on:click={handleClose} disabled={importing}>
          Cancel
        </button>
        <button 
          class="btn btn-primary" 
          on:click={handleImport}
          disabled={selectedPages.size === 0 || importing}
        >
          {#if importing}
            Importing...
          {:else}
            Import Selected ({selectedPages.size})
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 20px;
  }
  
  .dialog {
    background: var(--bg-secondary);
    border-radius: 12px;
    max-width: 700px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  
  .dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    border-bottom: 1px solid var(--border);
  }
  
  .dialog-header h3 {
    margin: 0;
    font-size: 1.25rem;
    color: var(--text-primary);
  }
  
  .close-btn {
    background: none;
    border: none;
    font-size: 2rem;
    line-height: 1;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0;
    width: 32px;
    height: 32px;
    border-radius: 4px;
    transition: all 0.2s;
  }
  
  .close-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .close-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .search-section {
    padding: 20px;
    border-bottom: 1px solid var(--border);
    position: relative;
  }
  
  .search-section input {
    width: 100%;
    padding: 12px 40px 12px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  .search-section input:focus {
    outline: none;
    border-color: var(--accent);
  }
  
  .clear-search {
    position: absolute;
    right: 28px;
    top: 50%;
    transform: translateY(-50%);
    background: var(--bg-tertiary);
    border: none;
    color: var(--text-secondary);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    line-height: 1;
    border-radius: 4px;
  }
  
  .clear-search:hover {
    background: var(--border);
    color: var(--text-primary);
  }
  
  .results-section {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  
  .importing-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(26, 26, 46, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    z-index: 10;
  }
  
  .spinner {
    font-size: 3rem;
    animation: spin 1s linear infinite;
  }
  
  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  
  .import-message {
    color: var(--text-primary);
    text-align: center;
  }
  
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
    text-align: center;
    color: var(--text-secondary);
  }
  
  .empty-state .icon {
    font-size: 4rem;
    margin-bottom: 16px;
    opacity: 0.5;
  }
  
  .empty-state p {
    margin: 8px 0;
  }
  
  .empty-state .hint {
    font-size: 0.875rem;
    color: var(--text-tertiary);
  }
  
  .results-header {
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  
  .results-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 20px;
  }
  
  .results-list::-webkit-scrollbar {
    width: 8px;
  }
  
  .results-list::-webkit-scrollbar-track {
    background: var(--bg-tertiary);
    border-radius: 4px;
  }
  
  .results-list::-webkit-scrollbar-thumb {
    background: var(--border);
    border-radius: 4px;
  }
  
  .results-list::-webkit-scrollbar-thumb:hover {
    background: var(--accent);
  }
  
  .dialog-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding: 20px;
    border-top: 1px solid var(--border);
  }
  
  .btn {
    padding: 10px 20px;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }
  
  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border: 1px solid var(--border);
  }
  
  .btn-secondary:hover:not(:disabled) {
    background: var(--border);
  }
  
  .btn-primary {
    background: var(--accent);
    color: white;
  }
  
  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }
  
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
```

---

### 4. TranscriptSearchResult.svelte

```svelte
<!--
  TranscriptSearchResult.svelte - Individual search result card
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { highlightMatches } from '$lib/transcript-search.js';
  import { bookAliases } from '$stores';
  
  export let page;
  export let query = '';
  export let selected = false;
  export let disabled = false;
  
  const dispatch = createEventDispatcher();
  
  function handleToggle() {
    if (!disabled) {
      dispatch('toggle');
    }
  }
  
  function formatDate(timestamp) {
    if (!timestamp) return 'Unknown';
    return new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }
  
  // Get book alias or fallback
  $: bookName = $bookAliases[page.book] || `Book ${page.book}`;
  
  // Truncate and highlight transcript
  $: transcriptPreview = page.transcriptionText?.slice(0, 200) || '';
  $: highlightedText = highlightMatches(transcriptPreview, query);
</script>

<div 
  class="result-card" 
  class:selected
  class:disabled
  on:click={handleToggle}
>
  <div class="result-header">
    <input 
      type="checkbox" 
      checked={selected}
      {disabled}
      on:click|stopPropagation
    />
    <div class="result-title">
      <strong>{bookName} - Page {page.page}</strong>
    </div>
  </div>
  
  <div class="result-meta">
    <span>{formatDate(page.lastUpdated)}</span>
    <span class="separator">•</span>
    <span>{page.strokeCount} strokes</span>
  </div>
  
  <div class="result-transcript">
    {@html highlightedText}
    {#if page.transcriptionText?.length > 200}...{/if}
  </div>
</div>

<style>
  .result-card {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px;
    margin-bottom: 10px;
    cursor: pointer;
    transition: all 0.2s;
  }
  
  .result-card:hover:not(.disabled) {
    background: var(--bg-primary);
    border-color: var(--accent);
  }
  
  .result-card.selected {
    border-color: var(--accent);
    background: rgba(233, 69, 96, 0.1);
  }
  
  .result-card.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  
  .result-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  
  .result-header input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }
  
  .result-title {
    flex: 1;
    color: var(--text-primary);
    font-size: 1rem;
  }
  
  .result-meta {
    display: flex;
    gap: 8px;
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-bottom: 10px;
    padding-left: 28px;
  }
  
  .separator {
    color: var(--text-tertiary);
  }
  
  .result-transcript {
    padding: 10px;
    background: rgba(0, 0, 0, 0.2);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 0.875rem;
    line-height: 1.5;
    margin-left: 28px;
    white-space: pre-wrap;
  }
  
  .result-transcript :global(mark) {
    background: rgba(255, 235, 59, 0.4);
    color: var(--text-primary);
    padding: 2px 0;
    border-radius: 2px;
  }
</style>
```

---

### 5. Button Integration (StrokeCanvas.svelte)

**Add to header-actions section:**

```svelte
<script>
  // ... existing imports ...
  import { openSearchTranscriptsDialog } from '$stores';
  import { logseqConnected, logseqPages } from '$stores';
  import SearchTranscriptsDialog from '../dialog/SearchTranscriptsDialog.svelte';
  
  // Check if search is available
  $: canSearch = $logseqConnected && $logseqPages.some(p => p.transcriptionText);
</script>

<!-- In header-actions div, add button -->
<div class="header-actions">
  {#if $strokeCount > 0}
    <button class="header-btn" ...>Clear</button>
    <button class="header-btn" ...>Select All</button>
    <button class="header-btn decorative-btn" ...>
      🎨 Deselect Decorative
    </button>
    
    <!-- NEW: Search Transcripts Button -->
    <button 
      class="header-btn search-btn"
      on:click={openSearchTranscriptsDialog}
      disabled={!canSearch}
      title={canSearch 
        ? 'Search transcribed text in LogSeq database'
        : 'Connect to LogSeq and scan pages with transcriptions first'}
    >
      🔍 Search Transcripts
    </button>
  {/if}
</div>

<!-- Add dialog at end of component -->
<SearchTranscriptsDialog />
```

**Add CSS:**

```css
.search-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-weight: 500;
}

.search-btn:hover:not(:disabled) {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
```

---

## Testing Checklist

### Unit Tests
- [ ] `tokenize()` correctly splits and filters text
- [ ] `searchPages()` finds matches with bag-of-words
- [ ] `highlightMatches()` wraps matches in `<mark>` tags
- [ ] Case-insensitive matching works
- [ ] Partial word matching works (e.g., "road" matches "roadmap")

### Integration Tests
- [ ] Button enabled when LogSeq connected + pages with transcription exist
- [ ] Button disabled when not connected or no transcribed pages
- [ ] Dialog opens when button clicked
- [ ] Search input receives focus on open
- [ ] Results update as you type (debounced)
- [ ] Selecting page updates checkbox state
- [ ] Import button shows correct count
- [ ] Import progress displayed during import
- [ ] Dialog closes after successful import
- [ ] ESC key closes dialog (when not importing)

### Manual Test Cases

1. **No LogSeq Connection:**
   - Result: Button disabled, tooltip shows reason

2. **LogSeq Connected, No Transcribed Pages:**
   - Result: Button disabled, tooltip shows reason

3. **LogSeq Connected, Has Transcribed Pages:**
   - Result: Button enabled, click opens dialog

4. **Empty Search:**
   - Result: Shows all pages with transcription

5. **Search "meeting":**
   - Result: Only pages with "meeting" shown
   - Verify: "meeting" highlighted in yellow

6. **Search "MEETING" (uppercase):**
   - Result: Same as lowercase (case-insensitive)

7. **Search "road" (partial match):**
   - Result: Pages with "roadmap", "road", "roads" all match

8. **Search "xyz" (no matches):**
   - Result: "No matches found for 'xyz'" message

9. **Select 3 Pages, Click Import:**
   - Result: Progress shows "Importing 1/3...", "2/3...", "3/3..."
   - Result: Success message, dialog closes, strokes appear in canvas

10. **Click Cancel:**
    - Result: Dialog closes, no import happens

11. **Press ESC:**
    - Result: Dialog closes (same as Cancel)

12. **During Import, Try to Close:**
    - Result: Close button disabled, ESC does nothing

---

## Performance Targets

| Metric | Target | Implementation |
|--------|--------|----------------|
| Search response | <100ms | Debounced input, pre-tokenized pages |
| Dialog open time | <200ms | Component kept in DOM, just show/hide |
| Highlight rendering | <50ms per result | Simple string replacement |
| Import time | <1s per page | Existing `importStrokesFromLogSeq` |

---

## Accessibility

- [ ] Search input has aria-label
- [ ] Dialog has proper focus trap (focus stays inside while open)
- [ ] ESC key closes dialog
- [ ] Checkbox labels associated properly
- [ ] Keyboard navigation works (Tab through results)
- [ ] Screen reader announces search results count

---

## Edge Cases

1. **Page Imported Already:**
   - Existing deduplication in `importStrokesFromLogSeq` handles this
   - Log message: "X duplicates skipped"

2. **Import Failure:**
   - Show error in log
   - Continue with next page
   - Final summary shows "N/M pages imported"

3. **Very Long Transcription:**
   - Truncate to 200 chars with ellipsis
   - Full text available when imported

4. **Special Characters in Search:**
   - Escaped properly in regex
   - Won't break highlighting

5. **Many Results (>100):**
   - Virtual scrolling not initially implemented
   - Future enhancement if needed

---

## Future Enhancements (Not in MVP)

- [ ] Advanced search: AND/OR operators, phrase matching
- [ ] Filter by book in dialog
- [ ] Filter by date range in dialog
- [ ] Sort results (relevance, date, book/page)
- [ ] Preview strokes in dialog (thumbnail)
- [ ] Save search history
- [ ] Export search results

---

## Success Metrics

**After implementation, users should be able to:**
- ✅ Find pages by content in <10 seconds
- ✅ See relevant matches highlighted
- ✅ Select and import multiple pages in one action
- ✅ Import without leaving stroke canvas view

---

## Implementation Estimate

**Total: 4-6 hours**

- Hour 1: Create `transcript-search.js` utilities, test search algorithm
- Hour 2: Build `TranscriptSearchResult.svelte`, test highlighting
- Hour 3: Build `SearchTranscriptsDialog.svelte`, wire up store
- Hour 4: Integrate button into `StrokeCanvas.svelte`, test end-to-end
- Hour 5-6: Polish UI, test edge cases, accessibility

---

## Next Steps

1. Review this spec - any changes to UX or features?
2. Start with `transcript-search.js` utilities (easiest to test standalone)
3. Build `TranscriptSearchResult` component with mock data
4. Wire up dialog and store integration
5. Test with real data from LogSeq

Ready to implement?
