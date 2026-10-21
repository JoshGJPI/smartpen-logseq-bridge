/**
 * Tag Suggestions Store — unreviewed project-number suggestions across the
 * Library (v3.1.0 page tags): the page grid's amber dots, the home's
 * Suggestions (n) entry and the review queue.
 *
 * The pass (lib/tag-suggestions.js) reads the scan records' stored transcript
 * text, never a page, and caches per page. It runs when a Library list view
 * asks (`ensureSuggestionScan`: the home, a page grid, the queue), only when
 * the scan has changed since the last pass, and never while a scan or an
 * offline import is running. `pendingSuggestions` is re-derived from its
 * result whenever tags or dismissals change, so a ✓ or ✕ anywhere removes the
 * suggestion everywhere at once.
 */
import { writable, derived, get } from 'svelte/store';
import { createSuggestionScanner, pendingFrom, countPending } from '../lib/tag-suggestions.js';
import { savedPages, isScanning } from './saved-pages.js';
import { batchMode } from './strokes.js';
import { pageTags, dismissedTags } from './tags.js';
import { debug } from '../lib/debug.js';

const scanner = createSuggestionScanner();

/** pageKey → every project number in its transcript (the pass's output). */
export const suggestionsFound = writable(new Map());

/** `{ running, done, total }` for the queue's progress line. */
export const suggestionScan = writable({ running: false, done: 0, total: 0 });

/** pageKey → numbers still to review (found − tags − dismissals). */
export const pendingSuggestions = derived(
  [suggestionsFound, pageTags, dismissedTags],
  ([$found, $tags, $dismissed]) => pendingFrom($found, $tags, $dismissed)
);

/** How many page × number suggestions wait for review. */
export const suggestionCount = derived(pendingSuggestions, ($p) => countPending($p));

// The savedPages array the last finished pass covered: a new scan, or a
// transcript saved in the reader, replaces the array.
let coveredRecords = null;
let running = null;

/**
 * Run the pass if the scan changed since the last one. Safe to call often.
 * @param {{force?: boolean}} [opts]  force: forget the cache and re-check every page
 */
export function ensureSuggestionScan({ force = false } = {}) {
  if (force) {
    scanner.clear();
    coveredRecords = null;
    running = null;
  }
  const records = get(savedPages);
  if (records === coveredRecords || get(isScanning) || get(batchMode)) return running || Promise.resolve();
  if (running) return running;
  suggestionScan.set({ running: true, done: 0, total: 0 });
  const run = scanner
    .run(records, { onProgress: (done, total) => suggestionScan.set({ running: true, done, total }) })
    .then((found) => {
      if (running !== run) return;
      running = null;
      suggestionScan.update((s) => ({ ...s, running: false }));
      if (!found) return;
      coveredRecords = records;
      suggestionsFound.set(found);
      debug('[tags] suggestion pass:', found.size, 'pages with project numbers');
      // The scan changed while this pass ran: go again.
      if (get(savedPages) !== records) ensureSuggestionScan();
    });
  running = run;
  return run;
}

/** Stop a pass in progress. */
export function cancelSuggestionScan() {
  scanner.cancel();
  running = null;
  suggestionScan.update((s) => ({ ...s, running: false }));
}

/** Forget everything (data-folder change). */
export function clearSuggestions() {
  scanner.clear();
  coveredRecords = null;
  running = null;
  suggestionsFound.set(new Map());
  suggestionScan.set({ running: false, done: 0, total: 0 });
}
