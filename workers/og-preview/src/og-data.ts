import { pickSlideImageUrl } from '@knight-lab/timeline-ng-core';
import type { TLTimeline } from '@knight-lab/timeline-ng-core';

export interface OgData {
  title: string;
  description: string;
  image?: string;
}

function stripHtml(input?: string): string {
  if (!input) return '';
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

export function extractOgData(timeline: TLTimeline): OgData {
  const titleSlide = timeline.title;
  const firstEvent = timeline.events[0];

  const headlineSource = titleSlide?.text?.headline || firstEvent?.text?.headline;
  const title = stripHtml(headlineSource) || 'Timeline';

  const textSource = titleSlide?.text?.text || firstEvent?.text?.text;
  const description = truncate(stripHtml(textSource), 200);

  // An auto-generated (or eventually user-set) poster always wins over
  // extracting from a slide — it's hydrated onto settings.ogImage.url by
  // atproto.ts's at:// resolution, since only that path has PDS/DID context
  // to turn a blobRef into a fetchable URL.
  const image = timeline.settings?.ogImage?.url
    ?? pickSlideImageUrl(titleSlide)
    ?? pickSlideImageUrl(firstEvent);

  return { title, description, image };
}
