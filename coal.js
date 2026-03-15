/**
 * coal.js – Scene 3: Burning coal field (Three.js r134)
 *
 * Two-pass rendering:
 *   Pass 1 → WebGLRenderTarget (RGBA).  Alpha = Circle of Confusion.
 *     - Fire floor  alpha = 0.38  (below focal plane, bokeh fire bg)
 *     - Base coal   alpha ≈ 0     (focal plane y≈0.22, sharp)
 *     - Stacked     alpha grows   (above focal plane, dreamy blur)
 *   Pass 2 → screen.  Golden-angle DOF (à la Alcatraz liquid carbon)
 *     + grain that scales with blur radius (more blur = noisier).
 *
 * Coal material: liquid carbon aesthetic.
 *   Near-pure-black base, dark spectral thin-film iridescence,
 *   mirror-sharp specular + two softer lobes, fire rim glow.
 */

(function () {
  'use strict';

  const canvas = document.getElementById('sun-bg');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias:          true,
      alpha:              true,
      premultipliedAlpha: false,
    });
  } catch (e) {
    console.warn('[coal] WebGLRenderer failed:', e);
    return;
  }

  const dpr      = Math.min(window.devicePixelRatio, 2);
  const isMobile = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);

  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.autoClear = false;   /* we drive clearing manually */

  // ── Main 3-D scene ────────────────────────────────────────────
  const scene = new THREE.Scene();   /* no scene.background – we clear manually */

  let aspect = window.innerWidth / window.innerHeight;
  const VIEW  = 5.8;
  const camera = new THREE.OrthographicCamera(
    -VIEW * aspect, VIEW * aspect, VIEW, -VIEW, 0.1, 100
  );
  camera.position.set(0, 11, 2.8);
  camera.lookAt(0, 0, 0);

  // ── Render target (RGBA, alpha stores CoC) ─────────────────────
  function makeRT(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter:      THREE.LinearFilter,
      magFilter:      THREE.LinearFilter,
      format:         THREE.RGBAFormat,
      generateMipmaps: false,
    });
  }
  let renderTarget = makeRT(
    Math.round(window.innerWidth  * dpr),
    Math.round(window.innerHeight * dpr)
  );

  // ====================================================================
  // FIRE FLOOR SHADER  (alpha = 0.38 → below focal plane, bokeh glow)
  // ====================================================================
  const FLOOR_VS = /* glsl */`
    varying vec2 v_uv;
    void main() {
      v_uv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const FLOOR_FS = /* glsl */`
    precision highp float;
    uniform float u_time;
    varying vec2 v_uv;

    float hash(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y
      );
    }
    float fbm(vec2 p, int oct) {
      float v = 0.0, a = 0.5;
      mat2 rot = mat2(0.866, 0.5, -0.5, 0.866);
      for (int i = 0; i < 6; i++) {
        if (i >= oct) break;
        v += a * noise(p); p = rot * p * 2.13 + vec2(3.7, 8.1); a *= 0.5;
      }
      return v;
    }

    void main() {
      float t  = u_time;
      vec2  uv = v_uv;

      vec2 warp = vec2(
        fbm(uv * 3.1 + vec2( t * 0.07, 0.0), 4),
        fbm(uv * 3.1 + vec2(5.3,  t * 0.07), 4)
      ) * 0.38;
      vec2 wuv = uv + warp;

      float fireA = fbm(wuv * 2.7  + vec2( t * 0.055,  t * 0.038), 5);
      float fireB = fbm(wuv * 5.3  + vec2(-t * 0.088,  t * 0.051) + vec2(2.1, 0.5), 5);
      float fireC = fbm(wuv * 9.8  + vec2( t * 0.130, -t * 0.077) + vec2(7.3, 3.1), 4);
      float fireD = fbm(wuv * 1.4  + vec2( t * 0.028, -t * 0.019) + vec2(1.7, 5.9), 4);
      float fire  = fireA * 0.42 + fireB * 0.28 + fireC * 0.18 + fireD * 0.12;

      fire *= 0.93 + 0.07 * sin(t * 1.27) * sin(t * 2.81 + 1.1);
      float spark = fbm(wuv * 15.0 + vec2(t * 0.55, t * 0.33), 3);
      fire += spark * 0.10 * smoothstep(0.52, 0.72, fire);

      vec3 col = vec3(0.04, 0.005, 0.0);
      col = mix(col, vec3(0.52, 0.03, 0.00), smoothstep(0.26, 0.41, fire));
      col = mix(col, vec3(0.90, 0.20, 0.00), smoothstep(0.41, 0.54, fire));
      col = mix(col, vec3(1.00, 0.52, 0.01), smoothstep(0.54, 0.65, fire));
      col = mix(col, vec3(1.00, 0.80, 0.14), smoothstep(0.65, 0.76, fire));
      col = mix(col, vec3(1.00, 0.97, 0.82), smoothstep(0.75, 0.88, fire));
      col = mix(col, vec3(1.00, 1.00, 0.98), smoothstep(0.84, 0.98, fire));

      float gx  = floor(gl_FragCoord.x * 0.65);
      float gy  = floor(gl_FragCoord.y * 0.65);
      float gt  = floor(u_time * 28.0);
      float grn = fract(52.98 * fract(0.0671 * gx + 0.00584 * gy + gt * 0.441)) - 0.5;
      col += grn * 0.055 * smoothstep(0.0, 0.6, fire);

      /* alpha = CoC: floor is below the focal plane → bokeh-glow effect */
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 0.38);
    }
  `;

  const floorUniforms = { u_time: { value: 0.0 } };
  const floorGeo = new THREE.PlaneGeometry(90, 90);
  const floorMat = new THREE.ShaderMaterial({
    uniforms: floorUniforms, vertexShader: FLOOR_VS, fragmentShader: FLOOR_FS,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  scene.add(floorMesh);

  // ====================================================================
  // COAL GEOMETRY  (IcosahedronGeometry subdivision 3, low-freq deform)
  // ====================================================================
  function makeCoalGeo(seed, flatness) {
    const geo = new THREE.IcosahedronGeometry(1.0, 3);
    const pos = geo.attributes.position;

    function rng(a, b) {
      const x = Math.sin(a * 127.1 + b * 311.7 + seed * 973.1) * 43758.5453;
      return (x - Math.floor(x)) * 2.0 - 1.0;
    }

    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const d1 = rng(x * 1.6 + z * 2.1, y * 1.3 + i * 0.131);
      const d2 = rng(x * 3.7 + y * 2.9, z * 3.3 + i * 0.271);
      const f  = 1.0 + d1 * 0.17 + d2 * 0.08;
      pos.setXYZ(i, x * f, y * f * flatness, z * f);
    }
    geo.computeVertexNormals();
    return geo;
  }

  // ====================================================================
  // LIQUID CARBON COAL SHADER
  // ====================================================================
  const COAL_VS = /* glsl */`
    attribute float a_temp;
    varying vec3  v_worldPos;
    varying vec3  v_normal;
    varying float v_temp;

    void main() {
      mat4 worldMat = modelMatrix * instanceMatrix;
      vec4 wPos     = worldMat * vec4(position, 1.0);
      v_normal   = normalize(mat3(worldMat) * normal);
      v_worldPos = wPos.xyz;
      v_temp     = a_temp;
      gl_Position = projectionMatrix * viewMatrix * wPos;
    }
  `;

  const COAL_FS = /* glsl */`
    precision highp float;
    uniform float u_time;

    varying vec3  v_worldPos;
    varying vec3  v_normal;
    varying float v_temp;

    float hash(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),                  hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 3; i++) { v += a * noise(p); p = p * 2.1 + vec2(3.7, 8.1); a *= 0.5; }
      return v;
    }

    void main() {
      float t = u_time;
      vec3  N = normalize(v_normal);

      /* ── Camera direction (orthographic, constant) ──────────────
         Camera sits at (x, 11, 2.8) looking at (x, 0, 0).
         V points from surface toward camera.                       */
      vec3  V    = normalize(vec3(0.0, 11.0, 2.8));
      float NdotV = max(0.0, dot(N, V));

      /* ── Schlick Fresnel ─────────────────────────────────────────
         F0 = 0.04 for carbon.  At grazing angles the surface snaps
         bright — the defining trait of the liquid-carbon look.     */
      float fresnel = 0.04 + 0.96 * pow(1.0 - NdotV, 5.0);

      /* ── Thin-film iridescence ───────────────────────────────────
         Graphite/carbon shows spectral interference bands.
         Phase sweeps 2.2 full cycles over the view-angle range →
         bands of dark indigo, dark teal, dark purple shift across
         each chunk as the surface normal rotates toward the camera.
         Colours are deliberately DARK — carbon iridescence is subtle,
         not rainbow; it lives in the 0–8% brightness range.        */
      float filmPhase = (1.0 - NdotV) * 6.28318 * 2.2;
      vec3  film      = pow(0.5 + 0.5 * cos(filmPhase + vec3(0.0, 2.094, 4.189)),
                            vec3(2.5));   /* push toward poles for contrast */

      /* Palette: each spectral channel → a dark carbon hue */
      vec3 filmCol = film.r * vec3(0.000, 0.007, 0.032)   /* deep blue-indigo   */
                   + film.g * vec3(0.005, 0.024, 0.020)   /* dark teal          */
                   + film.b * vec3(0.018, 0.002, 0.026);  /* dark purple        */
      filmCol += vec3(0.003, 0.003, 0.006);                /* absolute-black floor */

      /* Micro surface noise — breaks up uniform iridescence */
      float surf = fbm(v_worldPos.xz * 9.0) * 0.015
                 + fbm(v_worldPos.xz * 23.0 + 1.7) * 0.005;
      filmCol   += vec3(surf * 0.55, surf * 0.60, surf);  /* cool-tinted grit */

      /* ── Specular — three lobes, liquid carbon hierarchy ────────
         spec1 (1024): mirror-sharp pinpoint — cleaved graphite sheen
         spec2 (  64): medium lobe — wet-surface 3-D form
         spec3 (  12): wide substrate glow — diffuse carbon body     */
      vec3 L1 = normalize(vec3( 0.30, 0.85,  0.50));
      vec3 L2 = normalize(vec3(-0.55, 0.50, -0.35));
      vec3 H1 = normalize(L1 + V);
      vec3 H2 = normalize(L2 + V);

      float NdotH1 = max(0.0, dot(N, H1));
      float NdotH2 = max(0.0, dot(N, H2));

      float spec1 = pow(NdotH1, 1024.0) * 3.80;   /* mirror spike      */
      float spec2 = pow(NdotH1,   64.0) * 0.24;   /* form lobe         */
      float spec3 = pow(NdotH1,   12.0) * 0.06;   /* wide substrate    */
      float spec4 = pow(NdotH2,   48.0) * 0.16;   /* fill-side lobe    */

      /* Dynamic temperature shifts spec colour: cold=blue-white, hot=amber */
      float fieldT     = fbm(v_worldPos.xz * 0.38 + vec2(t * 0.022, t * 0.016));
      float temperature = clamp(v_temp * 0.55 + fieldT * 0.65 + 0.08, 0.0, 1.0);
      vec3  specTint   = mix(vec3(0.55, 0.72, 1.00),   /* cold: blue-white  */
                             vec3(1.00, 0.80, 0.52),    /* hot:  amber-white */
                             temperature * 0.45);
      vec3 specCol = specTint * (spec1 + spec2 + spec3 + spec4);

      /* ── Diffuse form (tiny) ─────────────────────────────────────
         Without this, fully-shadowed faces are pitch-black and read
         as transparent holes.  We only want a whisper of diffuse.  */
      float diff = max(0.0, dot(N, L1)) * 0.04
                 + max(0.0, dot(N, L2)) * 0.018;

      /* ── Fire rim glow from below ───────────────────────────────
         Faces pointing DOWN or SIDEWAYS pick up the orange fire.  */
      float flicker = 0.87
        + 0.10 * sin(t * 5.91  + v_worldPos.x * 4.37 + v_worldPos.z * 2.11)
        + 0.03 * sin(t * 13.47 + v_worldPos.z * 3.19 + v_worldPos.x * 6.53);

      vec3 glowCol = vec3(0.18, 0.01, 0.00);
      glowCol = mix(glowCol, vec3(0.65, 0.10, 0.00), smoothstep(0.10, 0.35, temperature));
      glowCol = mix(glowCol, vec3(1.00, 0.40, 0.01), smoothstep(0.35, 0.60, temperature));
      glowCol = mix(glowCol, vec3(1.00, 0.76, 0.10), smoothstep(0.60, 0.85, temperature));
      glowCol *= flicker;

      float downAmt   = max(0.0, -N.y);
      float sideAmt   = 1.0 - abs(N.y);
      float rimFactor = pow(downAmt * 0.65 + sideAmt * 0.35, 1.3);
      float glowStr   = 0.28 + temperature * 0.90;
      float topGlow   = max(0.0, N.y) * pow(temperature, 2.8) * 0.18;

      /* ── Assemble ─────────────────────────────────────────────── */
      vec3 col = filmCol;                          /* liquid carbon base      */
      col += vec3(diff);                           /* faint diffuse form      */
      col += specCol;                              /* mirror + form + wide    */
      col += filmCol * fresnel * 2.8;              /* Fresnel edge flare      */
      col += glowCol * rimFactor * glowStr;        /* fire rim glow           */
      col += glowCol * topGlow;                    /* top bleed on hot chunks */

      /* ── Incandescent hot spots ──────────────────────────────────────
         Double-layer FBM: coarse patch selection + fine spot detail.
         Only appears on faces with high temperature (hottest coal bits).
         shimmer gives a live flicker to each spot independently.        */
      float hotN1  = fbm(v_worldPos.xz * 12.0 + vec2( t * 0.07,  t * 0.05));
      float hotN2  = fbm(v_worldPos.xz * 31.0 + vec2(-t * 0.11,  t * 0.09) + 5.7);
      float hotGate  = smoothstep(0.62, 0.92, temperature);
      float hotPatch = smoothstep(0.48, 0.72, hotN1) * smoothstep(0.55, 0.80, hotN2);
      float shimmer  = 0.78 + 0.22 * sin(t * 11.1 + v_worldPos.x * 13.7 + v_worldPos.z * 9.3);
      float hotAmt   = hotGate * hotPatch * shimmer;
      /* Wide warm-yellow pool — the glowing background of the spot   */
      col = mix(col, vec3(1.00, 0.91, 0.62), hotAmt * 0.82);
      /* Bright white core — the actual shiny specular point          */
      float hotCore = smoothstep(0.64, 0.88, hotN2) * smoothstep(0.76, 1.00, temperature) * shimmer;
      col += vec3(1.00, 0.98, 0.93) * hotCore * 3.2;

      /* ── Depth of Field alpha (Circle of Confusion) ─────────────
         Focal plane at y = 0.22 (base coal layer = sharpest).
         Distance above or below grows the CoC linearly then soft-clips.
         Floor (y=0)   → CoC ≈ 0.30 (fire becomes bokeh glow)
         y=0.22        → CoC = 0    (sharp)
         y=0.50        → CoC ≈ 0.37
         y=0.75        → CoC ≈ 0.75 (top-stacked pieces dreamily blurred) */
      float cocDist = abs(v_worldPos.y - 0.22);
      float coc     = smoothstep(0.0, 0.70, cocDist);

      gl_FragColor = vec4(col, coc);
    }
  `;

  // ── Instantiate coal chunks ──────────────────────────────────────
  const COUNT_EACH   = isMobile ? 70 : 120;
  const FIELD        = 28;
  const coalUniforms = { u_time: { value: 0.0 } };
  const dummy        = new THREE.Object3D();

  [
    makeCoalGeo(1.0, 0.50),
    makeCoalGeo(2.0, 0.65),
    makeCoalGeo(3.0, 0.80),
  ].forEach(function (geo) {
    const temps = new Float32Array(COUNT_EACH);
    for (let i = 0; i < COUNT_EACH; i++) temps[i] = Math.random();
    geo.setAttribute('a_temp', new THREE.InstancedBufferAttribute(temps, 1));

    const mat  = new THREE.ShaderMaterial({
      uniforms:   coalUniforms,
      vertexShader:   COAL_VS,
      fragmentShader: COAL_FS,
      side:       THREE.DoubleSide,
      depthWrite: true,
      depthTest:  true,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT_EACH);

    for (let i = 0; i < COUNT_EACH; i++) {
      const x     = (Math.random() - 0.5) * FIELD;
      const z     = (Math.random() - 0.5) * FIELD;
      const layer = Math.pow(Math.random(), 2.0);
      const y     = 0.12 + layer * 0.62;

      dummy.position.set(x, y, z);
      dummy.rotation.set(
        (Math.random() - 0.5) * 0.65,
        Math.random() * Math.PI * 2,
        (Math.random() - 0.5) * 0.65
      );
      const base   = 0.26 + Math.random() * 0.58;
      const elongX = 0.65 + Math.random() * 0.90;
      const elongZ = 0.65 + Math.random() * 0.90;
      dummy.scale.set(
        base * elongX,
        base * (0.30 + Math.random() * 0.28),
        base * elongZ
      );
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    scene.add(mesh);
  });

  // ====================================================================
  // DOF POST-PROCESS  (golden-angle spiral, à la Alcatraz liquid carbon)
  // ====================================================================
  /* Alcatraz uses 80 samples.  Mobile gets 42 for perf.
     We define SAMPLES via a JS template literal so GLSL sees a constant —
     required for the loop bound in WebGL 1.0.                          */
  const DOF_SAMPLES = isMobile ? 26 : 56;

  const DOF_VS = /* glsl */`
    varying vec2 v_uv;
    void main() { v_uv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const DOF_FS = /* glsl */`
    precision highp float;
    uniform sampler2D u_tex;
    uniform vec2      u_res;
    uniform float     u_time;

    /* Golden angle rotation matrix.
       GA = 2.399 rad  →  cos = -0.73737, sin = 0.67546.
       Same constant as the Alcatraz shader.                           */
    const mat2 dofRot = mat2(-0.73737, 0.67546, -0.67546, -0.73737);

    vec3 spiralDOF(vec2 uv, float cocRadius) {
      vec3  acc   = vec3(0.0);
      /* pixel size in UV space — Alcatraz convention (.002 of height) */
      vec2  px    = vec2(0.002 * u_res.y / u_res.x, 0.002);
      vec2  angle = vec2(0.0, cocRadius);  /* initial spoke = CoC magnitude */
      float r     = 1.0;

      for (int j = 0; j < ${DOF_SAMPLES}; j++) {
        r     += 1.0 / r;           /* spiral arm grows outward */
        angle  = dofRot * angle;    /* rotate by golden angle   */
        acc   += texture2D(u_tex, uv + px * (r - 1.0) * angle).rgb;
      }
      return acc / float(${DOF_SAMPLES});
    }

    float hash(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec2  uv  = gl_FragCoord.xy / u_res.xy;
      float coc = texture2D(u_tex, uv).a;        /* CoC from alpha channel */

      /* ── DOF blur (golden-angle spiral) ─────────────────────────── */
      vec3 col = spiralDOF(uv, coc * 7.5);

      /* ── Blur-proportional chromatic grain ───────────────────────
         The Alcatraz demo's out-of-focus regions are visibly noisy —
         high-ISO film look.  Grain amplitude = coc² so sharp regions
         stay clean and blurred regions become increasingly grainy.   */
      float grainAmt = coc * coc * 0.30;
      float gt  = fract(u_time * 0.0713);
      float gx  = gl_FragCoord.x;
      float gy  = gl_FragCoord.y;
      float grR = fract(52.98 * fract(0.06711 * gx + 0.00584 * gy + gt * 0.813)) - 0.5;
      float grG = fract(52.98 * fract(0.07350 * gx + 0.00713 * gy + gt * 0.519)) - 0.5;
      float grB = fract(52.98 * fract(0.05217 * gx + 0.00931 * gy + gt * 0.687)) - 0.5;
      col.r += grR * grainAmt;
      col.g += grG * grainAmt * 0.88;
      col.b += grB * grainAmt * 1.18;   /* blue-heavy for cold carbon feel */

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  const dofUniforms = {
    u_tex:  { value: renderTarget.texture },
    u_res:  { value: new THREE.Vector2(Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)) },
    u_time: { value: 0.0 },
  };
  const dofMesh  = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms:       dofUniforms,
      vertexShader:   DOF_VS,
      fragmentShader: DOF_FS,
      depthWrite:     false,
      depthTest:      false,
    })
  );
  const dofScene  = new THREE.Scene();
  const dofCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  dofScene.add(dofMesh);

  // ====================================================================
  // STEAM OVERLAY  (screen-space, triggered by click/tap on coal scene)
  // Inspired by volumetric cloud: expanding noisy ring + central burst.
  // ====================================================================
  const STEAM_VS = /* glsl */`
    varying vec2 v_uv;
    void main() { v_uv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `;

  const MAX_STEAM = isMobile ? 16 : 32;

  const STEAM_FS = /* glsl */`
    precision highp float;
    varying vec2  v_uv;
    uniform vec2  u_res;
    uniform vec2  u_steamPos[${MAX_STEAM}];
    uniform float u_steamT[${MAX_STEAM}];
    uniform float u_steamRelAge[${MAX_STEAM}]; /* -1 = held, >=0 = secs since released */
    uniform float u_steamSeed[${MAX_STEAM}];

    /* Domain-warped steam — same sin-warp + length-keyed rotation
       structure as the reference smoke shader, adapted to 2-D screen
       space.  seed shifts the phase field so each click looks unique. */
    vec4 oneSteam(vec2 fragUV, vec2 center, float t, float relAge, float seed) {
      if (t < 0.0 || t > 8.0) return vec4(0.0);

      float aspect = u_res.x / u_res.y;

      /* Upward drift + slight seed-varied horizontal lean */
      float leanX = (fract(seed * 4.17) - 0.5) * 0.022;
      float leanY =  0.016 + fract(seed * 2.31) * 0.014;
      vec2 d = (fragUV - center - vec2(leanX * t, leanY * t)) * vec2(aspect, 1.0);

      /* Effect expands outward; scale varies per click using seed     */
      float scaleF = 0.50 + fract(seed * 3.71) * 1.50;  /* 0.50 – 2.00× */
      float expand = (0.04 + t * 0.085) * scaleF;
      vec2  p      = d / expand;
      float r      = length(p);

      /* Outer radial envelope */
      float env = smoothstep(2.6, 0.4, r);
      if (env < 0.002) return vec4(0.0);

      /* ── Domain warp ──────────────────────────────────────────────
         sin warps on both axes + length-keyed rotation per step.
         Same structure as the reference: at each k, warp x and y
         with cross-coupled sin(), then rotate by (time + |p|) angle.
         seed * 7.31 shifts the entire phase field per click.        */
      float time = t * 0.65 + seed * 7.31;
      for (int k = 1; k <= 3; k++) {
        float kf  = float(k);
        float amp = 0.40 / kf;
        p.x += sin((p.y + p.x * 0.5) * kf * 1.10 + time       ) * amp;
        p.y += sin((p.x + p.y * 0.3) * kf * 0.85 + time * 1.12) * amp * 0.75;
        float ang = time * 0.042 + length(p) * 0.065 + seed * 0.5;
        float cs = cos(ang), sn = sin(ang);
        p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
      }

      /* ── Density (reference: sin(p.x)*.4+.5, then 1/dt) ─────────  */
      float dt = sin(p.x) * 0.4 + 0.55;
      dt = max(dt * (length(p) * 0.26 + 0.07), 0.016);
      float brightness = clamp(0.065 / dt * env, 0.0, 1.0);

      /* ── Fade: brief in, fast while held, slow linger after release
         While held (relAge < 0):  exp(-t * 2.2)                     fast ~0.5 s half-life
         After release (relAge≥0): exp(-t*2.2 + relAge*1.8)          seamless → rate 0.4
           At release (relAge=0) the two expressions are equal →  continuity guaranteed.
           After: brightness decays from the release value at rate 0.4 (~2.5 s half-life). */
      float fadeIn  = smoothstep(0.0, 0.18, t);
      float fadeOut = (relAge < 0.0) ? exp(-t * 2.2)
                                     : exp(-t * 2.2 + relAge * 1.8);
      brightness *= fadeIn * fadeOut;

      /* ── Colour: ember warmth at origin → cool white steam ──────  */
      float warmth = exp(-length(d) * 7.0) * exp(-t * 2.8);
      vec3 col = mix(
        vec3(0.68, 0.80, 0.91),   /* outer: cool grey-blue mist  */
        vec3(0.96, 0.97, 0.99),   /* core:  near-white           */
        clamp(brightness * 1.5, 0.0, 1.0)
      );
      col = mix(col, vec3(1.00, 0.60, 0.20), warmth * 0.50);

      return vec4(col, clamp(brightness * 0.38, 0.0, 0.26));
    }

    void main() {
      /* Use geometry UV (0-1 screen space) so position is RT-resolution
         independent. gl_FragCoord / u_res would also be 0-1 inside the RT,
         but only v_uv is guaranteed to match the compositor's sampling UV. */
      vec2 uv  = v_uv;
      vec4 acc = vec4(0.0);

      for (int i = 0; i < ${MAX_STEAM}; i++) {
        if (u_steamT[i] < 0.001) continue;   /* inactive slot — skip */
        vec4 s = oneSteam(uv, u_steamPos[i], u_steamT[i], u_steamRelAge[i], u_steamSeed[i]);
        acc.rgb += s.rgb * s.a * (1.0 - acc.a);
        acc.a   += s.a * (1.0 - acc.a);
      }

      gl_FragColor = vec4(acc.rgb, clamp(acc.a, 0.0, 1.0));
    }
  `;

  const steamT0arr   = new Array(MAX_STEAM).fill(-1.0);
  const steamRelT0arr = new Array(MAX_STEAM).fill(-1.0); /* absolute release time, -1 = still held */
  const steamSeedArr = new Array(MAX_STEAM).fill(0.0);
  const steamPosArr  = Array.from({ length: MAX_STEAM }, function () {
    return new THREE.Vector2(0.5, 0.5);
  });
  let steamSlot = 0;

  const steamUniforms = {
    u_res:        { value: new THREE.Vector2(Math.round(window.innerWidth * dpr * 0.25), Math.round(window.innerHeight * dpr * 0.25)) },
    u_steamPos:   { value: steamPosArr },
    u_steamT:     { value: new Array(MAX_STEAM).fill(-1.0) },
    u_steamRelAge:{ value: new Array(MAX_STEAM).fill(-1.0) },
    u_steamSeed:  { value: new Array(MAX_STEAM).fill(0.0)  },
  };
  /* Steam renders to a half-resolution RT — 4× fewer pixels to shade.
     The compositor blits it to screen at full res (steam is soft enough
     that bilinear upscaling is invisible).                              */
  let steamRT = makeRT(
    Math.round(window.innerWidth  * dpr * 0.5),
    Math.round(window.innerHeight * dpr * 0.5)
  );

  const steamMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms:       steamUniforms,
      vertexShader:   STEAM_VS,
      fragmentShader: STEAM_FS,
      blending:       THREE.NoBlending,   /* write directly to RT, no GL blend */
      depthWrite:     false,
      depthTest:      false,
    })
  );
  const steamScene  = new THREE.Scene();
  const steamCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  steamScene.add(steamMesh);

  /* Compositor: alpha-blends the half-res steam RT onto the screen.
     Uses premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA) because the
     steam shader already stores pre-multiplied RGB in the accumulator. */
  const compUniforms = { u_tex: { value: steamRT.texture } };
  const compMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms:       compUniforms,
      vertexShader:   STEAM_VS,
      fragmentShader: /* glsl */`
        precision mediump float;
        uniform sampler2D u_tex;
        varying vec2 v_uv;
        void main() {
          vec4 s = texture2D(u_tex, v_uv);
          /* As steam density (alpha) builds from overlapping puffs,
             drive the premultiplied RGB toward fully-white.
             vec3(s.a) is the premultiplied value of pure white at this alpha. */
          float whitePush = smoothstep(0.25, 0.80, s.a);
          s.rgb = mix(s.rgb, vec3(s.a), whitePush);
          gl_FragColor = s;
        }
      `,
      transparent:    true,
      blending:       THREE.CustomBlending,
      blendEquation:  THREE.AddEquation,
      blendSrc:       THREE.OneFactor,
      blendDst:       THREE.OneMinusSrcAlphaFactor,
      depthWrite:     false,
      depthTest:      false,
    })
  );
  const compScene = new THREE.Scene();
  compScene.add(compMesh);

  // ====================================================================
  // RESIZE
  // ====================================================================
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    renderTarget.setSize(Math.round(w * dpr),       Math.round(h * dpr));
    steamRT.setSize    (Math.round(w * dpr * 0.5), Math.round(h * dpr * 0.5));
    dofUniforms.u_res.value.set  (Math.round(w * dpr),       Math.round(h * dpr));
    steamUniforms.u_res.value.set(Math.round(w * dpr * 0.5), Math.round(h * dpr * 0.5));
    aspect = w / h;
    camera.left = -VIEW * aspect; camera.right  =  VIEW * aspect;
    camera.top  =  VIEW;          camera.bottom = -VIEW;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ====================================================================
  // RENDER LOOP
  // ====================================================================
  const t0 = performance.now();
  let sunRunning = false, raf = null;

  function frame() {
    if (!sunRunning) return;
    const t = (performance.now() - t0) * 0.001;

    /* Camera: gentle oscillation + gyro drift on mobile */
    const gyroX = (window._gyro && window._gyro.active()) ? window._gyro.gamma() * 2.5 : 0;
    const gyroZ = (window._gyro && window._gyro.active()) ? window._gyro.beta()  * 1.5 : 0;
    const camX = Math.sin(t * 0.018) * 6.5 + gyroX;
    const camZ = 2.8 + Math.sin(t * 0.031 + 1.0) * 0.45 + gyroZ;
    camera.position.set(camX, 11, camZ);
    camera.lookAt(camX, 0, 0);
    floorMesh.position.x = camX;

    floorUniforms.u_time.value = t;
    coalUniforms.u_time.value  = t;
    dofUniforms.u_time.value   = t;

    /* Pass 1: 3-D scene → render target  (RGB = colour, A = CoC) */
    renderer.setRenderTarget(renderTarget);
    renderer.setClearColor(0x020100, 0.40);   /* bg CoC = 0.40 */
    renderer.clear();
    renderer.render(scene, camera);

    /* Pass 2: DOF → screen */
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1.0);
    renderer.clear();
    renderer.render(dofScene, dofCamera);

    /* Pass 3a: Steam → half-res steamRT (no screen blending, direct write) */
    const ste = steamUniforms.u_steamT.value;
    const sra = steamUniforms.u_steamRelAge.value;
    const ssd = steamUniforms.u_steamSeed.value;
    for (let i = 0; i < MAX_STEAM; i++) {
      ste[i] = steamT0arr[i]    < 0 ? -1.0 : t - steamT0arr[i];
      sra[i] = steamRelT0arr[i] < 0 ? -1.0 : t - steamRelT0arr[i];
      ssd[i] = steamSeedArr[i];
    }
    renderer.setRenderTarget(steamRT);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear();
    renderer.render(steamScene, steamCamera);

    /* Pass 3b: Composite half-res steam onto screen (premult alpha blend) */
    renderer.setRenderTarget(null);
    renderer.render(compScene, steamCamera);

    raf = requestAnimationFrame(frame);
  }

  window._saunaCoalSteam = function (u, v) {
    steamT0arr[steamSlot]    = (performance.now() - t0) * 0.001;
    steamRelT0arr[steamSlot] = -1.0;   /* mark as held (not yet released) */
    steamSeedArr[steamSlot]  = Math.random() * 100.0;
    steamPosArr[steamSlot].set(u, v);
    steamSlot = (steamSlot + 1) % MAX_STEAM;
  };

  /* Called on mouseup/touchend — stamps a release time on all held puffs
     so the shader can switch them to the slow-linger decay curve.       */
  window._saunaCoalSteamRelease = function () {
    const now = (performance.now() - t0) * 0.001;
    for (let i = 0; i < MAX_STEAM; i++) {
      if (steamT0arr[i] >= 0 && steamRelT0arr[i] < 0) {
        steamRelT0arr[i] = now;
      }
    }
  };

  window._saunaSunPause  = function () {
    sunRunning = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  };
  window._saunaSunResume = function () {
    if (!sunRunning) { sunRunning = true; raf = requestAnimationFrame(frame); }
  };
  window._saunaFisheyeToggle = function () {};
  window._saunaFisheyeSet    = function () {};

}());
