<!--
  The choice from Scripts 5 and 6 of docs/phase1-sync-conflicts.md.

  What someone needs at this moment is not a diff. A symmetric comparison of
  two timelines invites them to study both documents; what they actually have
  to know is **what each button costs them**. So each option carries its own
  loss, in its own words, and the summary is framed per option rather than
  neutrally.

  *Keep both* carries the emphasis [A3]: it is the only option that cannot lose
  work, which makes the fast path also the safe one. The cost of taking it
  without much thought is a reconciliation to do later, not discarded edits.
-->
<script lang="ts">
  import { modalDialog } from '../lib/modalDialog.ts';
  import { SETTINGS_ID, TITLE_ID } from '../lib/threeWay.ts';
  import type { SlideChange, ThreeWay } from '../lib/threeWay.ts';

  interface Props {
    analysis: ThreeWay;
    /**
     * Which script this is. Script 5 catches someone at open, before they have
     * invested anything in the session, and a comparison is welcome. Script 6
     * interrupts a deliberate publish, when they are attached to their version
     * and have already decided they want it out — so it leads with what they
     * would replace.
     */
    occasion: 'open' | 'publish';
    /** When the record was last published, for the fact that often settles it. */
    publishedAt?: string;
    onkeepmine: () => void;
    onusepublished: () => void;
    onkeepboth: () => void;
    /**
     * Escape, or a click outside. Deliberately not *Keep both*, emphasized
     * though that is: every option here has an effect, and dismissing a dialog
     * must not quietly leave a fork behind. Nothing is lost by deferring — the
     * draft stays as it is and the next publish is refused again.
     */
    ondismiss: () => void;
  }

  const { analysis, occasion, publishedAt, onkeepmine, onusepublished, onkeepboth, ondismiss }: Props = $props();

  /**
   * "2 slides", "the title slide and 1 slide", "the settings".
   *
   * Slide-level is the floor worth shipping: added, removed or edited, matched
   * by `unique_id`. Counting is deliberately plain — this is a sentence about
   * what goes away, not a change log.
   */
  function describe(changes: SlideChange[]): { text: string; plural: boolean } {
    const parts: string[] = [];
    const slides = changes.filter((c) => c.id !== TITLE_ID && c.id !== SETTINGS_ID).length;
    const settings = changes.some((c) => c.id === SETTINGS_ID);
    if (changes.some((c) => c.id === TITLE_ID)) parts.push('the title slide');
    if (slides) parts.push(`${slides} slide${slides === 1 ? '' : 's'}`);
    if (settings) parts.push('the settings');
    if (parts.length === 0) return { text: 'nothing we can account for', plural: false };
    const plural = parts.length > 1 || slides > 1 || (settings && parts.length === 1);
    if (parts.length === 1) return { text: parts[0], plural };
    return { text: `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`, plural };
  }

  const theirs = $derived(describe(analysis.theirs));
  const mine = $derived(describe(analysis.mine));
  const overlap = $derived(describe(analysis.collisions.map((c) => ({ id: c.id, kind: 'edited' as const }))));

  const published = $derived(publishedAt ? new Date(publishedAt) : null);
  const publishedWhen = $derived(
    published && !Number.isNaN(published.valueOf())
      ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(published)
      : null,
  );
</script>

<div class="backdrop">
  <div
    class="dialog"
    use:modalDialog={{ onclose: ondismiss }}
    role="dialog"
    aria-modal="true"
    aria-labelledby="conflict-title"
    tabindex="-1"
  >
    <h2 id="conflict-title">
      {occasion === 'publish'
        ? 'Publishing now would replace newer changes'
        : 'This timeline changed in your account'}
    </h2>

    <p class="lede">
      {occasion === 'publish'
        ? 'It was published from another device while you were editing.'
        : 'It was published from another device after you last edited it here.'}
      {#if publishedWhen}<span class="when">Published {publishedWhen}.</span>{/if}
    </p>

    <ul class="options">
      <li>
        <button class="option option--safe" onclick={onkeepboth}>
          <span class="option__name">Keep both</span>
          <span class="option__cost">Nothing is lost. Your edits are kept as a separate copy to reconcile when you have a moment.</span>
        </button>
      </li>
      <li>
        <button class="option" onclick={onkeepmine}>
          <span class="option__name">Keep mine</span>
          <span class="option__cost">{theirs.text} published from the other device {theirs.plural ? 'go' : 'goes'} away.</span>
        </button>
      </li>
      <li>
        <button class="option" onclick={onusepublished}>
          <span class="option__name">Use the published version</span>
          <span class="option__cost">Your unpublished changes to {mine.text} go away.</span>
        </button>
      </li>
    </ul>

    {#if analysis.collisions.length}
      <p class="overlap">
        Both versions changed {overlap.text}, which is why this cannot be merged for you.
      </p>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 100;
  }

  .dialog {
    background: #fff;
    border-radius: 6px;
    padding: 1.5rem;
    max-width: 34rem;
    width: 100%;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
  }

  h2 {
    margin: 0 0 0.5rem;
    font-size: 1.15rem;
  }

  .lede {
    margin: 0 0 1.25rem;
    color: #444;
    font-size: 0.9rem;
  }

  .when {
    color: #666;
  }

  .options {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /*
   * Each option is one button carrying its own cost, rather than a row of
   * verbs under one paragraph: the cost is the part that decides it, so it
   * cannot be somewhere else on the screen.
   *
   * The explicit resets are not decoration — Orangeline styles every
   * `<button>` with margin, text-transform and a text-shadow this does not
   * want.
   */
  .option {
    display: block;
    width: 100%;
    margin: 0;
    text-align: left;
    text-transform: none;
    text-shadow: none;
    background: #f6f7f8;
    border: 1px solid #d6d8da;
    border-radius: 4px;
    padding: 0.7rem 0.85rem;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }

  .option:hover,
  .option:focus-visible {
    background: #eef0f2;
    border-color: #b9bcc0;
  }

  .option--safe {
    background: #eef7ee;
    border-color: #8bbb8b;
  }

  .option--safe:hover,
  .option--safe:focus-visible {
    background: #e2f1e2;
    border-color: #6ba36b;
  }

  .option__name {
    display: block;
    font-weight: 600;
    font-size: 0.95rem;
  }

  .option__cost {
    display: block;
    margin-top: 0.15rem;
    font-size: 0.82rem;
    color: #555;
    line-height: 1.35;
  }

  .overlap {
    margin: 1rem 0 0;
    font-size: 0.82rem;
    color: #555;
  }
</style>
