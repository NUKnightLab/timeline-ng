// Prefills a slide's caption/credit fields from Wikipedia/Wikimedia Commons file
// metadata when an author pastes a wikipediaimage URL — mirrors the caption TL3 used
// to force onto Wikipedia-sourced images, but as an editable starting point rather
// than a locked-in display.

function stripHtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? '').trim();
}

export interface WikipediaImagePrefill {
  caption?: string;
  credit?: string;
}

interface ExtMetadataField { value?: string }
interface ImageInfoEntry {
  descriptionurl?: string;
  extmetadata?: Record<string, ExtMetadataField>;
}
interface QueryPage { imageinfo?: ImageInfoEntry[] }

export async function fetchWikipediaImagePrefill(
  fileTitle: string,
  language?: string
): Promise<WikipediaImagePrefill | null> {
  const encoded = encodeURIComponent(fileTitle);
  const hosts = ['commons.wikimedia.org', ...(language ? [`${language}.wikipedia.org`] : [])];
  for (const host of hosts) {
    const url = `https://${host}/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&titles=${encoded}&format=json&origin=*`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data.query?.pages ?? {};
      const page = Object.values(pages)[0] as QueryPage | undefined;
      const info = page?.imageinfo?.[0];
      const meta = info?.extmetadata;
      if (!info || !meta) continue;

      const description = meta.ImageDescription?.value ? stripHtml(meta.ImageDescription.value) : '';
      const artist = meta.Artist?.value ? stripHtml(meta.Artist.value) : '';
      const sourceUrl = info.descriptionurl ?? `https://${host}/wiki/${encoded}`;
      const siteName = host.startsWith('commons') ? 'Wikimedia Commons' : 'Wikipedia';
      const linkLabel = artist ? `${artist} via ${siteName}` : siteName;

      return {
        caption: description || undefined,
        credit: `<a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">${linkLabel}</a>`,
      };
    } catch {
      continue;
    }
  }
  return null;
}
