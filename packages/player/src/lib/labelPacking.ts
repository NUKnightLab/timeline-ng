/**
 * Navigator label packing.
 *
 * The navigator encodes time on the horizontal axis, so a label's ideal x is
 * its event's own position and nothing else. When two labels would collide,
 * the packer shifts the later one to the right until it clears its neighbour
 * and a leader line confesses the deviation. Labels are never moved off their
 * row to a different date, and never moved further than the shift budget.
 *
 * Every measurement here is a percentage of the timeline content width, so the
 * caller converts its px constants once and the packer stays resolution-free.
 * Extracted from TimeNav.svelte so the geometry can be tested on its own.
 */

/** One label's packing inputs. */
export interface PackCandidate {
  /** Index into the timeline's event list — the key of the returned slot. */
  index: number;
  /** The label's natural centre: where its date puts it, in screen percent. */
  centerPct: number;
  /**
   * Half this label's own rendered width, in screen percent. Per-label rather
   * than a single worst case: a short label reserves only the room it needs,
   * and may legitimately sit closer to the viewport edge than a wide one.
   */
  halfPct: number;
}

export interface PackSlot {
  row: number;
  centerPct: number;
  /** True when no slot was found and the dot stands in for the label. */
  hidden: boolean;
}

export interface PackOptions {
  /** Minimum clear space between two labels. */
  gapPct: number;
  /** Granularity of the shift search. */
  stepPct: number;
  /** Largest shift away from the natural position. */
  maxShiftPct: number;
}

/** Keep a label's whole box inside the viewport. */
function clamp(centerPct: number, halfPct: number): number {
  return Math.max(halfPct, Math.min(100 - halfPct, centerPct));
}

function byCenter(a: PackCandidate, b: PackCandidate): number {
  return a.centerPct - b.centerPct;
}

/*
 * The search below only ever shifts right, which is not an oversight.
 *
 * Placement is strictly left to right, so rowRight holds labels already placed
 * to the left, and the acceptance test `rowRight + gapPct <= candidatePct -
 * halfPct` is monotonic increasing in candidatePct while halfPct is fixed for
 * the label being placed. A leftward candidate is clamp(naturalPct - mag),
 * which is never greater than naturalPct — the clamp's lower bound is halfPct,
 * and naturalPct is already at least halfPct. So if the natural position failed
 * the test, every leftward candidate fails it too. Searching leftwards was dead
 * work rather than a missed placement.
 *
 * This still holds with per-label widths: halfPct belongs to the label being
 * placed, not to the candidate position, so it is constant across one label's
 * search and cannot flip the comparison around.
 */

/**
 * Pack one row, in the manner of a group band: every label gets placed, and one
 * that cannot clear its neighbour within the shift budget stays at its natural
 * position and overlaps. A group band is a single row by construction, so there
 * is nowhere else to put it and hiding it would lose the group's shape.
 */
export function packBand(
  candidates: PackCandidate[],
  { gapPct, stepPct, maxShiftPct }: PackOptions,
): Map<number, PackSlot> {
  const slots = new Map<number, PackSlot>();
  let rowRight = -Infinity;

  for (const ev of [...candidates].sort(byCenter)) {
    const { halfPct } = ev;
    const naturalPct = clamp(ev.centerPct, halfPct);
    let placed = false;

    for (let mag = 0; mag <= maxShiftPct + 0.001; mag += stepPct) {
      const candidatePct = clamp(naturalPct + mag, halfPct);
      if (rowRight + gapPct <= candidatePct - halfPct) {
        rowRight = candidatePct + halfPct;
        slots.set(ev.index, { row: 0, centerPct: candidatePct, hidden: false });
        placed = true;
        break;
      }
    }

    if (!placed) {
      rowRight = naturalPct + halfPct;
      slots.set(ev.index, { row: 0, centerPct: naturalPct, hidden: false });
    }
  }

  return slots;
}

/**
 * Pack across several rows, in the manner of an ungrouped navigator: a label
 * takes the first row that has room at the first position that clears it, and a
 * label with nowhere left to go is hidden rather than stacked on top of its
 * neighbours.
 */
export function packRows(
  candidates: PackCandidate[],
  rows: number,
  { gapPct, stepPct, maxShiftPct }: PackOptions,
): Map<number, PackSlot> {
  const slots = new Map<number, PackSlot>();
  const visRows = Math.max(1, rows);
  const rowRight: number[] = new Array(visRows).fill(-Infinity);

  outer: for (const ev of [...candidates].sort(byCenter)) {
    const { halfPct } = ev;
    const naturalPct = clamp(ev.centerPct, halfPct);

    for (let mag = 0; mag <= maxShiftPct + 0.001; mag += stepPct) {
      const candidatePct = clamp(naturalPct + mag, halfPct);
      const leftPct = candidatePct - halfPct;
      for (let row = 0; row < visRows; row++) {
        if (rowRight[row] + gapPct <= leftPct) {
          rowRight[row] = candidatePct + halfPct;
          slots.set(ev.index, { row, centerPct: candidatePct, hidden: false });
          continue outer;
        }
      }
    }

    /*
     * No gap-respecting slot within the shift budget. Pack the label into
     * whichever row has the most room, directly after that row's last label, so
     * it never renders with zero separation from a neighbour — it just gets
     * pushed further from its natural position instead.
     */
    let bestRow = 0;
    for (let row = 1; row < visRows; row++) {
      if (rowRight[row] < rowRight[bestRow]) bestRow = row;
    }
    const packedPct = rowRight[bestRow] + gapPct + halfPct;
    if (packedPct > 100 - halfPct) {
      /*
       * Nowhere left to put it. This used to clamp to the right edge, which
       * meant every label that ran out of room landed on the same spot and
       * stacked into something unreadable — worst on the timelines that need
       * help most, where events bunch at one end. Hiding the label is the
       * honest outcome: the dot still marks the date and still navigates, and
       * zooming in spreads the events out until the label has room to come back.
       */
      slots.set(ev.index, { row: bestRow, centerPct: naturalPct, hidden: true });
      continue;
    }
    rowRight[bestRow] = packedPct + halfPct;
    slots.set(ev.index, { row: bestRow, centerPct: packedPct, hidden: false });
  }

  return slots;
}
