/* Cutetube – last-resort reader for any post page, run (repeatedly) by the hidden resolver.
 * Uses nothing site-specific: open-graph tags, large images and the videos on the page (started muted so the
 * browser fetches their streams, which the resolver records). Must stay synchronous. */
(() => {
  const big = (w, h) => Math.max(w, h) >= 480;
  const bestSrc = (img) => {
    let best = img.currentSrc || img.src;
    let bw = 0;
    for (const c of (img.getAttribute('srcset') || '').split(',')) {
      const [u, d] = c.trim().split(/\s+/);
      const w = parseInt(d, 10) || 0;
      if (u && w > bw) { bw = w; best = u; }
    }
    return best;
  };
  const meta = (k) => [...document.querySelectorAll(`meta[property="og:${k}"], meta[name="twitter:${k}"], meta[property="og:${k}:secure_url"]`)]
    .map((m) => m.getAttribute('content')).filter((u) => u && u.startsWith('https://'));

  // Content area: the biggest open dialog (a post over a feed), else the main region.
  let root = null;
  let area = 0;
  for (const d of document.querySelectorAll('[role="dialog"]')) {
    const r = d.getBoundingClientRect();
    if (r.width * r.height > Math.max(area, 200 * 200)) { area = r.width * r.height; root = d; }
  }
  root = root || document.querySelector('[role="main"], main, article') || document.body;

  // The post's own media: anchored on the image the page advertises as its preview (og:image), else the biggest
  // item; then whatever sits in the same row at the same height (carousel slides). Other posts' thumbnails,
  // avatars and icons are elsewhere on the page or much smaller.
  const cands = [];
  for (const img of root.querySelectorAll('img')) {
    if (!img.complete || !big(img.naturalWidth, img.naturalHeight)) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 150 || r.height < 150) continue;
    cands.push({ el: img, kind: 'img', r, area: r.width * r.height });
  }
  for (const v of root.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (r.width >= 150 && r.height >= 150) cands.push({ el: v, kind: 'video', r, area: r.width * r.height });
  }
  const file = (u) => { try { return new URL(u).pathname.split('/').pop(); } catch (_) { return ''; } };
  const ogFiles = meta('image').map(file).filter(Boolean);
  // A post shows its media first; the same picture lower down is another post's thumbnail.
  const firstScreen = (c) => c.r.top < innerHeight * 0.9;
  const score = (c) => c.area * (firstScreen(c) ? 1 : 0.25) * (c.kind === 'video' ? 1.05 : 1);
  const byOg = cands.find((c) => c.kind === 'img' && firstScreen(c) && ogFiles.includes(file(c.el.currentSrc || c.el.src)));
  const biggest = cands.reduce((m, c) => (!m || score(c) > score(m) ? c : m), null);
  const overlap = (a, b) => {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? (w * h) / Math.min(a.width * a.height, b.width * b.height) : 0;
  };
  let anchor = byOg || biggest;
  // A preview image under a video is the video's poster: the post is the video.
  const over = anchor && anchor.kind === 'img' && cands.find((c) => c.kind === 'video' && overlap(c.r, anchor.r) >= 0.5);
  if (over) anchor = over;
  const keep = !anchor ? [] : cands.filter((c) => Math.abs(c.r.top - anchor.r.top) <= Math.max(12, anchor.r.height * 0.06)
    && Math.abs(c.r.height - anchor.r.height) <= anchor.r.height * 0.2);
  const keptVideos = keep.filter((c) => c.kind === 'video');
  const onVideo = (r) => keptVideos.some((v) => overlap(v.r, r) >= 0.5);
  // Only the post's videos play, so the streams the browser fetches are theirs.
  for (const v of root.ownerDocument.querySelectorAll('video')) {
    if (!keptVideos.some((c) => c.el === v)) { try { v.pause(); } catch (_) { /* ignore */ } }
  }

  const images = [];
  for (const c of keep) {
    if (c.kind !== 'img' || onVideo(c.r)) continue;
    const src = bestSrc(c.el);
    if (src && src.startsWith('https://') && !images.includes(src)) images.push(src);
  }
  const videos = [];
  let playing = 0;
  for (const c of keptVideos) {
    const v = c.el;
    try { v.muted = true; if (v.paused) v.play().catch(() => {}); } catch (_) { /* autoplay refused */ }
    if (!v.paused) playing += 1;
    const src = v.currentSrc || v.src || '';
    if (src.startsWith('https://') && !videos.includes(src)) videos.push(src);
  }
  return {
    ready: document.readyState === 'complete',
    login: /\/(login|accounts\/login|checkpoint)/.test(location.pathname),
    url: location.href,
    images,
    videos,
    videoElements: keptVideos.length,
    playing,
    ogImage: meta('image'),
    ogVideo: meta('video'),
    title: (document.querySelector('meta[property="og:title"]') || {}).content || document.title || null,
  };
})()
