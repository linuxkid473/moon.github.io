// The tax bomb: a proper blast, not a puff of sparks.
//
// What you see, in the order it happens:
//   1. a white-hot flash and a shockwave ring racing across the road, with a thin glowing dome behind it
//   2. a fireball: lumpy sprites that start white, go yellow, orange, then deep red as they billow out and rise
//   3. flat tongues of flame blasted sideways along the ground, and a plume shooting up
//   4. a dust ring kicked up off the road, and a column of dark smoke that boils upwards and drifts away
//   5. embers and sparks (the shared particle system), and debris (paper, stamps, green tax-cut coins) tumbling
//   6. a scorch mark and a pool of firelight on the road that fade out
// Everything is pooled and built from sprites and a few meshes, with no lights added (so no shader recompiles).
import { THREE, rand, canvasTex } from './gfx.js';

const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 2.2);
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** A lumpy round puff: several overlapping soft discs, so it reads as a billow and not a circle. */
function puffTexture(inner, mid, lumps, seed) {
  return canvasTex(128, 128, (g, w, h) => {
    let s = seed; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < lumps; i++) {
      const cx = w / 2 + (r() - 0.5) * 40, cy = h / 2 + (r() - 0.5) * 40, rad = 26 + r() * 22;
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, inner); gr.addColorStop(0.55, mid); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
  }, 1);
}

export function createExplosion(scene, fx) {
  const fireTex = puffTexture('rgba(255,255,255,0.95)', 'rgba(255,170,60,0.55)', 7, 3);
  const smokeTex = puffTexture('rgba(255,255,255,0.7)', 'rgba(255,255,255,0.35)', 9, 17);
  const glowTex = canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,220,150,0.8)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 1);

  const softDisc = (stops) => canvasTex(128, 128, (g, w, h) => {   // a flat round pad with soft edges, for the light and the scorch on the road
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(([at, col]) => gr.addColorStop(at, col));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 1);
  const lightTex = softDisc([[0, 'rgba(255,190,90,0.95)'], [0.35, 'rgba(255,130,40,0.5)'], [1, 'rgba(255,90,0,0)']]);
  const scorchTex = softDisc([[0, 'rgba(0,0,0,0.95)'], [0.55, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']]);

  const sprite = (tex, additive, order) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    s.visible = false;
    s.renderOrder = order;
    scene.add(s);
    return s;
  };
  const mk = (n, tex, additive, order, kind) => Array.from({ length: n }, () => ({ s: sprite(tex, additive, order), on: false, kind }));
  const fire = mk(72, fireTex, true, 9, 'fire');
  const smoke = mk(64, smokeTex, false, 7, 'smoke');
  const parts = [...fire, ...smoke];
  const claim = (pool) => pool.find((p) => !p.on);

  /** Emit a sprite particle. Position/velocity in world units; `delay` in seconds; scroll is how much of the road's motion it follows. */
  function emit(pool, o) {
    const p = claim(pool);
    if (!p) return;
    Object.assign(p, { on: true, age: 0, spin: rand(-1.4, 1.4), drag: 1.5, buoy: 0, delay: 0, scroll: 0.6, tint: null, ...o });
    p.s.material.rotation = rand(0, 6.28);
    p.s.visible = false;
  }

  /* shockwave: two rings and a glowing dome, plus the firelight on the road and the scorch mark */
  const ringGeo = new THREE.RingGeometry(0.93, 1, 56).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.visible = false; m.renderOrder = 8; scene.add(m);
    return { m, on: false };
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
  dome.visible = false; dome.renderOrder = 8; scene.add(dome);
  const domeS = { on: false, age: 0, x: 0, y: 0, z: 0, k: 1 };
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: lightTex, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
  pool.visible = false; pool.renderOrder = 3; scene.add(pool);
  const poolS = { on: false, age: 0 };
  const scorches = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: scorchTex, transparent: true, depthWrite: false, opacity: 0 }));
    m.visible = false; m.renderOrder = 2; scene.add(m);
    return { m, on: false, age: 0 };
  });

  /* debris: paper, stamps and green tax-cut coins, lit by the fire */
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, emissive: 0x3a1a05, roughness: 0.8, side: THREE.DoubleSide });
  const stampMat = new THREE.MeshStandardMaterial({ color: 0xd7141f, emissive: 0x3a0306, roughness: 0.8, side: THREE.DoubleSide });
  const coinMat = new THREE.MeshStandardMaterial({ color: 0x1f9d55, emissive: 0x0b4a25, roughness: 0.4, metalness: 0.3 });
  const paperGeo = new THREE.BoxGeometry(0.3, 0.025, 0.4), chunkGeo = new THREE.BoxGeometry(0.2, 0.12, 0.2), coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.035, 10);
  const debris = Array.from({ length: 40 }, (_, i) => {
    const m = new THREE.Mesh(i % 5 === 0 ? coinGeo : i % 5 === 1 ? chunkGeo : paperGeo, i % 5 === 0 ? coinMat : i % 5 === 1 ? stampMat : paperMat);
    m.visible = false; scene.add(m);
    return { m, on: false };
  });

  const dir = () => { const a = rand(0, Math.PI * 2), u = rand(-0.2, 1); const r = Math.sqrt(1 - u * u); return [Math.cos(a) * r, u, Math.sin(a) * r]; };

  /** Set the whole thing off at (x, y, z). k scales it (1 is the tax bomb on the road). */
  function explode(x, y, z, k = 1) {
    // 1. the flash, the shockwave and the dome
    emit(fire, { x, y, z, vx: 0, vy: 0, vz: 0, s0: 9 * k, s1: 4 * k, life: 0.2, drag: 0, kind: 'flash' });
    emit(fire, { x, y, z, vx: 0, vy: 0, vz: 0, s0: 4.5 * k, s1: 12 * k, life: 0.32, drag: 0, kind: 'flash' });
    rings.forEach((r, i) => Object.assign(r, { on: true, age: -i * 0.07, x, y: 0.06, z, k, max: 0.5 + i * 0.12, reach: (13 - i * 3) * k }));
    Object.assign(domeS, { on: true, age: 0, x, y, z, k });
    Object.assign(poolS, { on: true, age: 0, x, z, k });
    const sc = scorches.find((s) => !s.on) || scorches[0];
    Object.assign(sc, { on: true, age: 0, x, z, k });

    // 2. the fireball: big lumpy sprites that billow outwards and rise
    for (let i = 0; i < 18; i++) {
      const [dx, dy, dz] = dir();
      const sp = rand(2.5, 8) * k;
      emit(fire, { x: x + dx * 0.4 * k, y: y + dy * 0.4 * k, z: z + dz * 0.4 * k, vx: dx * sp, vy: dy * sp + 1.5, vz: dz * sp, s0: rand(2, 3) * k, s1: rand(4.4, 7) * k, life: rand(0.7, 1.2), drag: 2.4, buoy: 4.5 });
    }
    // 3. flames thrown sideways along the ground, and the plume
    for (let i = 0; i < 16; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(9, 18) * k;
      emit(fire, { x, y: 0.5 + rand(0, 0.8), z, vx: Math.cos(a) * sp, vy: rand(0.5, 3), vz: Math.sin(a) * sp, s0: rand(0.9, 1.4) * k, s1: rand(2.2, 3.2) * k, life: rand(0.4, 0.7), drag: 3.6, buoy: 2.5 });
    }
    for (let i = 0; i < 12; i++) {
      emit(fire, { x: x + rand(-0.4, 0.4), y: y + rand(-0.3, 0.3), z: z + rand(-0.4, 0.4), vx: rand(-1.8, 1.8), vy: rand(5, 11) * k, vz: rand(-1.8, 1.8), s0: rand(1.1, 1.7) * k, s1: rand(2.4, 3.6) * k, life: rand(0.6, 1.0), delay: rand(0, 0.14), drag: 1.5, buoy: 3 });
    }
    // 4. dust kicked off the road, and the smoke column
    for (let i = 0; i < 12; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(5, 10) * k;
      emit(smoke, { x, y: 0.4, z, vx: Math.cos(a) * sp, vy: rand(0.3, 1.2), vz: Math.sin(a) * sp, s0: rand(1.4, 2) * k, s1: rand(4, 5.6) * k, life: rand(1.0, 1.5), drag: 2.4, buoy: 0.4, delay: 0.03, tint: 'dust', scroll: 0.85 });
    }
    for (let i = 0; i < 28; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(0.6, 4.5) * k;
      emit(smoke, { x: x + rand(-0.6, 0.6) * k, y: y + rand(-0.4, 0.6) * k, z: z + rand(-0.6, 0.6) * k, vx: Math.cos(a) * sp, vy: rand(2.5, 7.5) * k, vz: Math.sin(a) * sp, s0: rand(2, 3) * k, s1: rand(4.5, 7) * k, life: rand(1.8, 2.8), drag: 1.1, buoy: 1.4, delay: rand(0.06, 0.42) });
    }
    // 5. embers, sparks and debris
    fx.burst(x, y, z, 0xffa040, 55, { speed: 15 * k, up: 9, life: 1.4, gravity: 12 });
    fx.burst(x, y, z, 0xfff0b0, 34, { speed: 24 * k, up: 6, life: 0.45, gravity: 6 });
    fx.burst(x, y, z, 0xff4a10, 26, { speed: 9 * k, up: 12, life: 1.1, gravity: 14 });
    for (const d of debris) {
      if (d.on) continue;
      const [dx, dy, dz] = dir();
      const sp = rand(6, 14) * k;
      Object.assign(d, { on: true, age: 0, life: rand(1.5, 2.3), x: x + dx * 0.5, y: y + 0.2, z: z + dz * 0.5, vx: dx * sp, vy: Math.abs(dy) * sp * 0.6 + rand(5, 12), vz: dz * sp, wx: rand(-14, 14), wy: rand(-14, 14), wz: rand(-14, 14) });
      d.m.visible = true;
    }
  }

  const tmp = new THREE.Color();
  function update(dt, scroll, camZ = 8.2) {
    for (const p of parts) {
      if (!p.on) continue;
      p.age += dt;
      const s = p.s;
      if (p.age < p.delay) { s.visible = false; continue; }
      const t = (p.age - p.delay) / p.life;
      if (t >= 1) { p.on = false; s.visible = false; s.material.opacity = 0; continue; }
      const dmp = Math.exp(-p.drag * dt);
      p.vx *= dmp; p.vy *= dmp; p.vz *= dmp;
      p.vy += p.buoy * dt;
      p.x += p.vx * dt; p.y = Math.max(0.05, p.y + p.vy * dt); p.z += p.vz * dt + scroll * p.scroll;
      const size = lerp(p.s0, p.s1, ease(t));
      s.position.set(p.x, p.y, p.z);
      s.scale.set(size, size, 1);
      s.material.rotation += p.spin * dt;
      const near = clamp01((4.5 - p.z) / 2.5);   // fades out as it drifts in front of him, so the blast never hides the runner or smothers the screen
      if (p.kind === 'smoke') {
        if (p.tint === 'dust') tmp.setRGB(lerp(0.5, 0.3, t), lerp(0.42, 0.26, t), lerp(0.34, 0.22, t));
        else if (t < 0.3) tmp.setRGB(lerp(0.62, 0.17, t / 0.3), lerp(0.33, 0.16, t / 0.3), lerp(0.14, 0.17, t / 0.3));   // lit orange by the fireball at first, then charcoal
        else tmp.setRGB(lerp(0.17, 0.3, (t - 0.3) / 0.7), lerp(0.16, 0.3, (t - 0.3) / 0.7), lerp(0.17, 0.32, (t - 0.3) / 0.7));
        s.material.opacity = (t < 0.12 ? t / 0.12 : Math.pow(1 - t, 1.1)) * (p.tint === 'dust' ? 0.42 : 0.55) * near;
      } else if (p.kind === 'flash') {
        tmp.setRGB(1, lerp(0.95, 0.6, t), lerp(0.8, 0.25, t));
        s.material.opacity = (1 - t) * near;
      } else {   // fire: white-hot, then yellow, orange, red
        if (t < 0.18) tmp.setRGB(1, lerp(0.97, 0.74, t / 0.18), lerp(0.8, 0.28, t / 0.18));
        else if (t < 0.55) tmp.setRGB(1, lerp(0.74, 0.36, (t - 0.18) / 0.37), lerp(0.28, 0.05, (t - 0.18) / 0.37));
        else tmp.setRGB(lerp(1, 0.4, (t - 0.55) / 0.45), lerp(0.36, 0.06, (t - 0.55) / 0.45), lerp(0.05, 0.02, (t - 0.55) / 0.45));
        s.material.opacity = (t < 0.06 ? t / 0.06 : Math.pow(1 - t, 1.25)) * near;
      }
      s.material.color.copy(tmp);
      s.visible = true;
    }

    for (const r of rings) {
      if (!r.on) continue;
      r.age += dt;
      if (r.age < 0) { r.m.visible = false; continue; }
      const t = r.age / r.max;
      if (t >= 1) { r.on = false; r.m.visible = false; continue; }
      const rad = 0.6 + r.reach * ease(t);
      r.m.position.set(r.x, r.y, r.z + 0);
      r.m.scale.set(rad, 1, rad);
      r.m.material.opacity = 0.5 * Math.pow(1 - t, 1.8);
      r.m.visible = true;
      r.z += scroll * 0.55;
    }
    if (domeS.on) {
      domeS.age += dt;
      const t = domeS.age / 0.26;
      if (t >= 1) { domeS.on = false; dome.visible = false; }
      else {
        domeS.z += scroll * 0.55;
        dome.position.set(domeS.x, domeS.y, domeS.z);
        dome.scale.setScalar(0.6 + 7 * domeS.k * ease(t));
        dome.material.opacity = 0.11 * Math.pow(1 - t, 1.5);
        dome.visible = true;
      }
    }
    if (poolS.on) {   // firelight pooling on the road
      poolS.age += dt;
      const t = poolS.age / 1.1;
      if (t >= 1) { poolS.on = false; pool.visible = false; }
      else {
        pool.position.set(poolS.x, 0.05, poolS.z += scroll * 0.85);
        pool.scale.setScalar((5 + 4 * ease(t)) * poolS.k);
        pool.material.opacity = 0.9 * Math.pow(1 - t, 1.4);
        pool.visible = true;
      }
    }
    for (const sc of scorches) {
      if (!sc.on) continue;
      sc.age += dt;
      const t = sc.age / 3.6;
      sc.z += scroll;   // painted on the road, so it goes by at the road's speed
      if (t >= 1 || sc.z > 12) { sc.on = false; sc.m.visible = false; continue; }
      sc.m.position.set(sc.x, 0.045, sc.z);
      sc.m.scale.setScalar(2.6 * sc.k * (0.7 + 0.3 * Math.min(1, sc.age * 6)));
      sc.m.material.opacity = 0.62 * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4) * Math.min(1, sc.age * 8);
      sc.m.visible = true;
    }
    for (const d of debris) {
      if (!d.on) continue;
      d.age += dt;
      if (d.age >= d.life) { d.on = false; d.m.visible = false; continue; }
      d.vy -= 18 * dt;
      const drag = Math.exp(-0.5 * dt);
      d.vx *= drag; d.vz *= drag;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt + scroll;
      if (d.y < 0.1) { d.y = 0.1; d.vy = Math.abs(d.vy) * 0.35; d.vx *= 0.7; d.vz *= 0.7; d.wx *= 0.6; d.wy *= 0.6; d.wz *= 0.6; }
      d.m.position.set(d.x, d.y, d.z);
      d.m.rotation.x += d.wx * dt; d.m.rotation.y += d.wy * dt; d.m.rotation.z += d.wz * dt;
      const left = d.life - d.age;
      d.m.scale.setScalar(left < 0.4 ? Math.max(0.01, left / 0.4) : 1);
    }
  }

  function clear() {
    for (const p of parts) { p.on = false; p.s.visible = false; }
    for (const r of rings) { r.on = false; r.m.visible = false; }
    domeS.on = poolS.on = false; dome.visible = pool.visible = false;
    for (const sc of scorches) { sc.on = false; sc.m.visible = false; }
    for (const d of debris) { d.on = false; d.m.visible = false; }
  }

  /** Show one of everything in front of the camera for a frame, so every shader and texture is uploaded before the first blast. */
  function prewarm(on) {
    const all = [...parts.map((p) => p.s), ...rings.map((r) => r.m), dome, pool, ...scorches.map((s) => s.m), ...debris.map((d) => d.m)];
    for (const o of all) { o.visible = on; if (on) { o.position.set(0, 1, -6); o.frustumCulled = false; } }
  }

  return { explode, update, clear, prewarm };
}
