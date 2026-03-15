(function () {
  'use strict';

  const SCENE_TRACKS = { 1: 'burial.mp3', 2: 'ocean.mp3', 3: 'sun.mp3' };
  let currentScene = 1;

  const transition  = document.getElementById('scene-transition');
  const noiseCanvas = document.getElementById('transition-noise');
  const noiseCtx    = noiseCanvas.getContext('2d');

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

      if (n === 2) { window._oceanPlay  && window._oceanPlay();  }
      else         { window._oceanPause && window._oceanPause(); }

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

  /* ── Scene 1: mousedown / touchstart → lightning flash ─────────── */
  window.addEventListener('mousedown', function (e) {
    if (currentScene !== 1) return;
    if (e.clientX < 60 || e.clientX > window.innerWidth - 60) return;
    const x = e.clientX / window.innerWidth;
    const y = 1.0 - (e.clientY / window.innerHeight);
    const isGround = (e.clientY > window.innerHeight * 0.55) ? 1.0 : 0.0;
    window._saunaFlash && window._saunaFlash(x, y, isGround);
  });

  window.addEventListener('touchstart', function (e) {
    if (currentScene !== 1) return;
    const t = e.touches[0];
    if (!t) return;
    if (t.clientX < 60 || t.clientX > window.innerWidth - 60) return;
    const x = t.clientX / window.innerWidth;
    const y = 1.0 - (t.clientY / window.innerHeight);
    const isGround = (t.clientY > window.innerHeight * 0.55) ? 1.0 : 0.0;
    window._saunaFlash && window._saunaFlash(x, y, isGround);
  }, { passive: true });

  /* ── Scene 3: hold → continuous steam, release → stop ──────────── */
  let steamInterval = null;
  let steamU = 0.5, steamV = 0.5;

  function startSteam(clientX, clientY) {
    if (clientX < 60 || clientX > window.innerWidth - 60) return;
    steamU = clientX / window.innerWidth;
    steamV = 1.0 - clientY / window.innerHeight;
    window._saunaCoalSteam && window._saunaCoalSteam(steamU, steamV);
    if (steamInterval) return;

    /* Recursive setTimeout so each puff schedules the next with a fresh
       delay sampled from a 120 BPM sine wave (period = 500 ms).
       delay = 45 + 35 * sin(2π * t * 2)  →  range [10, 80] ms          */
    function schedulePuff() {
      var t = performance.now() * 0.001;
      var delay = 45 + 35 * Math.sin(2 * Math.PI * 2 * t);
      steamInterval = setTimeout(function () {
        window._saunaCoalSteam && window._saunaCoalSteam(steamU, steamV);
        schedulePuff();
      }, delay);
    }
    schedulePuff();
  }

  function stopSteam() {
    clearTimeout(steamInterval);
    steamInterval = null;
    window._saunaCoalSteamRelease && window._saunaCoalSteamRelease();
  }

  window.addEventListener('mousedown', function (e) {
    if (currentScene !== 3) return;
    startSteam(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', function (e) {
    if (currentScene === 3 && steamInterval) {
      if (e.clientX >= 60 && e.clientX <= window.innerWidth - 60) {
        steamU = e.clientX / window.innerWidth;
        steamV = 1.0 - e.clientY / window.innerHeight;
      }
    }
  });
  window.addEventListener('mouseup', function () {
    if (currentScene === 3) stopSteam();
  });

  window.addEventListener('touchstart', function (e) {
    if (currentScene !== 3) return;
    const touch = e.touches[0];
    if (!touch) return;
    startSteam(touch.clientX, touch.clientY);
  }, { passive: true });
  window.addEventListener('touchmove', function (e) {
    if (currentScene !== 3 || !steamInterval) return;
    const touch = e.touches[0];
    if (!touch) return;
    if (touch.clientX >= 60 && touch.clientX <= window.innerWidth - 60) {
      steamU = touch.clientX / window.innerWidth;
      steamV = 1.0 - touch.clientY / window.innerHeight;
    }
  }, { passive: true });
  window.addEventListener('touchend', function () {
    if (currentScene === 3) stopSteam();
  }, { passive: true });

  /* ── Scene 2: drag scrubs JPEG frame sequence ───────────────── */
  let scrubbing  = false;
  let scrubLastX = 0;
  let scrubPos   = 0;    /* fractional frame position for smooth sub-frame drag */
  const SCRUB_FPX = 1.0; /* frames advanced per pixel of drag (24 fps)         */

  function onScrubStart(clientX) {
    if (currentScene !== 2) return;
    scrubbing  = true;
    scrubLastX = clientX;
    scrubPos   = (window._oceanFrame && window._oceanFrame()) || 0;
    window._oceanPause && window._oceanPause();
  }
  function onScrubMove(clientX) {
    if (!scrubbing) return;
    const total = (window._oceanTotalFrames) || 1;
    scrubPos   += (clientX - scrubLastX) * SCRUB_FPX;
    scrubLastX  = clientX;
    scrubPos    = ((scrubPos % total) + total) % total;  /* infinite wrap */
    window._oceanSeek && window._oceanSeek(scrubPos | 0);
  }
  function onScrubEnd() {
    scrubbing = false;
    window._oceanPlay && window._oceanPlay();
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

  /* ── Gyro scrub for Scene 2 ─────────────────────────────────────
     When the phone is tilted left/right (gamma), the ocean scrubs.
     Past a small dead-zone: pause autoplay and drive frame by tilt.
     Return to level: resume autoplay.                              */
  var lastGyroNow  = performance.now();
  var gyroScrubPos = 0;
  var gyroTilted   = false;

  (function gyroTick(now) {
    requestAnimationFrame(gyroTick);
    var dt = Math.min((now - lastGyroNow) * 0.001, 0.1);
    lastGyroNow = now;

    if (currentScene !== 2 || scrubbing || !window._gyro || !window._gyro.active()) {
      if (gyroTilted && currentScene !== 2) gyroTilted = false;
      return;
    }

    var g = window._gyro.gamma();
    if (Math.abs(g) > 0.08) {
      if (!gyroTilted) {
        gyroTilted   = true;
        gyroScrubPos = (window._oceanFrame && window._oceanFrame()) || 0;
        window._oceanPause && window._oceanPause();
      }
      var total = window._oceanTotalFrames || 1;
      gyroScrubPos += g * 40 * dt;
      gyroScrubPos  = ((gyroScrubPos % total) + total) % total;
      window._oceanSeek && window._oceanSeek(gyroScrubPos | 0);
    } else if (gyroTilted) {
      gyroTilted = false;
      window._oceanPlay && window._oceanPlay();
    }
  }(performance.now()));

  /* Initial scene */
  document.body.dataset.scene = '1';

}());
