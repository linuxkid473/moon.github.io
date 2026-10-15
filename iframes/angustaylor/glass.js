// The final passes: the game is drawn to a texture and then seen through a pane of fogged, rain-spattered glass
// with a vignette (no bloom or blur: the picture stays sharp).
//
// Two passes keep it cheap: the water field (where every drop is and how it bends the picture) is computed at
// a quarter of the pixels into two small 8-bit targets, then the full-resolution pass just reads it, bends the
// scene through it and adds the floor, bloom and vignette. 
//
// Rain on glass: a mist of tiny beads, a few bigger drops, and drops that slide down with stop-and-go motion,
// wiping a clear trail through the condensation and leaving little beads behind. Every drop bends the picture
// behind it like a small lens, with a bright glint. It is all computed in the shader from a few hashes, so
// nothing is stored or uploaded.
//
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
      slide(p, 7.0, 0.0, 0.05, 1.2, 0.5, w);                                // drops running down the glass, wiping a trail
      slide(p, 12.0, 41.0, 0.075, 0.8, 0.42, w);                            // finer, quicker runners
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
    uniform float uTime;
    uniform float uRain;    // 1 = drops on the window, 0 = none (the glow and grading still apply)
    uniform float uDark;    // how dark the rim of a drop is
    uniform float uSharp;   // strength of the sharpening
    uniform vec2 uRes;
    varying vec2 vUv;

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

    void main() {
      float aspect = uRes.x / uRes.y;
      // the water field (computed at lower resolution, so it arrives softly blended)
      vec2 g = vec2(0.0), nrm = vec2(0.0);
      float hgt = 0.0, rad = 0.0, wet = 0.0;
      if (uRain > 0.5) {
        vec4 A = texture2D(tWaterA, vUv), B = texture2D(tWaterB, vUv);
        g = (A.rg - 0.5) / 6.25;
        nrm = A.ba * 2.0 - 1.0;
        hgt = B.r; rad = B.g * 0.04; wet = B.b;
      }
      vec2 uv = clamp(vUv - g / vec2(aspect, 1.0), 0.001, 0.999);
      vec3 col = textureLod(tScene, uv, 0.0).rgb;   // always crisp: no fog, no blur
      if (hgt > 0.004) {
        vec3 n = normalize(vec3(nrm, hgt) + vec3(0.0, 0.0, 0.0001));
        vec3 L = normalize(vec3(-0.5, 0.6, 0.62));
        vec3 L2 = normalize(vec3(0.5, -0.6, 0.6));
        float spec = pow(max(dot(n, L), 0.0), 30.0);
        float caus = pow(max(dot(n, L2), 0.0), 8.0) * 0.25;
        float dark = (1.0 - smoothstep(0.04, 0.38, hgt)) * smoothstep(0.0, 0.05, hgt);   // the dark outline real drops have
        float glint = 0.05 * hgt;
        float sz = mix(0.2, 1.0, smoothstep(0.003, 0.011, rad));   // tiny drops barely glint; bigger ones shine
        col = col * (1.0 - uDark * dark * sz) + (spec * 0.55 + caus * 0.6 + glint) * sz * vec3(1.0, 0.97, 0.95);
      }
      col += vec3(0.025, 0.028, 0.032) * wet;   // the wet streaks catch a little light
      // a light sharpen (unsharp mask), so edges and lettering stay crisp
      vec2 px = 1.0 / uRes;
      vec3 around = (textureLod(tScene, uv + vec2(px.x, 0.0), 0.0).rgb + textureLod(tScene, uv - vec2(px.x, 0.0), 0.0).rgb
                   + textureLod(tScene, uv + vec2(0.0, px.y), 0.0).rgb + textureLod(tScene, uv - vec2(0.0, px.y), 0.0).rgb) * 0.25;
      col += (col - around) * uSharp;
      // a gentle vignette pulls the eye to the runner
      vec2 vc = (vUv - 0.5) * vec2(1.15, 1.0) * 2.0;
      col *= 1.0 - 0.28 * smoothstep(0.55, 1.45, length(vc));
      col = mix(col, col * vec3(0.78, 0.95, 1.3) + vec3(0.0, 0.01, 0.05), 0.65);   // an overall blue hue
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      #include <colorspace_fragment>
    }`;

const WATER_SCALE = 0.5;   // the water field is computed at this fraction of the screen size, each way

export function createGlass({ renderer, scene, camera, rain }) {
  const sceneRT = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false,   // no mip chain: nothing blurs it, and it costs a pass every frame
    samples: renderer.getPixelRatio() >= 1.5 ? 2 : 4,   // at 1.5x or more the extra pixels already smooth edges, so 2x MSAA looks the same for half the memory traffic
    colorSpace: THREE.SRGBColorSpace,    // stored like a normal picture, so the dark reds keep their detail instead of banding
  });
  const waterRT = new THREE.WebGLMultipleRenderTargets(2, 2, 2, {   // two 8-bit targets drawn at once (see WATER_FRAG for what is packed where)
    depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const shared = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const waterMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...shared, uStorm: { value: 0 }, uLite: { value: 0 }, uDrop: { value: 0.03 } },
    vertexShader: VERT, fragmentShader: WATER_FRAG, depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared, tScene: { value: sceneRT.texture }, tWaterA: { value: waterRT.texture[0] }, tWaterB: { value: waterRT.texture[1] },
      uRain: { value: 1 }, uSharp: { value: 0.7 }, uDark: { value: 0.28 },
    },
    vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
  });
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const waterScene = new THREE.Scene(), compScene = new THREE.Scene();
  waterScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), waterMat));
  compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat));
  let size = [1, 1], broken = false, level = 0;   // level: 0 everything, 1 lighter rain, 2 no drops on the window (the rest of the pass stays)
  let rainClock = 0, lastT = performance.now(), stormT = 99;   // the rain's own clock, and how long since the storm began

  function fit() {   // the pass works at the screen's drawing-buffer size
    const pr = renderer.getPixelRatio();
    const w = Math.max(2, Math.round(size[0] * pr)), h = Math.max(2, Math.round(size[1] * pr));
    sceneRT.setSize(w, h);
    waterRT.setSize(Math.max(2, Math.round(w * WATER_SCALE)), Math.max(2, Math.round(h * WATER_SCALE)));
    shared.uRes.value.set(w, h);
  }
  renderer.debug.onShaderError = () => { broken = true; };   // if a device can't compile the shaders, just play without them

  return {
    uniforms: { ...compMat.uniforms, uDrop: waterMat.uniforms.uDrop, uStorm: waterMat.uniforms.uStorm },
    resize(w, h) { size = [w, h]; fit(); },
    render() {
      const now = performance.now(), dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const fancy = level < 1;                                 // level 1 and up: no rain and no window drops
      const outdoors = fancy && settings.rain && S.mode !== 'menu';   // rain in the world: a light drizzle and a few splashes
      rain.setVisible(outdoors);
      if (outdoors) rain.step(dt, S.mode === 'playing' || S.mode === 'dying' ? S.speed : 3);
      if (broken || level >= 2) { renderer.setRenderTarget(null); renderer.render(scene, camera); return; }   // level 2: no post-processing at all, the scene goes straight to the screen (still full resolution and anti-aliased)
      stormT += dt;
      const storm = 0;                // no opening downpour any more: the rain stays calm for the whole run
      rainClock += dt;
      const drops = settings.glass && fancy;
      shared.uTime.value = rainClock;
      waterMat.uniforms.uStorm.value = storm;
      waterMat.uniforms.uLite.value = 0;   // all bead layers on
      const u = compMat.uniforms;
      u.uRain.value = drops ? 1 : 0;           // drops on the window
      if (drops) {   // the water field, at low resolution
        renderer.setRenderTarget(waterRT);
        renderer.render(waterScene, quadCam);
      }
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(compScene, quadCam);
    },
    /** Called when a run starts. (There is no opening downpour now; kept so callers don't change.) */
    storm() { stormT = 0; },
    /** 0: everything. 1: no rain or window drops (the sharpen and vignette stay). 2: no post-processing, the scene is drawn straight to the screen. Reversible. */
    setLevel(n) { level = n; },
    get level() { return level; },
    /** Build the shaders for both passes up front, so nothing hitches mid-run. */
    precompile() {
      renderer.setRenderTarget(sceneRT); renderer.compile(scene, camera); renderer.setRenderTarget(null);
      renderer.setRenderTarget(waterRT); renderer.render(waterScene, quadCam); renderer.setRenderTarget(null);
      renderer.compile(scene, camera); renderer.compile(compScene, quadCam);
    },
  };
}
