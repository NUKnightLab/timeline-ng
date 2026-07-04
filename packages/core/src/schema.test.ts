import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Ajv from 'ajv';
import { generateTimelineSchema } from '../scripts/schema.mjs';
import type { TLTimeline } from './types.ts';

const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../schema/timeline.schema.json');

describe('timeline.schema.json', () => {
  it('matches what generateTimelineSchema() produces from the TypeScript types', () => {
    const committed = JSON.parse(readFileSync(schemaPath, 'utf-8'));
    const fresh = generateTimelineSchema();
    expect(committed).toEqual(fresh);
  });

  it('accepts a minimal valid timeline', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(generateTimelineSchema());
    const timeline: TLTimeline = { events: [] };
    expect(validate(timeline)).toBe(true);
  });

  it('accepts a fully-populated timeline', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(generateTimelineSchema());
    const timeline: TLTimeline = {
      title: { text: { headline: 'My Timeline' } },
      events: [
        {
          unique_id: 'evt-1',
          start_date: { year: 2020, month: 1, day: 1 },
          end_date: { year: 2020, month: 1, day: 2 },
          text: { headline: 'Event one', text: '<p>Body</p>' },
          media: { url: 'https://example.com/image.jpg', caption: 'A caption', alt: 'Alt text' },
          media_position: 'right',
          group: 'Group A',
          background: { color: '#ffffff' },
        },
      ],
      settings: {
        language: 'es',
        theme: 'dark',
        initialIndex: 2,
        reverseOrder: true,
      },
    };
    expect(validate(timeline)).toBe(true);
  });

  it('rejects a timeline missing the required events array', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(generateTimelineSchema());
    expect(validate({})).toBe(false);
  });

  it('rejects an event with an unknown property', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(generateTimelineSchema());
    expect(validate({ events: [{ bogus_field: true }] })).toBe(false);
  });

  it('rejects a date with a non-numeric year', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(generateTimelineSchema());
    expect(validate({ events: [{ start_date: { year: '2020' } }] })).toBe(false);
  });

  it('rejects settings with an unknown property', () => {
    const ajv = new Ajv();
    const validate = ajv.compile(generateTimelineSchema());
    expect(validate({ events: [], settings: { bogus: true } })).toBe(false);
  });
});
