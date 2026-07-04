import { resolveMedia, type ResolvedMedia } from '@knight-lab/timeline-ng-core';

export interface MediaInputDescriptor {
  resolved: ResolvedMedia;
  isEmbedMarkup: boolean;
  preferMultiline: boolean;
  isValid: boolean;
  showSourceLink: boolean;
  sourceLabel: string;
}

export function describeMediaInput(url: string, mimeType?: string): MediaInputDescriptor {
  const trimmed = url.trim();
  const resolved = resolveMedia({ url: trimmed, mimeType });
  const isEmbedMarkup = resolved.kind === 'embed-markup' || resolved.kind === 'iframe';
  const isHttpUrl = (() => {
    try {
      const parsed = new URL(trimmed);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  })();

  let sourceLabel = '';
  if (isEmbedMarkup) {
    sourceLabel = resolved.kind === 'embed-markup' ? 'embed markup' : 'iframe embed';
  } else {
    try {
      sourceLabel = new URL(trimmed).hostname.replace(/^www\./, '');
    } catch {
      sourceLabel = trimmed.length > 44 ? trimmed.slice(0, 41) + '…' : trimmed;
    }
  }

  return {
    resolved,
    isEmbedMarkup,
    preferMultiline: isEmbedMarkup,
    isValid: !trimmed || isEmbedMarkup || isHttpUrl,
    showSourceLink: !!trimmed && !isEmbedMarkup,
    sourceLabel,
  };
}
