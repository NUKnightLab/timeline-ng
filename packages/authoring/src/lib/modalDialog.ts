/**
 * Modal-dialog behaviour for an element that already carries `role="dialog"`
 * and `aria-modal="true"`: it takes focus when it opens, holds Tab and
 * Shift-Tab inside itself, closes on Escape and on a click on the backdrop,
 * and gives focus back to whatever opened it.
 *
 * An action rather than a `<Modal>` component because the app's two dialogs
 * share all of this behaviour and none of their markup. The info modal in
 * `EventEditor.svelte` is a title, prose and a close button; the preview
 * lightbox in `EditorView.svelte` is a toolbar wrapped around a cross-origin
 * iframe, its backdrop's width is bound to decide which size presets are
 * offered, and its responsive rules reach into that backdrop. A component
 * covering both would exist to share a `<div>`. (If a third dialog shaped like
 * the info modal ever turns up, a `<Modal>` starts paying for itself — and it
 * would use this action internally.)
 *
 * Focus is the part worth being careful about. Both dialogs sit inside an
 * `{#if}`, so this mounts exactly when the dialog opens — early enough that
 * `document.activeElement` is still the control that opened it, which is what
 * focus goes back to on close. Doing it here rather than per dialog is also the
 * point: `EventEditor`'s modal previously had `tabindex="-1"` and its own
 * Escape handler, both inert, because nothing ever moved focus into it — the
 * handler was listening from an element that never had focus.
 */

/**
 * Elements that can hold focus, before `isTabbable` filters them.
 *
 * `querySelectorAll` returns document order, which is tab order as long as
 * nothing uses a positive `tabindex` — nothing in this app does, and a
 * roving-tabindex nav would need its own handling anyway.
 */
const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[tabindex]',
  '[contenteditable]',
].join(',');

/**
 * Whether this element would actually take a Tab press.
 *
 * Present in the DOM is not the same as reachable: both dialogs render
 * conditional content (the preview lightbox flies a settings panel in and out
 * and filters its width presets against the window), so a disabled, hidden or
 * explicitly un-tabbable element is a normal thing to find here, not an edge
 * case.
 */
export function isTabbable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled')) return false;

  // A negative tabindex is the author saying "focusable, but not by Tab" —
  // which is exactly what the dialog container itself carries.
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) < 0) return false;

  // Hidden from assistive technology, so it should not be a tab stop either.
  // `closest` because the hiding is often on a wrapper, as on the preview
  // lightbox's resize handle.
  if (el.closest('[aria-hidden="true"]')) return false;
  if (el.closest('[hidden]')) return false;
  if (el.closest('[inert]')) return false;

  return isVisible(el);
}

/**
 * Rendered and not collapsed to nothing.
 *
 * `checkVisibility` answers display, visibility and content-visibility in one
 * call, but is recent enough to be worth a fallback — and happy-dom, which the
 * tests run in, does not implement layout, so neither path can be relied on
 * there. The fallback deliberately treats "cannot tell" as visible: wrongly
 * keeping an invisible element costs one dead tab stop, while wrongly dropping
 * a real one takes a control away from a keyboard user.
 */
function isVisible(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();

  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;

  return true;
}

/** Every element inside `root` that Tab would land on, in tab order. */
export function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter(isTabbable);
}

export interface ModalDialogOptions {
  /** Dismiss the dialog. Called for a click on the backdrop, and for Escape. */
  onclose: () => void;
  /**
   * Escape only, for a dialog with a layer of its own to close first — the
   * preview lightbox uses it to put away its settings panel and keep the
   * preview up. Defaults to `onclose`.
   *
   * Deliberately not shared with the backdrop click: Escape works inwards,
   * closing the innermost thing first, while a click on the dark area outside
   * the whole box means that box, however many layers are open inside it.
   */
  onescape?: () => void;
}

export function modalDialog(node: HTMLElement, options: ModalDialogOptions) {
  let opts = options;

  // Read before focus moves anywhere, so this is still the opening control.
  const opener = document.activeElement as HTMLElement | null;

  // Needed to hold focus at all. Set here so a caller cannot half-adopt this
  // behaviour, which is the state the info modal was already in.
  if (!node.hasAttribute('tabindex')) node.setAttribute('tabindex', '-1');
  node.focus();

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      (opts.onescape ?? opts.onclose)();
      return;
    }
    if (e.key !== 'Tab') return;

    // Recomputed per press rather than captured on mount: a set taken when the
    // dialog opened goes stale as soon as the settings panel slides in or a
    // button disables itself.
    const items = tabbablesIn(node);

    // Nothing to land on — keep focus on the dialog rather than letting Tab
    // walk out into the page the dialog claims to be covering.
    if (items.length === 0) {
      e.preventDefault();
      node.focus();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    // Focus is still on the container, i.e. the dialog has just opened.
    if (active === node) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }

    if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    }
  }

  /**
   * Catch focus that left the dialog without the keydown handler seeing it.
   *
   * The preview lightbox holds a cross-origin iframe. Once focus is inside it,
   * the parent document sees `activeElement` as the iframe and nothing more —
   * key presses within it are not observable here, so Tabbing off the end of
   * the player's own controls hands focus back to the parent at whatever
   * follows the iframe, skipping the trap entirely. That handover does fire
   * `focusin` here, which is what makes this recoverable.
   *
   * The same listener covers programmatic focus moves from elsewhere in the
   * app, which the keydown handler equally cannot see.
   */
  function onFocusIn(e: FocusEvent) {
    const target = e.target as Node | null;
    if (target && !node.contains(target)) node.focus();
  }

  function onClick(e: MouseEvent) {
    // The backdrop itself, not anything within the dialog box.
    if (e.target === node) opts.onclose();
  }

  node.addEventListener('keydown', onKeydown);
  node.addEventListener('click', onClick);
  document.addEventListener('focusin', onFocusIn);

  return {
    update(next: ModalDialogOptions) {
      opts = next;
    },
    destroy() {
      // Before restoring focus, or the guard above would read that restore as
      // an escape and pull focus back into a dialog that is closing.
      document.removeEventListener('focusin', onFocusIn);
      node.removeEventListener('keydown', onKeydown);
      node.removeEventListener('click', onClick);

      // Gone from the DOM if the view changed underneath the dialog; focus then
      // falls back to the body rather than throwing.
      if (opener?.isConnected) opener.focus();
    },
  };
}
