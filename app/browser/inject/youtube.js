/* CuteTube – injected into the YouTube pane before any page script runs. */
(() => {
  'use strict';
  if (window.__ctInstalled) return;
  window.__ctInstalled = true;

  const CFG = __CT_CONFIG__;
  if (!/(^|\.)youtube\.com$/.test(location.hostname)) return; // leave Google sign-in pages alone

  const isTop = window.top === window;
  const wv = window.chrome && window.chrome.webview;
  const post = (m) => { try { wv && wv.postMessage(m); } catch (_) {} };

  const addStyle = (id, css) => {
    const apply = () => {
      let s = document.getElementById(id);
      if (!s) {
        s = document.createElement('style');
        s.id = id;
        (document.head || document.documentElement).appendChild(s);
      }
      s.textContent = css;
    };
    if (document.documentElement) apply();
    else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); apply(); } })
      .observe(document, { childList: true });
  };

  /* ------------------------------------------------------------------ *
   * 1. Remove ad payloads from player responses (same idea as uBO's
   *    json-prune), so the player never learns about ads.
   * ------------------------------------------------------------------ */
  if (CFG.adblock) {
    const KEYS = ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams'];
    let pruned = 0;
    let reportTimer = 0;
    const report = () => {
      if (reportTimer || !isTop) return;
      reportTimer = setTimeout(() => { reportTimer = 0; post({ type: 'pruned', n: pruned }); pruned = 0; }, 1500);
    };
    const strip = (o) => {
      let hit = false;
      if (!o || typeof o !== 'object') return hit;
      for (const k of KEYS) {
        if (Object.prototype.hasOwnProperty.call(o, k)) {
          try { delete o[k]; } catch (_) { try { o[k] = undefined; } catch (_) {} }
          hit = true;
        }
      }
      return hit;
    };
    const prune = (o) => {
      try {
        if (o && typeof o === 'object') {
          let hit = strip(o);
          if (o.playerResponse) hit = strip(o.playerResponse) || hit;
          if (Array.isArray(o)) for (const x of o) if (x && x.playerResponse) hit = strip(x.playerResponse) || hit;
          if (hit) { pruned++; report(); }
        }
      } catch (_) {}
      return o;
    };

    const nativeParse = JSON.parse;
    const parse = function parse(text, reviver) { return prune(nativeParse.call(this, text, reviver)); };
    parse.toString = nativeParse.toString.bind(nativeParse);
    JSON.parse = parse;

    const nativeJson = Response.prototype.json;
    Response.prototype.json = function json() { return nativeJson.call(this).then(prune); };

    let initial;
    try {
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        configurable: true,
        get: () => initial,
        set: (v) => { initial = prune(v); },
      });
    } catch (_) {}

    addStyle('ct-adblock', `
      #masthead-ad, ytd-banner-promo-renderer, ytd-statement-banner-renderer, ytd-in-feed-ad-layout-renderer,
      ytd-ad-slot-renderer, ytd-rich-item-renderer:has(ytd-ad-slot-renderer), ytd-rich-section-renderer:has(ytd-statement-banner-renderer),
      ytd-promoted-sparkles-web-renderer, ytd-promoted-video-renderer, ytd-display-ad-renderer, ytd-compact-promoted-video-renderer,
      ytd-search-pyv-renderer, ytd-player-legacy-desktop-watch-ads-renderer, #player-ads, ytd-companion-slot-renderer,
      ytd-action-companion-ad-renderer, ytd-merch-shelf-renderer, ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-ads"],
      .ytp-ad-overlay-container, .ytp-ad-text-overlay, .ytp-featured-product, .ytp-suggested-action,
      ytd-reel-video-renderer:has(ytd-ad-slot-renderer), ytd-mealbar-promo-renderer, yt-mealbar-promo-renderer,
      ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model),
      ytd-item-section-renderer:has(> #contents > ytd-ad-slot-renderer:only-child)
      { display: none !important; }
      body:has(ytd-enforcement-message-view-model) tp-yt-iron-overlay-backdrop { display: none !important; }
    `);

    // Fallback for anything that slips through (e.g. server-stitched ads): mute, fast-forward, skip.
    if (isTop) {
      let inAd = false;
      let saved = { muted: false, rate: 1 };
      setInterval(() => {
        const player = document.getElementById('movie_player');
        const video = player && player.querySelector('video.html5-main-video');
        const adShowing = !!player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
        if (adShowing && video) {
          if (!inAd) { saved = { muted: video.muted, rate: video.playbackRate || 1 }; inAd = true; post({ type: 'adSkipped' }); }
          video.muted = true;
          try { video.playbackRate = 16; } catch (_) {}
          if (isFinite(video.duration) && video.duration > 0 && video.currentTime < video.duration - 0.1) {
            video.currentTime = video.duration - 0.05;
          }
          player.querySelectorAll('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button-slot button')
            .forEach((b) => b.click());
        } else if (inAd && video) {
          inAd = false;
          video.muted = saved.muted;
          video.playbackRate = saved.rate;
        }
        const enforcement = document.querySelector('ytd-enforcement-message-view-model');
        if (enforcement) {
          const dialog = enforcement.closest('tp-yt-paper-dialog');
          if (dialog) dialog.remove();
          document.querySelectorAll('tp-yt-iron-overlay-backdrop').forEach((b) => b.remove());
          if (video && video.paused && video.currentTime > 0) video.play().catch(() => {});
        }
      }, 300);
    }
  }

  if (!isTop) return;

  /* ------------------------------------------------------------------ *
   * 2. Page context for the CuteTube side panel
   * ------------------------------------------------------------------ */
  const currentVideoId = () => {
    const u = new URL(location.href);
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = u.pathname.match(/^\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  };
  const playerDetails = () => {
    try {
      const player = document.getElementById('movie_player');
      const r = player && player.getPlayerResponse && player.getPlayerResponse();
      const d = r && r.videoDetails;
      if (!d) return null;
      return {
        id: d.videoId, title: d.title, channel: d.author, channelId: d.channelId,
        duration: Number(d.lengthSeconds) || null, live: !!d.isLive,
      };
    } catch (_) { return null; }
  };
  let pageTimer = 0;
  const reportPage = (tries = 0) => {
    clearTimeout(pageTimer);
    const vid = currentVideoId();
    let video = null;
    if (vid) {
      const d = playerDetails();
      if (d && d.id === vid) video = d;
      else if (tries < 16) pageTimer = setTimeout(() => reportPage(tries + 1), 250);
    }
    post({ type: 'page', url: location.href, title: document.title, video });
  };

  /* ------------------------------------------------------------------ *
   * 3. Select mode + "Saved" badges on every video tile
   * ------------------------------------------------------------------ */
  const ITEM_SEL = [
    'ytd-rich-item-renderer', 'ytd-video-renderer', 'ytd-grid-video-renderer', 'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer', 'ytd-playlist-panel-video-renderer', 'ytd-reel-item-renderer', 'ytd-rich-grid-media',
    'yt-lockup-view-model', 'ytm-shorts-lockup-view-model', 'ytm-shorts-lockup-view-model-v2',
  ].join(',');
  const SKIP_SEL = '#movie_player, ytd-miniplayer, #masthead-container, tp-yt-app-drawer, ytd-mini-guide-renderer, .ytp-endscreen-content, ' +
    'ytd-in-feed-ad-layout-renderer, ytd-ad-slot-renderer, ytd-promoted-video-renderer';
  const PLAYLIST_ROW = 'ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer';

  let selectMode = false;
  let selected = new Set();
  let downloaded = new Set(CFG.downloaded || []);

  addStyle('ct-ui', `
    [data-ct-id] { position: relative; }
    /* Overlay filling the tile: its border is the selection ring, drawn inside so neighbours can't cover it. */
    .ct-badge { position: absolute; inset: 0; z-index: 40; pointer-events: none; box-sizing: border-box;
      border: 2px solid transparent; border-radius: 12px; transition: border-color .15s ease, background-color .15s ease; }
    .ct-marks { position: absolute; top: 8px; left: 8px; display: flex; gap: 6px; align-items: center; }
    html.ct-select [data-ct-id]:hover > .ct-badge { border-color: rgba(240,80,122,.5); background: rgba(240,80,122,.04); }
    html.ct-select [data-ct-id].ct-selected > .ct-badge { border-color: #F0507A; background: rgba(240,80,122,.08); }
    .ct-check { display: none; width: 26px; height: 26px; border-radius: 50%; box-sizing: border-box;
      background: rgba(10,10,14,.55); border: 2px solid #fff; box-shadow: 0 2px 10px rgba(0,0,0,.45);
      backdrop-filter: blur(4px); transition: transform .15s ease, background .15s ease; }
    html.ct-select .ct-check { display: block; }
    .ct-selected .ct-check { transform: scale(1.08); border-color: #F0507A;
      background: #F0507A url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/15px no-repeat; }
    .ct-saved { display: none; font: 600 11px/1 Roboto, Arial, sans-serif; letter-spacing: .02em; color: #fff;
      background: rgba(16,185,129,.95); padding: 5px 8px; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    .ct-downloaded .ct-saved { display: inline-block; }
    .ct-kind { display: inline-flex; align-items: center; gap: 4px; font: 700 11px/1 Roboto, Arial, sans-serif; letter-spacing: .03em;
      text-transform: uppercase; color: #fff; background: rgba(124,77,255,.95); padding: 5px 8px; border-radius: 999px;
      box-shadow: 0 2px 8px rgba(0,0,0,.35); }
    html.ct-select [data-ct-id], html.ct-select [data-ct-id] * { cursor: pointer !important; }
    html.ct-select ytd-video-preview, html.ct-select #video-preview, html.ct-select ytd-thumbnail-overlay-inline-playback-renderer { display: none !important; }
  `);

  const idFromHref = (href) => {
    if (!href) return null;
    const m = href.match(/[?&]v=([\w-]{11})/) || href.match(/\/shorts\/([\w-]{11})/);
    return m ? m[1] : null;
  };
  const listFromHref = (href) => {
    const m = (href || '').match(/[?&]list=([\w-]{2,64})/);
    return m ? m[1] : null;
  };
  const outermostItem = (el) => {
    let c = el.closest(ITEM_SEL);
    if (!c) return null;
    let up;
    while (c.parentElement && (up = c.parentElement.closest(ITEM_SEL))) c = up;
    return c;
  };
  const textOf = (el) => (el ? (el.getAttribute('title') || el.textContent || '').trim().replace(/\s+/g, ' ') : '');
  const parseDuration = (s) => {
    const m = (s || '').match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : null;
  };
  const metaOf = (c) => {
    const id = c.dataset.ctId;
    const href = c.dataset.ctHref || '';
    const kind = c.dataset.ctKind || 'video';
    const short = /\/shorts\//.test(href);
    let title = textOf(c.querySelector(
      '#video-title, .yt-lockup-metadata-view-model__title, .yt-lockup-metadata-view-model-wiz__title, ' +
      '.shortsLockupViewModelHostMetadataTitle, h3 a[title], h3'));
    if (!title) {
      const a = c.querySelector('a[aria-label]');
      title = a ? a.getAttribute('aria-label') : '';
    }
    const channel = textOf(c.querySelector(
      'ytd-channel-name #text, ytd-channel-name a, .yt-content-metadata-view-model__metadata-text a, ' +
      '.yt-content-metadata-view-model-wiz__metadata-text a'));
    const duration = parseDuration(textOf(c.querySelector(
      'ytd-thumbnail-overlay-time-status-renderer #text, .yt-badge-shape__text, .badge-shape-wiz__text')));
    if (kind !== 'video') {
      // Playlist tiles show e.g. "25 videos" in a badge on the thumbnail.
      const thumbArea = c.querySelector('yt-thumbnail-view-model, ytd-playlist-thumbnail, ytd-thumbnail, .yt-lockup-view-model__content-image');
      const badges = (thumbArea || c).innerText || '';
      const count = badges.match(/(\d[\d,.]*)\s+(videos?|lessons?|episodes?)/i);
      const img = c.querySelector('img[src^="http"]');
      return {
        id, kind, list_id: listFromHref(href), video_id: idFromHref(href),
        title: title.slice(0, 300) || null,
        channel: channel.slice(0, 120) || null,
        count: count ? Number(count[1].replace(/[,.]/g, '')) : null,
        thumb: img ? img.src : null,
      };
    }
    return {
      id, kind, short, duration,
      title: title.slice(0, 300) || null,
      channel: channel.slice(0, 120) || null,
      url: short ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`,
    };
  };

  const decorate = (c) => {
    const id = c.dataset.ctId;
    let badge = c.querySelector(':scope > .ct-badge');
    if (!badge) {
      // No innerHTML: YouTube enforces Trusted Types, so string HTML assignments throw.
      badge = document.createElement('div');
      badge.className = 'ct-badge';
      const check = document.createElement('span');
      check.className = 'ct-check';
      const saved = document.createElement('span');
      saved.className = 'ct-saved';
      saved.textContent = 'Saved';
      const kind = document.createElement('span');
      kind.className = 'ct-kind';
      const marks = document.createElement('div');
      marks.className = 'ct-marks';
      marks.append(check, saved, kind);
      badge.append(marks);
      c.appendChild(badge);
    }
    const kindEl = badge.querySelector('.ct-kind');
    const kind = c.dataset.ctKind;
    if (kindEl) {
      kindEl.textContent = kind === 'mix' ? 'Mix' : kind === 'playlist' ? 'Playlist' : '';
      kindEl.style.display = kind === 'video' ? 'none' : '';
    }
    c.classList.toggle('ct-selected', selected.has(id));
    c.classList.toggle('ct-downloaded', downloaded.has(id));
  };

  const scan = () => {
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="watch?v="], a[href^="/shorts/"], a[href^="/playlist?list="]')) {
      if (a.closest(SKIP_SEL)) continue;
      const href = a.getAttribute('href') || '';
      const c = outermostItem(a);
      if (!c || seen.has(c)) continue;
      // Playlist / mix tiles link to their first video with a list= param; rows inside a playlist are single videos.
      const list = a.closest(PLAYLIST_ROW) ? null : listFromHref(href);
      const kind = list ? (list.startsWith('RD') ? 'mix' : 'playlist') : 'video';
      const id = list ? `pl:${list}` : idFromHref(href);
      if (!id) continue;
      seen.add(c);
      if (c.dataset.ctId !== id) { c.dataset.ctId = id; c.dataset.ctHref = href; c.dataset.ctKind = kind; }
      try { decorate(c); } catch (_) { /* one odd tile must not stop the scan */ }
    }
  };
  let scanTimer = 0;
  let lastScan = 0;
  const scanSoon = () => {
    if (scanTimer) return;
    const wait = Math.max(120, 700 - (Date.now() - lastScan));
    scanTimer = setTimeout(() => { scanTimer = 0; lastScan = Date.now(); scan(); }, wait);
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
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'auxclick']) {
    window.addEventListener(t, onPointer, true);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectMode) post({ type: 'exitSelect' });
  }, true);

  if (wv) {
    wv.addEventListener('message', (e) => {
      const m = e.data || {};
      switch (m.type) {
        case 'selectMode':
          selectMode = !!m.on;
          document.documentElement.classList.toggle('ct-select', selectMode);
          scan();
          break;
        case 'selection':
          selected = new Set(m.ids || []);
          refreshAll();
          break;
        case 'downloaded':
          if (m.reset) downloaded = new Set();
          (m.ids || []).forEach((i) => downloaded.add(i));
          refreshAll();
          break;
        case 'css':
          addStyle('ct-cosmetic', m.css || '');
          break;
        case 'selectAll': {
          scan();
          const items = [];
          document.querySelectorAll('[data-ct-id]').forEach((c) => {
            if (c.closest(SKIP_SEL) || c.offsetParent === null || c.dataset.ctKind !== 'video') return;
            if (!selected.has(c.dataset.ctId)) { selected.add(c.dataset.ctId); items.push(metaOf(c)); }
            decorate(c);
          });
          if (items.length) post({ type: 'addMany', items });
          break;
        }
        case 'refresh':
          reportPage();
          break;
      }
    });
  }

  const start = () => {
    new MutationObserver(scanSoon).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', () => { reportPage(); scanSoon(); });
    document.addEventListener('yt-page-data-updated', () => reportPage());
    post({ type: 'ready', url: location.href });
    reportPage();
    scan();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
