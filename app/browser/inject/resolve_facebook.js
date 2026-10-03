/* Cutetube – run (repeatedly) by the hidden resolver on a Facebook post / photo-set page.
 * Reports the photos and videos that belong to the post, read from what Facebook rendered for the
 * logged-in user. Must stay synchronous: ExecuteScriptAsync doesn't await promises. */
(() => {
  const PART = (h) => {
    let m;
    if ((m = h.match(/\/photo(?:\.php)?\/?\?(?:[^#]*&)?fbid=(\d+)/))) {
      return { type: 'photo', id: m[1], set: (h.match(/[?&]set=(pcb\.\d+)/) || [])[1] || null };
    }
    if ((m = h.match(/\/photos\/(?:[\w.-]+\/)?(\d{6,})/))) return { type: 'photo', id: m[1], set: null };
    if ((m = h.match(/\/videos\/(?:(pcb\.\d+)\/|[\w.-]+\/)?(\d{6,})/))) return { type: 'video', id: m[2], set: m[1] || null };
    if ((m = h.match(/\/watch\/?\?(?:[^#]*&)?v=(\d+)/))) return { type: 'video', id: m[1], set: null };
    if ((m = h.match(/\/reel\/(\d{6,})/))) return { type: 'video', id: m[1], set: null };
    return null;
  };
  const text = (el) => (el ? (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ') : '');

  if (/^\/(login|checkpoint)/.test(location.pathname) || document.querySelector('#login_form, form[action*="/login"] input[name="pass"]')) {
    return { login: true };
  }
  const onSet = location.pathname.startsWith('/media/set');

  // The post: the biggest open dialog (a post opened over the feed), else the first top-level article.
  let root = null;
  let post = null;
  if (onSet) {
    // The set's grid: the list holding the most photo / video links.
    let best = 0;
    for (const l of document.querySelectorAll('[role="list"], [role="main"]')) {
      const n = [...l.querySelectorAll('a[href]')].filter((a) => PART(a.getAttribute('href') || '')).length;
      if (n > best) { best = n; root = l; }
    }
    root = root || document.body;
  } else {
    let best = 0;
    for (const d of document.querySelectorAll('[role="dialog"]')) {
      const r = d.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > 200 * 200 && area >= best * 0.9) { best = Math.max(best, area); root = d; }
    }
    if (!root) {
      const main = document.querySelector('[role="main"]') || document.body;
      // Comments are labelled articles ("Comment by …"); a post, when it is an article at all, is not.
      post = [...main.querySelectorAll('[role="article"]')]
        .find((a) => !a.hasAttribute('aria-label') && !a.parentElement.closest('[role="article"]'));
      root = post || main;
    }
  }
  if (!root) return { ready: false };
  // We're looking at the post itself (not a page we can't make sense of): an empty result really means "no media".
  const found = root !== document.body && (onSet || !!post || root.getAttribute('role') === 'dialog')
    && (root.innerText || '').trim().length > 0;

  const parts = [];
  const seen = new Set();
  let set = null;
  let thumb = null;
  for (const a of root.querySelectorAll('a[href]')) {
    const art = a.closest('[role="article"]');
    if (art && art !== post && root.contains(art) && (art.hasAttribute('aria-label') || post)) continue; // comments
    const p = PART(a.getAttribute('href') || '');
    if (!p) continue;
    set = set || p.set;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    const img = a.querySelector('img');
    parts.push({ type: p.type, id: p.id, thumb: img && img.src && img.src.startsWith('https://') ? img.src : null });
    thumb = thumb || (img && img.naturalWidth >= 150 ? img.src : null);
  }
  // A grid with more items than it shows ends with a "+3" style overlay.
  const more = [...root.querySelectorAll('a[href*="set=pcb"] div, a[href*="/videos/pcb"] div')]
    .some((d) => /^\+\s?\d+$/.test(text(d)));

  let author = null;
  let title = null;
  if (!onSet) {
    const scope = post || root;
    const h = scope.querySelector('h2 a[href] strong, h3 a[href] strong, h2 strong a, h3 strong a, h2 a[role="link"], h3 a[role="link"], strong a[role="link"]');
    author = text(h) || null;
    const msg = scope.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    title = text(msg) || null;
  } else {
    const h = root.querySelector('h1, h2, [role="heading"]');
    title = text(h) || null;
  }
  return {
    ready: document.readyState !== 'loading',
    url: location.href,
    onSet,
    found,
    parts,
    set,
    more,
    author: author && author.slice(0, 120),
    title: title && title.slice(0, 400),
    thumb,
  };
})()
