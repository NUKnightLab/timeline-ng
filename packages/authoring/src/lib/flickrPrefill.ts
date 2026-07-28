// Prefills a slide's caption/credit fields from Flickr's oEmbed metadata when an
// author pastes a Flickr photo URL — mirrors the caption TL3 forced onto Flickr
// images, but as an editable starting point rather than a locked-in display.
//
// Flickr's oEmbed endpoint has no CORS headers, so this uses the same JSONP
// script-injection trick as the player's fetchFlickrOEmbed (packages/player/src/
// media/MediaDisplay.svelte) rather than a plain fetch().

interface FlickrOEmbed { title?: string; author_name?: string }

function windowRecord(): Record<string, unknown> {
  return window as unknown as Record<string, unknown>;
}

function fetchFlickrOEmbed(photoUrl: string): Promise<FlickrOEmbed> {
  return new Promise((resolve, reject) => {
    const cb = `_tlFlickrPrefill${Math.random().toString(36).slice(2)}`;
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
      reject(new Error('Flickr embed failed'));
    };
    script.src = `https://www.flickr.com/services/oembed/?url=${encodeURIComponent(photoUrl)}&format=json&jsoncallback=${cb}`;
    document.head.appendChild(script);
  });
}

export interface FlickrPrefill {
  caption?: string;
  credit?: string;
}

export async function fetchFlickrPrefill(photoUrl: string): Promise<FlickrPrefill | null> {
  try {
    const oembed = await fetchFlickrOEmbed(photoUrl);
    if (!oembed.title && !oembed.author_name) return null;
    return {
      caption: oembed.title || undefined,
      credit: oembed.author_name
        ? `<a href="${photoUrl}" target="_blank" rel="noopener noreferrer">${oembed.author_name}</a>`
        : undefined,
    };
  } catch {
    return null;
  }
}
