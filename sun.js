/**
 * sun.js – WebGL coal/ember shader for scene 3
 *
 * Architecture (the key fix from previous version):
 *   The glowing heat is a BACKGROUND layer, always present.
 *   Coal is an OPAQUE foreground that covers the background.
 *   Cracks = thin gaps where coal is absent → floor shows through.
 *   Pores  = cylindrical holes → dark walls, bright floor at centre.
 *   This naturally places glow BEHIND coal, not painted on top.
 *
 * 3-D feel comes from:
 *   • Analytical dome normals per chunk (parabolic height field)
 *   • Per-chunk elevation hash (depth ordering / overlap illusion)
 *   • AO darkening at crack edges
 *   • Dark pore walls + bright pore centres (depth gradient)
 */

(function () {
  'use strict';

  const canvas = document.getElementById('sun-bg');
  const gl = canvas.getContext('webgl') ||
             canvas.getContext('experimental-webgl');
  if (!gl) { console.warn('[sun] WebGL unavailable'); return; }
  gl.getExtension('OES_standard_derivatives');

  const VS = /* glsl */`
    attribute vec2 a_pos;
    void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;

  const FS = /* glsl */`
    #extension GL_OES_standard_derivatives : enable
    precision highp float;
    uniform vec2  u_res;
    uniform float u_time;
    uniform float u_mobile;
    uniform float u_fisheye;

    /* ── Hash / noise ──────────────────────────────────────────── */
    float hash1(float n) { return fract(sin(n) * 43758.5453123); }

    float hash2(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    vec2 hash22(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(vec2(p.x * p.y, p.x + p.y));
    }

    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash2(i),                  hash2(i + vec2(1.0, 0.0)), u.x),
        mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2  r = mat2(0.8660, 0.5000, -0.5000, 0.8660);
      for (int i = 0; i < 4; i++) {
        v += a * noise(p); p = r * p * 2.13 + vec2(3.7, 8.1); a *= 0.5;
      }
      return v;
    }

    /* ── Voronoi ────────────────────────────────────────────────
       F1 = dist to nearest centre (dome height proxy).
       F2 = dist to 2nd-nearest   (F2-F1 → crack distance).
       outDir = unit vector pointing AWAY from nearest centre
                (= 2-D component of the dome surface normal).    */
    vec3 voronoi(vec2 p, out vec2 outDir) {
      vec2  n = floor(p), f = fract(p);
      float d1 = 8.0, d2 = 8.0;
      vec2  mc = vec2(0.0), mr = vec2(1.0, 0.0);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2  g = vec2(float(i), float(j));
          vec2  o = hash22(n + g);
          vec2  r = g + o - f;
          float d = dot(r, r);
          if (d < d1) { d2 = d1; d1 = d; mc = n + g; mr = r; }
          else if (d < d2) { d2 = d; }
        }
      }
      outDir = (d1 > 0.001) ? normalize(-mr) : vec2(0.0);
      return vec3(sqrt(d1), sqrt(d2), hash1(mc.x * 127.1 + mc.y * 311.7));
    }

    /* ── Hue → RGB (full-spectrum helper) ──────────────────── */
    vec3 hue2rgb(float h) {
      vec3 rgb = abs(fract(h + vec3(1.0, 0.6667, 0.3333)) * 6.0 - 3.0) - 1.0;
      return clamp(rgb, 0.0, 1.0);
    }

    /* ── Main ───────────────────────────────────────────────── */
    void main() {
      float t   = u_time;
      vec2  uv0 = gl_FragCoord.xy / min(u_res.x, u_res.y);

      /* Fisheye / barrel warp — toggleable via u_fisheye (0=off, 1=on).
         Pushes each fragment radially outward from the screen centre,
         bowing the coal surface as if we're viewing it from inside a
         convex lens. u_fisheye can be smoothly animated for a
         transition rather than a hard cut.                           */
      vec2  sc  = u_res * 0.5 / min(u_res.x, u_res.y);
      vec2  fd  = uv0 - sc;
      uv0 = sc + fd * (1.0 + u_fisheye * dot(fd, fd) * 0.38);

      vec2  uv  = uv0 + vec2(t * 0.014, 0.0);   /* camera drift */

      /* Domain warp: fbm-distorted UV gives coal cells organic, uneven edges.
         Slow time offset (half the heat-floor speed) makes crack lines
         undulate gently — the cell boundaries drift, not the coal itself. */
      vec2 wuv = uv + vec2(
        fbm(uv * 3.2 + vec2(t * 0.012, 0.00)),
        fbm(uv * 3.2 + vec2(5.20, t * 0.012 + 1.30))
      ) * 0.42;

      /* ── LAYER 1: glowing heat floor (always behind coal) ───────
         Two FBM fields create an uneven temperature distribution.
         This is the "floor" — only visible through gaps in the coal.
         A slow global flicker makes the whole bed breathe.          */
      float htA = fbm(uv * 2.8 + vec2( t * 0.025,  t * 0.018));
      float htB = fbm(uv * 6.5 - vec2( t * 0.038,  t * 0.027)) * 0.45;
      float heat = clamp(htA * 0.72 + htB * 0.28, 0.0, 1.0);

      vec3 floorCol = vec3(0.68, 0.10, 0.00);
      floorCol = mix(floorCol, vec3(1.10, 0.40, 0.02), smoothstep(0.25, 0.50, heat));
      floorCol = mix(floorCol, vec3(1.38, 0.88, 0.12), smoothstep(0.50, 0.72, heat));
      floorCol = mix(floorCol, vec3(1.95, 1.65, 0.75), smoothstep(0.72, 0.90, heat));

      /* ── LAYER 2: coal chunk structure ───────────────────────────
         Two voronoi scales:
           vA — large irregular slabs (primary chunks, ~7 across screen)
           vB — medium fragments (secondary cracking, ~13 across)
         Anisotropy on each pass encourages elongated slab shapes.   */
      vec2 dA, dB;
      vec3 vA = voronoi(vec2(wuv.x * 1.30, wuv.y * 0.82) *  6.5, dA);
      vec3 vB = voronoi(vec2(wuv.x * 0.88, wuv.y * 1.22) * 12.5
                        + vec2(4.31, 7.83), dB);

      /* ── 3-D DOME LIGHTING ────────────────────────────────────────
         Each coal chunk modelled as a parabolic dome: the surface
         normal tilts outward proportionally to normalised F1 (rN).
         A per-chunk tilt perturbation makes every piece face a
         slightly different direction — individual 3-D objects.
         Per-chunk elevation (elev) darkens "lower" pieces that are
         buried under others (depth/overlap illusion).               */
      float rN   = min(vA.x / 0.44, 1.0);   /* normalised dome radius */
      float tiltX = (fract(vA.z * 37.41) - 0.5) * 0.30;
      float tiltY = (fract(vA.z * 71.17) - 0.5) * 0.30;
      vec3  N = normalize(vec3(
        dA.x * rN * 0.58 + tiltX,
        dA.y * rN * 0.58 + tiltY,
        1.0
      ));

      vec3  L    = normalize(vec3(0.40, 0.60, 0.85));
      float diff = max(0.0, dot(N, L));
      vec3  H    = normalize(L + vec3(0.0, 0.0, 1.0));
      float spec = pow(max(0.0, dot(N, H)), 90.0);  /* tight metal highlight */

      /* Per-chunk brightness: wide range so pieces read as individual
         objects at different depths. elev2 adds sub-variation from the
         secondary voronoi so neighbours aren't all the same tone.    */
      float elev  = 0.32 + 0.68 * vA.z;
      float elev2 = 0.80 + 0.20 * vB.z;
      elev = elev * elev2;

      /* Crack-edge AO: coal darkens near boundaries (shadow from
         adjacent higher pieces / tight fit between chunks).         */
      float crackEdge  = vA.y - vA.x;    /* F2-F1: ~0 at boundary */
      float crackEdge2 = vB.y - vB.x;
      float ao = 1.0 - smoothstep(0.0, 0.20, crackEdge) * 0.58;

      /* Steel base colour: medium cool grey with FBM surface variation
         (mill scale, hairline scratches, slight directional grinding). */
      float surf  = fbm(uv * 26.0) * 0.09 + fbm(uv * 13.0) * 0.04
                  + fbm(uv * 58.0) * 0.025;          /* fine grit */
      float cellV = vA.z * 0.060 + vB.z * 0.028;
      float steelV = 0.19 + surf * 1.6 + cellV * 1.2;
      vec3 coalBase = vec3(steelV * 0.88, steelV * 0.91, steelV); /* cool grey */

      /* ── SURFACE MICRO-PORES: shallow bowl-shaped pitting ──────────
         Voronoi at ~30× gives dense surface dimples — visible as AO
         darkening bowls. Cells with a low hash are bigger craters.  */
      vec2 dSurf;
      vec3 vSurf  = voronoi(uv * 30.0 + vec2(vA.z * 3.11, vB.z * 5.27), dSurf);
      float spR   = 0.06 + vSurf.z * 0.14;
      float spN   = clamp(vSurf.x / spR, 0.0, 1.0);
      /* Quadratic bowl: darkest at centre, fades out at rim */
      float spAO  = (1.0 - spN) * (1.0 - spN) * 0.68;
      coalBase    = mix(coalBase, vec3(0.004, 0.002, 0.001), spAO);

      /* Larger scattered craters (~10 % of cells): deeper, wider */
      float spBig = (1.0 - clamp(vSurf.x / (spR * 2.2), 0.0, 1.0));
      spBig       = spBig * spBig * step(vSurf.z, 0.10) * 0.55;
      coalBase    = mix(coalBase, vec3(0.003, 0.001, 0.001), spBig);

      /* ── ASH & MINERAL DEPOSITS: grey/white surface spots ─────────
         ~15 % of cells at a coarser scale carry a bright mineral blot.
         FBM edge perturbation keeps the blobs ragged, not circular.
         Tone varies per spot: some warm-grey ash, some cool-white quartz. */
      vec2 dAsh;
      vec3 vAsh   = voronoi(uv * 18.0 + vec2(7.13, 3.59), dAsh);
      float ashR  = 0.13 + vAsh.z * 0.14;
      float ashN  = clamp(vAsh.x / ashR, 0.0, 1.0);
      float ashRagged = fbm(uv * 22.0 + vec2(vAsh.z * 9.1, 1.7)) * 0.35;
      float ashBlob   = smoothstep(1.0, 0.30, ashN + ashRagged)
                      * step(vAsh.z, 0.15);
      /* Iron oxide deposits: rust-red or blue-black mill scale patches. */
      float ashTone = 0.07 + vAsh.z * 0.13 + surf * 0.2;
      vec3  ashCol  = mix(
        vec3(ashTone * 1.9, ashTone * 0.75, ashTone * 0.35),  /* rust / red oxide */
        vec3(ashTone * 0.85, ashTone * 0.90, ashTone * 1.05), /* blue-black scale  */
        step(0.55, vAsh.z)
      );
      coalBase = mix(coalBase, ashCol, ashBlob * 0.78);

      /* ── PER-CHUNK HEAT GLOW ───────────────────────────────────────
         ~35 % of chunks carry heat colour following the real steel
         heat-treat spectrum: blue-purple → orange → yellow-white.
         Lower-elev chunks (deeper in the pile) run hotter.          */
      float chunkHeat = fract(vA.z * 5.31 + vB.z * 2.17);
      float heatAmt   = smoothstep(0.65, 1.0, chunkHeat)
                      * (0.5 + 0.5 * (1.0 - vA.z));
      vec3  heatTint  = mix(vec3(0.22, 0.15, 0.42),   /* blue-purple */
                            vec3(0.90, 0.28, 0.02),    /* orange      */
                            smoothstep(0.0, 0.55, heatAmt));
      heatTint        = mix(heatTint,
                            vec3(1.00, 0.76, 0.10),    /* yellow-white */
                            smoothstep(0.55, 1.0, heatAmt));
      coalBase = mix(coalBase, coalBase * 0.35 + heatTint * 0.65, heatAmt * 0.72);

      /* Fully lit steel surface — brighter, cooler specular than coal */
      vec3 coalLit = coalBase * (0.32 + 0.68 * diff) * ao * elev;
      coalLit     += vec3(0.92, 0.90, 0.88) * spec * 0.80 * elev;
      /* Subtle reflected warmth from the glowing floor below        */
      coalLit     += floorCol * 0.016 * (1.0 - diff);

      /* ── CRACKS: thin gaps, floor visible ───────────────────────
         F2-F1 is ~0 exactly on cell boundaries and grows inward.
         A tight smoothstep gives pixel-thin glowing crack lines.
         Two scales: primary cracks (vA) and finer hairlines (vB).  */
      float crackMask = 1.0 - smoothstep(0.0, 0.036, crackEdge);
      crackMask = max(crackMask, 1.0 - smoothstep(0.0, 0.020, crackEdge2));

      /* ── COMPOSITE ────────────────────────────────────────────────
         Coal surface → cracks (floor shows through) → ambient tint. */
      vec3 col = coalLit;

      /* Cut cracks: floor shows through here */
      col = mix(col, floorCol, crackMask);

      /* ── WHITE-HOT CRACK CENTRES (~15 % of gaps) ──────────────────
         The hottest crack segments glow white at their very core —
         incandescent where material is thinnest. Selected by cell
         hash so only a fraction of cracks get this treatment.        */
      float hotCrack  = step(vA.z, 0.15);
      float whiteLine = (1.0 - smoothstep(0.0, 0.016, crackEdge)) * hotCrack;
      float whiteHalo = exp(-crackEdge * 24.0) * hotCrack * 0.45;
      col += vec3(1.00, 0.97, 0.88) * whiteLine * 1.1;
      col += vec3(1.00, 0.88, 0.65) * whiteHalo;

      /* Very faint ambient heat tint on coal surfaces */
      float glowZone = crackMask;
      col += floorCol * 0.016 * (1.0 - glowZone);

      /* ── BLOOM: wide soft luminous halo around cracks and pores ────
         exp() falloff bleeds glowing heat colour outward from gap
         edges — much wider than the thin crack lines themselves, like
         hot film emulsion halation. Heavy chunky grain is baked into
         the bloom so the light itself feels grainy, not smooth.      */
      float bloomEdge = min(crackEdge, crackEdge2);
      float bloom     = exp(-bloomEdge * 11.0) * 0.60;

      float bx   = floor(gl_FragCoord.x / 1.7);
      float by   = floor(gl_FragCoord.y / 1.7);
      float bgt  = floor(t * 26.0);
      vec3 bGrain = vec3(
        fract(52.983 * fract(0.06711 * bx + 0.00584 * by + bgt * 0.4413)) - 0.5,
        fract(52.983 * fract(0.07351 * bx + 0.00713 * by + bgt * 0.2319)) - 0.5,
        fract(52.983 * fract(0.05217 * bx + 0.00931 * by + bgt * 0.6871)) - 0.5
      );
      col += floorCol * bloom * (1.0 + vec3(bGrain.r * 1.4, bGrain.g * 0.9, bGrain.b * 0.5) * 0.60);

      /* ── FLARES: orange wisps rising from crack gaps ───────────────
         Vertically-stretched FBM moving upward, masked to crack
         proximity. Two layers at different scales/speeds give depth.
         Threshold + rescale produces sparse bright tongues of flame. */
      float flareProx = max(
        1.0 - smoothstep(0.0, 0.16, crackEdge),
        1.0 - smoothstep(0.0, 0.10, crackEdge2)
      );
      float flareA = fbm(vec2(uv.x * 12.0, uv.y * 4.2 - t * 0.27) + vec2(3.71, 1.93));
      float flareB = fbm(vec2(uv.x *  7.5, uv.y * 3.0 - t * 0.18) + vec2(8.14, 5.37));
      float flareC = fbm(vec2(uv.x * 18.0, uv.y * 6.5 - t * 0.41) + vec2(5.22, 9.61));
      float flareFld = clamp((flareA * 0.50 + flareB * 0.30 + flareC * 0.20 - 0.34) * 3.2, 0.0, 1.0);
      float flare = flareProx * flareFld;
      col += mix(vec3(0.95, 0.22, 0.00), vec3(1.00, 0.82, 0.10), flareFld)
           * flare * 1.2;

      /* ── VIGNETTE (screen-centred, independent of camera drift) ── */
      vec2  vuv = gl_FragCoord.xy / u_res;
      float vig = 1.0 - dot(vuv - 0.5, vuv - 0.5) * 0.68;
      col *= clamp(vig, 0.0, 1.0);

      /* ── FIRE OVERLAY: 50 % opacity animated fire ──────────────────
         Three FBM layers at different scales all drift upward.
         fireVFade gives a gentle vertical gradient — full at the
         bottom, tapering slightly toward the top — so the fire reads
         as rising from the hot surface below.
         Final composite: additive at 0.5 = translucent flame layer. */
      float firy     = uv.y * 2.2 - t * 0.40;
      float fireA    = fbm(vec2(uv.x * 2.0, firy));
      float fireB    = fbm(vec2(uv.x * 4.2, firy * 1.5) + vec2(2.13, 0.51));
      float fireC    = fbm(vec2(uv.x * 8.5, firy * 2.2) + vec2(7.31, 3.14));
      float fireFld  = fireA * 0.55 + fireB * 0.30 + fireC * 0.15;
      float fireVFade = clamp(1.2 - vuv.y * 0.5, 0.0, 1.0);
      fireFld        = clamp((fireFld - 0.36) * 2.5 * fireVFade, 0.0, 1.0);
      vec3  fireCol  = mix(vec3(0.80, 0.05, 0.00), vec3(1.00, 0.45, 0.02),
                           min(1.0, fireFld * 1.8));
      fireCol        = mix(fireCol, vec3(1.00, 0.92, 0.55),
                           min(1.0, fireFld * 3.5));
      col           += fireCol * fireFld * 0.50;

      /* ── ANALOG FILM GRAIN ─────────────────────────────────────────
         Analog noise is strongest in shadows (U-curve vs luminance).
         Separate R/G/B seeds produce chromatic grain — like fast film.
         Glow areas get extra warm scintillation on top.              */
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      float grainAmt = 0.075 + 0.17 * (1.0 - lum) * (1.0 - lum);
      float gt = floor(t * 28.0);
      float grainR = fract(52.9829 * fract(0.06711 * gl_FragCoord.x + 0.00584 * gl_FragCoord.y + gt * 0.3147)) - 0.5;
      float grainG = fract(52.9829 * fract(0.07351 * gl_FragCoord.x + 0.00713 * gl_FragCoord.y + gt * 0.5831)) - 0.5;
      float grainB = fract(52.9829 * fract(0.05217 * gl_FragCoord.x + 0.00931 * gl_FragCoord.y + gt * 0.7219)) - 0.5;
      col.r += grainR * grainAmt;
      col.g += grainG * grainAmt * 0.85;
      col.b += grainB * grainAmt * 1.15;

      float glowGrain = fract(43758.5 * fract(0.07351 * gl_FragCoord.x + 0.00451 * gl_FragCoord.y + floor(t * 32.0) * 0.3719)) - 0.5;
      col += vec3(glowGrain * 1.2, glowGrain * 0.9, glowGrain * 0.4) * 0.16 * glowZone;

      col = clamp(col, 0.0, 1.0);

      /* ── FULL-SPECTRUM COLOUR OVERLAY ──────────────────────────────
         Two FBM fields drive hue and saturation independently —
         slow-drifting organic colour patches across the whole scene.
         Blended with Photoshop "Overlay" mode at ~19 % so it tints
         without overpowering the coal and glow colours beneath.      */
      float hueF  = fbm(uv * 3.2 + vec2(t * 0.009, t * 0.006));
      float satF  = 0.60 + 0.40 * fbm(uv * 5.5 + vec2(2.71, t * 0.011));
      vec3  specN = hue2rgb(hueF) * satF;
      vec3  overlaid = mix(
        2.0 * col * specN,
        1.0 - 2.0 * (1.0 - col) * (1.0 - specN),
        step(0.5, col)
      );
      col = mix(col, overlaid, 0.19);

      /* ── CHROMATIC ABERRATION ───────────────────────────────────────
         Radial lateral CA via screen-space derivatives.
         dFdx/dFdy give the local colour gradient at each fragment —
         a first-order Taylor step reconstructs the colour at a nearby
         position without recomputing the scene.
         Strength is quadratic in distance from screen centre so it
         is invisible at centre and obvious at corners/edges.         */
      vec2  caDir  = gl_FragCoord.xy / u_res - 0.5;
      float caDist = dot(caDir, caDir);
      vec2  caVec  = caDir * caDist * 5.5;
      vec3  dX     = vec3(dFdx(col.r), dFdx(col.g), dFdx(col.b));
      vec3  dY     = vec3(dFdy(col.r), dFdy(col.g), dFdy(col.b));
      col.r = clamp(col.r + dX.r * caVec.x + dY.r * caVec.y, 0.0, 1.0);
      col.b = clamp(col.b - dX.b * caVec.x - dY.b * caVec.y, 0.0, 1.0);

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
      console.error('[sun] shader error:', gl.getShaderInfoLog(s));
      gl.deleteShader(s); return null;
    }
    return s;
  }

  const vs = compileShader(gl.VERTEX_SHADER,   VS);
  const fs = compileShader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('[sun] link error:', gl.getProgramInfoLog(prog)); return;
  }
  gl.useProgram(prog);

  /* ================================================================
     GEOMETRY – fullscreen quad
     ================================================================ */
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

  const aPos     = gl.getAttribLocation(prog,  'a_pos');
  const uRes     = gl.getUniformLocation(prog, 'u_res');
  const uTime    = gl.getUniformLocation(prog, 'u_time');
  const uMobile  = gl.getUniformLocation(prog, 'u_mobile');
  const uFisheye = gl.getUniformLocation(prog, 'u_fisheye');
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  let fisheyeOn  = false;

  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  /* ================================================================
     RESIZE
     ================================================================ */
  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ================================================================
     RENDER LOOP  (starts paused – scene 3 not active by default)
     ================================================================ */
  const t0 = performance.now();
  let sunRunning = false;

  function frame() {
    if (!sunRunning) return;
    const t = (performance.now() - t0) * 0.001;
    gl.uniform2f(uRes,     canvas.width, canvas.height);
    gl.uniform1f(uTime,    t);
    gl.uniform1f(uMobile,  isMobile ? 1.0 : 0.0);
    gl.uniform1f(uFisheye, fisheyeOn  ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }

  window._saunaSunPause        = function () { sunRunning = false; };
  window._saunaSunResume       = function () {
    if (!sunRunning) { sunRunning = true; requestAnimationFrame(frame); }
  };
  window._saunaFisheyeToggle   = function () { fisheyeOn = !fisheyeOn; };
  window._saunaFisheyeSet      = function (on) { fisheyeOn = !!on; };

}());
