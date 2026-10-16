import { describe, expect, it } from 'vitest';
import { canResolveBackgroundImage } from './background.ts';

describe('canResolveBackgroundImage', () => {
  it('accepts direct image URLs', () => {
    expect(canResolveBackgroundImage({ url: 'https://example.com/test.jpg' })).toBe(true);
  });

  it('accepts Flickr photo pages', () => {
    expect(canResolveBackgroundImage({ url: 'https://www.flickr.com/photos/example/1234567890/' })).toBe(true);
  });

  it('accepts Wikimedia file pages', () => {
    expect(canResolveBackgroundImage({ url: 'https://commons.wikimedia.org/wiki/File:Example.jpg' })).toBe(true);
  });

  it('accepts extensionless image endpoints for async validation', () => {
    expect(canResolveBackgroundImage({ url: 'https://example.com/image' })).toBe(true);
  });

  it('accepts local blob URLs from in-session uploads', () => {
    expect(canResolveBackgroundImage({ url: 'blob:http://localhost:5173/0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0' })).toBe(true);
  });

  it('rejects malformed URLs', () => {
    expect(canResolveBackgroundImage({ url: 'not a url' })).toBe(false);
  });
});
