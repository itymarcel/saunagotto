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
      col = mix(col, vec3(1.00, 0.80, 0.14), smoothstep(0.65, 0.77, fire));
      col = mix(col, vec3(1.00, 0.97, 0.82), smoothstep(0.77, 0.92, fire));

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
  const DOF_SAMPLES = isMobile ? 42 : 80;

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
    u_res:  { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
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

  const STEAM_FS = /* glsl */`
    precision highp float;
    uniform vec2  u_res;
    uniform vec2  u_steamPos[4];
    uniform float u_steamT[4];   /* elapsed seconds; negative = inactive */

    float hash(vec2 p) {
      p  = fract(p * vec2(127.1, 311.7));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),                hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0,1.0)), hash(i + vec2(1.0,1.0)), u.x), u.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p  = p * 2.1 + vec2(3.7, 8.1);
        a *= 0.5;
      }
      return v;
    }

    /* One steam event: expanding ring of volumetric wisps.
       Cartesian FBM warp avoids the polar-angle seam artifact.   */
    vec4 oneSteam(vec2 fragUV, vec2 center, float t) {
      if (t < 0.0 || t > 2.4) return vec4(0.0);

      float aspect = u_res.x / u_res.y;
      /* Steam drifts upward over time */
      vec2 d = (fragUV - (center + vec2(0.0, t * 0.030))) * vec2(aspect, 1.0);
      float r = length(d);

      /* ── Expanding ring ───────────────────────────────────── */
      float ringR = t * 0.13;

      /* Two-layer FBM in Cartesian space — warps the ring boundary
         into organic lumps, no polar discontinuity.             */
      float nwarp = fbm(d * 4.2 + vec2(t * 0.38, t * 0.55)) - 0.5;
      float nint  = fbm(d * 5.8 + vec2(t * 0.62, 1.73));   /* interior texture */

      float warpedR   = ringR + nwarp * 0.052;
      float ringW     = 0.048 + t * 0.020;
      float frontDist = r - warpedR;

      /* Density: leading edge + trailing wispy tail */
      float dens = smoothstep(0.004, -ringW,           frontDist)
                 * (1.0 - smoothstep(-ringW * 0.18, -ringW * 1.9, frontDist));
      /* Interior noise breaks the ring into separate puffs */
      dens *= 0.30 + 0.70 * nint;

      /* ── Central burst (immediate puff at t≈0) ───────────── */
      float burst = smoothstep(0.05 + t * 0.07, 0.0, r) * exp(-t * 5.5);
      dens = max(dens, burst);

      /* ── Colour ───────────────────────────────────────────── */
      float edgeF = 1.0 - smoothstep(-ringW * 0.5, 0.0, frontDist);
      vec3 col = mix(
        vec3(0.62, 0.76, 0.90),   /* outer: cool grey-blue steam */
        vec3(0.96, 0.98, 1.00),   /* inner: near-white           */
        nint * 0.6 + edgeF * 0.4
      );
      /* Warm coal-fire tint very close to origin */
      col = mix(col, vec3(1.00, 0.70, 0.35),
                exp(-r * 7.0) * exp(-t * 3.5) * 0.50);

      return vec4(col, clamp(dens * exp(-t * 1.55), 0.0, 0.85));
    }

    void main() {
      vec2 uv  = gl_FragCoord.xy / u_res;
      vec4 acc = vec4(0.0);
      vec4 s;

      /* Unrolled — avoids GLSL ES 1 variable-index limitations */
      s = oneSteam(uv, u_steamPos[0], u_steamT[0]);
      acc.rgb += s.rgb * s.a * (1.0 - acc.a);  acc.a += s.a * (1.0 - acc.a);
      s = oneSteam(uv, u_steamPos[1], u_steamT[1]);
      acc.rgb += s.rgb * s.a * (1.0 - acc.a);  acc.a += s.a * (1.0 - acc.a);
      s = oneSteam(uv, u_steamPos[2], u_steamT[2]);
      acc.rgb += s.rgb * s.a * (1.0 - acc.a);  acc.a += s.a * (1.0 - acc.a);
      s = oneSteam(uv, u_steamPos[3], u_steamT[3]);
      acc.rgb += s.rgb * s.a * (1.0 - acc.a);  acc.a += s.a * (1.0 - acc.a);

      gl_FragColor = vec4(acc.rgb, clamp(acc.a, 0.0, 1.0));
    }
  `;

  const MAX_STEAM   = 4;
  const steamT0arr  = new Array(MAX_STEAM).fill(-1.0);  /* start-time of each event */
  const steamPosArr = Array.from({ length: MAX_STEAM }, function () {
    return new THREE.Vector2(0.5, 0.5);
  });
  let steamSlot = 0;

  const steamUniforms = {
    u_res:      { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    u_steamPos: { value: steamPosArr },
    u_steamT:   { value: [-1.0, -1.0, -1.0, -1.0] },
  };
  const steamMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms:       steamUniforms,
      vertexShader:   STEAM_VS,
      fragmentShader: STEAM_FS,
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,
    })
  );
  const steamScene  = new THREE.Scene();
  const steamCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  steamScene.add(steamMesh);

  // ====================================================================
  // RESIZE
  // ====================================================================
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    renderTarget.setSize(Math.round(w * dpr), Math.round(h * dpr));
    dofUniforms.u_res.value.set(w, h);
    steamUniforms.u_res.value.set(w, h);
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

    /* Camera: gentle side-to-side oscillation over the coal bed */
    const camX = Math.sin(t * 0.018) * 6.5;
    const camZ = 2.8 + Math.sin(t * 0.031 + 1.0) * 0.45;
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

    /* Pass 3: Steam overlay (alpha-blended on top, no clear) */
    const ste = steamUniforms.u_steamT.value;
    for (let i = 0; i < MAX_STEAM; i++) {
      ste[i] = steamT0arr[i] < 0 ? -1.0 : t - steamT0arr[i];
    }
    renderer.render(steamScene, steamCamera);

    raf = requestAnimationFrame(frame);
  }

  window._saunaCoalSteam = function (u, v) {
    steamT0arr[steamSlot]  = (performance.now() - t0) * 0.001;
    steamPosArr[steamSlot].set(u, v);
    steamSlot = (steamSlot + 1) % MAX_STEAM;
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
