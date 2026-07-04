<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';

  interface DateDraft {
    year: number | '';
    month: number | '';
    day: number | '';
    hour: number | '';
    minute: number | '';
    second: number | '';
  }

  interface Props {
    year: number | '';
    month: number | '';
    day: number | '';
    hour?: number | '';
    minute?: number | '';
    second?: number | '';
    onchange: () => void;
    onconfirm?: () => void;
    ondraftchange?: (draft: DateDraft) => void;
  }

  let {
    year = $bindable(),
    month = $bindable(),
    day = $bindable(),
    hour = $bindable(''),
    minute = $bindable(''),
    second = $bindable(''),
    onchange,
    onconfirm,
    ondraftchange,
  }: Props = $props();

  let yearInputEl: HTMLInputElement | null = null;

  // ── Pending state — updated freely while picker is open ────────────────────
  // Committed values (bindable props) only update on Done.
  let _year   = $state<number | ''>(year);
  let _month  = $state<number | ''>(month);
  let _day    = $state<number | ''>(day);
  let _hour   = $state<number | ''>(hour ?? '');
  let _minute = $state<number | ''>(minute ?? '');
  let _second = $state<number | ''>(second ?? '');

  let showTime = $state(hour !== '' || minute !== '' || second !== '');
  let timeInput = $state(''); // initialised properly in open() / makeTimeStr() below

  // 24-hour time validation: HH:MM or HH:MM:SS
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
  const timeValid = $derived(!timeInput.trim() || TIME_RE.test(timeInput.trim()));

  // Calendar navigation
  let navYear  = $state(untrack(() => _year  !== '' ? Number(_year)  : new Date().getFullYear()));
  let navMonth = $state(untrack(() => _month !== '' ? Number(_month) : new Date().getMonth() + 1));
  let showDayCalendar = $state(untrack(() => _month !== ''));

  const isCalendarYear = $derived(_year !== '' && Number(_year) >= 1 && Number(_year) <= 9999);

  // ── Calendar ────────────────────────────────────────────────────────────────
  const MONTH_NAMES = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                       'Jul','Aug','Sep','Oct','Nov','Dec'];

  function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
  function firstWeekday(y: number, m: number) { return new Date(y, m - 1, 1).getDay(); }

  const calGrid = $derived.by((): (number | null)[] => {
    const fd = firstWeekday(navYear, navMonth);
    const dim = daysInMonth(navYear, navMonth);
    const cells: (number | null)[] = Array(fd).fill(null);
    for (let d = 1; d <= dim; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  });

  // ── Time input ──────────────────────────────────────────────────────────────
  function makeTimeStr() {
    if (_hour === '' && _minute === '') return '';
    const h = String(Number(_hour)).padStart(2, '0');
    const m = String(Number(_minute)).padStart(2, '0');
    const s = _second !== '' ? `:${String(Number(_second)).padStart(2, '0')}` : '';
    return `${h}:${m}${s}`;
  }
  // timeInput is declared earlier; set its initial value now that makeTimeStr is defined
  timeInput = makeTimeStr();

  function onTimeInput(v: string) {
    timeInput = v;
    const p = v.split(':');
    const h = parseInt(p[0]); const m = parseInt(p[1]); const s = parseInt(p[2]);
    _hour   = !isNaN(h) && h >= 0 && h <= 23 ? h : '';
    _minute = !isNaN(m) && m >= 0 && m <= 59 ? m : '';
    _second = !isNaN(s) && s >= 0 && s <= 59 ? s : '';
  }

  // ── Actions ─────────────────────────────────────────────────────────────────
  function syncFromCommitted() {
    _year = year; _month = month; _day = day;
    _hour = hour ?? ''; _minute = minute ?? ''; _second = second ?? '';
    navYear  = _year  !== '' ? Number(_year)  : new Date().getFullYear();
    navMonth = _month !== '' ? Number(_month) : new Date().getMonth() + 1;
    showDayCalendar = _month !== '';
    showTime = _hour !== '' || _minute !== '' || _second !== '';
    timeInput = makeTimeStr();
  }

  async function focusYear() {
    await tick();
    yearInputEl?.focus();
    yearInputEl?.select();
  }

  syncFromCommitted();
  onMount(() => {
    void focusYear();
  });

  export function commit() {
    year = _year; month = _month; day = _day;
    hour = _hour; minute = _minute; second = _second;
    onchange();
  }

  $effect(() => {
    ondraftchange?.({
      year: _year,
      month: _month,
      day: _day,
      hour: _hour,
      minute: _minute,
      second: _second,
    });
  });

  function onYearInput(v: string) {
    _year = v === '' ? '' : Number(v);
    if (_year !== '') {
      navYear = Number(_year);
      if (!isCalendarYear) {
        _month = ''; _day = ''; _hour = ''; _minute = ''; _second = '';
        showDayCalendar = false;
      }
    }
  }

  function pickMonth(m: number) {
    navMonth = m; _month = m; showDayCalendar = true;
    if (_day !== '' && Number(_day) > daysInMonth(navYear, m)) _day = '';
  }

  function pickDay(d: number) {
    if (_day === d && _month === navMonth) { _day = ''; return; }
    _month = navMonth; _day = d;
  }

  function navPrev() { if (navMonth === 1) { navMonth = 12; navYear--; } else navMonth--; }
  function navNext() { if (navMonth === 12) { navMonth = 1; navYear++; } else navMonth++; }

  function stepBack() {
    if (showDayCalendar) {
      _day = '';
      _hour = '';
      _minute = '';
      _second = '';
      showTime = false;
      timeInput = '';
      showDayCalendar = false;
    } else {
      _month = '';
      _day = '';
      _hour = '';
      _minute = '';
      _second = '';
      showTime = false;
      timeInput = '';
    }
  }

</script>

<div class="dp-wrap">
  <div class="dp">

      <!-- Year -->
      <div class="dp-year-row">
        <input
          bind:this={yearInputEl}
          class="dp-year"
          type="number"
          placeholder="Year"
          value={_year === '' ? '' : _year}
          oninput={(e) => onYearInput((e.target as HTMLInputElement).value)}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
              onconfirm?.();
            }
          }}
          min="-13800000000" max="9999"
        />
        {#if _year !== '' && !isCalendarYear}
          <span class="dp-note">BCE / cosmological</span>
        {/if}
      </div>

      {#if _year !== ''}
        {#if isCalendarYear}
          {#if !showDayCalendar}
            <!-- Month grid -->
            <div class="dp-month-grid">
              {#each MONTH_SHORT as name, i}
                <button type="button" class="dp-month-btn"
                  class:dp-month-btn--sel={Number(_month) === i + 1}
                  onclick={() => pickMonth(i + 1)}>{name}</button>
              {/each}
            </div>
          {:else}
            <!-- Day calendar -->
            <div class="dp-cal">
              <div class="dp-cal-header">
                <button type="button" class="dp-nav-btn" onclick={navPrev} aria-label="Previous month">‹</button>
                <span class="dp-cal-label">{MONTH_NAMES[navMonth - 1]} {navYear}</span>
                <button type="button" class="dp-nav-btn" onclick={navNext} aria-label="Next month">›</button>
              </div>
              <div class="dp-cal-grid">
                {#each ['Su','Mo','Tu','We','Th','Fr','Sa'] as wd}
                  <span class="dp-weekday">{wd}</span>
                {/each}
                {#each calGrid as cell}
                  {#if cell === null}
                    <span></span>
                  {:else}
                    <button type="button" class="dp-day"
                      class:dp-day--selected={Number(_day) === cell && Number(_month) === navMonth}
                      onclick={() => pickDay(cell)}>{cell}</button>
                  {/if}
                {/each}
              </div>
            </div>

            {#if _day !== ''}
              {#if !showTime}
                <button type="button" class="dp-text-btn" onclick={() => (showTime = true)}>+ Add time</button>
              {:else}
                <div class="dp-time-field">
                  <div class="dp-time-row">
                    <label class="dp-time-input-wrap">
                      <span class="dp-time-label">Time <span class="dp-time-format">(24-hour)</span></span>
                      <input class="dp-time-text" class:dp-time-text--error={timeInput && !timeValid}
                        type="text"
                        value={timeInput}
                        oninput={(e) => onTimeInput((e.target as HTMLInputElement).value)} />
                      {#if timeInput && !timeValid}
                        <p class="dp-time-error">Use HH:MM (00:00–23:59) or HH:MM:SS</p>
                      {:else}
                        <p class="dp-time-hint">e.g. 14:30 or 09:15:00</p>
                      {/if}
                    </label>
                    <button type="button" class="dp-text-btn dp-text-btn--muted" onclick={() => {
                      showTime = false; _hour = ''; _minute = ''; _second = ''; timeInput = '';
                    }}>× Remove</button>
                  </div>
                </div>
              {/if}
            {/if}

            <button type="button" class="dp-text-btn dp-text-btn--muted" onclick={stepBack}>
              ← {showDayCalendar ? 'Back to month only' : 'Back to year only'}
            </button>
          {/if}
        {:else}
          <!-- BCE / cosmological: manual month/day -->
          <div class="dp-manual-row">
            <label class="dp-manual-label">Month
              <input type="number" class="dp-manual-input" bind:value={_month} min="1" max="12" placeholder="–" />
            </label>
            <label class="dp-manual-label">Day
              <input type="number" class="dp-manual-input" bind:value={_day} min="1" max="31" placeholder="–" />
            </label>
          </div>
        {/if}
      {/if}

    </div>
</div>

<style>
  .dp-wrap { display: flex; flex-direction: column; gap: 0.4rem; }

  /* ── Picker shell ──────────────────────────────────────────────── */
  .dp {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.75rem;
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    background: #fff;
    max-width: 260px;
  }

  /* ── Year ──────────────────────────────────────────────────────── */
  .dp-year-row { display: flex; flex-direction: column; gap: 0.25rem; }
  .dp-year {
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.35rem 0.5rem;
    font-size: 0.9rem;
    font-family: inherit;
    width: 9ch;
    appearance: textfield;
    -moz-appearance: textfield;
    background: #fff;
  }
  .dp-year:focus { outline: none; border-color: #13a4df; box-shadow: 0 0 0 2px rgba(19,164,223,0.2); }
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button { display: none; }
  .dp-note { font-size: 0.72rem; color: #888; }

  /* ── Month grid ────────────────────────────────────────────────── */
  .dp-month-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }
  .dp-month-btn {
    padding: 0.35rem 0.25rem;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: normal;
    text-transform: none;
    margin-bottom: 0;
    background: #f5f5f5;
    border: 1px solid #e4e4e4;
    border-radius: 4px;
    cursor: pointer;
    text-align: center;
    color: #333;
  }
  .dp-month-btn:hover { background: #e8f4ff; border-color: #13a4df; color: #13a4df; }
  .dp-month-btn--sel { background: #e8f4ff; border-color: #13a4df; color: #13a4df; font-weight: 600; }

  /* ── Calendar ──────────────────────────────────────────────────── */
  .dp-cal { display: flex; flex-direction: column; gap: 0.3rem; }
  .dp-cal-header { display: flex; align-items: center; justify-content: space-between; gap: 0.25rem; }
  .dp-cal-label { font-size: 0.8rem; font-weight: 600; color: #1d1f21; flex: 1; text-align: center; }
  .dp-nav-btn {
    background: none;
    border: 1px solid #e4e4e4;
    border-radius: 3px;
    width: 24px; height: 24px;
    font-size: 0.95rem; line-height: 1;
    cursor: pointer; color: #666;
    display: flex; align-items: center; justify-content: center;
    padding: 0; margin-bottom: 0;
    font-weight: normal; text-transform: none;
  }
  .dp-nav-btn:hover { background: #f5f5f5; color: #1d1f21; }
  .dp-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
  .dp-weekday { font-size: 0.62rem; font-weight: 700; text-align: center; color: #aaa; padding: 0.1rem 0; }
  .dp-day {
    aspect-ratio: 1;
    font-size: 0.75rem;
    font-family: inherit;
    font-weight: normal;
    text-transform: none;
    margin-bottom: 0;
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
    text-align: center;
    padding: 0; color: #333;
    display: flex; align-items: center; justify-content: center;
  }
  .dp-day:hover { background: #e8f4ff; border-color: #13a4df; color: #13a4df; }
  .dp-day--selected { background: #13a4df !important; color: #fff !important; border-color: #13a4df !important; }

  /* ── Time ──────────────────────────────────────────────────────── */
  .dp-time-field { display: flex; flex-direction: column; gap: 0.25rem; }
  .dp-time-row { display: flex; align-items: flex-start; gap: 0.5rem; }
  .dp-time-input-wrap { display: flex; flex-direction: column; gap: 0.2rem; }
  .dp-time-label { font-size: 0.72rem; color: #666; display: block; }
  .dp-time-format { color: #aaa; }
  .dp-time-text {
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.3rem 0.5rem;
    font-size: 0.82rem;
    font-family: monospace;
    width: 9ch;
    background: #fff; color: #111;
  }
  .dp-time-text:focus { outline: none; border-color: #13a4df; box-shadow: 0 0 0 2px rgba(19,164,223,0.2); }
  .dp-time-text--error { border-color: #f87171; }
  .dp-time-text--error:focus { border-color: #f87171; box-shadow: 0 0 0 2px rgba(248,113,113,0.2); }
  .dp-time-hint { margin: 0; font-size: 0.68rem; color: #aaa; font-family: monospace; }
  .dp-time-error { margin: 0; font-size: 0.68rem; color: #b91c1c; }

  /* ── Manual (BCE) ──────────────────────────────────────────────── */
  .dp-manual-row { display: flex; gap: 0.75rem; }
  .dp-manual-label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; color: #888; }
  .dp-manual-input {
    border: 1px solid #d4d4d4; border-radius: 4px;
    padding: 0.3rem 0.4rem; font-size: 0.85rem; font-family: inherit;
    width: calc(3ch + 0.8rem);
    appearance: textfield; -moz-appearance: textfield; background: #fff;
  }
  .dp-manual-input:focus { outline: none; border-color: #13a4df; }
  .dp-text-btn {
    background: none; border: none; padding: 0;
    font-size: 0.75rem; color: #13a4df; cursor: pointer;
    font-family: inherit; font-weight: normal; text-transform: none; margin-bottom: 0;
  }
  .dp-text-btn:hover { text-decoration: underline; }
  .dp-text-btn--muted { color: #888; }
  .dp-text-btn--muted:hover { color: #444; }
</style>
