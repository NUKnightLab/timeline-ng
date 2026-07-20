import type { OgData } from './og-data.ts';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export function renderPreviewPage(
  og: OgData, pageUrl: string, embedUrl: string, options: { debug?: boolean } = {},
): string {
  const title = escapeHtml(og.title);
  const description = escapeHtml(og.description);
  const imageTag = og.image
    ? `<meta property="og:image" content="${escapeAttr(og.image)}" />
    <meta name="twitter:image" content="${escapeAttr(og.image)}" />
    <meta name="twitter:card" content="summary_large_image" />`
    : `<meta name="twitter:card" content="summary" />`;

  // In debug mode, skip the redirect entirely so a human can inspect the
  // <head> in a normal browser tab instead of it firing before they can look.
  const redirectTags = options.debug
    ? ''
    : `<meta http-equiv="refresh" content="0; url=${escapeAttr(embedUrl)}" />
    <script>window.location.replace(${JSON.stringify(embedUrl)});</script>`;

  const body = options.debug
    ? `<h1>${title}</h1>
    <p>${description}</p>
    ${og.image ? `<p><img src="${escapeAttr(og.image)}" alt="" style="max-width: 400px" /></p>` : '<p>(no image)</p>'}
    <p><a href="${escapeAttr(embedUrl)}">Go to timeline →</a></p>
    <p>Remove <code>&amp;debug=1</code> from the URL to see the real (redirecting) behavior.</p>`
    : `<p><a href="${escapeAttr(embedUrl)}">${title}</a></p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="TimelineJS" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escapeAttr(pageUrl)}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${imageTag}
    <link rel="canonical" href="${escapeAttr(embedUrl)}" />
    ${redirectTags}
  </head>
  <body>
    ${body}
  </body>
</html>
`;
}

export function renderErrorPage(message: string): string {
  const safe = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Timeline not found</title>
  </head>
  <body>
    <p>${safe}</p>
  </body>
</html>
`;
}
