<script lang="ts">
  interface Props {
    year: number | '';
    month: number | '';
    day: number | '';
    hour?: number | '';
    minute?: number | '';
    second?: number | '';
    required?: boolean;
    idPrefix: string;
    onchange: () => void;
  }

  let {
    year = $bindable(),
    month = $bindable(),
    day = $bindable(),
    hour = $bindable(''),
    minute = $bindable(''),
    second = $bindable(''),
    required = false,
    idPrefix,
    onchange,
  }: Props = $props();

  let showTime = $state(hour !== '' || minute !== '' || second !== '');

  function toggleTime() {
    showTime = !showTime;
    if (!showTime) {
      hour = '';
      minute = '';
      second = '';
      onchange();
    }
  }
</script>

<div class="date-fields">
  <div class="date-row">
    <div class="date-field date-field--year">
      <label for="{idPrefix}-year">Year{required ? ' *' : ''}</label>
      <input
        id="{idPrefix}-year"
        type="number"
        bind:value={year}
        oninput={onchange}
        min="-13800000000"
        max="9999"
        step="1"
      />
    </div>
    <div class="date-field">
      <label for="{idPrefix}-month">Month</label>
      <input
        id="{idPrefix}-month"
        type="number"
        bind:value={month}
        oninput={onchange}
        min="1"
        max="12"
        step="1"
      />
    </div>
    <div class="date-field">
      <label for="{idPrefix}-day">Day</label>
      <input
        id="{idPrefix}-day"
        type="number"
        bind:value={day}
        oninput={onchange}
        min="1"
        max="31"
        step="1"
      />
    </div>
  </div>

  {#if showTime}
    <div class="date-row date-row--time">
      <div class="date-field">
        <label for="{idPrefix}-hour">Hour</label>
        <input
          id="{idPrefix}-hour"
          type="number"
          bind:value={hour}
          oninput={onchange}
          min="0"
          max="23"
          step="1"
        />
      </div>
      <div class="date-field">
        <label for="{idPrefix}-minute">Min</label>
        <input
          id="{idPrefix}-minute"
          type="number"
          bind:value={minute}
          oninput={onchange}
          min="0"
          max="59"
          step="1"
        />
      </div>
      <div class="date-field">
        <label for="{idPrefix}-second">Sec</label>
        <input
          id="{idPrefix}-second"
          type="number"
          bind:value={second}
          oninput={onchange}
          min="0"
          max="59"
          step="1"
        />
      </div>
    </div>
  {/if}

  <button type="button" class="time-toggle" onclick={toggleTime}>
    {showTime ? '− Remove time' : '+ Add time'}
  </button>
</div>

<style>
  .date-fields {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .date-row {
    display: flex;
    gap: 0.4rem;
    align-items: flex-end;
    flex-wrap: nowrap;
  }

  .date-row--time { padding-top: 0.15rem; }

  .date-field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: none;
  }

  .date-field label {
    font-size: 0.7rem;
    color: #888;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .date-field input {
    border: 1px solid #d4d4d4;
    border-radius: 4px;
    padding: 0.35rem 0.4rem;
    font-size: 0.9rem;
    font-family: inherit;
    box-sizing: border-box;
    transition: border-color 0.15s;
    background: #fff;
    /* hide spinners to reclaim space */
    appearance: textfield;
    -moz-appearance: textfield;
  }

  .date-field--year input { width: calc(7ch + 0.8rem); }
  .date-field:not(.date-field--year) input { width: calc(2ch + 0.8rem); }

  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button { display: none; }

  .date-field input:focus {
    outline: none;
    border-color: #13a4df;
    box-shadow: 0 0 0 2px rgba(19, 164, 223, 0.2);
  }

  .time-toggle {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.75rem;
    color: #888;
    cursor: pointer;
    text-align: left;
    width: fit-content;
    transition: color 0.15s;
  }
  .time-toggle:hover { color: #df4e13; }
</style>
