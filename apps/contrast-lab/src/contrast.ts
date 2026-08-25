/**
 * WCAG 2.1 contrast helpers, used to audit a skin against the surfaces it
 * actually renders on rather than against assumed values.
 */

function channel(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** Parse any CSS colour (including rgb()/rgba()) into 0–255 triplets. */
export function toRgb(css: string): [number, number, number] {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = css.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** Alpha in a colour string, defaulting to 1. */
export function alphaOf(css: string): number {
  const m = css.match(/rgba\(\d+,\s*\d+,\s*\d+,\s*([\d.]+)\)/);
  return m ? +m[1] : 1;
}

export function luminance(css: string): number {
  const [r, g, b] = toRgb(css).map(v => channel(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Effective colour of `fg` painted at `opacity` over `bg` — the value a
 * partially-transparent mark is actually judged on.
 */
export function composite(fg: string, bg: string, opacity: number): string {
  const [a, b] = [toRgb(fg), toRgb(bg)];
  const out = a.map((v, i) => Math.round(opacity * v + (1 - opacity) * b[i]));
  return `rgb(${out.join(', ')})`;
}

export function hex(css: string): string {
  return '#' + toRgb(css).map(v => v.toString(16).padStart(2, '0')).join('');
}
