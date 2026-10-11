// Shop cosmetics worn by the player, and the cape: a real cloth simulation.
//
// Cape = Verlet particles joined by structure, shear and bend links, per-triangle aerodynamic wind and
// drag, fixed sub-steps, and collision with his body (torso, hips and legs, head, shoulders, swinging
// arms) and the ground. It is stepped once per frame AFTER the player's final pose, so the tie point
// is always exactly on his collar.
import { THREE, mat, mesh, box, canvasTex } from './gfx.js';
import { S, W } from './state.js';

export function createCosmetics({ scene, player, camera }) {
  function balloonTex() {
    const draw = (g, w, h, img) => {
      g.fillStyle = '#1f4fb8';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const cx of [w * 0.25, w * 0.75]) {   // once for each side, so it faces the camera whichever way he turns
        if (img) {
          const iw = 150, ih = iw * img.naturalHeight / img.naturalWidth;
          g.drawImage(img, cx - iw / 2, h / 2 - ih / 2, iw, ih);
        } else {
          g.fillRect(cx - 60, h * 0.36, 120, 8);
          g.fillRect(cx - 60, h * 0.36 + 14, 120, 8);
          g.font = '900 38px system-ui, sans-serif';
          g.fillText('LIBERAL', cx, h * 0.62);
        }
      }
    };
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    draw(g, 512, 256, null);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (window.BALLOON_LOGO) {
      const img = new Image();
      img.onload = () => { draw(g, 512, 256, img); tex.needsUpdate = true; };
      img.src = window.BALLOON_LOGO;
    }
    return tex;
  }

  const costume = { tag: [], balloon: [], tape: [], cap: [], hivis: [], sash: [], cape: [], megaphone: [], scissors: [], sausage: [], sign: [] };
  {
    // speech bubble to the right of him (lives in the scene so it doesn't spin when he turns)
    const bubbleTex = canvasTex(512, 224, (g, w, h) => {
      const rr = (x, y, bw, bh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + bw, y, x + bw, y + bh, r); g.arcTo(x + bw, y + bh, x, y + bh, r); g.arcTo(x, y + bh, x, y, r); g.arcTo(x, y, x + bw, y, r); g.closePath(); };
      g.lineJoin = 'round'; g.lineWidth = 8; g.strokeStyle = '#1b2a41'; g.fillStyle = '#ffffff';
      rr(40, 8, w - 48, h - 40, 36); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(41, 108); g.lineTo(6, 166); g.lineTo(41, 140); g.closePath(); g.fill(); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.moveTo(41, 112); g.lineTo(41, 136); g.stroke();   // hide the border where the tail joins
      g.fillStyle = '#1b2a41'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 42px system-ui, sans-serif';
      g.fillText('GREAT JOB,', 272, 66);
      g.fillText('WELL DONE ANGUS!', 272, 122);
    });
    const bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex, depthTest: false, transparent: true }));
    bubble.scale.set(3.4, 1.49, 1);
    bubble.renderOrder = 11;
    scene.add(bubble);
    costume.tag.push(bubble);

    const balloon = new THREE.Group();
    const bBody = mesh(new THREE.SphereGeometry(0.8, 12, 9), new THREE.MeshStandardMaterial({ map: balloonTex(), roughness: 0.25 }));
    bBody.scale.y = 1.2;
    balloon.add(bBody, box(0.02, 1.4, 0.02, mat(0xdddddd), 0, -1.66, 0));
    balloon.position.set(0.8, 3.7, -0.1);
    player.add(balloon);
    costume.balloon.push(balloon);

    const red = mat(0xd7141f, { emissive: 0x3a0306 });
    // diagonal strips that bind his arms to his sides and his legs together
    const strip = (w, d, y, tilt) => {
      const m = mesh(new THREE.BoxGeometry(w, 0.085, d), red);
      m.position.set(0, y, 0);
      m.rotation.z = tilt;
      player.add(m);
      costume.tape.push(m);
    };
    [[1.52, 0.14], [1.76, -0.14], [2.0, 0.14]].forEach(([y, t]) => strip(1.06, 0.44, y, t));
    [[1.18, -0.1], [0.92, 0.2], [0.66, -0.2], [0.4, 0.2], [0.16, -0.12]].forEach(([y, t]) => strip(0.58, 0.3, y, t));

    // ---- party-themed items (all sized to read clearly from the camera) ----
    const blue = mat(0x1d4fb8, { roughness: 0.5 });
    const gold = mat(0xd4a017, { roughness: 0.3 });
    const add = (id, parent, m) => { parent.add(m); costume[id].push(m); return m; };
    const headG = player.getObjectByName('head');
    const elbowRG = player.getObjectByName('elbowR'), elbowLG = player.getObjectByName('elbowL');   // held items hang from the forearm

    // blue campaign cap
    const capDome = mesh(new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), blue);
    capDome.scale.set(0.38, 0.32, 0.36);
    capDome.position.y = 0.24;
    add('cap', headG, capDome);
    add('cap', headG, box(0.42, 0.04, 0.3, blue, 0, 0.25, 0.38));
    add('cap', headG, box(0.26, 0.07, 0.02, mat(0xffffff), 0, 0.37, 0.335));
    add('cap', headG, mesh(new THREE.SphereGeometry(0.05, 5, 3), gold)).position.set(0, 0.56, 0);

    // hi-vis vest (front left open so the tie still shows) and hard hat
    const hatMat = mat(0xff8a00, { roughness: 0.35 });
    const hatDome = mesh(new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, 0, Math.PI / 2), hatMat);
    hatDome.scale.set(0.4, 0.34, 0.38);
    hatDome.position.y = 0.24;
    add('hivis', headG, hatDome);
    const hatBrim = mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.04, 7), hatMat);
    hatBrim.position.set(0, 0.25, 0.06);
    add('hivis', headG, hatBrim);
    add('hivis', headG, box(0.07, 0.06, 0.5, mat(0xd96f00), 0, 0.58, 0));
    const vestMat = new THREE.MeshStandardMaterial({ color: 0xc8e600, emissive: 0x283300, flatShading: true, side: THREE.DoubleSide });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x444444, flatShading: true, side: THREE.DoubleSide });
    const openBand = (rt, rb, h, y, m) => {
      const b = mesh(new THREE.CylinderGeometry(rt, rb, h, 5, 1, true, Math.PI / 6, (5 * Math.PI) / 3), m);
      b.position.y = y;
      b.scale.z = 0.57;
      add('hivis', player, b);
    };
    openBand(0.35, 0.268, 0.74, 1.82, vestMat);
    openBand(0.338, 0.326, 0.08, 2.0, stripeMat);
    openBand(0.302, 0.294, 0.08, 1.68, stripeMat);

    // blue and gold sash across the chest
    const sashG = new THREE.Group();
    sashG.position.y = 1.7;
    sashG.rotation.z = 0.55;
    sashG.add(box(0.22, 1.0, 0.46, blue, 0, 0, 0), box(0.035, 1.0, 0.47, gold, 0.115, 0, 0), box(0.035, 1.0, 0.47, gold, -0.115, 0, 0));
    add('sash', player, sashG);

    // free-market cape: a proper cloth simulation. Verlet particles joined by structure, shear and
    // bend links, per-triangle aerodynamic wind and drag, sub-stepping, and collision with his body
    // (torso, hips and legs, head, shoulders and swinging arms) and the ground.
    const capeTex = canvasTex(384, 576, (g, w, h) => {
      g.fillStyle = '#1b46a8';
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.07;                       // woven fabric: fine crossed threads
      g.fillStyle = '#000000';
      for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
      g.fillStyle = '#ffffff';
      for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
      g.globalAlpha = 1;
      g.strokeStyle = '#d4a017'; g.lineWidth = 22; g.strokeRect(11, 11, w - 22, h - 22);   // gold hem
      g.strokeStyle = '#a97f0d'; g.lineWidth = 3; g.strokeRect(26, 26, w - 52, h - 52);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const [text, y] of [['FREE', 0.36], ['MARKETS', 0.62]]) {   // each line is shrunk until it fits inside the gold hem
        let size = 150;
        g.font = `900 ${size}px system-ui, sans-serif`;
        while (size > 20 && g.measureText(text).width > w - 90) { size -= 4; g.font = `900 ${size}px system-ui, sans-serif`; }
        g.fillText(text, w / 2, h * y);
      }
    });
    // a trapezoid: narrow at the collar, fanning out towards the hem
    const CAPE_COLS = 13, CAPE_ROWS = 19, CAPE_TOP = 0.30, CAPE_BOT = 1.1, CAPE_H = 1.6, AERO = 0.07;
    const capeDY = CAPE_H / (CAPE_ROWS - 1);
    const rest = (r, c) => new THREE.Vector2((CAPE_TOP + (CAPE_BOT - CAPE_TOP) * (r / (CAPE_ROWS - 1))) * (0.5 - c / (CAPE_COLS - 1)), -r * capeDY);
    const ci = (r, c) => r * CAPE_COLS + c;
    const nP = CAPE_COLS * CAPE_ROWS;
    const P = [], Q = [], VEL = [], ACC = [];
    for (let i = 0; i < nP; i++) { P.push(new THREE.Vector3()); Q.push(new THREE.Vector3()); VEL.push(new THREE.Vector3()); ACC.push(new THREE.Vector3()); }
    const links = [], tris = [];   // links: [a, b, restLength, stiffness]
    const link = (r1, c1, r2, c2, k) => links.push([ci(r1, c1), ci(r2, c2), rest(r1, c1).distanceTo(rest(r2, c2)), k]);
    for (let r = 0; r < CAPE_ROWS; r++) for (let c = 0; c < CAPE_COLS; c++) {
      if (c + 1 < CAPE_COLS) link(r, c, r, c + 1, 1);
      if (r + 1 < CAPE_ROWS) link(r, c, r + 1, c, 1);
      if (r + 1 < CAPE_ROWS && c + 1 < CAPE_COLS) {
        link(r, c, r + 1, c + 1, 0.8); link(r, c + 1, r + 1, c, 0.8);
        tris.push([ci(r, c), ci(r + 1, c), ci(r, c + 1)], [ci(r, c + 1), ci(r + 1, c), ci(r + 1, c + 1)]);
      }
      if (c + 2 < CAPE_COLS) link(r, c, r, c + 2, 0.25);   // bending resistance gives soft, natural folds
      if (r + 2 < CAPE_ROWS) link(r, c, r + 2, c, 0.25);
    }
    const triArea0 = 0.5 * ((CAPE_TOP + CAPE_BOT) / 2 / (CAPE_COLS - 1)) * capeDY;   // average triangle area at rest

    // standard plane (proper normals and UVs); the simulation overwrites its vertices every frame
    const capeGeo = new THREE.PlaneGeometry(1, CAPE_H, CAPE_COLS - 1, CAPE_ROWS - 1);
    const capeMesh = new THREE.Mesh(capeGeo, new THREE.MeshPhysicalMaterial({
      map: capeTex, side: THREE.DoubleSide, roughness: 0.85, sheen: 1, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x7aa0ff),
    }));
    capeMesh.frustumCulled = false;
    capeMesh.castShadow = true;
    const capeRoot = new THREE.Group();   // lives in the scene (world space), not on the player
    capeRoot.add(capeMesh);
    scene.add(capeRoot);
    costume.cape.push(capeRoot);
    add('cape', player, mesh(new THREE.SphereGeometry(0.08, 5, 3), gold)).position.set(0, 2.27, -0.14);   // clasp at the collar
    add('cape', player, box(0.34, 0.05, 0.05, gold, 0, 2.27, -0.15));

    const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _n = new THREE.Vector3(), _e = new THREE.Vector3();
    const _wind = new THREE.Vector3(), _rel = new THREE.Vector3(), _inv = new THREE.Matrix4();
    const clamp01 = (x) => Math.max(0, Math.min(1, x));
    // collision helpers, all in the player's local space: push a point out of a body part
    const outEllipse = (v, y0, y1, ex, ez) => {      // a vertical elliptical column (torso, hips and legs)
      if (v.y < y0 || v.y > y1) return false;
      const q = Math.hypot(v.x / ex, v.z / ez);
      if (q >= 1) return false;
      if (q < 0.05) { v.x = 0; v.z = -ez; return true; }
      v.x /= q; v.z /= q;
      return true;
    };
    const outSphere = (v, cx, cy, cz, r) => {
      _n.set(v.x - cx, v.y - cy, v.z - cz);
      const d = _n.length();
      if (d >= r) return false;
      v.set(cx, cy, cz).addScaledVector(_n, r / Math.max(d, 1e-4));
      return true;
    };
    const outCapsule = (v, a, b, r, k = 1) => {              // a limb: a segment with a radius
      _e.copy(b).sub(a);
      const t = clamp01(_n.copy(v).sub(a).dot(_e) / _e.lengthSq());
      _q.copy(a).addScaledVector(_e, t);
      _n.copy(v).sub(_q);
      const d = _n.length();
      if (d >= r) return false;
      _e.copy(_q).addScaledVector(_n, r / Math.max(d, 1e-4));
      v.lerp(_e, k);   // only part of the way, so a fast arm nudges the cloth instead of popping it
      return true;
    };

    const H = 1 / 120;          // fixed physics step: variable time steps make Verlet cloth jitter
    let ready = false, acc = 0;
    const lastPins = [];        // where the collar was at the end of the previous frame
    for (let c = 0; c < CAPE_COLS; c++) lastPins.push(new THREE.Vector3());
    capeRoot.userData.reset = () => { ready = false; };
    capeRoot.userData.step = (dt, t) => {
      player.updateMatrixWorld(true);
      _inv.copy(player.matrixWorld).invert();
      const pins = [];   // along the back of his collar; column 0 is screen-left so the lettering reads correctly
      for (let c = 0; c < CAPE_COLS; c++) pins.push(player.localToWorld(new THREE.Vector3(rest(0, c).x, 2.28, -0.15)));
      if (!ready) {
        for (let r = 0; r < CAPE_ROWS; r++) for (let c = 0; c < CAPE_COLS; c++) {
          const i = ci(r, c), q = rest(r, c);
          P[i].copy(player.localToWorld(new THREE.Vector3(q.x, 2.28 + q.y, -0.16)));
          Q[i].copy(P[i]);
        }
        for (let c = 0; c < CAPE_COLS; c++) lastPins[c].copy(pins[c]);
        ready = true;
        acc = 0;
      }
      const headwind = S.mode !== 'playing' ? 0 : S.onGround ? 4 + S.speed * 0.5 : 3 + S.speed * 0.3;
      const armSeg = [];   // arm capsules follow the swinging, bending arms (upper arm and forearm)
      for (const side of [-1, 1]) {
        const arm = player.getObjectByName(side < 0 ? 'armL' : 'armR'), elb = player.getObjectByName(side < 0 ? 'elbowL' : 'elbowR');
        const th = arm ? arm.rotation.x : 0, ph = th + (elb ? elb.rotation.x : 0);
        const A = new THREE.Vector3(side * 0.37, 2.15, 0);
        const E = new THREE.Vector3(A.x, A.y - 0.57 * Math.cos(th), -0.57 * Math.sin(th));
        const Hand = new THREE.Vector3(A.x, E.y - 0.65 * Math.cos(ph), E.z - 0.65 * Math.sin(ph));
        armSeg.push([A, E], [E, Hand]);
      }
      acc = Math.min(acc + dt, 0.034);   // at most four sub-steps a frame, so a slow frame never snowballs
      const n = Math.floor(acc / H);
      acc -= n * H;
      for (let s = 0; s < n; s++) {
        for (let c = 0; c < CAPE_COLS; c++) {           // glide the collar pins from last frame's spot to this frame's
          Q[c].copy(P[c]);
          P[c].lerpVectors(lastPins[c], pins[c], (s + 1) / n);
        }
        for (let i = 0; i < nP; i++) { VEL[i].copy(P[i]).sub(Q[i]).multiplyScalar(1 / H); ACC[i].set(0, -9.8, 0); }
        // wind with slow gusts and swirl
        const gust = Math.sin(t * 5.3) * 0.5 + Math.sin(t * 11.7 + 1.3) * 0.3;
        _wind.set(Math.sin(t * 3.1) * 1.5, Math.sin(t * 4.3 + 0.7) * 1.2 + headwind * 0.05, headwind * (1 + 0.18 * gust));
        // aerodynamics: each triangle is pushed along its normal by the wind passing through it
        for (const [a, b, c] of tris) {
          _n.copy(P[b]).sub(P[a]);
          _p.copy(P[c]).sub(P[a]);
          _n.cross(_p);
          const area2 = _n.length();
          if (area2 < 1e-9) continue;
          _n.multiplyScalar(1 / area2);
          _rel.copy(_wind).addScaledVector(VEL[a], -1 / 3).addScaledVector(VEL[b], -1 / 3).addScaledVector(VEL[c], -1 / 3);
          const vn = _rel.dot(_n);
          const f = (AERO * vn * Math.abs(vn) * (area2 * 0.5 / triArea0)) / 6;
          ACC[a].addScaledVector(_n, f); ACC[b].addScaledVector(_n, f); ACC[c].addScaledVector(_n, f);
        }
        // Verlet integration with a little internal damping
        for (let i = CAPE_COLS; i < nP; i++) {
          _p.copy(P[i]);
          P[i].addScaledVector(_q.copy(P[i]).sub(Q[i]), 0.992).addScaledVector(ACC[i], H * H);
          Q[i].copy(_p);
        }
        // keep the cloth's shape: structure, shear and bend links (the pinned collar row never moves)
        for (let k = 0; k < 5; k++) {
          for (const [a, b, len, kk] of links) {
            const wa = a < CAPE_COLS ? 0 : 1, wb = b < CAPE_COLS ? 0 : 1;
            if (wa + wb === 0) continue;
            _n.copy(P[b]).sub(P[a]);
            const d = _n.length() || 1e-6;
            const corr = (((d - len) / d) * kk) / (wa + wb);
            P[a].addScaledVector(_n, corr * wa);
            P[b].addScaledVector(_n, -corr * wb);
          }
        }
        // collisions: the body (not the top rows, which are tied to the collar and would fight it) and the ground
        for (let i = CAPE_COLS; i < nP; i++) {
          let hit = false;
          if (i >= CAPE_COLS * 3) {
            _p.copy(P[i]).applyMatrix4(_inv);
            hit = outEllipse(_p, 1.0, 2.32, 0.36, 0.2);
            hit = outEllipse(_p, 0.0, 1.0, 0.3, 0.18) || hit;
            hit = outSphere(_p, 0, 2.72, 0, 0.42) || hit;   // the (bigger) head
            for (const [A, B] of armSeg) hit = outCapsule(_p, A, B, 0.09, 0.4) || hit;
            if (hit) P[i].copy(_p).applyMatrix4(player.matrixWorld);
          }
          if (P[i].y < 0.03) {
            P[i].y = 0.03;
            Q[i].x += (P[i].x - Q[i].x) * 0.5;
            Q[i].z += (P[i].z - Q[i].z) * 0.5;
          }
        }
      }
      for (let c = 0; c < CAPE_COLS; c++) { P[c].copy(pins[c]); lastPins[c].copy(pins[c]); }   // the tie point is always exactly on the collar
      const pos = capeGeo.attributes.position;
      for (let i = 0; i < nP; i++) pos.setXYZ(i, P[i].x, P[i].y, P[i].z);
      pos.needsUpdate = true;
      capeGeo.computeVertexNormals();
    };

    // megaphone in his right hand
    const mp = new THREE.Group();
    mp.position.set(0, -0.73, 0.2);
    mp.scale.setScalar(1.6);
    const horn = mesh(new THREE.CylinderGeometry(0.05, 0.2, 0.42, 6), blue);
    horn.rotation.x = -Math.PI / 2;
    horn.position.z = 0.1;
    mp.add(horn, box(0.06, 0.14, 0.06, mat(0x222222), 0, -0.1, -0.08));
    add('megaphone', elbowRG, mp);

    // giant red-tape scissors in his right hand
    const steel = mat(0xcfd6df, { roughness: 0.25, metalness: 0.4 });
    const scissors = new THREE.Group();
    scissors.position.set(0, -0.73, 0.2);
    scissors.rotation.x = Math.PI / 2;
    for (const s of [-1, 1]) {
      const blade = box(0.09, 1.1, 0.03, steel, s * 0.035, 0.6, 0);
      blade.rotation.z = -s * 0.07;
      const ring = mesh(new THREE.TorusGeometry(0.15, 0.04, 5, 8), mat(0xd7141f));
      ring.position.set(s * 0.14, -0.1, 0);
      scissors.add(blade, ring);
    }
    add('scissors', elbowRG, scissors);

    // democracy sausage in his left hand
    const sausage = new THREE.Group();
    sausage.position.set(0, -0.73, 0.22);
    sausage.rotation.x = Math.PI / 2;
    sausage.add(mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.62, 6), mat(0xe0b070)));
    const snag = mesh(new THREE.CylinderGeometry(0.095, 0.095, 0.74, 6), mat(0x8a3b1f));
    snag.position.x = 0.07;
    sausage.add(snag, box(0.04, 0.5, 0.05, mat(0xcc2222), 0.15, 0, 0));
    add('sausage', elbowLG, sausage);

    // "Vote 1" campaign sign on a pole
    const signTex = canvasTex(256, 176, (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#1d4fb8';
      g.fillRect(0, 0, w, 18);
      g.fillRect(0, h - 18, w, 18);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '900 84px system-ui, sans-serif';
      g.fillText('VOTE 1', w / 2, h * 0.42);
      g.font = '800 34px system-ui, sans-serif';
      g.fillText('TAX CUTS', w / 2, h * 0.74);
    });
    const sign = new THREE.Group();
    sign.position.set(-0.78, 0, 0.1);
    sign.add(box(0.05, 2.5, 0.05, mat(0x7a5a3a), 0, 2.2, 0));
    const board = mesh(new THREE.BoxGeometry(1.15, 0.78, 0.04), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }));
    board.position.y = 3.1;
    sign.add(board);
    add('sign', player, sign);
  }

  function applyCosmetics() {
    for (const id of Object.keys(costume)) for (const o of costume[id]) o.visible = !!W.equipped[id];
  }
  // The cape is stepped once per frame, AFTER the player's final pose for the frame (hop, spin, lean),
  // so the tie point is always exactly on his collar.
  function stepCape(dt) {
    const cape = costume.cape[0];
    if (!cape.visible) { cape.userData.reset(); return; }
    if (S.mode !== 'paused') cape.userData.step(dt, performance.now() / 1000);
  }
  function animateCosmetics(dt = 1 / 60) {
    const t = performance.now() / 1000, b = costume.balloon[0];
    b.position.y = 3.7 + Math.sin(t * 2) * 0.08;
    b.rotation.z = Math.sin(t * 1.3) * 0.12;
    const flap = player.getObjectByName('tieFlap');
    if (flap) {
      flap.visible = S.mode === 'playing' && S.onGround;   // only while running away, so you never see two ties
      flap.rotation.z = 0.25 + Math.sin(t * 14) * 0.25;
      flap.rotation.y = 0.9 + Math.sin(t * 11 + 1) * 0.3;
    }
    const bub = costume.tag[0];
    if (bub.visible) {   // to his right, kept inside the screen
      const halfW = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 8.2 * camera.aspect;
      bub.position.set(Math.min(player.position.x + (W.equipped.sign ? 3.6 : 2.2), camera.position.x + halfW - 1.8), S.y + 3.3, 0);
    }
  }
  return {
    costume,
    apply: applyCosmetics,
    stepCape,
    animate: animateCosmetics,
    resetCape: () => costume.cape[0].userData.reset(),
  };
}
