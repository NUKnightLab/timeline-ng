import { pickSlideImageUrl } from '@knight-lab/timeline-ng-core';
import type { TLEvent, TLTimeline } from '@knight-lab/timeline-ng-core';

// Standard Open Graph image dimensions.
const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 64;

function stripHtml(input?: string): string {
  if (!input) return '';
  const el = document.createElement('div');
  el.innerHTML = input;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

// crossOrigin='anonymous' means a non-CORS-enabled image source fails to
// load at all (onerror) rather than loading-but-tainting the canvas — there's
// no way to read pixel data cross-origin either way, so failing early lets
// the caller fall back to a plain-color card instead of a SecurityError at
// toBlob() time.
function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      if (lines.length === maxLines) return lines;
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(`${result}…`).width > maxWidth) {
    result = result.slice(0, -1).trimEnd();
  }
  return `${result}…`;
}

/**
 * Composes a 1200×630 share-preview poster for a timeline's title slide (or
 * first event, if there's no title slide), using Canvas 2D so it reflects
 * whatever fonts the browser already has loaded — no font bundling needed,
 * unlike server-side rendering. Returns null if there's no slide to render
 * or the browser can't produce a blob (e.g. canvas API unavailable).
 */
export async function generatePoster(timeline: TLTimeline): Promise<Blob | null> {
  const slide: TLEvent | undefined = timeline.title ?? timeline.events[0];
  if (!slide) return null;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = slide.background?.color || '#16213e';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const imageUrl = pickSlideImageUrl(slide);
  let hasImage = false;
  if (imageUrl) {
    const img = await loadImage(imageUrl);
    if (img) {
      const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
      hasImage = true;
    }
  }

  if (hasImage) {
    // Dark scrim so text stays legible over the photo.
    const gradient = ctx.createLinearGradient(0, HEIGHT * 0.35, 0, HEIGHT);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  const headline = stripHtml(slide.text?.headline) || 'Untitled timeline';
  const description = stripHtml(slide.text?.text);
  const maxTextWidth = WIDTH - PADDING * 2;

  let y = HEIGHT - PADDING;

  if (description) {
    ctx.font = '28px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.textBaseline = 'bottom';
    ctx.fillText(truncateToWidth(ctx, description, maxTextWidth), PADDING, y);
    y -= 48;
  }

  ctx.font = 'bold 56px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'bottom';
  const headlineLines = wrapText(ctx, headline, maxTextWidth, 3);
  for (let i = headlineLines.length - 1; i >= 0; i--) {
    ctx.fillText(headlineLines[i], PADDING, y);
    y -= 68;
  }

  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), 'image/png');
    } catch {
      resolve(null);
    }
  });
}
