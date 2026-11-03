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
import { extractCid, plainBlobRef, stripOgImageUrl } from './atproto.svelte.ts';

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

/**
 * `"[object Object]"` reached a published record as a share image's cid, which
 * is how this was found: the record addressed a blob that does not exist, and
 * every comparison afterwards read the draft and its own record as disagreeing
 * about the settings.
 *
 * A `CID` arrives with its prototype intact most of the time and stripped some
 * of the time — through `structuredClone`, through a JSON round trip, through
 * the collaborative document. Stringifying one of the stripped ones is what
 * produced the value, so the rule is that nothing leaves here unless it could
 * actually be a cid.
 */
describe('reading a cid out of a blob reference', () => {
  /** A CID that has lost its prototype but kept `toJSON`'s key. */
  const clonedCid = { code: 85, version: 1, multihash: { bytes: {} }, bytes: {}, '/': CID };
  /** The same, with nothing readable left. */
  const strippedCid = { code: 85, version: 1, multihash: { bytes: {} }, bytes: {} };

  it('reads the form a record stores', () => {
    expect(extractCid({ $link: CID })).toBe(CID);
  });

  it('reads a CID class instance', () => {
    expect(extractCid(new FakeCid(CID))).toBe(CID);
  });

  it('reads a CID that has been through a JSON round trip', () => {
    expect(extractCid(clonedCid)).toBe(CID);
  });

  it('returns nothing for a CID with no readable cid left', () => {
    // The actual defect: this used to be `String(ref)`.
    expect(extractCid(strippedCid)).toBe('');
  });

  it('refuses the broken value even when it arrives in a well-formed $link', () => {
    // Drafts and records already hold this, and `"[object Object]"` is a
    // perfectly good string in a perfectly good `$link`. Without this, such a
    // draft republishes it for ever.
    expect(extractCid({ $link: '[object Object]' })).toBe('');
  });

  it('never puts the broken value into a normalised reference', () => {
    const ref = plainBlobRef({ $type: 'blob', ref: strippedCid, mimeType: 'image/png', size: 1 } as unknown as ATProtoBlobRef);
    expect(ref.ref.$link).toBe('');
  });
});

describe('publishing settings that hold a share image', () => {
  it('keeps a usable reference, dropping only the derived url', () => {
    const settings = {
      theme: 'auto' as const,
      ogImage: { blobRef: { $type: 'blob' as const, ref: { $link: CID }, mimeType: 'image/png', size: 1 }, url: 'https://pds.example/blob' },
    };
    const out = stripOgImageUrl(settings);
    expect(out?.ogImage?.blobRef?.ref.$link).toBe(CID);
    expect(out?.ogImage).not.toHaveProperty('url');
  });

  it('drops a share image whose reference cannot be read', () => {
    // The poster is regenerated on every publish, but best-effort: a
    // generation that fails would otherwise carry the broken reference from an
    // already-corrupted draft back out to the record.
    const settings = {
      theme: 'auto' as const,
      ogImage: { blobRef: { $type: 'blob' as const, ref: { $link: '[object Object]' }, mimeType: 'image/png', size: 1 } },
    };
    expect(stripOgImageUrl(settings)).not.toHaveProperty('ogImage');
  });
});
