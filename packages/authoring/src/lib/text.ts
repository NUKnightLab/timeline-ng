// Strips HTML tags and decodes entities (e.g. "Ink &amp; Type" -> "Ink & Type")
// for contexts that need the plain-text form of a rich-text field like headline.
export function stripHtml(input?: string): string {
  if (!input) return '';
  const el = document.createElement('div');
  el.innerHTML = input;
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}
