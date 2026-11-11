/**
 * Did focus leave an open inline editor, or is it still the author's?
 *
 * The editors in EventEditor commit and close on `focusout`, which is only
 * safe if "focus moved somewhere else in the page" can be told apart from
 * "focus moved around inside me". Containment answers that for most moves,
 * but not for the one that closed the media panel out from under the upload
 * dropzone: pressing a part of the editor that can't take focus — the
 * dropzone's label, a static hint — blurs whatever was focused, and the
 * browser hands focus to the nearest focusable *ancestor*, the editor's own
 * scroll container. That ancestor is outside the panel by containment and
 * inside it by every other measure.
 *
 * The pointer settles it. The caller tracks whether the last pointerdown
 * landed inside the editor (cleared by a capture-phase listener at the
 * document, set again by the editor's own bubbling handler), which says
 * whether this fallback came from pressing the editor or from pressing the
 * container around it.
 */
export function focusLeftContainer(
  container: HTMLElement,
  next: Node | null,
  pointerDownInside: boolean,
): boolean {
  // Focus landed somewhere concrete — Tab, or a click on another control.
  if (next) {
    if (container.contains(next)) return false;
    if (next.contains(container)) return !pointerDownInside;
    return true;
  }
  // Focus went nowhere. Trust the last pointerdown instead.
  return !pointerDownInside;
}
