/**
 * How an undo or redo keystroke, wherever it lands, reaches the one stack.
 *
 * The keystroke can arrive in a rich-text field (Tiptap's keymap catches it), a
 * plain input or nowhere in particular (a window listener catches it). What has
 * to answer is EditorView, which owns the panels and the selection a reveal
 * needs, and it is several components away from all of those. A single
 * registration point, rather than callbacks threaded through a 2,000-line
 * EventEditor.
 */
export type HistoryDirection = 'undo' | 'redo';

type Handler = (direction: HistoryDirection) => boolean;

let handler: Handler | null = null;

/** Register whatever performs undo and redo. Returns a function that unregisters it. */
export function setHistoryHandler(next: Handler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Ask for an undo or redo. Returns whether anything took the request, so a
 * keymap can let the key fall through when no timeline editor is mounted.
 */
export function requestHistory(direction: HistoryDirection): boolean {
  return handler ? handler(direction) : false;
}
