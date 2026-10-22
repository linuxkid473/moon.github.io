// The Angus Tax Car: a low, wide Liberal-blue convertible that Angus sits in (his legs are hidden in the footwell; the cockpit rim
// goes round his waist). It faces down the road (-z). It is visual only: main.js decides what it hits and what happens to them.
//   update(dt, { x, y, vx, vy, speed })  positions it, leans it into lane changes, spins and steers the wheels, bounces the suspension
import { THREE, canvasTex } from './gfx.js';

export function createCar(scene) {
  const car = new THREE.Group();
  car.visible = false;
  scene.add(car);

  const paint = new THREE.MeshPhysicalMaterial({ color: 0x1650c8, metalness: 0.55, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08 });
  const paintDark = new THREE.MeshPhysicalMaterial({ color: 0x0a2a78, metalness: 0.5, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.85, roughness: 0.28 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6edf7, metalness: 1, roughness: 0.14 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0c101c, roughness: 0.5, metalness: 0.3 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa8ccff, transparent: true, opacity: 0.3, roughness: 0.04, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false });
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff3d0, emissive: 0xfff0c0, emissiveIntensity: 3.5 });
  const tail = new THREE.MeshStandardMaterial({ color: 0xff2a3a, emissive: 0xff1a2a, emissiveIntensity: 2.6 });
  const add = (m, parent = car) => { m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
  const ell = (rx, ry, rz, material, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), material); m.scale.set(rx, ry, rz); m.position.set(x, y, z); return add(m); };
  const box = (w, h, d, material, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.position.set(x, y, z); return add(m); };

  // the hull: a smooth pill lying along the road, with a hood and a rear deck blended in
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.62, 1.7, 16, 32), paint);
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.3, 1, 0.5);
  hull.position.y = 0.5;
  add(hull);
  ell(0.7, 0.3, 1.05, paint, 0, 0.7, -0.95);       // hood
  ell(0.76, 0.3, 0.72, paint, 0, 0.7, 1.0);        // rear deck
  box(1.68, 0.1, 2.9, paintDark, 0, 0.24, 0);      // the skirt
  // the cockpit rim, round Angus's waist
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.07, 14, 40), gold);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(1.15, 1.3, 1);
  rim.position.set(0, 0.78, 0.18);
  add(rim);
  // windscreen and its frame
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.5), glass);
  screen.position.set(0, 1.12, -0.52);
  screen.rotation.x = -0.95;
  car.add(screen);
  for (const sx of [-1, 1]) { const post = box(0.05, 0.56, 0.05, chrome, sx * 0.62, 1.1, -0.5); post.rotation.x = -0.95; }
  box(1.28, 0.05, 0.05, chrome, 0, 1.33, -0.73).rotation.x = -0.1;
  // steering wheel
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.028, 10, 24), trim);
  wheelRim.position.set(0, 1.02, -0.32);
  wheelRim.rotation.x = -0.6;
  add(wheelRim);

  // bumpers, grille, exhausts
  box(1.62, 0.12, 0.12, chrome, 0, 0.36, -1.52);
  box(1.62, 0.12, 0.12, chrome, 0, 0.4, 1.52);
  box(0.9, 0.2, 0.05, trim, 0, 0.5, -1.5);
  for (const sx of [-1, 1]) { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.3, 14), chrome); ex.rotation.x = Math.PI / 2; ex.position.set(sx * 0.4, 0.3, 1.58); add(ex); }

  // lamps, and a cone of light thrown down the road
  const beamGeo = new THREE.ConeGeometry(0.95, 8, 20, 1, true).translate(0, -4, 0).rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    ell(0.12, 0.12, 0.12, lamp, sx * 0.5, 0.62, -1.46);
    ell(0.1, 0.07, 0.04, tail, sx * 0.55, 0.62, 1.5);
    const beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.085, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.set(sx * 0.5, 0.62, -1.5);
    beam.rotation.x = 0.07;
    car.add(beam);
  }

  // the sign on the back, and the doors
  const signTex = canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d4a017'; g.lineWidth = 6; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 34px system-ui, sans-serif'; g.fillText('ANGUS', w / 2, h * 0.32);
    g.fillStyle = '#ffd34d'; g.font = '900 38px system-ui, sans-serif'; g.fillText('TAX CAR', w / 2, h * 0.7);
  });
  const sign = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.44, 0.05), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.4, emissive: 0x8aa8ff, emissiveMap: signTex, emissiveIntensity: 0.5 }));
  sign.position.set(0, 1.18, 1.3);
  add(sign);
  for (const sx of [-1, 1]) box(0.05, 0.5, 0.05, chrome, sx * 0.4, 0.95, 1.3);
  const doorTex = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
    g.fillStyle = '#d4a017'; g.fillRect(0, h * 0.78, w, h * 0.1);
    g.fillStyle = '#ffffff'; g.font = '900 46px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TAX CUTS', w / 2, h * 0.4);
  });
  for (const sx of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.34), new THREE.MeshBasicMaterial({ map: doorTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    decal.position.set(sx * 0.846, 0.52, 0.2);
    decal.rotation.y = sx * Math.PI / 2;
    car.add(decal);
  }

  // wheels (the front pair steer)
  const wheels = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.86, 0.36, sz * 0.98);
    const spin = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.32, 28), tyre); t.rotation.z = Math.PI / 2;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 20), chrome); hub.rotation.z = Math.PI / 2;
    spin.add(t, hub);
    for (let i = 0; i < 5; i++) {   // spokes, so the spin reads
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.07), gold);
      sp.position.x = sx * 0.17; sp.rotation.x = (i / 5) * Math.PI;
      spin.add(sp);
    }
    for (const o of spin.children) { o.castShadow = true; }
    pivot.add(spin);
    car.add(pivot);
    wheels.push({ pivot, spin, front: sz < 0 });
  }

  // neon underglow
  const glowTex = canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gr.addColorStop(0, 'rgba(90,160,255,0.95)'); gr.addColorStop(0.6, 'rgba(40,90,255,0.4)'); gr.addColorStop(1, 'rgba(20,60,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 1);
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 4.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8, fog: false }));
  under.position.y = 0.05;
  under.renderOrder = 2;
  car.add(under);

  let t = 0, rollV = 0, roll = 0, pitch = 0, steer = 0;
  return {
    group: car,
    /** Angus's seat, in the car's own space (the player is placed here) */
    seat: new THREE.Vector3(0, 0.74, 0.2),
    get visible() { return car.visible; },
    set visible(v) { car.visible = v; },
    /** the point where the exhaust is */
    exhaust(out) { car.updateMatrixWorld(true); return car.localToWorld(out.set(0, 0.32, 1.7)); },
    update(dt, { x, y, vx, vy, speed }) {
      t += dt;
      // a spring-damper for the body roll, driven by the sideways speed (so it overshoots and settles like a real suspension)
      const target = -vx * 0.045;
      rollV += ((target - roll) * 120 - rollV * 14) * dt;
      roll += rollV * dt;
      pitch += ((-vy * 0.012 - pitch) * 14) * dt;
      steer += ((-vx * 0.05 - steer) * 16) * dt;
      car.position.set(x, y + Math.sin(t * 38) * 0.008 * Math.min(1, speed / 20), 0);
      car.rotation.set(pitch, 0, roll);
      for (const w of wheels) {
        w.spin.rotation.x -= (speed * dt) / 0.36;
        w.pivot.rotation.y = w.front ? Math.max(-0.5, Math.min(0.5, steer)) : 0;
      }
      under.material.opacity = 0.65 + 0.15 * Math.sin(t * 6);
    },
  };
}
