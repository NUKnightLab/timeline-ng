/**
 * @vitest-environment happy-dom
 *
 * happy-dom has no layout, so `checkVisibility` and computed geometry cannot be
 * exercised here — isVisible deliberately treats "cannot tell" as visible, and
 * the display/visibility cases are left to the browser. What is worth pinning
 * down is the rest: which elements count as tab stops, and that the wrap
 * happens at both ends.
 */
import { describe, it, expect, vi } from 'vitest';
import { isTabbable, tabbablesIn, modalDialog } from './modalDialog.ts';

function dialog(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.replaceChildren(host);
  return host;
}

const ids = (els: HTMLElement[]) => els.map((el) => el.id);

describe('what counts as a tab stop', () => {
  it('takes the usual controls, in document order', () => {
    const root = dialog(`
      <button id="b">b</button>
      <a id="a" href="#x">a</a>
      <input id="i" />
      <select id="s"></select>
      <textarea id="t"></textarea>
      <iframe id="f" title="f"></iframe>
    `);
    expect(ids(tabbablesIn(root))).toEqual(['b', 'a', 'i', 's', 't', 'f']);
  });

  it('skips an anchor with no href, which cannot be tabbed to', () => {
    const root = dialog('<a id="no-href">a</a><a id="href" href="#x">a</a>');
    expect(ids(tabbablesIn(root))).toEqual(['href']);
  });

  it('skips disabled controls', () => {
    const root = dialog('<button id="on">on</button><button id="off" disabled>off</button>');
    expect(ids(tabbablesIn(root))).toEqual(['on']);
  });

  it('skips a negative tabindex, and keeps tabindex="0" on an ordinary element', () => {
    const root = dialog('<div id="programmatic" tabindex="-1"></div><div id="stop" tabindex="0"></div>');
    expect(ids(tabbablesIn(root))).toEqual(['stop']);
  });

  it('skips what is hidden from assistive technology, including via a wrapper', () => {
    const root = dialog(`
      <button id="visible">v</button>
      <button id="hidden-self" aria-hidden="true">h</button>
      <div aria-hidden="true"><button id="hidden-parent">h</button></div>
      <div hidden><button id="hidden-attr">h</button></div>
      <div inert><button id="inert-parent">h</button></div>
    `);
    expect(ids(tabbablesIn(root))).toEqual(['visible']);
  });

  it('takes contenteditable prose, which the rich-text fields rely on', () => {
    const root = dialog('<div id="rte" contenteditable="true"></div>');
    expect(ids(tabbablesIn(root))).toEqual(['rte']);
  });

  it('does not count the dialog container itself', () => {
    // The container carries tabindex="-1" so it can hold focus on open without
    // becoming a stop — the trap would otherwise cycle through the backdrop.
    const root = dialog('<button id="b">b</button>');
    root.setAttribute('tabindex', '-1');
    expect(isTabbable(root)).toBe(false);
    expect(ids(tabbablesIn(root))).toEqual(['b']);
  });
});

describe('the ends of the cycle', () => {
  it('reports first and last so Tab and Shift-Tab can wrap onto each other', () => {
    const root = dialog(`
      <button id="close">x</button>
      <button id="mid" disabled>mid</button>
      <a id="link" href="#x">link</a>
    `);
    const items = tabbablesIn(root);

    // The disabled middle button is why this is recomputed per keypress rather
    // than captured when the dialog opened: enabling it changes both ends'
    // neighbours without the dialog being reopened.
    expect(ids(items)).toEqual(['close', 'link']);
    expect(items[0].id).toBe('close');
    expect(items[items.length - 1].id).toBe('link');
  });

  it('finds nothing to land on when every control is unreachable', () => {
    const root = dialog('<button id="off" disabled>off</button><div tabindex="-1"></div>');
    expect(tabbablesIn(root)).toEqual([]);
  });
});

/**
 * The action moves focus itself at the wrap points, which is what makes it
 * assertable without a real browser: happy-dom never performs a native Tab, so
 * these press Tab at each end and check where focus was put. Moves in the
 * middle of the cycle are the browser's own and are not simulated here.
 */
describe('holding focus inside the dialog', () => {
  const tab = (node: HTMLElement, shiftKey = false) =>
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true }));

  /** A dialog with an opening control outside it, as both real callers have. */
  function openedDialog(html: string, onescape?: () => void) {
    const opener = document.createElement('button');
    opener.id = 'opener';
    const root = document.createElement('div');
    root.innerHTML = html;
    document.body.replaceChildren(opener, root);
    opener.focus();

    const onclose = vi.fn();
    const trap = modalDialog(root, onescape ? { onclose, onescape } : { onclose });
    return { root, opener, onclose, trap };
  }

  it('takes focus on open, and gives it back on close', () => {
    const { root, opener, trap } = openedDialog('<button id="a">a</button>');
    expect(document.activeElement).toBe(root);

    trap.destroy();
    expect(document.activeElement).toBe(opener);
  });

  it('sets tabindex itself, so a caller cannot half-adopt the behaviour', () => {
    const { root } = openedDialog('<button id="a">a</button>');
    expect(root.getAttribute('tabindex')).toBe('-1');
  });

  it('sends the first Tab to the first control and Shift-Tab to the last', () => {
    const { root } = openedDialog('<button id="a">a</button><button id="b">b</button>');

    tab(root);
    expect(document.activeElement?.id).toBe('a');

    root.focus();
    tab(root, true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('wraps both ends onto each other', () => {
    const { root } = openedDialog('<button id="a">a</button><button id="b">b</button>');
    const [first, last] = tabbablesIn(root);

    last.focus();
    tab(root);
    expect(document.activeElement?.id).toBe('a');

    first.focus();
    tab(root, true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('keeps focus on itself when it holds nothing tabbable', () => {
    const { root } = openedDialog('<button id="off" disabled>off</button>');
    tab(root);
    expect(document.activeElement).toBe(root);
  });

  it('pulls focus back when something outside takes it', () => {
    // Stands in for Tab leaving the preview's cross-origin iframe, which the
    // keydown handler cannot see — the parent only learns of it via focusin.
    const { root } = openedDialog('<button id="a">a</button>');
    const outside = document.createElement('button');
    document.body.append(outside);

    outside.focus();
    expect(document.activeElement).toBe(root);
  });

  it('stops guarding focus once closed, so the page is usable again', () => {
    const { root, trap } = openedDialog('<button id="a">a</button>');
    const outside = document.createElement('button');
    document.body.append(outside);

    trap.destroy();
    outside.focus();
    expect(document.activeElement).toBe(outside);
    expect(root.contains(document.activeElement)).toBe(false);
  });

  it('closes on Escape, wherever focus sits inside it', () => {
    const { root, onclose } = openedDialog('<button id="a">a</button>');
    tabbablesIn(root)[0].focus();

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onclose).toHaveBeenCalledOnce();
  });

  it('closes on a click on the backdrop but not on one inside the dialog', () => {
    const { root, onclose } = openedDialog('<div class="box"><button id="a">a</button></div>');

    root.querySelector<HTMLElement>('#a')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onclose).not.toHaveBeenCalled();

    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onclose).toHaveBeenCalledOnce();
  });
});

/**
 * Escape works inwards and a backdrop click does not, which is why they are
 * separate options. The preview lightbox is the caller that needs it: Escape
 * puts its settings panel away and leaves the preview up, while a click on the
 * dark area outside the whole box means that box.
 */
describe('a dialog with an inner layer of its own', () => {
  function layeredDialog() {
    const root = document.createElement('div');
    root.innerHTML = '<button id="a">a</button>';
    document.body.replaceChildren(root);

    const onclose = vi.fn();
    const onescape = vi.fn();
    modalDialog(root, { onclose, onescape });
    return { root, onclose, onescape };
  }

  it('sends Escape to the inner layer, not to the dialog', () => {
    const { root, onclose, onescape } = layeredDialog();

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onescape).toHaveBeenCalledOnce();
    expect(onclose).not.toHaveBeenCalled();
  });

  it('still dismisses the whole dialog on a backdrop click', () => {
    const { root, onclose, onescape } = layeredDialog();

    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onclose).toHaveBeenCalledOnce();
    expect(onescape).not.toHaveBeenCalled();
  });

  it('falls back to onclose for Escape when no inner layer is declared', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button id="a">a</button>';
    document.body.replaceChildren(root);

    const onclose = vi.fn();
    modalDialog(root, { onclose });

    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onclose).toHaveBeenCalledOnce();
  });
});
