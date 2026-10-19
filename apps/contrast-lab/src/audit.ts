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
 * Walk up from `el` until an opaque background is found. A mark's real contrast
 * is against whatever is actually painted behind it, which is often several
 * levels up from the element carrying the color.
 *
 * `assumedWhite` says the walk crossed a background *image* before it reached
 * an opaque color. getComputedStyle reports an image's url, never its pixels,
 * so there is no colour to composite against; white is substituted, for the
 * reason given at the bottom of this function.
 */
function effectiveBg(el: Element | null): { bg: string; assumedWhite: boolean } {
  /*
   * Collect every painted layer down to the first opaque one, then flatten
   * them back together. Skipping the translucent layers — as this did — reads
   * a mark against whatever is several levels behind what it actually sits on:
   * the Bluesky card's 0.96 white fill was measured as the slide beneath it.
   */
  const layers: Array<[string, number]> = [];
  let sawImage = false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    const bg = cs.backgroundColor;
    const a = bg && bg !== 'transparent' ? alphaOf(bg) * parseFloat(cs.opacity || '1') : 0;
    if (a > 0) {
      layers.push([bg, a]);
      if (a >= 1) break; // opaque fill — nothing behind it can show through
    }
    /*
     * A background image paints over its own element's background-color, so it
     * ends the walk: everything from here up is hidden by the photo. Only a
     * fully covering, fully opaque image really does that, which is the normal
     * case for a slide background and the one worth modelling.
     */
    if (cs.backgroundImage && cs.backgroundImage !== 'none') { sawImage = true; break; }
  }
  /*
   * An unknown photo is measured as white, which is the bound rather than a
   * guess at the fixture. Every mark that lands on a background image in this
   * player is light copy over a dark scrim, so the lightest possible photo is
   * the worst case: a ratio that holds against white holds against any image.
   * Measuring the fixture's real pixels would instead make the row a fact
   * about one PNG — which is how a 40% scrim passed this audit for as long as
   * it did, the lab's only image being a convenient mid-tone.
   */
  let out = 'rgb(255, 255, 255)';
  for (let i = layers.length - 1; i >= 0; i--) out = composite(layers[i][0], out, layers[i][1]);
  return { bg: out, assumedWhite: sawImage };
}

interface Spec {
  label: string;
  selector: string;
  /** Read from a pseudo-element rather than the element itself. */
  pseudo?: '::before' | '::after';
  /** Which property carries the mark's color. */
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
  { label: 'span bar', selector: '.tl-nav__span-bar', prop: 'borderTopColor', required: 3, useOpacity: true },
  { label: 'leader line', selector: '.tl-nav__leader:not(.tl-nav__leader--active)', prop: 'stroke', required: 3, useOpacity: true },
  { label: 'leader line (active)', selector: '.tl-nav__leader--active', prop: 'stroke', required: 3, useOpacity: true },
  { label: 'axis label', selector: '.tl-nav__axis-label', required: 4.5 },
  { label: 'zoom button', selector: '.tl-nav__zoom-btn', required: 4.5 },
  /*
   * Controls and surfaces added after a sweep for values the contrast skin
   * could not reach. Each was invisible to this audit purely because it had no
   * row here, which is the failure mode the list itself is prone to: a mark
   * absent from SPECS reads as passing. When adding a mark to the player, add
   * it here too.
   */
  { label: 'nav grip', selector: '.tl-nav__grip', prop: 'backgroundColor', required: 3, useOpacity: true },
  { label: 'prev/next glyph', selector: '.tl-player__btn--prev', required: 3 },
  { label: 'fullscreen glyph', selector: '.tl-player__btn--fullscreen', required: 3 },
  { label: 'bsky body text', selector: '.tl-slide--active .tl-bsky__text', required: 4.5 },
  { label: 'bsky handle', selector: '.tl-slide--active .tl-bsky__handle', required: 4.5 },
  { label: 'bsky link', selector: '.tl-slide--active .tl-bsky__link', required: 4.5 },
  { label: 'bsky card border', selector: '.tl-slide--active .tl-media--bluesky', prop: 'borderTopColor', required: 3 },
  /*
   * Text over a background image. These are the rows that were missing when a
   * 40%-black scrim left the date at 1.84:1 over a pale photo. They read
   * `(worst case)` because the photo is measured as white — see effectiveBg.
   */
  { label: 'slide date over image (worst case)', selector: '.tl-slide--active.tl-slide--image-bg .tl-slide__date', required: 4.5 },
  { label: 'slide body over image (worst case)', selector: '.tl-slide--active.tl-slide--image-bg .tl-slide__body', required: 4.5 },
  { label: 'slide headline over image (worst case)', selector: '.tl-slide--active.tl-slide--image-bg .tl-slide__headline', required: 3 },
  // Decorative: conveys no information the user could otherwise miss.
  { label: 'track rule', selector: '.tl-nav__track', pseudo: '::before', prop: 'backgroundColor', required: 0, useOpacity: true },
];

/*
 * Not covered here, and worth knowing about:
 *
 *   - Hover and focus states. This audit reads resting style only, so the
 *     label's hover ring and the grip's hover opacity are measured by hand.
 *     Both were gaps; see --tl-nav-label-hover-ring in contrast.css.
 *   - The fixture's own background images. The rows for text over an image
 *     measure the photo as white rather than as the PNG in `public/`, because
 *     the bound is the point: light copy over a dark scrim is worst off on the
 *     lightest photo. A row here passing means the scrim holds for any image.
 *   - The 7:1 AAA floor. `required` is the AA threshold in every skin, so a
 *     row can pass here and still miss what contrast.css promises.
 */

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
     * exactly what its text sits on. A mark whose *color* comes from a
     * background or stroke has to start at the parent, or it would be
     * measured against itself.
     */
    const isText = !spec.prop || spec.prop === 'color';
    const start = spec.bgFrom
      ? root.querySelector(spec.bgFrom)
      : isText && !spec.pseudo
        ? el
        : (el.parentElement as Element | null);
    const { bg } = effectiveBg(start);

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
