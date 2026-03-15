(function () {
  'use strict';

  const btn   = document.getElementById('sound-btn');
  const label = btn.querySelector('.btn-label');

  /* Crossfade window in seconds.  Each segment fades in over FADE s,
     plays until FADE s before the buffer end, then fades out while the
     next segment (fresh random offset, 10–65 % through the file) fades
     in.  No Web Audio API → no CORS restriction on file:// origins.  */
  const FADE = 5.0;

  let isPlaying = false;
  let activeRAFs = [];   /* all running fade loops, so we can cancel them */
  let currentTrackFile = 'burial.mp3';

  const P = [
    { el: null, handoffSet: false },
    { el: null, handoffSet: false },
  ];

  function buildPlayer(i) {
    const el   = new Audio(currentTrackFile);
    el.preload = 'auto';
    el.volume  = 0;
    el.onerror = function () { isPlaying = false; };
    P[i] = { el, handoffSet: false };
  }

  /* ── RAF-based volume ramp (no Web Audio needed) ────────────────── */
  function fadeVolume(el, from, to, durationSec, onDone) {
    const startMs = performance.now();
    const durMs   = durationSec * 1000;
    function step(now) {
      const t  = Math.min((now - startMs) / durMs, 1);
      el.volume = Math.max(0, Math.min(1, from + (to - from) * t));
      if (t < 1) {
        activeRAFs.push(requestAnimationFrame(step));
      } else if (onDone) {
        onDone();
      }
    }
    activeRAFs.push(requestAnimationFrame(step));
  }

  function cancelAllFades() {
    activeRAFs.forEach(cancelAnimationFrame);
    activeRAFs = [];
  }

  /* ── Crossfade segment scheduling ──────────────────────────────── */
  function playFrom(i) {
    if (!isPlaying) return;
    const p   = P[i];
    const dur = p.el.duration;
    /* Start between 10 % and 65 % through the file                 */
    const off = dur * (0.10 + Math.random() * 0.55);
    p.el.currentTime = off;
    p.el.volume      = 0;
    p.el.play().catch(() => {});
    fadeVolume(p.el, 0, 1, FADE);
    p.handoffSet = false;

    p.el.ontimeupdate = () => {
      if (!isPlaying || p.handoffSet) return;
      if (p.el.duration - p.el.currentTime <= FADE + 0.3) {
        p.handoffSet = true;
        crossfade(i);
      }
    };
  }

  function crossfade(fromIdx) {
    if (!isPlaying) return;
    const toIdx = 1 - fromIdx;
    const from  = P[fromIdx];
    const to    = P[toIdx];

    fadeVolume(from.el, from.el.volume, 0, FADE, () => {
      try { from.el.pause(); } catch (e) {}
    });

    const go = () => playFrom(toIdx);
    if (to.el.readyState >= 1) {
      go();
    } else {
      to.el.addEventListener('loadedmetadata', go, { once: true });
    }
  }

  /* ── Enable / disable ───────────────────────────────────────────── */
  function enable() {
    btn.disabled = true;
    label.textContent = 'Loading…';

    buildPlayer(0);
    buildPlayer(1);
    isPlaying = true;

    const p = P[0];
    p.el.volume = 0;

    /* ── Mobile-safe play ───────────────────────────────────────────
       play() MUST be called synchronously within the user-gesture
       call stack – if we wait for loadedmetadata first, the gesture
       context has already expired and the browser blocks playback.
       We call play() now (audio will start from the beginning), then
       seek to the random offset once duration is known.             */
    const prom = p.el.play();

    function finishSetup() {
      if (!isPlaying) return;
      const dur = p.el.duration;
      if (dur && isFinite(dur)) {
        p.el.currentTime = dur * (0.10 + Math.random() * 0.55);
      }
      fadeVolume(p.el, 0, 1, FADE);
      p.handoffSet = false;
      p.el.ontimeupdate = () => {
        if (!isPlaying || p.handoffSet) return;
        if (p.el.duration - p.el.currentTime <= FADE + 0.3) {
          p.handoffSet = true;
          crossfade(0);
        }
      };
    }

    if (prom !== undefined) {
      prom.then(() => {
        if (p.el.readyState >= 1 && isFinite(p.el.duration)) {
          finishSetup();
        } else {
          p.el.addEventListener('loadedmetadata', finishSetup, { once: true });
        }
      }).catch(err => {
        /* Blocked (should only happen if called outside gesture context) */
        console.warn('[sound] play blocked:', err.name);
        isPlaying = false;
        btn.classList.remove('playing');
        btn.setAttribute('aria-label', 'Enable Sound');
        label.textContent = 'Enable Sound';
        btn.disabled = false;
      });
    } else {
      /* Old non-Promise audio API */
      if (p.el.readyState >= 1 && isFinite(p.el.duration)) {
        finishSetup();
      } else {
        p.el.addEventListener('loadedmetadata', finishSetup, { once: true });
      }
    }

    btn.classList.add('playing');
    btn.setAttribute('aria-label', 'Disable Sound');
    label.textContent = 'Disable Sound';
    btn.disabled = false;
  }

  function disable() {
    isPlaying = false;
    cancelAllFades();
    P.forEach(p => {
      if (!p.el) return;
      p.el.ontimeupdate = null;
      fadeVolume(p.el, p.el.volume, 0, 2.0, () => {
        try { p.el.pause(); } catch (e) {}
      });
    });
    btn.classList.remove('playing');
    btn.setAttribute('aria-label', 'Enable Sound');
    label.textContent = 'Enable Sound';
  }

  btn.addEventListener('click', () => {
    if (!isPlaying) enable();
    else            disable();
  });

  /* Expose enable() so the overlay coordinator can call it          */
  window._saunaEnableSound = enable;

  /* Switch to a different audio track (fails silently if file missing) */
  window._saunaSetTrack = function (filename) {
    if (filename === currentTrackFile) return;

    const wasPlaying = isPlaying;

    cancelAllFades();
    P.forEach(function (p) {
      if (!p.el) return;
      p.el.ontimeupdate = null;
      p.el.onerror      = null;
      try { p.el.pause(); } catch (e) {}
      p.el.src = '';
    });

    currentTrackFile = filename;
    isPlaying = false;
    buildPlayer(0);
    buildPlayer(1);

    if (wasPlaying) {
      isPlaying = true;
      const p = P[0];
      p.el.volume = 0;
      const prom = p.el.play();

      function ftSetup() {
        if (!isPlaying) return;
        const dur = p.el.duration;
        if (dur && isFinite(dur)) {
          p.el.currentTime = dur * (0.10 + Math.random() * 0.55);
        }
        fadeVolume(p.el, 0, 1, FADE);
        p.handoffSet = false;
        p.el.ontimeupdate = function () {
          if (!isPlaying || p.handoffSet) return;
          if (p.el.duration - p.el.currentTime <= FADE + 0.3) {
            p.handoffSet = true;
            crossfade(0);
          }
        };
      }

      if (prom !== undefined) {
        prom.then(function () {
          if (p.el.readyState >= 1 && isFinite(p.el.duration)) {
            ftSetup();
          } else {
            p.el.addEventListener('loadedmetadata', ftSetup, { once: true });
          }
        }).catch(function () { isPlaying = false; });
      } else {
        if (p.el.readyState >= 1 && isFinite(p.el.duration)) {
          ftSetup();
        } else {
          p.el.addEventListener('loadedmetadata', ftSetup, { once: true });
        }
      }
    }
  };

  /* ── Autoplay probe ─────────────────────────────────────────────
     Try to play a silent clone of the audio file. If the browser
     allows it (desktop with sufficient media-engagement score),
     kick off real playback immediately and signal the intro start.
     On mobile / strict autoplay policies this will reject silently
     and the overlay stays visible waiting for a tap.              */
  (function tryAutoplay() {
    const probe = new Audio('burial.mp3');
    probe.volume = 0;
    probe.preload = 'metadata';

    function attempt() {
      const p = probe.play();
      if (!p) return; /* legacy API – can't detect, leave overlay up */
      p.then(function () {
        probe.pause();
        enable();
        document.dispatchEvent(new Event('sauna:autoplay-ok'));
      }).catch(function () {
        /* blocked – overlay will handle it */
      });
    }

    if (probe.readyState >= 1) {
      attempt();
    } else {
      probe.addEventListener('loadedmetadata', attempt, { once: true });
    }
  }());

}());
