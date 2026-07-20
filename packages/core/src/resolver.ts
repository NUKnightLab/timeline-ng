import type { TLBackground, TLEvent, TLMedia } from './types.ts';

export type ResolvedMedia =
  | { kind: 'embed-markup'; html: string }
  | { kind: 'image'; src: string; alt: string }
  | { kind: 'youtube'; videoId: string; start?: number; end?: number }
  | { kind: 'vimeo'; videoId: string; start?: string }
  | { kind: 'dailymotion'; videoId: string }
  | { kind: 'wistia'; videoId: string }
  | { kind: 'audio'; src: string; mimeType?: string }
  | { kind: 'video'; src: string; mimeType?: string }
  | { kind: 'pdf'; src: string }
  | { kind: 'soundcloud'; trackUrl: string }
  | { kind: 'spotify'; embedUrl: string }
  | { kind: 'bluesky'; handle: string; postId: string; cleanUrl: string; originalUrl: string }
  | { kind: 'tiktok'; handle: string; videoId: string; cleanUrl: string; embedUrl: string }
  | { kind: 'twitter'; tweetUrl: string }
  | { kind: 'wikipedia'; language: string; articleTitle: string; articleUrl: string }
  | { kind: 'wikipediaimage'; fileTitle: string }
  | { kind: 'flickr'; photoUrl: string }
  | { kind: 'googledoc'; embedUrl: string }
  | { kind: 'googlemaps'; embedUrl: string }
  | { kind: 'iframe'; src: string }
  | { kind: 'unknown'; url: string };

const IMAGE_EXT = /\.(jpe?g|gif|png|svg|webp|tiff?)(\?.*)?$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg|oga|opus|flac)(\?.*)?$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|ogv)(\?.*)?$/i;

function parseYouTubeTime(str: string): number {
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m(?!s)/);
  const s = str.match(/(\d+)s/);
  if (!h && !m && !s) return parseInt(str, 10) || 0;
  return (h ? parseInt(h[1]) * 3600 : 0) +
    (m ? parseInt(m[1]) * 60 : 0) +
    (s ? parseInt(s[1]) : 0);
}

export function resolveMedia(media: TLMedia): ResolvedMedia {
  // mimeType takes precedence — used for PDS blob URLs which have no file extension
  if (media.mimeType && media.url) {
    const mt = media.mimeType;
    const src = media.url;
    if (mt.startsWith('image/')) return { kind: 'image', src, alt: media.alt ?? media.caption ?? '' };
    if (mt.startsWith('audio/')) return { kind: 'audio', src, mimeType: mt };
    if (mt.startsWith('video/')) return { kind: 'video', src, mimeType: mt };
    if (mt === 'application/pdf') return { kind: 'pdf', src };
  }

  if (!media.url) return { kind: 'unknown', url: '' };
  const url = media.url.trim();

  // Embed markup — url field contains raw HTML (blockquote or iframe), not a URL
  if (url.startsWith('<')) {
    return { kind: 'embed-markup', html: url };
  }

  // WikipediaImage — must come before Wikipedia (more specific)
  if (/commons\.wikimedia\.org\/wiki\/File:|#\/media\/File:/.test(url)) {
    const commonsMatch = url.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/);
    const mediaMatch = url.match(/#\/media\/(File:[^?]+)/);
    const fileTitle = commonsMatch?.[1] ?? mediaMatch?.[1];
    if (!fileTitle) return { kind: 'unknown', url };
    return { kind: 'wikipediaimage', fileTitle: decodeURIComponent(fileTitle) };
  }

  // Wikipedia article
  if (/\.wikipedia\.org\/wiki\//.test(url)) {
    const m = url.match(/([a-z-]+)\.wikipedia\.org\/wiki\/([^?#]+)/);
    if (!m) return { kind: 'unknown', url };
    return {
      kind: 'wikipedia',
      language: m[1],
      articleTitle: decodeURIComponent(m[2]).replace(/_/g, ' '),
      articleUrl: url.split('#')[0],
    };
  }

  // YouTube
  if (/youtube\.com|youtu\.be/.test(url)) {
    try {
      const u = new URL(url);
      let videoId = u.searchParams.get('v') ?? undefined;
      if (!videoId) {
        const m = url.match(/(?:embed\/|v\/|youtu\.be\/)([^?&/]+)/);
        if (m) videoId = m[1];
      }
      if (!videoId) return { kind: 'unknown', url };
      let start: number | undefined;
      let end: number | undefined;
      const t = u.searchParams.get('t') ?? u.searchParams.get('start');
      const e = u.searchParams.get('end');
      if (t) start = parseYouTubeTime(t);
      if (e) end = parseYouTubeTime(e);
      return { kind: 'youtube', videoId, start, end };
    } catch {
      return { kind: 'unknown', url };
    }
  }

  // Vimeo
  if (/vimeo\.com/.test(url)) {
    const m = url.match(/(?:video\/|vimeo\.com\/)(\d+)/);
    if (!m) return { kind: 'unknown', url };
    const hashMatch = url.match(/#t=([^&]+)/);
    return { kind: 'vimeo', videoId: m[1], start: hashMatch?.[1] };
  }

  // DailyMotion
  if (/dailymotion\.com|dai\.ly/.test(url)) {
    let videoId: string | undefined;
    if (url.includes('dai.ly/')) {
      videoId = url.split('dai.ly/')[1].split(/[?&]/)[0];
    } else if (url.includes('video/')) {
      videoId = url.split('video/')[1].split(/[?&]/)[0];
    } else if (url.includes('embed/')) {
      videoId = url.split('embed/')[1].split(/[?&]/)[0];
    }
    if (!videoId) return { kind: 'unknown', url };
    if (videoId.includes('_')) videoId = videoId.split('_')[0];
    return { kind: 'dailymotion', videoId };
  }

  // Wistia
  if (/wistia\.com|wi\.st/.test(url)) {
    const m = url.match(/(?:wistia\.com|wi\.st)\/medias\/([^/?#]+)/);
    if (!m) return { kind: 'unknown', url };
    return { kind: 'wistia', videoId: m[1] };
  }

  // SoundCloud
  if (/soundcloud\.com/.test(url)) {
    return { kind: 'soundcloud', trackUrl: url };
  }

  // Spotify
  if (/spotify\.com/.test(url) || url.startsWith('spotify:')) {
    let embedUrl: string;
    if (url.startsWith('spotify:')) {
      embedUrl = `https://open.spotify.com/embed/${url.replace(/^spotify:/, '').replace(/:/g, '/')}`;
    } else {
      try {
        const u = new URL(url);
        embedUrl = `https://open.spotify.com/embed${u.pathname}`;
      } catch {
        return { kind: 'unknown', url };
      }
    }
    return { kind: 'spotify', embedUrl };
  }

  // Bluesky / ATProto web clients
  if (/(?:^https?:\/\/)?(?:www\.)?(?:bsky\.app|blacksky\.community|mu\.social)\//.test(url)) {
    const m = url.match(/(?:bsky\.app|blacksky\.community|mu\.social)\/profile\/([^/]+)\/post\/([^/?#]+)/);
    if (!m) return { kind: 'unknown', url };
    return {
      kind: 'bluesky',
      handle: m[1],
      postId: m[2],
      cleanUrl: `https://bsky.app/profile/${m[1]}/post/${m[2]}`,
      originalUrl: url,
    };
  }

  // TikTok
  if (/tiktok\.com/.test(url)) {
    const m = url.match(/tiktok\.com\/@([^/]+)\/video\/(\d+)/);
    if (!m) return { kind: 'unknown', url };
    return {
      kind: 'tiktok',
      handle: m[1],
      videoId: m[2],
      cleanUrl: `https://www.tiktok.com/@${m[1]}/video/${m[2]}`,
      embedUrl: `https://www.tiktok.com/player/v1/${m[2]}`,
    };
  }

  // Twitter / X
  if (/(?:twitter|x)\.com/.test(url)) {
    const m = url.match(/(?:status|statuses)\/(\d+)/);
    if (!m) return { kind: 'unknown', url };
    return { kind: 'twitter', tweetUrl: url };
  }

  // Google Maps — must come before Drive/Docs check
  if (/maps\.google\.com|google\.com\/maps/.test(url)) {
    // Already an embed URL
    if (/google\.com\/maps\/embed/.test(url)) {
      return { kind: 'googlemaps', embedUrl: url };
    }
    // Extract @lat,lng,zoom from place or coordinate URLs
    const coordMatch = url.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*),(\d+)/);
    if (coordMatch) {
      const [, lat, lng, zoom] = coordMatch;
      return {
        kind: 'googlemaps',
        embedUrl: `https://maps.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`,
      };
    }
    // maps.google.com/maps?q=... — just add output=embed
    try {
      const u = new URL(url);
      u.searchParams.set('output', 'embed');
      return { kind: 'googlemaps', embedUrl: u.toString() };
    } catch {
      return { kind: 'unknown', url };
    }
  }

  // Google Drive / Docs
  if (/drive\.google\.com|docs\.google\.com/.test(url)) {
    let embedUrl: string;
    const openMatch = url.match(/open\?id=([^&]+)/);
    const driveFileMatch = url.match(/\/file\/d\/([^/]+)/);
    const docsMatch = url.match(/docs\.google\.com\/(\w+)\/d\/([^/]+)/);
    if (openMatch) {
      embedUrl = `https://drive.google.com/file/d/${openMatch[1]}/preview`;
    } else if (driveFileMatch) {
      embedUrl = `https://drive.google.com/file/d/${driveFileMatch[1]}/preview`;
    } else if (docsMatch) {
      embedUrl = `https://docs.google.com/${docsMatch[1]}/d/${docsMatch[2]}/preview`;
    } else {
      return { kind: 'unknown', url };
    }
    return { kind: 'googledoc', embedUrl };
  }

  // Flickr photo pages (CDN URLs like staticflickr.com/*.jpg are caught by IMAGE_EXT below)
  if (/flickr\.com\/photos\/|flic\.kr\//.test(url)) {
    return { kind: 'flickr', photoUrl: url };
  }

  // Audio
  if (AUDIO_EXT.test(url)) {
    const ext = url.match(AUDIO_EXT)![1].toLowerCase();
    const mime: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4',
      ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac',
    };
    return { kind: 'audio', src: url, mimeType: mime[ext] };
  }

  // Video file
  if (VIDEO_EXT.test(url)) {
    const ext = url.match(VIDEO_EXT)![1].toLowerCase();
    const mime: Record<string, string> = {
      mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4', ogv: 'video/ogg',
    };
    return { kind: 'video', src: url, mimeType: mime[ext] };
  }

  // PDF
  if (/\.pdf(\?.*)?$/i.test(url)) {
    return { kind: 'pdf', src: url };
  }

  // Image
  if (IMAGE_EXT.test(url)) {
    return { kind: 'image', src: url, alt: media.alt ?? media.caption ?? '' };
  }

  // Catch-all: iframe
  return { kind: 'iframe', src: url };
}

// Backgrounds are always meant to be a plain image (unlike `media`, which can
// be any embed type), so no need to run them through the classification
// above — just a directly-usable URL. blobRef backgrounds aren't hydrated
// here (that needs a PDS endpoint, which callers must resolve themselves).
function backgroundImageUrl(background?: TLBackground): string | undefined {
  const url = background?.url?.trim();
  return url && /^https?:\/\//i.test(url) ? url : undefined;
}

/** Best available plain-image URL for a slide: its background, else its media if that's an image. */
export function pickSlideImageUrl(slide?: TLEvent): string | undefined {
  if (!slide) return undefined;
  const bg = backgroundImageUrl(slide.background);
  if (bg) return bg;
  if (!slide.media) return undefined;
  const resolved = resolveMedia(slide.media);
  return resolved.kind === 'image' ? resolved.src : undefined;
}
