<script lang="ts">
  import { resolveMedia, type ResolvedMedia } from '@knight-lab/timeline-ng-core';
  import { getLocale, getMessage } from '@knight-lab/timeline-ng-core';
  import { sanitizeHtml } from '../lib/sanitize.js';
  import type { TLMedia } from '@knight-lab/timeline-ng-core';

  interface Props {
    media: TLMedia;
    locale?: string;
  }

  let { media, locale = 'en' }: Props = $props();

  const tl = $derived(getLocale(locale));
  const resolved: ResolvedMedia = $derived(resolveMedia(media));

  // ── Async fetch helpers ────────────────────────────────────────────────────

  interface BlueskyAuthor { handle: string; displayName?: string; avatar?: string }
  interface BlueskyImage { thumb: string; fullsize: string; alt?: string }
  interface BlueskyExternal {
    uri: string;
    title?: string;
    description?: string;
    thumb?: string;
  }
  interface BlueskyRecordView {
    author: BlueskyAuthor;
    value?: { text?: string };
    uri?: string;
  }
  interface BlueskyEmbedView {
    $type?: string;
    images?: BlueskyImage[];
    external?: BlueskyExternal;
    media?: BlueskyEmbedView;
    record?: BlueskyRecordView | { record?: BlueskyRecordView };
    thumbnail?: string;
    alt?: string;
    playlist?: string;
  }
  interface BlueskyPostData {
    author: BlueskyAuthor;
    record: { text: string };
    embed?: BlueskyEmbedView;
  }

  async function fetchBlueskyPost(handle: string, postId: string): Promise<BlueskyPostData> {
    const uri = encodeURIComponent(`at://${handle}/app.bsky.feed.post/${postId}`);
    const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${uri}`);
    if (!res.ok) throw new Error('bluesky fetch failed');
    const data = await res.json();
    return data.thread?.post as BlueskyPostData;
  }

  async function fetchTwitterOEmbed(tweetUrl: string): Promise<{ html: string }> {
    const endpoint = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true&dnt=true`;
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('twitter fetch failed');
    return res.json();
  }

  interface FlickrOEmbed { url: string; title?: string; author_name?: string; author_url?: string }
  function windowRecord(): Record<string, unknown> {
    return window as unknown as Record<string, unknown>;
  }
  function fetchFlickrOEmbed(photoUrl: string): Promise<FlickrOEmbed> {
    return new Promise((resolve, reject) => {
      const cb = `_tlFlickr${Math.random().toString(36).slice(2)}`;
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

  async function fetchSoundCloudOEmbed(trackUrl: string): Promise<{ html: string }> {
    const res = await fetch(`https://soundcloud.com/oembed?url=${encodeURIComponent(trackUrl)}&format=json`);
    if (!res.ok) throw new Error('soundcloud fetch failed');
    return res.json();
  }

  interface WikipediaSummary {
    title: string;
    extract: string;
    thumbnail?: { source: string };
    content_urls: { desktop: { page: string } };
  }
  async function fetchWikipediaSummary(language: string, articleTitle: string): Promise<WikipediaSummary> {
    const encoded = encodeURIComponent(articleTitle.replace(/ /g, '_'));
    const res = await fetch(`https://${language}.wikipedia.org/api/rest_v1/page/summary/${encoded}`);
    if (!res.ok) throw new Error('wikipedia fetch failed');
    return res.json();
  }

  interface WikipediaImageResult { src: string; label: string }
  async function fetchWikipediaImage(fileTitle: string): Promise<WikipediaImageResult> {
    const encoded = encodeURIComponent(fileTitle);
    const url = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=1200&titles=${encoded}&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('wikimedia fetch failed');
    const data = await res.json();
    const pages = data.query?.pages ?? {};
    const page = Object.values(pages)[0] as { title?: string; imageinfo?: Array<{ url: string }> };
    const imgUrl = page?.imageinfo?.[0]?.url;
    if (!imgUrl) throw new Error('image not found');
    return { src: imgUrl, label: (page.title ?? fileTitle).replace('File:', '') };
  }

  // Strip <script> tags from oEmbed HTML before injecting
  function stripScripts(html: string): string {
    return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script\s*>/gi, '');
  }

  function hostLabel(value: string): string {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch {
      return value;
    }
  }

  function blueskyServiceLabel(url: string): string {
    const host = hostLabel(url);
    if (host === 'bsky.app') return 'Bluesky';
    if (host === 'blacksky.community') return 'Blacksky';
    return host;
  }

  function blueskyImages(embed: BlueskyEmbedView | undefined): BlueskyImage[] {
    if (!embed) return [];
    if (embed.images?.length) return embed.images;
    if (embed.media) return blueskyImages(embed.media);
    return [];
  }

  function blueskyExternal(embed: BlueskyEmbedView | undefined): BlueskyExternal | null {
    if (!embed) return null;
    if (embed.external?.uri) return embed.external;
    if (embed.media) return blueskyExternal(embed.media);
    return null;
  }

  function blueskyQuotedRecord(embed: BlueskyEmbedView | undefined): BlueskyRecordView | null {
    if (!embed?.record) return null;
    if ('author' in embed.record) return embed.record;
    return embed.record.record ?? null;
  }

  function blueskyVideoThumbnail(embed: BlueskyEmbedView | undefined): { thumbnail: string; alt?: string; playlist?: string } | null {
    if (!embed) return null;
    if (embed.thumbnail) return { thumbnail: embed.thumbnail, alt: embed.alt, playlist: embed.playlist };
    if (embed.media) return blueskyVideoThumbnail(embed.media);
    return null;
  }

  // Svelte action: load Twitter widgets.js and activate embeds in the node
  function twitterWidget(node: HTMLElement) {
    const w = window as unknown as { twttr?: { widgets?: { load: (el: HTMLElement) => void } } };
    const activate = () => w.twttr?.widgets?.load(node);
    if (w.twttr?.widgets) {
      activate();
      return {};
    }
    if (!document.querySelector('script[src*="platform.twitter.com/widgets.js"]')) {
      const s = document.createElement('script');
      s.src = 'https://platform.twitter.com/widgets.js';
      s.async = true;
      s.onload = activate;
      document.head.appendChild(s);
    } else {
      const interval = setInterval(() => {
        if (w.twttr?.widgets) { clearInterval(interval); activate(); }
      }, 100);
      return { destroy: () => clearInterval(interval) };
    }
    return {};
  }

  // ── Per-type derived promises ──────────────────────────────────────────────

  let flickrPromise = $derived(
    resolved.kind === 'flickr'
      ? fetchFlickrOEmbed(resolved.photoUrl)
      : null
  );
  let soundcloudPromise = $derived(
    resolved.kind === 'soundcloud'
      ? fetchSoundCloudOEmbed(resolved.trackUrl)
      : null
  );
  let blueskyPromise = $derived(
    resolved.kind === 'bluesky'
      ? fetchBlueskyPost(resolved.handle, resolved.postId)
      : null
  );
  let twitterPromise = $derived(
    resolved.kind === 'twitter'
      ? fetchTwitterOEmbed(resolved.tweetUrl)
      : null
  );
  let wikipediaPromise = $derived(
    resolved.kind === 'wikipedia'
      ? fetchWikipediaSummary(resolved.language, resolved.articleTitle)
      : null
  );
  let wikiImagePromise = $derived(
    resolved.kind === 'wikipediaimage'
      ? fetchWikipediaImage(resolved.fileTitle)
      : null
  );
</script>

{#if resolved.kind === 'embed-markup'}
  <div class="tl-media tl-media--embed-markup">
    {@html sanitizeHtml(resolved.html)}
  </div>

{:else if resolved.kind === 'image'}
  <img
    class="tl-media tl-media--image"
    src={resolved.src}
    alt={resolved.alt}
    loading="lazy"
  />

{:else if resolved.kind === 'youtube'}
  {@const params = new URLSearchParams({ rel: '0', modestbranding: '1', enablejsapi: '1' })}
  {#if resolved.start != null} {params.set('start', String(resolved.start))} {/if}
  {#if resolved.end != null} {params.set('end', String(resolved.end))} {/if}
  <div class="tl-media tl-media--video">
    <iframe
      src="https://www.youtube.com/embed/{resolved.videoId}?{params.toString()}"
      title="YouTube video"
      loading="lazy"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
      allowfullscreen
    ></iframe>
  </div>

{:else if resolved.kind === 'vimeo'}
  {@const vimeoParams = new URLSearchParams({ title: '0', byline: '0', portrait: '0', color: 'ffffff' })}
  {#if resolved.start} {vimeoParams.set('t', resolved.start)} {/if}
  <div class="tl-media tl-media--video">
    <iframe
      src="https://player.vimeo.com/video/{resolved.videoId}?{vimeoParams.toString()}"
      title="Vimeo video"
      loading="lazy"
      allow="autoplay; fullscreen; picture-in-picture"
      allowfullscreen
    ></iframe>
  </div>

{:else if resolved.kind === 'dailymotion'}
  <div class="tl-media tl-media--video">
    <iframe
      src="https://www.dailymotion.com/embed/video/{resolved.videoId}?api=postMessage"
      title="Dailymotion video"
      loading="lazy"
      allow="autoplay; fullscreen"
      allowfullscreen
    ></iframe>
  </div>

{:else if resolved.kind === 'wistia'}
  <div class="tl-media tl-media--video">
    <iframe
      src="https://fast.wistia.com/embed/iframe/{resolved.videoId}?version=v1&controlsVisibleOnLoad=true&playerColor=aae3d8"
      title="Wistia video"
      loading="lazy"
      allow="autoplay; fullscreen"
      allowfullscreen
    ></iframe>
  </div>

{:else if resolved.kind === 'audio'}
  <audio class="tl-media tl-media--audio" controls>
    <source src={resolved.src} type={resolved.mimeType} />
    Your browser does not support HTML5 audio.
  </audio>

{:else if resolved.kind === 'video'}
  <video class="tl-media tl-media--video-file" controls>
    <source src={resolved.src} type={resolved.mimeType} />
    Your browser does not support HTML5 video.
  </video>

{:else if resolved.kind === 'pdf'}
  <div class="tl-media tl-media--pdf">
    <iframe
      src={resolved.src}
      title="PDF document"
      loading="lazy"
    ></iframe>
  </div>

{:else if resolved.kind === 'soundcloud' && soundcloudPromise}
  {#await soundcloudPromise}
    <div class="tl-media tl-media--soundcloud tl-media--loading" aria-busy="true">
      <span>{getMessage(tl, 'loading')}</span>
    </div>
  {:then oembed}
    <div class="tl-media tl-media--soundcloud">
      {@html sanitizeHtml(stripScripts(oembed.html))}
    </div>
  {:catch}
    <div class="tl-media tl-media--soundcloud tl-media--error">
      <a href={resolved.trackUrl} target="_blank" rel="noopener noreferrer">Listen on SoundCloud</a>
    </div>
  {/await}

{:else if resolved.kind === 'spotify'}
  <div class="tl-media tl-media--spotify">
    <iframe
      src={resolved.embedUrl}
      title="Spotify player"
      loading="lazy"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      allowfullscreen
    ></iframe>
  </div>

{:else if resolved.kind === 'googledoc'}
  <div class="tl-media tl-media--googledoc">
    <iframe
      src={resolved.embedUrl}
      title="Google Drive document"
      loading="lazy"
      allow="autoplay"
    ></iframe>
  </div>

{:else if resolved.kind === 'googlemaps'}
  <div class="tl-media tl-media--googlemaps">
    <iframe
      src={resolved.embedUrl}
      title="Google Maps"
      loading="lazy"
      referrerpolicy="no-referrer-when-downgrade"
    ></iframe>
  </div>

{:else if resolved.kind === 'flickr' && flickrPromise}
  {#await flickrPromise}
    <div class="tl-media tl-media--loading" aria-busy="true">
      <span>{getMessage(tl, 'loading')}</span>
    </div>
  {:then photo}
    <a class="tl-media tl-media--flickr" href={resolved.photoUrl} target="_blank" rel="noopener noreferrer">
      <img src={photo.url} alt={media.alt ?? media.caption ?? photo.title ?? ''} loading="lazy" />
      {#if photo.author_name}
        <span class="tl-flickr__credit">{photo.author_name}</span>
      {/if}
    </a>
  {:catch}
    <div class="tl-media tl-media--error">
      <a href={resolved.photoUrl} target="_blank" rel="noopener noreferrer">{getMessage(tl, 'media.error')}</a>
    </div>
  {/await}

{:else if resolved.kind === 'bluesky' && blueskyPromise}
  {#await blueskyPromise}
    <div class="tl-media tl-media--bluesky tl-media--loading" aria-busy="true">
      <span>{getMessage(tl, 'loading')}</span>
    </div>
  {:then post}
    {@const images = blueskyImages(post.embed)}
    {@const external = blueskyExternal(post.embed)}
    {@const quoted = blueskyQuotedRecord(post.embed)}
    {@const video = blueskyVideoThumbnail(post.embed)}
    {@const serviceLabel = blueskyServiceLabel(resolved.originalUrl)}
    <div class="tl-media tl-media--bluesky">
      <div class="tl-bsky__author">
        {#if post.author.avatar}
          <img class="tl-bsky__avatar" src={post.author.avatar} alt="" aria-hidden="true" />
        {/if}
        <div class="tl-bsky__names">
          <strong class="tl-bsky__display-name">{post.author.displayName ?? post.author.handle}</strong>
          <span class="tl-bsky__handle">@{post.author.handle}</span>
        </div>
      </div>
      {#if post.record.text}
        <p class="tl-bsky__text">{post.record.text}</p>
      {/if}
      {#if images.length}
        <div class="tl-bsky__images">
          {#each images as img}
            <img src={img.thumb} alt={img.alt ?? ''} loading="lazy" class="tl-bsky__image" />
          {/each}
        </div>
      {/if}
      {#if video}
        <a class="tl-bsky__video-card" href={resolved.originalUrl} target="_blank" rel="noopener noreferrer">
          <img class="tl-bsky__video-thumb" src={video.thumbnail} alt={video.alt ?? 'Bluesky video preview'} loading="lazy" />
          <span class="tl-bsky__video-badge">Video</span>
        </a>
      {/if}
      {#if external}
        <a class="tl-bsky__external-card" href={external.uri} target="_blank" rel="noopener noreferrer">
          {#if external.thumb}
            <img class="tl-bsky__external-thumb" src={external.thumb} alt="" aria-hidden="true" loading="lazy" />
          {/if}
          <div class="tl-bsky__external-body">
            {#if external.title}
              <strong class="tl-bsky__external-title">{external.title}</strong>
            {/if}
            {#if external.description}
              <p class="tl-bsky__external-description">{external.description}</p>
            {/if}
            <span class="tl-bsky__external-url">{hostLabel(external.uri)}</span>
          </div>
        </a>
      {/if}
      {#if quoted}
        <div class="tl-bsky__quote">
          <strong class="tl-bsky__quote-author">@{quoted.author.handle}</strong>
          {#if quoted.value?.text}
            <p class="tl-bsky__quote-text">{quoted.value.text}</p>
          {/if}
        </div>
      {/if}
      <a class="tl-bsky__link" href={resolved.originalUrl} target="_blank" rel="noopener noreferrer">
        {getMessage(tl, 'media.view_post_on', { service: serviceLabel })}
      </a>
    </div>
  {:catch}
    <div class="tl-media tl-media--bluesky tl-media--error">
      <a href={resolved.originalUrl} target="_blank" rel="noopener noreferrer">
        {getMessage(tl, 'media.view_post_on', { service: blueskyServiceLabel(resolved.originalUrl) })}
      </a>
    </div>
  {/await}

{:else if resolved.kind === 'twitter' && twitterPromise}
  {#await twitterPromise}
    <div class="tl-media tl-media--twitter tl-media--loading" aria-busy="true">
      <span>{getMessage(tl, 'loading')}</span>
    </div>
  {:then oembed}
    <div class="tl-media tl-media--twitter" use:twitterWidget>
      {@html sanitizeHtml(stripScripts(oembed.html))}
    </div>
  {:catch}
    <div class="tl-media tl-media--twitter tl-media--error">
      <a href={resolved.tweetUrl} target="_blank" rel="noopener noreferrer">
        {getMessage(tl, 'media.view_twitter')}
      </a>
    </div>
  {/await}

{:else if resolved.kind === 'tiktok'}
  <div class="tl-media tl-media--tiktok">
    <div class="tl-tiktok__frame">
      <iframe
        src={resolved.embedUrl}
        title={`TikTok video by @${resolved.handle}`}
        loading="lazy"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowfullscreen
      ></iframe>
    </div>
    <a class="tl-tiktok__link" href={resolved.cleanUrl} target="_blank" rel="noopener noreferrer">
      {getMessage(tl, 'media.view_tiktok')}
    </a>
  </div>

{:else if resolved.kind === 'wikipedia' && wikipediaPromise}
  {#await wikipediaPromise}
    <div class="tl-media tl-media--wikipedia tl-media--loading" aria-busy="true">
      <span>{getMessage(tl, 'loading')}</span>
    </div>
  {:then article}
    <div class="tl-media tl-media--wikipedia">
      {#if article.thumbnail}
        <img class="tl-wiki__thumbnail" src={article.thumbnail.source} alt={article.title} loading="lazy" />
      {/if}
      <div class="tl-wiki__body">
        <strong class="tl-wiki__title">{article.title}</strong>
        <p class="tl-wiki__extract">{article.extract}</p>
        <a class="tl-wiki__link" href={article.content_urls.desktop.page} target="_blank" rel="noopener noreferrer">
          {getMessage(tl, 'media.read_wikipedia')}
        </a>
      </div>
    </div>
  {:catch}
    <div class="tl-media tl-media--wikipedia tl-media--error">
      <a href={resolved.articleUrl} target="_blank" rel="noopener noreferrer">
        {getMessage(tl, 'media.read_wikipedia')}
      </a>
    </div>
  {/await}

{:else if resolved.kind === 'wikipediaimage' && wikiImagePromise}
  {#await wikiImagePromise}
    <div class="tl-media tl-media--loading" aria-busy="true">
      <span>{getMessage(tl, 'loading')}</span>
    </div>
  {:then img}
    <img
      class="tl-media tl-media--image"
      src={img.src}
      alt={media.alt ?? media.caption ?? img.label}
      loading="lazy"
    />
  {:catch}
    <div class="tl-media tl-media--error">
      <span>{getMessage(tl, 'media.error')}</span>
    </div>
  {/await}

{:else if resolved.kind === 'iframe'}
  <div class="tl-media tl-media--iframe">
    <iframe
      src={resolved.src}
      title="Embedded content"
      loading="lazy"
      sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"
    ></iframe>
  </div>

{:else if resolved.kind === 'unknown'}
  <div class="tl-media tl-media--unknown">
    <a href={resolved.url} target="_blank" rel="noopener noreferrer">{resolved.url}</a>
  </div>
{/if}

<style>
  /* ── Images ────────────────────────────────────────────────── */
  .tl-media--image {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--tl-radius);
    object-fit: contain;
  }

  /* ── 16:9 video containers ──────────────────────────────────── */
  .tl-media--video {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--tl-radius);
    overflow: hidden;
    background: #000;
  }

  .tl-media--video iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }

  /* ── Native video file ──────────────────────────────────────── */
  .tl-media--video-file {
    width: 100%;
    height: auto;
    border-radius: var(--tl-radius);
  }

  /* ── Audio ──────────────────────────────────────────────────── */
  .tl-media--audio {
    width: 100%;
  }

  /* ── SoundCloud ─────────────────────────────────────────────── */
  .tl-media--soundcloud {
    width: 100%;
    border-radius: var(--tl-radius);
    overflow: hidden;
  }

  /* oEmbed returns a sized iframe — make it fill our width */
  .tl-media--soundcloud :global(iframe) {
    width: 100% !important;
    border: 0;
    display: block;
  }

  /* ── Spotify ────────────────────────────────────────────────── */
  .tl-media--spotify {
    width: 100%;
    height: 352px;
    border-radius: var(--tl-radius);
    overflow: hidden;
  }

  .tl-media--spotify iframe {
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: var(--tl-radius);
  }

  /* ── PDF / GoogleDoc / GoogleMaps ───────────────────────────── */
  .tl-media--pdf,
  .tl-media--googledoc,
  .tl-media--googlemaps {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    border-radius: var(--tl-radius);
    overflow: hidden;
    background: var(--tl-color-surface);
  }

  .tl-media--pdf iframe,
  .tl-media--googledoc iframe,
  .tl-media--googlemaps iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }

  /* ── Embed markup (blockquote, iframe HTML) ─────────────────── */
  .tl-media--embed-markup :global(blockquote) {
    margin: 0;
    padding: 1rem 1.25rem;
    border-left: 4px solid var(--tl-color-border, #dddddd);
    background: var(--tl-color-surface);
    border-radius: 0 var(--tl-radius) var(--tl-radius) 0;
    color: var(--tl-color-text);
    font-size: 1.15em;
    font-style: normal;
    line-height: 1.4;
    quotes: none;
  }

  .tl-media--embed-markup :global(blockquote cite) {
    display: block;
    font-size: 0.8em;
    font-style: italic;
    color: var(--tl-color-text-muted);
    text-align: right;
    margin-top: 0.6em;
  }

  /* ── Flickr ─────────────────────────────────────────────────── */
  .tl-media--flickr {
    display: block;
    position: relative;
    text-decoration: none;
  }

  .tl-media--flickr img {
    display: block;
    width: 100%;
    height: auto;
    border-radius: var(--tl-radius);
  }

  .tl-flickr__credit {
    display: block;
    font-size: 0.7rem;
    color: var(--tl-color-text-muted);
    text-align: right;
    padding-top: 0.2rem;
  }

  /* ── Bluesky card ───────────────────────────────────────────── */
  .tl-media--bluesky {
    --tl-bsky-card-bg: rgba(255, 255, 255, 0.96);
    --tl-bsky-card-border: rgba(17, 17, 17, 0.12);
    --tl-bsky-card-text: #16181c;
    --tl-bsky-card-muted: #536471;
    --tl-bsky-card-link: #0a66c2;
    border: 1px solid var(--tl-bsky-card-border);
    border-radius: var(--tl-radius);
    padding: 1rem;
    background: var(--tl-bsky-card-bg);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    font-size: 0.9rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  }

  .tl-bsky__author {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .tl-bsky__avatar {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
  }

  .tl-bsky__names {
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .tl-bsky__display-name { color: var(--tl-bsky-card-text); }
  .tl-bsky__handle { color: var(--tl-bsky-card-muted); font-size: 0.8rem; }

  .tl-bsky__text {
    margin: 0;
    color: var(--tl-bsky-card-text);
    line-height: 1.5;
    white-space: pre-wrap;
  }

  .tl-bsky__images {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .tl-bsky__image {
    flex: 1 1 45%;
    max-height: 200px;
    object-fit: cover;
    border-radius: calc(var(--tl-radius) / 2);
  }

  .tl-bsky__video-card,
  .tl-bsky__external-card {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    border: 1px solid var(--tl-bsky-card-border);
    border-radius: calc(var(--tl-radius) - 1px);
    overflow: hidden;
    background: rgba(255, 255, 255, 0.9);
    color: inherit;
  }

  .tl-bsky__video-card {
    position: relative;
  }

  .tl-bsky__video-thumb,
  .tl-bsky__external-thumb {
    display: block;
    width: 100%;
    max-height: 220px;
    object-fit: cover;
  }

  .tl-bsky__video-badge {
    position: absolute;
    right: 0.65rem;
    bottom: 0.65rem;
    background: rgba(0, 0, 0, 0.78);
    color: #fff;
    font-size: 0.75rem;
    line-height: 1;
    padding: 0.4rem 0.55rem;
    border-radius: 999px;
  }

  .tl-bsky__external-body {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0 0.75rem 0.75rem;
  }

  .tl-bsky__external-title,
  .tl-bsky__quote-author {
    color: var(--tl-bsky-card-text);
  }

  .tl-bsky__external-description,
  .tl-bsky__quote-text {
    margin: 0;
    color: var(--tl-bsky-card-muted);
    line-height: 1.45;
  }

  .tl-bsky__external-url {
    color: var(--tl-bsky-card-link);
    font-size: 0.78rem;
  }

  .tl-bsky__quote {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding: 0.7rem 0.8rem;
    border-left: 3px solid rgba(10, 102, 194, 0.3);
    background: rgba(10, 102, 194, 0.05);
    border-radius: 0 calc(var(--tl-radius) - 1px) calc(var(--tl-radius) - 1px) 0;
  }

  .tl-bsky__link {
    font-size: 0.8rem;
    color: var(--tl-bsky-card-link);
    text-decoration: none;
  }

  .tl-bsky__link:hover { text-decoration: underline; }

  /* ── Twitter / X ────────────────────────────────────────────── */
  .tl-media--twitter {
    width: 100%;
  }

  /* Twitter's widget overrides our width — contain it */
  .tl-media--twitter :global(.twitter-tweet) {
    margin: 0 !important;
    max-width: 100% !important;
  }

  /* ── TikTok ─────────────────────────────────────────────────── */
  .tl-media--tiktok {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    justify-content: center;
  }

  .tl-tiktok__frame {
    position: relative;
    width: min(100%, 360px);
    aspect-ratio: 9 / 16;
    max-height: calc(100dvh - var(--tl-nav-height, 80px) - 10rem);
    border-radius: var(--tl-radius);
    overflow: hidden;
    background: #111;
    border: 1px solid var(--tl-color-border, rgba(255,255,255,0.14));
  }

  .tl-tiktok__frame iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: #111;
  }

  .tl-tiktok__link {
    font-size: 0.78rem;
    line-height: 1.3;
    color: var(--tl-color-accent, #1185fe);
    text-decoration: none;
  }

  .tl-tiktok__link:hover {
    text-decoration: underline;
  }

  /* ── Wikipedia card ─────────────────────────────────────────── */
  .tl-media--wikipedia {
    display: flex;
    gap: 1rem;
    border: 1px solid var(--tl-color-border, #ddd);
    border-radius: var(--tl-radius);
    padding: 1rem;
    background: var(--tl-color-surface);
    font-size: 0.9rem;
  }

  .tl-wiki__thumbnail {
    width: 6rem;
    height: 6rem;
    object-fit: cover;
    border-radius: calc(var(--tl-radius) / 2);
    flex-shrink: 0;
  }

  .tl-wiki__body {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .tl-wiki__title {
    color: var(--tl-color-text);
    font-size: 1rem;
  }

  .tl-wiki__extract {
    margin: 0;
    color: var(--tl-color-text-muted);
    line-height: 1.5;
    /* Show up to ~4 lines then clip */
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .tl-wiki__link {
    font-size: 0.8rem;
    color: var(--tl-color-accent, #1185fe);
    text-decoration: none;
    margin-top: auto;
  }

  .tl-wiki__link:hover { text-decoration: underline; }

  /* ── Catch-all iframe ───────────────────────────────────────── */
  .tl-media--iframe {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    border-radius: var(--tl-radius);
    overflow: hidden;
  }

  .tl-media--iframe iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }

  /* ── Loading / error states ─────────────────────────────────── */
  .tl-media--loading,
  .tl-media--error {
    min-height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--tl-color-text-muted);
    border: 1px dashed var(--tl-color-border, #ddd);
    border-radius: var(--tl-radius);
    padding: 1rem;
    font-size: 0.85rem;
  }

  /* ── Unknown fallback ───────────────────────────────────────── */
  .tl-media--unknown {
    font-size: 0.8rem;
    word-break: break-all;
    color: var(--tl-color-text-muted);
    padding: 0.5rem;
  }
</style>
