/**
 * Tag Suggestions Store — unreviewed project-number suggestions across the
 * Library (v3.1.0 page tags). Filled by the background pass in step 6.
 *
 * `pendingSuggestions`: Map<pageKey, tags[]>.
 */
import { writable } from 'svelte/store';

export const pendingSuggestions = writable(new Map());
