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
  markCurrent(page);
  window.scrollTo(0, 0);
}

/* The rail has room to show which page you are on, which the old top row did
   not. aria-current carries it to assistive tech as well as to the styling. */
function markCurrent(page) {
  for (const a of document.querySelectorAll('.docs-nav a')) {
    const target = a.getAttribute('href').split('#')[1];
    if (target === page) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

loadPage();
window.addEventListener('hashchange', loadPage);
