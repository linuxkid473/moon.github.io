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
const PIECE_LIFE = 1.5;
const GRAVITY = 17;

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

export function createCrack(scene, fx) {
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

  const active = [], pieces = [];

  function breakOpen(e) {
    const m = e.src, x = m.position.x, z = m.position.z;
    e.release?.(m);
    const list = recipes[e.kind];
    const cy = e.kind === 'shot' ? m.position.y : 0;
    for (const p of list) {
      const mesh = new THREE.Mesh(p.geo, p.m);
      mesh.position.set(x + p.x, cy + p.y, z + p.z);
      const open = p.post ? 0.5 : 1;   // the halves swing open like a book; posts just get knocked away
      pieces.push({
        mesh, vx: p.side * rand(2.4, 4.6) * open + rand(-0.6, 0.6), vy: rand(3.2, 7.2) + (p.y > 1 ? 0.8 : 0), vz: rand(-3.5, 2),
        wx: rand(-5, 5), wy: rand(-3, 3), wz: -p.side * rand(1.4, 3.2), r: p.r, age: 0, life: PIECE_LIFE * rand(0.85, 1.15),
      });
      scene.add(mesh);
    }
    if (e.kind !== 'shot') for (let i = 0; i < 12; i++) {   // loose sheets fluttering out of the crack
      const mesh = new THREE.Mesh(scrapGeo, e.kind === 'tax' ? paper : red);
      mesh.position.set(x + rand(-0.4, 0.4), cy + rand(0.4, 2), z + rand(-0.2, 0.3));
      pieces.push({ mesh, vx: rand(-4, 4), vy: rand(2, 7), vz: rand(-3, 2), wx: rand(-9, 9), wy: rand(-9, 9), wz: rand(-9, 9), r: 0.03, age: 0, life: rand(1, 1.6), drag: 2.6 });
      scene.add(mesh);
    }
    fx.burst(x, cy + 1.1, z, 0xbcd4ff, 30, { speed: 8, up: 5, life: 0.7, gravity: 8 });
    fx.burst(x, cy + 1.1, z, 0xffffff, 12, { speed: 11, up: 3, life: 0.35, gravity: 4 });
    e.glow && (e.flare = 0.001);
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
      for (let i = pieces.length - 1; i >= 0; i--) {
        const p = pieces[i], mesh = p.mesh;
        p.age += dt;
        if (p.age >= p.life) { scene.remove(mesh); pieces.splice(i, 1); continue; }
        const drag = Math.exp(-(p.drag ?? 0.35) * dt);
        p.vx *= drag; p.vz *= drag;
        p.vy -= GRAVITY * dt;
        mesh.position.x += p.vx * dt;
        mesh.position.y += p.vy * dt;
        mesh.position.z += p.vz * dt + scroll * 0.6;   // they follow the road only partly, so the pieces stay around him instead of rushing the camera
        if (mesh.position.y < p.r) {   // bounce on the road, losing speed
          mesh.position.y = p.r;
          p.vy = Math.abs(p.vy) * 0.32;
          p.vx *= 0.7; p.vz *= 0.7; p.wx *= 0.6; p.wy *= 0.6; p.wz *= 0.6;
        }
        mesh.rotation.x += p.wx * dt; mesh.rotation.y += p.wy * dt; mesh.rotation.z += p.wz * dt;
        const left = p.life - p.age;
        mesh.scale.setScalar(left < 0.35 ? Math.max(0.01, left / 0.35) : 1);   // shrink away at the end
      }
    },
    clear() {
      for (const e of active) { e.release?.(e.src); give(e.decal); give(e.glow); }
      active.length = 0;
      for (const p of pieces) scene.remove(p.mesh);
      pieces.length = 0;
    },
    /** Show one of every piece for a moment, so their shaders and textures are uploaded before the first crack. */
    prewarm(on) {
      if (on) {
        let x = -2.5;
        for (const kind of Object.keys(recipes)) for (const p of recipes[kind]) {
          const mesh = new THREE.Mesh(p.geo, p.m);
          mesh.position.set(x += 0.2, 0.6, -6);
          mesh.frustumCulled = false;
          scene.add(mesh);
          pieces.push({ mesh, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, r: 0, age: -99, life: 1e9, prewarm: true });
        }
        for (const d of decals) { d.obj.visible = true; d.obj.position.set(0, 1, -6); d.obj.frustumCulled = false; }
        for (const gl of glows) { gl.obj.visible = true; gl.obj.position.set(0, 1, -6); gl.obj.frustumCulled = false; }
      } else {
        for (let i = pieces.length - 1; i >= 0; i--) if (pieces[i].prewarm) { scene.remove(pieces[i].mesh); pieces.splice(i, 1); }
        for (const d of decals) d.obj.visible = d.busy;
        for (const gl of glows) gl.obj.visible = gl.busy;
      }
    },
  };
}
