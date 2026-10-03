/* Cutetube – injected into the Facebook / Instagram / TikTok tabs before any page script runs. */
(() => {
  'use strict';
  if (window.__ctInstalled) return;
  window.__ctInstalled = true;

  const CFG = __CT_CONFIG__;
  const SITE = CFG.site;
  const HOSTS = { facebook: /(^|\.)(facebook\.com|fb\.com)$/, instagram: /(^|\.)instagram\.com$/, tiktok: /(^|\.)tiktok\.com$/ };
  if (!HOSTS[SITE] || !HOSTS[SITE].test(location.hostname) || window.top !== window) return;

  const wv = window.chrome && window.chrome.webview;
  // The sites replace some DOM functions after loading (Facebook overrides getAttribute, hasAttribute and
  // MutationObserver), which can hide exactly what an ad blocker looks for. This script runs before any page
  // code, so keep the browser's own versions and use those.
  const NATIVE = {
    apply: Reflect.apply,
    getAttribute: Element.prototype.getAttribute,
    hasAttribute: Element.prototype.hasAttribute,
    MutationObserver: window.MutationObserver,
  };
  const attr = (el, name) => NATIVE.apply(NATIVE.getAttribute, el, [name]);
  const hasAttr = (el, name) => NATIVE.apply(NATIVE.hasAttribute, el, [name]);
  const Observer = NATIVE.MutationObserver;
  const post = (m) => { try { wv && wv.postMessage(m); } catch (_) {} };
  const ACCENT = '#F0507A';

  const addStyle = (id, css) => {
    const apply = () => {
      let s = document.getElementById(id);
      if (!s) { s = document.createElement('style'); s.id = id; (document.head || document.documentElement).appendChild(s); }
      s.textContent = css;
    };
    if (document.documentElement) apply();
    else new Observer((_, o) => { if (document.documentElement) { o.disconnect(); apply(); } }).observe(document, { childList: true });
  };

  /* ------------------------------------------------------------------ *
   * Media links → canonical id (must match app/sites.py classify_social)
   * ------------------------------------------------------------------ */
  const PARSE = {
    tiktok(href) {
      const m = href.match(/\/@([\w.-]+)\/(video|photo)\/(\d+)/);
      return m ? { id: `tt:${m[3]}`, url: `https://www.tiktok.com/@${m[1]}/${m[2]}/${m[3]}`, type: m[2], author: m[1] } : null;
    },
    instagram(href) {
      const m = href.match(/\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([\w-]{5,})/);
      if (!m) return null;
      const reel = m[1] === 'reel' || m[1] === 'reels';
      return { id: `ig:${m[2]}`, url: `https://www.instagram.com/${reel ? 'reel' : 'p'}/${m[2]}/`, type: reel ? 'reel' : 'post' };
    },
    // rank: which link identifies a feed post best (its permalink > its photo set > one of its photos)
    facebook(href) {
      let m = href.match(/\/groups\/([\w.-]+)\/(?:posts|permalink)\/(\d+)/);
      if (m) return { id: `fb:post:${m[2]}`, url: `https://www.facebook.com/groups/${m[1]}/posts/${m[2]}/`, type: 'post', rank: 3 };
      m = href.match(/\/(?:permalink|story)\.php\?(?=[^#]*story_fbid=([\w-]+))(?=(?:[^#]*&)?id=(\d+))/);
      if (m) return { id: `fb:post:${m[1]}`, url: `https://www.facebook.com/permalink.php?story_fbid=${m[1]}&id=${m[2]}`, type: 'post', rank: 3 };
      m = href.match(/facebook\.com\/([\w.-]+)\/posts\/([\w-]+)/) || href.match(/^\/([\w.-]+)\/posts\/([\w-]+)/);
      if (m) return { id: `fb:post:${m[2]}`, url: `https://www.facebook.com/${m[1]}/posts/${m[2]}`, type: 'post', rank: 3 };
      m = href.match(/\/media\/set\/?\?(?:[^#]*&)?set=([\w.-]+)/);
      if (m) return { id: `fb:set:${m[1]}`, url: `https://www.facebook.com/media/set/?set=${m[1]}`, type: m[1].startsWith('pcb.') ? 'post' : 'album', rank: 2 };
      m = href.match(/\/reel\/(\d+)/);
      if (m) return { id: `fb:${m[1]}`, url: `https://www.facebook.com/reel/${m[1]}`, type: 'reel', rank: 1 };
      m = href.match(/\/videos\/(pcb\.\d+)\/\d+/);
      if (m) return { id: `fb:set:${m[1]}`, url: `https://www.facebook.com/media/set/?set=${m[1]}`, type: 'post', rank: 2 };
      m = href.match(/\/watch\/?\?(?:.*&)?v=(\d+)/) || href.match(/\/videos\/(?:[\w.-]+\/)?(\d+)/);
      if (m) return { id: `fb:${m[1]}`, url: `https://www.facebook.com/watch/?v=${m[1]}`, type: 'video', rank: 1 };
      m = href.match(/\/photo(?:\.php)?\/?\?(?:[^#]*&)?set=(pcb\.\d+)/);
      if (m) return { id: `fb:set:${m[1]}`, url: `https://www.facebook.com/media/set/?set=${m[1]}`, type: 'post', rank: 2 };
      m = href.match(/\/photo(?:\.php)?\/?\?(?:.*&)?fbid=(\d+)/) || href.match(/\/photos\/(?:[\w.-]+\/)?(\d+)/);
      if (m) return { id: `fb:p:${m[1]}`, url: `https://www.facebook.com/photo/?fbid=${m[1]}`, type: 'photo', rank: 1 };
      m = href.match(/\/share\/(?:([vrp])\/)?([\w-]{6,})/);
      if (m) return { id: `fb:s:${m[2]}`, url: `https://www.facebook.com/share/${m[1] ? m[1] + '/' : ''}${m[2]}/`, type: { v: 'video', r: 'reel' }[m[1]] || 'post', rank: 3 };
      return null;
    },
  };
  const parse = (href) => { try { return PARSE[SITE](href || ''); } catch (_) { return null; } };

  const LINK_SEL = {
    tiktok: 'a[href*="/video/"], a[href*="/photo/"]',
    instagram: 'a[href*="/p/"], a[href*="/reel/"], a[href*="/reels/"], a[href*="/tv/"]',
    facebook: 'a[href*="/reel/"], a[href*="/watch"], a[href*="/videos/"], a[href*="/photo"], a[href*="/posts/"], a[href*="/permalink"], a[href*="story.php"], a[href*="/media/set"], a[href*="/share/"]',
  }[SITE];
  // Tile containers that hold one post (grid cell or feed item).
  const TILE_SEL = {
    tiktok: '[data-e2e="user-post-item"], [data-e2e="search_top-item"], [data-e2e="search-card-item"], [data-e2e="favorites-item"], [data-e2e="user-liked-item"], [data-e2e="music-item"], [data-e2e="challenge-item"]',
    instagram: 'article',
    facebook: '[role="article"]',
  }[SITE];
  const SKIP_SEL = '[role="dialog"] [role="dialog"], nav, header[role="banner"], [role="navigation"], [role="banner"]';

  /* ------------------------------------------------------------------ *
   * 1. Hide sponsored posts / ads (best effort; these sites change often)
   * ------------------------------------------------------------------ */
  if (CFG.adblock) {
    addStyle('ct-social-ads', {
      facebook: `[data-pagelet^="RightRail"] a[href*="/ads/"], div[data-pagelet="RightRail"] > div:first-child:has(a[aria-label="Advertiser"]) { display: none !important; }`,
      instagram: ``,
      tiktok: `[data-e2e="ad-tag"] { }`,
    }[SITE] || '');
    const AD_TEXT = /^(Sponsored|Ad|Promoted|Paid partnership with .+)?$/;
    // Feeds are virtualised lists that measure their items: removing an ad (height 0) makes them stop placing
    // posts and the feed goes blank. Fold it into a slim labelled bar instead, and stop any video in it.
    addStyle('ct-ad-fold', '.ct-ad-folded { max-height: 44px !important; min-height: 44px !important; overflow: hidden !important; position: relative !important; }'
      + ' .ct-ad-folded > * { visibility: hidden !important; }'
      + ' .ct-ad-folded::after { content: "Sponsored post hidden"; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;'
      + ' font: 600 12px/1 system-ui, sans-serif; color: rgba(140,140,150,.85); visibility: visible; }');
    const whoOf = (el) => (el.querySelector('h2, h3, h4, strong')?.textContent || '').trim().slice(0, 80);
    const collapse = (el) => {
      if (el.classList.contains('ct-ad-folded')) return;
      el.classList.add('ct-ad-folded');
      el.dataset.ctAdWho = whoOf(el); // feeds reuse post boxes: remember whose post this was
      el.querySelectorAll('video').forEach((v) => { try { v.pause(); v.muted = true; } catch (_) { /* ignore */ } });
      post({ type: 'adSkipped' });
    };
    // "Sponsored" in the languages Facebook is most used in.
    const AD_WORDS = new Set(['Ad', 'Sponsored', 'Sponsorisé', 'Patrocinado', 'Gesponsert', 'Sponsorizzato', 'Gesponsord',
      'Sponsorowane', 'Sponzorováno', 'Реклама', 'Спонсорирано', 'Sponsorlu', 'Bersponsor', 'Disponsori', 'Được tài trợ',
      'ได้รับการสนับสนุน', '広告', '赞助内容', '贊助', '광고', 'إعلان', 'ممول', 'प्रायोजित', 'স্পনসর্ড', 'বিজ্ঞাপন', 'سپانسرڈ']);
    // A feed post: the box around `el` that sits in a list of posts (its parent holds several of them).
    const feedItem = (el) => {
      for (let e = el; e && e.parentElement && e !== document.body; e = e.parentElement) {
        const sibs = e.parentElement.children;
        if (sibs.length >= 3 && e.getBoundingClientRect().height > 150 && e.querySelector('img, video')
          && [...sibs].filter((c) => c !== e && c.getBoundingClientRect().height > 150).length >= 2) {
          return e === document.body || e.parentElement === document.body ? null : e;
        }
      }
      return null;
    };
    // Facebook draws a post's timestamp — or "Ad" / "Sponsored" — from a hidden text element the header points to
    // (aria-labelledby), so the visible label can't be read or matched. The hidden text can.
    const clean = (t) => (t || '').replace(/[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
    const labelOf = (el) => {
      const ids = (attr(el, 'aria-labelledby') || '').split(/\s+/);
      const raw = clean(ids.map((id) => document.getElementById(id)?.textContent || '').join(' '));
      if (AD_WORDS.has(raw)) return raw;
      // The word may hide decoy letters inside (rendered text drops what is hidden).
      const shown = clean(ids.map((id) => document.getElementById(id)?.innerText || '').join(' '));
      return AD_WORDS.has(shown) ? shown : raw;
    };
    const feedUnit = (el) => el.closest('[data-pagelet^="FeedUnit"], [data-pagelet^="RightRail"] > div') || feedItem(el);
    let pending = new Set();
    const adPostOf = (el) => {
      // Only the words Facebook uses for its ad label. (Timestamps can't be told apart by shape: "a day ago" or
      // "about a minute ago" have no digits either.) Ads in other languages are caught by their header link.
      if (!AD_WORDS.has(labelOf(el))) return null;
      const unit = feedUnit(el);
      if (!unit) pending.add(el); // not laid out yet: look again next frame
      return unit;
    };
    // Some ads write "Ad" / "Sponsored" as plain text ("Ad · China state-controlled media"): a word on its own
    // on the post's header line (not in the post's text, which may well mention ads).
    const headerWordPost = (el) => {
      if (el.childElementCount || !AD_WORDS.has(clean(el.textContent))) return null;
      const r = el.getBoundingClientRect();
      if (!r.height) return null;
      const unit = feedUnit(el);
      if (!unit) { pending.add(el); return null; }
      // The line under the author's name, not the post's text below it.
      const head = unit.querySelector('h2, h3, h4');
      if (!head) return r.top - unit.getBoundingClientRect().top < 90 ? unit : null;
      const h = head.getBoundingClientRect();
      return r.top >= h.top - 4 && r.top <= h.bottom + 26 ? unit : null;
    };
    const hideAds = () => {
      if (SITE === 'instagram') {
        for (const art of document.querySelectorAll('article:not([data-ct-ad-checked])')) {
          const head = art.querySelector('header');
          if (!head || !(head.textContent || '').trim()) continue; // not rendered yet: look again later
          art.dataset.ctAdChecked = '1';
          const spans = art.querySelectorAll('header span, header a, div > span');
          for (const s of spans) {
            const t = (s.textContent || '').trim();
            if (t === 'Sponsored' || t === 'Ad') { collapse(art); break; }
          }
        }
      } else if (SITE === 'facebook') {
        for (const el of document.querySelectorAll('[aria-labelledby]')) {
          if (!el.closest('.ct-ad-folded')) { const unit = adPostOf(el); if (unit) collapse(unit); }
        }
        for (const el of document.querySelectorAll('span, a, b, strong')) {
          if (el.childElementCount === 0 && (el.textContent || '').length <= 24 && !el.closest('.ct-ad-folded')) {
            const unit = headerWordPost(el);
            if (unit) collapse(unit);
          }
        }
        for (const el of document.querySelectorAll('a[href*="/ads/about"], a[aria-label="Sponsored"], a[href^="/ads/"]')) {
          const unit = feedUnit(el);
          if (unit) collapse(unit);
        }
      } else if (SITE === 'tiktok') {
        for (const tag of document.querySelectorAll('[data-e2e="ad-tag"], [data-e2e*="ad-label"]')) {
          const unit = tag.closest('[data-e2e="recommend-list-item-container"], article, section');
          if (unit) collapse(unit);
        }
      }
    };
    setInterval(() => {
      // A folded box now holding someone else's post (the feed reused it): open it up again; if that post is
      // an ad too, it is folded again right away.
      for (const el of document.querySelectorAll('.ct-ad-folded')) {
        const who = whoOf(el);
        if (who && el.dataset.ctAdWho && who !== el.dataset.ctAdWho) el.classList.remove('ct-ad-folded');
      }
      hideAds();
    }, 1200); // backstop

    // Fold ads as soon as they're added, before the browser paints them (observer callbacks run before
    // rendering). On Facebook only what changed is looked at, so this stays cheap while scrolling.
    const checkLink = (a) => {
      if (a.closest('.ct-ad-folded')) return;
      const unit = feedUnit(a);
      if (unit) collapse(unit); else pending.add(a);
    };
    const checkEl = (el) => {
      if (el.closest('.ct-ad-folded')) return;
      const unit = hasAttr(el, 'aria-labelledby') ? adPostOf(el) : headerWordPost(el);
      if (unit) collapse(unit);
    };
    // The header's link (timestamp, or "Ad") only gets its real address on hover; for an ad that address goes to
    // Facebook's ad pages. Give new header links a brief hover so the address fills in (watched below).
    const reveal = (a) => {
      if (a.dataset.ctRevealed) return;
      a.dataset.ctRevealed = '1';
      fire(a, ['pointerover', 'mouseover', 'focusin']);
      setTimeout(() => fire(a, ['pointerout', 'mouseout', 'focusout']), 40);
    };
    const adHref = (a) => /\/ads\/(about|preferences|activity)|[?&]ad_id=|\/ads\/\?/.test(attr(a, 'href') || '');
    const checkFacebook = (node) => {
      for (const a of node.matches('a[href]') ? [node, ...node.querySelectorAll('a[href]')] : node.querySelectorAll('a[href]')) {
        const h = attr(a, 'href') || '';
        if (adHref(a)) { checkLink(a); continue; }
        if (/^[?#]/.test(h) && a.querySelector('span')) reveal(a);
      }
      if (node.matches('[aria-labelledby]')) checkEl(node);
      for (const el of node.querySelectorAll('[aria-labelledby]')) checkEl(el);
      for (const el of node.querySelectorAll('span, a, b, strong')) {
        if (el.childElementCount === 0 && (el.textContent || '').length <= 24 && AD_WORDS.has(clean(el.textContent))) checkEl(el);
      }
      // A hidden label text arriving (or changing) after its post: check whoever points at it.
      const ids = node.id ? [node.id] : [];
      for (const sp of node.querySelectorAll('[id]')) if ((sp.textContent || '').length <= 40) ids.push(sp.id);
      for (const id of ids) for (const el of document.querySelectorAll(`[aria-labelledby~="${CSS.escape(id)}"]`)) checkEl(el);
    };
    let frame = 0;
    const later = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const again = pending;
        pending = new Set();
        again.forEach((el) => el.isConnected && (el.matches('a[href]') && adHref(el) ? checkLink(el) : checkEl(el)));
        if (SITE !== 'facebook') hideAds();
      });
    };
    const start = () => new Observer((records) => {
      if (SITE === 'facebook') {
        for (const r of records) {
          if (r.type === 'childList') {
            for (const n of r.addedNodes) if (n.nodeType === 1) checkFacebook(n);
            if (r.target.nodeType === 1 && r.target.id) checkFacebook(r.target);
          } else if (r.type === 'attributes') {
            if (r.attributeName === 'href') { if (adHref(r.target)) checkLink(r.target); } // revealed address
            else checkEl(r.target); // Facebook attaches the label reference after the post is on the page
          } else if (r.type === 'characterData' && r.target.parentElement) {
            const el = r.target.parentElement; // React updates label text in place
            if (el.id) checkFacebook(el);
            else if (AD_WORDS.has(clean(el.textContent))) checkEl(el);
          }
        }
      }
      later();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true,
      attributes: SITE === 'facebook', attributeFilter: SITE === 'facebook' ? ['aria-labelledby', 'href'] : undefined });
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
    void AD_TEXT;
  }

  /* ------------------------------------------------------------------ *
   * 2. Select mode + "Saved" badges
   * ------------------------------------------------------------------ */
  let selectMode = false;
  let selected = new Set();
  const downloaded = new Set(CFG.downloaded || []);

  addStyle('ct-ui', `
    [data-ct-id] { position: relative; }
    .ct-badge { position: absolute; inset: 0; z-index: 40; pointer-events: none; box-sizing: border-box;
      border: 2px solid transparent; border-radius: 10px; transition: border-color .15s ease, background-color .15s ease; }
    .ct-marks { position: absolute; top: 8px; left: 8px; display: flex; gap: 6px; align-items: center; }
    html.ct-select [data-ct-id]:hover > .ct-badge { border-color: rgba(240,80,122,.5); background: rgba(240,80,122,.05); }
    html.ct-select [data-ct-id].ct-selected > .ct-badge { border-color: ${ACCENT}; background: rgba(240,80,122,.12); }
    .ct-check { display: none; width: 26px; height: 26px; border-radius: 50%; box-sizing: border-box;
      background: rgba(10,10,14,.55); border: 2px solid #fff; box-shadow: 0 2px 10px rgba(0,0,0,.45); }
    html.ct-select .ct-check { display: block; }
    .ct-selected .ct-check { border-color: ${ACCENT};
      background: ${ACCENT} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/15px no-repeat; }
    .ct-saved { display: none; font: 600 11px/1 system-ui, sans-serif; color: #fff; background: rgba(18,165,138,.95);
      padding: 5px 8px; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    .ct-downloaded .ct-saved { display: inline-block; }
    html.ct-select [data-ct-id], html.ct-select [data-ct-id] * { cursor: pointer !important; }
  `);

  const hasMedia = (el) => !!el.querySelector('img, video, canvas, picture, [style*="background-image"]');
  const tileFor = (a) => {
    const t = TILE_SEL && a.closest(TILE_SEL);
    if (t) return t;
    if (hasMedia(a)) {
      // Grid cell: the link wraps the thumbnail. Use a block-level box so the ring fits the cell.
      return getComputedStyle(a).display === 'inline' && a.parentElement ? a.parentElement : a;
    }
    return null;
  };
  const textOf = (el) => (el ? (el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent || '').trim().replace(/\s+/g, ' ') : '');

  const metaOf = (c) => {
    const info = parse(c.dataset.ctHref || '') || {};
    const img = c.querySelector('img[src^="https://"]');
    const video = c.querySelector('video[poster^="https://"]');
    // Words, not the like / comment counts some grids overlay on a tile.
    const meaningful = (t) => !!t && t.length > 1 && !/^[\d\s.,KkMm·]+$/.test(t);
    const own = [...c.querySelectorAll('a[href]')].find((x) => (parse(x.href) || {}).id === c.dataset.ctId);
    let title = [textOf(own), img && img.getAttribute('alt')].find(meaningful) || '';
    if (!title && TILE_SEL && c.matches(TILE_SEL)) {
      title = [...c.querySelectorAll('h1, [data-ad-preview="message"], [data-ad-comet-preview="message"]')]
        .map(textOf).find(meaningful) || '';
    }
    let author = info.author || null;
    if (!author && SITE === 'instagram') {
      const h = c.querySelector('header a[href^="/"]');
      author = h ? h.getAttribute('href').replace(/\//g, '') : null;
    }
    if (!author && SITE === 'tiktok') {
      const m = location.pathname.match(/^\/@([\w.-]+)/);
      author = m ? m[1] : null;
    }
    if (!author && SITE === 'facebook') {
      const h = c.querySelector('h2 a, h3 a, strong a');
      author = h ? textOf(h) : null;
    }
    return {
      id: c.dataset.ctId, url: info.url, media_type: info.type,
      title: (title || '').slice(0, 300) || null, author: (author || '').slice(0, 120) || null,
      thumb: (img && img.src) || (video && video.poster) || null,
    };
  };

  const decorate = (c) => {
    let badge = c.querySelector(':scope > .ct-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'ct-badge';
      const marks = document.createElement('div');
      marks.className = 'ct-marks';
      const check = document.createElement('span');
      check.className = 'ct-check';
      const saved = document.createElement('span');
      saved.className = 'ct-saved';
      saved.textContent = 'Saved';
      marks.append(check, saved);
      badge.append(marks);
      c.appendChild(badge);
    }
    c.classList.toggle('ct-selected', selected.has(c.dataset.ctId));
    c.classList.toggle('ct-downloaded', downloaded.has(c.dataset.ctId));
    // On a whole feed post, put the check / "Saved" marks on its photo or video, not over the author's avatar.
    const marks = badge.firstChild;
    if (marks) {
      let media = null;
      let best = 0;
      for (const m of c.querySelectorAll('img, video')) {
        const r = m.getBoundingClientRect();
        if (r.width * r.height > best && r.width >= 120) { best = r.width * r.height; media = r; }
      }
      const t = c.getBoundingClientRect();
      marks.style.top = media ? `${Math.max(8, media.top - t.top + 10)}px` : '';
      marks.style.left = media ? `${Math.max(8, media.left - t.left + 10)}px` : '';
    }
  };

  // Facebook comments (and replies) are labelled articles: their photos aren't the post's.
  const inComment = (a) => {
    const art = a.closest('[role="article"]');
    return !!(art && (hasAttr(art, 'aria-label') || (art.parentElement && art.parentElement.closest('[role="article"]'))));
  };
  const commonAncestor = (els) => {
    let anc = els[0];
    while (anc && anc !== document.body && !els.every((e) => anc.contains(e))) anc = anc.parentElement;
    return anc;
  };
  const untile = (c) => {
    delete c.dataset.ctId;
    delete c.dataset.ctHref;
    c.classList.remove('ct-selected', 'ct-downloaded');
    const b = c.querySelector(':scope > .ct-badge');
    if (b) b.remove();
  };
  // Facebook feed videos carry no link of their own, and the post's timestamp link only gets its real address
  // when the pointer reaches it. Find the post around each video and let its hidden links fill in, as a hover
  // would; the next scan reads the video's address from them. (Select mode only.)
  const fire = (a, types) => {
    for (const t of types) {
      const E = t.startsWith('pointer') ? PointerEvent : t.startsWith('focus') ? FocusEvent : MouseEvent;
      a.dispatchEvent(new E(t, { bubbles: true, cancelable: true }));
    }
  };
  const poke = (a) => {
    fire(a, ['pointerover', 'mouseover', 'focusin']);
    // ...and leave again, so the site's hover tooltip (the post's date) doesn't stay up.
    setTimeout(() => fire(a, ['pointerout', 'mouseout', 'focusout']), 150);
  };
  let pokeTimer = 0;
  const videoPosts = (known) => {
    const found = [];
    let poked = false;
    for (const v of document.querySelectorAll('video')) {
      // Skip videos a link-based tile already covers (but keep finding the ones this function tiled before).
      if (v.closest(SKIP_SEL) || [...known.keys()].some((k) => k.contains(v))) continue;
      const vr = v.getBoundingClientRect();
      if (vr.width < 150 || vr.bottom < -innerHeight || vr.top > innerHeight * 2) continue;
      let box = v.parentElement;
      let link = null;
      for (let i = 0; box && box !== document.body && i < 30; i++, box = box.parentElement) {
        const as = [...box.querySelectorAll('a[href]')].filter((a) => !inComment(a));
        if (!as.length) continue;
        for (const a of as) {
          const h = attr(a, 'href') || '';
          if (/^[?#]/.test(h)) {
            if (!a.dataset.ctPoked) { a.dataset.ctPoked = '1'; poke(a); poked = true; }
            continue;
          }
          const info = parse(h.startsWith('http') ? h : location.origin + h);
          if (info && (info.type === 'video' || info.type === 'reel')) { link = info; break; }
        }
        if (link || as.length >= 6) break;
      }
      if (link && box && ![...known.keys()].some((k) => k !== box && box.contains(k) && known.get(k).id !== link.id)) {
        found.push([box, { ...link, rank: 2 }]);
      }
    }
    if (poked && !pokeTimer) pokeTimer = setTimeout(() => { pokeTimer = 0; scanSoon(); }, 450);
    return found;
  };

  const scan = () => {
    const best = new Map(); // tile -> its best link
    for (const a of document.querySelectorAll(LINK_SEL)) {
      if (a.closest(SKIP_SEL) || (SITE === 'facebook' && inComment(a))) continue;
      const href = attr(a, 'href') || '';
      const info = parse(href.startsWith('http') ? href : location.origin + href);
      if (!info) continue;
      const c = tileFor(a);
      if (!c || c === document.body) continue;
      const rank = info.rank || 1;
      if (!best.has(c) || best.get(c).rank < rank) best.set(c, { ...info, rank });
    }
    if (SITE === 'facebook' && selectMode) {
      for (const [box, info] of videoPosts(best)) if (!best.has(box)) best.set(box, info);
    }
    // Several tiles for one post (e.g. the photos of a multi-photo post) become one tile around all of them,
    // whatever markup the site uses for its posts.
    const byId = new Map();
    for (const [c, info] of best) {
      if (!byId.has(info.id)) byId.set(info.id, { info, els: [] });
      byId.get(info.id).els.push(c);
    }
    const all = [...best.keys()];
    const tiles = new Set();
    for (const { info, els } of byId.values()) {
      let group = els;
      if (els.length > 1) {
        const anc = commonAncestor(els);
        // Only a box that holds this post alone (the same link repeated across the page stays separate).
        const alone = anc && anc !== document.body && anc !== document.documentElement
          && !all.some((o) => !els.includes(o) && anc.contains(o));
        if (alone) group = [anc];
      }
      for (const c of group) {
        tiles.add(c);
        if (c.dataset.ctId !== info.id) { c.dataset.ctId = info.id; c.dataset.ctHref = info.url; }
        try { decorate(c); } catch (_) { /* keep scanning */ }
      }
    }
    for (const c of document.querySelectorAll('[data-ct-id]')) if (!tiles.has(c)) untile(c);
  };
  let scanTimer = 0;
  let lastScan = 0;
  const scanSoon = () => {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = 0; lastScan = Date.now(); scan(); }, Math.max(150, 700 - (Date.now() - lastScan)));
  };
  const refreshAll = () => document.querySelectorAll('[data-ct-id]').forEach(decorate);

  const onPointer = (e) => {
    if (!selectMode || e.button !== 0) return;
    const c = e.target && e.target.closest && e.target.closest('[data-ct-id]');
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== 'click') return;
    const id = c.dataset.ctId;
    const on = !selected.has(id);
    if (on) selected.add(id); else selected.delete(id);
    decorate(c);
    post({ type: 'toggle', on, item: metaOf(c) });
  };
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick']) window.addEventListener(t, onPointer, true);
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selectMode) post({ type: 'exitSelect' }); }, true);

  const selectVisible = () => {
    scan();
    const items = [];
    document.querySelectorAll('[data-ct-id]').forEach((c) => {
      if (c.offsetParent === null) return;
      if (!selected.has(c.dataset.ctId)) { selected.add(c.dataset.ctId); items.push(metaOf(c)); }
      decorate(c);
    });
    if (items.length) post({ type: 'addMany', items });
    return items.length;
  };

  /* ------------------------------------------------------------------ *
   * 3. Collect: scroll to load more posts and select everything found
   * ------------------------------------------------------------------ */
  let collecting = null;
  const collect = async (limit) => {
    const token = {};
    collecting = token;
    let idle = 0;
    let total = 0;
    while (collecting === token && total < limit && idle < 8) {
      const added = selectVisible();
      total += added;
      post({ type: 'collect', count: total, done: false });
      idle = added ? 0 : idle + 1;
      const scroller = document.scrollingElement || document.documentElement;
      scroller.scrollBy({ top: Math.max(600, innerHeight * 0.9), behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 1300));
    }
    if (collecting === token) collecting = null;
    post({ type: 'collect', count: total, done: true });
  };

  /* ------------------------------------------------------------------ *
   * 4. Page context (these sites are SPAs; poll for URL changes)
   * ------------------------------------------------------------------ */
  // Profile name and picture, read from the layout rather than the site's markup (which changes often):
  // the picture is the largest square image near the top, the name the biggest text there.
  // Only the top of the page counts: further down, the biggest picture / heading belong to posts. The last
  // good reading is kept per page (some sites drop the header once it scrolls away).
  const profileSeen = new Map();
  const profileInfo = () => {
    const key = location.pathname;
    const top = (r) => r.top + window.scrollY; // position in the page, whatever is scrolled into view
    const og = (p) => document.querySelector(`meta[property="og:${p}"]`)?.getAttribute('content') || null;
    let avatar = null;
    let aw = 0;
    for (const el of document.querySelectorAll('img, svg image')) {
      const r = el.getBoundingClientRect();
      if (top(r) > 750 || r.width < 56 || Math.abs(r.width - r.height) > 4 || r.width <= aw) continue;
      const src = el.getAttribute('src') || el.getAttribute('xlink:href') || el.getAttribute('href');
      if (src && src.startsWith('https://')) { aw = r.width; avatar = src; }
    }
    let name = null;
    let size = 0;
    let nameBottom = 0;
    const texts = [];
    const els = document.querySelectorAll('h1, h2, h3, span[dir="auto"], div[dir="auto"], span, strong, [data-e2e="user-title"]');
    for (let i = 0; i < els.length && i < 4000; i++) {
      const el = els[i];
      if (el.childElementCount > 2 || el.closest('nav, [role="navigation"], [role="banner"], a[href="/"]')) continue;
      const r = el.getBoundingClientRect();
      if (top(r) > 750 || !r.height) continue;
      const t = (el.innerText || '').trim().split(/\r?\n/)[0];
      if (t.length < 2 || t.length > 80) continue;
      texts.push({ t, y: top(r) });
      const f = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (f > size) { size = f; name = t; nameBottom = top(r) + r.height; }
    }
    // The biggest text is sometimes just the handle (Instagram); the display name is the next line below it.
    const handle = decodeURIComponent(location.pathname.split('/')[1] || '').replace(/^@/, '').toLowerCase();
    if (name && name.toLowerCase() === handle) {
      const below = texts.find((x) => x.y >= nameBottom - 2 && x.y < nameBottom + 80 && x.t.toLowerCase() !== handle
        && !/\d/.test(x.t));
      if (below) name = below.t;
    }
    // The tab title carries the display name where the site puts it there: "Fz Arnob (@fz_arnob) • Instagram…".
    const t = document.title.replace(/^\(\d+\+?\)\s*/, '');
    const fromTitle = (t.match(/^(.+?)\s*\(@[\w.-]+\)/) || (SITE === 'facebook' && t.match(/^(.+?)\s*\|\s*Facebook$/)) || [])[1];
    const info = {
      name: (fromTitle && fromTitle.trim()) || (size >= 20 ? name : null) || og('title'),
      avatar: avatar || og('image'),
    };
    if (info.name || info.avatar) profileSeen.set(key, info);
    return info.name || info.avatar ? info : profileSeen.get(key) || info;
  };
  // Signed in? (a cookie the page itself can read; null where the site has none)
  const signedIn = () => {
    const names = { instagram: 'ds_user_id', facebook: 'c_user' }[SITE];
    return names ? document.cookie.split(';').some((c) => c.trim().startsWith(names + '=')) : null;
  };
  let lastUrl = '';
  let lastTitle = '';
  let lastProfile = '';
  const reportPage = () => {
    lastUrl = location.href;
    lastTitle = document.title;
    const profile = profileInfo();
    lastProfile = JSON.stringify(profile);
    post({ type: 'page', url: location.href, title: document.title, profile, signedIn: signedIn() });
  };
  setInterval(() => {
    if (location.href !== lastUrl) { reportPage(); scanSoon(); } else if (document.title !== lastTitle) reportPage();
  }, 500);
  // These sites change the URL first and the page a moment later: keep the details in step with what's shown.
  setInterval(() => {
    if (document.hidden || location.href !== lastUrl) return;
    if (JSON.stringify(profileInfo()) !== lastProfile) reportPage();
  }, 1200);

  if (wv) {
    wv.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'selectMode') {
        selectMode = !!m.on;
        document.documentElement.classList.toggle('ct-select', selectMode);
        scan();
        if (!selectMode) collecting = null;
      } else if (m.type === 'selection') {
        selected = new Set(m.ids || []);
        refreshAll();
      } else if (m.type === 'downloaded') {
        (m.ids || []).forEach((i) => downloaded.add(i));
        refreshAll();
      } else if (m.type === 'css') {
        addStyle('ct-cosmetic', m.css || '');
      } else if (m.type === 'selectAll') {
        selectVisible();
      } else if (m.type === 'collect') {
        if (m.on) collect(m.limit || 500); else collecting = null;
      } else if (m.type === 'refresh') {
        reportPage();
      }
    });
  }

  const start = () => {
    new Observer(scanSoon).observe(document.documentElement, { childList: true, subtree: true });
    post({ type: 'ready', url: location.href });
    reportPage();
    scan();
    setTimeout(reportPage, 2500); // profile header renders late
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
