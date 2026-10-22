/**
 * @vitest-environment happy-dom
 *
 * `addSlide` seeds rich-text fragments, and that parses HTML.
 *
 * What this pins down is the boundary between the PDS and the collaborative
 * document. A record stores a blob reference as plain JSON, but a `getRecord`
 * response decodes it back into `BlobRef` and `CID` class instances, and the
 * document cannot hold those — so whatever reads a record has to put it back
 * into plain form before the editor sees it. Skipping that stopped the editor
 * opening at all for any published timeline with an uploaded image.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import type { ATProtoBlobRef, TLEvent } from '@knight-lab/timeline-ng-core';
import { addSlide, readSlide, slidesMap, loadTimeline, docToTimeline } from './doc.ts';
import { plainBlobRef } from './atproto.svelte.ts';

const CID = 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiqk3qhc4dvswmsztdm';

/**
 * Stands in for what `@atproto/api` hands back. The real classes come from
 * `@atproto/lexicon`; what matters to Yjs is only that `constructor` is
 * neither `Object` nor anything else it accepts, and that the cid is reachable
 * through `toString` rather than a `$link` property.
 */
class FakeCid {
  constructor(private readonly cid: string) {}
  toString(): string {
    return this.cid;
  }
}

class FakeBlobRef {
  readonly $type = 'blob';
  constructor(
    public ref: unknown,
    public mimeType: string,
    public size: number,
  ) {}
}

const fromRecord = () =>
  new FakeBlobRef(new FakeCid(CID), 'image/jpeg', 1234) as unknown as ATProtoBlobRef;

const slideWith = (blobRef: ATProtoBlobRef): TLEvent =>
  ({ start_date: { year: 1999 }, media: { blobRef } }) as TLEvent;

describe('a blob reference as the record hands it back', () => {
  it('cannot be stored in the document at all', () => {
    // Characterising Yjs, not asserting a preference: `Y.Map.set` switches on
    // `value.constructor` and rejects anything that is not plain JSON. The
    // message is the one that surfaced in the console, from inside
    // `writeGroup` — with no indication of which field caused it.
    const doc = new Y.Doc();
    expect(() => addSlide(doc, slideWith(fromRecord()))).toThrow(/Unexpected content type/);
  });

  it('is accepted once normalised, with the cid intact', () => {
    const doc = new Y.Doc();
    const key = addSlide(doc, slideWith(plainBlobRef(fromRecord())));

    const stored = readSlide(slidesMap(doc).get(key)!);
    expect(stored.media?.blobRef).toEqual({
      $type: 'blob',
      ref: { $link: CID },
      mimeType: 'image/jpeg',
      size: 1234,
    });
  });

  it('normalises to plain JSON, not merely to something that looks right', () => {
    const plain = plainBlobRef(fromRecord());

    // The actual requirement: `constructor === Object` at every level, which
    // is what `Y.Map.set` tests. A class instance carrying the same fields
    // would satisfy a shape assertion and still throw.
    expect(plain.constructor).toBe(Object);
    expect(plain.ref.constructor).toBe(Object);
  });

  it('survives a whole timeline load and read back out again', () => {
    const doc = new Y.Doc();
    loadTimeline(doc, {
      events: [slideWith(plainBlobRef(fromRecord()))],
      settings: { language: 'en' },
    });

    const out = docToTimeline(doc);
    expect(out.events[0].media?.blobRef?.ref.$link).toBe(CID);
  });
});
