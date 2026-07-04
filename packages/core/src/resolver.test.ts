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
