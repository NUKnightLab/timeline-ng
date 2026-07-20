import DOMPurify from 'dompurify';

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.nodeName === 'A' && node.hasAttribute('href')) {
    if (!node.hasAttribute('target')) node.setAttribute('target', '_blank');
    const rel = node.getAttribute('rel') ?? '';
    if (!rel.includes('noopener')) node.setAttribute('rel', `noopener ${rel}`.trim());
  }
});

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['frameborder', 'allowfullscreen', 'target'],
  });
}

// Plain-text extraction for contexts (like nav labels) that can't render markup.
// Sanitizing to a DOM fragment first (rather than serializing to a string and
// re-parsing) neutralizes active content before textContent is read, and avoids
// leftover HTML entities that a string round-trip would leave behind.
export function stripHtml(html: string): string {
  if (!html) return '';
  const frag = DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true });
  return (frag.textContent ?? '').replace(/\s+/g, ' ').trim();
}
