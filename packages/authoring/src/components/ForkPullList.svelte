<!--
  Reconciling a fork — [P12] and [P6] of docs/phase1-sync-conflicts.md.

  Deliberately a pull-list and not a merge screen. The published-backed
  timeline is the working document; the unmerged draft is a **source to pull
  from**, one slide — or one field — at a time, in whatever order makes sense.
  A merge screen would ask for every decision at once, and usually only one of
  them is the one that matters.

  Naming the two sides is most of the design, and this is the third attempt.
  "This timeline" against "your copy" read as the same thing. "Set aside" said
  where the edits were kept rather than what they were, and nobody could tell
  from it what a button would do. The two sides people actually hold in mind
  are **published** and **mine** — one is out in the world, the other is only
  here — so those are the words, in the column heads, in the row sentences and
  in both buttons: *Keep published*, *Keep mine*. "Take" is gone: it pointed
  in whichever direction the reader imagined they were standing.

  One imprecision, accepted: the left column says "Published" when strictly it
  is the working document, which is the published version plus anything typed
  since. Saying so exactly costs a clause on every row and buys nothing in the
  usual case, where nothing has been typed since.

  Every row shows what it is actually offering: field by field, both values
  side by side. A row that only said "Changed in your copy" could be counted
  but not evaluated, which is the whole difficulty of reconciling two versions
  of your own writing — they usually differ in one word.

  It is a centered panel rather than a side drawer because that comparison
  needs the width; a 26rem drawer could only ever show one value at a time.

  Each pull is a single USER_ORIGIN transaction, so Cmd-Z undoes it — which is
  what makes this panel safe to experiment with rather than a sequence of
  commitments. The list is recomputed after every pull, so a row disappears
  when it is satisfied and reappears if the pull is undone; nothing here
  tracks what was clicked.

  When the list empties the draft has done its job, and the panel offers to
  delete it. The whole panel points that way on purpose: an unmerged draft is
  a task, not an archive, and the words here never suggest there is value in
  keeping one around after its rows are answered. Left alive it becomes a
  document nobody remembers the purpose of, and — having no marks on it to say
  which parts were contested — one nobody could read usefully anyway.
-->
<script lang="ts">
  import { modalDialog } from '../lib/modalDialog.ts';
  import { SETTINGS_ID, TITLE_ID } from '../lib/threeWay.ts';
  import type { PullEntry } from '../lib/pullList.ts';

  interface Props {
    /**
     * Which question the panel is asking.
     *
     * `fork` — an unmerged draft, to sort out against the published version.
     * `incoming` — changes that arrived from another browser and are already
     * in the timeline, each of which can be put back the way it was.
     * `arrived` — the same, with nothing local at risk, so read-only.
     *
     * One component for all three: the comparison, the long-value stacking
     * and the per-field take are identical, and only the words differ. Two
     * components would be two places for those words to drift apart.
     */
    mode?: 'fork' | 'incoming' | 'arrived';
    entries: PullEntry[];
    /** Slides the draft holds that cannot be matched, so cannot be offered. */
    unmatchable: number;
    /** Still loading the draft's document out of its own database. */
    loading: boolean;
    onbring: (entry: PullEntry) => void;
    /** Keep one field of a row, leaving the rest of the slide alone ([P6]). */
    onbringfield: (entry: PullEntry, key: string) => void;
    /** Settle a row the other way: keep the published version, and stop offering it. */
    onkeephere: (entry: PullEntry) => void;
    /**
     * The same for one line. A fork row only — an incoming row has no
     * ancestor to record a decline in, and leaving it alone is already the
     * decision there.
     */
    onkeeppublishedfield?: (entry: PullEntry, key: string) => void;
    /** Delete the draft, offered only once it has nothing left to give. */
    onforget: () => void;
    /** Open the draft itself, to read it rather than pull from it. */
    onopenfork: () => void;
    onclose: () => void;
  }

  const {
    mode = 'fork', entries, unmatchable, loading,
    onbring, onbringfield, onkeephere, onkeeppublishedfield, onforget, onopenfork, onclose,
  }: Props = $props();

  /** Read-only: a fast-forward took nothing away, so there is nothing to put back. */
  const reading = $derived(mode === 'arrived');
  const fork = $derived(mode === 'fork');

  /**
   * The two sides, named the same way everywhere they appear.
   *
   * One pair of words for the column heads, the stacked-value tags and both
   * buttons: whatever a row says, it says it about *published* and *mine*.
   * In the incoming modes "mine" is the draft as it stood before the merge,
   * which is a moment rather than a document, so it says so.
   */
  const sides = $derived(
    fork
      ? { here: 'Published', theirs: 'My draft' }
      : { here: 'Published', theirs: 'Mine, before' },
  );

  /**
   * What this draft did to this slide, said as a whole sentence.
   *
   * A two-word tag ("Changed in your copy") has to be read against a side the
   * reader has to work out first. Naming both sides in the sentence costs a
   * line and settles it: what you did, and what is published.
   */
  function what(entry: PullEntry): string {
    if (fork) {
      if (entry.kind === 'added') return 'You added this; the published timeline does not have it.';
      if (entry.kind === 'removed') return 'You deleted this; the published timeline still has it.';
      return 'You changed this.';
    }
    // Inverted: the row carries the version from *before*, so a slide that
    // arrived is one this row would remove.
    if (entry.kind === 'removed') return 'This arrived; your draft did not have it.';
    if (entry.kind === 'added') return 'This was deleted in the other browser.';
    return 'This changed in the other browser.';
  }

  /**
   * The whole-slide choice, in the same two words as everything else.
   *
   * "Take all of it" asked the reader to work out where "it" was going; every
   * label here now names the version being kept instead of the direction it
   * travels. Where keeping yours means adding or deleting a whole slide, the
   * label says so outright — that is the part worth a second of warning.
   *
   * "Keep *all* of mine" on an edited row, because the field buttons below it
   * say "Keep mine" about one field each.
   */
  function action(entry: PullEntry): string {
    if (fork) {
      if (entry.kind === 'added') return 'Keep mine — add the slide';
      if (entry.kind === 'removed') return 'Keep mine — delete the slide';
      return 'Keep all of mine';
    }
    if (entry.kind === 'removed') return 'Keep mine — take the slide out';
    if (entry.kind === 'added') return 'Keep mine — put the slide back';
    return 'Keep all of mine';
  }

  /** The other way out, offered only on a fork row — see the markup for why. */
  function decline(entry: PullEntry): string {
    // Published has no slide to keep, so "keep published" would be a promise
    // about something that is not there.
    if (entry.kind === 'added') return 'Leave it out';
    if (entry.kind === 'removed') return 'Keep published — leave the slide in';
    // "All" because an edited row's lines each carry the same pair: this is
    // the one that answers every line still showing, in one click.
    return 'Keep all published';
  }

  /**
   * What the contested line is about, named rather than left to a pronoun.
   *
   * A row's heading is a headline, so "changed it too" could be read as the
   * headline rather than the slide — and two of these rows are not slides at
   * all.
   */
  function subject(entry: PullEntry): string {
    if (entry.id === SETTINGS_ID) return 'the settings';
    if (entry.id === TITLE_ID) return 'the title slide';
    return 'this slide';
  }
</script>

<!--
  The panel sits inside the backdrop, and the backdrop carries the dialog
  behaviour. As siblings, with the action on the panel, a click on the
  panel's own surface counted as "outside" — so dragging across a line of its
  prose to copy it dismissed the panel.
-->
<div
  class="backdrop"
  use:modalDialog={{ onclose }}
  role="dialog"
  aria-modal="true"
  aria-labelledby="pull-title"
  tabindex="-1"
>
<div class="panel">
  <div class="head">
    <h2 id="pull-title">
      {fork ? 'Sort out the differences' : 'What changed in your account'}
    </h2>
    <button class="close" onclick={onclose} aria-label="Close">×</button>
  </div>

  {#if loading}
    <p class="lede">Reading your draft…</p>
  {:else if entries.length}
    <!--
      Establishes the two sides — published, and mine — before any row,
      column head or button leans on them.
    -->
    {#if fork}
      <p class="lede">
        Your draft has {entries.length === 1 ? 'an edit' : `${entries.length} edits`} that never
        made it into the published timeline. Answer each one — keep what is published, or keep
        yours — and the draft is done. Keeping yours can be undone with Cmd-Z.
      </p>
    {:else if reading}
      <p class="lede">
        {entries.length === 1 ? 'This change was' : `These ${entries.length} changes were`}
        published from another browser and {entries.length === 1 ? 'is' : 'are'} in this timeline
        now. You had no unpublished edits of your own, so nothing of yours was touched.
      </p>
    {:else}
      <p class="lede">
        {entries.length === 1 ? 'This change arrived' : `These ${entries.length} changes arrived`}
        from another browser and {entries.length === 1 ? 'is' : 'are'} in this timeline now,
        alongside your own. Where you would rather have had your own, keep yours instead.
      </p>
    {/if}

    <ul class="rows">
      {#each entries as entry (entry.id)}
        <li class="row" class:row--contested={entry.contested}>
          <div class="row__head">
            <div class="row__text">
              <span class="row__label">{entry.label}</span>
              <span class="row__what">{what(entry)}</span>
              {#if entry.contested}
                <!--
                  The only rows that need a warning: the published timeline
                  changed the same thing, so the pull replaces rather than
                  fills a gap.
                -->
                <span class="row__cost">
                  The published timeline changed {subject(entry)} too — keeping yours replaces that.
                </span>
              {/if}
            </div>
            <!--
              Both ways out, together. With only "keep mine", a row you did
              not want was a dead end: it came back every time the list was
              computed, so the draft could never empty and the editor went on
              saying there was work to do.
            -->
            {#if !reading}
              <span class="row__acts">
                <button class="bring" onclick={() => onbring(entry)}>{action(entry)}</button>
                {#if fork}
                  <!--
                    Only a fork row needs settling. An incoming change is
                    already in the timeline, so leaving it alone *is* the
                    decision — there is nothing to record.
                  -->
                  <button class="keep" onclick={() => onkeephere(entry)}>{decline(entry)}</button>
                {/if}
              </span>
            {/if}
          </div>

          {#if entry.diffs?.length}
            <!--
              The comparison, which is the part that lets someone decide. Both
              values are shown even when one side is empty, because "nothing
              here" is a choice like any other — an em dash stands in for it.
            -->
            <div class="diff" role="table" aria-label={`Differences in ${entry.label}`}>
              <!--
                The column heads only describe rows that sit in columns. A
                comparison of nothing but long values has none, so they would
                be two labels pointing at empty space.
              -->
              {#if entry.diffs.some((d) => !d.long)}
                <div class="diff__head" role="row">
                  <span role="columnheader">Field</span>
                  <span role="columnheader">{sides.here}</span>
                  <span role="columnheader">{sides.theirs}</span>
                  <span role="columnheader"><span class="sr-only">Keep</span></span>
                </div>
              {/if}
              {#each entry.diffs as diff (diff.key)}
                <div class="diff__row" class:diff__row--long={diff.long} role="row">
                  <span class="diff__label" role="cell">{diff.label}</span>
                  <!--
                    A stacked pair has left the columns, so it carries the
                    column heads with it. Without them the only thing telling
                    two paragraphs apart is a coloured rule, which is a
                    legend nobody was given.
                  -->
                  <span class="diff__value diff__value--here" role="cell">
                    {#if diff.long}<span class="diff__tag">{sides.here}</span>{/if}
                    {diff.here}
                  </span>
                  <span class="diff__value diff__value--theirs" role="cell">
                    {#if diff.long}<span class="diff__tag">{sides.theirs}</span>{/if}
                    {diff.theirs}
                  </span>
                  <!--
                    Both choices on the line, not one. With only *Keep mine*
                    here, the published half of the decision lived on the row
                    button, and it was impossible to tell whether that button
                    covered the whole slide including lines already answered.
                    A pair on each line leaves nothing to infer: each line is
                    answered where it is read, and the row buttons below are
                    plainly "do this to all of them".
                  -->
                  <span class="diff__act" role="cell">
                    {#if !reading}
                      <button class="take" onclick={() => onbringfield(entry, diff.key)}>
                        Keep mine
                      </button>
                      {#if fork && onkeeppublishedfield}
                        <button class="take take--keep" onclick={() => onkeeppublishedfield(entry, diff.key)}>
                          Keep published
                        </button>
                      {/if}
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </li>
      {/each}
    </ul>

    {#if fork}
      <!--
        Points at finishing, not at keeping the draft. The old line said
        "keeping what the timeline has leaves your set-aside edits untouched",
        which read as a reason to hold on to them — and a draft kept past this
        point has nothing on it saying which parts were contested, so it is
        not even good for reference.
      -->
      <p class="hint">
        Each answer takes a row off the list; when the list is empty the draft has done its job
        and can go. Keeping yours is an ordinary edit, so Cmd-Z undoes it; keeping what is
        published only settles the row, and does not.
      </p>
    {:else if !reading}
      <p class="hint">
        Putting something back is an ordinary edit, so Cmd-Z undoes it — and the next publish
        sends whatever this timeline holds when you publish it.
      </p>
    {/if}

    {#if unmatchable}
      <p class="note">
        {unmatchable === 1 ? '1 slide' : `${unmatchable} slides`} in your draft cannot be matched
        to anything in the published timeline, so {unmatchable === 1 ? 'it is' : 'they are'} not
        listed. Open the draft to copy {unmatchable === 1 ? 'it' : 'them'} across by hand.
      </p>
    {/if}
  {:else if fork}
    <p class="lede">
      Nothing left to sort out — every edit in this draft is settled one way or the other.
      Nothing is lost by deleting it.
    </p>
    <button class="forget" onclick={onforget}>Delete this draft</button>
  {:else}
    <p class="lede">Nothing came in that this timeline did not already have.</p>
  {/if}

  <div class="foot">
    {#if fork}
      <button class="open-fork" onclick={onopenfork}>Open my draft instead</button>
    {:else}
      <button class="open-fork" onclick={onclose}>Close</button>
    {/if}
  </div>
</div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 100;
  }

  /*
   * Centered and wide: the point of the panel is two values side by side, and
   * at a drawer's width one of them always had to be somewhere else.
   */
  .panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(60rem, calc(100vw - 2rem));
    max-height: min(85vh, 54rem);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem 1rem;
    overflow-y: auto;
    background: #fff;
    border: 1px solid #d3dde6;
    border-radius: 6px;
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.28);
    z-index: 101;
  }

  .head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
  }

  .close {
    margin: 0 0 0 auto;
    padding: 0 0.25rem;
    background: none;
    border: 0;
    font-size: 1.2rem;
    line-height: 1;
    color: #667;
    cursor: pointer;
    text-shadow: none;
  }

  .lede {
    margin: 0;
    font-size: 0.88rem;
    color: #444;
    line-height: 1.45;
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  /*
   * The resets on every button here are not decoration — Orangeline gives
   * each one margin, a text-transform and a text-shadow this does not want.
   */
  .row {
    padding: 0.7rem 0.8rem;
    background: #f6f7f8;
    border: 1px solid #d6d8da;
    border-radius: 4px;
  }

  .row--contested {
    border-color: #d9bf86;
    background: #fdfaf3;
  }

  .row__head {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
  }

  .row__text {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .row__label {
    font-weight: 600;
    font-size: 0.95rem;
    overflow-wrap: anywhere;
  }

  .row__what {
    font-size: 0.78rem;
    color: #667;
  }

  .row__cost {
    font-size: 0.78rem;
    color: #8a5a00;
    line-height: 1.3;
  }

  .row__acts {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-left: auto;
    flex: none;
  }

  .bring {
    margin: 0;
    padding: 0.35rem 0.6rem;
    background: #fff;
    border: 1px solid #b9bcc0;
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: inherit;
    text-transform: none;
    text-shadow: none;
    cursor: pointer;
  }

  .bring:hover,
  .bring:focus-visible {
    background: #eef0f2;
    border-color: #8a8e93;
  }

  /* Quieter than the take: it is the option that changes nothing. */
  .keep {
    margin: 0;
    padding: 0.35rem 0.6rem;
    background: none;
    border: 1px solid transparent;
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: #5a6673;
    text-transform: none;
    text-shadow: none;
    cursor: pointer;
  }

  .keep:hover,
  .keep:focus-visible {
    background: #eef0f2;
    border-color: #c7ccd1;
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: #7a828b;
    line-height: 1.4;
  }

  /* ── The comparison ───────────────────────────────────────────────────── */

  .diff {
    margin-top: 0.7rem;
    border-top: 1px solid #e2e5e8;
  }

  .diff__head,
  .diff__row {
    display: grid;
    grid-template-columns: 8rem 1fr 1fr 9rem;
    gap: 0.75rem;
    align-items: baseline;
    padding: 0.4rem 0;
  }

  .diff__head {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8a9099;
  }

  .diff__row + .diff__row {
    border-top: 1px solid #edeff1;
  }

  .diff__label {
    font-size: 0.8rem;
    color: #556;
  }

  .diff__value {
    font-size: 0.86rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .diff__value--here {
    color: #667;
  }

  .diff__value--theirs {
    color: #1a1a1a;
    font-weight: 500;
  }

  /*
   * A body paragraph in a 1fr column is a ribbon two words wide. Long values
   * get the full width each, stacked, with the labels carried inline.
   */
  .diff__row--long {
    grid-template-columns: 8rem 1fr 9rem;
  }

  .diff__row--long .diff__value {
    grid-column: 2;
    padding: 0.3rem 0.6rem;
    border-left: 2px solid #dfe3e7;
    background: #fff;
  }

  .diff__tag {
    display: block;
    margin-bottom: 0.1rem;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8a9099;
  }

  .diff__row--long .diff__value--theirs {
    border-left-color: #8bbb8b;
  }

  .diff__row--long .diff__act {
    grid-row: 1 / span 2;
    grid-column: 3;
  }

  /* The pair stacks: side by side they set the fourth column wider than the
     values they are deciding between. */
  .diff__act {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  .take {
    margin: 0;
    padding: 0.2rem 0.5rem;
    background: #fff;
    border: 1px solid #c7ccd1;
    border-radius: 3px;
    font: inherit;
    font-size: 0.76rem;
    color: #35506a;
    text-transform: none;
    text-shadow: none;
    cursor: pointer;
  }

  .take:hover,
  .take:focus-visible {
    background: #eef3f8;
    border-color: #8ea4b8;
  }

  /* Quieter than its partner, the way the row's own decline is: it is the
     one that leaves the document as it stands. */
  .take--keep {
    background: none;
    border-color: transparent;
    color: #5a6673;
  }

  .take--keep:hover,
  .take--keep:focus-visible {
    background: #eef0f2;
    border-color: #c7ccd1;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  /* ── Footer ───────────────────────────────────────────────────────────── */

  .foot {
    margin-top: auto;
    padding-top: 0.5rem;
  }

  .forget,
  .open-fork {
    margin: 0;
    padding: 0.4rem 0.7rem;
    background: none;
    border: 1px solid #c7ccd1;
    border-radius: 4px;
    font: inherit;
    font-size: 0.8rem;
    color: #35506a;
    text-transform: none;
    text-shadow: none;
    cursor: pointer;
  }

  .forget {
    align-self: flex-start;
  }

  .open-fork {
    border-style: dashed;
  }

  .note {
    margin: 0;
    font-size: 0.78rem;
    color: #8a5a00;
    line-height: 1.35;
  }
</style>
