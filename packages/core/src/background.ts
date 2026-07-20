import type { TLMedia } from './types.ts';
import { resolveMedia } from './resolver.ts';

type BackgroundMediaInput = Pick<TLMedia, 'url' | 'mimeType' | 'alt' | 'caption'>;

interface FlickrOEmbed {
  url: string;
}

const backgroundImageCache = new Map<string, Promise<string | null>>();

function cacheKey(media: BackgroundMediaInput): string {
  return `${media.mimeType ?? ''}::${media.url?.trim() ?? ''}`;
}

function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function windowRecord(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

function fetchFlickrOEmbed(photoUrl: string): Promise<FlickrOEmbed> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return Promise.reject(new Error('Flickr background resolution requires a browser environment'));
  }

  return new Promise((resolve, reject) => {
    const cb = `_tlBackgroundFlickr${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const win = windowRecord();
    win[cb] = (data: FlickrOEmbed) => {
      delete win[cb];
      script.remove();
      resolve(data);
    };
    script.onerror = () => {
      delete win[cb];
      script.remove();
      reject(new Error('Flickr background resolution failed'));
    };
    script.src = `https://www.flickr.com/services/oembed/?url=${encodeURIComponent(photoUrl)}&format=json&jsoncallback=${cb}`;
    document.head.appendChild(script);
  });
}

// Fair-use/non-free files (e.g. book covers) live only on the local
// language wiki, not on Commons, so fall back to it when given.
async function fetchWikimediaImageSrc(fileTitle: string, language?: string): Promise<string> {
  const encoded = encodeURIComponent(fileTitle);
  const hosts = ['commons.wikimedia.org', ...(language ? [`${language}.wikipedia.org`] : [])];
  for (const host of hosts) {
    const apiUrl = `https://${host}/w/api.php?action=query&prop=imageinfo&iiprop=url&iiurlwidth=1600&titles=${encoded}&format=json&origin=*`;
    const res = await fetch(apiUrl);
    if (!res.ok) continue;
    const data = await res.json();
    const pages = data.query?.pages ?? {};
    const page = Object.values(pages)[0] as { imageinfo?: Array<{ thumburl?: string; url?: string }> } | undefined;
    const info = page?.imageinfo?.[0];
    const src = info?.thumburl ?? info?.url;
    if (src) return src;
  }
  throw new Error('Wikimedia image not found');
}

function verifyImageSrc(src: string): Promise<string | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(src);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function resolveBackgroundImageUrlUncached(media: BackgroundMediaInput): Promise<string | null> {
  const resolved = resolveMedia(media);

  if (resolved.kind === 'image') {
    return verifyImageSrc(resolved.src);
  }

  if (resolved.kind === 'wikipediaimage') {
    const src = await fetchWikimediaImageSrc(resolved.fileTitle, resolved.language);
    return verifyImageSrc(src);
  }

  if (resolved.kind === 'flickr') {
    const photo = await fetchFlickrOEmbed(resolved.photoUrl);
    if (!photo.url) return null;
    return verifyImageSrc(photo.url);
  }

  if (media.url && isHttpUrl(media.url)) {
    return verifyImageSrc(media.url);
  }

  return null;
}

export function canResolveBackgroundImage(media: BackgroundMediaInput): boolean {
  const url = media.url?.trim() ?? '';
  return !!url && isHttpUrl(url);
}

export function resolveBackgroundImageUrl(media: BackgroundMediaInput): Promise<string | null> {
  const url = media.url?.trim() ?? '';
  if (!url) return Promise.resolve(null);

  const key = cacheKey({ ...media, url });
  const cached = backgroundImageCache.get(key);
  if (cached) return cached;

  const pending = resolveBackgroundImageUrlUncached({ ...media, url }).catch(() => null);
  backgroundImageCache.set(key, pending);
  return pending;
}
