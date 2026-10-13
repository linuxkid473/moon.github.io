// The final passes: the game is drawn to a texture and then seen through a pane of fogged, rain-spattered glass
// with a wet reflective floor, a soft bloom and a vignette.
//
// Two passes keep it cheap: the water field (where every drop is and how it bends the picture) is computed at
// a quarter of the pixels into two small 8-bit targets, then the full-resolution pass just reads it, bends the
// scene through it and adds the floor, bloom and vignette. The expensive floor work only runs on floor pixels.
//
// Rain on glass: a mist of tiny beads, a few bigger drops, and drops that slide down with stop-and-go motion,
// wiping a clear trail through the condensation and leaving little beads behind. Every drop bends the picture
// behind it like a small lens, with a bright glint. It is all computed in the shader from a few hashes, so
// nothing is stored or uploaded.
//
// The wet floor: the floor material tags its own pixels (alpha 0.5, everything else 1.0), so this pass knows
// exactly which pixels are floor and puts puddles, ripples and reflections only there.
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
      slide(p, 9.0, 0.0, 0.045, 1.15, mix(0.20, 0.80, uStorm), w);          // a few drops running down
      slide(p, 15.0, 40.0, 0.08, 0.6, mix(0.10, 0.65, uStorm), w);          // smaller, quicker ones
      slide(p, 12.0, 77.0, 0.06, 0.9, uStorm * 0.5, w);                     // (a third set only in the opening downpour)
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
    uniform float uHor;     // where the horizon sits on screen
    uniform float uScroll;  // how far the road has scrolled, so puddles and ripples move with it
    uniform float uWet;     // 1 = the wet, reflective floor beside the road is on (the background-rain switch)
    uniform float uDark;    // how dark the rim of a drop is
    uniform float uBloom;   // strength of the glow around bright lights and LED screens
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
      // a wet, reflective floor: below the horizon the dark ground mirrors the bright things above it (lights,
      // LED screens, the red lines), smeared a little, stronger in the puddles and rippled by the rain.
      // Only floor pixels pay for any of this.
      if (uWet > 0.5 && vUv.y < uHor + 0.02) {
        float isFloor = 1.0 - smoothstep(0.55, 0.9, textureLod(tScene, vUv, 0.0).a);   // 1 only on the floor itself, never on people or props
        float floorM = isFloor * smoothstep(uHor + 0.02, uHor - 0.12, vUv.y);
        if (floorM > 0.01) {
          float dy = max(uHor - vUv.y, 0.03);
          vec2 fl = vec2((vUv.x - 0.5) / dy, 1.0 / dy + uScroll);   // flat-floor coordinates, with perspective
          float puddle = smoothstep(0.50, 0.72, vnoise(vec2(fl.x * 0.9 + 3.0, fl.y * 0.55 + 7.0)));
          float wetness = clamp(0.38 + 0.62 * puddle, 0.0, 1.0);
          vec2 rc = floor(vec2(fl.x * 1.6, fl.y * 1.2));
          vec2 rp = vec2(fl.x * 1.6, fl.y * 1.2) - rc - 0.5 - (vec2(h21(rc), h21(rc.yx)) - 0.5) * 0.5;
          float rr = length(rp);
          float rph = fract(uTime * 0.6 + h21(rc + vec2(3.0, 5.0)));
          float ring = sin((rr - rph * 0.5) * 60.0) * exp(-abs(rr - rph * 0.5) * 14.0) * (1.0 - rph) * puddle;
          float fres = mix(0.9, 0.25, clamp(dy / uHor, 0.0, 1.0));
          vec3 refl = vec3(0.0);
          for (int k = 0; k < 6; k++) {
            float dd = (float(k) + 0.5) / 6.0;
            vec2 ruv = vec2(vUv.x + ring * 0.006 * (0.5 + dd) + (vnoise(vec2(fl.x * 6.0 + float(k), fl.y * 0.2)) - 0.5) * 0.0012, vUv.y + dy * (0.8 + 2.4 * dd));
            refl += max(textureLod(tScene, clamp(ruv, 0.001, 0.999), 0.0).rgb - 0.18, 0.0) * (1.0 - dd * 0.5);
          }
          col = col * (1.0 - puddle * 0.35 * floorM) + refl / 6.0 * 3.0 * wetness * fres * floorM * 0.85;
        }
      }
      // bloom: the scene's own mip chain is a free blur, so bright LED screens, beams and lamps glow softly
      if (uBloom > 0.0) {
        vec2 bpx = 1.0 / uRes;
        vec3 glow = (textureLod(tScene, uv + vec2(6.0, -6.0) * bpx, 3.0).rgb + textureLod(tScene, uv - vec2(6.0, -6.0) * bpx, 3.0).rgb) * 0.36
                  + (textureLod(tScene, uv + vec2(18.0, 18.0) * bpx, 5.0).rgb + textureLod(tScene, uv - vec2(18.0, 18.0) * bpx, 5.0).rgb) * 0.24;
        col += max(glow - 0.08, 0.0) * uBloom;
      }
      // a gentle vignette pulls the eye to the runner
      vec2 vc = (vUv - 0.5) * vec2(1.15, 1.0) * 2.0;
      col *= 1.0 - 0.28 * smoothstep(0.55, 1.45, length(vc));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
      #include <colorspace_fragment>
    }`;

const WATER_SCALE = 0.5;   // the water field is computed at this fraction of the screen size, each way

export function createGlass({ renderer, scene, camera, rain }) {
  const sceneRT = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true,
    samples: 4,                          // the same 4x anti-aliasing the normal screen has
    colorSpace: THREE.SRGBColorSpace,    // stored like a normal picture, so the dark reds keep their detail instead of banding
  });
  const waterRT = new THREE.WebGLMultipleRenderTargets(2, 2, 2, {   // two 8-bit targets drawn at once (see WATER_FRAG for what is packed where)
    depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  const shared = { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) } };
  const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const waterMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...shared, uStorm: { value: 0 }, uLite: { value: 0 }, uDrop: { value: 0.08 } },
    vertexShader: VERT, fragmentShader: WATER_FRAG, depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared, tScene: { value: sceneRT.texture }, tWaterA: { value: waterRT.texture[0] }, tWaterB: { value: waterRT.texture[1] },
      uRain: { value: 1 }, uHor: { value: 0.67 }, uScroll: { value: 0 }, uWet: { value: 1 }, uBloom: { value: 0.25 }, uDark: { value: 0.16 },
    },
    vertexShader: VERT, fragmentShader: COMP_FRAG, depthTest: false, depthWrite: false,
  });
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const waterScene = new THREE.Scene(), compScene = new THREE.Scene();
  waterScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), waterMat));
  compScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compMat));
  const fwd = new THREE.Vector3();
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
      const outdoors = settings.rain && S.mode !== 'menu';   // rain in the world: a light drizzle, a few splashes, the wet side floor
      rain.setVisible(outdoors);
      if (outdoors) rain.step(dt, S.mode === 'playing' || S.mode === 'dying' ? S.speed : 3);
      if (broken) { renderer.render(scene, camera); return; }
      stormT += dt;
      const storm = stormT < 3 ? 1 : Math.max(0, 1 - (stormT - 3) / 1.5);   // a downpour for the first 3 seconds of a run, then it clears
      rainClock += dt * (1 + 13 * storm);                                     // and in the downpour the rain runs about 14 times faster
      const drops = settings.glass && level < 2;
      shared.uTime.value = rainClock;
      waterMat.uniforms.uStorm.value = storm;
      waterMat.uniforms.uLite.value = level;
      const u = compMat.uniforms;
      u.uRain.value = drops ? 1 : 0;           // drops on the window
      u.uWet.value = settings.rain ? 1 : 0;    // the wet floor beside the road
      camera.getWorldDirection(fwd);
      u.uHor.value = 0.5 + Math.tan(Math.asin(Math.max(-1, Math.min(1, -fwd.y)))) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      u.uScroll.value = Math.min(1e5, (S.dist || 0) / 3.66);   // a point on the road keeps its place as you run
      if (drops) {   // the water field, at low resolution
        renderer.setRenderTarget(waterRT);
        renderer.render(waterScene, quadCam);
      }
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(compScene, quadCam);
    },
    /** Called when a run starts: the rain comes down hard for the first few seconds. */
    storm() { stormT = 0; },
    /** 0: everything. 1: lighter rain. 2: no drops on the window (the floor, bloom and vignette stay). Reversible. */
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
