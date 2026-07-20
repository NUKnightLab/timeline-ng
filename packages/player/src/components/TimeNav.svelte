<script lang="ts">
  import type { TLEvent, TLTimeline, TLParsedDate } from '@knight-lab/timeline-ng-core';
  import { parseTLDate, compareDates, formatDate, getLocale, getMessage } from '@knight-lab/timeline-ng-core';
  import { untrack } from 'svelte';
  import { stripHtml } from '../lib/sanitize';

  interface Props {
    timeline: TLTimeline;
    activeIndex: number;
    language?: string;
    compact?: boolean;
    minimal?: boolean;
    onnavigate: (index: number) => void;
    onstart?: () => void;
    onend?: () => void;
  }

  let { timeline, activeIndex, language = 'en', compact = false, minimal = false, onnavigate, onstart, onend }: Props = $props();

  const tl = $derived(getLocale(language));

  function prefersReducedMotion(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── Layout constants ──────────────────────────────────────────────────────
  const ROW_HEIGHT    = 26;
  const TICK_H        = 6;
  const SPAN_PAD      = 4;
  const TRACK_AREA    = 44;
  const MAX_ROWS      = 3;
  const LABEL_MAX_PX  = 130;
  const LABEL_GAP_PX  = 6;
  const SHIFT_MAX_PX  = 80;
  const SHIFT_STEP_PX = 12;
  const MIN_RANGE     = 0.1;
  const GROUP_LABEL_H = 20;   // height of each group's label band
  const AXIS_H        = 18;   // axis strip below the shared track
  const GROUP_GUTTER  = 72;   // px reserved on the left for group name labels
  const ZOOM_GUTTER   = 44;   // px reserved on the left for zoom controls (non-grouped)

  // ── Responsive layout derived from compact/minimal props ─────────────────
  const controlGutter = $derived(compact || minimal ? 28 : 44);

  // ── Viewport state (data-space percentages 0–100) ─────────────────────────
  let viewStart       = $state(0);
  let viewEnd         = $state(100);
  let timelineWidth   = $state(800);   // width of the timeline content area (excl. gutter)
  let isDragging      = $state(false);
  let isPanning       = $state(false); // true during programmatic pan animation

  const viewRange = $derived(viewEnd - viewStart);
  const isZoomed  = $derived(viewRange < 99.5);

  function toScreenPct(dataPct: number): number {
    return (dataPct - viewStart) / viewRange * 100;
  }

  // ── Base event parsing (no viewport dependency) ───────────────────────────
  interface BaseEvent {
    event: TLEvent;
    index: number;
    dataPct: number;        // dot/bracket-center anchor in data space
    dataStartPct: number;   // left edge in data space
    dataWidthPct: number | null;
    isDuration: boolean;
    label: string;
    ariaLabel: string;
    group: string;
  }

  const baseEvents = $derived.by((): BaseEvent[] => {
    const events = timeline.events;
    if (events.length === 0) return [];

    const parsed: Array<{ event: TLEvent; index: number; start: TLParsedDate; end: TLParsedDate | null }> = [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev.start_date) continue;
      const start = parseTLDate(ev.start_date);
      const end   = ev.end_date ? parseTLDate(ev.end_date) : null;
      parsed.push({ event: ev, index: i, start, end });
    }
    if (parsed.length === 0) return [];

    const allDates   = parsed.flatMap(p => p.end ? [p.start, p.end] : [p.start]);
    const sortedDates = [...allDates].sort(compareDates);

    const toB  = (d: TLParsedDate): bigint => d.bigMs ?? BigInt(Math.round(d.ms));
    const minB = toB(sortedDates[0]);
    const maxB = toB(sortedDates[sortedDates.length - 1]);
    const rangeB = maxB - minB;

    function toPct(d: TLParsedDate): number {
      if (rangeB === 0n) return 0;
      return Number(((toB(d) - minB) * 10000n) / rangeB) / 100;
    }

    return parsed.map(({ event, index, start, end }) => {
      const dataStartPct = toPct(start);
      const endPct       = end ? toPct(end) : null;
      const dataWidthPct = endPct !== null ? endPct - dataStartPct : null;
      const isDuration   = dataWidthPct !== null;
      const dateStr      = formatDate(start, language);
      const headline      = event.text?.headline;
      const plainHeadline = headline ? stripHtml(headline) : '';
      const label         = plainHeadline || dateStr;
      const ariaLabel     = plainHeadline ? `${plainHeadline}: ${dateStr}` : dateStr;
      const dataPct      = isDuration ? dataStartPct + dataWidthPct! / 2 : dataStartPct;
      const group        = event.group ?? '';
      return { event, index, dataStartPct, dataWidthPct, isDuration, label, ariaLabel, dataPct, group };
    });
  });

  // ── Group ordering ────────────────────────────────────────────────────────
  const groupOrder = $derived.by((): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const ev of baseEvents) {
      if (!seen.has(ev.group)) { seen.add(ev.group); result.push(ev.group); }
    }
    return result;
  });
  const hasGroups = $derived(groupOrder.some(g => g !== ''));

  // ── Projected + visible events (viewport-dependent) ───────────────────────
  interface PositionedEvent extends BaseEvent {
    screenPct: number;
    screenStartPct: number;
    screenWidthPct: number | null;
    row: number;
    labelCenterPct: number;
    groupIdx: number;
  }

  const positioned = $derived.by((): PositionedEvent[] => {
    const BUFFER = 20;
    const MIN_BRACKET_PX = 10;

    // Project to screen coords and discard fully off-screen events
    const projected = baseEvents.map(ev => {
      const screenStartPct = toScreenPct(ev.dataStartPct);
      const screenWidthPct = ev.dataWidthPct !== null
        ? toScreenPct(ev.dataStartPct + ev.dataWidthPct) - screenStartPct
        : null;
      const isDuration = ev.isDuration &&
        screenWidthPct !== null &&
        (screenWidthPct / 100 * timelineWidth) >= MIN_BRACKET_PX;
      const screenPct = isDuration
        ? toScreenPct(ev.dataPct)
        : (ev.dataWidthPct !== null ? screenStartPct : toScreenPct(ev.dataPct));
      const groupIdx = hasGroups ? groupOrder.indexOf(ev.group) : 0;
      return { ...ev, isDuration, screenPct, screenStartPct, screenWidthPct, groupIdx };
    }).filter(ev => {
      const l = ev.isDuration ? ev.screenStartPct : ev.screenPct;
      const r = ev.isDuration ? ev.screenStartPct + ev.screenWidthPct! : ev.screenPct;
      return r > -BUFFER && l < 100 + BUFFER;
    });

    const halfPct     = (LABEL_MAX_PX / 2) / timelineWidth * 100;
    const gapPct      = LABEL_GAP_PX / timelineWidth * 100;
    const stepPct     = SHIFT_STEP_PX / timelineWidth * 100;
    const maxShiftPct = SHIFT_MAX_PX  / timelineWidth * 100;

    const labelMap = new Map<number, { row: number; centerPct: number }>();

    if (hasGroups) {
      // Per-group label allocation — 1 row per group band
      for (let gi = 0; gi < groupOrder.length; gi++) {
        const groupEvs = projected.filter(ev => ev.groupIdx === gi);
        let rowRight = -Infinity;
        for (const ev of [...groupEvs].sort((a, b) => a.screenPct - b.screenPct)) {
          const naturalPct = Math.max(halfPct, Math.min(100 - halfPct, ev.screenPct));
          let placed = false;
          for (let mag = 0; mag <= maxShiftPct + 0.001; mag += stepPct) {
            for (const dir of mag === 0 ? [0] : [1, -1]) {
              const candidatePct = Math.max(halfPct, Math.min(100 - halfPct, naturalPct + mag * dir));
              if (rowRight + gapPct <= candidatePct - halfPct) {
                rowRight = candidatePct + halfPct;
                labelMap.set(ev.index, { row: 0, centerPct: candidatePct });
                placed = true;
                break;
              }
            }
            if (placed) break;
          }
          if (!placed) {
            rowRight = naturalPct + halfPct;
            labelMap.set(ev.index, { row: 0, centerPct: naturalPct });
          }
        }
      }
    } else {
      // Global label allocation — capped to displayRows so labels overlap
      // rather than forcing extra height when the drawer is partially open.
      const visRows = Math.max(1, displayRows);
      const rowRight: number[] = new Array(visRows).fill(-Infinity);
      outer: for (const ev of [...projected].sort((a, b) => a.screenPct - b.screenPct)) {
        const naturalPct = Math.max(halfPct, Math.min(100 - halfPct, ev.screenPct));
        for (let mag = 0; mag <= maxShiftPct + 0.001; mag += stepPct) {
          for (const dir of mag === 0 ? [0] : [1, -1]) {
            const candidatePct = Math.max(halfPct, Math.min(100 - halfPct, naturalPct + mag * dir));
            const leftPct = candidatePct - halfPct;
            for (let row = 0; row < visRows; row++) {
              if (rowRight[row] + gapPct <= leftPct) {
                rowRight[row] = candidatePct + halfPct;
                labelMap.set(ev.index, { row, centerPct: candidatePct });
                continue outer;
              }
            }
          }
        }
        // Fallback: no gap-respecting slot found within the shift budget. Pack the
        // label into whichever row has the most room, directly after that row's
        // last label, so it never renders with zero separation from a neighbor —
        // it just gets pushed further from its natural position instead.
        let bestRow = 0;
        for (let row = 1; row < visRows; row++) {
          if (rowRight[row] < rowRight[bestRow]) bestRow = row;
        }
        const packedPct = Math.min(100 - halfPct, rowRight[bestRow] + gapPct + halfPct);
        rowRight[bestRow] = packedPct + halfPct;
        labelMap.set(ev.index, { row: bestRow, centerPct: packedPct });
      }
    }

    return projected.map(ev => {
      const { row, centerPct } = labelMap.get(ev.index) ?? { row: 0, centerPct: ev.screenPct };
      return { ...ev, row, labelCenterPct: centerPct };
    });
  });

  // ── Axis tick marks ───────────────────────────────────────────────────────
  const MS_PER_YEAR = 31_557_600_000; // Julian year in ms
  const YEAR_STEPS  = [1,2,5,10,20,25,50,100,200,500,1_000,2_000,5_000,10_000,100_000,1_000_000,1_000_000_000];
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTH_STEPS = [1, 2, 3, 6];

  const axisTicks = $derived.by((): Array<{label: string; screenPct: number; edge?: 'start' | 'end'}> => {
    if (baseEvents.length === 0) return [];

    const toB = (d: TLParsedDate): bigint => d.bigMs ?? BigInt(Math.round(d.ms));

    const allDates: TLParsedDate[] = [];
    for (const ev of timeline.events) {
      if (ev.start_date) allDates.push(parseTLDate(ev.start_date));
      if (ev.end_date)   allDates.push(parseTLDate(ev.end_date));
    }
    if (allDates.length === 0) return [];

    const sorted  = [...allDates].sort(compareDates);
    const minB    = toB(sorted[0]);
    const maxB    = toB(sorted[sorted.length - 1]);
    const rangeB  = maxB - minB;
    if (rangeB === 0n) return [];

    // For cosmological dates Number() loses precision — skip axis labels
    if (rangeB > BigInt(Number.MAX_SAFE_INTEGER)) return [];

    const minMs   = Number(minB);
    const rangeMs = Number(rangeB);

    const viewMinMs    = minMs + (viewStart / 100) * rangeMs;
    const viewMaxMs    = minMs + (viewEnd   / 100) * rangeMs;
    const viewYearSpan = (viewMaxMs - viewMinMs) / MS_PER_YEAR;

    const result: Array<{label: string; screenPct: number; edge?: 'start' | 'end'}> = [];

    if (viewYearSpan < 1.5) {
      // Sub-year view: generate month ticks instead of year ticks
      const monthSpan = viewYearSpan * 12;
      let monthStep = MONTH_STEPS[MONTH_STEPS.length - 1];
      for (const s of MONTH_STEPS) {
        if (monthSpan / s <= 7) { monthStep = s; break; }
      }

      const d = new Date(viewMinMs);
      let y = d.getUTCFullYear();
      let m = Math.ceil(d.getUTCMonth() / monthStep) * monthStep;
      if (m >= 12) { y++; m -= 12; }

      for (let guard = 0; guard < 24; guard++) {
        const tickMs = Date.UTC(y, m, 1);
        if (tickMs > viewMaxMs + 1) break;
        const tickB = BigInt(Math.round(tickMs));
        const dataPct  = Number(((tickB - minB) * 10_000n) / rangeB) / 100;
        const screenPct = toScreenPct(dataPct);
        if (screenPct >= -0.5 && screenPct <= 100.5) {
          const label = m === 0 ? String(y) : `${MONTH_NAMES[m]} ${y}`;
          result.push({ label, screenPct });
        }
        m += monthStep;
        if (m >= 12) { y++; m -= 12; }
      }
      if (result.length > 0) return result;
      return [
        { label: formatDate(sorted[0], language), screenPct: 0, edge: 'start' },
        { label: formatDate(sorted[sorted.length - 1], language), screenPct: 100, edge: 'end' },
      ];
    }

    // Year-based ticks
    const viewStartDate = new Date(viewMinMs);
    const viewEndDate = new Date(viewMaxMs);
    const startYear = viewStartDate.getUTCFullYear();
    const endYear = viewEndDate.getUTCFullYear();
    const visibleYearSpan = Math.max(1, endYear - startYear + 1);

    let step = YEAR_STEPS[YEAR_STEPS.length - 1];
    for (const s of YEAR_STEPS) {
      if (visibleYearSpan / s <= 7) { step = s; break; }
    }

    const firstTickYear = Math.ceil(startYear / step) * step;
    const lastTickYear  = Math.floor(endYear / step) * step;

    for (let year = firstTickYear; year <= lastTickYear; year += step) {
      const tickB    = toB(parseTLDate({ year }));
      const dataPct  = Number(((tickB - minB) * 10_000n) / rangeB) / 100;
      const screenPct = toScreenPct(dataPct);
      if (screenPct < -0.5 || screenPct > 100.5) continue;

      let label: string;
      const abs = Math.abs(year);
      if (abs >= 1_000_000_000)     label = `${(year / 1_000_000_000).toFixed(1)} Byr${year < 0 ? ' BCE' : ''}`;
      else if (abs >= 1_000_000)    label = `${(year / 1_000_000).toFixed(1)} Myr${year < 0 ? ' BCE' : ''}`;
      else if (abs >= 10_000)       label = `${(abs / 1_000).toFixed(0)}k${year < 0 ? ' BCE' : ' CE'}`;
      else if (year < 0)            label = `${abs} BCE`;
      else                          label = String(year);

      result.push({ label, screenPct });
    }

    if (result.length > 0) return result;

    const startLabel = startYear < 0 ? `${Math.abs(startYear)} BCE` : String(startYear);
    const endLabel = endYear < 0 ? `${Math.abs(endYear)} BCE` : String(endYear);
    return [
      { label: startLabel, screenPct: 0, edge: 'start' },
      { label: endLabel, screenPct: 100, edge: 'end' },
    ];
  });

  // ── Group band layout ─────────────────────────────────────────────────────
  interface GroupBand {
    label: string;
    isEven: boolean;
    yBase: number;
    trackTop: number;   // absolute Y
    trackMidY: number;  // absolute Y
    height: number;
  }

  const HANDLE_H  = 8;   // grip strip at top of nav

  // User-controlled label rows: 0 = collapsed (axis only), 1..MAX_ROWS = open
  let displayRows = $state(1);
  let userAdjustedRows = $state(false);
  let lastCompact = $state<boolean | null>(null);

  // Compact mode should default closed, but once the viewer opens/closes the drawer
  // manually we preserve that choice instead of forcing rows again.
  $effect(() => {
    const isCompact = compact;
    const priorCompact = untrack(() => lastCompact);
    const hasUserAdjustedRows = untrack(() => userAdjustedRows);
    lastCompact = isCompact;

    if (hasUserAdjustedRows) return;
    if (priorCompact === null || priorCompact !== isCompact) {
      displayRows = isCompact ? 0 : 1;
    }
  });

  // Stable layout metrics — computed from the full dataset, not the viewport,
  // so the nav height doesn't jump during pan/zoom.
  const layoutMetrics = $derived.by((): { maxLabelRows: number } => {
    if (hasGroups || baseEvents.length === 0) return { maxLabelRows: 1 };
    const halfPct = (LABEL_MAX_PX / 2) / timelineWidth * 100;
    const gapPct  = LABEL_GAP_PX    / timelineWidth * 100;
    const rowRight: number[] = new Array(MAX_ROWS).fill(-Infinity);
    let maxLabelRows = 1;
    for (const ev of [...baseEvents].sort((a, b) => a.dataPct - b.dataPct)) {
      const pos = Math.max(halfPct, Math.min(100 - halfPct, ev.dataPct));
      let placed = false;
      for (let row = 0; row < MAX_ROWS; row++) {
        if (rowRight[row] + gapPct <= pos - halfPct) {
          rowRight[row] = pos + halfPct;
          maxLabelRows = Math.max(maxLabelRows, row + 1);
          placed = true;
          break;
        }
      }
      if (!placed) maxLabelRows = MAX_ROWS;
    }
    return { maxLabelRows };
  });

  // Track Y position responds to displayRows, not the dataset maximum.
  const sharedTrackTop = $derived.by((): number => {
    if (hasGroups) return groupOrder.length * GROUP_LABEL_H;
    if (displayRows === 0) return 0;
    return displayRows * ROW_HEIGHT + SPAN_PAD + TICK_H;
  });
  const sharedTrackMidY = $derived(sharedTrackTop + TRACK_AREA / 2);

  const groupBands = $derived.by((): GroupBand[] =>
    hasGroups
      ? groupOrder.map((label, gi) => ({
          label,
          isEven: gi % 2 === 1,
          yBase: gi * GROUP_LABEL_H,
          trackTop: gi * GROUP_LABEL_H,
          trackMidY: gi * GROUP_LABEL_H + GROUP_LABEL_H / 2,
          height: GROUP_LABEL_H,
        }))
      : []
  );

  const contentHeight = $derived(
    hasGroups
      ? groupOrder.length * GROUP_LABEL_H + TRACK_AREA
      : sharedTrackTop + TRACK_AREA
  );

  const navHeight = $derived(HANDLE_H + contentHeight + AXIS_H);

  // ── Grip drag ─────────────────────────────────────────────────────────────
  let _gripDragging  = false;
  let _gripStartY    = 0;
  let _gripStartRows = 0;
  let _wasDrag       = false;

  function handleGripDown(e: PointerEvent) {
    e.stopPropagation();
    _gripStartY    = e.clientY;
    _gripStartRows = displayRows;
    _wasDrag       = false;
    _gripDragging  = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function handleGripMove(e: PointerEvent) {
    if (!_gripDragging) return;
    const deltaY = _gripStartY - e.clientY; // up = positive = more rows
    if (Math.abs(deltaY) > 4) _wasDrag = true;
    const delta = Math.round(deltaY / ROW_HEIGHT);
    userAdjustedRows = true;
    displayRows = Math.max(0, Math.min(layoutMetrics.maxLabelRows, _gripStartRows + delta));
  }

  function handleGripUp() {
    _gripDragging = false;
    // _wasDrag intentionally not reset here — handleGripClick reads it next
  }

  function handleGripClick() {
    if (_wasDrag) { _wasDrag = false; return; }
    userAdjustedRows = true;
    displayRows = displayRows > 0 ? 0 : 1;
  }

  // Absolute Y helpers
  function absRowCenterY(ev: PositionedEvent): number {
    return hasGroups
      ? ev.groupIdx * GROUP_LABEL_H + GROUP_LABEL_H / 2
      : ev.row * ROW_HEIGHT + ROW_HEIGHT / 2;
  }
  function absRowBottomY(ev: PositionedEvent): number {
    return hasGroups
      ? (ev.groupIdx + 1) * GROUP_LABEL_H - 2
      : (ev.row + 1) * ROW_HEIGHT - 4;
  }
  function absTrackMidY(): number { return sharedTrackMidY; }

  function bracketWidthPct(w: number): string {
    return `${Math.max(w, 3 / timelineWidth * 100)}%`;
  }

  // ── Zoom / pan interaction ────────────────────────────────────────────────
  // These are plain vars (not $state) — read in event handlers, not in template.
  let _dragStartX    = 0;
  let _dragViewStart = 0;
  let _dragViewRange = 0;
  let _dragDist      = 0;   // distance moved; checked in navigate() to suppress post-drag clicks

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    _dragStartX    = e.clientX;
    _dragViewStart = viewStart;
    _dragViewRange = viewRange;
    _dragDist      = 0;
    isDragging     = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    _dragDist = Math.abs(e.clientX - _dragStartX);
    if (_dragDist < 4) return;
    const deltaPct = -(e.clientX - _dragStartX) / timelineWidth * _dragViewRange;
    const newStart = Math.max(0, Math.min(100 - _dragViewRange, _dragViewStart + deltaPct));
    viewStart = newStart;
    viewEnd   = newStart + _dragViewRange;
  }

  function handlePointerUp() { isDragging = false; }

  // Ignore gestures within ~20° of horizontal (tan 20° ≈ 0.36) so a trackpad
  // horizontal swipe doesn't accidentally zoom. Everything else zooms.
  const HORIZ_DEAD_SLOPE = Math.tan(20 * Math.PI / 180);

  function handleWheel(e: WheelEvent) {
    const adx = Math.abs(e.deltaX);
    const ady = Math.abs(e.deltaY);
    if (adx > 0 && ady < adx * HORIZ_DEAD_SLOPE) return; // too horizontal — ignore
    e.preventDefault();
    const dy = ady >= adx ? e.deltaY : e.deltaX;
    if (dy === 0) return;
    const gutter = hasGroups ? GROUP_GUTTER : ZOOM_GUTTER;
    const rect       = (e.currentTarget as Element).getBoundingClientRect();
    const cursorFrac = Math.max(0, Math.min(1, (e.clientX - rect.left - gutter) / timelineWidth));
    const cursorData = viewStart + cursorFrac * viewRange;
    const factor     = dy > 0 ? 1.2 : 1 / 1.2;
    const newRange   = Math.max(MIN_RANGE, Math.min(100, viewRange * factor));
    let newStart     = cursorData - cursorFrac * newRange;
    let newEnd       = newStart + newRange;
    if (newStart < 0)   { newStart = 0;   newEnd = newRange; }
    if (newEnd   > 100) { newEnd = 100; newStart = 100 - newRange; }
    viewStart = newStart;
    viewEnd   = newEnd;
  }

  function resetView() { viewStart = 0; viewEnd = 100; }

  function zoomIn() {
    const center = (viewStart + viewEnd) / 2;
    const newRange = Math.max(MIN_RANGE, viewRange / 1.5);
    viewStart = Math.max(0, center - newRange / 2);
    viewEnd   = Math.min(100, viewStart + newRange);
    viewStart = viewEnd - newRange;
  }

  function zoomOut() {
    const center = (viewStart + viewEnd) / 2;
    const newRange = Math.min(100, viewRange * 1.5);
    viewStart = Math.max(0, center - newRange / 2);
    viewEnd   = Math.min(100, viewStart + newRange);
    viewStart = viewEnd - newRange;
    if (viewStart < 0) { viewStart = 0; viewEnd = newRange; }
  }

  function goToStart() {
    // Pan so the first event marker is visible
    const firstPct = baseEvents.length > 0
      ? Math.min(...baseEvents.map(e => e.dataPct))
      : 0;
    if (firstPct < viewStart || firstPct > viewEnd) {
      viewStart = Math.max(0, firstPct - viewRange * 0.1);
      viewEnd   = viewStart + viewRange;
    }
    onstart?.();
  }

  function goToEnd() {
    // Pan so the last event marker is visible
    const lastPct = baseEvents.length > 0
      ? Math.max(...baseEvents.map(e => e.dataPct))
      : 100;
    if (lastPct < viewStart || lastPct > viewEnd) {
      viewEnd   = Math.min(100, lastPct + viewRange * 0.1);
      viewStart = viewEnd - viewRange;
    }
    onend?.();
  }

  // Only navigate if the pointer didn't travel far (distinguishes click from drag-release over a button)
  function navigate(index: number) {
    if (_dragDist < 4) onnavigate(index);
  }

  function handleKeydown(e: KeyboardEvent, index: number) {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onnavigate(index); }
  }

  function handleLabelHover(e: MouseEvent | FocusEvent) {
    const btn = e.currentTarget as HTMLElement;
    const container = btn.closest<HTMLElement>('.tl-nav__content');
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    const bRect = btn.getBoundingClientRect();
    const centerX = (bRect.left + bRect.right) / 2;
    // A truncated label (scrollWidth > clientWidth) may expand up to 400px on hover.
    // A short label that isn't truncated won't grow beyond its current width.
    const isTruncated = btn.scrollWidth > Math.ceil(btn.clientWidth);
    const expandedHalf = isTruncated ? 200 : Math.ceil(bRect.width / 2);
    const leftOverflow  = cRect.left + expandedHalf - centerX;
    const rightOverflow = centerX + expandedHalf - cRect.right;
    const shift = leftOverflow > 0 ? leftOverflow : rightOverflow > 0 ? -rightOverflow : 0;
    btn.style.setProperty('--hover-shift', `${Math.round(shift)}px`);
  }

  // When activeIndex changes, pan viewport so the active marker is visible
  let _panAnimId: number | null = null;
  $effect(() => {
    const idx = activeIndex;
    const ev = baseEvents.find(e => e.index === idx);
    if (!ev) return;

    const [vs, ve, vr, zoomed] = untrack(() => [viewStart, viewEnd, viewRange, isZoomed]);
    if (!zoomed) return;

    const margin = vr * 0.08;
    if (ev.dataPct >= vs + margin && ev.dataPct <= ve - margin) return;

    let targetStart = ev.dataPct - vr / 2;
    let targetEnd   = targetStart + vr;
    if (targetStart < 0)   { targetStart = 0;         targetEnd = vr; }
    if (targetEnd   > 100) { targetEnd   = 100; targetStart = 100 - vr; }

    if (_panAnimId !== null) cancelAnimationFrame(_panAnimId);

    if (prefersReducedMotion()) {
      viewStart = targetStart;
      viewEnd   = targetEnd;
      return;
    }

    const t0 = performance.now();
    const fromStart = vs;
    const fromEnd   = ve;
    const DURATION  = 350;
    function easeOut(t: number) { return 1 - (1 - t) ** 3; }

    isPanning = true;
    function tick(now: number) {
      const t = Math.min(1, (now - t0) / DURATION);
      const e = easeOut(t);
      viewStart = fromStart + (targetStart - fromStart) * e;
      viewEnd   = fromEnd   + (targetEnd   - fromEnd)   * e;
      if (t < 1) {
        _panAnimId = requestAnimationFrame(tick);
      } else {
        _panAnimId = null;
        isPanning = false;
      }
    }
    _panAnimId = requestAnimationFrame(tick);
  });

  // When activeIndex changes, follow focus to the new label button (if focus is already in the nav)
  let navEl: HTMLElement;
  $effect(() => {
    const idx = activeIndex;
    if (navEl?.contains(document.activeElement)) {
      navEl.querySelector<HTMLElement>(`[data-nav-index="${idx}"]`)?.focus();
    }
  });
</script>

<nav
  class="tl-nav"
  class:tl-nav--dragging={isDragging}
  class:tl-nav--panning={isPanning}
  style="height: {navHeight}px;"
  aria-label={getMessage(tl, 'timeline.label')}
  bind:this={navEl}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={handlePointerUp}
  onwheel={handleWheel}
>
  <h2 class="tl-sr-only">{getMessage(tl, 'timeline.label')}</h2>

  <!-- Grip handle — drag to expand/collapse label rows; click to toggle -->
  <button
    class="tl-nav__handle"
    aria-expanded={displayRows > 0}
    aria-label={displayRows > 0 ? 'Collapse timeline labels' : 'Expand timeline labels'}
    onclick={handleGripClick}
    onpointerdown={handleGripDown}
    onpointermove={handleGripMove}
    onpointerup={handleGripUp}
    onpointercancel={handleGripUp}
  ><span class="tl-nav__grip" aria-hidden="true"></span></button>

  <!-- Body — sits below the grip strip -->
  <div class="tl-nav__body" style="top: {HANDLE_H}px;">

  <div class="tl-nav__zoom-controls" style="width: {controlGutter}px; height: {contentHeight}px;" role="group" aria-label="Timeline controls" onpointerdown={(e) => e.stopPropagation()}>
    {#if displayRows === 0}
      <button class="tl-nav__zoom-btn" onclick={goToStart} aria-label="Go to beginning" title="Beginning">⏮︎</button>
      <button class="tl-nav__zoom-btn" onclick={goToEnd} aria-label="Go to end" title="End">⏭︎</button>
    {:else}
      {#if !compact}<button class="tl-nav__zoom-btn" onclick={goToStart} aria-label="Go to beginning" title="Beginning">⏮︎</button>{/if}
      <button class="tl-nav__zoom-btn" onclick={zoomIn}  aria-label="Zoom in"  title="Zoom in"  disabled={viewRange <= MIN_RANGE}>+</button>
      <button class="tl-nav__zoom-btn" onclick={zoomOut} aria-label="Zoom out" title="Zoom out" disabled={!isZoomed}>−</button>
      {#if !compact}<button class="tl-nav__zoom-btn" onclick={goToEnd} aria-label="Go to end" title="End">⏭︎</button>{/if}
    {/if}
  </div>

  <!-- Group label bands — full width, gutter holds the group name -->
  {#if hasGroups}
    {#each groupBands as band}
      <div
        class="tl-nav__group-band"
        class:tl-nav__group-band--alt={band.isEven}
        style="top: {band.yBase}px; height: {GROUP_LABEL_H}px;"
        aria-hidden="true"
      >
        {#if band.label}
          <span class="tl-nav__group-name">{band.label}</span>
        {/if}
      </div>
    {/each}
  {/if}

  <!-- Timeline content area — offset right of gutter when groups are present -->
  <div
    class="tl-nav__content"
    style="left: {hasGroups ? GROUP_GUTTER : controlGutter}px; bottom: {AXIS_H}px;"
    bind:clientWidth={timelineWidth}
  >
    {#if displayRows > 0}
    <!-- Leader lines — hit area + visual -->
    <svg class="tl-nav__leaders" aria-hidden="true">
      {#each positioned as ev}
        {@const x1=`${ev.labelCenterPct}%`}
        {@const y1=absRowBottomY(ev)}
        {@const x2=`${ev.screenPct}%`}
        {@const y2=absTrackMidY()}
        <!-- Wide transparent hit area so clicking anywhere along the line works -->
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <line
          {x1} {y1} {x2} {y2}
          class="tl-nav__leader-hit"
          role="presentation"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={() => onnavigate(ev.index)}
        />
        <!-- Visual line -->
        <line
          {x1} {y1} {x2} {y2}
          class="tl-nav__leader"
          class:tl-nav__leader--active={ev.index === activeIndex}
        />
      {/each}
    </svg>

    <!-- Label buttons (primary keyboard / screen-reader targets) -->
    {#each positioned as ev}
      {@const isActive = ev.index === activeIndex}
      <button
        class="tl-nav__label"
        class:tl-nav__label--active={isActive}
        style="left: {ev.labelCenterPct}%; top: {absRowCenterY(ev)}px;"
        data-nav-index={ev.index}
        aria-current={isActive ? 'true' : undefined}
        aria-label={ev.ariaLabel}
        onpointerdown={(e) => e.stopPropagation()}
        onmouseenter={handleLabelHover}
        onfocus={handleLabelHover}
        onclick={() => onnavigate(ev.index)}
        onkeydown={(e) => handleKeydown(e, ev.index)}
      >{ev.label}</button>
    {/each}

    {/if}

    <!-- Single shared track — all events regardless of group -->
    <div class="tl-nav__track" style="top: {sharedTrackTop}px; height: {TRACK_AREA}px;">
      {#each positioned as ev}
        {#if !ev.isDuration}
          <button
            class="tl-nav__dot"
            class:tl-nav__dot--active={ev.index === activeIndex}
            style="left: {ev.screenPct}%;"
            tabindex="-1"
            aria-hidden="true"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => onnavigate(ev.index)}
          ></button>
        {/if}
      {/each}

      <!-- Span bars: I-beam on the track line for duration events (visible at all drawer heights) -->
      {#each positioned as ev}
        {#if ev.isDuration}
          <button
            class="tl-nav__span-bar"
            class:tl-nav__span-bar--active={ev.index === activeIndex}
            style="left: {ev.screenStartPct}%; width: {bracketWidthPct(ev.screenWidthPct!)};"
            tabindex="-1"
            aria-hidden="true"
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => onnavigate(ev.index)}
          ></button>
        {/if}
      {/each}

    </div>
  </div>

  <div
    class="tl-nav__axis-strip"
    style="left: {hasGroups ? GROUP_GUTTER : controlGutter}px; height: {AXIS_H}px; --tl-axis-track-offset: {Math.round(TRACK_AREA / 2)}px;"
    aria-hidden="true"
  >
    {#each axisTicks as { screenPct, label, edge }}
      <div
        class="tl-nav__axis-tick"
        class:tl-nav__axis-tick--edge-start={edge === 'start'}
        class:tl-nav__axis-tick--edge-end={edge === 'end'}
        style="left: {screenPct}%"
      >
        <span class="tl-nav__axis-label">{label}</span>
      </div>
    {/each}
    {#if !hasGroups}
      <div class="tl-nav__minimap">
        <div class="tl-nav__minimap-thumb" style="left: {viewStart}%; width: {viewRange}%;"></div>
      </div>
    {/if}
  </div>

  </div><!-- end tl-nav__body -->
</nav>

<style>
  .tl-nav {
    background: var(--tl-color-nav-bg);
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
    transition: height 0.2s ease;
  }

  .tl-sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }

  /* Grip strip — full-width button at the top of the nav */
  .tl-nav__handle {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 14px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    padding: 0;
    cursor: ns-resize;
    touch-action: none;
  }
  .tl-nav__handle:focus-visible {
    outline: 2px solid var(--tl-color-accent);
    outline-offset: -2px;
  }
  .tl-nav__grip {
    width: 32px;
    height: 3px;
    border-radius: 2px;
    background: var(--tl-color-nav-marker);
    opacity: 0.2;
    transition: opacity var(--tl-transition-speed) ease;
  }
  .tl-nav__handle:hover .tl-nav__grip,
  .tl-nav__handle:focus-visible .tl-nav__grip { opacity: 0.5; }

  /* Body — all nav content sits below the grip strip */
  .tl-nav__body {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    overflow: hidden;
  }

  .tl-nav--dragging { cursor: grabbing; }

  /* During drag/pan everything must track instantly — no lag from transitions */
  .tl-nav--dragging .tl-nav__label,
  .tl-nav--dragging .tl-nav__dot,
  .tl-nav--dragging .tl-nav__leader,
  .tl-nav--dragging .tl-nav__leader-hit,
  .tl-nav--panning .tl-nav__label,
  .tl-nav--panning .tl-nav__dot,
  .tl-nav--panning .tl-nav__leader,
  .tl-nav--panning .tl-nav__leader-hit { transition: none; }

  /* Group label bands */
  .tl-nav__group-band {
    position: absolute;
    left: 0;
    right: 0;
    border-bottom: 1px solid var(--tl-color-border, rgba(0,0,0,0.08));
    pointer-events: none;
  }
  .tl-nav__group-band--alt { background: rgba(0,0,0,0.03); }
  .tl-nav__group-name {
    position: absolute;
    top: 50%;
    left: 6px;
    right: calc(100% - 72px + 4px); /* stays in the gutter */
    transform: translateY(-50%);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--tl-color-text-muted);
    opacity: 0.55;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
  }

  /* Timeline content area — shifted right of the gutter when groups present */
  .tl-nav__content {
    position: absolute;
    top: 0;
    right: 0;
    overflow: hidden;
  }

  /* Axis strip — below the shared track */
  .tl-nav__axis-strip {
    position: absolute;
    right: 0;
    bottom: 0;
    padding-bottom: 4px;
    overflow: visible;
    z-index: 2;
    /* height set via inline style */
  }

/* Zoom controls — column of buttons pinned to the left edge; width+height set by inline style */
  .tl-nav__zoom-controls {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    z-index: 10;
    background: var(--tl-color-nav-bg);
    border-right: 1px solid var(--tl-color-border, rgba(0,0,0,0.1));
  }

  .tl-nav__zoom-btn {
    background: none;
    border: none;
    padding: 0;
    width: 28px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    font-size: 0.85rem;
    line-height: 1;
    color: var(--tl-color-text-muted);
    border-radius: 3px;
    transition: background var(--tl-transition-speed) ease, color var(--tl-transition-speed) ease;
  }
  .tl-nav__zoom-btn:hover:not(:disabled) { background: var(--tl-color-border, rgba(0,0,0,0.08)); color: var(--tl-color-text); }
  .tl-nav__zoom-btn:disabled { opacity: 0.3; cursor: default; }

  /* Leader lines */
  .tl-nav__leaders {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .tl-nav__leader-hit {
    stroke: transparent;
    stroke-width: 12;
    pointer-events: stroke;
    cursor: pointer;
    fill: none;
    transition: x1 0.3s ease, y1 0.3s ease, x2 0.3s ease, y2 0.3s ease;
  }

  .tl-nav__leader {
    stroke: var(--tl-color-nav-marker);
    stroke-width: 1;
    opacity: 0.5;
    pointer-events: none;
    transition: x1 0.3s ease, y1 0.3s ease, x2 0.3s ease, y2 0.3s ease,
                opacity var(--tl-transition-speed) ease;
  }

  .tl-nav__leader--active {
    stroke: var(--tl-color-nav-marker-active);
    opacity: 0.8;
  }

  /* Label buttons */
  .tl-nav__label {
    position: absolute;
    transform: translate(-50%, -50%);
    background: var(--tl-color-nav-bg);
    border: none;
    border-radius: 3px;
    box-shadow: 0 0 0 1px var(--tl-color-border, rgba(0,0,0,0.12));
    padding: 1px 4px;
    cursor: pointer;
    color: var(--tl-color-nav-marker);
    font-size: var(--tl-nav-label-size, 0.72rem);
    white-space: nowrap;
    max-width: 130px;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    transition: left 0.3s ease, top 0.3s ease,
                color var(--tl-transition-speed) ease,
                max-width 0.18s ease;
    z-index: 1;
  }

  .tl-nav__label:hover,
  .tl-nav__label:focus-visible {
    color: var(--tl-color-nav-marker-hover);
    outline: none;
    max-width: 400px;
    overflow: visible;
    z-index: 10;
    box-shadow: 0 0 0 3px var(--tl-color-nav-bg);
    transform: translate(calc(-50% + var(--hover-shift, 0px)), -50%);
  }

  .tl-nav__label:focus-visible {
    outline: 2px solid var(--tl-color-accent);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .tl-nav__label--active {
    color: var(--tl-color-nav-marker-active);
    font-weight: 600;
    max-width: 130px;
    z-index: 2;
  }

  /* Span bars — compact I-beam on the track line, always visible for duration events */
  .tl-nav__span-bar {
    position: absolute;
    top: 50%;
    height: 10px;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    border-left:  2px solid var(--tl-color-nav-marker);
    border-right: 2px solid var(--tl-color-nav-marker);
    padding: 0;
    cursor: pointer;
    opacity: .75;
    box-sizing: border-box;
    appearance: none;
    -webkit-appearance: none;
    transition: opacity var(--tl-transition-speed) ease,
                border-color var(--tl-transition-speed) ease;
  }
  .tl-nav__span-bar::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--tl-color-nav-marker);
    transform: translateY(-50%);
    transition: background var(--tl-transition-speed) ease;
  }
  .tl-nav__span-bar:hover { opacity: 0.75; }
  .tl-nav__span-bar--active {
    border-color: var(--tl-color-nav-marker-active);
    opacity: 1;
  }
  .tl-nav__span-bar--active::before { background: var(--tl-color-nav-marker-active); }

  /* Track area */
  .tl-nav__track {
    position: absolute;
    left: 0;
    right: 0;
  }

  .tl-nav__track::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 2%;
    right: 2%;
    height: 1px;
    background: var(--tl-color-nav-marker);
    opacity: 0.4;
    transform: translateY(-50%);
  }

  /* Point-event dots — padding + background-clip extends the hit area without changing the visual */
  .tl-nav__dot {
    transition: left 0.3s ease,
                transform var(--tl-transition-speed) ease,
                background var(--tl-transition-speed) ease;
    position: absolute;
    top: 50%;
    width: var(--tl-nav-marker-size, .25px);
    height: var(--tl-nav-marker-size, .25px);
    box-sizing: content-box;
    padding: 6px;
    background-clip: content-box;
    border-radius: 50%;
    background: var(--tl-color-nav-marker);
    transform: translate(-50%, -50%);
    border: none;
    cursor: pointer;
  }

  .tl-nav__dot--active {
    background: var(--tl-color-nav-marker-active);
    transform: translate(-50%, -50%) scale(1.4);
  }

  /* Axis ticks — anchored to the bottom of the track, above the minimap */
  .tl-nav__axis-tick {
    position: absolute;
    top: calc(-1 * var(--tl-axis-track-offset) + 2px);
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    z-index: 1;
  }

  .tl-nav__axis-tick--edge-start {
    transform: translateX(0);
    align-items: flex-start;
  }

  .tl-nav__axis-tick--edge-end {
    transform: translateX(-100%);
    align-items: flex-end;
  }

  .tl-nav__axis-tick::before {
    content: '';
    display: block;
    width: 1px;
    height: calc(var(--tl-axis-track-offset) - 4px);
    background: var(--tl-color-nav-marker);
    opacity: 0.5;
    margin-bottom: 2px;
  }

  .tl-nav__axis-label {
    display: block;
    font-size: 0.65rem;
    color: var(--tl-color-text-muted);
    white-space: nowrap;
    line-height: 1;
    font-feature-settings: "tnum";
  }

  /* Minimap strip — full width = full data range; thumb = visible viewport */
  .tl-nav__minimap {
    position: absolute;
    bottom: 2px;
    left: 0;
    right: 0;
    height: 4px;
    background: var(--tl-color-nav-marker);
    opacity: 0.15;
    z-index: 0;
  }

  .tl-nav__minimap-thumb {
    position: absolute;
    inset-block: 0;
    background: var(--tl-color-nav-marker-active);
    opacity: 0.7;
  }

  /* Restore pointer cursor on all interactive children */
  .tl-nav__label,
  .tl-nav__dot { cursor: pointer; }
</style>
