// The final passes. The scene is drawn in HDR (half-float, 4x MSAA) and then:
//   1. rain: the water field (where every drop is and how it bends the picture) is computed at half the pixels
//   2. bloom: a bright-pass and a chain of 6 down/up-sampled levels, so hot fire, sparks and lamps glow
//   3. composite: sees the scene through the rain-spattered glass, adds the bloom, a shockwave ripple, speed blur and a hint of
//      chromatic aberration, tone-maps with the ACES filmic curve, grades, sharpens, adds a vignette and grain
// Also here: a planar reflection of the street for the wet road (see reflection.js).
//
// Rain on glass: a mist of tiny beads, a few bigger drops, and drops that slide down with stop-and-go motion,
// wiping a clear trail through the condensation and leaving little beads behind. Every drop bends the picture
// behind it like a small lens, with a bright glint. It is all computed in the shader from a few hashes, so
// nothing is stored or uploaded.
import { THREE } from './gfx.js';
import { S, settings, store } from './state.js';

const WATER_FRAG = `
    uniform float uTime;
    uniform float uStorm;   // 1 = a downpour (the first moments of a run), 0 = the calm baseline
    uniform float uLite;    // 1 = skip the finest rain layers (used when the frame rate is low)
    uniform float uDrop;    // raises the bar for a drop to exist: higher = a cleaner picture
    uniform vec2 uRes;      // only its aspect ratio matters
    varying vec2 vUv;
    layout(location = 0) out highp vec4 outA;   // bend (xy) and surface direction (zw)
    layout(location = 1) out highp vec4 outB;   // thickness, size, wet streak

    float h11(float n) { return fract(sin(n * 127.1 + 4.1) * 43758.5453); }
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = h21(i);
      float b = h21(i + vec2(1.0, 0.0));
      float c = h21(i + vec2(0.0, 1.0));
      float d = h21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    // what the water at this pixel is doing: how it bends the picture (grad), its surface
    // direction and thickness (nrm, hgt), a thin sideways bend along trails (tg), and how much
    // condensation it has wiped away (clr)
    struct Water { vec2 grad; vec2 nrm; float tg; float hgt; float clr; float wet; float rad; };

    // one drop: a lumpy, slightly tilted blob that is narrower at the top and heavier at the bottom
    // (gravity), with a spherical-cap surface (sy < 1 stretches it vertically)
    void drop(vec2 d, float r, float sy, float ph, inout Water w) {
      float ca = cos(ph);
      float sa = sin(ph);
      vec2 rd = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y);
      float qy = rd.y * sy / r;
      float qx = rd.x / r * (1.0 + 0.30 * clamp(qy, -1.0, 1.0));
      float ang = atan(qy, qx + 0.00001);
      float wob = 1.0 + 0.16 * sin(3.0 * ang + ph * 3.0) + 0.10 * sin(5.0 * ang + ph * 7.0);
      float l2 = (qx * qx + qy * qy) / (wob * wob);
      if (l2 >= 1.0) return;
      float h = sqrt(1.0 - l2);
      if (h > w.hgt) { w.hgt = h; w.grad = d * 1.3; w.nrm = vec2(d.x, d.y * sy) * 0.9 / r / wob; w.rad = r; }
      w.clr = 1.0;
    }

    // the wandering path a rivulet takes down the glass
    float wander(float yy, float r0, float r2, float r3) {
      return 0.010 * sin(yy * 17.0 + r2 * 6.28) + 0.005 * sin(yy * 43.0 + r3 * 6.28) + 0.003 * sin(yy * 97.0 + r0 * 6.28);
    }

    // drops that slide down in columns: they stick, slip, leave a thin wandering wet streak and shed beads
    // behind them. 'chance' is how many columns have a drop (more in a storm); the rest fade away smoothly.
    void slide(vec2 p, float cols, float seed, float speed, float size, float chance, inout Water w) {
      float cw = 1.0 / cols;
      float c0 = floor(p.x / cw);
      for (int k = -1; k <= 1; k++) {
        float id = c0 + float(k) + seed;
        float vis = 1.0 - smoothstep(chance - 0.08, chance, h11(id + 17.0));
        if (vis < 0.02) continue;
        float r0 = h11(id);
        float r1 = h11(id + 3.3);
        float r2 = h11(id + 7.7);
        float r3 = h11(id + 11.1);
        float tt = uTime * speed * (0.5 + r1) + r0 * 20.0;
        float s = tt + 0.14 * sin(tt * 7.0 + r2 * 6.28);
        float y = 1.25 - fract(s) * 1.6;
        float base = (c0 + float(k) + 0.5 + (r3 - 0.5) * 0.4) * cw;
        float x = base + wander(y, r0, r2, r3);
        float r = (0.011 + 0.013 * r2) * size * vis;
        vec2 d = p - vec2(x, y);
        drop(d, r, 0.8, (r3 - 0.5) * 0.4, w);
        float L = (0.25 + 0.25 * r1) * vis;
        if (d.y > 0.0 && d.y < L) {
          float age = d.y / L;
          float tw = r * (0.55 - 0.35 * age);
          float xx = p.x - (base + wander(p.y, r0, r2, r3));
          float m = 1.0 - smoothstep(tw * 0.15, tw, abs(xx));
          float fade = 1.0 - age;
          w.wet = max(w.wet, m * fade);
          w.tg += sign(xx) * m * tw * 0.35 * fade;
          float by = d.y * 34.0 + r3 * 10.0;
          float bid = floor(by);
          float bf = fract(by);
          if (h21(vec2(id, bid)) > 0.74) {
            float bx = (h21(vec2(bid, id + 2.0)) - 0.5) * tw * 1.2;
            float br = r * (0.18 + 0.2 * h21(vec2(id + 5.0, bid))) * fade;
            if (br > 0.0001) drop(vec2(xx - bx, (bf - 0.5) / 34.0), br, 1.0, (r2 - 0.5) * 1.2, w);
          }
        }
      }
    }

    // 0 in the middle of the screen, 1 around the edges and corners: the mist and the drops gather there
    float edgeW(vec2 uv) {
      vec2 c = (uv - 0.5) * vec2(2.0, 1.5);
      return smoothstep(0.35, 1.15, length(c));
    }

    // drops that cling in place: they swell and slowly dry out. Sparser in the middle, and many more of
    // them in a storm (the extra ones grow and shrink smoothly as the storm comes and goes).
    void statics(vec2 p, float n, float seed, float thr, float ra, float rb, float bias, inout Water w) {
      vec2 i0 = floor(p * n);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          vec2 id = i0 + vec2(float(i), float(j)) + seed;
          float a = h21(id);
          float ewc = edgeW((id - seed + 0.5) / n / vec2(uRes.x / uRes.y, 1.0));
          if (a < thr + (1.0 - ewc) * bias - 0.22 * uStorm - 0.06 + uDrop) continue;   // most cells are empty: stop here, before doing any more work
          float b = h21(id + 5.1);
          float c = h21(id + 9.7);
          vec2 ctr = (id - seed + 0.5 + (vec2(b, c) - 0.5) * 0.6) / n;
          float ew = edgeW(ctr / vec2(uRes.x / uRes.y, 1.0));
          float thrEff = thr + (1.0 - ew) * bias - 0.22 * uStorm + uDrop;   // bias: how much sparser the middle is (0 = the same everywhere)
          float vis = smoothstep(0.0, 0.06, a - thrEff);
          if (vis < 0.01) continue;
          float life = fract(uTime * 0.012 + a * 7.0);
          float grow = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.88, 1.0, life));
          float r = (ra + (rb - ra) * b) / n * grow * vis;
          if (r > 0.0001) drop(p - ctr, r, 0.7 + 0.5 * h21(id + 2.2), (c - 0.5) * 1.3, w);
        }
      }
    }

    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 p = vec2(vUv.x * aspect, vUv.y);
      Water w = Water(vec2(0.0), vec2(0.0), 0.0, 0.0, 0.0, 0.0, 0.0);
      // small drops are back, kept light so the picture stays clean (their shine scales with their size, so they never look like snow)
      if (uLite < 0.5) statics(p, 80.0, 0.0, 0.80, 0.10, 0.30, 0.22, w);   // tiny beads, a bit more at the edges
      if (uLite < 0.5) statics(p, 45.0, 71.0, 0.88, 0.22, 0.55, 0.0, w);   // small but clearly visible drops, spread over the whole screen
      statics(p, 28.0, 13.0, 0.965, 0.15, 0.42, 0.22, w);                   // the odd medium drop
      statics(p, 11.0, 29.0, 0.996, 0.14, 0.30, 0.22, w);                   // a rare big one
      slide(p, 7.0, 0.0, 0.05, 1.2, 0.28, w);                                // drops running down the glass, wiping a trail
      slide(p, 12.0, 41.0, 0.075, 0.8, 0.2, w);                            // finer, quicker runners
      // how the water bends the picture here: a drop's lens, or the thin sideways bend along a wet streak
      vec2 g = w.hgt > 0.0 ? w.grad : vec2(w.tg, 0.0);
      // packed into two 8-bit targets (neutral value 0.5 for the signed ones, so blending towards "no water" fades smoothly)
      outA = vec4(clamp(g * 6.25 + 0.5, 0.0, 1.0), clamp(w.nrm, -1.0, 1.0) * 0.5 + 0.5);
      outB = vec4(w.hgt, clamp(w.rad * 25.0, 0.0, 1.0), w.wet, 0.0);
    }`;

const COMP_FRAG = `
    uniform sampler2D tScene;
    uniform sampler2D tWaterA;
    uniform sampler2D tWaterB;
    uniform sampler2D tBloom;
    uniform float uTime;
    uniform float uRain;    // 1 = drops on the window, 0 = none (the glow and grading still apply)
    uniform float uDark;    // how dark the rim of a drop is
    uniform float uSharp;   // strength of the sharpening
    uniform float uBloom;   // how much the bloom is added
    uniform float uExposure;
    uniform float uAberr;   // chromatic aberration (a kick on impacts)
    uniform float uSpeed;   // radial speed blur, 0..1
    uniform vec4 uShock;    // xy: where (uv), z: radius, w: strength; strength 0 = off
    uniform float uGrain;
    uniform vec2 uRes;
    varying vec2 vUv;

    float h11(float n) { return fract(sin(n * 127.1 + 4.1) * 43758.5453); }
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

    // ACES filmic (Narkowicz fit): rolls highlights off smoothly instead of clipping them
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    vec3 sceneAt(vec2 uv) { return min(max(textureLod(tScene, clamp(uv, 0.001, 0.999), 0.0).rgb, vec3(0.0)), vec3(120.0)); }

    void main() {
      float aspect = uRes.x / uRes.y;
      vec2 uv0 = vUv;
      // the shockwave of a blast: a ring that rushes outwards and bends the picture
      if (uShock.w > 0.0) {
        vec2 dv = (vUv - uShock.xy) * vec2(aspect, 1.0);
        float d = length(dv);
        float ring = exp(-pow((d - uShock.z) / 0.05, 2.0));
        uv0 += normalize(dv + 1e-5) * ring * uShock.w * 0.04 / vec2(aspect, 1.0);
      }
      // the water field (computed at lower resolution, so it arrives softly blended)
      vec2 g = vec2(0.0), nrm = vec2(0.0);
      float hgt = 0.0, rad = 0.0, wet = 0.0;
      if (uRain > 0.5) {
        vec4 A = texture2D(tWaterA, vUv), B = texture2D(tWaterB, vUv);
        g = (A.rg - 0.5) / 6.25;
        nrm = A.ba * 2.0 - 1.0;
        hgt = B.r; rad = B.g * 0.04; wet = B.b;
      }
      vec2 uv = clamp(uv0 - g / vec2(aspect, 1.0), 0.001, 0.999);
      vec3 hdr;
      // radial speed blur towards the edges, and a touch of chromatic aberration that grows away from the centre
      vec2 cv = uv - 0.5;
      float edge = dot(cv, cv);
      float ab = uAberr + 0.0012 * edge * 4.0;
      if (uSpeed > 0.001) {
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 6; i++) {
          float f = float(i) / 5.0;
          vec2 p = 0.5 + cv * (1.0 - uSpeed * 0.07 * f * smoothstep(0.04, 0.35, edge));
          vec3 c = vec3(sceneAt(p + cv * ab).r, sceneAt(p).g, sceneAt(p - cv * ab).b);
          float w = 1.0 - f * 0.5; acc += c * w; wsum += w;
        }
        hdr = acc / wsum;
      } else {
        hdr = vec3(sceneAt(uv + cv * ab).r, sceneAt(uv).g, sceneAt(uv - cv * ab).b);
      }
      hdr += texture2D(tBloom, uv).rgb * uBloom;
      if (hgt > 0.004) {
        vec3 n = normalize(vec3(nrm, hgt) + vec3(0.0, 0.0, 0.0001));
        vec3 L = normalize(vec3(-0.5, 0.6, 0.62));
        vec3 L2 = normalize(vec3(0.5, -0.6, 0.62));
        float spec = pow(max(dot(n, L), 0.0), 30.0);
        float caus = pow(max(dot(n, L2), 0.0), 8.0) * 0.25;
        float dark = (1.0 - smoothstep(0.04, 0.38, hgt)) * smoothstep(0.0, 0.05, hgt);   // the dark outline real drops have
        float glint = 0.05 * hgt;
        float sz = mix(0.2, 1.0, smoothstep(0.003, 0.011, rad));   // tiny drops barely glint; bigger ones shine
        hdr = hdr * (1.0 - uDark * dark * sz) + (spec * 0.55 + caus * 0.6 + glint) * sz * vec3(1.0, 0.97, 0.95);
      }
      hdr += vec3(0.025, 0.028, 0.032) * wet * 0.5;   // the wet streaks catch a little light
      vec3 col = aces(hdr * uExposure);
      // a light sharpen (unsharp mask) on the tone-mapped picture, so edges and lettering stay crisp
      vec2 px = 1.0 / uRes;
      vec3 around = (aces(sceneAt(uv + vec2(px.x, 0.0)) * uExposure) + aces(sceneAt(uv - vec2(px.x, 0.0)) * uExposure)
                   + aces(sceneAt(uv + vec2(0.0, px.y)) * uExposure) + aces(sceneAt(uv - vec2(0.0, px.y)) * uExposure)) * 0.25;
      col += (col - around) * uSharp;
      // grade: cool shadows, warm highlights, a little extra contrast and saturation
      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(lum), col, 1.12);
      col = mix(col, col * vec3(0.94, 0.98, 1.08), 1.0 - smoothstep(0.0, 0.5, lum));
      col = mix(col, col * vec3(1.06, 1.0, 0.92), smoothstep(0.5, 1.0, lum));
      // a gentle vignette pulls the eye to the runner
      vec2 vc = (vUv - 0.5) * vec2(1.15, 1.0) * 2.0;
      col *= 1.0 - 0.3 * smoothstep(0.55, 1.45, length(vc));
      col += (h21(vUv * uRes + fract(uTime) * 91.0) - 0.5) * uGrain;   // film grain
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      #include <colorspace_fragment>
    }`;

/* ---------- bloom ---------- */
const BLOOM_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
// first level: threshold with a soft knee and a Karis-style weighting so one hot pixel cannot flicker
const BLOOM_PRE = `
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
    varying vec2 vUv;
    vec3 prefilter(vec3 c) {
      c = min(max(c, vec3(0.0)), vec3(60.0));
      float br = max(c.r, max(c.g, c.b));
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-4);
      float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
      return c * contrib;
    }
    void main() {
      vec3 a = prefilter(texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb);
      vec3 b = prefilter(texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb);
      vec3 c = prefilter(texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb);
      vec3 d = prefilter(texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb);
      gl_FragColor = vec4(min((a + b + c + d) * 0.25, vec3(30.0)), 1.0);
    }`;
const BLOOM_DOWN = `
    uniform sampler2D tSrc; uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec3 s = texture2D(tSrc, vUv).rgb * 0.25;
      s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb * 0.125 + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb * 0.125;
      s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb * 0.125 + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb * 0.125;
      s += texture2D(tSrc, vUv + uTexel * vec2(-2.0, 0.0)).rgb * 0.0625 + texture2D(tSrc, vUv + uTexel * vec2(2.0, 0.0)).rgb * 0.0625;
      s += texture2D(tSrc, vUv + uTexel * vec2(0.0, -2.0)).rgb * 0.0625 + texture2D(tSrc, vUv + uTexel * vec2(0.0, 2.0)).rgb * 0.0625;
      gl_FragColor = vec4(s, 1.0);
    }`;
const BLOOM_UP = `
    uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
    varying vec2 vUv;
    void main() {   // a 3x3 tent, added onto the larger level underneath
      vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
      s += (texture2D(tSrc, vUv + uTexel * vec2(-1.0, 0.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 0.0)).rgb
          + texture2D(tSrc, vUv + uTexel * vec2(0.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(0.0, 1.0)).rgb) * 2.0;
      s += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
      gl_FragColor = vec4(s / 16.0 * uWeight, 1.0);
    }`;

const WATER_SCALE = 0.5;   // the water field is computed at this fraction of the screen size, each way
const BLOOM_LEVELS = 6;

export function createGlass({ renderer, scene, camera, rain, reflection }) {
  const halfFloat = renderer.capabilities.isWebGL2;
  const sceneRT = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,
    type: THREE.HalfFloatType,   // HDR: fire and lamps keep values above 1, so they can bloom and tone-map instead of clipping
    samples: renderer.getPixelRatio() >= 1.5 ? 2 : 4,   // at 1.5x or more the extra pixels already smooth edges, so 2x MSAA looks the same for half the memory traffic
  });
  const waterRT = new THREE.WebGLMultipleRenderTargets(2, 2, 2, {   // two 8-bit targets drawn at once (see WATER_FRAG for what is packed where)
    depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const bloomRT = Array.from({ length: BLOOM_LEVELS }, () => new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
  const shared = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const waterMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...shared, uStorm: { value: 0 }, uLite: { value: 0 }, uDrop: { value: 0.12 } },
    vertexShader: VERT, fragmentShader: WATER_FRAG, depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared, tScene: { value: sceneRT.texture }, tWaterA: { value: waterRT.texture[0] }, tWaterB: { value: waterRT.texture[1] }, tBloom: { value: bloomRT[0].texture },
      uRain: { value: 1 }, uSharp: { value: 0.55 }, uDark: { value: 0.16 }, uBloom: { value: 0.4 }, uExposure: { value: 0.95 }, uAberr: { value: 0 }, uSpeed: { value: 0 },
      uShock: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, uGrain: { value: 0.010 },
    },
    vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
  });
  const bloomU = { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.25 }, uKnee: { value: 0.5 }, uWeight: { value: 1 } };
  const mkBloom = (frag, additive) => new THREE.ShaderMaterial({ uniforms: bloomU, vertexShader: BLOOM_VERT, fragmentShader: frag, depthTest: false, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NoBlending, transparent: !!additive });
  const preMat = mkBloom(BLOOM_PRE, false), downMat = mkBloom(BLOOM_DOWN, false), upMat = mkBloom(BLOOM_UP, true);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const waterScene = new THREE.Scene(), compScene = new THREE.Scene(), bloomScene = new THREE.Scene();
  waterScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), waterMat));
  compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat));
  const bloomQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), preMat);
  bloomScene.add(bloomQuad);
  let size = [1, 1], broken = false, level = 0;   // level: 0 everything, 1 lighter rain, 2 no drops on the window (the rest of the pass stays)
  let rainClock = 0, lastT = performance.now(), stormT = 99;   // the rain's own clock, and how long since the storm began
  const features = { bloom: true, reflections: true };
  let shockT = 99, shock = { x: 0.5, y: 0.5, reach: 0.9 }, aberr = 0, speedBlur = 0;

  function fit() {   // the pass works at the screen's drawing-buffer size
    const pr = renderer.getPixelRatio();
    const w = Math.max(2, Math.round(size[0] * pr)), h = Math.max(2, Math.round(size[1] * pr));
    sceneRT.setSize(w, h);
    waterRT.setSize(Math.max(2, Math.round(w * WATER_SCALE)), Math.max(2, Math.round(h * WATER_SCALE)));
    bloomRT.forEach((rt, i) => rt.setSize(Math.max(2, Math.round(w / 2 ** (i + 1))), Math.max(2, Math.round(h / 2 ** (i + 1)))));
    reflection.resize(w, h);
    shared.uRes.value.set(w, h);
  }
  renderer.debug.onShaderError = () => { broken = true; };   // if a device can't compile the shaders, just play without them

  function runBloom() {
    bloomQuad.material = preMat;
    bloomU.tSrc.value = sceneRT.texture;
    bloomU.uTexel.value.set(1 / sceneRT.width, 1 / sceneRT.height);
    renderer.setRenderTarget(bloomRT[0]); renderer.render(bloomScene, quadCam);
    bloomQuad.material = downMat;
    for (let i = 1; i < BLOOM_LEVELS; i++) {
      bloomU.tSrc.value = bloomRT[i - 1].texture;
      bloomU.uTexel.value.set(1 / bloomRT[i - 1].width, 1 / bloomRT[i - 1].height);
      renderer.setRenderTarget(bloomRT[i]); renderer.render(bloomScene, quadCam);
    }
    bloomQuad.material = upMat;
    const prev = renderer.autoClear;
    renderer.autoClear = false;
    for (let i = BLOOM_LEVELS - 1; i > 0; i--) {
      bloomU.tSrc.value = bloomRT[i].texture;
      bloomU.uTexel.value.set(1 / bloomRT[i].width, 1 / bloomRT[i].height);
      bloomU.uWeight.value = 1;
      renderer.setRenderTarget(bloomRT[i - 1]); renderer.render(bloomScene, quadCam);
    }
    renderer.autoClear = prev;
  }

  return {
    uniforms: { ...compMat.uniforms, uDrop: waterMat.uniforms.uDrop, uStorm: waterMat.uniforms.uStorm },
    rts: { sceneRT, bloomRT },
    features,
    reflection,
    resize(w, h) { size = [w, h]; fit(); },
    /** A blast went off at uv (0..1): a ring races out across the screen, bending the picture. */
    shock(x, y, reach = 0.9) { shockT = 0; shock = { x, y, reach }; },
    /** a kick of chromatic aberration (an impact) */
    punch(v = 1) { aberr = Math.max(aberr, v); },
    /** 0..1: the speed of the run, for the radial blur */
    setSpeed(v) { speedBlur = v; },
    render() {
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const fancy = level < 1;                                 // level 1 and up: no rain and no window drops
      const outdoors = settings.rain && S.mode !== 'menu';   // rain in the world: a light drizzle and a few splashes
      rain.setVisible(outdoors);
      if (outdoors) rain.step(dt, S.mode === 'playing' || S.mode === 'dying' ? S.speed : 3);
      if (broken || level >= 2) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }   // level 2: no post-processing at all, the scene goes straight to the screen (still full resolution and anti-aliased)
      renderer.shadowMap.needsUpdate = true;   // the sun's shadow map is refreshed once a frame, by whichever pass draws first
      stormT += dt;
      const storm = 0;                // no opening downpour any more: the rain stays calm for the whole run
      rainClock += dt;
      shockT += dt;
      aberr = Math.max(0, aberr - dt * 3.2);
      const drops = settings.glass && fancy;
      shared.uTime.value = rainClock;
      waterMat.uniforms.uStorm.value = storm;
      waterMat.uniforms.uLite.value = 0;   // all bead layers on
      const u = compMat.uniforms;
      u.uRain.value = drops ? 1 : 0;           // drops on the window
      u.uAberr.value = aberr * 0.012;
      u.uSpeed.value = speedBlur;
      u.uBloom.value = features.bloom ? 0.4 : 0;
      const sw = shockT < 0.9 ? 1 - shockT / 0.9 : 0;
      u.uShock.value.set(shock.x, shock.y, shockT * 0.9 * (shock.reach + 0.4) / 0.9, sw * sw);
      if (drops) {   // the water field, at low resolution
        renderer.setRenderTarget(waterRT);
        renderer.render(waterScene, quadCam);
      }
      if (features.reflections) reflection.render(camera);   // the street, mirrored, for the wet road (this pass also refreshes the shadow map)
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      if (features.bloom) runBloom();
      renderer.setRenderTarget(null);
      renderer.render(compScene, quadCam);
    },
    /** Called when a run starts. (There is no opening downpour now; kept so callers don't change.) */
    storm() { stormT = 0; },
    /** 0: everything. 1: no rain or window drops (the sharpen and vignette stay). 2: no post-processing, the scene is drawn straight to the screen. Reversible. */
    setLevel(n) { level = n; },
    get level() { return level; },
    /** MSAA samples of the scene buffer (re-allocates it) */
    setSamples(n) { if (sceneRT.samples !== n) { sceneRT.samples = n; sceneRT.dispose(); } },
    /** Build the shaders for both passes up front, so nothing hitches mid-run. */
    precompile() {
      renderer.setRenderTarget(sceneRT); renderer.compile(scene, camera); renderer.setRenderTarget(null);
      renderer.setRenderTarget(waterRT); renderer.render(waterScene, quadCam); renderer.setRenderTarget(null);
      if (features.bloom) runBloom();
      renderer.compile(scene, camera); renderer.compile(compScene, quadCam);
    },
  };
}
