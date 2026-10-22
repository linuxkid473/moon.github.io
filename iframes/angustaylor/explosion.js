// The tax bomb: a blast built from simulated parts instead of canned sprites.
//
// In the order it happens:
//   1. a white-hot flash, a real point light that lights the street and the people in it, and a shockwave ring racing over the road
//   2. a fireball of buoyant, turbulent fire particles. Each has a temperature that decays, and its colour follows the black-body
//      ramp (white, yellow, orange, red, charcoal) while it dissolves through noise from the edges in
//   3. tongues of flame thrown along the ground and a plume punched upwards
//   4. a ring of dust and a boiling smoke column that is underlit by the fire and blown back by the headwind
//   5. sparks that bounce and skid on the road, and embers that rise and flicker
//   6. a field of real rigid debris (paper that flutters, stamps, coins, slabs) that tumbles and skids (see debris.js)
//   7. a scorch mark and a pool of firelight on the road, which fade
// Everything rides on the road (the road is a conveyor), so the cloud streams past the runner at road speed.
import { THREE, rand, canvasTex } from './gfx.js';

const ease = (t) => 1 - Math.pow(1 - t, 2.2);

export function createExplosion(scene, fx, phys, debris) {
  const light = new THREE.PointLight(0xffa04a, 0, 70, 2);   // always in the scene (at zero), so no shader ever recompiles when a blast goes off
  scene.add(light);
  const L = { t: 99, k: 1, x: 0, y: 0, z: 0 };

  const softDisc = (stops) => canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    stops.forEach(([at, col]) => gr.addColorStop(at, col));
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 1);
  const lightTex = softDisc([[0, 'rgba(255,190,90,0.95)'], [0.35, 'rgba(255,130,40,0.5)'], [1, 'rgba(255,90,0,0)']]);
  const scorchTex = softDisc([[0, 'rgba(0,0,0,0.95)'], [0.55, 'rgba(0,0,0,0.6)'], [1, 'rgba(0,0,0,0)']]);

  /* shockwave: rings on the road, a thin dome, the firelight on the road and the scorch mark */
  const ringGeo = new THREE.RingGeometry(0.93, 1, 64).rotateX(-Math.PI / 2);
  const rings = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    m.visible = false; m.renderOrder = 8; scene.add(m);
    return { m, on: false };
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, depthWrite: false, opacity: 0, blending: THREE.AdditiveBlending, fog: false }));
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

  /* debris pieces: paper sheets, stamps, green tax-cut coins and bundle slabs */
  const paperMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, emissive: 0xd04a08, emissiveIntensity: 0, roughness: 0.8, side: THREE.DoubleSide });
  const stampMat = new THREE.MeshStandardMaterial({ color: 0xd7141f, emissive: 0xff5a10, emissiveIntensity: 0, roughness: 0.7 });
  const coinMat = new THREE.MeshStandardMaterial({ color: 0x1f9d55, emissive: 0x0b4a25, roughness: 0.35, metalness: 0.4 });
  const slabMat = new THREE.MeshStandardMaterial({ color: 0xe9e2cf, emissive: 0xc83c00, emissiveIntensity: 0, roughness: 0.85 });
  const paperGeo = new THREE.BoxGeometry(0.34, 0.012, 0.44), stampGeo = new THREE.BoxGeometry(0.2, 0.12, 0.2);
  const coinGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.04, 14), slabGeo = new THREE.BoxGeometry(0.5, 0.14, 0.36);

  const queue = [];   // emissions that happen a moment after the flash
  const at = (t, fn) => queue.push({ t, fn });
  const dir = () => { const a = rand(0, Math.PI * 2), u = rand(-0.25, 1), r = Math.sqrt(1 - u * u); return [Math.cos(a) * r, u, Math.sin(a) * r]; };
  const G = () => phys.groundVel;

  /** Set the whole thing off at (x, y, z). k scales it (1 is the tax bomb on the road). */
  function explode(x, y, z, k = 1) {
    L.t = 0; L.k = k; L.x = x; L.y = y + 0.5; L.z = z;
    const gv = G();
    const c = (n) => Math.max(4, Math.round(n * Math.min(1.4, 0.35 + 0.65 * k)));   // smaller blasts use fewer particles
    // 1. flash and shockwave
    fx.emit({ kind: 3, x, y, z, vx: 0, vy: 0, vz: 0, ground: 1, life: 0.14, size: 7 * k, size1: 12 * k, drag: 0, grav: 0, color: 0xfff2d8, alpha: 0.75, glow: 2.2 });
    fx.emit({ kind: 3, x, y, z, vx: 0, vy: 0, vz: 0, ground: 1, life: 0.3, size: 4 * k, size1: 9 * k, drag: 0, grav: 0, color: 0xffb060, alpha: 0.55, glow: 1.4 });
    rings.forEach((r, i) => Object.assign(r, { on: true, age: -i * 0.07, x, y: 0.06, z, k, max: 0.5 + i * 0.12, reach: (14 - i * 3) * k }));
    Object.assign(domeS, { on: true, age: 0, x, y, z, k });
    Object.assign(poolS, { on: true, age: 0, x, z, k });
    const sc = scorches.find((s) => !s.on) || scorches[0];
    Object.assign(sc, { on: true, age: 0, x, z, k });

    // 2. the fireball: hot, buoyant, turbulent
    for (let i = 0, n = c(46); i < n; i++) {
      const [dx, dy, dz] = dir(), sp = rand(2.2, 10) * k;
      fx.emit({
        kind: 1, x: x + dx * 0.4 * k, y: y + dy * 0.4 * k, z: z + dz * 0.4 * k, vx: dx * sp, vy: dy * sp * 0.85 + rand(1, 3), vz: dz * sp, ground: 1,
        life: rand(0.55, 1.2), size: rand(1.4, 2.4) * k, size1: rand(3.6, 6.4) * k, drag: 2.2, grav: 0, buoy: rand(5, 10), heat: rand(0.85, 1), cool: rand(1.5, 2.6),
        mode: 1, color: 0xffffff, glow: 1, alpha: 0.7, turb: 5, spin: rand(-1.8, 1.8),
      });
    }
    // 3. flames thrown along the ground, and the plume
    for (let i = 0, n = c(22); i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(8, 20) * k;
      fx.emit({ kind: 1, x, y: 0.4 + rand(0, 0.7), z, vx: Math.cos(a) * sp, vy: rand(0.3, 2.5), vz: Math.sin(a) * sp, ground: 1, life: rand(0.35, 0.75), size: rand(0.9, 1.5) * k, size1: rand(2.2, 3.4) * k, drag: 3.4, grav: 0, buoy: 3, heat: 0.9, cool: 2.6, mode: 1, color: 0xffffff, turb: 3, spin: rand(-2, 2) });
    }
    at(0.02, () => { for (let i = 0, n = c(18); i < n; i++) fx.emit({ kind: 1, x: x + rand(-0.5, 0.5) * k, y: y + rand(-0.3, 0.3), z: z + rand(-0.5, 0.5) * k, vx: rand(-1.8, 1.8), vy: rand(6, 13) * k, vz: rand(-1.8, 1.8), ground: 1, life: rand(0.6, 1.1), size: rand(1.1, 1.8) * k, size1: rand(2.6, 4) * k, drag: 1.4, buoy: 7, heat: 1, cool: 2, mode: 1, color: 0xffffff, turb: 4, spin: rand(-1.5, 1.5) }); });
    // 4. a ring of dust off the road, and the smoke column
    for (let i = 0, n = c(30); i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(8, 18) * k;
      fx.emit({ kind: 4, x, y: 0.3, z, vx: Math.cos(a) * sp, vy: rand(0.2, 1.2), vz: Math.sin(a) * sp, ground: 1, life: rand(0.8, 1.5), size: rand(0.8, 1.3) * k, size1: rand(2.6, 4) * k, spin: rand(-1, 1), drag: 3, grav: -0.3, turb: 2, color: 0x6d6f7c, alpha: 0.42, floor: 0.2 });
    }
    for (let i = 0, n = c(46); i < n; i++) {
      at(rand(0.04, 0.5), () => {
        const a = rand(0, Math.PI * 2), sp = rand(0.6, 4.5) * k;
        fx.emit({
          kind: 2, x: x + rand(-0.7, 0.7) * k, y: y + rand(-0.3, 0.8) * k, z: z + rand(-0.7, 0.7) * k, vx: Math.cos(a) * sp, vy: rand(2.5, 8) * k, vz: Math.sin(a) * sp, ground: 1,
          life: rand(1.8, 3.2), size: rand(1.8, 3) * k, size1: rand(5, 8) * k, drag: 0.9, grav: 0, buoy: rand(1.2, 2.6), heat: rand(0.5, 0.8), cool: 0.5,
          color: 0x3a3a42, alpha: 0.62, turb: 3.2, spin: rand(-0.7, 0.7), floor: 1,
        });
      });
    }
    // 5. sparks that bounce and skid on the road, and embers that rise
    fx.sparks(x, y, z, Math.round(110 * k), { speed: 22 * k, up: 9, life: 1.6, grav: 22, ground: 1, bounce: 0.5, size: 0.055, color: 0xffd9a0 });
    fx.sparks(x, y, z, Math.round(60 * k), { speed: 12 * k, up: 12, life: 1.2, grav: 18, ground: 1, bounce: 0.35, size: 0.07, color: 0xff7a30, heat: 0.8 });
    for (let i = 0, n = c(60); i < n; i++) {
      const [dx, dy, dz] = dir(), sp = rand(2, 9) * k;
      fx.emit({ kind: 3, x, y, z, vx: dx * sp, vy: Math.abs(dy) * sp + 2, vz: dz * sp, ground: 1, life: rand(1.4, 3), size: rand(0.1, 0.2), size1: 0.05, drag: 1.1, grav: -1, buoy: 3.2, heat: 1, cool: 0.8, mode: 1, color: 0xffffff, glow: 1.4, turb: 4.5, alpha: 0.9 });
    }

    // 6. rigid debris: it keeps the road's own speed and is thrown outwards on top of it
    const n = c(40);
    for (let i = 0; i < n; i++) {
      const [dx, dy, dz] = dir(), sp = rand(6, 20) * k, r = i % 10;
      const base = { x: x + dx * 0.5, y: y + 0.3, z: z + dz * 0.5, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3))), omega: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)), life: rand(2.2, 3.6) };
      const vel = new THREE.Vector3(dx * sp + gv.x, Math.abs(dy) * sp * 0.7 + rand(4, 11) + gv.y, dz * sp + gv.z);
      if (r < 4) debris.spawn({ ...base, geo: paperGeo, material: paperMat, size: [0.17, 0.006, 0.22], mass: 0.03, aero: 1, aeroArea: 0.25, restitution: 0.1, friction: 0.5, linDamp: 0.2, glow: 1.2, vel });
      else if (r < 6) debris.spawn({ ...base, geo: stampGeo, material: stampMat, size: [0.1, 0.06, 0.1], mass: 0.4, restitution: 0.35, glow: 1, vel });
      else if (r < 8) debris.spawn({ ...base, geo: coinGeo, material: coinMat, size: [0.16, 0.02, 0.16], mass: 0.18, restitution: 0.55, friction: 0.3, vel });
      else if (r < 9) debris.spawn({ ...base, geo: slabGeo, material: slabMat, size: [0.25, 0.07, 0.18], mass: 0.6, restitution: 0.22, glow: 1, vel: vel.multiplyScalar(0.7) });
    }
    // shove anything already lying around (other debris, bodies) too
    phys.blast(new THREE.Vector3(x, y, z), 9 * k, 12 * k);
  }

  function update(dt, scroll) {
    // scheduled emissions
    for (let i = queue.length - 1; i >= 0; i--) {
      queue[i].t -= dt;
      if (queue[i].t <= 0) { const f = queue[i].fn; queue.splice(i, 1); f(); }
    }
    // the light: a violent flash that falls off quickly and flickers as it dies
    if (L.t < 3) {
      L.t += dt;
      const f = Math.exp(-L.t * 4.2) * (1 + 0.25 * Math.sin(L.t * 60));
      light.position.set(L.x, L.y + L.t * 2.5, L.z += scroll);
      light.intensity = 650 * L.k * f;
      fx.setFire(Math.max(0, 1 - L.t / 1.5));
    } else if (light.intensity !== 0) { light.intensity = 0; fx.setFire(0); }

    for (const r of rings) {
      if (!r.on) continue;
      r.age += dt;
      if (r.age < 0) { r.m.visible = false; continue; }
      const t = r.age / r.max;
      if (t >= 1) { r.on = false; r.m.visible = false; continue; }
      const rad = 0.6 + r.reach * ease(t);
      r.z += scroll;
      r.m.position.set(r.x, r.y, r.z);
      r.m.scale.set(rad, 1, rad);
      r.m.material.opacity = 0.55 * Math.pow(1 - t, 1.8);
      r.m.visible = true;
    }
    if (domeS.on) {
      domeS.age += dt;
      const t = domeS.age / 0.26;
      if (t >= 1) { domeS.on = false; dome.visible = false; }
      else {
        domeS.z += scroll;
        dome.position.set(domeS.x, domeS.y, domeS.z);
        dome.scale.setScalar(0.6 + 8 * domeS.k * ease(t));
        dome.material.opacity = 0.13 * Math.pow(1 - t, 1.5);
        dome.visible = true;
      }
    }
    if (poolS.on) {   // firelight pooling on the road
      poolS.age += dt;
      const t = poolS.age / 1.2;
      if (t >= 1) { poolS.on = false; pool.visible = false; }
      else {
        pool.position.set(poolS.x, 0.05, poolS.z += scroll);
        pool.scale.setScalar((5 + 5 * ease(t)) * poolS.k);
        pool.material.opacity = 0.85 * Math.pow(1 - t, 1.4);
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
      sc.m.scale.setScalar(2.8 * sc.k * (0.7 + 0.3 * Math.min(1, sc.age * 6)));
      sc.m.material.opacity = 0.65 * (t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4) * Math.min(1, sc.age * 8);
      sc.m.visible = true;
    }
  }

  function clear() {
    queue.length = 0;
    L.t = 99; light.intensity = 0;
    for (const r of rings) { r.on = false; r.m.visible = false; }
    domeS.on = poolS.on = false; dome.visible = pool.visible = false;
    for (const sc of scorches) { sc.on = false; sc.m.visible = false; }
  }

  /** Show one of everything in front of the camera for a frame, so every shader and texture is uploaded before the first blast. */
  function prewarm(on) {
    const all = [...rings.map((r) => r.m), dome, pool, ...scorches.map((s) => s.m)];
    for (const o of all) { o.visible = on; if (on) { o.position.set(0, 1, -6); o.frustumCulled = false; } }
    if (on) {
      let px = -1.2;
      for (const [geo, material, size] of [[paperGeo, paperMat, [0.17, 0.006, 0.22]], [stampGeo, stampMat, [0.1, 0.06, 0.1]], [coinGeo, coinMat, [0.16, 0.02, 0.16]], [slabGeo, slabMat, [0.25, 0.07, 0.18]]]) {
        const p = debris.spawn({ geo, material, size, x: (px += 0.4), y: 1, z: -6, vel: new THREE.Vector3(), life: 99, glow: 1 });
        p.body.gravityScale = 0;
      }
      light.intensity = 1;
      fx.emit({ kind: 1, x: 0, y: 1, z: -6, life: 5, size: 1, drag: 0, grav: 0 });
      fx.emit({ kind: 2, x: 0.5, y: 1, z: -6, life: 5, size: 1, drag: 0, grav: 0 });
      fx.emit({ kind: 0, x: 1, y: 1, z: -6, life: 5, size: 0.1, drag: 0, grav: 0 });
    } else { debris.clear(); light.intensity = 0; fx.clear(); }
  }

  return { explode, update, clear, prewarm };
}
