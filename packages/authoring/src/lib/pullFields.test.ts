/**
 * @vitest-environment happy-dom
 *
 * The inside of a pull-list row: what the panel shows, and what one field
 * taken on its own does to a slide.
 */
import { describe, it, expect } from 'vitest';
import type { TLEvent } from '@knight-lab/timeline-ng-core';
import { fieldDiffs, settingDiffs, takeField } from './pullFields.ts';

const moon: TLEvent = {
  unique_id: 'moon',
  start_date: { year: 1969 },
  text: { headline: 'Apollo 11', text: '<p>The landing.</p>' },
};

const blob = (cid: string) => ({ $type: 'blob' as const, ref: { $link: cid }, mimeType: 'image/png', size: 9 });

describe('what two versions of a slide disagree about', () => {
  it('names only the fields that differ', () => {
    const theirs = { ...moon, text: { ...moon.text, headline: 'Apollo 11 — the landing' } };
    expect(fieldDiffs(moon, theirs)).toEqual([
      {
        key: 'headline',
        label: 'Headline',
        here: 'Apollo 11',
        theirs: 'Apollo 11 — the landing',
        long: false,
      },
    ]);
  });

  it('separates the headline from the body, which share one field in the data', () => {
    // `text` holds both. Comparing at the data model's granularity would make
    // a one-word headline fix carry the whole body with it.
    const theirs = { ...moon, text: { headline: 'Apollo 11', text: '<p>Rewritten.</p>' } };
    expect(fieldDiffs(moon, theirs).map((d) => d.key)).toEqual(['body']);
  });

  it('reads prose as text, not markup', () => {
    const theirs = { ...moon, text: { ...moon.text, headline: '<em>Apollo</em> 11!' } };
    expect(fieldDiffs(moon, theirs)[0].theirs).toBe('Apollo 11!');
  });

  it('shows an absent value rather than leaving the side blank', () => {
    const theirs = { ...moon, group: 'Missions' };
    const [diff] = fieldDiffs(moon, theirs);
    expect(diff).toMatchObject({ key: 'group', here: '—', theirs: 'Missions' });
  });

  it('marks a long value for stacking instead of a column', () => {
    const theirs = { ...moon, text: { ...moon.text, text: '<p>A paragraph.</p>' } };
    expect(fieldDiffs(moon, theirs)[0].long).toBe(true);
  });

  it('tells two uploaded images apart without resolving either', () => {
    const here = { ...moon, media: { blobRef: blob('bafkreiaaaaaaaa') } } as TLEvent;
    const theirs = { ...moon, media: { blobRef: blob('bafkreibbbbbbbb') } } as TLEvent;
    const [diff] = fieldDiffs(here, theirs);
    expect(diff.key).toBe('media');
    expect(diff.here).not.toBe(diff.theirs);
  });

  it('ignores a media URL derived from the same blob', () => {
    // `url` is recomputed from the CID and the PDS origin on every read, so
    // two sides holding the same image can disagree about it and mean nothing.
    const here = { ...moon, media: { blobRef: blob('bafkreiaaaaaaaa'), url: 'https://a.example/x' } } as TLEvent;
    const theirs = { ...moon, media: { blobRef: blob('bafkreiaaaaaaaa'), url: 'https://b.example/x' } } as TLEvent;
    expect(fieldDiffs(here, theirs)).toEqual([]);
  });

  it('has nothing to say about a slide that exists on one side only', () => {
    expect(fieldDiffs(undefined, moon)).toEqual([]);
    expect(fieldDiffs(moon, undefined)).toEqual([]);
  });
});

describe('taking one field', () => {
  it('writes that field and leaves the rest alone', () => {
    const theirs: TLEvent = {
      ...moon,
      start_date: { year: 1970 },
      text: { headline: 'Changed', text: '<p>Also changed.</p>' },
    };
    const out = takeField(moon, theirs, 'headline');
    expect(out.text?.headline).toBe('Changed');
    expect(out.text?.text).toBe('<p>The landing.</p>');
    expect(out.start_date).toEqual({ year: 1969 });
  });

  it('does not mutate the slide it was given', () => {
    takeField(moon, { ...moon, group: 'Missions' }, 'group');
    expect(moon.group).toBeUndefined();
  });

  it('clears a field the other side does not have', () => {
    const here = { ...moon, group: 'Missions' };
    expect(takeField(here, moon, 'group').group).toBeUndefined();
  });

  it('removes the container when its last key goes', () => {
    // A slide with `media: {}` is not the same as one with no media: the
    // player would render an empty media column for it.
    const here = { ...moon, media: { caption: 'A photo' } } as TLEvent;
    expect(takeField(here, moon, 'caption').media).toBeUndefined();
  });

  it('carries an image with the fields that say how to read it', () => {
    const theirs = { ...moon, media: { blobRef: blob('bafkreibbbbbbbb'), mimeType: 'image/png' } } as TLEvent;
    const out = takeField({ ...moon, media: { caption: 'Kept' } } as TLEvent, theirs, 'media');
    expect(out.media?.mimeType).toBe('image/png');
    // The caption belongs to the other side of the row and is not part of
    // this choice.
    expect(out.media?.caption).toBe('Kept');
  });

  it('changes nothing for a field it does not know', () => {
    expect(takeField(moon, { ...moon, group: 'x' }, 'nonsense')).toEqual(moon);
  });
});

describe('what two versions of the settings disagree about', () => {
  it('names the settings in the words the editor uses', () => {
    const diffs = settingDiffs({ theme: 'light' }, { theme: 'dark' });
    expect(diffs).toEqual([{ key: 'theme', label: 'Theme', here: 'light', theirs: 'dark', long: false }]);
  });

  it('reads a boolean as on or off', () => {
    expect(settingDiffs({ reverseOrder: false }, { reverseOrder: true })[0]).toMatchObject({
      here: 'off',
      theirs: 'on',
    });
  });

  it('never offers the share image, even when the two are different', () => {
    // Publishing regenerates the poster from the title slide and uploads it
    // again, so neither side's survives the next publish — and two browsers
    // rendering the same title slide do not produce byte-identical PNGs, so
    // the CIDs differ for no reason anyone authored. A choice with no
    // consequence is not a choice.
    const here = { ogImage: { blobRef: blob('bafkreiaaaaaaaa'), url: 'https://a.example/og' } };
    const theirs = { ogImage: { blobRef: blob('bafkreibbbbbbbb'), url: 'https://b.example/og' } };
    expect(settingDiffs(here, theirs)).toEqual([]);
  });

  it('still sees a real setting beside a changed share image', () => {
    const here = { theme: 'light' as const, ogImage: { blobRef: blob('bafkreiaaaaaaaa') } };
    const theirs = { theme: 'dark' as const, ogImage: { blobRef: blob('bafkreibbbbbbbb') } };
    expect(settingDiffs(here, theirs).map((d) => d.key)).toEqual(['theme']);
  });
});
