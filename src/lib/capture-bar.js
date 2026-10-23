/**
 * When the header's capture buttons (Save, Undo, Delete, Clear, Transcribe)
 * is on screen.
 *
 * Those controls are dead weight while reading, so they stay out of the way
 * unless there is capture work to do. Each condition is a reason the bar has to
 * be reachable:
 *   - Editor is showing: that is where capture and editing happen.
 *   - A pen is connected: ink can arrive at any moment, to be saved and transcribed.
 *   - Anything is unsaved (strokes or transcript edits): Save must be one click
 *     away from every view, not hidden behind a mode switch.
 *   - A transcription or offline transfer is running: its progress popup hangs
 *     off the bar, so hiding the bar would hide a job still in flight.
 *
 * Only the *rendering* is conditional. ActionBar stays mounted either way, since
 * it owns the save dialog and the in-flight handlers.
 *
 * @param {object} state
 * @param {'editor'|'book'} state.viewerMode
 * @param {boolean} [state.penConnected]
 * @param {boolean} [state.unsavedChanges]
 * @param {boolean} [state.viewerDirty]
 * @param {boolean} [state.busy] - transcribing or importing from the pen
 * @returns {boolean}
 */
export function shouldShowCaptureBar({
  viewerMode,
  penConnected = false,
  unsavedChanges = false,
  viewerDirty = false,
  busy = false
}) {
  return viewerMode === 'editor'
    || !!penConnected
    || !!unsavedChanges
    || !!viewerDirty
    || !!busy;
}
