/**
 * @vitest-environment happy-dom
 *
 * What a slide write actually touches.
 *
 * `EventEditor` rebuilds the entire `TLEvent` and emits it on every keystroke —
 * `buildAndEmit` is called from around twenty-five places. Handed straight to a
 * `Y.Map` that would be a whole-slide replace per character: last-write-wins
 * with a CRDT underneath, which is the one failure the document model exists to
 * avoid (docs/coauthoring.md §3.2).
 *
 * These tests pin the property that makes that safe: a write only touches the
 * fields that actually changed. They are the reason the editor did not have to
 * be rewritten to emit field-level updates.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { TLEvent } from '@knight-lab/timeline-ng-core';
import { addSlide, createDoc, slidesMap, writeSlide, writeSettings, settingsMap } from './doc.ts';

/** Every `map` key a change touched, as `slideKey/group/field` paths. */
function changedPaths<T>(root: Y.Map<T>, doc: Y.Doc, fn: () => void): string[] {
  const out: string[] = [];
  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const e of events) {
      const path = e.path.slice(1).join('/');
      for (const k of e.changes.keys.keys()) out.push(path ? `${path}/${k}` : k);
    }
  };
  root.observeDeep(handler);
  doc.transact(fn);
  root.unobserveDeep(handler);
  return out;
}

const blobRef = { $type: 'blob' as const, ref: { $link: 'bafyxyz' }, mimeType: 'image/jpeg', size: 99 };

const base: TLEvent = {
  unique_id: 'moon',
  start_date: { year: 1969, month: 7, day: 20 },
  text: { headline: 'The Moon Landing', text: '<p>One small step.</p>' },
  media: { url: 'https://example.com/m.jpg', blobRef, mimeType: 'image/jpeg', caption: 'Apollo 11' },
};

/** What EventEditor emits: a whole event, rebuilt, with fresh nested objects. */
function reEmit(overrides: Partial<TLEvent> = {}): TLEvent {
  return {
    ...base,
    start_date: { ...base.start_date! },
    text: { ...base.text },
    media: { ...base.media, blobRef: { ...blobRef, ref: { ...blobRef.ref } } },
    ...overrides,
  };
}

function withSlide(fn: (ctx: { doc: Y.Doc; slide: Y.Map<unknown>; changes: (f: () => void) => string[] }) => void) {
  const doc = createDoc();
  const key = addSlide(doc, base);
  const slide = slidesMap(doc).get(key)!;
  fn({ doc, slide, changes: (f) => changedPaths(slidesMap(doc), doc, f) });
}

describe('a whole-slide write touches only what changed', () => {
  it('writes nothing when the event is re-emitted unchanged', () => {
    // The important case: EventEditor re-emits on every keystroke anywhere on
    // the slide, and every nested object arrives newly constructed.
    withSlide(({ slide, changes }) => {
      expect(changes(() => writeSlide(slide, reEmit()))).toEqual([]);
    });
  });

  it('ignores prose entirely, because the fragments own it', () => {
    // EventEditor re-emits the whole event on every keystroke, including its
    // copy of the HTML. Honouring that would overwrite whatever a collaborator
    // just typed into the fragment, so writeSlide leaves those fields alone
    // once a slide has fragments. Prose reaches the document through Tiptap.
    withSlide(({ slide, changes }) => {
      const touched = changes(() => writeSlide(slide, reEmit({
        text: { headline: 'The Moon Landings', text: '<p>Also changed.</p>' },
      })));
      expect(touched).toEqual([]);
    });
  });

  it('writes one field for a caption edit, leaving the media blobRef alone', () => {
    withSlide(({ slide, changes }) => {
      const touched = changes(() => writeSlide(slide, reEmit({ media: { ...base.media, caption: 'Apollo 11 crew' } })));
      expect(touched).toEqual(['media/caption']);
    });
  });

  it('writes one field for a date part', () => {
    withSlide(({ slide, changes }) => {
      const touched = changes(() => writeSlide(slide, reEmit({ start_date: { ...base.start_date!, day: 21 } })));
      expect(touched).toEqual(['start_date/day']);
    });
  });

  it('writes one field for a slide ID rename', () => {
    withSlide(({ slide, changes }) => {
      expect(changes(() => writeSlide(slide, reEmit({ unique_id: 'apollo-11' })))).toEqual(['unique_id']);
    });
  });

  it('removes just the sub-field that went away', () => {
    withSlide(({ slide, changes }) => {
      const { caption: _dropped, ...rest } = base.media!;
      expect(changes(() => writeSlide(slide, reEmit({ media: rest })))).toEqual(['media/caption']);
    });
  });

  it('removes the whole group when the field goes away', () => {
    withSlide(({ slide, changes }) => {
      const { media: _dropped, ...rest } = base;
      expect(changes(() => writeSlide(slide, { ...reEmit(), ...rest, media: undefined }))).toEqual(['media']);
    });
  });

  it('replaces a blobRef only when its content differs', () => {
    withSlide(({ slide, changes }) => {
      const other = { ...blobRef, ref: { $link: 'bafyabc' } };
      expect(changes(() => writeSlide(slide, reEmit({ media: { ...base.media, blobRef: other } })))).toEqual(['media/blobRef']);
    });
  });

  it('writes two fields when two change together', () => {
    withSlide(({ slide, changes }) => {
      const touched = changes(() => writeSlide(slide, reEmit({
        unique_id: 'apollo-11',
        media: { ...base.media, caption: 'Apollo 11 crew' },
      })));
      expect(touched.sort()).toEqual(['media/caption', 'unique_id']);
    });
  });
});

describe('settings', () => {
  it('writes only the setting that changed', () => {
    const doc = createDoc();
    writeSettings(doc, { language: 'en', theme: 'auto', initialIndex: 0 });
    const touched: string[] = [];
    const handler = (e: Y.YMapEvent<unknown>) => { for (const k of e.changes.keys.keys()) touched.push(k); };
    settingsMap(doc).observe(handler);
    writeSettings(doc, { language: 'en', theme: 'dark', initialIndex: 0 });
    settingsMap(doc).unobserve(handler);
    expect(touched).toEqual(['theme']);
  });
});
