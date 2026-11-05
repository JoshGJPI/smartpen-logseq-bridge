/**
 * Where the capture buttons are drawn (v3.14.0).
 *
 * ActionBar stays mounted in the header (it owns the save dialog and the
 * in-flight save / transcribe handlers), but in the Editor its buttons belong
 * in the Editor pane's title row, so the global header keeps the same width in
 * every view (14 buttons used to push Settings off a 1586 px window).
 *
 * StrokeCanvas marks its slot with `use:editorActionsHost`; ActionBar moves its
 * own row there with `use:placeIn`, and back to the header when the slot goes
 * (the Editor unmounts on every route away). Moving a node keeps its handlers.
 */
import { writable } from 'svelte/store';

/** The Editor pane's slot element, or null when the Editor isn't mounted. */
export const editorActionsSlot = writable(null);

/** Svelte action for the slot element in the Editor pane. */
export function editorActionsHost(node) {
  editorActionsSlot.set(node);
  return {
    destroy() {
      editorActionsSlot.update((cur) => (cur === node ? null : cur));
    }
  };
}

/**
 * Svelte action: draw `node` inside `target` when given one, else where it was
 * mounted. A comment placeholder marks the home spot.
 * @param {HTMLElement} node
 * @param {HTMLElement|null} target
 */
export function placeIn(node, target) {
  const home = document.createComment('capture-bar');
  node.parentNode?.insertBefore(home, node);
  function place(t) {
    if (t && t.isConnected !== false) {
      if (node.parentNode !== t) t.appendChild(node);
    } else if (home.parentNode && node.previousSibling !== home) {
      home.parentNode.insertBefore(node, home.nextSibling);
    }
  }
  place(target);
  return {
    update: place,
    destroy() {
      home.remove();
    }
  };
}
