/**
 * Tests for the collapsible left panel (reading-first package B):
 *   lib/left-panel.js    stored-value parsing, typing-target check, `[` key rule
 *   stores/left-panel.js collapse state and its (fallible) localStorage
 *   stores/ui.js         revealLeftPanel / openTranscriptSearch / openTranscriptReview
 *
 * What matters: a missing, corrupt or blocked store reads as expanded (the panel
 * can never be stranded hidden); the shortcut never fires while typing or with a
 * modifier; and every "show me the panel" caller expands it before asking for
 * focus.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  LEFT_PANEL_KEY,
  parseCollapsed,
  serializeCollapsed,
  isTypingTarget,
  isPanelToggleKey
} from '$lib/left-panel.js';

const el = (tag, attrs = {}) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const key = (over = {}) => ({ key: '[', target: el('div'), ...over });

describe('parseCollapsed / serializeCollapsed', () => {
  it('only an explicit "1" is collapsed', () => {
    expect(parseCollapsed('1')).toBe(true);
    expect(parseCollapsed('0')).toBe(false);
    expect(parseCollapsed(null)).toBe(false);
    expect(parseCollapsed(undefined)).toBe(false);
    expect(parseCollapsed('')).toBe(false);
    expect(parseCollapsed('true')).toBe(false);
    expect(parseCollapsed('{"corrupt":')).toBe(false);
  });

  it('round-trips', () => {
    expect(parseCollapsed(serializeCollapsed(true))).toBe(true);
    expect(parseCollapsed(serializeCollapsed(false))).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it('is true for input, textarea and select', () => {
    expect(isTypingTarget(el('input'))).toBe(true);
    expect(isTypingTarget(el('textarea'))).toBe(true);
    expect(isTypingTarget(el('select'))).toBe(true);
    expect(isTypingTarget(el('input', { type: 'date' }))).toBe(true);
  });

  it('is true for contenteditable, and false for contenteditable="false"', () => {
    expect(isTypingTarget(el('div', { contenteditable: '' }))).toBe(true);
    expect(isTypingTarget(el('div', { contenteditable: 'true' }))).toBe(true);
    expect(isTypingTarget(el('div', { contenteditable: 'plaintext-only' }))).toBe(true);
    expect(isTypingTarget(el('div', { contenteditable: 'false' }))).toBe(false);
  });

  it('is false for everything else and for non-elements', () => {
    expect(isTypingTarget(el('button'))).toBe(false);
    expect(isTypingTarget(el('div'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});

describe('isPanelToggleKey', () => {
  it('accepts a bare [ outside a field', () => {
    expect(isPanelToggleKey(key())).toBe(true);
    expect(isPanelToggleKey(key({ target: el('button') }))).toBe(true);
  });

  it('rejects other keys', () => {
    expect(isPanelToggleKey(key({ key: ']' }))).toBe(false);
    expect(isPanelToggleKey(key({ key: '{' }))).toBe(false);
    expect(isPanelToggleKey(key({ key: 'a' }))).toBe(false);
    expect(isPanelToggleKey(null)).toBe(false);
  });

  it('rejects Ctrl / Alt / Meta chords (Ctrl+[ is outdent in the transcript editor)', () => {
    expect(isPanelToggleKey(key({ ctrlKey: true }))).toBe(false);
    expect(isPanelToggleKey(key({ altKey: true }))).toBe(false);
    expect(isPanelToggleKey(key({ metaKey: true }))).toBe(false);
  });

  it('rejects typing targets, IME composition and already-handled keys', () => {
    expect(isPanelToggleKey(key({ target: el('input', { type: 'date' }) }))).toBe(false);
    expect(isPanelToggleKey(key({ target: el('textarea') }))).toBe(false);
    expect(isPanelToggleKey(key({ target: el('div', { contenteditable: 'true' }) }))).toBe(false);
    expect(isPanelToggleKey(key({ isComposing: true }))).toBe(false);
    expect(isPanelToggleKey(key({ defaultPrevented: true }))).toBe(false);
  });
});

// The store reads localStorage once at import, so each case re-imports it.
async function freshStore() {
  vi.resetModules();
  return import('$stores/left-panel.js');
}

describe('left-panel store', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('starts expanded with nothing stored', async () => {
    const { leftPanelCollapsed } = await freshStore();
    expect(get(leftPanelCollapsed)).toBe(false);
  });

  it('starts collapsed from a stored "1"', async () => {
    localStorage.setItem(LEFT_PANEL_KEY, '1');
    const { leftPanelCollapsed } = await freshStore();
    expect(get(leftPanelCollapsed)).toBe(true);
  });

  it('treats corrupt storage as expanded', async () => {
    localStorage.setItem(LEFT_PANEL_KEY, '{not json');
    const { leftPanelCollapsed } = await freshStore();
    expect(get(leftPanelCollapsed)).toBe(false);
  });

  it('survives a localStorage that throws on read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const { leftPanelCollapsed } = await freshStore();
    expect(get(leftPanelCollapsed)).toBe(false);
  });

  it('still changes state when localStorage throws on write', async () => {
    const { leftPanelCollapsed, toggleLeftPanel } = await freshStore();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => toggleLeftPanel()).not.toThrow();
    expect(get(leftPanelCollapsed)).toBe(true);
  });

  it('toggle / collapse / expand persist, and a reload reads them back', async () => {
    let s = await freshStore();
    s.toggleLeftPanel();
    expect(get(s.leftPanelCollapsed)).toBe(true);
    expect(localStorage.getItem(LEFT_PANEL_KEY)).toBe('1');

    s = await freshStore();                      // "reload"
    expect(get(s.leftPanelCollapsed)).toBe(true);

    s.expandLeftPanel();
    expect(localStorage.getItem(LEFT_PANEL_KEY)).toBe('0');
    s.collapseLeftPanel();
    expect(localStorage.getItem(LEFT_PANEL_KEY)).toBe('1');
    s.setLeftPanelCollapsed(false);
    expect(get(s.leftPanelCollapsed)).toBe(false);
  });
});

describe('reveal and the callers that use it', () => {
  let ui, panel;
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem(LEFT_PANEL_KEY, '1');
    vi.resetModules();
    panel = await import('$stores/left-panel.js');
    ui = await import('$stores/ui.js');
  });

  it('revealLeftPanel expands, and selects the tab only when one is given', () => {
    ui.activeTab.set('dates');
    ui.revealLeftPanel();
    expect(get(panel.leftPanelCollapsed)).toBe(false);
    expect(get(ui.activeTab)).toBe('dates');

    panel.collapseLeftPanel();
    ui.revealLeftPanel('books');
    expect(get(panel.leftPanelCollapsed)).toBe(false);
    expect(get(ui.activeTab)).toBe('books');
  });

  it('setActiveTab is passive: a collapsed panel stays collapsed', () => {
    ui.setActiveTab('transcription');
    expect(get(ui.activeTab)).toBe('transcription');
    expect(get(panel.leftPanelCollapsed)).toBe(true);
  });

  it('openTranscriptSearch expands BEFORE it bumps the focus token', async () => {
    const seen = [];
    const unsub = ui.transcriptSearchFocus.subscribe(() => seen.push(get(panel.leftPanelCollapsed)));
    seen.length = 0;                             // drop the initial subscription call
    const before = get(ui.transcriptSearchFocus);

    const pending = ui.openTranscriptSearch();
    // Synchronous part: panel open, tab and mode set, token not yet bumped.
    expect(get(panel.leftPanelCollapsed)).toBe(false);
    expect(get(ui.activeTab)).toBe('transcription');
    expect(get(ui.transcriptsMode)).toBe('search');
    expect(get(ui.transcriptSearchFocus)).toBe(before);

    await pending;
    expect(get(ui.transcriptSearchFocus)).toBe(before + 1);
    expect(seen).toEqual([false]);               // bumped once, panel already open
    unsub();
  });

  it('openTranscriptReview expands and shows Review', () => {
    ui.transcriptsMode.set('search');
    ui.openTranscriptReview();
    expect(get(panel.leftPanelCollapsed)).toBe(false);
    expect(get(ui.activeTab)).toBe('transcription');
    expect(get(ui.transcriptsMode)).toBe('review');
  });
});
