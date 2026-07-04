async function loadPage() {
  const page = location.hash.slice(1) || null;
  if (!page) {
    document.getElementById('doc-content').innerHTML = '<p>No document specified.</p>';
    return;
  }
  const res = await fetch(`docs/${page}.html`);
  if (!res.ok) {
    document.getElementById('doc-content').innerHTML = '<p>Document not found.</p>';
    return;
  }
  const text = await res.text();
  const frag = new DOMParser().parseFromString(text, 'text/html');
  const title = frag.querySelector('title');
  if (title) document.title = title.textContent;
  for (const style of frag.querySelectorAll('style')) {
    document.head.appendChild(style.cloneNode(true));
  }
  document.getElementById('doc-content').innerHTML = frag.body.innerHTML;
}

loadPage();
window.addEventListener('hashchange', loadPage);
