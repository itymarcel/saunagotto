/**
 * ocean.js – JPEG frame scrubber for Scene 2.
 *
 * Setup:
 *   1. Run:  bash gen-ocean-frames.sh
 *   2. Set TOTAL_FRAMES below to the printed count.
 *   3. Deploy the ocean/ directory alongside the other assets.
 */
(function () {
  'use strict';

  // ── Configuration ────────────────────────────────────────────────────
  const FPS          = 24;
  const TOTAL_FRAMES = 720;    /* ← update after running gen-ocean-frames.sh */
  const DIR          = 'ocean/';
  const PRELOAD_FWD  = 48;     /* frames to preload ahead of playhead        */
  const PRELOAD_BACK = 16;     /* frames to preload behind playhead           */
  const CACHE_MAX    = 120;    /* max decoded images kept in memory           */
  const FRAME_MS     = 1000 / FPS;

  // ── Canvas ───────────────────────────────────────────────────────────
  const canvas = document.getElementById('ocean-canvas');
  const ctx    = canvas && canvas.getContext('2d');

  // ── Frame cache ──────────────────────────────────────────────────────
  const cache    = new Map();   /* frameIndex → HTMLImageElement */
  const inflight = new Set();   /* frameIndex (loading)          */
  let   current  = 0;

  function src(n) {
    return DIR + 'f' + String(n + 1).padStart(4, '0') + '.jpg';
  }

  // ── Drawing ──────────────────────────────────────────────────────────
  function drawCover(img) {
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    const iw = img.naturalWidth  || 854;
    const ih = img.naturalHeight || 480;
    const s  = Math.max(cw / iw, ch / ih);
    ctx.drawImage(img, (cw - iw * s) * 0.5, (ch - ih * s) * 0.5, iw * s, ih * s);
  }

  function draw(n) {
    if (n !== current) return;
    /* Try exact frame first; if not loaded yet fall back to the nearest
       cached frame so the canvas always shows something while loading.  */
    let img = cache.get(n);
    if (!img) {
      for (let d = 1; d < CACHE_MAX; d++) {
        img = cache.get(((n - d) % TOTAL_FRAMES + TOTAL_FRAMES) % TOTAL_FRAMES);
        if (img) break;
        img = cache.get((n + d) % TOTAL_FRAMES);
        if (img) break;
      }
    }
    if (img) drawCover(img);
  }

  // ── Cache management ─────────────────────────────────────────────────
  function evict() {
    if (cache.size <= CACHE_MAX) return;
    let worst = -1, worstDist = 0;
    for (const k of cache.keys()) {
      const d = Math.abs(k - current);
      if (d > worstDist) { worstDist = d; worst = k; }
    }
    if (worst >= 0) cache.delete(worst);
  }

  function load(n) {
    n = ((n % TOTAL_FRAMES) + TOTAL_FRAMES) % TOTAL_FRAMES;
    if (cache.has(n) || inflight.has(n)) return;
    inflight.add(n);
    const img = new Image();
    img.onload  = function () { inflight.delete(n); cache.set(n, img); evict(); draw(n); };
    img.onerror = function () { inflight.delete(n); };
    img.src = src(n);
  }

  function prime(n) {
    load(n);
    for (let i = 1; i <= PRELOAD_FWD;  i++) load(n + i);
    for (let i = 1; i <= PRELOAD_BACK; i++) load(n - i);
  }

  // ── Playback loop ────────────────────────────────────────────────────
  let autoPlay  = false;
  let lastTick  = 0;

  function tick(now) {
    if (autoPlay && now - lastTick >= FRAME_MS) {
      lastTick = now;
      seek((current + 1) % TOTAL_FRAMES);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ── Resize ───────────────────────────────────────────────────────────
  function resize() {
    if (!canvas) return;
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    draw(current);
  }
  window.addEventListener('resize', resize);
  resize();

  // ── Public API ───────────────────────────────────────────────────────
  function seek(n) {
    n = ((n | 0) % TOTAL_FRAMES + TOTAL_FRAMES) % TOTAL_FRAMES;
    current = n;
    prime(n);
    draw(n);
  }

  window._oceanSeek        = seek;
  window._oceanFrame       = function () { return current; };
  window._oceanTotalFrames = TOTAL_FRAMES;
  window._oceanPlay        = function () { autoPlay = true;  prime(current); };
  window._oceanPause       = function () { autoPlay = false; };

  /* Begin preloading immediately so frame 0 is ready when scene 2 opens */
  prime(0);

}());
