/**
 * main.js – WebGL heat-haze / Fata Morgana background shader
 *
 * Pure WebGL 1.0, zero dependencies.
 *
 * What the shader does:
 *   1. Renders a dark "hot summer road" scene: asphalt below, near-black
 *      sky above, warm horizon haze.
 *   2. Distorts UVs with two-layer FBM noise (slow large warp + fast
 *      fine shimmer), intensity strongest near the ground.
 *   3. Fata Morgana band: just below the horizon, UV coords are flipped
 *      and heavily distorted so you see a wavering mirror of the sky –
 *      the classic desert mirage illusion.
 *   4. Rising heat glow: narrow bright-orange wisps that drift upward.
 *   5. Vignette: soft darkening toward screen edges.
 */

(function () {
  'use strict';

  const canvas = document.getElementById('bg');
  const gl = canvas.getContext('webgl') ||
    canvas.getContext('experimental-webgl');

  if (!gl) {
    // No WebGL (e.g. Brave fingerprinting shield set to Strict).
    // CSS fallback gradient activates via this class.
    console.warn('[bg] WebGL unavailable. In Brave: click the Shield icon → ' +
      'turn off Fingerprinting protection for this page.');
    document.body.classList.add('no-webgl');
    canvas.style.display = 'none';
    return;
  }

  console.log('[bg] WebGL OK –', gl.getParameter(gl.RENDERER));

  /* ================================================================
     VERTEX SHADER – fullscreen quad passthrough
     ================================================================ */
  const VS = /* glsl */`
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;

  /* ================================================================
     FRAGMENT SHADER
     Heat-ripple / Fata Morgana background.

     Distortion model: light bending through hot air above asphalt.
     - Noise sampled with LOW x-frequency and HIGH y-frequency so
       the FBM contour lines run HORIZONTALLY (parallel to road).
     - sin() of that noise carves those contours into ripple bands.
     - Displacement is mostly in X (horizontal wiggle) – exactly
       what you see when looking at a building or pole through heat
       shimmer: its edge appears to wave left-right.
     - Three layers: slow wide ripples + medium detail + fast glint.
     ================================================================ */
  const FS = /* glsl */`
    precision mediump float;

    uniform vec2  u_res;
    uniform float u_time;
    uniform vec2  u_mouse;   /* normalised offset: +x right, +y up [-0.5,0.5] */
    uniform float u_intro;   /* Y-offset added to hz: starts negative, eases to 0 */

    /* ── Noise ──────────────────────────────────────────────────── */
    float hash(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),                hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x),
        u.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2  r = mat2(0.8660, 0.5000, -0.5000, 0.8660);
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p  = r * p * 2.13 + vec2(3.7, 8.1);
        a *= 0.5;
      }
      return v;
    }

    /* ── Warm iridescent palette ─────────────────────────────────
       Cycles: orange → gold → copper-amber → brief copper-magenta.
       r channel ≥ 0.30 throughout → always stays in warm region.  */
    vec3 warmIrid(float t) {
      vec3 base = vec3(0.30, 0.08, 0.01);
      float r = 0.25 + 0.25 * cos(t * 6.28318);
      float g = 0.20 * (0.5 + 0.5 * cos(t * 6.28318 - 1.20));
      float b = 0.06 * (0.5 + 0.5 * cos(t * 6.28318 + 2.00));
      return base + vec3(r, max(g, 0.0), max(b, 0.0));
    }

    /* ── Curved horizon ──────────────────────────────────────────
       Gentle arch: center 7% higher than edges (uv.y is 0=bottom).
       At x=0.5: hz=0.47.   At x=0 or 1: hz=0.40.                 */
    float horizonY(float x) {
      float dx = x - 0.5;
      return 0.40 + 0.07 * (1.0 - 4.0 * dx * dx);
    }

    /* ── Procedural star layer ───────────────────────────────────
       Divides UV into a grid of cells. Each cell may contain one
       star at a random position. densityMod > 0 raises the density
       (lowers the gate threshold so more cells get a star).       */
    float starLayer(vec2 uv, float gridSize, float densityMod) {
      vec2  cell   = floor(uv * gridSize);
      vec2  local  = fract(uv * gridSize) - 0.5;   /* centre local */
      /* random offset keeps stars away from grid corners           */
      vec2  offset = vec2(hash(cell)        - 0.5,
                          hash(cell + 13.7) - 0.5) * 0.62;
      float dist   = length(local - offset);
      /* radius: small variation per star                           */
      float radius = 0.032 + hash(cell + 5.1) * 0.024;
      /* density gate: fewer stars where densityMod is low         */
      float gate   = step(0.70 - densityMod * 0.18, hash(cell + 42.0));
      /* per-star brightness variation                              */
      float bright = 0.40 + 0.60 * hash(cell + 11.0);
      return gate * smoothstep(radius, radius * 0.08, dist) * bright;
    }

    /* ── Galaxy star layer ───────────────────────────────────────
       Variant of starLayer for galaxy-patch overlays.
       Radius matches normal stars so they're always ≥1 px on
       screen; smoothstep inner limit is much tighter (0.05×)
       so they read as hard bright pinpoints rather than soft
       discs. Density and brightness are driven by the caller's
       galaxyField value so they naturally peak at the nucleus.  */
    float starLayerSharp(vec2 uv, float gridSize, float densityMod) {
      vec2  cell   = floor(uv * gridSize);
      vec2  local  = fract(uv * gridSize) - 0.5;
      vec2  offset = vec2(hash(cell)        - 0.5,
                          hash(cell + 13.7) - 0.5) * 0.62;
      float dist   = length(local - offset);
      float radius = 0.026 + hash(cell + 5.1) * 0.014;   /* same range as starLayer */
      float gate   = step(0.42 - densityMod * 0.20, hash(cell + 42.0)); /* denser  */
      float bright = 0.65 + 0.35 * hash(cell + 11.0);    /* brighter baseline       */
      return gate * smoothstep(radius, radius * 0.05, dist) * bright;   /* crisper  */
    }

    /* ── Distant lightning ───────────────────────────────────────
       Returns a vec3 colour contribution for one storm cell:
         • wide soft glow  (diffuse cloud illumination)
         • main bolt       (8 connected angled line segments)
         • one branch      (5 segments, forks at ~40 % down)
       Each segment starts where the previous ended so the bolt
       is a genuine connected polyline at real angles, not a
       vertical staircase. Per-segment amplitude variation makes
       some segments lunge sideways, others stay nearly straight –
       matching the look of actual lightning.
       Fires in ~35 % of time slots; slot length 5–9 s per cell.
       seed – per-cell constant that desynchronises cells.        */
    vec3 lightningContrib(vec2 suv, float hz, float time,
                          float seed, float iriPhase) {
      /* ── Timing ─────────────────────────────────────────────── */
      float slotLen = 5.0 + hash(vec2(seed, 0.13)) * 4.0;
      float slot    = floor(time / slotLen);
      float slotT   = fract(time / slotLen);
      float fires   = step(hash(vec2(slot, seed + 1.7)), 0.35);

      float stX  = 0.05 + hash(vec2(slot, seed + 2.3)) * 0.90;
      float stY  = hz   + 0.03 + hash(vec2(slot, seed + 3.9)) * 0.14;
      float when = 0.10 + hash(vec2(slot, seed + 4.1)) * 0.65;
      float dt   = slotT - when;
      float f1   = step(0.0, dt) * exp(-dt * 65.0);
      float dt2  = dt - 0.05 - hash(vec2(slot, seed + 5.7)) * 0.025;
      float f2   = step(0.0, dt2) * exp(-dt2 * 90.0) * 0.55;
      float flashT = fires * (f1 + f2);

      /* ── Glow (wide atmospheric bloom, stays in sky) ────────── */
      float gdx     = suv.x - stX;
      float gdy     = suv.y - stY;
      float glow    = exp(-(gdx * gdx * 5.0 + gdy * gdy * 9.0));
      float skyMask = smoothstep(hz - 0.01, hz + 0.04, suv.y);
      float glowL   = flashT * glow * skyMask;

      /* ── Main bolt: 8 connected angled line segments ─────────
         segH is fixed so the bolt always spans exactly bh in Y.
         The random lateral defl per segment – scaled by a per-
         segment amplitude – gives the characteristic look where
         some steps are nearly straight and others lunge sharply.
         Slot number is mixed into the hash so shape changes each
         flash, not just the timing.                              */
      float bh      = 0.09 + hash(vec2(seed, 7.3)) * 0.07;
      float boltTop = hz - 0.01 - hash(vec2(slot, seed + 6.5)) * 0.04;
      float segH    = bh / 32.0;

      float boltDist = 1000.0;
      vec2  prevPt   = vec2(stX, boltTop);
      vec2  branchPt = prevPt;   /* set at k == 12  (~40 % of 32) */

      for (int k = 0; k < 32; k++) {
        float fk   = float(k);
        /* amplitude varies per segment: 0.5–2.0× base deflection  */
        float amp  = 0.5 + hash(vec2(fk * 3.73, seed + slot * 0.13 + 15.0)) * 1.5;
        float defl = (hash(vec2(fk * 7.31 + slot * 0.17, seed + 10.0)) - 0.5)
                   * 0.018 * amp;
        vec2  nextPt = vec2(prevPt.x + defl, prevPt.y - segH);

        /* min-distance from suv to this line segment              */
        vec2  ab  = nextPt - prevPt;
        vec2  ap  = suv    - prevPt;
        float tSg = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        boltDist  = min(boltDist, length(ap - tSg * ab));

        if (k == 12) branchPt = mix(prevPt, nextPt, 0.5);
        prevPt = nextPt;
      }

      /* taper: low → high → low opacity (sine bell over bolt length)
         Peaks at the midpoint; fades to near-zero at both ends.    */
      float relY  = clamp((boltTop - suv.y) / bh, 0.0, 1.0);
      float taper = sin(relY * 3.14159);
      float inB   = step(boltTop - bh, suv.y) * step(suv.y, boltTop);
      float boltL    = (smoothstep(0.0006,  0.00005, boltDist)
                      + smoothstep(0.0025,  0.0002,  boltDist) * 0.22)
                     * taper * inB * flashT;
      /* Wide atmospheric corona: medium halo + broad diffuse spread.
         exp() falloff keeps it smooth; two layers give a bright inner
         ring that bleeds into a very wide dim halo.                 */
      float boltGlow = (exp(-boltDist * 22.0) * 0.55
                      + exp(-boltDist *  6.0) * 0.30)
                     * taper * inB * flashT;

      /* ── Branch: 5 segments forking at ~40 % down ────────────
         A strong per-flash lean biases the branch to one side so
         it reads as a distinct fork, not a parallel copy.        */
      float brLen      = bh * 0.55;
      float brSegH     = brLen / 20.0;
      float brLean     = (hash(vec2(seed + slot * 0.23, 31.0)) - 0.5) * 0.065;
      float branchDist = 1000.0;
      vec2  brPrev     = branchPt;

      for (int k = 0; k < 20; k++) {
        float fk     = float(k);
        float brAmp  = 0.5 + hash(vec2(fk * 4.11, seed + slot * 0.19 + 25.0)) * 1.2;
        float defl   = (hash(vec2(fk * 11.7 + slot * 0.19, seed + 20.0)) - 0.5)
                     * 0.014 * brAmp + brLean;
        /* Clamp x so the branch can't wander more than ±0.22 UV
           from the strike point – prevents runaway off-screen drift. */
        vec2  brNext = vec2(clamp(brPrev.x + defl, stX - 0.22, stX + 0.22),
                            brPrev.y - brSegH);

        vec2  ab  = brNext - brPrev;
        vec2  ap  = suv    - brPrev;
        float tSg = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        branchDist = min(branchDist, length(ap - tSg * ab));
        brPrev = brNext;
      }

      float brRelY = clamp((branchPt.y - suv.y) / brLen, 0.0, 1.0);
      float inBr   = step(branchPt.y - brLen, suv.y) * step(suv.y, branchPt.y);
      float brL    = smoothstep(0.0005, 0.00005, branchDist)
                   * sin(brRelY * 3.14159) * inBr * 0.40 * flashT;
      float brGlow = (exp(-branchDist * 26.0) * 0.35
                    + exp(-branchDist *  7.0) * 0.18)
                   * sin(brRelY * 3.14159) * inBr * flashT;

      /* ── Per-flash colour: one of 4 purple shades ───────────────
         hash → 0-3 index, stable for the full flash (slot-locked).
         Shades range from cool blue-violet to warm magenta-purple.  */
      float colorRoll = hash(vec2(slot * 0.07 + seed, seed + 99.3));
      float shade     = floor(colorRoll * 4.0);   /* 0, 1, 2, or 3  */

      /* Glow tint (wide corona) and core tint (electric channel)   */
      vec3 glowTint =
        shade < 1.0 ? vec3(0.36, 0.20, 0.72) :   /* muted violet    */
        shade < 2.0 ? vec3(0.54, 0.23, 0.78) :   /* dusty purple    */
        shade < 3.0 ? vec3(0.62, 0.22, 0.70) :   /* muted magenta   */
                      vec3(0.29, 0.24, 0.73) ;    /* slate blue-vio  */

      vec3 coreTint =
        shade < 1.0 ? vec3(0.73, 0.60, 0.94) :   /* soft violet     */
        shade < 2.0 ? vec3(0.87, 0.67, 0.96) :   /* dusty lavender  */
        shade < 3.0 ? vec3(0.91, 0.64, 0.93) :   /* pale orchid     */
                      vec3(0.68, 0.68, 0.95) ;    /* periwinkle grey */

      /* Blend glow tint lightly with the warm iridescent sky hue   */
      vec3 glowCol = mix(glowTint, warmIrid(iriPhase + 0.5) * 1.1, 0.20);
      vec3 boltCol = coreTint;
      return glowCol * (glowL * 1.4 + boltGlow + brGlow)
           + boltCol * (boltL + brL) * 0.0; /* TEST: bolts hidden */
    }

    /* ── Main ───────────────────────────────────────────────────── */
    void main() {
      vec2  uv = gl_FragCoord.xy / u_res;
      /* Two time streams: slow for main ripples, u_time for glint  */
      float t  = u_time * 0.07;

      /* ── Camera parallax ─────────────────────────────────────────
         sceneUV is the mouse-shifted version of uv used for all
         scene geometry (horizon, ripples, mirage, glow, haze).
         Stars and vignette keep the raw uv so they stay anchored.
         Mouse +x → scene drifts right. Mouse +y (up) → scene drifts up.
         Amplitudes: horiz 0.06, vert 0.04 of full UV range.       */
      vec2  sceneUV = uv + vec2(-u_mouse.x * 0.13, u_mouse.y * 0.06);

      float hz  = horizonY(sceneUV.x) + u_intro;
      /* Ground mask: 1 at bottom, fades to 0 at the horizon.
         Ripples live only below the curved horizon line.
         Guard against hz≤0 during intro (when scene is off-screen). */
      float gnd = pow(clamp(1.0 - sceneUV.y / max(hz, 0.0001), 0.0, 1.0), 0.75);

      /* ── Heat-ripple distortion ──────────────────────────────────
         Sampling pattern:
           x-scale LOW  (0.8)  → long horizontal correlation →
                                  contour lines run horizontally
           y-scale HIGH (5.5)  → short vertical correlation →
                                  bands are narrow vertically
         Result: FBM level sets are roughly horizontal bands.
         sin(fbm * 3π) slices those bands into alternating
         +/- displacement stripes – the ripple pattern.             */

      /* Layer 1 – wide slow ripples (the main shimmer body) */
      vec2  r1uv = vec2(sceneUV.x * 0.80 + noise(vec2(sceneUV.y * 0.3, t * 0.15)) * 0.12,
                        sceneUV.y * 5.50 - t * 0.55);
      float rn1  = fbm(r1uv);
      float rph1 = rn1 * 9.42478;               /* × 3π → ~1.5 band cycles */
      vec2  wideD = vec2(sin(rph1),             /* X: strong               */
                         cos(rph1) * 0.20)      /* Y: weak (≈ 1/5 of X)   */
                  * 0.024;

      /* Layer 2 – medium ripples (adds detail, breaks uniformity) */
      vec2  r2uv = vec2(sceneUV.x * 1.60, sceneUV.y * 8.00 - t * 1.60);
      float rn2  = fbm(r2uv);
      float rph2 = rn2 * 6.28318;
      vec2  midD = vec2(sin(rph2),
                        cos(rph2) * 0.15) * 0.007;

      /* Layer 3 – fast micro-glint (the quick glittering quality
         of heat shimmer; pure horizontal, no vertical component)   */
      vec2  r3uv = vec2(sceneUV.x * 4.00, sceneUV.y * 14.0 - u_time * 1.10);
      vec2  fineD = vec2(sin(noise(r3uv) * 6.28318), 0.0) * 0.003;

      vec2 distort = (wideD + midD + fineD) * gnd;
      vec2 duv     = sceneUV + distort;

      /* ── Iridescence phase ───────────────────────────────────────
         Colour shifts most where distortion is active (hot air).   */
      float iriPhase = fbm(duv * 1.8 + t * 0.55) * 1.8
                     + length(distort) * 20.0;

      /* ── Scene colours ───────────────────────────────────────── */
      float skyDist = clamp((duv.y - hz) * 2.8, 0.0, 1.0);
      vec3  sky = mix(warmIrid(iriPhase) * 0.38,
                      vec3(0.010, 0.006, 0.026),
                      skyDist);

      float rn  = fbm(duv * vec2(2.8, 4.2));
      vec3  road = warmIrid(iriPhase + rn * 0.6) * 0.20
                 + vec3(0.04, 0.02, 0.006);

      float hblend = smoothstep(hz - 0.025, hz + 0.025, duv.y);
      vec3  col    = mix(road, sky, hblend);

      /* ── Starfield ───────────────────────────────────────────────
         Visible only above the horizon. Slow diagonal drift gives a
         lazy parallax glide. FBM density field creates clumps (bright
         patches) vs voids – a rough Milky-Way structure.             */
      float starMask  = smoothstep(hz + 0.005, hz + 0.07, uv.y);
      vec2  starDrift = vec2(u_time * 0.008, u_time * 0.003);
      vec2  starUV    = uv + starDrift;
      /* Density field: slow FBM → patches of dense / sparse stars   */
      float dens      = fbm(starUV * 2.5 + 7.3);
      float densityMod = dens * 1.4;
      /* Three grids: coarse (bright) + medium + fine (faint)         */
      float stars = starLayer(starUV,              28.0, densityMod)
                  + starLayer(starUV * 1.7 + 0.3,  42.0, densityMod * 0.85)
                  + starLayer(starUV * 2.8 + 1.7,  64.0, densityMod * 0.70);
      stars = clamp(stars, 0.0, 1.0);
      col += vec3(0.80, 0.87, 1.00) * stars * starMask * 0.55;

      /* ── Galaxy patches ──────────────────────────────────────────
         Three blobs: wide Gaussian field drives both a soft diffuse
         glow (primary visibility) and dense pinpoint stars on top.
         The field also modulates density and star brightness so
         both peak at the nucleus and fade naturally to the edge.

         Gaussian exponents are low (3.5–9) so blobs span ≈20–35 %
         of screen width and are clearly visible.                   */
      float galG0 = exp(-dot(starUV - vec2(0.26, 0.74), starUV - vec2(0.26, 0.74)) *  5.0);
      float galG1 = exp(-dot(starUV - vec2(0.71, 0.81), starUV - vec2(0.71, 0.81)) *  3.5);
      float galG2 = exp(-dot(starUV - vec2(0.48, 0.91), starUV - vec2(0.48, 0.91)) *  9.0);
      float galaxyField = clamp(galG0 + galG1 + galG2, 0.0, 1.0);

      /* Diffuse glow – the visually dominant element.
         pow() steepens the falloff: bright core, quick fade.      */
      col += vec3(0.62, 0.76, 1.00) * pow(galaxyField, 1.5) * starMask * 0.22;

      /* Dense pinpoint stars – gridSizes chosen so cells are
         ≥30 px wide on a 1920 px screen → stars always ≥1 px.
         galDens drives gate threshold: near center most cells
         fire; toward edge density drops to near-zero.             */
      float galDens  = galaxyField * 2.5;
      float galStars = starLayerSharp(starUV,              36.0, galDens)
                     + starLayerSharp(starUV * 1.4 + 0.5,  52.0, galDens * 0.85)
                     + starLayerSharp(starUV * 2.1 + 1.2,  72.0, galDens * 0.70);
      galStars = clamp(galStars, 0.0, 1.0);
      /* Brightness ramp: center stars 2× brighter than edge stars  */
      col += vec3(0.90, 0.95, 1.00) * galStars * (0.3 + galaxyField * 1.8) * starMask;

      /* ── Fata Morgana ────────────────────────────────────────────
         Mirage band just below the curved horizon: sky mirrored
         downward with ripple-shaped extra distortion.              */
      float mBot   = hz - 0.16;
      float mirage = smoothstep(mBot, mBot + 0.04, sceneUV.y)
                   * smoothstep(hz + 0.01, hz - 0.01, sceneUV.y);

      vec2  mwp  = vec2(sceneUV.x * 0.75, sceneUV.y * 6.0 + t * 0.65);
      float mrn  = fbm(mwp);
      float mrph = mrn * 9.42478;
      vec2  mxd  = vec2(sin(mrph), cos(mrph) * 0.18) * 0.016;

      vec2 mirUV  = vec2(duv.x + mxd.x,
                         hz + (hz - sceneUV.y) * 0.44 + mxd.y);
      vec3 mirCol = mix(warmIrid(iriPhase + 0.35) * 0.25,
                        vec3(0.022, 0.050, 0.10),
                        0.38);
      col = mix(col, mirCol, mirage * 0.78);

      /* ── Rising heat glow ────────────────────────────────────────
         Ripple-shaped glow bands drift upward.                     */
      vec2  gp   = vec2(sceneUV.x * 1.20, sceneUV.y * 4.50 - u_time * 0.09);
      float grn  = fbm(gp);
      float gph  = grn * 9.42478;
      float glo  = pow(max(sin(gph), 0.0), 3.0) * gnd * 0.85;
      col += warmIrid(iriPhase + grn * 0.4) * glo;

      /* ── Horizon haze ────────────────────────────────────────────
         Gaussian glow hugging the curved horizon line.             */
      float hazeT = exp(-pow((sceneUV.y - hz) * 10.0, 2.0)) * 0.30;
      col += warmIrid(iriPhase * 0.6 + 0.12) * hazeT * 1.4;

      /* ── Distant lightning ───────────────────────────────────────
         Four independent storm cells; each returns glow + bolt.    */
      vec3 ltContrib =
          lightningContrib(sceneUV, hz, u_time, 11.30, iriPhase)
        + lightningContrib(sceneUV, hz, u_time, 37.91, iriPhase)
        + lightningContrib(sceneUV, hz, u_time, 63.47, iriPhase)
        + lightningContrib(sceneUV, hz, u_time, 89.13, iriPhase);
      col += ltContrib;

      /* ── Film grain ──────────────────────────────────────────────
         Subtle animated noise strongest at the horizon and in the
         heat-distortion zone, fading away in the deep sky/road.     */
      float grainZone = exp(-pow((sceneUV.y - hz) * 8.0, 2.0)) * 0.70
                      + gnd * 0.30;
      /* Interleaved Gradient Noise – no axis-aligned periodicity.
         grainScale < 0.5 → each noise texel covers more pixels.    */
      float grainScale = 0.38;
      vec2  gnp  = floor(gl_FragCoord.xy * grainScale);
      float tmod = fract(u_time * 17.3);
      float grain = (fract(52.9829189 * fract(
                      0.06711056 * gnp.x + 0.00583715 * gnp.y + tmod * 0.813
                    )) - 0.5) * 0.060 * grainZone;
      col += grain;

      /* ── Vignette ────────────────────────────────────────────── */
      vec2  v   = uv * 2.0 - 1.0;
      float vig = pow(clamp(1.0 - dot(v * vec2(0.50, 0.70),
                                      v * vec2(0.50, 0.70)), 0.0, 1.0), 0.55);
      col *= 0.10 + 0.90 * vig;

      gl_FragColor = vec4(col, 1.0);
    }
  `;

  /* ================================================================
     COMPILE & LINK
     ================================================================ */
  function compileShader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[shader] compile error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER, VS);
  const fs = compileShader(gl.FRAGMENT_SHADER, FS);

  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[shader] link error:', gl.getProgramInfoLog(prog));
    return;
  }

  gl.useProgram(prog);

  /* ================================================================
     GEOMETRY – fullscreen quad as a TRIANGLE_STRIP
     Covers clip-space [-1,1]² in two triangles.
     ================================================================ */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
    1, -1,
    -1, 1,
    1, 1,
  ]), gl.STATIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'a_pos');
  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uMouse = gl.getUniformLocation(prog, 'u_mouse');
  const uIntro = gl.getUniformLocation(prog, 'u_intro');

  /* ── Mouse parallax ─────────────────────────────────────────────
     tX/tY  : raw normalised target  (range −0.5 … +0.5)
     eX/eY  : eased current value   (lerp factor ≈ 0.04 / frame)
     CSS stage wrapper moves at ~8 px amplitude (subtle foreground).
     Shader scene moves at UV ±0.06 / ±0.04 (larger background pan). */
  let tX = 0, tY = 0, eX = 0, eY = 0;
  const parallaxFg = document.getElementById('parallax-fg');

  window.addEventListener('mousemove', e => {
    tX = (e.clientX / window.innerWidth - 0.5);  /* +right */
    tY = -(e.clientY / window.innerHeight - 0.5);  /* +up    */
  });

  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  /* ================================================================
     RESIZE – keep canvas pixel-perfect with the viewport
     ================================================================ */
  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ================================================================
     RENDER LOOP
     ================================================================ */
  const t0 = performance.now();

  function frame() {
    const t = (performance.now() - t0) * 0.001;   /* seconds */

    /* Ease mouse toward target */
    eX += (tX - eX) * 0.027;
    eY += (tY - eY) * 0.027;

    /* Stage: subtle foreground drift (±6 px horiz, ±4 px vert) */
    parallaxFg.style.transform =
      `translate(${(eX * 12).toFixed(2)}px, ${(-eY * 8).toFixed(2)}px)`;

    /* ── Intro slide-up animation ───────────────────────────────────
       Over 20 s the horizon (and everything tied to it: ripples,
       mirage, haze, lightning) eases up from below the screen to its
       natural position. Cubic ease-out: fast at first, gentle settle. */
    const INTRO_DUR = 50.0;
    const introP = Math.min(t / INTRO_DUR, 1.0);
    const introEased = 1.0 - Math.pow(1.0 - introP, 3.0);
    const introOff = -0.65 * (1.0 - introEased); /* -0.65 → 0 */

    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.uniform2f(uMouse, eX, eY);
    gl.uniform1f(uIntro, introOff);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

}());
