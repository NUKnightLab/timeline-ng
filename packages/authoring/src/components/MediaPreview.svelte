<script lang="ts">
  import { resolveMedia } from '@knight-lab/timeline-ng-core';
  import DOMPurify from 'dompurify';

  interface Props { url: string; mimeType?: string; }
  let { url, mimeType }: Props = $props();

  const resolved = $derived(resolveMedia({ url: url.trim(), mimeType }));

  interface FlickrOEmbed {
    url: string;
    title?: string;
    author_name?: string;
  }

  interface WikipediaSummary {
    title: string;
    extract: string;
    thumbnail?: { source: string };
  }

  function windowRecord(): Record<string, unknown> {
    return window as unknown as Record<string, unknown>;
  }

  function fetchFlickrOEmbed(photoUrl: string): Promise<FlickrOEmbed> {
    return new Promise((resolve, reject) => {
      const cb = `_tlFlickrPreview${Math.random().toString(36).slice(2)}`;
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

  async function fetchWikipediaSummary(language: string, articleTitle: string): Promise<WikipediaSummary> {
    const encoded = encodeURIComponent(articleTitle.replace(/ /g, '_'));
    const res = await fetch(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
    if (!res.ok) throw new Error('wikipedia fetch failed');
    return res.json();
  }

  // Fair-use/non-free files (e.g. book covers) live only on the local
  // language wiki, not on Commons, so fall back to it when given.
  async function fetchWikimediaImageSrc(fileTitle: string, language?: string): Promise<string> {
    const encoded = encodeURIComponent(fileTitle);
    const hosts = ['commons.wikimedia.org', ...(language ? [`${language}.wikipedia.org`] : [])];
    for (const host of hosts) {
      const apiUrl = `https://${host}/w/api.php?action=query&prop=imageinfo&iiprop=url&iiurlwidth=800&titles=${encoded}&format=json&origin=*`;
      const res = await fetch(apiUrl);
      if (!res.ok) continue;
      const data = await res.json();
      const pages = data.query?.pages ?? {};
      const page = Object.values(pages)[0] as { imageinfo?: Array<{ thumburl?: string; url: string }> };
      const info = page?.imageinfo?.[0];
      const src = info?.thumburl ?? info?.url;
      if (src) return src;
    }
    throw new Error('image not found');
  }

  const wikiImagePromise = $derived(
    resolved.kind === 'wikipediaimage' ? fetchWikimediaImageSrc(resolved.fileTitle, resolved.language) : null
  );
  const flickrPromise = $derived(
    resolved.kind === 'flickr' ? fetchFlickrOEmbed(resolved.photoUrl) : null
  );
  const wikipediaPromise = $derived(
    resolved.kind === 'wikipedia' ? fetchWikipediaSummary(resolved.language, resolved.articleTitle) : null
  );

  function hostLabel(value: string): string {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return 'URL';
    }
  }

  function labelFor(kind: string): string {
    const labels: Record<string, string> = {
      youtube: 'YouTube', vimeo: 'Vimeo', dailymotion: 'Dailymotion', wistia: 'Wistia',
      soundcloud: 'SoundCloud', spotify: 'Spotify', bluesky: 'Bluesky', tiktok: 'TikTok',
      twitter: 'X / Twitter', wikipedia: 'Wikipedia', flickr: 'Flickr',
      googledoc: 'Google Doc', googlemaps: 'Google Maps', iframe: 'URL', pdf: 'PDF',
    };
    return labels[kind] ?? 'URL';
  }

  function sanitizeEmbedHtml(html: string): string {
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['frameborder', 'allowfullscreen', 'target'],
    });
  }
</script>

{#if resolved.kind !== 'unknown'}
  <div class="media-preview">
    {#if resolved.kind === 'embed-markup'}
      <div class="preview-embed-markup">
        {@html sanitizeEmbedHtml(resolved.html)}
      </div>

    {:else if resolved.kind === 'image'}
      <img src={resolved.src} alt="Media preview" class="preview-img" />

    {:else if resolved.kind === 'youtube'}
      <a class="preview-thumb" href="https://www.youtube.com/watch?v={resolved.videoId}" target="_blank" rel="noopener noreferrer" aria-label="Open on YouTube">
        <img src="https://img.youtube.com/vi/{resolved.videoId}/mqdefault.jpg" alt="YouTube thumbnail" class="preview-img" />
        <span class="preview-badge preview-badge--yt">▶ YouTube</span>
      </a>

    {:else if resolved.kind === 'vimeo'}
      <div class="preview-thumb">
        <img src={"https://vumbnail.com/" + resolved.videoId + ".jpg"} alt="Vimeo thumbnail" class="preview-img" />
        <span class="preview-badge preview-badge--dark">Vimeo</span>
      </div>

    {:else if resolved.kind === 'dailymotion'}
      <div class="preview-thumb">
        <img src={"https://www.dailymotion.com/thumbnail/video/" + resolved.videoId} alt="Dailymotion thumbnail" class="preview-img" />
        <span class="preview-badge preview-badge--dark">Dailymotion</span>
      </div>

    {:else if resolved.kind === 'wistia'}
      <div class="preview-card preview-card--brand preview-card--video">
        <span class="preview-card-badge">Wistia</span>
        <strong class="preview-card-title">Embedded video</strong>
        <span class="preview-card-meta">Video preview will render in the slide.</span>
      </div>

    {:else if resolved.kind === 'audio'}
      <audio controls src={resolved.src} class="preview-audio"></audio>

    {:else if resolved.kind === 'video'}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video controls src={resolved.src} class="preview-video" preload="metadata"></video>

    {:else if resolved.kind === 'flickr' && flickrPromise}
      {#await flickrPromise}
        <div class="preview-card preview-card--loading"><span>Loading…</span></div>
      {:then photo}
        <div class="preview-thumb">
          <img src={photo.url} alt={photo.title ?? 'Flickr preview'} class="preview-img" />
          <span class="preview-badge preview-badge--dark">Flickr</span>
          {#if photo.author_name}
            <span class="preview-credit">{photo.author_name}</span>
          {/if}
        </div>
      {:catch}
        <div class="preview-card preview-card--brand">
          <span class="preview-card-badge">Flickr</span>
          <strong class="preview-card-title">Photo embed</strong>
          <span class="preview-card-meta">{hostLabel(resolved.photoUrl)}</span>
        </div>
      {/await}

    {:else if resolved.kind === 'wikipedia' && wikipediaPromise}
      {#await wikipediaPromise}
        <div class="preview-card preview-card--loading"><span>Loading…</span></div>
      {:then article}
        <div class="preview-card preview-card--wiki">
          {#if article.thumbnail}
            <img src={article.thumbnail.source} alt={article.title} class="preview-card-thumb" />
          {/if}
          <div class="preview-card-body">
            <span class="preview-card-badge">Wikipedia</span>
            <strong class="preview-card-title">{article.title}</strong>
            {#if article.extract}
              <span class="preview-card-meta">{article.extract}</span>
            {/if}
          </div>
        </div>
      {:catch}
        <div class="preview-card preview-card--brand">
          <span class="preview-card-badge">Wikipedia</span>
          <strong class="preview-card-title">{resolved.articleTitle}</strong>
          <span class="preview-card-meta">Article summary will appear in the slide.</span>
        </div>
      {/await}

    {:else if resolved.kind === 'wikipediaimage' && wikiImagePromise}
      {#await wikiImagePromise}
        <div class="preview-label"><span class="preview-icon">◈</span><span>Loading…</span></div>
      {:then src}
        <img {src} alt="Wikimedia Commons preview" class="preview-img" />
      {:catch}
        <div class="preview-label"><span class="preview-icon">◈</span><span>Wikipedia image</span></div>
      {/await}

    {:else if resolved.kind === 'soundcloud'}
      <div class="preview-card preview-card--brand preview-card--audio">
        <span class="preview-card-badge">SoundCloud</span>
        <strong class="preview-card-title">Audio embed</strong>
        <span class="preview-card-meta">{hostLabel(resolved.trackUrl)}</span>
      </div>

    {:else if resolved.kind === 'spotify'}
      <div class="preview-card preview-card--brand preview-card--audio">
        <span class="preview-card-badge">Spotify</span>
        <strong class="preview-card-title">Embedded player</strong>
        <span class="preview-card-meta">{hostLabel(resolved.embedUrl)}</span>
      </div>

    {:else if resolved.kind === 'bluesky'}
      <div class="preview-card preview-card--social">
        <span class="preview-card-badge">Bluesky</span>
        <strong class="preview-card-title">@{resolved.handle}</strong>
        <span class="preview-card-meta">{hostLabel(resolved.originalUrl)}</span>
      </div>

    {:else if resolved.kind === 'twitter'}
      <div class="preview-card preview-card--social">
        <span class="preview-card-badge">X / Twitter</span>
        <strong class="preview-card-title">Embedded post</strong>
        <span class="preview-card-meta">{hostLabel(resolved.tweetUrl)}</span>
      </div>

    {:else if resolved.kind === 'tiktok'}
      <div class="preview-card preview-card--social">
        <span class="preview-card-badge">TikTok</span>
        <strong class="preview-card-title">Embedded post</strong>
        <span class="preview-card-meta">{hostLabel(resolved.cleanUrl)}</span>
      </div>

    {:else if resolved.kind === 'googlemaps'}
      <div class="preview-card preview-card--map">
        <span class="preview-card-badge">Google Maps</span>
        <strong class="preview-card-title">Map embed</strong>
        <span class="preview-card-meta">Interactive map preview</span>
      </div>

    {:else if resolved.kind === 'googledoc'}
      <div class="preview-card preview-card--doc">
        <span class="preview-card-badge">Google Drive</span>
        <strong class="preview-card-title">Document preview</strong>
        <span class="preview-card-meta">{hostLabel(resolved.embedUrl)}</span>
      </div>

    {:else if resolved.kind === 'pdf'}
      <div class="preview-card preview-card--doc">
        <span class="preview-card-badge">PDF</span>
        <strong class="preview-card-title">Document preview</strong>
        <span class="preview-card-meta">Rendered inline in the slide.</span>
      </div>

    {:else if resolved.kind === 'iframe'}
      <div class="preview-card preview-card--brand">
        <span class="preview-card-badge">Embed</span>
        <strong class="preview-card-title">{hostLabel(resolved.src)}</strong>
        <span class="preview-card-meta">Embedded content preview</span>
      </div>

    {:else}
      <div class="preview-label preview-label--fallback">
        <span class="preview-icon">◈</span>
        <span class="preview-label-text">{labelFor(resolved.kind)}</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .media-preview {
    border: 1px solid #e8e8e8;
    border-radius: 4px;
    overflow: hidden;
  }

  .preview-img {
    display: block;
    max-width: 100%;
    max-height: 320px;
    width: auto;
    height: auto;
    margin: 0 auto;
  }

  .preview-embed-markup {
    padding: 0.9rem 1rem;
    background: #f7f7f7;
  }

  .preview-embed-markup :global(blockquote) {
    margin: 0 !important;
    padding: 0.9rem 1rem !important;
    border: none !important;
    border-left: 4px solid #dddddd !important;
    border-radius: 0 4px 4px 0;
    background: #fff !important;
    color: #222 !important;
    font-family: system-ui, sans-serif !important;
    font-size: 1.15em !important;
    font-weight: normal !important;
    font-style: normal !important;
    line-height: 1.4 !important;
    quotes: none !important;
  }

  .preview-embed-markup :global(blockquote cite::before) {
    content: none !important;
  }

  .preview-embed-markup :global(blockquote cite) {
    display: block;
    font-size: 0.8em;
    font-style: italic;
    color: #666;
    text-align: right;
    margin-top: 0.6em;
  }

  .preview-thumb { position: relative; display: block; }
  .preview-badge {
    position: absolute;
    bottom: 6px;
    left: 6px;
    font-size: 0.7rem;
    font-weight: 700;
    padding: 2px 6px;
    border-radius: 3px;
    text-shadow: none;
  }
  .preview-badge--yt { background: #ff0000; color: #fff; }
  .preview-badge--dark { background: rgba(17, 17, 17, 0.78); color: #fff; }
  .preview-credit {
    position: absolute;
    right: 6px;
    bottom: 6px;
    max-width: calc(100% - 7rem);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.66rem;
    color: #fff;
    padding: 2px 6px;
    border-radius: 3px;
    background: rgba(17, 17, 17, 0.7);
  }

  .preview-card {
    min-height: 8rem;
    display: flex;
    align-items: stretch;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.92), rgba(244,244,244,0.96)),
      #f4f4f4;
  }
  .preview-card--brand,
  .preview-card--social,
  .preview-card--doc,
  .preview-card--map,
  .preview-card--audio,
  .preview-card--video {
    flex-direction: column;
    justify-content: flex-end;
    padding: 0.85rem;
    gap: 0.35rem;
  }
  .preview-card--social {
    background:
      linear-gradient(180deg, rgba(255,255,255,0.96), rgba(237,242,247,0.98)),
      #edf2f7;
  }
  .preview-card--doc {
    background:
      linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,245,240,0.98)),
      #f8f5f0;
  }
  .preview-card--map {
    background:
      linear-gradient(135deg, rgba(235,244,255,0.9), rgba(243,250,244,0.96)),
      #eef5f0;
  }
  .preview-card--audio {
    background:
      linear-gradient(180deg, rgba(255,255,255,0.96), rgba(247,243,238,0.98)),
      #f7f3ee;
  }
  .preview-card--loading {
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 0.82rem;
  }
  .preview-card--wiki {
    min-height: 8.5rem;
  }
  .preview-card-thumb {
    width: 38%;
    min-width: 8.5rem;
    object-fit: cover;
    background: #ddd;
  }
  .preview-card-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    gap: 0.35rem;
    padding: 0.85rem;
  }
  .preview-card-badge {
    font-size: 0.64rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #6b7280;
  }
  .preview-card-title {
    font-size: 0.94rem;
    color: #222;
    line-height: 1.25;
  }
  .preview-card-meta {
    font-size: 0.74rem;
    color: #5f6368;
    line-height: 1.4;
    line-clamp: 3;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .preview-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.6rem 0.75rem;
    font-size: 0.85rem;
    color: #444;
    text-decoration: none;
  }
  .preview-label--fallback {
    min-height: 5.25rem;
    padding: 1.15rem 4.1rem 3.15rem 4rem;
  }
  .preview-label-text {
    min-width: 0;
  }
  .preview-label--fallback .preview-label-text {
    display: block;
    text-align: center;
    width: 100%;
  }
  .preview-label:hover { background: #f5f5f5; color: #13a4df; }
  .preview-icon { font-size: 1.1rem; color: #888; }

  .preview-audio {
    display: block;
    width: 100%;
    padding: 0.5rem;
  }

  .preview-video {
    display: block;
    width: 100%;
    max-height: 280px;
    background: #111;
  }
</style>
