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
