# Book Aliases / Nicknames - Feature Specification

**Status:** Proposed  
**Priority:** Medium  
**Complexity:** Medium  
**Estimated Effort:** 6-8 hours

---

## Overview

Enable users to assign human-readable aliases/nicknames to book IDs (e.g., "Work Notes" instead of "B3017") to make multi-notebook workflows more intuitive and manageable.

### Problem Statement

Currently, books are identified only by numeric IDs like "B3017" or "B387" throughout the application. When working with multiple notebooks:
- Users must remember which book ID corresponds to which physical notebook
- The UI displays cryptic numbers that have no semantic meaning
- Filtering and organization become cognitively demanding

### Solution

Allow users to assign custom aliases to books that will be displayed alongside (or instead of) numeric IDs throughout the application.

---

## User Stories

1. **As a user with multiple notebooks**, I want to assign names like "Work Notes", "Site Visits", or "Personal Journal" to my books so I can quickly identify them.

2. **As a user reviewing transcriptions**, I want to see "Work Notes (B3017)" in the page cards so I know which physical notebook this data came from.

3. **As a user managing LogSeq data**, I want the database explorer to show book aliases in the accordion headers so browsing is more intuitive.

4. **As a user filtering canvas strokes**, I want the page selector dropdown to show aliases so I can quickly filter to the right notebook.

---

## Data Storage Strategy

### Dual Storage Approach (Recommended)

Store book aliases in **both** local browser storage **and** LogSeq pages for maximum flexibility.

#### Local Storage (Primary)
```javascript
// Stored in localStorage
{
  "bookAliases": {
    "3017": {
      "alias": "Work Notes",
      "created": 1734905600000,
      "lastModified": 1734905600000
    },
    "387": {
      "alias": "Site Visits",
      "created": 1734905600000,
      "lastModified": 1734905600000
    }
  }
}
```

**Pros:**
- Fast access (no API calls)
- Works offline
- Survives browser restarts
- Device-specific customization

**Cons:**
- Not synced across devices
- Lost if browser storage cleared
- Can't be backed up to LogSeq

#### LogSeq Storage (Backup/Sync)
```markdown
page:: smartpen config/book aliases

## Book Aliases
- Book:: 3017
  alias:: Work Notes
  created:: [[2024-12-22]]
  modified:: [[2024-12-22]]

- Book:: 387
  alias:: Site Visits
  created:: [[2024-12-22]]
  modified:: [[2024-12-22]]
```

**Pros:**
- Persistent in LogSeq graph
- Backed up with LogSeq data
- Can be edited manually in LogSeq
- Synced across devices (if using LogSeq sync)
- Version controlled (if using git)

**Cons:**
- Requires LogSeq connection
- Slower access (HTTP API calls)
- May conflict with manual edits

### Sync Strategy

1. **On App Start:**
   - Load aliases from localStorage (immediate availability)
   - If LogSeq connected, fetch aliases from LogSeq page
   - Merge: LogSeq aliases override localStorage if timestamps are newer
   - Update localStorage with merged data

2. **On Alias Add/Edit/Delete:**
   - Update localStorage immediately (instant feedback)
   - If LogSeq connected, update LogSeq page in background
   - If LogSeq update fails, queue for retry on next connection
   - Show sync status indicator

3. **On LogSeq Connection:**
   - Pull latest aliases from LogSeq
   - Resolve conflicts (newest timestamp wins)
   - Push any local-only aliases to LogSeq

---

## UI Implementation

### 1. Settings Panel - Book Alias Manager

**Location:** New section in Settings panel

```
┌─────────────────────────────────────────────┐
│ 📚 Book Aliases                             │
├─────────────────────────────────────────────┤
│                                              │
│ Book 3017  [Work Notes       ] [Save] [×]  │
│ Book 387   [Site Visits      ] [Save] [×]  │
│ Book 42    [                 ] [Add ]      │
│                                              │
│ [+ Add Book Alias]                          │
│                                              │
│ ℹ️ Aliases are stored locally and synced   │
│    to LogSeq when connected                 │
│                                              │
│ Sync Status: ✓ Synced with LogSeq          │
└─────────────────────────────────────────────┘
```

**Features:**
- List all known books (from current session + localStorage)
- Inline editing with save confirmation
- Delete button removes alias
- Add button for new books
- Sync status indicator
- Option to "Fetch from LogSeq" or "Push to LogSeq"

### 2. Display Formatting

#### Format Options:
- **Full:** `Work Notes (B3017)` - Shows both alias and book ID
- **Alias Only:** `Work Notes` - Shows only alias if available
- **ID Only:** `B3017` - Fallback when no alias

#### Recommended Format by Context:
- **Canvas hover tooltip:** `Work Notes (B3017) / P42`
- **Strokes tab headers:** `Work Notes (B3017)`
- **Transcription tab:** `Work Notes (B3017) / Page 42`
- **LogSeq DB Explorer:** `Work Notes (B3017)` in accordion header
- **Page selector dropdown:** `Work Notes (B3017)` for each option
- **Activity log:** `Work Notes (B3017)/P42`

---

## Technical Implementation

### File Structure

```
src/
├── stores/
│   ├── settings.js                    (add bookAliases store)
│   └── book-aliases.js                (NEW - sync logic)
├── lib/
│   ├── logseq-alias-sync.js          (NEW - LogSeq sync)
│   └── alias-formatter.js             (NEW - formatting utilities)
├── components/
│   └── settings/
│       └── BookAliasManager.svelte    (NEW - UI component)
└── utils/
    └── formatting.js                  (add formatBookName helper)
```

### Store Implementation

```javascript
// src/stores/book-aliases.js
import { writable, derived } from 'svelte/store';
import { createPersistedStore } from './settings.js';

// Local storage (primary)
export const bookAliases = createPersistedStore('bookAliases', {});

// Sync status
export const aliasSyncStatus = writable({
  lastSync: null,
  status: 'idle', // 'idle' | 'syncing' | 'error'
  error: null
});

// Get alias for a book (with fallback)
export function getBookAlias(bookId) {
  let alias = null;
  bookAliases.subscribe(aliases => {
    alias = aliases[bookId]?.alias || null;
  })();
  return alias;
}

// Set or update alias
export function setBookAlias(bookId, alias) {
  bookAliases.update(aliases => ({
    ...aliases,
    [bookId]: {
      alias,
      created: aliases[bookId]?.created || Date.now(),
      lastModified: Date.now()
    }
  }));
  
  // Trigger LogSeq sync in background
  syncAliasToLogSeq(bookId, alias);
}

// Delete alias
export function deleteBookAlias(bookId) {
  bookAliases.update(aliases => {
    const { [bookId]: removed, ...rest } = aliases;
    return rest;
  });
  
  // Trigger LogSeq sync in background
  syncAliasToLogSeq(bookId, null);
}
```

### Formatting Utility

```javascript
// src/utils/formatting.js

/**
 * Format book name with alias if available
 * @param {number|string} bookId - Book ID
 * @param {Object} aliases - Map of book aliases
 * @param {string} format - 'full' | 'alias-only' | 'id-only'
 * @returns {string} Formatted book name
 */
export function formatBookName(bookId, aliases, format = 'full') {
  const alias = aliases[bookId]?.alias;
  
  if (!alias) {
    return `Book ${bookId}`;
  }
  
  switch (format) {
    case 'alias-only':
      return alias;
    case 'id-only':
      return `B${bookId}`;
    case 'full':
    default:
      return `${alias} (B${bookId})`;
  }
}

/**
 * Format page identifier with book alias
 * @param {Object} pageInfo - Page info object { book, page }
 * @param {Object} aliases - Map of book aliases
 * @returns {string} Formatted page identifier
 */
export function formatPageIdentifier(pageInfo, aliases) {
  const bookName = formatBookName(pageInfo.book, aliases, 'full');
  return `${bookName} / P${pageInfo.page}`;
}
```

### LogSeq Sync Implementation

```javascript
// src/lib/logseq-alias-sync.js

const ALIAS_PAGE_NAME = 'smartpen config/book aliases';

/**
 * Sync aliases to LogSeq
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @param {Object} aliases - Book aliases map
 */
export async function pushAliasesToLogSeq(host, token, aliases) {
  // Get or create config page
  const page = await getOrCreatePage(host, token, ALIAS_PAGE_NAME);
  
  // Format as LogSeq blocks
  const blocks = Object.entries(aliases).map(([bookId, data]) => ({
    content: `Book:: ${bookId}\nalias:: ${data.alias}\nmodified:: [[${formatDate(data.lastModified)}]]`,
    properties: {
      book: bookId,
      alias: data.alias
    }
  }));
  
  // Clear existing blocks and write new ones
  // ... implementation
}

/**
 * Pull aliases from LogSeq
 * @param {string} host - LogSeq API host
 * @param {string} token - Auth token
 * @returns {Object} Aliases map
 */
export async function pullAliasesFromLogSeq(host, token) {
  const page = await getPage(host, token, ALIAS_PAGE_NAME);
  
  if (!page) return {};
  
  // Parse blocks and extract aliases
  const blocks = await getPageBlocks(host, token, page.name);
  const aliases = {};
  
  blocks.forEach(block => {
    if (block.properties?.book && block.properties?.alias) {
      const bookId = block.properties.book;
      aliases[bookId] = {
        alias: block.properties.alias,
        lastModified: parseLogSeqDate(block.properties.modified)
      };
    }
  });
  
  return aliases;
}
```

---

## Integration Points

### Components to Update

1. **Canvas (StrokeCanvas.svelte)**
   - Hover tooltip: Show book alias
   - Page backgrounds: Show alias in label

2. **Strokes Tab (StrokeList.svelte)**
   - Page headers: Display book alias

3. **Transcription Tab (TranscriptionView.svelte)**
   - Page cards: Show book alias in title

4. **LogSeq DB Explorer (BookAccordion.svelte)**
   - Accordion headers: Use book alias

5. **Page Selector (PageSelector.svelte)**
   - Dropdown options: Show book aliases

6. **Activity Log Messages**
   - Replace "Book 3017" with "Work Notes (B3017)" in all log messages

---

## User Flow Example

### Scenario: Setting up aliases for first time

1. User connects pen and imports strokes from Books 3017 and 387
2. User opens Settings panel and sees "Book Aliases" section
3. System shows:
   ```
   Book 3017  [                 ] [Add]
   Book 387   [                 ] [Add]
   ```
4. User types "Work Notes" for Book 3017 and clicks [Save]
5. User types "Site Visits" for Book 387 and clicks [Save]
6. If LogSeq connected, aliases are automatically synced
7. User returns to canvas and sees "Work Notes (B3017)" in hover tooltip
8. User opens Strokes tab and sees collapsible headers:
   ```
   > Work Notes (B3017)  [42 strokes]
   > Site Visits (B387)  [18 strokes]
   ```

### Scenario: Syncing across devices

1. User sets up aliases on Desktop A
2. Aliases automatically sync to LogSeq
3. User opens app on Desktop B
4. On startup, app pulls aliases from LogSeq
5. Desktop B now shows same aliases
6. If user edits alias on Desktop B, changes sync back to LogSeq

---

## Auto-Suggestion Feature (Optional Enhancement)

Automatically suggest aliases based on transcribed content:

```javascript
/**
 * Suggest alias from transcribed text
 * @param {number} bookId - Book ID
 * @param {Array} transcriptions - Array of transcription results
 * @returns {string|null} Suggested alias
 */
function suggestAlias(bookId, transcriptions) {
  // Look for patterns in first few lines of multiple pages
  // Example: If many pages start with "Daily Standup", suggest "Daily Standup"
  
  const firstLines = transcriptions
    .filter(t => t.pageInfo.book === bookId)
    .map(t => t.lines?.[0]?.text)
    .filter(Boolean);
  
  // Find most common prefix or keyword
  const commonWords = analyzeCommonWords(firstLines);
  
  return commonWords.length > 0 ? commonWords[0] : null;
}
```

**UI:** Show suggestion button next to alias input:
```
Book 3017  [                 ] [✨ Suggest] [Save]
                             ↓ (shows suggestion on click)
Book 3017  [Daily Standup    ] [✨ Suggest] [Save]
```

---

## Testing Checklist

- [ ] Create alias in Settings panel
- [ ] Edit existing alias
- [ ] Delete alias
- [ ] Aliases persist after browser refresh
- [ ] Aliases display correctly in all UI locations
- [ ] Sync to LogSeq when connected
- [ ] Pull aliases from LogSeq on startup
- [ ] Conflict resolution works (newest timestamp wins)
- [ ] Works correctly with no LogSeq connection
- [ ] Manual edits in LogSeq are respected
- [ ] Aliases survive browser storage clear (via LogSeq backup)
- [ ] Activity log shows aliases correctly
- [ ] Canvas hover shows aliases
- [ ] Page selector shows aliases

---

## Future Enhancements

1. **Export/Import Aliases**
   - Export as JSON file
   - Import from JSON file
   - Useful for backup or sharing configurations

2. **Alias Search**
   - Search/filter books by alias
   - Quick jump to book in database explorer

3. **Color Coding**
   - Assign colors to books along with aliases
   - Use colors in canvas backgrounds

4. **Book Tags**
   - Add tags to books (e.g., "work", "personal", "client-xyz")
   - Filter by tags in UI

5. **Smart Suggestions**
   - AI-powered alias suggestions based on content analysis
   - Learn from user patterns

---

## Migration Path

### Phase 1: Local Storage Only (Quick Win)
- Implement localStorage-based aliases
- Update all UI components
- Test thoroughly
- **Estimated: 3-4 hours**

### Phase 2: LogSeq Integration (Full Solution)
- Implement LogSeq sync
- Add conflict resolution
- Test sync scenarios
- **Estimated: 3-4 hours**

### Total: 6-8 hours

---

## Open Questions

1. **Should we allow duplicate aliases?**
   - Recommendation: No, enforce unique aliases

2. **Character limits for aliases?**
   - Recommendation: 50 characters max

3. **Default format preference?**
   - Recommendation: Make it user-configurable in settings
   - Default: "full" format `Alias (B####)`

4. **What if LogSeq edit conflicts with local edit?**
   - Recommendation: Newest timestamp wins, show conflict notification

5. **Should we auto-suggest aliases?**
   - Recommendation: Yes, but as optional enhancement in Phase 3

---

## Conclusion

Book aliases provide significant UX improvement for multi-notebook workflows with relatively modest implementation effort. The dual storage approach ensures both performance and persistence, while LogSeq integration enables cross-device sync and backup.

**Recommendation:** Proceed with Phase 1 (local storage) immediately for quick value, then implement Phase 2 (LogSeq sync) in next iteration.
