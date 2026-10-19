import { describe, it, expect } from 'vitest';
import { shouldShowCaptureBar } from '../capture-bar.js';

describe('shouldShowCaptureBar', () => {
  it('is hidden while reading with nothing to do', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'book' })).toBe(false);
  });

  it('shows in the Editor', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'editor' })).toBe(true);
  });

  it('shows in Book View when a pen is connected', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'book', penConnected: true })).toBe(true);
  });

  it('shows in Book View when strokes are unsaved', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'book', unsavedChanges: true })).toBe(true);
  });

  it('shows in Book View when transcript edits are unsaved', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'book', viewerDirty: true })).toBe(true);
  });

  it('stays up while a transcription or transfer is running', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'book', busy: true })).toBe(true);
  });

  it('treats missing fields as false rather than throwing', () => {
    expect(shouldShowCaptureBar({ viewerMode: 'book', penConnected: undefined })).toBe(false);
  });
});
