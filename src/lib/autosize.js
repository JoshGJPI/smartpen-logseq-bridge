/**
 * autosize — a one-row <textarea> that grows to show all of its text, so a
 * long transcript line wraps instead of scrolling out of sight. The line is
 * still one line: `oneLine()` turns pasted line breaks into spaces (Enter is
 * the editor's own key, never a newline in the text).
 */

/** Text with line breaks collapsed to single spaces. */
export function oneLine(text) {
  return typeof text === 'string' ? text.replace(/\s*[\r\n]+\s*/g, ' ') : '';
}

/**
 * Svelte action: `<textarea rows="1" use:autosize={value}>`. Pass the value so
 * a change made from code (a merge, an undo) resizes too. Width changes
 * re-wrap the text, so the height follows the element's size as well.
 * @param {HTMLTextAreaElement} el
 */
export function autosize(el) {
  const fit = () => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  let lastWidth = 0;
  const ro = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => {
        if (el.clientWidth !== lastWidth) { lastWidth = el.clientWidth; fit(); }
      })
    : null;
  el.addEventListener('input', fit);
  ro?.observe(el);
  fit();
  return {
    update: () => fit(),
    destroy() {
      el.removeEventListener('input', fit);
      ro?.disconnect();
    },
  };
}
