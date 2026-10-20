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

describe('the leftward relaxation', () => {
  /*
   * The greedy pass commits a label before it can know what is coming, so on a
   * band where two events nearly share a date the earlier label is frozen at
   * its natural spot with the free space sitting unused beside it. These cover
   * the two shapes that showed up on a real timeline.
   */

  it('pulls the earlier label left into free space when two labels share a date', () => {
    // 439px band: two 96px labels 2px apart, with the whole left half empty.
    const w = 439;
    const slots = packBand(cands(w, [[159 / w * 100, 96], [161 / w * 100, 96]]), opts(w));
    const a = slots.get(0)!.centerPct / 100 * w;
    const b = slots.get(1)!.centerPct / 100 * w;

    // The later label stays put; the earlier one goes left, not right.
    expect(Math.round(b)).toBe(161);
    expect(a).toBeLessThan(159);

    // Overlap is substantially reduced. It cannot clear — separating two 96px
    // labels needs 102px and the budget is 80 — but it must not stay at 94px.
    const overlapPx = (a + 48) - (b - 48);
    expect(overlapPx).toBeLessThan(30);
  });

  it('fully clears a pair that the shift budget can separate', () => {
    // Both labels clamped against the right edge, 72px of separation needed.
    const w = 439;
    const slots = packBand(cands(w, [[374 / w * 100, 130], [406 / w * 100, 66]]), opts(w));
    const a = slots.get(0)!.centerPct / 100 * w;
    const b = slots.get(1)!.centerPct / 100 * w;

    expect((a + 65) + LABEL_GAP_PX).toBeLessThanOrEqual(b - 33 + 0.001);
  });

  it('never moves a label further than the budget, in either direction', () => {
    const w = 500;
    const items: Array<[number, number]> = [[50, 130], [50.5, 130], [51, 130], [80, 100]];
    const slots = packBand(cands(w, items), opts(w));
    for (const [index, slot] of slots) {
      const natural = Math.max(
        cands(w, items)[index].halfPct,
        Math.min(100 - cands(w, items)[index].halfPct, items[index][0]),
      );
      expect(Math.abs(shiftPx(slot.centerPct, natural, w))).toBeLessThanOrEqual(SHIFT_MAX_PX);
    }
  });

  it('keeps every label in time order on randomised layouts, within budget', () => {
    let seed = 20_251_019;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    for (let trial = 0; trial < 500; trial++) {
      const w = 320 + Math.floor(rand() * 1200);
      const n = 2 + Math.floor(rand() * 12);
      const items: Array<[number, number]> = Array.from({ length: n }, () =>
        [rand() * 100, 30 + rand() * 160] as [number, number]);
      const candidates = cands(w, items);
      const slots = packBand(candidates, opts(w));

      // Nothing is dropped — a band overlaps rather than hiding.
      expect(slots.size).toBe(n);

      const o = opts(w);
      const byDate = [...candidates].sort((a, b) => a.centerPct - b.centerPct);
      let prevCenter = -Infinity;
      let prevCapped = false;

      for (const ev of byDate) {
        const slot = slots.get(ev.index)!;
        const natural = Math.max(ev.halfPct, Math.min(100 - ev.halfPct, ev.centerPct));
        const shift = Math.abs(slot.centerPct - natural);
        const capped = shift >= o.maxShiftPct - 1e-9;

        /*
         * Two things can make order unreachable, and neither is a defect.
         *
         * The shift budget: in a pile dense enough that a label cannot reach
         * its predecessor without spending more than the budget, the budget
         * wins. It bounds how far any label can misrepresent its own date,
         * where order only matters against a neighbour already drawn on top
         * of it.
         *
         * The viewport edge: a label can be centred no further right than
         * `100 - halfPct`, and that bound is tighter for a wide label than a
         * narrow one. So a wide label following a narrow one near the right
         * edge can be geometrically unable to sit at or beyond it, however
         * much budget is left. Pulling the narrow one left instead is the
         * relaxation's job, and it does that whenever its own predecessor
         * leaves it room.
         */
        const edgeBound = 100 - ev.halfPct;
        if (!capped && !prevCapped && edgeBound >= prevCenter - 1e-9) {
          expect(slot.centerPct).toBeGreaterThanOrEqual(prevCenter - 1e-9);
        }
        prevCenter = slot.centerPct;
        prevCapped = capped;

        // The budget itself is never exceeded, whichever way the label moved.
        expect(shift).toBeLessThanOrEqual(o.maxShiftPct + 1e-9);

        // Nor does a label leave the viewport.
        expect(slot.centerPct).toBeGreaterThanOrEqual(ev.halfPct - 1e-9);
        expect(slot.centerPct).toBeLessThanOrEqual(100 - ev.halfPct + 1e-9);
      }
    }
  });

  it('leaves a row alone when nothing overlaps', () => {
    const w = 1000;
    const items: Array<[number, number]> = [[10, 80], [40, 80], [70, 80]];
    const slots = packBand(cands(w, items), opts(w));
    for (const [index, slot] of slots) {
      expect(slot.centerPct).toBeCloseTo(items[index][0], 10);
    }
  });
});
