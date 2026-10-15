// The world around the road: road and stage floor, templates cloned for scenery and obstacles,
// truss arches with sweeping beams, confetti, and the menu stage Angus stands on.
import { THREE, mat, mesh, box, canvasTex, signTex, rand, pick, mergeGeos, mergeTree, blobShadow, TEX_SCALE, MAX_ANISOTROPY } from './gfx.js';

/** The menu stage lives high above the road so nothing from the game shows through. */
export const STAGE = { x: 0, y: 200, z: 0 };

export function createWorld({ scene, camera }) {
  /* ---------- road & sky-side props ---------- */
  const roadTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = '#1550d6';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6ebff';
    g.fillRect(4, 0, 6, h);
    g.fillRect(w - 10, 0, 6, h);
    g.fillRect(44, 0, 4, h / 2);     // dashed lane line, top half of each tile
    g.fillRect(80, 0, 4, h / 2);
  });
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  roadTex.repeat.set(1, 20);

  const road = mesh(
    new THREE.PlaneGeometry(8, 200).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.16, metalness: 0.35 })   // wet asphalt: the lights glint off it
  );
  road.position.set(0, 0, -60);
  road.castShadow = false;
  scene.add(road);

  // Black stage floor either side of the road.
  const grassMat = new THREE.MeshLambertMaterial({ color: 0x141c30, flatShading: true });
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
    // the tax stack: a pile of paper, each bundle a little crooked, with a TAX DUE! plate and a red stamp on top
    const taxStack = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const layer = box(1.5 - (i % 2) * 0.1, 0.4, 0.9, paper, (((i * 7) % 5) - 2) * 0.03, 0.2 + i * 0.4, 0);
      layer.rotation.y = (((i * 3) % 5) - 2) * 0.025;
      taxStack.add(layer);
    }
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), taxSign);
    plate.position.set(0, 1.0, 0.47);
    plate.castShadow = true;
    taxStack.add(plate, box(0.5, 0.1, 0.5, red, 0, 2.05, 0));
    taxStack.add(blobShadow(1.1, 0.75, 0.45));
    T.tax = taxStack;

    const tapeSign = new THREE.MeshStandardMaterial({ map: signTex(['RED TAPE'], '#c40f1b', '#ffffff', 512, 128), roughness: 0.6 });
    // the red-tape barrier: two posts with a pair of striped caution-tape bands and a RED TAPE plate between them
    const stripeTex = canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = '#c40f1b'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      for (let x = -h; x < w + h; x += 48) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 24, h); g.lineTo(x + 24 + h, 0); g.lineTo(x + h, 0); g.closePath(); g.fill(); }
    });
    const stripeMat = new THREE.MeshStandardMaterial({ map: stripeTex, roughness: 0.5 });
    const postMat = mat(0x2a2f3a, { roughness: 0.5, metalness: 0.3 });
    const tapeBarrier = new THREE.Group();
    for (const sx of [-1, 1]) { const post = mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.95, 8), postMat); post.position.set(sx * 1.15, 0.475, 0); tapeBarrier.add(post); }
    for (const by of [0.34, 0.68]) { const band = mesh(new THREE.BoxGeometry(2.3, 0.22, 0.1), stripeMat); band.position.set(0, by, 0); tapeBarrier.add(band); }
    const tapePlate = mesh(new THREE.BoxGeometry(1.0, 0.3, 0.04), tapeSign);
    tapePlate.position.set(0, 0.51, 0.08);
    tapeBarrier.add(tapePlate);
    tapeBarrier.add(blobShadow(1.35, 0.45, 0.35));
    T.tape = tapeBarrier;

    // the tax cut: a spinning green coin with a falling-percentage mark
    const coinFace = new THREE.MeshStandardMaterial({ map: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#1f9d55'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#8df2b0'; g.lineWidth = 7; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 10, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 62px system-ui, sans-serif'; g.fillText('%', w / 2, h / 2 + 8);
      g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w / 2, 34); g.moveTo(w / 2 - 9, 27); g.lineTo(w / 2, 37); g.lineTo(w / 2 + 9, 27); g.stroke();   // a down arrow
    }), roughness: 0.35, metalness: 0.3, emissive: 0x0b4a25 });
    const coinEdge = new THREE.MeshStandardMaterial({ color: 0x14733f, emissive: 0x0b4a25, side: THREE.DoubleSide });
    const coinFront = mesh(new THREE.CircleGeometry(0.55, 28), coinFace), coinBack = mesh(new THREE.CircleGeometry(0.55, 28), coinFace);
    coinFront.position.z = 0.065;
    coinBack.position.z = -0.065; coinBack.rotation.y = Math.PI;
    const coinRim = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.13, 28, 1, true).rotateX(Math.PI / 2), coinEdge);
    T.taxCut = new THREE.Group();
    T.taxCut.add(coinFront, coinBack, coinRim);
    for (const c of T.taxCut.children) c.castShadow = false;

    // a golden SURPLUS tax cut, worth ten
    const goldMat = mat(0xd4a017, { emissive: 0x6b4a00 });
    const goldSign = new THREE.MeshStandardMaterial({ map: signTex(['SURPLUS!'], '#d4a017', '#3a2a00', 256, 128), roughness: 0.4, emissive: 0x6b4a00 });
    T.goldCut = mesh(new THREE.BoxGeometry(1.25, 0.7, 0.12), [goldMat, goldMat, goldMat, goldMat, goldSign, goldMat]);
    T.goldCut.castShadow = false;

    // power-ups: ceremonial scissors (cut through hazards) and a consultant (takes the blame for one hit)
    const glowDisc = (color) => { const d = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.04, 16).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false })); return d; };
    const steelP = mat(0xcfd6df, { roughness: 0.25, metalness: 0.4 });
    const sciss = new THREE.Group();
    for (const sx of [-1, 1]) {
      const bl = box(0.12, 1.2, 0.05, steelP, 0, 0.25, 0);
      bl.rotation.z = sx * 0.35;
      const ring = mesh(new THREE.TorusGeometry(0.2, 0.05, 6, 10), mat(0xd7141f));
      ring.position.set(sx * 0.3, -0.45, 0);
      sciss.add(bl, ring);
    }
    sciss.add(glowDisc(0xff6a73));
    T.scissorsPickup = sciss;
    const consult = new THREE.Group();
    consult.add(box(0.9, 0.62, 0.28, mat(0x6b3f1f, { roughness: 0.5 }), 0, 0, 0), box(0.3, 0.12, 0.3, mat(0x2a1a0e), 0, 0.37, 0), box(0.12, 0.1, 0.3, mat(0xd4a017), 0, 0.02, 0.02), glowDisc(0x4d8dff));
    T.consultant = consult;

    // tape orbs: glowing red orbs trailing a ribbon of red tape. On a hit the tape wraps him and throws him.
    const orb = new THREE.Group();
    orb.add(mesh(new THREE.SphereGeometry(0.46, 12, 9), new THREE.MeshBasicMaterial({ color: 0xff2a3a })));
    orb.add(mesh(new THREE.SphereGeometry(0.26, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffffff })));   // hot white core, so it stands out from the red lights
    const ribbon = new THREE.MeshBasicMaterial({ color: 0xff4455, side: THREE.DoubleSide });
    orb.add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 5).rotateX(-Math.PI / 2).translate(0, 0, -3), ribbon));   // the ribbon of tape behind it
    orb.add(new THREE.Mesh(new THREE.PlaneGeometry(0.34, 5).rotateX(-Math.PI / 2).rotateZ(Math.PI / 2).translate(0, 0, -3), ribbon));   // a second strand, crossed with the first, so the spin reads as twisting tape
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
    const ledRed = new THREE.MeshBasicMaterial({ color: 0x3b82ff });   // (LED strips and searchlights are blue now)
    T.buildings = [4, 6, 9, 12].map((h) => {
      const p = new THREE.Group();
      p.add(mesh(new THREE.BoxGeometry(3, h, 3).translate(0, h / 2, 0), mat(pick([0x2a2f44, 0x2a3550, 0x26303f]), { emissive: 0x0a1a5a })));
      p.add(box(0.18, h * 0.9, 0.06, ledRed, -0.8, h / 2, 1.52), box(0.18, h * 0.9, 0.06, ledRed, 0.8, h / 2, 1.52));
      return p;
    });

    const tree = new THREE.Group();   // a searchlight stand with a red beam shooting up
    tree.add(box(0.25, 3.6, 0.25, mat(0x20232b), 0, 1.8, 0));
    tree.add(mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.6, 8), mat(0x15181f)), mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 8), ledRed));
    tree.children[1].position.y = 3.9; tree.children[2].position.y = 4.2;
    const spot = new THREE.Mesh(new THREE.ConeGeometry(0.9, 10, 10, 1, true).translate(0, 5, 0), new THREE.MeshBasicMaterial({ color: 0x2a6aff, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    spot.position.y = 4.2; spot.rotation.z = 0.25;
    tree.add(spot);
    T.tree = tree;

    const makeScreen = (line1, line2) => {   // an LED screen on legs
      const tex = canvasTex(512, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0a2a78'); gr.addColorStop(1, '#14409e');
        g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.fillStyle = '#c8102e'; g.fillRect(0, h - 70, w, 44); g.fillStyle = '#ffffff'; g.fillRect(0, h - 26, w, 8);
        g.textAlign = 'center'; g.textBaseline = 'middle';
        for (const [text, y, color, size] of [[line1, h * 0.3, '#ffffff', 78], [line2, h * 0.62, '#ffffff', 62]]) {
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
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.75, h = 0.9 + ((i * 7) % 3) * 0.1;
      crowd.add(box(0.6, h, 0.4, darkMat, x, h / 2, 0));
      const head = mesh(new THREE.SphereGeometry(0.25, 6, 5), darkMat);
      head.position.set(x, h + 0.2, 0);
      crowd.add(head);
      if (i % 2 === 0) crowd.add(box(0.3, 0.1, 0.3, mat(i === 0 ? 0xc8102e : 0x1f4fb8), x, h + 0.42, 0));
      if (i % 3 === 1) crowd.add(box(0.12, 0.6, 0.12, darkMat, x + 0.35, h + 0.3, 0));
    }
    T.crowd = crowd;
    T.billboards = [['VOTE', '#1f4fb8', '#ffffff'], ['POLICY', '#ffffff', '#1f4fb8'], ['BALLOT', '#0b2f86', '#ffffff']].map(([text, bg, fg]) => {
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
  // fewer draw calls: bake each template's rigid parts into a handful of meshes
  for (const t of Object.values(T).flat()) if (t && t.isGroup) mergeTree(t);

  /* ---------- LED "LIBERAL" signs ---------- */
  // A plain wordmark in an LED dot-matrix style. To use an official logo image you have the right
  // to use, set window.LED_LOGO = "data:image/png;base64,..." (or an image URL) before this script runs.
  function ledLogoTex() {
    const LW = 512, LH = 192;
    const draw = (g, img) => {
      g.fillStyle = '#0b2f86'; g.fillRect(0, 0, LW, LH);
      g.strokeStyle = '#8fb4ff'; g.lineWidth = 8; g.strokeRect(4, 4, LW - 8, LH - 8);
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
    c.width = LW * TEX_SCALE; c.height = LH * TEX_SCALE;
    const g = c.getContext('2d');
    g.scale(TEX_SCALE, TEX_SCALE);
    draw(g, null);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = MAX_ANISOTROPY;
    if (window.LED_LOGO) {
      const img = new Image();
      img.onload = () => { draw(g, img); tex.needsUpdate = true; };
      img.src = window.LED_LOGO;
    }
    return tex;
  }
  const ledLogoMat = new THREE.MeshBasicMaterial({ map: ledLogoTex() });

  /* ---------- confetti drifting through the lights ---------- */
  const CONF_N = 40;
  const dotTex = canvasTex(32, 32, (g, w, h) => {   // a soft round dot for every particle
    const gr = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const confetti = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 0.22, map: dotTex, vertexColors: true, transparent: true, depthWrite: false }));
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
    confetti.visible = false;   // no drifting dots: they added to the clutter
  }

  /* ---------- the horizon: a huge LED stage wall with a crowd in front of it (not fogged, so it glows through the haze) ---------- */
  const horizonSweep = canvasTex(256, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, 'rgba(70,130,255,0)'); gr.addColorStop(0.5, 'rgba(70,130,255,0.8)'); gr.addColorStop(1, 'rgba(70,130,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  horizonSweep.wrapS = THREE.RepeatWrapping;
  horizonSweep.repeat.set(0.3, 1);
  {
    const tex = canvasTex(1024, 400, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#0a2a78'); gr.addColorStop(1, '#14409e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
      for (let x = 0; x < w; x += 8) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      g.fillStyle = '#c8102e'; g.fillRect(0, h - 90, w, 56); g.fillStyle = '#ffffff'; g.fillRect(0, h - 34, w, 10);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff'; g.font = '900 150px system-ui, sans-serif';
      g.fillText('FIGHTING TAXES', w / 2, h * 0.38);
      g.fillStyle = '#ffffff'; g.font = '900 64px system-ui, sans-serif'; g.fillText('TAX CUTS NOW', w / 2, h * 0.68);
    });
    const wall = new THREE.Group();
    wall.position.set(0, 0, -112);
    const screenM = new THREE.Mesh(new THREE.PlaneGeometry(64, 25), new THREE.MeshBasicMaterial({ map: tex, fog: false }));
    screenM.position.y = 14;
    const sweepM = new THREE.Mesh(new THREE.PlaneGeometry(64, 25), new THREE.MeshBasicMaterial({ map: horizonSweep, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6, fog: false }));
    sweepM.position.set(0, 14, 0.05);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(66, 27, 0.4), new THREE.MeshBasicMaterial({ color: 0x05070d, fog: false }));
    frame.position.set(0, 14, -0.3);
    wall.add(screenM, sweepM, frame);
    const crowdM = new THREE.MeshBasicMaterial({ color: 0x07091a, fog: false });   // a silhouette crowd in front of the wall
    const crowdGeos = [];
    for (let i = 0; i < 26; i++) {
      const x = -30 + i * 2.4 + ((i * 7) % 5) * 0.2;
      crowdGeos.push(new THREE.BoxGeometry(1.6, 2.2, 1.0).translate(x, 1.1, 6), new THREE.SphereGeometry(0.7, 6, 5).translate(x, 2.8, 6));
    }
    wall.add(new THREE.Mesh(mergeGeos(crowdGeos), crowdM));   // the whole crowd is a single mesh
    scene.add(wall);
  }

  /* ---------- wet-road reflections: every light throws a long glowing streak towards the camera ---------- */
  // Flat additive strips lying on the road, bright at the light and fading towards the viewer, softer at the sides.
  const reflTex = canvasTex(32, 128, (g, w, h) => {
    const v = g.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(255,255,255,1)'); v.addColorStop(0.15, 'rgba(255,255,255,0.7)'); v.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';   // soften the sides
    const hz = g.createLinearGradient(0, 0, w, 0);
    hz.addColorStop(0, 'rgba(0,0,0,0)'); hz.addColorStop(0.5, 'rgba(0,0,0,1)'); hz.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = hz; g.fillRect(0, 0, w, h);
  });
  const reflMats = { red: 0x4aa8ff, blue: 0x3d7bff, white: 0xcfe0ff }, reflBase = { red: 0.55, blue: 0.55, white: 0.4 };
  for (const k in reflMats) reflMats[k] = new THREE.MeshBasicMaterial({ map: reflTex, color: reflMats[k], transparent: true, opacity: reflBase[k], blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const reflGeo = (w, len) => new THREE.PlaneGeometry(w, len).rotateX(-Math.PI / 2).translate(0, 0, len / 2);   // runs from the light (z = 0) towards the camera
  function reflection(parent, kind, x, z, w, len) {
    const m = new THREE.Mesh(reflGeo(w, len), reflMats[kind]);
    m.position.set(x, 0.045, z);
    m.userData.keep = true;
    m.renderOrder = 2;
    parent.add(m);
    return m;
  }

  /* ---------- glowing edge lights that scroll past, so you can feel the speed ---------- */
  const edgeGroup = new THREE.Group();
  {
    const mats = [new THREE.MeshBasicMaterial({ color: 0x4aa8ff }), new THREE.MeshBasicMaterial({ color: 0xe8eeff })];
    const geos = [[], []];
    for (let i = 0; i < 16; i++) for (const sx of [-1, 1]) geos[i % 2].push(new THREE.BoxGeometry(0.16, 0.16, 3).translate(sx * 4.6, 0.12, 20 - i * 10));
    for (let k = 0; k < 2; k++) edgeGroup.add(new THREE.Mesh(mergeGeos(geos[k]), mats[k]));
    for (let i = 0; i < 16; i++) for (const sx of [-1, 1]) reflection(edgeGroup, i % 2 ? 'white' : 'red', sx * 3.75, 20 - i * 10 - 1.5, 0.7, 4.5);   // the kerb lights glinting on the wet road
    scene.add(edgeGroup);
  }

  /* ---------- tall alley walls with lit windows, to give the scene depth ---------- */
  const alleyWalls = [];
  {
    const wallTex = canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#141a24'; g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 16) {
        g.fillStyle = 'rgba(255,255,255,0.045)';
        for (let x = (y / 16) % 2 ? 0 : 20; x < w; x += 40) g.fillRect(x, y + 1, 38, 14);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h - 24, w, 24);   // darker at the bottom, as if it were wet
      let seed = 5; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let gx = 0; gx < 8; gx++) for (let gy = 0; gy < 5; gy++) {   // lit windows
        const x = gx * 64 + 14, y = gy * 48 + 14, v = r();
        if (v < 0.42) { g.fillStyle = v < 0.07 ? '#dbe8ff' : v < 0.12 ? '#4f93ff' : v < 0.2 ? '#5ab4ff' : '#9ec5ff'; g.fillRect(x, y, 30, 22); g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + 14, y, 2, 22); g.fillRect(x, y + 10, 30, 2); }
      }
      g.fillStyle = '#3d8bff'; g.fillRect(40, 238, 150, 5);   // a neon strip
    });
    for (const sx of [-1, 1]) {
      const albedo = wallTex.clone(), glow = albedo;   // (one texture now; `glow` is kept as an alias so scrolling stays one line)
      albedo.wrapS = THREE.RepeatWrapping;
      albedo.repeat.set(6, 1);
      albedo.needsUpdate = true;
      const wall = new THREE.Mesh(new THREE.PlaneGeometry(150, 24), new THREE.MeshBasicMaterial({ map: albedo }));   // unlit: it is a dark wall with lit windows, and it fills a big part of the screen
      wall.rotation.y = -sx * Math.PI / 2;
      wall.position.set(sx * 15, 12, -50);
      scene.add(wall);
      alleyWalls.push({ albedo, glow, sx });
    }
  }

  /* ---------- truss arches over the road, with sweeping red beams ---------- */
  const ARCH_N = 5, ARCH_STEP = 24, BULBS = 9;
  const arches = [];
  let bulbGeo = null, glow = null, lastBulbPhase = -1;
  const BULB_COLS = [[0.72, 0.85, 1], [0.2, 0.55, 1], [0.1, 0.16, 0.3], [0.1, 0.16, 0.3]];   // pale pink, red, then dark: the chase pattern
  function setBulbs(ph) {
    const c = bulbGeo.attributes.color;
    for (let j = 0; j < BULBS; j++) { const col = BULB_COLS[(j + ph) % 4]; for (let v = 0; v < 24; v++) c.setXYZ(j * 24 + v, col[0], col[1], col[2]); }
    c.needsUpdate = true;
  }
  {
    const trussMat = mat(0x1b1d26), can = mat(0x15181f);
    // the chasing bulbs along each arch: one mesh with a colour per bulb, shared by every arch (so setBulbs recolours them all)
    bulbGeo = (() => {
      const parts = [];
      for (let j = 0; j < BULBS; j++) parts.push(new THREE.BoxGeometry(0.22, 0.22, 0.22).translate(-5.5 + j * (11 / (BULBS - 1)), 7.45, 0));
      const g = mergeGeos(parts);
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
      return g;
    })();
    const bulbVC = new THREE.MeshBasicMaterial({ vertexColors: true });
    const bannerTex = canvasTex(130, 300, (g, w, h) => {
      g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#8fb4ff'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
      g.fillStyle = '#ffffff'; g.beginPath();
      for (let i = 0; i < 10; i++) { const ang = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 17 : 40; g.lineTo(w / 2 + Math.cos(ang) * r, 90 + Math.sin(ang) * r); }
      g.closePath(); g.fill();
      g.fillStyle = '#c8102e'; g.fillRect(14, 180, w - 28, 70);
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 26px system-ui, sans-serif'; g.fillText('TAX', w / 2, 200); g.fillText('CUTS', w / 2, 232);
    });
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide });
    const lens = new THREE.MeshBasicMaterial({ color: 0x6aa8ff });
    const beamGeo = new THREE.ConeGeometry(1.1, 7, 12, 1, true).translate(0, -3.5, 0);   // apex at the origin so the beam swings from its lamp
    for (let i = 0; i < ARCH_N; i++) {
      const a = new THREE.Group();
      a.position.z = -8 - i * ARCH_STEP;
      for (const sx of [-1, 1]) a.add(box(0.3, 7.3, 0.3, trussMat, sx * 5.6, 3.65, 0));
      a.add(box(11.6, 0.3, 0.3, trussMat, 0, 7.2, 0));
      a.userData.beams = [];
      const bulbs = new THREE.Mesh(bulbGeo, bulbVC);   // a row of chasing lights along the top bar
      bulbs.userData.keep = true;
      a.add(bulbs);
      for (const sx of [-1, 1]) {   // banners hung on the pylons
        const ban = mesh(new THREE.PlaneGeometry(1.3, 3), bannerMat);
        ban.position.set(sx * 5.0, 4.3, 0.2);
        a.add(ban);
      }
      a.add(box(3.6, 1.45, 0.1, mat(0x05070d), 0, 8.4, -0.06));   // LED sign on top of each arch
      const ledSign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.275), ledLogoMat);
      ledSign.position.set(0, 8.4, 0.02);
      a.add(ledSign);
      for (const [k, x] of [-3, 3].entries()) {
        const housing = mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.45, 8), can);
        housing.position.set(x, 7.0, 0);
        const l = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), lens);
        l.position.set(x, 6.76, 0);
        const bm = new THREE.MeshBasicMaterial({ color: [0x2aa0ff, 0x2a6aff][k], transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        const pivot = new THREE.Group();
        pivot.position.set(x, 6.75, 0);
        pivot.add(new THREE.Mesh(beamGeo, bm));
        a.add(housing, l, pivot);
        const pm = bm.clone();   // the spot of light this beam throws on the floor
        pm.opacity = 0.3;
        const pool = new THREE.Mesh(new THREE.CircleGeometry(1.0, 20).rotateX(-Math.PI / 2), pm);
        pool.userData.keep = true;   // it moves on its own, so it isn't baked in
        pool.position.set(x, 0.04, 0);
        a.add(pool);
        a.userData.beams.push({ pivot, mat: bm, phase: i * 1.3 + k * 2.1, x, pool });
      }
      a.userData.refl = [
        reflection(a, 'blue', 0, 0, 6.2, 11),               // the chasing bulb bar and LED sign
        reflection(a, 'red', -3, 0, 1.6, 12),               // the red lamp
        reflection(a, 'blue', 3, 0, 1.6, 12),               // the blue lamp
        reflection(a, 'white', -5.0, 0, 0.9, 9), reflection(a, 'white', 5.0, 0, 0.9, 9),   // the banners
      ];
      mergeTree(a);   // the truss, lamp housings, lenses, sign and banners become a handful of meshes
      scene.add(a);
      arches.push(a);
    }
    glow = new THREE.PointLight(0x2a6aff, 120, 18, 2);   // a blue glow over the runner (it follows him to the stage)
    glow.position.set(0, 5.5, 3);
    scene.add(glow);
    setBulbs(0);
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
    add(box(18, 0.07, 0.07, new THREE.MeshBasicMaterial({ color: 0x2a6aff }), 0, 0, 0), 0, 0.02, 3.95);
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
      fit(g, 'TAX CUTS NOW', w - 200, 70); g.fillStyle = '#ffffff'; g.fillText('TAX CUTS NOW', w / 2, h * 0.68);
    });
    add(box(14.6, 6.9, 0.2, mat(0x050a1c), 0, 0, 0), 0, 3.7, -4.3);
    add(mesh(new THREE.PlaneGeometry(14, 6.4), led(backTex)), 0, 3.7, -4.18);
    // a red band of light that slides across the LED wall
    const sweepTex = canvasTex(256, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(60,120,255,0)'); gr.addColorStop(0.5, 'rgba(60,120,255,0.9)'); gr.addColorStop(1, 'rgba(60,120,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    sweepTex.wrapS = THREE.RepeatWrapping;
    sweepTex.repeat.set(0.35, 1);
    stageAnim.sweep = sweepTex;
    add(mesh(new THREE.PlaneGeometry(14, 6.4), new THREE.MeshBasicMaterial({ map: sweepTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 })), 0, 3.7, -4.12);
    const sideTex = canvasTex(128, 512, (g, w, h) => { g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; for (let i = 0; i < 6; i++) starPath(g, w / 2, 50 + i * 80, 24); g.fillStyle = '#2f6bff'; g.fillRect(0, h - 30, w, 30); });
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
      add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8), new THREE.MeshBasicMaterial({ color: 0x6aa8ff })), x, 6.59, -1.3);
      const bm = new THREE.MeshBasicMaterial({ color: 0x2a6aff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
      const pivot = new THREE.Group();
      pivot.position.set(x, 6.58, -1.3);
      pivot.add(new THREE.Mesh(beamGeo, bm));
      stage.add(pivot);
      stageAnim.beams.push({ pivot, mat: bm, phase: i * 0.9 });
    }
    // soft red glows at the sides (flat additive sprites, not real lights, so the light count never changes and nothing recompiles)
    const washTex = canvasTex(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      gr.addColorStop(0, 'rgba(70,130,255,0.9)'); gr.addColorStop(1, 'rgba(50,110,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    for (const sx of [-1, 1]) {
      const wash = new THREE.Sprite(new THREE.SpriteMaterial({ map: washTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45 }));
      wash.scale.set(10, 10, 1);
      add(wash, sx * 6.5, 4, -2.5);
      stageAnim.washes.push(wash);
    }

    // lectern with microphones
    const lecternTex = canvasTex(256, 128, (g, w, h) => { g.fillStyle = '#2f6bff'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; fit(g, 'FIGHTING TAXES', w - 24, 40); g.fillText('FIGHTING TAXES', w / 2, h / 2); });
    add(mesh(new THREE.BoxGeometry(1.5, 1.7, 0.8), mat(0x1a2a5c)), 0.3, 0.85, -1.5);
    add(mesh(new THREE.PlaneGeometry(1.0, 0.5), led(lecternTex)), 0.3, 1.0, -1.09);
    for (const s of [-1, 1]) {
      add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 5), mat(0x111111)), 0.3 + s * 0.22, 2.0, -1.4).rotation.z = -s * 0.15;
      add(mesh(new THREE.SphereGeometry(0.05, 5, 4), mat(0x222222)), 0.3 + s * 0.28, 2.3, -1.4);
    }

    // flags
    const flagTex = canvasTex(160, 100, (g, w, h) => { g.fillStyle = '#0b2f86'; g.fillRect(0, 0, w, h); g.strokeStyle = '#ffffff'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6); g.fillStyle = '#fff'; starPath(g, w / 2, h / 2, 30); });
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
    const dark = mat(0x0a1024), cap = mat(0x1f4fb8), capRed = mat(0xc8102e);
    const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    for (let row = 0; row < 2; row++) for (let i = 0; i < 20; i++) {
      const x = -9.5 + i * 1.0 + rnd() * 0.4, z = 5.2 + row * 1.5, y = 0.5 + row * 0.15 + rnd() * 0.1;
      const person = new THREE.Group();
      const head = mesh(new THREE.SphereGeometry(0.24, 6, 5), dark);
      head.position.y = 0.45;
      person.add(head, box(0.62, 0.55, 0.38, dark, 0, 0, 0));
      if (rnd() < 0.3) person.add(box(0.3, 0.1, 0.3, rnd() < 0.5 ? cap : capRed, 0, 0.66, 0));
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
  const FOG_NEAR = scene.fog ? scene.fog.near : 45, FOG_FAR = scene.fog ? scene.fog.far : 130;   // the road's own fog, restored when leaving the stage
  const SKY_BG = scene.background, STAGE_BG = new THREE.Color(0x0a1020);
  const GLOW_ROAD = { y: 5.5, z: 3, i: 120 };
  function stageMode(on) {
    stage.visible = on;
    scene.background = on ? STAGE_BG : SKY_BG;
    if (scene.fog) { scene.fog.near = on ? 400 : FOG_NEAR; scene.fog.far = on ? 900 : FOG_FAR; }   // the fog object is never swapped, so no shader recompiles
    // the same red light follows him to the stage; no light is ever added or removed
    if (on) glow.position.set(STAGE.x - 0.5, STAGE.y + 5.5, STAGE.z + 6); else glow.position.set(0, GLOW_ROAD.y, GLOW_ROAD.z);
    glow.intensity = on ? 260 : GLOW_ROAD.i;
    for (const l of scene.children) if (l.isLight && l !== glow) { l.userData.base ??= l.intensity; l.intensity = l.userData.base * (on ? 0.7 : 1); }
  }
  function stageAnimate() {
    const t = performance.now() / 1000;
    for (const b of stageAnim.beams) {   // red beams sweep around and pulse
      b.pivot.rotation.z = Math.sin(t * 0.4 + b.phase) * 0.55;
      b.pivot.rotation.x = Math.sin(t * 0.3 + b.phase * 1.7) * 0.35;
      b.mat.opacity = 0.07 + 0.06 * (Math.sin(t * 1.0 + b.phase * 2) * 0.5 + 0.5);
    }
    stageAnim.sweep.offset.x = (t * 0.05) % 1;   // the red band slides across the LED wall
    stageAnim.washes.forEach((l, i) => { l.material.opacity = 0.4 + 0.15 * Math.sin(t * 1.2 + i * Math.PI); });   // the side lights pulse in turn
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

  /** Scroll the road, arches, walls and confetti with the world. `move` is the distance run this step, `tt` is wall-clock seconds. */
  function scroll(move, tt, dist, dt) {
    roadTex.offset.y = (dist / 10) % 1;
    ledLogoMat.color.setScalar(0.8 + 0.2 * (Math.sin(tt * 1.5) * 0.5 + 0.5));   // the LED signs glow gently
    horizonSweep.offset.x = (tt * 0.04) % 1;   // the red band slides across the far LED wall
    edgeGroup.position.z += move; if (edgeGroup.position.z > 0) edgeGroup.position.z -= 20;   // the pattern repeats every 20 units, so it loops seamlessly
    for (const aw of alleyWalls) { const d = move / 25; aw.albedo.offset.x += aw.sx < 0 ? d : -d; aw.glow.offset.x = aw.albedo.offset.x; }   // the walls slide past with the road
    const cp = confetti.geometry.attributes.position;   // confetti falls, drifts and scrolls with the world (kept ready, but hidden)
    if (confetti.visible) for (let i = 0; i < CONF_N; i++) {
      let y = cp.getY(i) - 1.1 * dt, z = cp.getZ(i) + move;
      if (y < 0) y = 9;
      if (z > 12) z -= 80;
      cp.setXYZ(i, cp.getX(i) + Math.sin(tt * 1.5 + i) * 0.4 * dt, y, z);
    }
    cp.needsUpdate = true;
    for (const k in reflMats) reflMats[k].opacity = reflBase[k] * (0.82 + 0.18 * Math.sin(tt * 2.3 + k.length * 2));   // the reflections ripple a little in the rain
    const bulbPhase = Math.floor(tt * 3);
    if (bulbPhase !== lastBulbPhase) { lastBulbPhase = bulbPhase; setBulbs(bulbPhase); }   // the chasing bulbs (re-uploaded only when the pattern steps)
    for (const a of arches) {   // the truss arches scroll past, and their red beams sweep and pulse
      a.position.z += move;
      if (a.position.z > 14) a.position.z -= ARCH_N * ARCH_STEP;
      const near = Math.max(0, Math.min(1, (6 - a.position.z) / 10));   // fade a beam out as its arch passes the camera, or its cone floods the screen
      for (const b of a.userData.beams) {
        b.pivot.rotation.z = Math.sin(tt * 0.5 + b.phase) * 0.5;
        b.pivot.rotation.x = Math.sin(tt * 0.38 + b.phase * 1.6) * 0.35;
        b.mat.opacity = (0.05 + 0.04 * (Math.sin(tt * 1.1 + b.phase * 2) * 0.5 + 0.5)) * near;
        b.pool.visible = false;   // no spots of light on the road
        b.pool.position.set(b.x + Math.tan(b.pivot.rotation.z) * 6.7, 0.04, -Math.tan(b.pivot.rotation.x) * 6.7);
      }
    }
  }

  /** Cheap, reversible switch for slow devices: drop the sweeping beams and the confetti. */
  let lowDetailOn = false;
  function lowDetail(on = true) {
    if (on === lowDetailOn) return;
    lowDetailOn = on;
    /* the lights and their reflections stay on: switching them off made the scene look like the power had gone out */
  }

  return { T, scroll, stage, stageMode, stageAnimate, menuCamera, lowDetail, dotTex };
}
