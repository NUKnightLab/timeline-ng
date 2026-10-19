import { describe, it, expect } from 'vitest';
import { packBand, packRows, type PackCandidate } from './labelPacking';

// The component's px constants, converted the way TimeNav does it.
const LABEL_GAP_PX  = 6;
const SHIFT_MAX_PX  = 80;
const SHIFT_STEP_PX = 12;
const LABEL_MAX_PX  = 130;

function opts(widthPx: number) {
  return {
    gapPct:      LABEL_GAP_PX  / widthPx * 100,
    stepPct:     SHIFT_STEP_PX / widthPx * 100,
    maxShiftPct: SHIFT_MAX_PX  / widthPx * 100,
  };
}

/** Build candidates from (centre %, label width px) pairs. */
function cands(widthPx: number, items: Array<[number, number]>): PackCandidate[] {
  return items.map(([centerPct, labelPx], index) => ({
    index,
    centerPct,
    halfPct: (Math.min(labelPx, LABEL_MAX_PX) / 2) / widthPx * 100,
  }));
}

const shiftPx = (centerPct: number, naturalPct: number, widthPx: number) =>
  Math.round((centerPct - naturalPct) / 100 * widthPx);

describe('packBand', () => {
  it('leaves a label at its own date when nothing is in the way', () => {
    const w = 1000;
    const slots = packBand(cands(w, [[20, 80], [60, 80]]), opts(w));
    expect(slots.get(0)!.centerPct).toBeCloseTo(20);
    expect(slots.get(1)!.centerPct).toBeCloseTo(60);
  });

  it('reserves only each label\'s own width, not the 130px cap', () => {
    // Two 80px labels 10% apart on a 1000px track are 100px apart: they clear
    // each other by 20px and neither should move. Reserving the 130px cap for
    // both would have declared a collision and shifted the second one.
    const w = 1000;
    const narrow = packBand(cands(w, [[20, 80], [30, 80]]), opts(w));
    expect(shiftPx(narrow.get(1)!.centerPct, 30, w)).toBe(0);

    const capped = packBand(cands(w, [[20, 130], [30, 130]]), opts(w));
    expect(shiftPx(capped.get(1)!.centerPct, 30, w)).toBeGreaterThan(0);
  });

  it('truncates at the 130px cap, so a very long label still reserves 130', () => {
    const w = 1000;
    const huge = packBand(cands(w, [[20, 400], [30, 400]]), opts(w));
    const capped = packBand(cands(w, [[20, 130], [30, 130]]), opts(w));
    expect(huge.get(1)!.centerPct).toBeCloseTo(capped.get(1)!.centerPct);
  });

  it('shifts a colliding label right, in whole steps, and never left', () => {
    const w = 1000;
    const slots = packBand(cands(w, [[20, 60], [22, 60]]), opts(w));
    expect(shiftPx(slots.get(0)!.centerPct, 20, w)).toBe(0);
    const shift = shiftPx(slots.get(1)!.centerPct, 22, w);
    expect(shift).toBeGreaterThan(0);
    expect(shift % SHIFT_STEP_PX).toBe(0);
    expect(shift).toBeLessThanOrEqual(SHIFT_MAX_PX);
  });

  it('gives up rather than exceed the budget, and the budget is a whole number of steps', () => {
    // The search tries 0, 12, 24 ... 72; 84 is past SHIFT_MAX_PX, so the
    // furthest a label can actually travel is 72px, not 80.
    const usable = Math.floor(SHIFT_MAX_PX / SHIFT_STEP_PX) * SHIFT_STEP_PX;
    const w = 1000;

    // Two 60px labels sharing a date need 66px of separation: inside 72px.
    const fits = packBand(cands(w, [[50, 60], [50, 60]]), opts(w));
    expect(shiftPx(fits.get(1)!.centerPct, 50, w)).toBe(usable);

    // Two 100px labels sharing a date need 106px: beyond the budget, so the
    // second one stays on its own date and overlaps instead of half-moving.
    const doesNot = packBand(cands(w, [[50, 100], [50, 100]]), opts(w));
    expect(shiftPx(doesNot.get(1)!.centerPct, 50, w)).toBe(0);
  });

  it('clamps per label, so a narrow label sits closer to the edge', () => {
    const w = 1000;
    const narrow = packBand(cands(w, [[100, 60]]), opts(w));
    const wide   = packBand(cands(w, [[100, 130]]), opts(w));
    expect(narrow.get(0)!.centerPct).toBeGreaterThan(wide.get(0)!.centerPct);
    // Each is pulled in by exactly its own half-width.
    expect(narrow.get(0)!.centerPct).toBeCloseTo(100 - 3);
    expect(wide.get(0)!.centerPct).toBeCloseTo(100 - 6.5);
  });

  it('keeps every label, overlapping rather than hiding, when the budget runs out', () => {
    // Four 130px labels within 1% of each other need ~136px of separation
    // apiece, far beyond the 80px budget.
    const w = 400;
    const slots = packBand(cands(w, [[50, 130], [50.5, 130], [51, 130], [51.5, 130]]), opts(w));
    expect(slots.size).toBe(4);
    for (const slot of slots.values()) expect(slot.hidden).toBe(false);
  });

  it('never shifts a label beyond the budget', () => {
    const w = 600;
    const items: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => [40 + i * 0.5, 96]);
    const slots = packBand(cands(w, items), opts(w));
    for (const [index, slot] of slots) {
      const natural = items[index][0];
      expect(Math.abs(shiftPx(slot.centerPct, natural, w))).toBeLessThanOrEqual(SHIFT_MAX_PX);
    }
  });

  it('separates two labels that share a date when their width allows it', () => {
    // Sharing a date is not in itself a reason to overlap: the leader lines
    // show where both really sit. 60px labels need 66px of clearance, which the
    // budget can pay for.
    const w = 1000;
    const slots = packBand(cands(w, [[50, 60], [50, 60]]), opts(w));
    const apart = (slots.get(1)!.centerPct - slots.get(0)!.centerPct) / 100 * w;
    expect(apart).toBeGreaterThanOrEqual(60 + LABEL_GAP_PX);
  });
});

describe('packRows', () => {
  it('uses a second row before shifting, when one is available', () => {
    const w = 1000;
    const slots = packRows(cands(w, [[50, 130], [51, 130]]), 2, opts(w));
    expect(slots.get(0)!.row).toBe(0);
    expect(slots.get(1)!.row).toBe(1);
    expect(shiftPx(slots.get(1)!.centerPct, 51, w)).toBe(0);
  });

  it('hides fewer labels once each reserves only its own width', () => {
    // Eight short labels bunched into the right-hand third of a narrow track.
    const w = 360;
    const items: Array<[number, number]> = Array.from({ length: 8 }, (_, i) => [70 + i * 1.5, 64]);
    const measured = packRows(cands(w, items), 2, opts(w));
    const flat     = packRows(cands(w, items.map(([c]) => [c, LABEL_MAX_PX] as [number, number])), 2, opts(w));

    const hiddenCount = (slots: Map<number, { hidden: boolean }>) =>
      [...slots.values()].filter(s => s.hidden).length;

    expect(hiddenCount(measured)).toBeLessThan(hiddenCount(flat));
  });

  it('hides a label rather than stacking it at the right edge', () => {
    const w = 300;
    const items: Array<[number, number]> = Array.from({ length: 10 }, (_, i) => [85 + i * 0.5, 130]);
    const slots = packRows(cands(w, items), 1, opts(w));
    expect([...slots.values()].some(s => s.hidden)).toBe(true);
    // Nothing visible is parked past the right edge.
    for (const slot of slots.values()) {
      if (!slot.hidden) expect(slot.centerPct).toBeLessThanOrEqual(100);
    }
  });

  it('treats 0 rows as 1, rather than dividing by nothing', () => {
    const w = 1000;
    const slots = packRows(cands(w, [[20, 80], [60, 80]]), 0, opts(w));
    expect([...slots.values()].every(s => s.row === 0)).toBe(true);
  });
});

describe('the rightward-only search', () => {
  /*
   * The packer only searches rightwards. The claim is that a leftward candidate
   * can never succeed where the natural position failed, so exhaustively
   * comparing against a both-directions search must produce identical results.
   */
  function packBothDirections(candidates: PackCandidate[], o: ReturnType<typeof opts>) {
    const slots = new Map<number, number>();
    let rowRight = -Infinity;
    for (const ev of [...candidates].sort((a, b) => a.centerPct - b.centerPct)) {
      const half = ev.halfPct;
      const clamp = (c: number) => Math.max(half, Math.min(100 - half, c));
      const natural = clamp(ev.centerPct);
      let placed = false;
      for (let mag = 0; mag <= o.maxShiftPct + 0.001; mag += o.stepPct) {
        for (const dir of mag === 0 ? [0] : [1, -1]) {
          const c = clamp(natural + mag * dir);
          if (rowRight + o.gapPct <= c - half) {
            rowRight = c + half;
            slots.set(ev.index, c);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) {
        rowRight = natural + half;
        slots.set(ev.index, natural);
      }
    }
    return slots;
  }

  it('matches a both-directions search on randomised layouts', () => {
    let seed = 20_251_019;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    for (let trial = 0; trial < 500; trial++) {
      const w = 320 + Math.floor(rand() * 1200);
      const n = 2 + Math.floor(rand() * 12);
      const items: Array<[number, number]> = Array.from({ length: n }, () =>
        [rand() * 100, 30 + rand() * 160] as [number, number]);
      const candidates = cands(w, items);
      const o = opts(w);
      const mine = packBand(candidates, o);
      const both = packBothDirections(candidates, o);
      for (const [index, slot] of mine) {
        expect(both.get(index)).toBeCloseTo(slot.centerPct, 10);
      }
    }
  });
});
