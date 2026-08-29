import { describe, expect, it } from 'vitest';
import { collections, harvestSearchText, mergeSearchText } from './collections.ts';
import type { RecordRow } from './collections.ts';

describe('harvestSearchText', () => {
  it('collects nested strings, lowercased', () => {
    const rec = {
      text: 'Sunset over the Lake',
      content: { attribution: { name: 'Ada Lovelace' } },
    };
    const out = harvestSearchText(rec);
    expect(out).toContain('sunset over the lake');
    expect(out).toContain('ada lovelace');
  });

  it('skips structural blob keys', () => {
    const rec = {
      $type: 'social.grain.photo',
      alt: 'A heron',
      photo: { $type: 'blob', ref: { $link: 'bafyabc123' }, mimeType: 'image/jpeg', size: 42 },
    };
    const out = harvestSearchText(rec);
    expect(out).toContain('a heron');
    expect(out).not.toContain('bafyabc123');
    expect(out).not.toContain('image/jpeg');
    expect(out).not.toContain('social.grain.photo');
  });

  it('keeps the calendar date from timestamps but drops the clock', () => {
    const out = harvestSearchText({ createdAt: '2019-04-02T13:45:12.000Z' });
    expect(out).toBe('2019-04-02');
  });

  it('drops at-uris and dids', () => {
    const out = harvestSearchText({
      subject: 'at://did:plc:abc/social.grain.photo/xyz',
      author: 'did:plc:abc',
      title: 'Keep me',
    });
    expect(out).toBe('keep me');
  });

  it('keeps year-like numbers and drops other bare numbers', () => {
    const out = harvestSearchText({ year: 1969, count: 42, size: 100000 });
    expect(out).toBe('1969');
  });

  it('walks arrays', () => {
    const out = harvestSearchText({ tags: ['Chicago', 'Architecture'] });
    expect(out).toContain('chicago');
    expect(out).toContain('architecture');
  });

  it('appends extra terms such as the app label', () => {
    const out = harvestSearchText({ alt: 'A heron' }, 'Grain.social');
    expect(out).toContain('grain.social');
  });

  it('dedupes repeated values', () => {
    const out = harvestSearchText({ a: 'Heron', b: 'heron', c: 'HERON' });
    expect(out).toBe('heron');
  });

  it('tolerates non-objects', () => {
    expect(harvestSearchText(null)).toBe('');
    expect(harvestSearchText(undefined)).toBe('');
    expect(harvestSearchText('bare string')).toBe('bare string');
  });
});

describe('mergeSearchText', () => {
  it('appends context and dedupes against what is already there', () => {
    expect(mergeSearchText('a heron', 'Jun 6, 2015')).toBe('a heron jun 6, 2015');
    expect(mergeSearchText('a heron', 'A Heron')).toBe('a heron');
  });

  it('ignores empty pieces', () => {
    expect(mergeSearchText('', 'Only this')).toBe('only this');
    expect(mergeSearchText('kept', undefined, '')).toBe('kept');
  });
});

describe('Grain gallery context', () => {
  const grain = collections.find(c => c.nsid === 'social.grain.photo')!;
  const DID = 'did:plc:ah4qt2skh2vxhbmymo4z24gy';
  const photo = (rkey: string) => `at://${DID}/social.grain.photo/${rkey}`;
  const gallery = (rkey: string) => `at://${DID}/social.grain.gallery/${rkey}`;

  function build(galleries: RecordRow[], items: RecordRow[]) {
    return grain.buildContext!({
      'social.grain.gallery': galleries,
      'social.grain.gallery.item': items,
    });
  }

  it('joins gallery title and description onto each photo in the gallery', () => {
    const index = build(
      [{
        uri: gallery('g1'),
        value: {
          $type: 'social.grain.gallery',
          title: 'Jun 6, 2015',
          description: "Tonight's salad harvested by @chronicbabe",
          createdAt: '2015-06-06T23:16:01.000Z',
        },
      }],
      [
        { uri: 'at://x/social.grain.gallery.item/i1', value: { item: photo('p1'), gallery: gallery('g1'), position: 0 } },
        { uri: 'at://x/social.grain.gallery.item/i2', value: { item: photo('p2'), gallery: gallery('g1'), position: 1 } },
      ],
    );

    for (const p of [photo('p1'), photo('p2')]) {
      expect(index.get(p)?.text).toBe("Jun 6, 2015 Tonight's salad harvested by @chronicbabe");
      expect(index.get(p)?.label).toBe("Tonight's salad harvested by @chronicbabe");
    }
  });

  it('accumulates text when a photo appears in several galleries', () => {
    const index = build(
      [
        { uri: gallery('g1'), value: { title: 'Garden', description: 'Salad' } },
        { uri: gallery('g2'), value: { title: 'Summer', description: 'Harvest' } },
      ],
      [
        { uri: 'at://x/i/1', value: { item: photo('p1'), gallery: gallery('g1') } },
        { uri: 'at://x/i/2', value: { item: photo('p1'), gallery: gallery('g2') } },
      ],
    );
    expect(index.get(photo('p1'))?.text).toBe('Garden Salad Summer Harvest');
    expect(index.get(photo('p1'))?.label).toBe('Salad'); // first gallery wins
  });

  it('falls back to the title when a gallery has no description', () => {
    const index = build(
      [{ uri: gallery('g1'), value: { title: 'Jun 6, 2015' } }],
      [{ uri: 'at://x/i/1', value: { item: photo('p1'), gallery: gallery('g1') } }],
    );
    expect(index.get(photo('p1'))).toEqual({ text: 'Jun 6, 2015', label: 'Jun 6, 2015' });
  });

  it('skips items pointing at a gallery that was not enumerated', () => {
    const index = build([], [{ uri: 'at://x/i/1', value: { item: photo('p1'), gallery: gallery('gone') } }]);
    expect(index.size).toBe(0);
  });

  it('skips galleries with no text at all', () => {
    const index = build(
      [{ uri: gallery('g1'), value: { createdAt: '2015-06-06T23:16:01.000Z' } }],
      [{ uri: 'at://x/i/1', value: { item: photo('p1'), gallery: gallery('g1') } }],
    );
    expect(index.size).toBe(0);
  });

  it('tolerates malformed gallery items', () => {
    const index = build(
      [{ uri: gallery('g1'), value: { title: 'T' } }],
      [
        { uri: 'at://x/i/1', value: { gallery: gallery('g1') } },  // no item
        { uri: 'at://x/i/2', value: { item: photo('p1') } },       // no gallery
        { uri: 'at://x/i/3', value: {} },
      ],
    );
    expect(index.size).toBe(0);
  });

  it('declares the sibling collections it needs', () => {
    expect(grain.contextCollections).toEqual(['social.grain.gallery', 'social.grain.gallery.item']);
  });
});
