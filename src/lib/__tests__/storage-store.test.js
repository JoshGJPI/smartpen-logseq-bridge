/**
 * stores/storage.js: a page's successful save must not clear the canvas's
 * unsaved-changes flag (other pages may still be unsaved; canvas-save.js
 * clears it once the whole save is done).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
  unsavedChanges, markUnsavedChanges, clearUnsavedChanges, recordSuccessfulSave, storageStatus
} from '../../stores/storage.js';

describe('recordSuccessfulSave', () => {
  beforeEach(() => clearUnsavedChanges());

  it('leaves the unsaved-changes flag lit', () => {
    markUnsavedChanges();
    recordSuccessfulSave('B388/P1', { added: 3, total: 10 });
    expect(get(unsavedChanges)).toBe(true);
  });

  it('records the page as saved', () => {
    recordSuccessfulSave('B388/P2', { added: 1, total: 1 });
    expect(get(storageStatus).savedPages.has('B388/P2')).toBe(true);
    expect(get(storageStatus).isSaving).toBe(false);
  });
});
