import { describe, it, expect } from 'vitest';
import { flushSync } from 'svelte';
import { TimelineDoc } from './doc.svelte.ts';

// A DOM-free stand-in for lib/text.ts's stripHtml. What is under test is the
// effect's read-then-write-back behaviour, not HTML parsing.
function stripHtml(input?: string): string {
  if (!input) return '';
  return input.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * App.svelte derives the timeline title from the title slide's headline in an
 * effect that also writes the result back into the document. That is the one
 * place in the editor where a read and a write meet, so it is the one place that
 * could loop: `Y.Map.set` emits an update even when the value is unchanged, and
 * an update rebuilds the snapshot the effect reads.
 *
 * These tests would not merely fail if that regressed — Svelte would throw
 * `effect_update_depth_exceeded`. They exist to keep the guards in `doc.ts`'s
 * `put()` and in the effect's own equality check honest.
 */
function withTitleEffect(t: TimelineDoc, body: () => void): void {
  const cleanup = $effect.root(() => {
    $effect(() => {
      if (t.titleSetByUser) return;
      const fromHeadline = stripHtml(t.titleEvent?.text?.headline);
      if (fromHeadline !== t.title) t.setTitle(fromHeadline, false);
    });
    body();
  });
  cleanup();
}

describe('the title-sync effect settles', () => {
  it('settles on an empty document, leaving the title unset', () => {
    const t = new TimelineDoc();
    withTitleEffect(t, () => {
      flushSync();
      expect(t.title).toBe('');
      expect(t.titleSetByUser).toBe(false);
    });
  });

  it('follows the title slide headline, and strips its markup', () => {
    const t = new TimelineDoc();
    withTitleEffect(t, () => {
      flushSync();

      t.setTitleSlide({ unique_id: 'title', text: { headline: 'Spaceflight' } });
      flushSync();
      expect(t.title).toBe('Spaceflight');

      t.setTitleSlide({ unique_id: 'title', text: { headline: 'Spaceflight <em>again</em>' } });
      flushSync();
      expect(t.title).toBe('Spaceflight again');
    });
  });

  it('clears the title when the headline is emptied', () => {
    const t = new TimelineDoc();
    withTitleEffect(t, () => {
      t.setTitleSlide({ unique_id: 'title', text: { headline: 'Spaceflight' } });
      flushSync();
      expect(t.title).toBe('Spaceflight');

      t.setTitleSlide({ unique_id: 'title' });
      flushSync();
      expect(t.title).toBe('');
    });
  });

  it('leaves an explicitly set title alone', () => {
    const t = new TimelineDoc();
    withTitleEffect(t, () => {
      flushSync();

      t.setTitle('Chosen by hand', true);
      flushSync();
      expect(t.title).toBe('Chosen by hand');

      t.setTitleSlide({ unique_id: 'title', text: { headline: 'Ignored' } });
      flushSync();
      expect(t.title).toBe('Chosen by hand');
    });
  });

  it('does not count as an unsaved change', () => {
    // The derived title lives in meta, not in the timeline, so syncing it must
    // not make a freshly loaded document look dirty.
    const t = new TimelineDoc();
    withTitleEffect(t, () => {
      t.load({ title: { unique_id: 'title', text: { headline: 'Spaceflight' } }, events: [], settings: {} });
      flushSync();
      expect(t.title).toBe('Spaceflight');
      expect(t.clean).toBe(true);
    });
  });
});
