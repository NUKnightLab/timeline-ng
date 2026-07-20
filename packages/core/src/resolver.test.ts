import { describe, expect, it } from 'vitest';
import { resolveMedia } from './resolver.ts';

describe('resolveMedia bluesky clients', () => {
  it('recognizes bsky.app post URLs', () => {
    const resolved = resolveMedia({ url: 'https://bsky.app/profile/bsky.app/post/3mk6ipt5iv22y' });
    expect(resolved.kind).toBe('bluesky');
    if (resolved.kind !== 'bluesky') return;
    expect(resolved.handle).toBe('bsky.app');
    expect(resolved.postId).toBe('3mk6ipt5iv22y');
    expect(resolved.originalUrl).toBe('https://bsky.app/profile/bsky.app/post/3mk6ipt5iv22y');
  });

  it('recognizes blacksky.community post URLs and preserves the original host', () => {
    const resolved = resolveMedia({ url: 'https://blacksky.community/profile/alice.bsky.social/post/3mk6ipt5iv22y' });
    expect(resolved.kind).toBe('bluesky');
    if (resolved.kind !== 'bluesky') return;
    expect(resolved.handle).toBe('alice.bsky.social');
    expect(resolved.originalUrl).toBe('https://blacksky.community/profile/alice.bsky.social/post/3mk6ipt5iv22y');
    expect(resolved.cleanUrl).toBe('https://bsky.app/profile/alice.bsky.social/post/3mk6ipt5iv22y');
  });

  it('recognizes mu.social post URLs and preserves the original host', () => {
    const resolved = resolveMedia({ url: 'https://mu.social/profile/alice.bsky.social/post/3mk6ipt5iv22y' });
    expect(resolved.kind).toBe('bluesky');
    if (resolved.kind !== 'bluesky') return;
    expect(resolved.handle).toBe('alice.bsky.social');
    expect(resolved.originalUrl).toBe('https://mu.social/profile/alice.bsky.social/post/3mk6ipt5iv22y');
  });
});

describe('resolveMedia wikipedia images', () => {
  it('recognizes #/media/File: lightbox URLs and captures the source language', () => {
    const resolved = resolveMedia({
      url: 'https://en.wikipedia.org/wiki/Ada_Lovelace#/media/File:Ada_Lovelace_portrait.jpg',
    });
    expect(resolved.kind).toBe('wikipediaimage');
    if (resolved.kind !== 'wikipediaimage') return;
    expect(resolved.fileTitle).toBe('File:Ada_Lovelace_portrait.jpg');
    expect(resolved.language).toBe('en');
  });

  it('recognizes direct File: page URLs (e.g. non-free/fair-use images) instead of treating them as articles', () => {
    const resolved = resolveMedia({
      url: 'https://en.wikipedia.org/wiki/File:The_Information_Gleick_2011.jpg',
    });
    expect(resolved.kind).toBe('wikipediaimage');
    if (resolved.kind !== 'wikipediaimage') return;
    expect(resolved.fileTitle).toBe('File:The_Information_Gleick_2011.jpg');
    expect(resolved.language).toBe('en');
  });

  it('recognizes Wikimedia Commons file URLs without a language', () => {
    const resolved = resolveMedia({
      url: 'https://commons.wikimedia.org/wiki/File:Ada_Lovelace_portrait.jpg',
    });
    expect(resolved.kind).toBe('wikipediaimage');
    if (resolved.kind !== 'wikipediaimage') return;
    expect(resolved.fileTitle).toBe('File:Ada_Lovelace_portrait.jpg');
    expect(resolved.language).toBeUndefined();
  });

  it('still treats a plain article URL as a wikipedia article', () => {
    const resolved = resolveMedia({ url: 'https://en.wikipedia.org/wiki/Ada_Lovelace' });
    expect(resolved.kind).toBe('wikipedia');
  });
});
