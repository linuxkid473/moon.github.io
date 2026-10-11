// Low-poly people with real faces.
//
// Head = a vertex-coloured skull (hair colour on top and at the back, skin elsewhere) + a high-detail
// near-flat face plate that carries the portrait photo, + ears and a rear hair shell.
// If a portrait fails to load the patch gets a painted cartoon face, so the game still runs.
//
// Joint names (legL/legR/kneeL/kneeR, armL/armR/elbowL/elbowR, head) drive the run cycle and the
// boss animation. The body faces +z.
import { THREE, mat, mesh, box, canvasTex, labelTex, hexCss, clamp } from './gfx.js';
import { SKIN_FALLBACK } from './config.js';

const HEAD_RX = 0.27, HEAD_RY = 0.33, HEAD_RZ = 0.25;   // head radii at scale 1
export const HAIR = { black: 0x1c1814, brown: 0x3b2a1f, grey: 0x9a9a9a, white: 0xe6e6e6 };
const pmat = (color, opts = {}) => mat(color, { flatShading: true, ...opts });
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** Squeeze the lower half of a unit sphere into a jaw. */
function jaw(x, y, z) {
  if (y < 0) { x *= 1 - 0.38 * y * y; z *= 1 + 0.16 * y; }
  return [x, y, z];
}

function skullGeometry(hairCol, skinCol, low) {
  const geo = new THREE.SphereGeometry(1, 18, 12);
  const p = geo.attributes.position;
  const hair = new THREE.Color(hairCol), skin = new THREE.Color(skinCol), c = new THREE.Color();
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const z0 = p.getZ(i);
    const [x, y, z] = jaw(p.getX(i), p.getY(i), z0 > 0 ? 0.82 * Math.pow(z0, 0.6) : z0);   // a flatter front than a sphere
    // hairline: high on the forehead, running down the back of the head (lower for long styles)
    const back = smooth(0.35, -0.5, z);
    const line = 0.6 + (low - 0.6) * back - 0.5 * smooth(0.6, 0.95, Math.abs(x)) * (1 - back);
    c.copy(skin).lerp(hair, smooth(line - 0.12, line + 0.12, y));
    colors.set([c.r, c.g, c.b], i * 3);
    p.setXYZ(i, x * HEAD_RX, y * HEAD_RY, z * HEAD_RZ);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * The face: a nearly flat oval plate in front of the skull, planar-mapped so the whole portrait shows
 * undistorted (a sphere would stretch and cut off the edges). It bulges only slightly towards the middle.
 */
function facePlateGeometry() {
  const geo = new THREE.PlaneGeometry(2, 2, 14, 14);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), r2 = x * x + y * y;
    p.setXYZ(i, x * HEAD_RX, y * HEAD_RY, HEAD_RZ * (0.9 - 0.12 * Math.min(r2, 1.5)));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Cartoon fallback used when a portrait is missing, laid out like the baked photos (256 x 312, face in an ellipse). */
function paintedFace(skinHex, hairHex) {
  const skin = hexCss(skinHex), hair = hexCss(hairHex);
  return canvasTex(256, 312, (g, w, h) => {
    g.fillStyle = skin;
    g.beginPath(); g.ellipse(w / 2, h / 2, w * 0.45, h * 0.46, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = hair;
    g.beginPath(); g.ellipse(w / 2, h * 0.2, w * 0.43, h * 0.17, 0, Math.PI, Math.PI * 2); g.fill();
    for (const x of [0.33, 0.67]) {
      g.fillStyle = '#fff'; g.beginPath(); g.ellipse(w * x, h * 0.46, 22, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b2b33'; g.beginPath(); g.arc(w * x, h * 0.46, 8, 0, Math.PI * 2); g.fill();
      g.strokeStyle = hair; g.lineWidth = 8; g.lineCap = 'round';
      g.beginPath(); g.moveTo(w * x - 24, h * 0.38); g.lineTo(w * x + 24, h * 0.38); g.stroke();
    }
    g.strokeStyle = '#7a2e2e'; g.lineWidth = 7;
    g.beginPath(); g.moveTo(w * 0.38, h * 0.76); g.quadraticCurveTo(w * 0.5, h * 0.84, w * 0.62, h * 0.76); g.stroke();
  });
}

const faceMatCache = new Map();
function faceMaterial(o) {
  const key = o.id || o.label;
  if (faceMatCache.has(key)) return faceMatCache.get(key);
  let map;
  if (o.faceImage) {
    map = new THREE.Texture(o.faceImage);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    map.needsUpdate = true;
  } else {
    map = paintedFace(o.skin ?? SKIN_FALLBACK, o.hair?.color ?? 0x3b2a1f);
  }
  // Unlit, so the photo keeps its real colours instead of being tinted red by the stage lights.
  const m = new THREE.MeshBasicMaterial({
    map, transparent: true, toneMapped: false, color: 0xf4f0f0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  faceMatCache.set(key, m);
  return m;
}

function buildHead(o, skin) {
  const s = o.headScale ?? 1;
  const head = new THREE.Group();
  head.name = 'head';
  head.scale.setScalar(s);
  head.position.set(0, 2.26 + HEAD_RY * s, 0);

  const hair = o.hair || { color: 0x3b2a1f, style: 'short' };
  const bob = hair.style === 'bob';
  head.add(mesh(skullGeometry(hair.color, o.skin ?? SKIN_FALLBACK, bob ? -0.7 : -0.25), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true })));
  const plate = new THREE.Mesh(facePlateGeometry(), faceMaterial(o));
  plate.name = 'face';
  head.add(plate);
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(1, 5, 4), skin);
    ear.scale.set(0.03, 0.07, 0.045);
    ear.position.set(side * HEAD_RX * 0.97, -0.03, -0.02);
    head.add(ear);
  }
  // hair volume behind and above the ears (open at the front, where the photo's own hair shows)
  const shell = mesh(new THREE.SphereGeometry(1, 14, 8, Math.PI, Math.PI, 0, bob ? 2.35 : 1.95), pmat(hair.color, { roughness: 0.9 }));
  shell.scale.set(HEAD_RX * (bob ? 1.14 : 1.06), HEAD_RY * (bob ? 1.06 : 1.03), HEAD_RZ * (bob ? 1.2 : 1.1));
  shell.position.set(0, bob ? 0.01 : 0.02, -0.01);
  head.add(shell);
  return head;
}

/** Build a person from a character config plus its outfit. `o.faceImage` is the loaded portrait (or null). */
export function buildPerson(o) {
  const out = o.outfit || {};
  const g = new THREE.Group();
  const shirt = pmat(out.shirt || 0xffffff, { roughness: 0.5 });
  const jacket = out.suit ? pmat(out.suit, { roughness: 0.6 }) : shirt;
  const jacketDark = out.suit ? pmat(new THREE.Color(out.suit).multiplyScalar(0.72).getHex(), { roughness: 0.6 }) : shirt;
  const pants = pmat(out.pants, { roughness: 0.6 });
  const skin = pmat(o.skin ?? SKIN_FALLBACK, { roughness: 0.6 });
  const dark = pmat(0x1a1a1a, { roughness: 0.4 });
  const shoe = pmat(0x161616, { roughness: 0.35 });
  const tieMat = out.tie ? pmat(out.tie, { roughness: 0.4 }) : null;

  const ell = (rx, ry, rz, material, x, y, z, seg = 6) => {
    const m = mesh(new THREE.SphereGeometry(1, seg, Math.max(3, seg - 2)), material);
    m.scale.set(rx, ry, rz);
    m.position.set(x, y, z);
    return m;
  };
  const cyl = (rt, rb, h, sides, material, x, y, z, sz = 1) => {
    const m = mesh(new THREE.CylinderGeometry(rt, rb, h, sides, 1, false, Math.PI / sides), material);
    m.position.set(x, y, z);
    m.scale.z = sz;
    return m;
  };

  // legs (hip pivots): thigh, knee, shin, shoe
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.name = side < 0 ? 'legL' : 'legR';
    hip.position.set(side * 0.14, 1.02, 0);
    hip.add(cyl(0.105, 0.082, 0.52, 4, pants, 0, -0.25, 0));
    const knee = new THREE.Group();
    knee.name = side < 0 ? 'kneeL' : 'kneeR';
    knee.position.set(0, -0.51, 0);
    knee.add(ell(0.085, 0.085, 0.085, pants, 0, 0, 0, 4));
    knee.add(cyl(0.08, 0.06, 0.5, 4, pants, 0, -0.25, 0));
    knee.add(ell(0.1, 0.065, 0.19, shoe, 0, -0.51, 0.06, 5));
    hip.add(knee);
    g.add(hip);
  }

  // pelvis, belt
  g.add(cyl(0.26, 0.24, 0.26, 6, pants, 0, 1.1, 0, 0.6));
  if (!out.suit) {   // high-waisted trousers, belt and buckle, shirt bunched over the belt
    const leather = pmat(0x2a1a10, { roughness: 0.4 });
    g.add(cyl(0.255, 0.265, 0.26, 6, pants, 0, 1.23, 0, 0.6));
    g.add(cyl(0.272, 0.272, 0.09, 6, leather, 0, 1.32, 0, 0.6));
    g.add(box(0.09, 0.07, 0.04, pmat(0xc9b458, { roughness: 0.3 }), 0, 1.32, 0.16));
    for (const s of [-1, 1]) g.add(box(0.025, 0.1, 0.03, leather, s * 0.12, 1.32, 0.15));
    g.add(cyl(0.268, 0.268, 0.1, 6, pmat(new THREE.Color(out.shirt || 0xffffff).multiplyScalar(0.88).getHex(), { roughness: 0.5 }), 0, 1.43, 0, 0.58));
  }

  // torso and shoulders
  g.add(cyl(0.33, 0.22, 1.0, 6, jacket, 0, 1.7, 0, 0.55));
  for (const side of [-1, 1]) g.add(ell(0.15, 0.12, 0.14, jacket, side * 0.34, 2.14, 0, 4));

  if (out.suit) {
    g.add(box(0.15, 0.5, 0.04, shirt, 0, 1.92, 0.138));
    for (const s of [-1, 1]) {   // lapels
      const lap = box(0.09, 0.52, 0.04, jacketDark, s * 0.1, 1.92, 0.143);
      lap.rotation.z = -s * 0.22;
      g.add(lap);
    }
  } else {
    for (const s of [-1, 1]) {   // collar
      const c = box(0.11, 0.07, 0.05, shirt, s * 0.055, 2.22, 0.11);
      c.rotation.z = s * 0.45;
      g.add(c);
    }
  }
  if (tieMat) {
    if (out.flapTie) {   // the player's tie: long, wide blade and a chunky knot
      const blade = mesh(new THREE.CylinderGeometry(0.045, 0.14, 0.62, 4, 1, false, Math.PI / 4), tieMat);
      blade.position.set(0, 1.78, 0.158);
      blade.scale.z = 0.4;
      g.add(blade);
      g.add(box(0.12, 0.1, 0.08, tieMat, 0, 2.08, 0.16));
    } else {
      g.add(box(0.07, 0.44, 0.04, tieMat, 0, 1.84, 0.148));
      g.add(box(0.08, 0.07, 0.05, tieMat, 0, 2.07, 0.153));
    }
  }
  if (!out.suit) g.add(cyl(0.115, 0.14, 0.09, 6, pmat(0xffffff, { roughness: 0.5 }), 0, 2.27, 0, 0.85));   // collar ring, so it shows from behind
  if (tieMat && out.flapTie) {   // the end of the tie streams over his shoulder as he runs
    const flap = new THREE.Group();
    flap.name = 'tieFlap';
    flap.position.set(0.05, 2.3, -0.02);
    const bladeGeo = new THREE.CylinderGeometry(0.05, 0.15, 0.9, 4, 1, false, Math.PI / 4);
    bladeGeo.scale(0.3, 1, 1);
    const fb = mesh(bladeGeo, tieMat);
    fb.rotation.z = Math.PI / 2;
    fb.position.x = 0.45;
    flap.add(fb);
    g.add(flap);
  }

  // arms (shoulder pivots): upper arm, elbow, forearm, cuff, hand
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.name = side < 0 ? 'armL' : 'armR';
    shoulder.position.set(side * 0.37, 2.15, 0);
    shoulder.add(cyl(0.075, 0.065, 0.56, 4, jacket, 0, -0.28, 0));
    const elbow = new THREE.Group();
    elbow.name = side < 0 ? 'elbowL' : 'elbowR';
    elbow.position.set(0, -0.57, 0);
    elbow.add(ell(0.07, 0.07, 0.07, jacket, 0, 0, 0, 4));
    elbow.add(cyl(0.065, 0.052, 0.5, 4, jacket, 0, -0.25, 0));
    elbow.add(cyl(0.058, 0.058, 0.07, 4, out.suit ? shirt : jacket, 0, -0.5, 0));
    elbow.add(box(0.11, 0.12, 0.06, skin, 0, -0.58, 0));
    elbow.add(box(0.1, 0.1, 0.048, skin, 0, -0.68, 0.002));
    elbow.add(box(0.03, 0.09, 0.04, skin, -side * 0.065, -0.6, 0.03));
    if (side > 0 && out.briefcase) elbow.add(box(0.34, 0.24, 0.1, pmat(0x6b3f1f, { roughness: 0.5 }), 0, -0.83, 0.06));
    if (side > 0 && out.mic) {
      elbow.add(box(0.05, 0.36, 0.05, dark, 0, -0.79, 0.06));
      elbow.add(box(0.11, 0.13, 0.11, pmat(0x8a8f99, { roughness: 0.4 }), 0, -1.03, 0.06));
    }
    shoulder.add(elbow);
    g.add(shoulder);
  }

  g.add(cyl(0.07, 0.08, 0.2, 4, skin, 0, 2.3, 0));   // neck
  g.add(buildHead(o, skin));

  const headTop = 2.26 + 2 * HEAD_RY * (o.headScale ?? 1);
  g.userData.headTop = headTop * (o.scale || 1);
  if (o.label) {
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex(o.label), depthTest: false, transparent: true }));
    label.name = 'label';
    label.scale.set(2.4, 0.6, 1);
    label.position.set(0, headTop + 0.4, 0);
    label.renderOrder = 10;
    g.add(label);
  }
  g.scale.setScalar(o.scale || 1);
  return g;
}

/* ---------- poses ---------- */
// A pose is 12 numbers:
//   0 legL, 1 legR (hip swing), 2 kneeL, 3 kneeR (knee bend), 4 armL, 5 armR (shoulder swing),
//   6 elbowL, 7 elbowR (elbow bend), 8 armL, 9 armR (arm out to the side), 10 elbowL, 11 elbowR (forearm sideways)
const jointCache = new WeakMap();
function joints(root) {
  let j = jointCache.get(root);
  if (!j) {
    j = {};
    for (const n of ['legL', 'legR', 'kneeL', 'kneeR', 'armL', 'armR', 'elbowL', 'elbowR']) j[n] = root.getObjectByName(n);
    jointCache.set(root, j);
  }
  return j;
}
export function applyPose(root, a) {
  const j = joints(root);
  j.legL.rotation.x = a[0]; j.legR.rotation.x = a[1];
  j.kneeL.rotation.x = a[2]; j.kneeR.rotation.x = a[3];
  j.armL.rotation.x = a[4]; j.armR.rotation.x = a[5];
  j.elbowL.rotation.x = a[6]; j.elbowR.rotation.x = a[7];
  j.armL.rotation.z = a[8] || 0; j.armR.rotation.z = a[9] || 0;
  j.elbowL.rotation.z = a[10] || 0; j.elbowR.rotation.z = a[11] || 0;
}
/** Run cycle: hips swing, each knee folds as its leg comes forward, arms swing against the legs. amp 0 = standing, 1 = running. */
export function cyclePose(phase, amp) {
  const s = Math.sin(phase), c = Math.cos(phase);
  return [
    s * 0.62 * amp, -s * 0.62 * amp,
    (0.12 + 1.0 * Math.pow(0.5 - 0.5 * c, 3)) * amp, (0.12 + 1.0 * Math.pow(0.5 + 0.5 * c, 3)) * amp,
    -s * 0.6 * amp, s * 0.6 * amp,
    -(0.15 + (0.7 + 0.45 * (0.5 + 0.5 * s)) * amp), -(0.15 + (0.7 + 0.45 * (0.5 - 0.5 * s)) * amp),
    0, 0, 0, 0,
  ];
}
export const AIR_POSE = [-0.9, 0.4, 1.2, 1.5, -2.5, -2.5, -0.5, -0.5, -0.3, 0.3, 0, 0];   // stride jump: lead knee up, arms thrown up
export const FALL_POSE = [-0.4, 0.2, 0.7, 0.9, -1.7, -1.7, -0.4, -0.4, -0.5, 0.5, 0, 0];   // arms wide while falling fast
export const MENU_POSE = [0, 0, 0.05, 0.05, 0, 0, -0.2, -0.3, -0.6, 1.15, 1.5, 0];         // one hand on his hip, the other out to the sign

// Keyframed toss pose, played across the time he's airborne after an orb hit.
// Columns: k (0..1 through the toss), then the 12 pose numbers, then head nod and sideways lean.
const TOSS_KEYS = [
  [0.00,  0.5, -0.3,  0.4, 0.2,  -0.5,  0.4, -0.9, -0.9,  -0.3, 0.3,  0.0,  0.0,   0.0, 0.0],
  [0.12,  0.2,  0.2,  0.2, 0.2,  -1.9, -1.9, -0.3, -0.3,  -1.0, 1.0,  0.0,  0.0,  -0.2, 0.35],
  [0.45, -1.3, -1.3,  1.9, 1.9,  -0.9, -0.9, -1.6, -1.6,  -0.2, 0.2,  0.3, -0.3,   0.3, 0.1],
  [0.80, -0.3,  0.3,  0.5, 0.4,  -2.2, -2.2, -0.3, -0.3,  -1.2, 1.2,  0.0,  0.0,   0.0, 0.0],
  [1.00,  0.4, -0.2,  0.3, 0.6,  -1.0, -1.0, -0.8, -0.8,  -0.5, 0.5,  0.0,  0.0,   0.0, 0.0],
];
export function tossPose(k) {
  let i = 0;
  while (i < TOSS_KEYS.length - 2 && k > TOSS_KEYS[i + 1][0]) i++;
  const a = TOSS_KEYS[i], b = TOSS_KEYS[i + 1];
  const u = clamp((k - a[0]) / (b[0] - a[0]), 0, 1);
  const e = u * u * (3 - 2 * u);
  return a.map((v, j) => v + (b[j] - v) * e);
}
