// Cracking obstacles open: what the blame shield does to anything he runs into.
//
// The obstacle freezes for a heartbeat while a glowing crack runs down it, then splits along the crack into
// two halves that swing open like a book and tumble away, with the pieces it was made of (paper bundles, the
// stamp, the sign plate, posts, tape bands) flying out and bouncing on the road.
//
// Each piece is a mesh built here from the same shapes the obstacle was baked from (the baked templates can't be
// split), and the obstacle's own mesh stays on screen until the crack lands, so nothing pops.
import { THREE, rand, mat, signTex, canvasTex } from './gfx.js';

const CRACK_T = 0.17;    // how long the crack takes to run before it breaks open
const PIECE_LIFE = 2.6;

/** A box cut in half along x (centred on itself), with its texture coordinates cut to the same half. */
function halfBox(w, h, d, side) {
  const geo = new THREE.BoxGeometry(w / 2, h, d);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (side > 0 ? 0.5 : 0));
  return geo;
}
function halfPlane(w, h, side) {
  const geo = new THREE.PlaneGeometry(w / 2, h);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 0.5 + (side > 0 ? 0.5 : 0));
  return geo;
}

export function createCrack(scene, fx, phys, debris) {
  const paper = mat(0xf4efe2);
  const red = mat(0xd7141f);
  const postMat = mat(0x2a2f3a, { roughness: 0.5, metalness: 0.3 });
  const taxSign = new THREE.MeshStandardMaterial({ map: signTex(['TAX', 'DUE!'], '#fff3b0', '#c0152a', 192, 256), roughness: 0.6, side: THREE.DoubleSide });
  const tapeSign = new THREE.MeshStandardMaterial({ map: signTex(['RED TAPE'], '#c40f1b', '#ffffff', 512, 128), roughness: 0.6 });
  const stripeTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#c40f1b'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    for (let x = -h; x < w + h; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); }
  });
  const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
  const orbMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, side: THREE.DoubleSide });
  const scrapGeo = new THREE.BoxGeometry(0.3, 0.012, 0.22);

  /* What each obstacle breaks into. side -1 / +1: the half that flies left / right. Positions are relative to the obstacle. */
  const recipes = { tax: [], tape: [], shot: [] };
  for (let i = 0; i < 5; i++) {   // the paper bundles, each cut down the middle
    const w = 1.5 - (i % 2) * 0.1, x = (((i * 7) % 5) - 2) * 0.03, y = 0.2 + i * 0.4;
    for (const side of [-1, 1]) recipes.tax.push({ geo: halfBox(w, 0.4, 0.9, side), m: paper, x: x + side * w / 4, y, z: 0, side, r: 0.35 });
  }
  for (const side of [-1, 1]) {
    recipes.tax.push({ geo: halfPlane(1.2, 1.2, side), m: taxSign, x: side * 0.3, y: 1.0, z: 0.47, side, r: 0.4 });   // the TAX DUE! plate
    recipes.tax.push({ geo: halfBox(0.5, 0.1, 0.5, side), m: red, x: side * 0.125, y: 2.05, z: 0, side, r: 0.1 });    // the stamp
  }
  for (const side of [-1, 1]) {
    recipes.tape.push({ geo: new THREE.CylinderGeometry(0.09, 0.11, 0.95, 8), m: postMat, x: side * 1.15, y: 0.475, z: 0, side, r: 0.1, post: true });
    for (const by of [0.34, 0.68]) recipes.tape.push({ geo: halfBox(2.3, 0.22, 0.1, side), m: stripeMat, x: side * 0.575, y: by, z: 0, side, r: 0.12 });
    recipes.tape.push({ geo: halfBox(1.0, 0.3, 0.04, side), m: tapeSign, x: side * 0.25, y: 0.51, z: 0.08, side, r: 0.12 });
  }
  for (const side of [-1, 1]) recipes.shot.push({ geo: new THREE.SphereGeometry(0.46, 12, 9, 0, Math.PI).rotateY(side * Math.PI / 2), m: orbMat, x: 0, y: 0, z: 0, side, r: 0.2 });

  /* The crack itself: a jagged line with branches, glowing at its edges. */
  const crackTex = canvasTex(128, 256, (g, w, h) => {
    let seed = 11; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const line = (x0, y0, x1, y1, width) => {
      const pts = [[x0, y0]];
      const n = Math.max(3, Math.round(Math.hypot(x1 - x0, y1 - y0) / 18));
      for (let i = 1; i < n; i++) pts.push([x0 + (x1 - x0) * i / n + (r() - 0.5) * 22, y0 + (y1 - y0) * i / n]);
      pts.push([x1, y1]);
      for (const [col, lw] of [['rgba(120,170,255,0.55)', width * 3.4], ['rgba(190,215,255,0.95)', width * 1.7], ['#03091f', width]]) {
        g.strokeStyle = col; g.lineWidth = lw; g.lineJoin = 'round'; g.lineCap = 'round';
        g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py))); g.stroke();
      }
      return pts;
    };
    const main = line(w / 2, 4, w / 2, h - 4, 4);
    for (const [from, dir, len] of [[0.28, -1, 46], [0.5, 1, 52], [0.68, -1, 40], [0.82, 1, 34]]) {   // branches
      const [bx, by] = main[Math.round(from * (main.length - 1))];
      line(bx, by, bx + dir * len, by + 28 + r() * 16, 2.6);
    }
  }, 2);
  const glowTex = canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(150,190,255,0.8)'); gr.addColorStop(1, 'rgba(40,90,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, 1);

  const decals = [], glows = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide }));
    d.visible = false; d.renderOrder = 6; scene.add(d); decals.push({ obj: d, busy: false });
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
    s.visible = false; s.renderOrder = 9; scene.add(s); glows.push({ obj: s, busy: false });
  }
  const take = (list) => { const e = list.find((x) => !x.busy); if (e) { e.busy = true; e.obj.visible = true; } return e; };
  const give = (e) => { if (e) { e.busy = false; e.obj.visible = false; } };

  const DECAL = { tax: [1.7, 2.4, 1.1, 0.56], tape: [2.0, 1.2, 0.5, 0.2], shot: [1.1, 1.3, 0, 0.5] };   // width, height, centre y, front z

  const active = [];
  const GROUND = () => phys.groundVel;

  /** one recipe piece as a rigid body, with the road's own velocity plus `vel` */
  function spawnPiece(p, x, cy, z, vel, omega, life) {
    if (!p.geo.boundingBox) p.geo.computeBoundingBox();
    const sz = p.geo.boundingBox.getSize(new THREE.Vector3());
    const g = GROUND();
    return debris.spawn({
      geo: p.geo, material: p.m, x: x + p.x, y: cy + p.y, z: z + p.z,
      size: [Math.max(0.03, sz.x / 2), Math.max(0.03, sz.y / 2), Math.max(0.01, sz.z / 2)], mass: Math.max(0.05, sz.x * sz.y * sz.z * 1.2),
      vel: vel.add(g), omega, life, restitution: p.post ? 0.35 : 0.28, friction: 0.55,
    });
  }
  function sheets(kind, x, cy, z, n, speed) {   // loose paper or tape fluttering out of the break
    for (let i = 0; i < n; i++) {
      debris.spawn({
        geo: scrapGeo, material: kind === 'tax' ? paper : red, x: x + rand(-0.4, 0.4), y: cy + rand(0.4, 2), z: z + rand(-0.2, 0.3), size: [0.15, 0.006, 0.11], mass: 0.02,
        vel: new THREE.Vector3(rand(-1, 1) * speed, rand(2, 7), rand(-1, 0.6) * speed).add(GROUND()), omega: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        aero: 1, aeroArea: 0.12, restitution: 0.1, life: rand(1.6, 2.8), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6))),
      });
    }
  }

  /** the shield breaks it: the two halves swing open like a book and tumble away */
  function breakOpen(e) {
    const m = e.src, x = m.position.x, z = m.position.z;
    e.release?.(m);
    const cy = e.kind === 'shot' ? m.position.y : 0;
    for (const p of recipes[e.kind]) {
      const open = p.post ? 0.5 : 1;   // posts just get knocked away
      spawnPiece(p, x, cy, z, new THREE.Vector3(p.side * rand(2.4, 4.6) * open + rand(-0.6, 0.6), rand(3.2, 7.2) + (p.y > 1 ? 0.8 : 0), rand(-3.5, 2)),
        new THREE.Vector3(rand(-5, 5), rand(-3, 3), -p.side * rand(1.4, 3.2)), PIECE_LIFE * rand(0.85, 1.2));
    }
    if (e.kind !== 'shot') sheets(e.kind, x, cy, z, 12, 4);
    fx.burst(x, cy + 1.1, z, 0xbcd4ff, 30, { speed: 8, up: 5, life: 0.7, gravity: 8 });
    fx.burst(x, cy + 1.1, z, 0xffffff, 12, { speed: 11, up: 3, life: 0.35, gravity: 4 });
    e.glow && (e.flare = 0.001);
  }

  /** a blast takes it apart: every piece is thrown away from `origin` (falling off with distance), with fire and ash */
  function shatter(kind, m, origin, power = 1) {
    const x = m.position.x, z = m.position.z, cy = kind === 'shot' ? m.position.y : 0;
    const centre = new THREE.Vector3(x, cy + 1, z), away = new THREE.Vector3();
    const d = centre.distanceTo(origin), fall = power / (1 + d / 24);
    for (const p of recipes[kind]) {
      away.set(x + p.x, cy + p.y, z + p.z).sub(origin);
      away.y = Math.max(away.y, 0.4);
      away.normalize();
      spawnPiece(p, x, cy, z, away.clone().multiplyScalar(rand(7, 16) * fall).add(new THREE.Vector3(rand(-2, 2), rand(3, 8) * fall, 0)),
        new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), rand(2.2, 3.4));
    }
    if (kind !== 'shot') sheets(kind, x, cy, z, 14, 7 * fall);
    // a burst of fire, smoke and embers where it stood
    for (let i = 0; i < 6; i++) fx.emit({ kind: 1, x: x + rand(-0.6, 0.6), y: cy + rand(0.3, 1.8), z: z + rand(-0.4, 0.4), vx: rand(-2, 2), vy: rand(2, 6), vz: rand(-2, 2), ground: 1, life: rand(0.4, 0.8), size: rand(0.8, 1.3), size1: rand(2, 3), drag: 2, buoy: 6, heat: 1, cool: 2.4, mode: 1, color: 0xffffff, turb: 4 });
    for (let i = 0; i < 5; i++) fx.emit({ kind: 2, x: x + rand(-0.5, 0.5), y: cy + rand(0.4, 1.6), z: z + rand(-0.4, 0.4), vx: rand(-1.5, 1.5), vy: rand(2, 5), vz: rand(-1.5, 1.5), ground: 1, life: rand(1.2, 2.2), size: rand(1, 1.6), size1: rand(2.8, 4.2), drag: 1, buoy: 1.6, heat: 0.6, cool: 0.6, color: 0x2e2e36, alpha: 0.55, turb: 3, floor: 0.6 });
    fx.sparks(x, cy + 1, z, 22, { speed: 11, up: 6, life: 1.1, grav: 20, ground: 1, color: 0xffa050 });
  }

  return {
    /** Take over `m` (a hazard or tape orb just hit) and crack it open. `release(m)` is called when it breaks. */
    open(kind, m, release) {
      const [w, h, cy, fz] = DECAL[kind];
      const e = { kind, src: m, release, t: 0, x0: m.position.x, decal: take(decals), glow: take(glows), size: [w, h, cy, fz], flare: 0 };
      if (e.decal) e.decal.obj.scale.set(w, h * 0.3, 1);
      active.push(e);
    },
    update(dt, scroll) {
      for (let i = active.length - 1; i >= 0; i--) {
        const e = active[i], m = e.src;
        const [w, h, cy, fz] = e.size;
        if (e.flare) {   // it has broken: let the energy flash fade, then free the decal and glow
          e.flare += dt;
          const f = Math.max(0, 1 - e.flare / 0.28);
          if (e.glow) { e.glow.obj.material.opacity = f; e.glow.obj.scale.setScalar(5.5 * (1 + e.flare * 2)); e.glow.obj.position.z += scroll; }
          if (f <= 0) { give(e.decal); give(e.glow); active.splice(i, 1); }
          continue;
        }
        e.t += dt;
        const k = Math.min(1, e.t / CRACK_T);
        m.position.z += scroll * 0.3;                         // the obstacle resists, and barely moves while it cracks
        m.position.x = e.x0 + Math.sin(e.t * 110) * 0.045 * k;   // and shudders harder as it goes
        if (e.decal) {
          const d = e.decal.obj;
          d.position.set(m.position.x, (e.kind === 'shot' ? m.position.y : 0) + cy, m.position.z + fz);
          d.scale.set(w, h * (0.3 + 0.7 * Math.min(1, k * 2)), 1);
          d.material.opacity = Math.min(1, e.t / 0.05);
        }
        if (e.glow) {
          const g = e.glow.obj;
          g.position.set(m.position.x, (e.kind === 'shot' ? m.position.y : 0) + cy, m.position.z + fz + 0.1);
          g.scale.setScalar(1.2 + 3 * k);
          g.material.opacity = 0.35 + 0.65 * k;
        }
        if (e.t >= CRACK_T) {
          breakOpen(e);
          if (e.decal) { e.decal.obj.material.opacity = 0; e.decal.obj.visible = false; }
          if (e.glow) e.glow.obj.position.set(m.position.x, (e.kind === 'shot' ? m.position.y : 0) + cy, m.position.z + fz + 0.2);
          if (!e.flare) { give(e.decal); give(e.glow); active.splice(i, 1); }
        }
      }
    },
    clear() {
      for (const e of active) { e.release?.(e.src); give(e.decal); give(e.glow); }
      active.length = 0;
    },
    shatter,
    /** Show one of every piece for a moment, so their shaders and textures are uploaded before the first crack. */
    prewarm(on) {
      if (on) {
        let x = -2.5;
        for (const kind of Object.keys(recipes)) for (const p of recipes[kind]) {
          const piece = spawnPiece(p, x += 0.2, 0.6, -6, new THREE.Vector3(), new THREE.Vector3(), 1e9);
          piece.body.gravityScale = 0;
        }
        for (const d of decals) { d.obj.visible = true; d.obj.position.set(0, 1, -6); d.obj.frustumCulled = false; }
        for (const gl of glows) { gl.obj.visible = true; gl.obj.position.set(0, 1, -6); gl.obj.frustumCulled = false; }
      } else {
        debris.clear();
        for (const d of decals) d.obj.visible = d.busy;
        for (const gl of glows) gl.obj.visible = gl.busy;
      }
    },
  };
}
