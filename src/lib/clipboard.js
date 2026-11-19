/**
 * clipboard — copying transcript markdown with the Activity Log line every
 * copy writes (Review, the Library reader, Library Edit). Pure apart from the
 * clipboard itself: the caller passes its `log` (stores/ui.js), so this stays
 * free of stores.
 */

/**
 * Write `md` to the clipboard and log the outcome.
 * @param {string} md  markdown to copy ('' = nothing to copy)
 * @param {string} what  for the log line, e.g. "transcript B388/P12"
 * @param {(message: string, level?: string) => void} log
 * @returns {Promise<boolean>} whether it was copied
 */
export async function copyMarkdown(md, what, log) {
  if (!md) {
    log('Nothing to copy — transcript is empty', 'warning');
    return false;
  }
  try {
    await navigator.clipboard.writeText(md);
    log(`Copied ${what} to clipboard (LogSeq format)`, 'success');
    return true;
  } catch {
    log('Failed to copy to clipboard', 'error');
    return false;
  }
}
