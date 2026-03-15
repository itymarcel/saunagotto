/**
 * gyro.js – Device orientation sensor, no permission required.
 *
 * Reads DeviceOrientationEvent and exposes smooth, self-calibrated
 * gamma (left/right tilt) and beta (forward/back tilt), each normalised
 * to the range −1 … +1.
 *
 * Works out-of-the-box on Android Chrome/Firefox.
 * On iOS 13+, DeviceOrientationEvent requires a one-time permission.
 * Call window._gyroRequestPermission() inside a user gesture to trigger
 * the iOS system dialog (see index.html intro overlay click handler).
 */
(function () {
  'use strict';

  let smoothG = 0, smoothB = 0;   /* lerped output, -1..1              */
  let rawG    = 0, rawB    = 0;   /* calibrated but un-smoothed        */
  let active  = false;

  /* Self-calibration: average the first N readings as the neutral pose.
     Corrects for the phone's resting angle in the user's hand.         */
  let calG = null, calB = null;
  let sumG = 0, sumB = 0, calN = 0;
  const CAL_SAMPLES = 25;

  function onOrientation(e) {
    if (e.gamma == null) return;
    active = true;

    const g =  e.gamma;           /* left/right tilt: -90..90            */
    const b = (e.beta || 0) - 90; /* front/back, normalised so upright=0 */

    if (calG === null) {
      sumG += g; sumB += b; calN++;
      if (calN >= CAL_SAMPLES) { calG = sumG / calN; calB = sumB / calN; }
      return;
    }

    rawG = Math.max(-1, Math.min(1, (g - calG) / 90));
    rawB = Math.max(-1, Math.min(1, (b - calB) / 90));
  }

  window.addEventListener('deviceorientation', onOrientation, { passive: true });

  /* Smooth on rAF – slow lerp keeps motion silky, not jittery */
  (function tick() {
    const L = 0.055;
    smoothG += (rawG - smoothG) * L;
    smoothB += (rawB - smoothB) * L;
    requestAnimationFrame(tick);
  }());

  /* ── Public API ──────────────────────────────────────────────────── */
  window._gyro = {
    gamma:  function () { return smoothG; },  /* left/right tilt -1..1  */
    beta:   function () { return smoothB; },  /* fwd/back tilt  -1..1   */
    active: function () { return active;  },
  };

  /* Optional iOS 13+ permission request — call from a user gesture.
     Silently no-ops on platforms that don't need it.               */
  window._gyroRequestPermission = function () {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().catch(function () {});
    }
  };

}());
