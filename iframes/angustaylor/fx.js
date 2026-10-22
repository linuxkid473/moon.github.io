// Physically simulated particles, drawn as instanced billboards in two draw calls (additive and alpha).
//
// What each particle really does:
//   * moves through air that is itself rushing past (the runner's headwind: `airVel`), so dust and smoke are blown back
//     towards the camera instead of hanging in space, and drag acts on the speed RELATIVE to that air
//   * is pushed by gravity, by buoyancy (hot gas rises; its temperature decays, so it stops rising as it cools) and by turbulence
//   * bounces off the road with a restitution and friction, and the road slides underneath it (so a spark skids along)
//   * is coloured by its temperature (a black-body ramp: white-hot, yellow, orange, red, charcoal), in HDR so it can bloom
//   * dissolves through a noise texture rather than fading, which is what makes fire and smoke look like gas
// Sparks are stretched along their velocity (a streak, like a real long exposure), puffs are lit from above with a flicker of firelight.
import { THREE, rand } from './gfx.js';

const MAX_ADD = 3600, MAX_ALPHA = 1800;

/* ---------- the noise atlas: four lumpy puffs (R = density, G = how lit that side is) ---------- */
function hash(x, y, s) { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (hash(xi, yi, s) * (1 - u) + hash(xi + 1, yi, s) * u) * (1 - v) + (hash(xi, yi + 1, s) * (1 - u) + hash(xi + 1, yi + 1, s) * u) * v;
}
function fbm(x, y, s) { let a = 0.5, f = 1, t = 0; for (let o = 0; o < 5; o++) { t += a * vnoise(x * f, y * f, s + o * 7); f *= 2.03; a *= 0.5; } return t; }

function buildAtlas() {
  const TILE = 128, N = 2, SIZE = TILE * N;
  const data = new Uint8Array(SIZE * SIZE * 4);
  const dens = new Float32Array(TILE * TILE);
  const LX = -0.55, LY = 0.83;   // the light comes from above and slightly left
  for (let t = 0; t < N * N; t++) {
    const seed = 11 + t * 31;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const u = (x / (TILE - 1)) * 2 - 1, v = (y / (TILE - 1)) * 2 - 1, r = Math.hypot(u, v);
      const wx = fbm(u * 1.6 + 5, v * 1.6 + 2, seed) - 0.5, wy = fbm(u * 1.6 - 3, v * 1.6 + 9, seed + 3) - 0.5;   // warp, so the lumps swirl
      const n = fbm(u * 2.4 + wx * 1.6, v * 2.4 + wy * 1.6, seed + 5);
      const mask = Math.max(0, Math.min(1, (1 - r) / 0.55));
      dens[y * TILE + x] = Math.max(0, Math.min(1, (n - 0.22) * 2.1)) * mask * mask * (3 - 2 * mask);
    }
    const ox = (t % N) * TILE, oy = Math.floor(t / N) * TILE;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const d = dens[y * TILE + x];
      const sx = Math.max(0, Math.min(TILE - 1, Math.round(x + LX * 5))), sy = Math.max(0, Math.min(TILE - 1, Math.round(y - LY * 5)));   // a step towards the light (canvas y is down)
      const lit = Math.max(0, Math.min(1, 0.55 + (d - dens[sy * TILE + sx]) * 2.4));
      const i = ((oy + y) * SIZE + ox + x) * 4;
      data[i] = Math.round(d * 255); data[i + 1] = Math.round(lit * 255); data[i + 2] = 0; data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ---------- shader ---------- */
const VERT = `
  attribute vec3 iPos;
  attribute vec3 iVel;
  attribute vec4 iSize;    // size, stretch (streak length per unit speed), rotation, tile
  attribute vec4 iColor;   // rgb (HDR), alpha
  attribute vec4 iMisc;    // kind, dissolve (0 fresh .. 1 gone), seed, heat
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec4 vMisc;
  void main() {
    vec4 mv = viewMatrix * vec4(iPos, 1.0);
    vec2 c = position.xy;                      // -0.5 .. 0.5
    float size = iSize.x;
    vec2 off;
    if (iSize.y > 0.0) {                       // a streak: lies along the velocity as seen on screen
      vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
      float sp = length(vv.xy);
      vec2 dir = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
      float len = size + sp * iSize.y;
      off = dir * c.x * len + vec2(-dir.y, dir.x) * c.y * size;
    } else {
      float cs = cos(iSize.z), sn = sin(iSize.z);
      off = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    }
    mv.xy += off;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy + 0.5;
    float d = -mv.z;
    vColor = iColor;
    vColor.a *= smoothstep(1.2, 5.5, d);       // fades out smoothly as it nears the camera, so a blast never smothers the screen
    vMisc = vec4(iMisc.xyz, iSize.w);
    vMisc.w = iSize.w;
  }`;

const FRAG = `
  uniform sampler2D uAtlas;
  uniform float uFire;      // how much firelight the smoke is catching
  uniform float uHdr;
  varying vec2 vUv;
  varying vec4 vColor;
  varying vec4 vMisc;       // kind, dissolve, seed, tile
  void main() {
    float kind = vMisc.x;
    vec2 q = vUv * 2.0 - 1.0;
    vec3 col = vColor.rgb;
    float a;
    if (kind < 0.5) {                          // spark: a bright head and a tail that thins out
      float t = clamp(q.x * 0.5 + 0.5, 0.0, 1.0);   // 0 tail .. 1 head
      float across = 1.0 - smoothstep(0.0, 1.0, abs(q.y));
      a = pow(max(t, 1e-4), 1.8) * across * across * (1.0 - smoothstep(0.82, 1.0, t) * 0.25);
      col *= mix(0.5, 1.2, t);
    } else if (kind < 2.5 || kind > 3.5) {     // 1 fire, 2 smoke, 4 dust: all read the noise atlas
      float tile = vMisc.w;
      vec2 tuv = vUv * 0.5 + vec2(mod(tile, 2.0), floor(tile / 2.0)) * 0.5;
      vec4 tx = texture2D(uAtlas, tuv);
      float thr = vMisc.y;
      if (kind < 1.5) {                        // fire: dissolves through the noise from its edges, brightest where it is densest
        a = smoothstep(thr * 0.85, thr * 0.85 + 0.32, tx.r);
        col *= 0.55 + 1.1 * tx.r;
      } else if (kind < 2.5) {                 // smoke: soft puff, lit from above, firelight underneath
        a = smoothstep(thr * 0.8, thr * 0.8 + 0.42, tx.r) * 0.95;
        float lit = tx.g;
        col = mix(col * 0.32, col * 1.35, lit);
        col += vec3(1.0, 0.42, 0.12) * uFire * (1.0 - lit) * 0.55;
      } else {                                 // dust: lower contrast
        a = smoothstep(thr * 0.7, thr * 0.7 + 0.6, tx.r) * 0.8;
        col = mix(col * 0.7, col * 1.15, tx.g);
      }
    } else {                                   // glow dot
      float r2 = dot(q, q);
      a = exp(-r2 * 3.6) * (1.0 - smoothstep(0.7, 1.0, r2));
    }
    a *= vColor.a;
    if (!(a >= 0.003)) discard;   // (also catches NaN, which would otherwise smear into a black dot through the bloom)
    gl_FragColor = vec4(col * uHdr, a);
  }`;

/* ---------- temperature -> colour (HDR) ---------- */
const RAMP = [[0, 0.14, 0.02, 0.01], [0.22, 0.8, 0.11, 0.025], [0.5, 1.5, 0.46, 0.07], [0.75, 2.0, 1.1, 0.3], [1, 2.4, 1.9, 1.15]];
function heatColor(h, out, o) {
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  let i = 1;
  while (i < RAMP.length - 1 && h > RAMP[i][0]) i++;
  const a = RAMP[i - 1], b = RAMP[i], t = (h - a[0]) / (b[0] - a[0]);
  out[o] = a[1] + (b[1] - a[1]) * t; out[o + 1] = a[2] + (b[2] - a[2]) * t; out[o + 2] = a[3] + (b[3] - a[3]) * t;
}

/* ---------- a pool of particles that share a blend mode ---------- */
const STRIDE = 30;
const F = { px: 0, py: 1, pz: 2, vx: 3, vy: 4, vz: 5, age: 6, life: 7, s0: 8, s1: 9, rot: 10, spin: 11, stretch: 12, kind: 13, tile: 14, seed: 15, r: 16, g: 17, b: 18, a: 19, drag: 20, buoy: 21, grav: 22, turb: 23, bounce: 24, heat: 25, cool: 26, glow: 27, floor: 28, mode: 29 };
// mode: 0 plain colour, 1 temperature colour (r,g,b are a tint), 2 colour fades to dark with age

function createPool(max, additive, scene, uniforms, order) {
  const sim = new Float32Array(max * STRIDE);
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  const mk = (n, name) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a); return a; };
  const aPos = mk(3, 'iPos'), aVel = mk(3, 'iVel'), aSize = mk(4, 'iSize'), aCol = mk(4, 'iColor'), aMisc = mk(4, 'iMisc');
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, depthTest: true,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = order;
  scene.add(mesh);
  return { sim, n: 0, max, mesh, aPos, aVel, aSize, aCol, aMisc, geo, additive };
}

export function createFx(scene) {
  const uniforms = { uAtlas: { value: buildAtlas() }, uFire: { value: 0 } };   // (shared by both pools)
  const add = createPool(MAX_ADD, true, scene, { ...uniforms, uHdr: { value: 0.4 } }, 8);   // additive layers sum up, so they are scaled down to keep a fireball from whiting out the frame
  const alpha = createPool(MAX_ALPHA, false, scene, { ...uniforms, uHdr: { value: 1 } }, 7);
  const groundVel = new THREE.Vector3(), air = groundVel;
  let clock = 0, quality = 1, airScale = 0.6;
  const tmp = [0, 0, 0];

  const DEFAULTS = {
    kind: 3, life: 1, size: 0.2, size1: -1, stretch: 0, spin: 0, tile: -1, color: 0xffffff, alpha: 1,
    drag: 0.8, buoy: 0, grav: 12, turb: 0, bounce: 0, heat: 0, cool: 1.5, glow: 1, floor: 0.02, mode: 0, speed: 0, vx: 0, vy: 0, vz: 0, ground: 0,
  };
  const col = new THREE.Color();

  /** Emit one particle. Positions and velocities are in world units (the runner's frame). `ground`: 1 = it starts out carried by the road. */
  function emit(o) {
    const k = o.kind ?? DEFAULTS.kind;
    const pool = k === 2 || k === 4 ? alpha : add;
    if (pool.n >= pool.max) return;
    const d = DEFAULTS;
    const i = pool.n++ * STRIDE, s = pool.sim;
    const g = o.ground ?? d.ground;
    s[i + F.px] = o.x; s[i + F.py] = o.y; s[i + F.pz] = o.z;
    s[i + F.vx] = (o.vx ?? 0) + groundVel.x * g; s[i + F.vy] = (o.vy ?? 0) + groundVel.y * g; s[i + F.vz] = (o.vz ?? 0) + groundVel.z * g;
    s[i + F.age] = 0; s[i + F.life] = o.life ?? d.life;
    const size = o.size ?? d.size;
    s[i + F.s0] = size; s[i + F.s1] = (o.size1 ?? d.size1) < 0 ? size : o.size1;
    s[i + F.rot] = o.rot ?? Math.random() * 6.283; s[i + F.spin] = o.spin ?? 0; s[i + F.stretch] = o.stretch ?? d.stretch;
    s[i + F.kind] = k; s[i + F.tile] = (o.tile ?? -1) >= 0 ? o.tile : Math.floor(Math.random() * 4); s[i + F.seed] = Math.random();
    col.set(o.color ?? d.color);
    s[i + F.r] = col.r; s[i + F.g] = col.g; s[i + F.b] = col.b; s[i + F.a] = o.alpha ?? d.alpha;
    s[i + F.drag] = o.drag ?? d.drag; s[i + F.buoy] = o.buoy ?? d.buoy; s[i + F.grav] = o.grav ?? d.grav; s[i + F.turb] = o.turb ?? d.turb;
    s[i + F.bounce] = o.bounce ?? d.bounce; s[i + F.heat] = o.heat ?? d.heat; s[i + F.cool] = o.cool ?? d.cool; s[i + F.glow] = o.glow ?? d.glow;
    s[i + F.floor] = o.floor ?? d.floor; s[i + F.mode] = o.mode ?? d.mode;
  }

  const dirv = () => { const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u); return [Math.cos(a) * r, u, Math.sin(a) * r]; };

  /* ---------- the physics ---------- */
  function stepPool(pool, dt) {
    const s = pool.sim, gx = groundVel.x * airScale, gz = groundVel.z * airScale, rx = groundVel.x, rz = groundVel.z;   // (the alley shields the air a little, so the headwind is only part of the road's speed)
    for (let n = 0; n < pool.n;) {
      const i = n * STRIDE;
      s[i + F.age] += dt;
      const t = s[i + F.age] / s[i + F.life];
      if (t >= 1) {   // dead: swap the last one into this slot
        const last = --pool.n;
        if (last !== n) s.copyWithin(i, last * STRIDE, last * STRIDE + STRIDE);
        continue;
      }
      let vx = s[i + F.vx], vy = s[i + F.vy], vz = s[i + F.vz];
      const px = s[i + F.px], py = s[i + F.py], pz = s[i + F.pz];
      const heat = s[i + F.heat] * Math.exp(-s[i + F.cool] * dt);
      s[i + F.heat] = heat;
      // drag on the speed relative to the air, which is itself moving with the road
      const dk = Math.exp(-s[i + F.drag] * dt);
      vx = gx + (vx - gx) * dk; vy = vy * dk; vz = gz + (vz - gz) * dk;
      vy += (-s[i + F.grav] + s[i + F.buoy] * heat) * dt;
      const tb = s[i + F.turb];
      if (tb > 0) {   // swirling turbulence: a cheap, divergence-ish field that moves with time
        const f = 0.55, tt = clock * 1.7 + s[i + F.seed] * 6.28;
        vx += Math.sin(py * 1.7 * f + tt + pz * 1.3 * f) * tb * dt;
        vy += Math.sin(pz * 1.9 * f + tt * 0.8 + px * 1.1 * f) * tb * 0.5 * dt;
        vz += Math.sin(px * 1.5 * f + tt * 1.1 + py * 1.9 * f) * tb * dt;
      }
      let nx = px + vx * dt, ny = py + vy * dt, nz = pz + vz * dt;
      const fl = s[i + F.floor];
      if (ny < fl) {
        ny = fl;
        const bo = s[i + F.bounce];
        if (vy < 0) vy = -vy * bo;
        const fr = Math.exp(-6 * dt);   // the road drags it sideways to its own speed
        vx = rx + (vx - rx) * fr; vz = rz + (vz - rz) * fr;
        if (bo === 0) vy = Math.max(vy, 0);
      }
      s[i + F.vx] = vx; s[i + F.vy] = vy; s[i + F.vz] = vz;
      s[i + F.px] = nx; s[i + F.py] = ny; s[i + F.pz] = nz;
      s[i + F.rot] += s[i + F.spin] * dt;
      n++;
    }
  }

  function upload(pool) {
    const s = pool.sim, n = pool.n, ease = (x) => 1 - Math.pow(1 - x, 2.2);
    const P = pool.aPos.array, V = pool.aVel.array, Z = pool.aSize.array, C = pool.aCol.array, M = pool.aMisc.array;
    for (let k = 0; k < n; k++) {
      const i = k * STRIDE, t = s[i + F.age] / s[i + F.life], kind = s[i + F.kind];
      P[k * 3] = s[i + F.px]; P[k * 3 + 1] = s[i + F.py]; P[k * 3 + 2] = s[i + F.pz];
      V[k * 3] = s[i + F.vx] - groundVel.x * 0; V[k * 3 + 1] = s[i + F.vy]; V[k * 3 + 2] = s[i + F.vz];
      const size = s[i + F.s0] + (s[i + F.s1] - s[i + F.s0]) * ease(t);
      Z[k * 4] = size; Z[k * 4 + 1] = s[i + F.stretch]; Z[k * 4 + 2] = s[i + F.rot]; Z[k * 4 + 3] = s[i + F.tile];
      const mode = s[i + F.mode], glow = s[i + F.glow];
      let r, g, b, a = s[i + F.a];
      if (mode === 1) {   // temperature colour, tinted
        heatColor(s[i + F.heat], tmp, 0);
        r = tmp[0] * s[i + F.r]; g = tmp[1] * s[i + F.g]; b = tmp[2] * s[i + F.b];
      } else { r = s[i + F.r]; g = s[i + F.g]; b = s[i + F.b]; }
      r *= glow; g *= glow; b *= glow;
      let dissolve = 0;
      if (kind === 0) { a *= t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3; }                  // sparks fade at the very end
      else if (kind === 3) { a *= t < 0.1 ? t / 0.1 : (1 - t) * (1 - t * 0.3); }      // glows ease in and out
      else {   // fire / smoke / dust: dissolve through the noise, fade in quickly
        dissolve = t;
        a *= t < 0.08 ? t / 0.08 : 1 - t * 0.35;
      }
      C[k * 4] = r; C[k * 4 + 1] = g; C[k * 4 + 2] = b; C[k * 4 + 3] = a;
      M[k * 4] = kind; M[k * 4 + 1] = dissolve; M[k * 4 + 2] = s[i + F.seed]; M[k * 4 + 3] = s[i + F.heat];
    }
    for (const a of [pool.aPos, pool.aVel, pool.aSize, pool.aCol, pool.aMisc]) a.needsUpdate = true;
    pool.geo.instanceCount = n;
  }

  /* ---------- ready-made effects ---------- */

  /** Sparks: hot streaks that bounce and skid. */
  function sparks(x, y, z, n, { speed = 8, up = 4, life = 0.8, grav = 18, color = 0xffb060, heat = 1, size = 0.05, spread = 1, ground = 0, bounce = 0.45, dir = null } = {}) {
    n = Math.round(n * quality);
    for (let k = 0; k < n; k++) {
      const [dx, dy, dz] = dir ?? dirv(), s = speed * (0.25 + Math.random() * 0.75);
      emit({
        kind: 0, x, y, z, vx: dx * s * spread, vy: dy * s + Math.random() * up, vz: dz * s * spread, ground,
        life: life * (0.5 + Math.random() * 0.8), size, stretch: 0.012, drag: 0.5, grav, bounce, heat: heat * (0.7 + Math.random() * 0.3), cool: 1.4,
        mode: 1, color, glow: 1, floor: 0.03,
      });
    }
  }

  /** Compatible with the old burst(): coloured sparks flying out and falling. */
  function burst(x, y, z, color, n, { speed = 4, up = 2, life = 0.6, gravity = 9, spread = 1 } = {}) {
    n = Math.round(n * quality);
    col.set(color);
    for (let k = 0; k < n; k++) {
      const [dx, dy, dz] = dirv(), s = speed * (0.3 + Math.random() * 0.7);
      emit({
        kind: 0, x, y, z, vx: dx * s * spread, vy: dy * s * 0.6 + Math.random() * up, vz: dz * s * spread,
        life: life * (0.7 + Math.random() * 0.6), size: 0.045 + Math.random() * 0.03, stretch: 0.014, drag: 0.7, grav: gravity * 1.3, bounce: 0.4,
        color, glow: 1.5, floor: 0.03,
      });
    }
    // and a few soft glints
    for (let k = 0; k < Math.min(6, n >> 2); k++) {
      const [dx, dy, dz] = dirv(), s = speed * 0.4;
      emit({ kind: 3, x, y, z, vx: dx * s, vy: dy * s, vz: dz * s, life: life * 0.7, size: 0.28, size1: 0.05, drag: 1.5, grav: gravity * 0.3, color, glow: 1.4 });
    }
  }

  /** Dust kicked off the road: real puffs of smoke that the headwind carries away. */
  function dust(x, y, z, n, { size = 0.5, spread = 1.5, life = 0.9, alpha = 0.3, color = 0x8a8fa0, up = 0.8, ground = 0 } = {}) {
    n = Math.round(n * quality);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, s = spread * (0.3 + Math.random() * 0.7);
      emit({
        kind: 4, x, y: y + 0.05, z, vx: Math.cos(a) * s, vy: Math.random() * up, vz: Math.sin(a) * s, ground,
        life: life * (0.7 + Math.random() * 0.6), size: size * 0.5, size1: size * (1.2 + Math.random() * 0.6), spin: (Math.random() - 0.5) * 1.2,
        drag: 2.6, grav: -0.5, buoy: 0, turb: 2.5, color, alpha, floor: 0.05, bounce: 0,
      });
    }
  }

  /** Water thrown off the road by a foot, a landing or a blast: bright droplets that arc and splash. */
  function splash(x, z, n, power = 1) {
    n = Math.round(n * quality);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * 6.283, s = (0.8 + Math.random() * 2.2) * power;
      emit({
        kind: 0, x, y: 0.04, z, vx: Math.cos(a) * s, vy: (1.2 + Math.random() * 2.4) * power, vz: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.3, size: 0.022 + Math.random() * 0.015, stretch: 0.01, drag: 0.4, grav: 16, bounce: 0.15,
        color: 0xbfd2ff, glow: 0.9, floor: 0.01, ground: 0,
      });
    }
  }

  return {
    emit, sparks, burst, dust, splash, uniforms,
    /** how many particles a unit of effect makes (the quality controller lowers it on slow machines) */
    set quality(q) { quality = q; },
    get quality() { return quality; },
    get counts() { return [add.n, alpha.n]; },
    /** a foot or the body hitting the road */
    landing(x, z, power = 1) {
      dust(x, 0.1, z, Math.round(7 * power), { size: 0.7, spread: 2.2 * power, alpha: 0.28, up: 0.5 });
      splash(x, z, Math.round(10 * power), 1.2 * power);
    },
    hit(x, y, z) {
      sparks(x, y, z, 26, { speed: 9, up: 5, life: 0.9, color: 0xff3a50, heat: 0.5, size: 0.06 });
      sparks(x, y, z, 14, { speed: 12, up: 3, life: 0.5, color: 0xffffff, heat: 0.9, size: 0.05 });
      for (let k = 0; k < 4; k++) emit({ kind: 3, x, y, z, life: 0.25, size: 1.2 + k * 0.5, size1: 2.4 + k, drag: 0, grav: 0, color: 0xff4050, alpha: 0.5, glow: 1.4 });
    },
    stomp(x, y, z) { burst(x, y, z, 0xffd34d, 16, { speed: 4, up: 3, life: 0.6 }); },
    /** a pickup: a ring of bright glints that spin out, arc and bounce on the road */
    pickup(x, y, z, color = 0x7cfc9a) {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * 6.283 + Math.random() * 0.4, s = 2.2 + Math.random() * 1.6;
        emit({ kind: 0, x, y, z, vx: Math.cos(a) * s, vy: 1.5 + Math.random() * 2.5, vz: Math.sin(a) * s * 0.5, life: 0.7, size: 0.05, stretch: 0.012, drag: 0.9, grav: 11, bounce: 0.5, color, glow: 1.6, floor: 0.03 });
      }
      emit({ kind: 3, x, y, z, life: 0.28, size: 0.5, size1: 1.7, drag: 0, grav: 0, color, alpha: 0.7, glow: 1.5 });
    },
    /** Set the world the particles live in: groundVel is how fast the road (and the air) is rushing past. */
    setWorld(vz) { groundVel.set(0, 0, vz); },
    /** dt in seconds; `scroll` is the distance the road moved this step (the road's speed is scroll / dt). */
    update(dt, scroll = 0) {
      if (dt > 0) groundVel.z = scroll / dt;
      clock += dt;
      if (dt > 0) { stepPool(add, dt); stepPool(alpha, dt); }
      upload(add);
      upload(alpha);
    },
    /** firelight on the smoke, 0..1 */
    setFire(v) { uniforms.uFire.value = v; },
    clear() { add.n = 0; alpha.n = 0; add.geo.instanceCount = 0; alpha.geo.instanceCount = 0; },
  };
}
