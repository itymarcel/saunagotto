(function () {
  'use strict';

  const SCENE_TRACKS = { 1: 'burial.mp3', 2: 'ocean.mp3', 3: 'sun.mp3' };
  let currentScene = 1;

  const transition  = document.getElementById('scene-transition');
  const noiseCanvas = document.getElementById('transition-noise');
  const noiseCtx    = noiseCanvas.getContext('2d');
  const oceanVideo  = document.getElementById('ocean-video');

  /* ── TV-noise engine ─────────────────────────────────────────── */
  let noiseRAF = null;

  function resizeNoise() {
    noiseCanvas.width  = Math.max(1, Math.ceil(window.innerWidth  / 4));
    noiseCanvas.height = Math.max(1, Math.ceil(window.innerHeight / 4));
  }
  window.addEventListener('resize', resizeNoise);
  resizeNoise();

  function drawNoise() {
    const w = noiseCanvas.width, h = noiseCanvas.height;
    const img = noiseCtx.createImageData(w, h);
    const d   = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
    }
    noiseCtx.putImageData(img, 0, 0);
    noiseRAF = requestAnimationFrame(drawNoise);
  }
  function startNoise() { if (!noiseRAF) drawNoise(); }
  function stopNoise()  { if (noiseRAF) { cancelAnimationFrame(noiseRAF); noiseRAF = null; } }

  /* ── Scene switching ─────────────────────────────────────────── */
  function wrap(n) { return n < 1 ? 3 : n > 3 ? 1 : n; }

  function goToScene(n) {
    if (n === currentScene) return;
    transition.classList.add('visible');
    startNoise();

    setTimeout(function () {
      document.body.dataset.scene = String(n);

      if (n === 1) {
        window._saunaScene1Resume && window._saunaScene1Resume();
        window._saunaSunPause     && window._saunaSunPause();
      } else if (n === 2) {
        window._saunaScene1Pause  && window._saunaScene1Pause();
        window._saunaSunPause     && window._saunaSunPause();
      } else if (n === 3) {
        window._saunaScene1Pause  && window._saunaScene1Pause();
        window._saunaSunResume    && window._saunaSunResume();
      }

      window._saunaSetTrack && window._saunaSetTrack(SCENE_TRACKS[n]);

      if (n === 2 && oceanVideo) oceanVideo.play().catch(function () {});

      currentScene = n;
    }, 250);

    setTimeout(function () {
      transition.classList.remove('visible');
      stopNoise();
    }, 500);
  }

  /* ── Navigation zones (60 px each side, full height) ─────────── */
  document.getElementById('zone-prev').addEventListener('click', function (e) {
    e.stopPropagation();
    goToScene(wrap(currentScene - 1));
  });
  document.getElementById('zone-next').addEventListener('click', function (e) {
    e.stopPropagation();
    goToScene(wrap(currentScene + 1));
  });

  /* ── Scene 1: click / tap → lightning flash ──────────────────── */
  window.addEventListener('click', function (e) {
    if (currentScene !== 1) return;

    /* Ignore clicks inside the 60 px nav zones */
    if (e.clientX < 60 || e.clientX > window.innerWidth - 60) return;

    /* Convert browser coords → shader UV (y flipped, 0 = bottom) */
    const x = e.clientX / window.innerWidth;
    const y = 1.0 - (e.clientY / window.innerHeight);

    /* Bottom half of screen = ground/surface area (browser y > 55 %) */
    const isGround = (e.clientY > window.innerHeight * 0.55) ? 1.0 : 0.0;

    window._saunaFlash && window._saunaFlash(x, y, isGround);
  });

  /* Same for touch (touchend fires a click too, but belt-and-suspenders
     for devices that suppress synthetic click on fast taps)           */
  window.addEventListener('touchend', function (e) {
    if (currentScene !== 1) return;
    const t = e.changedTouches[0];
    if (!t) return;
    if (t.clientX < 60 || t.clientX > window.innerWidth - 60) return;
    const x = t.clientX / window.innerWidth;
    const y = 1.0 - (t.clientY / window.innerHeight);
    const isGround = (t.clientY > window.innerHeight * 0.55) ? 1.0 : 0.0;
    window._saunaFlash && window._saunaFlash(x, y, isGround);
  }, { passive: true });

  /* ── Scene 3: click / tap → coal steam ──────────────────────── */
  window.addEventListener('click', function (e) {
    if (currentScene !== 3) return;
    if (e.clientX < 60 || e.clientX > window.innerWidth - 60) return;
    const u = e.clientX / window.innerWidth;
    const v = 1.0 - e.clientY / window.innerHeight;  /* flip Y for shader UV */
    window._saunaCoalSteam && window._saunaCoalSteam(u, v);
  });

  window.addEventListener('touchend', function (e) {
    if (currentScene !== 3) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    if (touch.clientX < 60 || touch.clientX > window.innerWidth - 60) return;
    const u = touch.clientX / window.innerWidth;
    const v = 1.0 - touch.clientY / window.innerHeight;
    window._saunaCoalSteam && window._saunaCoalSteam(u, v);
  }, { passive: true });

  /* ── Scene 2: pointer drag scrubs video ─────────────────────── */
  let scrubbing    = false;
  let scrubLastX   = 0;
  let scrubTarget  = 0;
  let scrubCurrent = 0;
  let seekPending  = false;
  const SCRUB_SPX  = 0.04; /* seconds per pixel of drag */

  /* Only one seek in-flight at a time. When it lands, immediately
     seek to the latest target (skipping any intermediate positions).
     This prevents the decoder backlog that causes lag on fast moves. */
  function doSeek() {
    if (!oceanVideo) return;
    seekPending  = true;
    scrubCurrent = scrubTarget;
    oceanVideo.currentTime = scrubCurrent;
  }

  if (oceanVideo) {
    oceanVideo.addEventListener('seeked', function () {
      seekPending = false;
      if (scrubbing && scrubTarget !== scrubCurrent) doSeek();
    });
  }

  function onScrubStart(clientX) {
    if (currentScene !== 2 || !oceanVideo) return;
    scrubbing    = true;
    scrubLastX   = clientX;
    scrubTarget  = oceanVideo.currentTime;
    scrubCurrent = oceanVideo.currentTime;
    oceanVideo.pause();
  }
  function onScrubMove(clientX) {
    if (!scrubbing || !oceanVideo) return;
    const dur   = oceanVideo.duration || 60;
    const delta = (clientX - scrubLastX) * SCRUB_SPX;
    scrubLastX  = clientX;
    const raw   = scrubTarget + delta;
    scrubTarget = ((raw % dur) + dur) % dur;   /* infinite wrap */
    if (!seekPending) doSeek();
  }
  function onScrubEnd() {
    scrubbing = false;
    if (oceanVideo) oceanVideo.play().catch(function () {});
  }

  /* Mouse */
  window.addEventListener('mousedown', function (e) {
    if (currentScene !== 2) return;
    if (e.clientX < 60 || e.clientX > window.innerWidth - 60) return;
    onScrubStart(e.clientX);
  });
  window.addEventListener('mousemove', function (e) { onScrubMove(e.clientX); });
  window.addEventListener('mouseup',   onScrubEnd);

  /* Touch */
  window.addEventListener('touchstart', function (e) {
    if (currentScene !== 2) return;
    const t = e.touches[0];
    if (t.clientX < 60 || t.clientX > window.innerWidth - 60) return;
    onScrubStart(t.clientX);
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (!scrubbing) return;
    e.preventDefault();
    onScrubMove(e.touches[0].clientX);
  }, { passive: false });
  window.addEventListener('touchend', function () {
    if (currentScene === 2) onScrubEnd();
  }, { passive: true });

  /* Initial scene */
  document.body.dataset.scene = '1';

}());
