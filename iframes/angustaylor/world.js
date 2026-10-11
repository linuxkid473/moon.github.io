// The world around the road: road and stage floor, templates cloned for scenery and obstacles,
// truss arches with sweeping beams, confetti, and the menu stage Angus stands on.
import { THREE, mat, mesh, box, canvasTex, signTex, rand, pick } from './gfx.js';

/** The menu stage lives high above the road so nothing from the game shows through. */
export const STAGE = { x: 0, y: 200, z: 0 };

export function createWorld({ scene, camera }) {
  /* ---------- road & sky-side props ---------- */
  const roadTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#33232d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff3b4a';
    g.fillRect(4, 0, 6, h);
    g.fillRect(w - 10, 0, 6, h);
    g.fillRect(44, 0, 4, h / 2);     // dashed lane line, top half of each tile
    g.fillRect(80, 0, 4, h / 2);
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, 20);

  const road = mesh(
    new THREE.PlaneGeometry(8, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.4, metalness: 0.2 })
  );
  road.position.set(0, 0, -60);
  road.castShadow = false;
  scene.add(road);

  const grassMat = mat(0x2a1822, { roughness: 0.45, metalness: 0.15 });   // black stage floor either side of the road
  for (const sx of [-1, 1]) {
    const grass = mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), grassMat);
    grass.position.set(sx * 104, -0.02, -60);
    grass.castShadow = false;
    scene.add(grass);
  }

  /* ---------- templates (cloned on spawn; geometry + materials are shared) ---------- */
  const T = {};
  function buildTemplates() {
    const red = mat(0xd7141f), paper = mat(0xf4efe2);

    const taxSign = new THREE.MeshStandardMaterial({ map: signTex(['TAX', 'DUE!'], '#fff3b0', '#c0152a', 192, 256), roughness: 0.6 });
    T.tax = mesh(new THREE.BoxGeometry(1.5, 2, 0.9).translate(0, 1, 0), [paper, paper, paper, paper, taxSign, paper]);

    const tapeSign = new THREE.MeshStandardMaterial({ map: signTex(['RED TAPE'], '#c40f1b', '#ffffff', 512, 128), roughness: 0.6 });
    T.tape = mesh(new THREE.BoxGeometry(2.2, 0.8, 0.4).translate(0, 0.4, 0), [red, red, red, red, tapeSign, red]);

    const cutGreen = mat(0x1f9d55, { emissive: 0x0b4a25 });
    const cutSign = new THREE.MeshStandardMaterial({ map: signTex(['TAX', 'CUT'], '#1f9d55', '#ffffff', 256, 256), roughness: 0.5, emissive: 0x0b4a25 });
    T.taxCut = mesh(new THREE.BoxGeometry(0.9, 0.9, 0.1), [cutGreen, cutGreen, cutGreen, cutGreen, cutSign, cutGreen]);
    T.taxCut.castShadow = false;

    // tape orbs: glowing red orbs trailing a ribbon of red tape. On a hit the tape wraps him and throws him.
    const orb = new THREE.Group();
    orb.add(mesh(new THREE.SphereGeometry(0.46, 12, 9), new THREE.MeshBasicMaterial({ color: 0xff2a3a })));
    orb.add(mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })));   // hot white core, so it stands out from the red lights
    orb.add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 5).rotateX(-Math.PI / 2).translate(0, 0, -3), new THREE.MeshBasicMaterial({ color: 0xff4455, side: THREE.DoubleSide })));   // the ribbon of tape behind it
    const haloTex = canvasTex(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,90,100,0.55)'); gr.addColorStop(1, 'rgba(255,40,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    halo.scale.set(3, 3, 1);
    halo.renderOrder = 9;
    orb.add(halo);
    T.shot = orb;

    // rally-stage props: LED pillars, red searchlight stands, an LED screen and cheering crowds
    const ledRed = new THREE.MeshBasicMaterial({ color: 0xff3b4a });
    T.buildings = [4, 6, 9, 12].map((h) => {
      const p = new THREE.Group();
      p.add(mesh(new THREE.BoxGeometry(3, h, 3).translate(0, h / 2, 0), mat(pick([0x2a2f44, 0x3a2a3c, 0x26303f]), { emissive: 0x5a0a14 })));
      p.add(box(0.18, h * 0.9, 0.06, ledRed, -0.8, h / 2, 1.52), box(0.18, h * 0.9, 0.06, ledRed, 0.8, h / 2, 1.52));
      return p;
    });

    const tree = new THREE.Group();   // a searchlight stand with a red beam shooting up
    tree.add(box(0.25, 3.6, 0.25, mat(0x20232b), 0, 1.8, 0));
    tree.add(mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.6, 8), mat(0x15181f)), mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 8), ledRed));
    tree.children[1].position.y = 3.9; tree.children[2].position.y = 4.2;
    const spot = new THREE.Mesh(new THREE.ConeGeometry(0.9, 10, 10, 1, true).translate(0, 5, 0), new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    spot.position.y = 4.2; spot.rotation.z = 0.25;
    tree.add(spot);
    T.tree = tree;

    const makeScreen = (line1, line2) => {   // an LED screen on legs
      const tex = canvasTex(512, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0a2a78'); gr.addColorStop(1, '#14409e');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = '#c8102e'; g.fillRect(0, h - 70, w, 44); g.fillStyle = '#ffffff'; g.fillRect(0, h - 26, w, 8);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [text, y, color, size] of [[line1, h * 0.3, '#ffffff', 78], [line2, h * 0.62, '#ffd34d', 62]]) {
          let sz = size; g.font = `900 ${sz}px system-ui, sans-serif`;
          while (sz > 20 && g.measureText(text).width > w - 40) { sz -= 4; g.font = `900 ${sz}px system-ui, sans-serif`; }
          g.fillStyle = color; g.fillText(text, w / 2, y);
        }
      });
      const grp = new THREE.Group();
      grp.add(box(0.2, 3.2, 0.2, mat(0x20232b), -2.3, 1.6, 0), box(0.2, 3.2, 0.2, mat(0x20232b), 2.3, 1.6, 0));
      grp.add(box(5.2, 2.7, 0.2, mat(0x05070d), 0, 3.6, -0.02));
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(5, 2.5), new THREE.MeshBasicMaterial({ map: tex }));
      scr.position.set(0, 3.6, 0.1);
      grp.add(scr);
      return grp;
    };
    T.screens = [makeScreen('TAX CUTS', 'NOW'), makeScreen('FIGHTING', 'TAXES'), makeScreen('FEWER FORMS', 'MORE FREEDOM'), makeScreen('LOWER TAXES', 'BETTER FUTURE')];

    const crowd = new THREE.Group();   // a row of silhouettes, a few in red caps, some with arms up
    const darkMat = mat(0x0a0d1a);
    for (let i = 0; i < 5; i++) {
      const x = (i - 2) * 0.75, h = 0.9 + ((i * 7) % 3) * 0.1;
      crowd.add(box(0.6, h, 0.4, darkMat, x, h / 2, 0));
      const head = mesh(new THREE.SphereGeometry(0.25, 6, 5), darkMat);
      head.position.set(x, h + 0.2, 0);
      crowd.add(head);
      if (i % 2 === 0) crowd.add(box(0.3, 0.1, 0.3, mat(0xc8102e), x, h + 0.42, 0));
      if (i % 3 === 1) crowd.add(box(0.12, 0.6, 0.12, darkMat, x + 0.35, h + 0.3, 0));
    }
    T.crowd = crowd;
    T.billboards = [['VOTE', '#1f4fb8', '#ffffff'], ['POLICY', '#ffffff', '#1f4fb8'], ['BALLOT', '#c0152a', '#ffffff']].map(([text, bg, fg]) => {
      const b = new THREE.Group();
      b.add(box(0.12, 2.6, 0.12, mat(0x555555), -0.9, 1.3, 0));
      b.add(box(0.12, 2.6, 0.12, mat(0x555555), 0.9, 1.3, 0));
      const board = mesh(new THREE.BoxGeometry(2.4, 1.2, 0.08), new THREE.MeshStandardMaterial({ map: signTex([text], bg, fg, 512, 256), roughness: 0.6 }));
      board.position.set(0, 2.0, 0);
      b.add(board);
      return b;
    });
  }
  buildTemplates();

  /* ---------- LED "LIBERAL" signs ---------- */
  // A plain wordmark in an LED dot-matrix style. To use an official logo image you have the right
  // to use, set window.LED_LOGO = "data:image/png;base64,..." (or an image URL) before this script runs.
  function ledLogoTex() {
    const LW = 512, LH = 192;
    const draw = (g, img) => {
      g.fillStyle = '#0b2f86'; g.fillRect(0, 0, LW, LH);
      g.strokeStyle = '#d4a017'; g.lineWidth = 8; g.strokeRect(4, 4, LW - 8, LH - 8);
      g.fillStyle = '#ffffff';
      if (img) {
        const ih = 130, iw = ih * img.naturalWidth / img.naturalHeight;
        g.drawImage(img, (LW - iw) / 2, (LH - ih) / 2, iw, ih);
      } else {
        g.fillRect(150, 34, 212, 10); g.fillRect(150, 52, 212, 10);
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 88px system-ui, sans-serif';
        g.fillText('LIBERAL', LW / 2, 118);
      }
      g.fillStyle = 'rgba(0,0,0,0.38)';   // dark gaps between the lights make it look like an LED panel
      for (let y = 0; y < LH; y += 6) g.fillRect(0, y, LW, 2);
      for (let x = 0; x < LW; x += 6) g.fillRect(x, 0, 2, LH);
    };
    const c = document.createElement('canvas');
    c.width = LW; c.height = LH;
    const g = c.getContext('2d');
    draw(g, null);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    if (window.LED_LOGO) {
      const img = new Image();
      img.onload = () => { draw(g, img); tex.needsUpdate = true; };
      img.src = window.LED_LOGO;
    }
    return tex;
  }
  const ledLogoMat = new THREE.MeshBasicMaterial({ map: ledLogoTex() });

  /* ---------- confetti drifting through the lights ---------- */
  const CONF_N = 120;
  const confetti = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.2, vertexColors: true, depthWrite: false }));
  {
    const pos = new Float32Array(CONF_N * 3), col = new Float32Array(CONF_N * 3);
    const palette = [[1, 0.2, 0.25], [1, 1, 1], [1, 0.82, 0.3], [0.3, 0.5, 1]];
    for (let i = 0; i < CONF_N; i++) {
      pos.set([(i % 2 ? 1 : -1) * rand(4.8, 11), rand(0, 9), rand(-70, 10)], i * 3);   // only beside the road, never over the lanes
      col.set(pick(palette), i * 3);
    }
    confetti.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    confetti.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    confetti.frustumCulled = false;
    scene.add(confetti);
  }

  /* ---------- truss arches over the road, with sweeping red beams ---------- */
  const ARCH_N = 7, ARCH_STEP = 20;
  const arches = [];
  {
    const trussMat = mat(0x1b1d26), can = mat(0x15181f);
    const bulbMats = { on: new THREE.MeshBasicMaterial({ color: 0xffd34d }), red: new THREE.MeshBasicMaterial({ color: 0xff3b4a }), off: mat(0x3a2630) };
    arches.mats = bulbMats;
    const bannerTex = canvasTex(130, 300, (g, w, h) => {
      g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d4a017'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#ffffff'; g.beginPath();
      for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 17 : 40; g.lineTo(w / 2 + Math.cos(ang) * r, 90 + Math.sin(ang) * r); }
      g.closePath(); g.fill();
      g.fillStyle = '#c8102e'; g.fillRect(14, 180, w - 28, 70);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 26px system-ui, sans-serif'; g.fillText('TAX', w / 2, 200); g.fillText('CUTS', w / 2, 232);
    });
    const lens = new THREE.MeshBasicMaterial({ color: 0xff6a73 });
    const beamGeo = new THREE.ConeGeometry(1.1, 7, 12, 1, true).translate(0, -3.5, 0);   // apex at the origin so the beam swings from its lamp
    for (let i = 0; i < ARCH_N; i++) {
      const a = new THREE.Group();
      a.position.z = -8 - i * ARCH_STEP;
      for (const sx of [-1, 1]) a.add(box(0.3, 7.3, 0.3, trussMat, sx * 5.6, 3.65, 0));
      a.add(box(11.6, 0.3, 0.3, trussMat, 0, 7.2, 0));
      a.userData.beams = [];
      a.userData.bulbs = [];   // a row of chasing lights along the top bar
      for (let j = 0; j < 14; j++) { const bulb = box(0.22, 0.22, 0.22, bulbMats.off, -5.5 + j * (11 / 13), 7.45, 0); a.add(bulb); a.userData.bulbs.push(bulb); }
      for (const sx of [-1, 1]) {   // banners hung on the pylons
        const ban = mesh(new THREE.PlaneGeometry(1.3, 3), new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide }));
        ban.position.set(sx * 5.0, 4.3, 0.2);
        a.add(ban);
      }
      a.add(box(3.6, 1.45, 0.1, mat(0x05070d), 0, 8.4, -0.06));   // LED sign on top of each arch
      const ledSign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.275), ledLogoMat);
      ledSign.position.set(0, 8.4, 0.02);
      a.add(ledSign);
      for (const [k, x] of [-3.6, 0, 3.6].entries()) {
        const housing = mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.45, 8), can);
        housing.position.set(x, 7.0, 0);
        const l = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), lens);
        l.position.set(x, 6.76, 0);
        const bm = new THREE.MeshBasicMaterial({ color: [0xff2a3a, 0xffe3b0, 0xff2a3a][k], transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const pivot = new THREE.Group();
        pivot.position.set(x, 6.75, 0);
        pivot.add(new THREE.Mesh(beamGeo, bm));
        a.add(housing, l, pivot);
        const pm = bm.clone();   // the spot of light this beam throws on the floor
        pm.opacity = 0.3;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20).rotateX(-Math.PI / 2), pm);
        pool.position.set(x, 0.04, 0);
        a.add(pool);
        a.userData.beams.push({ pivot, mat: bm, phase: i * 1.3 + k * 2.1, x, pool });
      }
      scene.add(a);
      arches.push(a);
    }
    const glow = new THREE.PointLight(0xff2a3a, 120, 18, 2);   // a red glow over the runner
    glow.position.set(0, 5.5, 3);
    scene.add(glow);
  }

  /* ---------- the menu stage: a conference-style rally stage with Angus standing proudly ---------- */
  // It lives high above the road (STAGE.y) so nothing from the game shows through, and is only
  // visible while the menu is up (stageMode). The look is a generic big-conference stage: LED
  // backdrop, truss lighting, a lectern, flags and an audience, with no real event's logo.
  const stage = new THREE.Group();
  stage.position.set(STAGE.x, STAGE.y, STAGE.z);
  const stageAnim = { beams: [], washes: [], crowd: [], flashes: [], flags: [], sweep: null };   // things that move (see stageAnimate)
  {
    const navy = mat(0x0b1533), glossy = new THREE.MeshStandardMaterial({ color: 0x141d3a, roughness: 0.25, metalness: 0.25 });
    const led = (map) => new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
    const fit = (g, text, w, size) => { g.font = `900 ${size}px system-ui, sans-serif`; while (size > 20 && g.measureText(text).width > w) { size -= 4; g.font = `900 ${size}px system-ui, sans-serif`; } };
    const starPath = (g, cx, cy, r) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill(); };
    const add = (m, x, y, z) => { m.position.set(x, y, z); stage.add(m); return m; };

    // floor, with an LED edge strip
    add(mesh(new THREE.BoxGeometry(18, 0.4, 9), glossy), 0, -0.2, -0.5);
    add(box(18, 0.07, 0.07, new THREE.MeshBasicMaterial({ color: 0xff2a3a }), 0, 0, 0), 0, 0.02, 3.95);
    add(mesh(new THREE.BoxGeometry(26, 0.2, 9), navy), 0, -0.3, 8.5);

    // LED backdrop: big wording, stars and a red band
    const backTex = canvasTex(1024, 470, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0a2a78'); gr.addColorStop(1, '#14409e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
      for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = '#c8102e'; g.fillRect(0, h - 90, w, 56);
      g.fillStyle = '#ffffff'; g.fillRect(0, h - 34, w, 10);
      for (let i = 0; i < 9; i++) starPath(g, 70 + i * 110, 52, 20);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
      fit(g, 'FIGHTING TAXES', w - 120, 150); g.fillText('FIGHTING TAXES', w / 2, h * 0.4);
      fit(g, 'TAX CUTS NOW', w - 200, 70); g.fillStyle = '#ffd34d'; g.fillText('TAX CUTS NOW', w / 2, h * 0.68);
    });
    add(box(14.6, 6.9, 0.2, mat(0x050a1c), 0, 0, 0), 0, 3.7, -4.3);
    add(mesh(new THREE.PlaneGeometry(14, 6.4), led(backTex)), 0, 3.7, -4.18);
    // a red band of light that slides across the LED wall
    const sweepTex = canvasTex(256, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(255,40,60,0)'); gr.addColorStop(0.5, 'rgba(255,40,60,0.9)'); gr.addColorStop(1, 'rgba(255,40,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    sweepTex.wrapS = THREE.RepeatWrapping;
    sweepTex.repeat.set(0.35, 1);
    stageAnim.sweep = sweepTex;
    add(mesh(new THREE.PlaneGeometry(14, 6.4), new THREE.MeshBasicMaterial({ map: sweepTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })), 0, 3.7, -4.12);
    const sideTex = canvasTex(128, 512, (g, w, h) => { g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; for (let i = 0; i < 6; i++) starPath(g, w / 2, 50 + i * 80, 24); g.fillStyle = '#c8102e'; g.fillRect(0, h - 30, w, 30); });
    for (const s of [-1, 1]) add(mesh(new THREE.PlaneGeometry(2.0, 6.4), led(sideTex)), s * 8.6, 3.7, -4.18);

    // LED sign above the backdrop
    add(box(5.4, 2.0, 0.12, mat(0x05070d), 0, 0, 0), 0, 8.6, -4.25);
    add(mesh(new THREE.PlaneGeometry(5.2, 1.95), ledLogoMat), 0, 8.6, -4.17);

    // truss, spotlights and light beams
    add(box(17, 0.22, 0.22, mat(0x20232b), 0, 0, 0), 0, 7.1, -1.3);
    for (const s of [-1, 1]) add(box(0.22, 7.2, 0.22, mat(0x20232b), 0, 0, 0), s * 8.4, 3.6, -1.3);
    const beamGeo = new THREE.ConeGeometry(1.3, 6.5, 14, 1, true);
    beamGeo.translate(0, -3.25, 0);   // apex at the origin, so each red beam swings from its lamp
    for (let i = 0; i < 7; i++) {
      const x = -7.2 + i * 2.4;
      add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.5, 8), mat(0x15181f)), x, 6.85, -1.3);
      add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), new THREE.MeshBasicMaterial({ color: 0xff6a73 })), x, 6.59, -1.3);
      const bm = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const pivot = new THREE.Group();
      pivot.position.set(x, 6.58, -1.3);
      pivot.add(new THREE.Mesh(beamGeo, bm));
      stage.add(pivot);
      stageAnim.beams.push({ pivot, mat: bm, phase: i * 0.9 });
    }
    const key = new THREE.SpotLight(0xfff0d8, 700, 40, 0.5, 0.6, 2);
    key.position.set(-1.5, 8, 6); key.target.position.set(-0.6, 1.5, 0.6);
    const washL = new THREE.PointLight(0xff2233, 120, 22, 2), washR = new THREE.PointLight(0xff2233, 120, 22, 2);
    washL.position.set(-6.5, 4, 2); washR.position.set(6.5, 4, 2);
    stage.add(key, key.target, washL, washR);
    stageAnim.washes.push(washL, washR);

    // lectern with microphones
    const lecternTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#c8102e'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, 'FIGHTING TAXES', w - 24, 40); g.fillText('FIGHTING TAXES', w / 2, h / 2); });
    add(mesh(new THREE.BoxGeometry(1.5, 1.7, 0.8), mat(0x1a2a5c)), 0.3, 0.85, -1.5);
    add(mesh(new THREE.PlaneGeometry(1.0, 0.5), led(lecternTex)), 0.3, 1.0, -1.09);
    for (const s of [-1, 1]) {
      add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), mat(0x111111)), 0.3 + s * 0.22, 2.0, -1.4).rotation.z = -s * 0.15;
      add(mesh(new THREE.SphereGeometry(0.05, 5, 4), mat(0x222222)), 0.3 + s * 0.28, 2.3, -1.4);
    }

    // flags
    const flagTex = canvasTex(160, 100, (g, w, h) => { g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d4a017'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#fff'; starPath(g, w / 2, h / 2, 30); });
    for (const s of [-1, 1]) {
      add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 5, 6), mat(0xb8bcc7)), s * 6.6, 2.5, -2.6);
      stageAnim.flags.push(add(mesh(new THREE.PlaneGeometry(1.7, 1.06), led(flagTex)), s * 6.6 - s * 0.85, 4.4, -2.6));
    }

    // the sign next to Angus
    const signTex = canvasTex(512, 320, (g, w, h) => {
      g.fillStyle = '#1d4fb8'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d4a017'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
      g.fillStyle = '#ffffff'; for (let i = 0; i < 5; i++) starPath(g, 96 + i * 80, 50, 15);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      fit(g, 'FANTASTIC', w - 70, 96); g.fillText('FANTASTIC', w / 2, h * 0.38);
      fit(g, 'GREAT MOVE', w - 70, 92); g.fillText('GREAT MOVE', w / 2, h * 0.68);
      g.fillStyle = '#c8102e'; g.fillRect(70, h * 0.84, w - 140, 12);
    });
    const sign = new THREE.Group();
    sign.position.set(2.5, 0, 0.3); sign.rotation.y = 0.2;
    for (const s of [-1, 1]) sign.add(box(0.09, 1.3, 0.09, mat(0x8a8f99), s * 0.9, 0.65, -0.05));
    const boardM = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.5 });
    const board = mesh(new THREE.BoxGeometry(2.8, 1.75, 0.1), boardM);
    board.position.y = 2.15;
    sign.add(board);
    stage.add(sign);

    // audience: dark silhouettes in the foreground, a few in red caps
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const dark = mat(0x0a1024), cap = mat(0xc8102e);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let row = 0; row < 2; row++) for (let i = 0; i < 20; i++) {
      const x = -9.5 + i * 1.0 + rnd() * 0.4, z = 5.2 + row * 1.5, y = 0.5 + row * 0.15 + rnd() * 0.1;
      const person = new THREE.Group();
      const head = mesh(new THREE.SphereGeometry(0.24, 6, 5), dark);
      head.position.y = 0.45;
      person.add(head, box(0.62, 0.55, 0.38, dark, 0, 0, 0));
      if (rnd() < 0.22) person.add(box(0.3, 0.1, 0.3, cap, 0, 0.66, 0));
      add(person, x, y, z);
      stageAnim.crowd.push({ person, y0: y, phase: rnd() * 6.28 });
      if (rnd() < 0.18) {   // camera flashes in the crowd
        const f = add(mesh(new THREE.SphereGeometry(0.07, 5, 4), flashMat), x + 0.3, y + 0.85, z + 0.2);
        f.visible = false;
        stageAnim.flashes.push({ f, phase: rnd() * 10 });
      }
    }
  }
  scene.add(stage);
  const SKY_BG = scene.background, SKY_FOG = scene.fog, STAGE_BG = new THREE.Color(0x140a1a);
  function stageMode(on) {
    stage.visible = on;
    scene.background = on ? STAGE_BG : SKY_BG;
    scene.fog = on ? null : SKY_FOG;
    for (const l of scene.children) if (l.isLight) { l.userData.base ??= l.intensity; l.intensity = l.userData.base * (on ? 0.7 : 1); }
  }
  function stageAnimate() {
    const t = performance.now() / 1000;
    for (const b of stageAnim.beams) {   // red beams sweep around and pulse
      b.pivot.rotation.z = Math.sin(t * 0.4 + b.phase) * 0.55;
      b.pivot.rotation.x = Math.sin(t * 0.3 + b.phase * 1.7) * 0.35;
      b.mat.opacity = 0.07 + 0.06 * (Math.sin(t * 1.0 + b.phase * 2) * 0.5 + 0.5);
    }
    stageAnim.sweep.offset.x = (t * 0.05) % 1;   // the red band slides across the LED wall
    stageAnim.washes.forEach((l, i) => { l.intensity = 120 + Math.sin(t * 1.2 + i * Math.PI) * 55; });   // the side lights pulse in turn
    for (const c of stageAnim.crowd) c.person.position.y = c.y0 + Math.max(0, Math.sin(t * 3.2 + c.phase)) * 0.07;   // the crowd bounces
    for (const f of stageAnim.flashes) f.f.visible = Math.sin(t * 11 + f.phase * 7) + Math.sin(t * 6.3 + f.phase) > 1.75;
    stageAnim.flags.forEach((fl, i) => { fl.rotation.y = Math.sin(t * 2.2 + i * 2) * 0.18; });
  }
  function menuCamera() {
    stageAnimate();
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = THREE.MathUtils.clamp(8 / (2 * half * camera.aspect), 9, 18);
    // On wide screens the menu card sits on the right, so slide the stage left to keep Angus in view.
    const shift = THREE.MathUtils.clamp((camera.aspect - 1.25) * 3.2, 0, 3.4);
    const sway = Math.sin(performance.now() / 4000) * 0.35;
    const lift = camera.aspect < 0.9 ? 1.9 : 0;   // portrait phones: the card covers the lower half, so raise the stage into the top half
    camera.position.set(STAGE.x + sway + shift, STAGE.y + 2.1, STAGE.z + dist);
    camera.lookAt(STAGE.x + shift, STAGE.y + 1.5 - lift, STAGE.z);
  }
  stageMode(true);

  /** Scroll the road, arches and confetti with the world. `move` is the distance run this step, `tt` is wall-clock seconds. */
  function scroll(move, tt, dist, dt) {
    roadTex.offset.y = (dist / 10) % 1;
    ledLogoMat.color.setScalar(0.8 + 0.2 * (Math.sin(tt * 1.5) * 0.5 + 0.5));   // the LED signs glow gently
    const cp = confetti.geometry.attributes.position;   // confetti falls, drifts and scrolls with the world
    for (let i = 0; i < CONF_N; i++) {
      let y = cp.getY(i) - 1.1 * dt, z = cp.getZ(i) + move;
      if (y < 0) y = 9;
      if (z > 12) z -= 80;
      cp.setXYZ(i, cp.getX(i) + Math.sin(tt * 1.5 + i) * 0.4 * dt, y, z);
    }
    cp.needsUpdate = true;
    for (const a of arches) {   // the truss arches scroll past, and their red beams sweep and pulse
      a.position.z += move;
      if (a.position.z > 14) a.position.z -= ARCH_N * ARCH_STEP;
      for (const b of a.userData.beams) {
        b.pivot.rotation.z = Math.sin(tt * 0.5 + b.phase) * 0.5;
        b.pivot.rotation.x = Math.sin(tt * 0.38 + b.phase * 1.6) * 0.35;
        b.mat.opacity = 0.08 + 0.07 * (Math.sin(tt * 1.1 + b.phase * 2) * 0.5 + 0.5);
        b.pool.position.set(b.x + Math.tan(b.pivot.rotation.z) * 6.7, 0.04, -Math.tan(b.pivot.rotation.x) * 6.7);
      }
      const ph = Math.floor(tt * 3);   // chasing bulbs
      a.userData.bulbs.forEach((bulb, j) => { const m = (j + ph) % 4; bulb.material = m === 0 ? arches.mats.on : m === 1 ? arches.mats.red : arches.mats.off; });
    }
  }

  return { T, scroll, stage, stageMode, stageAnimate, menuCamera };
}
