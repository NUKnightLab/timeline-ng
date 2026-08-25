import { contrast, composite, hex, alphaOf } from './contrast';

export interface Row {
  label: string;
  fg: string;
  bg: string;
  fgHex: string;
  bgHex: string;
  ratio: number;
  /** 4.5 body text, 3 for meaningful non-text, 0 for decorative (no threshold). */
  required: number;
}

/**
 * Walk up from `el` until an opaque background-color is found. A mark's real
 * contrast is against whatever is actually painted behind it, which is often
 * several levels up from the element carrying the colour.
 */
function effectiveBg(el: Element | null): string {
  let node: Element | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && alphaOf(bg) === 1 && bg !== 'transparent') return bg;
    node = node.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

interface Spec {
  label: string;
  selector: string;
  /** Read from a pseudo-element rather than the element itself. */
  pseudo?: '::before' | '::after';
  /** Which property carries the mark's colour. */
  prop?: 'color' | 'backgroundColor' | 'borderTopColor' | 'stroke';
  /** Element whose background the mark sits on; defaults to the mark's own ancestry. */
  bgFrom?: string;
  required: number;
  /** Read opacity off the element and composite before measuring. */
  useOpacity?: boolean;
}

const SPECS: Spec[] = [
  { label: 'slide headline', selector: '.tl-slide--active .tl-slide__headline', required: 4.5 },
  { label: 'slide body', selector: '.tl-slide--active .tl-slide__body', required: 4.5 },
  { label: 'slide date', selector: '.tl-slide--active .tl-slide__date', required: 4.5 },
  { label: 'nav label', selector: '.tl-nav__label:not(.tl-nav__label--active)', required: 4.5 },
  { label: 'nav label (active)', selector: '.tl-nav__label--active', required: 4.5 },
  { label: 'marker dot', selector: '.tl-nav__dot:not(.tl-nav__dot--active)', prop: 'backgroundColor', required: 3 },
  { label: 'marker dot (active)', selector: '.tl-nav__dot--active', prop: 'backgroundColor', required: 3 },
  { label: 'span bar', selector: '.tl-nav__span-bar', prop: 'borderTopColor', required: 3 },
  { label: 'leader line', selector: '.tl-nav__leader:not(.tl-nav__leader--active)', prop: 'stroke', required: 3, useOpacity: true },
  { label: 'leader line (active)', selector: '.tl-nav__leader--active', prop: 'stroke', required: 3, useOpacity: true },
  { label: 'axis label', selector: '.tl-nav__axis-label', required: 4.5 },
  { label: 'zoom button', selector: '.tl-nav__zoom-btn', required: 4.5 },
  // Decorative: conveys no information the user could otherwise miss.
  { label: 'track rule', selector: '.tl-nav__track', pseudo: '::before', prop: 'backgroundColor', required: 0, useOpacity: true },
];

export function audit(root: ParentNode): Row[] {
  const rows: Row[] = [];

  for (const spec of SPECS) {
    const el = root.querySelector(spec.selector);
    if (!el) continue;

    const cs = getComputedStyle(el, spec.pseudo);
    let fg =
      spec.prop === 'backgroundColor' ? cs.backgroundColor
      : spec.prop === 'borderTopColor' ? cs.borderLeftColor
      : spec.prop === 'stroke' ? cs.stroke
      : cs.color;
    if (!fg || fg === 'none') continue;

    /*
     * Text is judged against its own background — a label chip's fill is
     * exactly what its text sits on. A mark whose *colour* comes from a
     * background or stroke has to start at the parent, or it would be
     * measured against itself.
     */
    const isText = !spec.prop || spec.prop === 'color';
    const start = spec.bgFrom
      ? root.querySelector(spec.bgFrom)
      : isText && !spec.pseudo
        ? el
        : (el.parentElement as Element | null);
    const bg = effectiveBg(start);

    /*
     * A mark painted out entirely has no contrast to report — measuring it
     * would produce a meaningless 1.00:1 row. The `bare` skin does this
     * deliberately, since hiding is the only removal a token can perform.
     */
    const op = parseFloat(cs.opacity || '1');
    if (op === 0 || fg === 'rgba(0, 0, 0, 0)' || cs.visibility === 'hidden') {
      rows.push({ label: spec.label, fg, bg, fgHex: '—', bgHex: hex(bg),
                  ratio: NaN, required: spec.required });
      continue;
    }
    if (spec.useOpacity && op < 1) fg = composite(fg, bg, op);

    rows.push({
      label: spec.label,
      fg, bg,
      fgHex: hex(fg),
      bgHex: hex(bg),
      ratio: contrast(fg, bg),
      required: spec.required,
    });
  }

  return rows;
}
