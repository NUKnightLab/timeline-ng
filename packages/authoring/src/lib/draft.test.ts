import { describe, it, expect } from 'vitest';
import { draftIsWorthKeeping } from './draft.ts';

/**
 * The browser copy is a safety net, and the question is only ever whether the
 * same content exists somewhere it cannot be lost from — which means published.
 *
 * This became load-bearing when `pdsClean` stopped being a flag and became a
 * comparison of content: it now reports clean again when an edit is reversed,
 * so "clean, therefore disposable" would delete the only copy of a timeline
 * whose author had simply undone their way back to the start.
 */
describe('draftIsWorthKeeping', () => {
  const keep = (o: Partial<Parameters<typeof draftIsWorthKeeping>[0]>) =>
    draftIsWorthKeeping({ clean: false, durableCopyExists: false, hasContent: true, ...o });

  it('keeps unsaved work', () => {
    expect(keep({ clean: false, durableCopyExists: false })).toBe(true);
  });

  it('keeps a timeline with no durable copy even when it matches what was loaded', () => {
    // The regression: undo back to the start on a timeline with no atUri.
    expect(keep({ clean: true, durableCopyExists: false })).toBe(true);
  });

  it('keeps a published timeline that has unpublished changes', () => {
    expect(keep({ clean: false, durableCopyExists: true })).toBe(true);
  });

  it('drops a published timeline that matches the published copy', () => {
    expect(keep({ clean: true, durableCopyExists: true })).toBe(false);
  });

  it('drops an empty timeline whatever its state', () => {
    expect(keep({ hasContent: false, clean: false, durableCopyExists: false })).toBe(false);
    expect(keep({ hasContent: false, clean: true, durableCopyExists: false })).toBe(false);
  });
});
