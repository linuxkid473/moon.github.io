// Angus Taylah: Fighting Taxes. Game loop, physics, spawning, UI.
import { THREE, rand, pick, clamp, damp, loadImage, mesh, blobShadow, canvasTex } from './gfx.js';
import { LANES, SPAWN_Z, DESPAWN_Z, PHYS, JUMP_V, RUN, BUDGET_AT, BUDGET_SECS, CHARACTERS, BOSS_ORDER, ITEMS, POWER, STREAK_CALLS, PICKUP_POPS, RANKS, OVER_TITLES, BOMB, CAR } from './config.js';
import { S, W, saveWallet, saveBest, settings, saveSettings, helpSeen, markHelpSeen } from './state.js';
import * as audio from './audio.js';
import { buildPerson, applyPose, cyclePose, tossPose, AIR_POSE, FALL_POSE, MENU_POSE, LAUNCH_POSE, TUCK_POSE, POSE_N } from './person.js';
import { createCosmetics } from './cosmetics.js';
import { createWorld, STAGE } from './world.js';
import { createFx } from './fx.js';
import { createExplosion } from './explosion.js';
import { createCrack } from './crack.js';
import { createRain } from './rain.js';
import { createGlass } from './glass.js';
import { createReflection } from './reflection.js';
import { createEnvironment } from './env.js';
import { createCar } from './car.js';
import { createTicker } from './ticker.js';
import { World, Body } from './physics.js';
import { createRagdoll } from './ragdoll.js';
import { createDebris } from './debris.js';

const $ = (id) => document.getElementById(id);
const DRIVE_POSE = [0, 0, 0.2, 0.2, -1.15, -1.15, -0.55, -0.55, -0.12, 0.12, 0, 0, 0, 0.12, 0, 0, 0];   // both hands on the wheel
const sky = 0x06142e;   // deep blue haze: the whole run is a rally stage

/* Hazard footprints for hit testing: half width (x), height (y), half depth (z). */
const HAZ = { tax: { halfW: 0.75, h: 2.0, halfD: 0.45 }, tape: { halfW: 1.1, h: 0.8, halfD: 0.2 } };

function fatal(msg) {
  $('loader')?.classList.add('hidden');
  $('fatalMsg').textContent = msg;
  $('fatal').classList.remove('hidden');
}

async function boot() {
  /* ---------- renderer, scene, camera, lights ---------- */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: true, powerPreference: 'high-performance' });   // (used when the scene is drawn straight to the screen; the normal path anti-aliases its own target in glass.js)
  } catch {
    fatal('Your browser could not start 3D graphics (WebGL). Try updating it, or turn on hardware acceleration.');
    return;
  }
  const MAX_SCALE = Math.min(window.devicePixelRatio || 1, 2);   // native resolution on a 2x screen, so nothing is upscaled and softened
  let renderScale = MAX_SCALE;   // pixels drawn per CSS pixel; the quality controller below moves this to hold 60 fps
  renderer.setPixelRatio(renderScale);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 75, 135);   // a light haze only: the far end of the road stays crisp
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 300);
  createEnvironment(renderer, scene);   // image-based lighting for the glossy things

  const hemi = new THREE.HemisphereLight(0x3a5fb5, 0x2a1a3a, 1.25);   // its intensity flares for a moment when a tax bomb goes off
  scene.add(hemi);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;   // glass.js refreshes it once per frame
  const sun = new THREE.DirectionalLight(0xfff0f2, 2.4);
  sun.position.set(-6, 14, 8);
  sun.target.position.set(0, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 20, bottom: -20, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);

  /* ---------- portraits ---------- */
  const ids = Object.keys(CHARACTERS);
  let loaded = 0;
  const faceImg = {};
  await Promise.all(ids.map(async (id) => {
    faceImg[id] = await loadImage(new URL(CHARACTERS[id].face, import.meta.url).href);
    $('loadBar').style.width = `${(++loaded / (ids.length + 1)) * 100}%`;
  }));
  if (ids.some((id) => !faceImg[id])) console.warn('Some portraits failed to load; using painted faces for them.');

  /* ---------- world, people, costumes ---------- */
  const reflection = createReflection(renderer, scene);
  const worldFx = createWorld({ scene, camera, reflection });
  const { T } = worldFx;
  for (const id of BOSS_ORDER) { T[id] = buildPerson({ ...CHARACTERS[id], faceImage: faceImg[id] }); T[id].add(blobShadow(0.7, 0.55, 0.4)); }
  const bossHeight = Math.max(...BOSS_ORDER.map((id) => T[id].userData.headTop)) - 0.05;   // top of the head, for hit testing

  const player = buildPerson({ ...CHARACTERS.ANGUS, label: null, faceImage: faceImg.ANGUS });
  player.rotation.y = Math.PI;   // faces down the road (-z) so he runs forwards; the head turns back to the camera on pickups and hits
  scene.add(player);
  const playerHead = player.getObjectByName('head');
  const cos = createCosmetics({ scene, player, camera });
  const fx = createFx(scene);
  const carFx = createCar(scene);
  const phys = new World();   // rigid bodies: ragdolls and debris. The road is a conveyor under them (see physics.js)
  phys.gravity.set(0, -18, 0);
  phys.turbulence = 3;
  const debris = createDebris(scene, phys);
  /** Invisible walls and a ceiling round the street (the alley's own rectangle), so anything that is flung bounces back instead of leaving the world. */
  const bounds = [];
  function addBounds(zNear, zFar, xHalf = 13, ceiling = 20) {
    const mk = (x, y, z, hx, hy, hz) => {
      const w = new Body({ type: 'box', hx, hy, hz }, 0, { restitution: 0.3, friction: 0.5 });
      w.pos.set(x, y, z); w.prevPos.copy(w.pos); w.noSleep = true;
      phys.add(w); bounds.push(w);
    };
    const zMid = (zNear + zFar) / 2, hz = (zNear - zFar) / 2 + 4, hx = xHalf + 4;
    mk(-xHalf - 2, ceiling / 2, zMid, 2, ceiling / 2 + 4, hz);   // left wall
    mk(xHalf + 2, ceiling / 2, zMid, 2, ceiling / 2 + 4, hz);    // right wall
    mk(0, ceiling / 2, zFar - 2, hx, ceiling / 2 + 4, 2);        // far end
    mk(0, ceiling / 2, zNear + 2, hx, ceiling / 2 + 4, 2);       // behind the camera
    mk(0, ceiling + 3, zMid, hx, 3, hz);                         // the sky
  }
  const addRunBounds = () => addBounds(13, -108);
  const ragdolls = [];       // everything currently limp: { rag, mesh, t, kind }
  const boom = createExplosion(scene, fx, phys, debris);
  const crack = createCrack(scene, fx, phys, debris);
  let boomGlow = 0;
  const rain = createRain(scene, worldFx.dotTex);
  const glass = createGlass({ renderer, scene, camera, rain, reflection });
  cos.apply();
  const TAPE_AXIS = new THREE.Vector3(0.5, 0.5, 0.7).normalize();   // the thrown tape corkscrews about a diagonal axis

  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false }));   // a cheap soft shadow under him
  blob.position.y = 0.035;
  scene.add(blob);

  const warnMat = new THREE.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const warnGeo = new THREE.PlaneGeometry(1.5, 1).rotateX(-Math.PI / 2);

  const world = { hazards: [], taxCuts: [], bosses: [], shots: [], scenery: [], powerups: [] };
  const reduceMotion = () => !settings.shake;
  const news = createTicker($('tkView'), matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------- pooled spawning ---------- */
  const pools = new Map();
  function acquire(tpl, x, y, z) {
    const free = pools.get(tpl);
    let m = free && free.pop();
    if (!m) { m = tpl.clone(true); m.userData.tpl = tpl; scene.add(m); }
    m.visible = true;
    m.position.set(x, y, z);
    m.rotation.set(0, 0, 0);
    return m;
  }
  function release(m) {
    m.visible = false;
    const tpl = m.userData.tpl;
    if (!pools.has(tpl)) pools.set(tpl, []);
    const free = pools.get(tpl);
    if (free.length < 24) free.push(m); else scene.remove(m);
  }

  /* ---------- HUD (writes only when a value changes) ---------- */
  const hudCache = {};
  function setText(id, text) {
    if (hudCache[id] === text) return;
    hudCache[id] = text;
    $(id).textContent = text;
  }
  const lifeEls = [];
  for (let i = 0; i < 3; i++) {
    const e = document.createElement('span');
    e.className = 'life';
    e.style.backgroundImage = `url(${new URL(CHARACTERS.ANGUS.face, import.meta.url).href})`;
    $('lives').appendChild(e);
    lifeEls.push(e);
  }
  const scoreNow = () => Math.floor(S.dist) + S.cutScore;
  function updateHud() {
    setText('score', String(scoreNow()));
    setText('cuts', `Tax cuts ${S.taxCuts}  ·  Wallet ${W.coins}`);
    setText('streak', S.mult > 1 ? `x${S.mult} streak ${S.streak}` : S.streak > 2 ? `streak ${S.streak}` : '');
    setText('best', `Best ${Math.max(S.best, scoreNow())}`);
    lifeEls.forEach((e, i) => e.classList.toggle('lost', i >= S.lives));
    setText('bombN', String(W.bombs || 0));
    setText('carT', fmtT(W.carSecs || 0));
    $('carBtn').classList.toggle('show', (W.carSecs || 0) > 0 && (S.mode === 'menu' || S.mode === 'playing' || S.mode === 'paused'));
    $('carBtn').classList.toggle('driving', S.mode === 'menu' ? !!W.carOn : !!S.car);
    $('bombBtn').classList.toggle('on', S.mode === 'playing' && (W.bombs || 0) > 0);
    const b = S.budgetT > 0 ? Math.ceil(S.budgetT) : 0;
    setText('budget', b ? `LIBERAL BUDGET ${b}s` : '');
    $('budget').style.display = b ? 'block' : 'none';
    const pw = [S.cutT > 0 ? `✂ RIBBON-CUTTING ${Math.ceil(S.cutT)}s` : '', S.shield > 0 ? `💼 BLAME SHIELD ${Math.ceil(S.shieldT)}s` : ''].filter(Boolean).join('  ·  ');
    setText('powers', pw);
    $('powers').style.display = pw ? 'block' : 'none';
  }

  let popCount = 0;
  function popup(text, color = '#fff') {
    if (popCount >= 4) $('fx').firstElementChild?.remove();
    const el = document.createElement('div');
    el.className = 'pop';
    el.textContent = text;
    el.style.color = color;
    $('fx').appendChild(el);
    popCount++;
    setTimeout(() => { el.remove(); popCount = Math.max(0, popCount - 1); }, 900);
  }
  let toastTimer = 0;
  function toast(id, line1, line2) {
    const t = $('toast');
    $('toastImg').src = new URL(CHARACTERS[id].face, import.meta.url).href;
    $('toastName').textContent = line1;
    $('toastMsg').textContent = line2;
    t.classList.remove('show');
    void t.offsetWidth;   // restart the animation
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function flash() {
    if (reduceMotion()) return;
    const f = $('flash');
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
  const vibrate = (ms) => { if (settings.shake && navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); };   // browsers block it (and log an error) until the player has tapped or pressed a key

  const _sp = new THREE.Vector3();
  /** A blast at a world position: a ripple races across the screen from where it is, and the picture splits at the edges for a moment. */
  function shockAt(p, reach = 0.9) {
    _sp.copy(p).project(camera);
    glass.shock(_sp.x * 0.5 + 0.5, _sp.y * 0.5 + 0.5, reach);
    glass.punch(1);
  }

  /* ---------- the Angus Tax Car ---------- */
  const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  let carSave = 0;
  /** climb into (or out of) the car. S.car is the run's state; W.carOn is the standing preference. */
  function setCar(on, quiet = false) {
    on = !!on && (W.carSecs || 0) > 0;
    if (!!S.car === on) return;
    S.car = on;
    for (const n of ['legL', 'legR']) { const o = player.getObjectByName(n); if (o) o.visible = !on; }   // his legs are in the footwell
    carFx.visible = on && S.mode !== 'menu';
    if (!quiet) {
      audio.sfx.horn();
      fx.dust(player.position.x, 0.2, 0, 8, { size: 0.9, spread: 2.2, alpha: 0.3 });
      popup(on ? 'THE ANGUS TAX CAR!' : 'PARKED', '#7fb2ff');
      if (on) comic('VROOM!', '#ffd34d');
    }
  }
  function toggleCar() {
    if ((W.carSecs || 0) <= 0) { popup('Buy the Tax Car in the shop!', '#ffd34d'); audio.sfx.click(); return; }
    if (S.mode === 'playing') { setCar(!S.car); W.carOn = !!S.car; } else W.carOn = !W.carOn;   // (in the menu it only sets whether the next run starts in the car)
    saveWallet();
  }
  /** a hazard (or a thrown orb) hit by the car is smashed to pieces and thrown forward */
  function carSmashHazard(kind, m) {
    crack.shatter(kind, m, new THREE.Vector3(player.position.x, 0.5, m.position.z + 3.4), 1.3);
    fx.burst(m.position.x, 0.8, m.position.z, 0xffd34d, 14, { speed: 7, up: 4, life: 0.5 });
    release(m);
    S.cutScore += CAR.smashScore;
    S.shake = Math.max(S.shake, 0.45);
    audio.sfx.crunch();
    popup(pick(['SMASHED!', 'CRUNCH!', 'FLATTENED!', 'WRECKED!']), '#ffd34d');
  }
  /** a boss hit by the car goes off the map: the car's speed goes into him */
  function carHitBoss(b) {
    if (b.ragE) return;
    const e = launchBoss(b, 1.5, new THREE.Vector3(player.position.x, 0.7, b.mesh.position.z + 4));
    if (!e) return;
    for (const body of Object.values(e.rag.bodies)) { body.vel.z -= 14; body.vel.y += 3; }
    S.cutScore += CAR.bossScore;
    S.shake = Math.max(S.shake, 1.1);
    S.hitStop = 0.07;
    S.timeScale = 0.4;
    S.cine = { e, t: 0 };
    glass.punch(1);
    comic(pick(['SEE YA!', 'KABLAM!', 'WHAM!', 'YEET!']), '#ffffff');
    popup(`OFF THE MAP!  +${CAR.bossScore}`, '#7fb2ff');
    fx.sparks(b.mesh.position.x, 1.2, b.mesh.position.z, 46, { speed: 14, up: 6, life: 0.9, color: 0xffe0a0, ground: 1 });
    audio.sfx.crunch();
    news('boss', true);
  }

  /* ---------- ragdolls ---------- */
  const _v = new THREE.Vector3(), _w = new THREE.Vector3();
  /** Set a person flying. `vel` is relative to the road (so the road's own speed is added), `spin` tumbles them about `axis`. */
  function throwRagdoll(mesh, vel, spin, axis, kind = 'boss') {
    const rag = createRagdoll(mesh, phys);
    rag.start(_v.set(0, 0, 0));   // (the runner's frame: the camera stands still and the road streams past)
    rag.launch(vel, axis, spin, 7);
    const entry = { rag, mesh, t: 0, kind };
    ragdolls.push(entry);
    return entry;
  }
  function endRagdoll(e) {
    e.rag.stop();
    const i = ragdolls.indexOf(e);
    if (i >= 0) ragdolls.splice(i, 1);
    if (e.kind === 'player') { playerRag = null; resetPerson(player); player.scale.set(1, 1, 1); }
  }
  /** Put a ragdolled person's joints back to neutral so a pooled mesh can be reused. */
  function resetPerson(mesh) {
    mesh.traverse((o) => { if (o.isGroup && o !== mesh && o.name) o.quaternion.identity(); });
    mesh.quaternion.identity();
    mesh.scale.set(mesh.scale.x, mesh.scale.x, mesh.scale.x);
  }
  /** The player's own ragdoll (a tax bomb in the face): free-flying and tumbling, with a soft tether to his lane so the run can carry on. */
  let playerRag = null;
  function ragdollPlayer({ vel, spin, axis, tether = true, gravityScale = 1.7 }) {
    if (playerRag) return;
    const rag = createRagdoll(player, phys, { gravityScale });
    rag.start(_v.set(0, 0, 0));
    rag.launch(vel, axis, spin, 5);
    const e = { rag, mesh: player, t: 0, kind: 'player' };
    ragdolls.push(e);
    playerRag = { e, rag, t: 0, tether, blendT: 0, blendDur: 0.32 };
  }
  /** pull his pelvis towards his lane (a spring and a damper, sideways and along the road only: up and down is pure physics) */
  function tetherPlayer(dt) {
    const pr = playerRag;
    if (!pr || !pr.tether || pr.rag.released) return;
    const p = pr.rag.bodies.pelvis;
    const k = 26, c = 6.5;
    for (const b of Object.values(pr.rag.bodies)) {
      b.vel.x += (k * (LANES[S.lane] - p.pos.x) - c * b.vel.x) * dt;
      b.vel.z += (k * (0 - p.pos.z) - c * b.vel.z) * dt;
    }
  }
  function releasePlayerRag() {
    const pr = playerRag;
    if (!pr || pr.rag.released) return;
    pr.rag.release();   // remembers the limp pose; blend() eases it into the run
    pr.rag.released = true;
    pr.blendT = pr.blendDur;
    const i = ragdolls.indexOf(pr.e);
    if (i >= 0) ragdolls.splice(i, 1);
  }
  /** Blast a boss off the road, away from `origin`: up and away, spinning, limbs flailing; the road drags him when he lands. */
  function launchBoss(b, power = 1, origin = null) {
    if (b.ragE) return;
    const m = b.mesh;
    const ox = origin ? origin.x : m.position.x, oz = origin ? origin.z : m.position.z + 4;
    const ax = (m.position.x - ox) * 0.7 + (Math.abs(m.position.x - ox) < 0.5 ? (Math.random() < 0.5 ? -1 : 1) * 1.2 : 0), az = Math.min(-0.3, m.position.z - oz);
    const len = Math.hypot(ax, az) || 1;
    const h = rand(14, 22) * power;
    const vel = new THREE.Vector3((ax / len) * h * 0.55 + (ax < 0 ? -1 : 1) * rand(2, 5) * power, rand(17, 23) * power, (az / len) * h * 1.4 - 4);
    const axis = new THREE.Vector3(1, 0, -Math.sign(ax) * 0.55).normalize();
    b.ragE = throwRagdoll(m, vel, rand(5, 8) * power, axis);
    b.warnT = 0; b.throwing = 0; b.throwT = 99; b.warn.visible = false; b.touched = true; b.passed = true;
    const label = m.getObjectByName('label');
    if (label) label.visible = false;
    return b.ragE;
  }

  /* ---------- the tax cut bomb ---------- */
  const bombs = [];   // in flight: { body, mesh, t, T }
  const bombMats = {
    shell: new THREE.MeshStandardMaterial({ map: canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#10234d'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#d4a017'; g.fillRect(0, h * 0.44, w, h * 0.12);
      g.fillStyle = '#ffffff'; g.font = '900 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const cx of [w * 0.25, w * 0.75]) { g.fillText('%', cx, h * 0.22); g.fillText('TAX', cx, h * 0.78); }
    }), roughness: 0.28, metalness: 0.65 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.3, metalness: 0.8 }),
    fuse: new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.9 }),
  };
  const bombGeo = { shell: new THREE.SphereGeometry(0.34, 28, 20), cap: new THREE.CylinderGeometry(0.1, 0.13, 0.12, 14), fuse: new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8) };
  function makeBombMesh() {
    const g = new THREE.Group();
    const shell = new THREE.Mesh(bombGeo.shell, bombMats.shell);
    const cap = new THREE.Mesh(bombGeo.cap, bombMats.gold); cap.position.y = 0.36;
    const fuse = new THREE.Mesh(bombGeo.fuse, bombMats.fuse); fuse.position.y = 0.5; fuse.rotation.z = 0.35;
    g.add(shell, cap, fuse);
    for (const o of g.children) { o.castShadow = true; }
    g.userData.tip = new THREE.Vector3(-0.037, 0.61, 0);
    return g;
  }
  const _tip = new THREE.Vector3();

  /** comic sound-effect words (BOOM! HOMERUN!) */
  function comic(text, color = '#fff') {
    if (reduceMotion()) return;
    const el = document.createElement('div');
    el.className = 'comic';
    el.textContent = text;
    el.style.color = color;
    el.style.setProperty('--r', `${(Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6)}deg`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  function useBomb() {
    if (S.mode !== 'playing' || (W.bombs || 0) < 1 || S.throwing) return;
    W.bombs -= 1;
    saveWallet();
    S.throwing = { t: 0, released: false };
    popup('TAX CUT BOMB!', '#7fb2ff');
    audio.sfx.power();
  }

  /** The bomb leaves his hand on a ballistic arc worked out to meet the nearest boss (or land 26 m up the road). */
  function releaseBomb(aimPoint = null, fromPoint = null) {
    let tgt = null;
    if (!aimPoint) for (const b of world.bosses) {
      const z = b.mesh.position.z;
      if (b.ragE || z > -5 || z < -90) continue;
      if (!tgt || z > tgt.mesh.position.z) tgt = b;
    }
    const p0 = fromPoint ? fromPoint.clone() : new THREE.Vector3(player.position.x + 0.7, S.y + 2.3, -0.3);
    const T = aimPoint ? clamp(p0.distanceTo(aimPoint) / 30, 0.5, 1.1) : tgt ? clamp(-tgt.mesh.position.z / 45, BOMB.aimSecs[0], BOMB.aimSecs[1]) : 0.75;
    const aim = aimPoint ? aimPoint.clone() : tgt ? tgt.mesh.position.clone().add(new THREE.Vector3(0, 1.4, 0)) : new THREE.Vector3(player.position.x * 0.5, 0.4, -26);
    aim.z += S.speed * T;   // the road (and so the boss) keeps coming towards us while the bomb is in the air
    const g = phys.gravity;
    const v0 = aim.sub(p0).addScaledVector(g, -0.5 * T * T).multiplyScalar(1 / T);
    const mesh = makeBombMesh();
    scene.add(mesh);
    const body = new Body({ type: 'sphere', r: 0.34 }, 3, { restitution: 0.3, friction: 0.5, linDamp: 0, angDamp: 0, noBodyContacts: true });
    body.pos.copy(p0); body.prevPos.copy(p0);
    body.vel.copy(v0);
    body.omega.set(rand(6, 10), 0, rand(-4, 4));
    body.noSleep = true;
    body.userData.bomb = true;
    phys.add(body, mesh);
    bombs.push({ body, mesh, t: 0, T, fuseT: 0 });
    audio.sfx.lane();
  }

  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const bm = bombs[i], p = bm.body.pos;
      bm.t += dt;
      // the fuse: sparks and a thin trail of smoke
      bm.mesh.updateMatrixWorld(true);
      _tip.copy(bm.mesh.userData.tip).applyMatrix4(bm.mesh.matrixWorld);
      fx.emit({ kind: 0, x: _tip.x, y: _tip.y, z: _tip.z, vx: rand(-2, 2) + bm.body.vel.x * 0.2, vy: rand(1, 4), vz: rand(-2, 2) + bm.body.vel.z * 0.2, life: 0.3, size: 0.04, stretch: 0.01, drag: 1, grav: 9, color: 0xffb040, heat: 1, mode: 1, bounce: 0.2 });
      bm.fuseT -= dt;
      if (bm.fuseT <= 0) { bm.fuseT = 0.03; fx.emit({ kind: 2, x: bm.body.pos.x, y: bm.body.pos.y, z: bm.body.pos.z, vx: 0, vy: 0.5, vz: 0, life: 0.7, size: 0.22, size1: 0.9, drag: 1.2, grav: 0, color: 0x666a78, alpha: 0.28, turb: 1.5, floor: 0.4 }); }
      let boom_ = bm.t > bm.T + 0.6 || (p.y < 0.42 && bm.t > 0.15);
      for (const b of world.bosses) {
        if (b.ragE || boom_) continue;
        const m = b.mesh.position;
        if (Math.hypot(p.x - m.x, (p.y - m.y - 1.4) * 0.7, p.z - m.z) < 1.9) boom_ = true;
      }
      if (S.mode === 'sandbox' && !boom_ && bm.t > 0.12) {   // in the sandbox it goes off on touching anything solid
        for (const o of phys.bodies) {
          if (o === bm.body || o.userData.bomb || o.invMass === 0) continue;
          if (o.pos.distanceTo(p) < o.radius * 0.8 + 0.4) { boom_ = true; break; }
        }
        if (!boom_ && !playerRag && Math.hypot(p.x, p.z) < 0.8 && p.y < 2.9) boom_ = true;   // the standing Angus
      }
      if (boom_) { detonateBomb(bm); bombs.splice(i, 1); }
    }
  }

  function detonateBomb(bm) {
    const p = bm.body.pos.clone();
    phys.remove(bm.body);
    scene.remove(bm.mesh);
    p.y = Math.max(p.y, 1.0);
    boom.explode(p.x, p.y, p.z, 1.5);
    boomGlow = 1;
    shockAt(p, 1.1);
    if (!reduceMotion()) { const b = $('blast'); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
    S.shake = Math.max(S.shake, 1.5);
    S.hitStop = 0.08;
    vibrate(200);
    audio.sfx.explosion();
    comic('BOOM!', '#ffd34d');
    S.blast = { x: p.x, y: p.y, z: p.z, r: 0 };
    if (S.mode === 'sandbox') {   // everything in reach is thrown, Angus included
      phys.blast(p, 18, 22, 1.0);
      const d = Math.hypot(p.x, p.z);
      if (!playerRag && d < 16) {
        const dir = new THREE.Vector3(-p.x, 0, -p.z);
        if (dir.lengthSq() < 0.01) dir.set(rand(-1, 1), 0, rand(-1, 1));
        dir.normalize();
        const f = 1 - d / 16;
        knockPlayer(dir.multiplyScalar(5 + 11 * f).add(new THREE.Vector3(0, 8 + 8 * f, 0)), rand(5, 9) * (Math.random() < 0.5 ? -1 : 1));
      }
    }
  }

  /** The blast wave runs down the road with the road. Hazards in it are wrecked; every boss it reaches goes flying. */
  function updateBlast(dt, move) {
    const w = S.blast;
    if (!w) return;
    w.z += move;
    w.r += BOMB.waveSpeed * dt;
    const origin = _v.set(w.x, w.y, w.z);
    for (const kind of ['hazards', 'shots']) {
      const list = world[kind];
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i], m = e.mesh;
        if (Math.abs(m.position.z - w.z) > w.r) continue;
        crack.shatter(kind === 'shots' ? 'shot' : e.kind, m, origin.clone(), 1);
        release(m);
        list.splice(i, 1);
      }
    }
    for (const b of world.bosses) {
      if (b.ragE || Math.abs(b.mesh.position.z - w.z) > w.r) continue;
      const d = Math.hypot(b.mesh.position.x - w.x, b.mesh.position.z - w.z);
      const power = clamp(1.25 - d / 70, 0.55, 1.25);
      const e = launchBoss(b, power, origin);
      S.cutScore += BOMB.bossScore;
      S.shake = Math.max(S.shake, 1.2);
      S.timeScale = 0.3;
      S.cine = { e, t: 0 };
      comic('HOMERUN!', '#ffffff');
      popup(`HIT OUT OF THE PARK!  +${BOMB.bossScore}`, '#7fb2ff');
      fx.sparks(b.mesh.position.x, b.mesh.position.y + 1.5, b.mesh.position.z, 40, { speed: 12, up: 6, life: 0.8, color: 0xffe0a0, ground: 1 });
      audio.sfx.hit();
    }
    if (w.r > BOMB.waveReach) S.blast = null;
  }

  /** The jump-chain knockout: a giant tax-cut coin flies in from the side and hits the nearest boss; the boss is then a ragdoll that takes the blow. */
  function updateKO(dt, move) {
    let k = S.ko;
    if (!k && S.bossKO) {
      const b = world.bosses.find((q) => !q.ragE && q.mesh.position.z < -16 && q.mesh.position.z > -60);
      if (b) {
        const side = b.mesh.position.x < -0.5 ? 1 : b.mesh.position.x > 0.5 ? -1 : (Math.random() < 0.5 ? -1 : 1);
        const mesh = acquire(T.taxCut, side * 13, 2.4, b.mesh.position.z);
        mesh.scale.setScalar(4.2);
        mesh.rotation.y = Math.PI / 2;
        k = S.ko = { b, mesh, side, vx: -side * 40 };
        S.bossKO = false;
        popup('ROGUE TAX CUT!', '#7fb2ff');
        audio.sfx.orb();
      }
    }
    if (!k) return;
    k.mesh.position.x += k.vx * dt;
    k.mesh.position.z = k.b.mesh.position.z;
    k.mesh.rotation.x += dt * 9;
    fx.emit({ kind: 3, x: k.mesh.position.x, y: k.mesh.position.y, z: k.mesh.position.z, vx: 0, vy: 0, vz: 0, ground: 1, life: 0.25, size: 1.6, size1: 0.3, drag: 0, grav: 0, color: 0x2fd27a, alpha: 0.5, glow: 1.6 });
    const hit = Math.abs(k.mesh.position.x - k.b.mesh.position.x) < 2.1;
    if (hit && !k.b.ragE) {
      const b = k.b, side = k.side;
      const e = launchBoss(b, 0.9, new THREE.Vector3(b.mesh.position.x + side * 3, 1.5, b.mesh.position.z));
      // the blow is sideways, into the crowd: override the launch with a sideways one
      if (e) { for (const body of Object.values(e.rag.bodies)) { body.vel.x = -side * rand(24, 30); body.vel.z = -rand(6, 12); } }
      S.cutScore += BOMB.bossScore;
      S.shake = Math.max(S.shake, 0.9);
      S.hitStop = 0.09;
      S.timeScale = 0.4;
      S.cine = { e, t: 0 };
      comic('BONK!', '#7fb2ff');
      popup(`BOSS KNOCKED INTO THE CROWD!  +${BOMB.bossScore}`, '#7fb2ff');
      fx.burst(b.mesh.position.x, 1.6, b.mesh.position.z, 0x6dffb0, 30, { speed: 10, up: 5, life: 0.7 });
      audio.sfx.hit();
    }
    if (Math.abs(k.mesh.position.x) > 16 || (hit && k.b.ragE)) { k.mesh.scale.setScalar(1); release(k.mesh); S.ko = null; }
  }

  function clearBombs() {
    for (const bm of bombs) { phys.remove(bm.body); scene.remove(bm.mesh); }
    bombs.length = 0;
  }

  /* ---------- Ragdoll Mode: a physics playground ---------- */
  const sb = { tool: 'grab', balls: [], extras: [], grab: null, yaw: 0, pitch: 0.24, dist: 9, slow: false, restT: 0, orbit: null, bossN: 0, rayDir: new THREE.Vector3() };
  const sbRayCaster = new THREE.Raycaster();
  const camFollow = new THREE.Vector3(0, 1.3, 0);
  const ballGeo = new THREE.SphereGeometry(0.3, 28, 20);
  const ballMats = [0xff3b4a, 0x2f66e0, 0xffd34d, 0x2fd27a, 0xf2f2f2].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.22, metalness: 0.15 }));
  const bundleGeo = new THREE.BoxGeometry(1.5, 0.4, 0.9);
  const bundleMat = new THREE.MeshStandardMaterial({ color: 0xf4efe2, roughness: 0.85 });
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c2 = new THREE.Vector3();

  function sbRay(ev) {
    sbRayCaster.setFromCamera(new THREE.Vector2((ev.clientX / innerWidth) * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), camera);
    return sbRayCaster.ray;
  }
  function sbGround(r) { return r.direction.y < -0.02 ? r.at(-r.origin.y / r.direction.y, new THREE.Vector3()) : r.at(14, new THREE.Vector3()); }
  function sbBodies() {
    const out = [];
    if (playerRag && !playerRag.rag.released) out.push(...Object.values(playerRag.rag.bodies));
    for (const e of sb.extras) out.push(...Object.values(e.rag.bodies));
    return out;
  }
  /** the ragdoll body nearest the ray: forgiving, so clicking near a limb grabs it */
  function sbPick(r) {
    let best = null, bScore = 1e9, bt = 0;
    for (const b of sbBodies()) {
      _a.copy(b.pos).sub(r.origin);
      const t = _a.dot(r.direction);
      if (t < 0) continue;
      const d = Math.sqrt(Math.max(0, _a.lengthSq() - t * t)), rad = Math.max(0.3, b.radius * 0.9);
      if (d > rad * 1.3 + 0.35) continue;
      const score = d - 0.5 * rad;
      if (score < bScore) { bScore = score; best = b; bt = t; }
    }
    return best ? { body: best, t: bt } : null;
  }
  function sbOverStanding(r) {
    if (playerRag) return false;
    return r.distanceSqToSegment(_a.set(0, 0.3, 0), _b.set(0, 2.6, 0)) < 0.55 * 0.55;
  }
  /** Angus is struck: from standing he goes limp (the ragdoll starts from the pose he is in) and is thrown with `vel`. */
  function knockPlayer(vel, spin = 5, axis = null) {
    if (playerRag) return;
    ragdollPlayer({ vel, spin, axis: axis ?? new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(), tether: false, gravityScale: 1.25 });
    sb.restT = 0;
    audio.sfx.hit();
    S.shake = Math.max(S.shake, 0.35);
  }

  function sbThrowBall(r) {
    const hit = sbPick(r);
    const target = hit ? hit.body.pos.clone() : sbOverStanding(r) ? new THREE.Vector3(0, 1.5, 0) : sbGround(r);
    const pos = camera.position.clone().addScaledVector(r.direction, 1.4).add(new THREE.Vector3(0, -0.6, 0));
    const body = new Body({ type: 'sphere', r: 0.3 }, 2.5, { restitution: 0.72, friction: 0.5, linDamp: 0.01, angDamp: 0.05 });
    body.pos.copy(pos); body.prevPos.copy(pos);
    body.vel.copy(target).sub(pos).normalize().multiplyScalar(36).add(new THREE.Vector3(0, 1.5, 0));
    body.omega.set(rand(-8, 8), rand(-8, 8), rand(-8, 8));
    body.noSleep = true;
    const mesh = new THREE.Mesh(ballGeo, pick(ballMats));
    mesh.castShadow = true;
    scene.add(mesh);
    phys.add(body, mesh);
    sb.balls.push({ body, mesh });
    while (sb.balls.length > 24) { const o = sb.balls.shift(); phys.remove(o.body); scene.remove(o.mesh); }
    audio.sfx.lane();
  }
  function sbDropStack(g) {
    for (let i = 0; i < 4; i++) {
      debris.spawn({
        geo: bundleGeo, material: bundleMat, size: [0.75, 0.2, 0.45], mass: 7, restitution: 0.08, friction: 0.7, linDamp: 0.02, angDamp: 0.3, life: 1e9,
        x: g.x + rand(-0.12, 0.12), y: 7 + i * 0.6, z: g.z + rand(-0.12, 0.12), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, 6.28), 0)), vel: new THREE.Vector3(0, -3, 0),
      });
    }
    audio.sfx.land();
  }
  function sbThrowBomb(r) {
    const hit = sbPick(r);
    const aim = hit ? hit.body.pos.clone() : sbOverStanding(r) ? new THREE.Vector3(0, 1.4, 0) : sbGround(r);
    const from = camera.position.clone().add(new THREE.Vector3(0.9, -1.2, 0)).addScaledVector(r.direction, 1.5);
    releaseBomb(aim, from);
  }
  function sbSpawnBoss() {
    if (sb.extras.length >= 3) { const o = sb.extras.shift(); endRagdoll(o); resetPerson(o.mesh); release(o.mesh); }
    const kind = BOSS_ORDER[sb.bossN++ % BOSS_ORDER.length];
    const mesh = acquire(T[kind], rand(-3.2, 3.2), 0, rand(-2.5, 1.5));
    mesh.rotation.y = rand(-0.8, 0.8);
    const label = mesh.getObjectByName('label');
    if (label) label.visible = false;
    const e = throwRagdoll(mesh, new THREE.Vector3(rand(-2, 2), 5, rand(-2, 2)), rand(2, 5), new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(), kind);
    e.rag.bodies.pelvis.pos.y += 0.3;
    sb.extras.push(e);
    audio.sfx.power();
  }
  function sbReset() {
    sb.grab = null;
    for (const o of sb.balls) { phys.remove(o.body); scene.remove(o.mesh); }
    sb.balls.length = 0;
    debris.clear(); clearBombs(); fx.clear(); boom.clear(); crack.clear();
    for (const e of sb.extras) { endRagdoll(e); resetPerson(e.mesh); release(e.mesh); }
    sb.extras.length = 0;
    if (playerRag && !playerRag.rag.released) { playerRag.blendDur = 0.5; releasePlayerRag(); }   // he gets back on his feet
    S.blast = null;
  }
  function sbCleanup() {
    sb.grab = null;
    for (const o of sb.balls) { phys.remove(o.body); scene.remove(o.mesh); }
    sb.balls.length = 0;
    for (const e of sb.extras) { endRagdoll(e); resetPerson(e.mesh); release(e.mesh); }
    sb.extras.length = 0;
  }
  const SB_TOOLS = ['grab', 'ball', 'bomb', 'stack', 'boss'];
  function sbSetTool(t) {
    if (t === 'boss') { sbSpawnBoss(); return; }
    sb.tool = t;
    for (const b of document.querySelectorAll('#sbBar [data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    $('sbHint').textContent = ({ grab: 'Grab: drag Angus (or a boss) by any limb and fling him', ball: 'Ball: click to throw a ball at where you aim', bomb: 'Bomb: click to lob a tax cut bomb', stack: 'Tax stack: click to drop a stack of tax papers from above' })[t] + '  ·  right-drag: orbit  ·  wheel: zoom';
  }
  function sbToggleSlow() { sb.slow = !sb.slow; $('sbSlow').classList.toggle('on', sb.slow); }

  function startSandbox() {
    if (S.mode !== 'menu') return;
    audio.unlock();
    clearWorld();
    Object.assign(S, { time: 0, speed: 0, dist: 0, lane: 1, vx: 0, y: 0, vy: 0, onGround: true, airT: 0, fastFalling: false, invuln: 0, shake: 0, hitStop: 0, slow: 1, timeScale: 1, thrown: 0, tapeLeft: 0, noSpin: false, throwing: null, blast: null, cine: null, glance: 0, lives: 99 });
    player.position.set(0, 0, 0);
    for (const w of bounds) phys.remove(w);   // the sandbox's street is shorter
    bounds.length = 0;
    addBounds(18, -40, 12.5);
    show('menu', false);
    sb.yaw = 0; sb.pitch = 0.24; sb.dist = 9; sb.slow = false; sb.bossN = 0;
    $('sbSlow').classList.remove('on');
    sbSetTool('grab');
    setMode('sandbox');
    audio.music.stop();
    camFollow.set(0, 1.3, 0);
  }

  /** every step of the sandbox: the grab spring, the standing Angus being struck, getting back up */
  function updateSandbox(dt) {
    if (!playerRag) {   // anything fast that reaches him knocks him down
      for (const b of phys.bodies) {
        if (b.invMass === 0 || b.userData.seg || b.userData.bomb) continue;
        const sp = b.vel.length();
        if (sp < 4 || b.pos.y > 3.4 || b.pos.y < -0.2) continue;
        if (Math.hypot(b.pos.x, b.pos.z) < 0.62 + b.radius * 0.7) {
          const k = clamp(b.mass / (b.mass + 12), 0.1, 0.9);
          _c2.copy(b.vel).multiplyScalar(0.55 * k + 0.25);
          _c2.y += 2.5;
          knockPlayer(_c2.clone(), sp * 0.35 * (Math.random() < 0.5 ? -1 : 1));
          b.vel.multiplyScalar(-0.25);
          break;
        }
      }
    } else if (!playerRag.rag.released) {   // when he has been lying still a moment, he gets back up
      const calm = playerRag.rag.avgVel(_a).length() < 1.1 && !sb.grab;
      sb.restT = calm ? sb.restT + dt : 0;
      if (sb.restT > 3) { playerRag.blendDur = 0.7; releasePlayerRag(); sb.restT = 0; }
    }
    const g = sb.grab;   // the grab: a soft spring pulls the held point towards the pointer
    if (g) {
      _b.copy(camera.position).addScaledVector(sb.rayDir, g.depth);
      g.body.toWorld(g.local, _a);
      _c2.copy(_b).sub(_a).multiplyScalar(14);
      if (_c2.length() > 36) _c2.setLength(36);
      g.body.pointVel(_a.clone().sub(g.body.pos), _b);
      _c2.sub(_b).multiplyScalar(g.body.mass * (1 - Math.exp(-12 * dt)));
      phys.impulseAt(g.body, _c2, _a);
      g.body.vel.multiplyScalar(Math.exp(-0.9 * dt));
    }
  }

  function sbPointerDown(ev) {
    if (ev.target.closest && ev.target.closest('#sbBar')) return;
    if (ev.button === 2 || ev.button === 1 || ev.shiftKey) { sb.orbit = { x: ev.clientX, y: ev.clientY }; return; }
    const r = sbRay(ev);
    sb.rayDir.copy(r.direction);
    if (sb.tool === 'grab') {
      let hit = sbPick(r);
      if (!hit && sbOverStanding(r)) { knockPlayer(new THREE.Vector3(0, 1.5, 0), 0); hit = sbPick(r); }
      if (hit) {
        const b = hit.body;
        _a.copy(r.origin).addScaledVector(r.direction, hit.t);   // the point on the ray nearest the body
        sb.grab = { body: b, local: b.pos.clone().sub(b.pos).add(_a.clone().sub(b.pos).applyQuaternion(b.quat.clone().invert())), depth: hit.t };
        sb.restT = 0;
      }
    } else if (sb.tool === 'ball') sbThrowBall(r);
    else if (sb.tool === 'bomb') sbThrowBomb(r);
    else if (sb.tool === 'stack') sbDropStack(sbGround(r));
  }
  function sbPointerMove(ev) {
    if (sb.orbit) {
      sb.yaw -= (ev.clientX - sb.orbit.x) * 0.006;
      sb.pitch = clamp(sb.pitch + (ev.clientY - sb.orbit.y) * 0.005, -0.1, 1.2);
      sb.orbit.x = ev.clientX; sb.orbit.y = ev.clientY;
    }
    if (sb.grab) sb.rayDir.copy(sbRay(ev).direction);
  }
  function sbPointerUp() { sb.grab = null; sb.orbit = null; }
  addEventListener('pointerdown', (e) => { if (S.mode === 'sandbox') sbPointerDown(e); });
  addEventListener('pointermove', (e) => { if (S.mode === 'sandbox') sbPointerMove(e); });
  addEventListener('pointerup', () => { if (S.mode === 'sandbox') sbPointerUp(); });
  addEventListener('pointercancel', () => { if (S.mode === 'sandbox') sbPointerUp(); });
  addEventListener('contextmenu', (e) => { if (S.mode === 'sandbox') e.preventDefault(); });
  addEventListener('wheel', (e) => { if (S.mode === 'sandbox') { sb.dist = clamp(sb.dist * (1 + e.deltaY * 0.001), 4, 24); e.preventDefault(); } }, { passive: false });

  function sandboxCamera(dt) {
    const lead = playerRag && !playerRag.rag.released ? playerRag.rag.centre : null;
    _look.set(0, 1.3, 0);
    if (lead && Number.isFinite(lead.x + lead.y + lead.z)) _look.lerp(_cine.set(clamp(lead.x, -11, 11), clamp(lead.y, 0.8, 6), clamp(lead.z, -38, 16)), 0.7);
    camFollow.lerp(_look, 1 - Math.exp(-3 * dt));
    const cp = Math.cos(sb.pitch), tt = performance.now() / 1000, amp = reduceMotion() ? 0 : S.shake * S.shake * 0.5 + S.shake * 0.12;
    const nz = (f, s) => Math.sin(tt * f + s) * 0.6 + Math.sin(tt * f * 2.37 + s * 1.9) * 0.4;
    camera.position.set(camFollow.x + Math.sin(sb.yaw) * cp * sb.dist + nz(31, 1) * amp * 0.5, Math.max(0.6, camFollow.y + Math.sin(sb.pitch) * sb.dist + 0.5) + nz(37, 2) * amp * 0.35, camFollow.z + Math.cos(sb.yaw) * cp * sb.dist);
    camera.lookAt(camFollow.x, camFollow.y * 0.85 + 0.35, camFollow.z);
    camera.rotateZ(nz(23, 4) * amp * 0.03);
    S.shake *= Math.exp(-8 * dt);
    const base = innerWidth / innerHeight < 0.9 ? 78 : 62;
    if (Math.abs(camera.fov - base) > 0.01) { camera.fov = base; camera.updateProjectionMatrix(); }
  }

  function stepRagdolls(dt) {
    for (let i = ragdolls.length - 1; i >= 0; i--) {
      const e = ragdolls[i];
      e.t += dt;
      e.rag.apply();
    }
  }

  /* ---------- spawning ---------- */
  const laneX = (lane) => LANES[lane];
  function spawnHazard(kind, lane) {
    const m = acquire(kind === 'tax' ? T.tax : T.tape, laneX(lane), 0, SPAWN_Z);
    world.hazards.push({ kind, lane, mesh: m, pz: SPAWN_Z });
  }
  /** A tidy line of tax cuts: always five, evenly spaced, down the middle of one lane. */
  const CUTS_PER_LINE = 5, CUT_SPACING = 2.4;
  function spawnTaxCuts(lane) {
    const golden = Math.random() < POWER.goldChance;   // now and then the first one is a golden SURPLUS, worth ten
    for (let i = 0; i < CUTS_PER_LINE; i++) {
      const z = SPAWN_Z - i * CUT_SPACING, gold = golden && i === 0;
      world.taxCuts.push({ lane, cy: 1.0, gold, mesh: acquire(gold ? T.goldCut : T.taxCut, laneX(lane), 1.0, z), pz: z, bob: i * 0.7 });
    }
  }
  function spawnPowerup(kind, lane) {
    const m = acquire(kind === 'scissors' ? T.scissorsPickup : T.consultant, laneX(lane), 1.1, SPAWN_Z);
    world.powerups.push({ kind, lane, mesh: m, pz: SPAWN_Z });
  }
  function spawnBoss() {
    const kind = BOSS_ORDER[S.bossCount++ % BOSS_ORDER.length];
    const lane = Math.floor(Math.random() * 3);
    const m = acquire(T[kind], laneX(lane), 0, SPAWN_Z - 4);
    const warn = new THREE.Mesh(warnGeo, warnMat);
    warn.visible = false;
    warn.renderOrder = 2;
    scene.add(warn);
    world.bosses.push({
      kind, lane, mesh: m, pz: m.position.z, warn, passed: false,
      swapT: rand(1.4, 2.6), throwT: rand(0.9, 1.5), warnT: 0, throwing: 0, anim: Math.random() * 10, pose: null,
    });
    audio.sfx.boss();
    const c = CHARACTERS[kind];
    toast(kind, c.name, 'Red tape incoming. Watch the lanes!');
    news('boss', true);
  }
  function spawnShot(b) {
    const z = b.mesh.position.z + 1.2;
    const m = acquire(T.shot, laneX(b.lane), 1.15, z);
    world.shots.push({ lane: b.lane, mesh: m, pz: z, from: b.kind });
    audio.sfx.orb();
  }
  function spawnScenery(side) {
    const r = Math.random();
    const tpl = r < 0.12 ? pick(T.screens) : r < 0.25 ? pick(T.billboards) : r < 0.55 ? T.crowd : Math.random() < 0.5 ? pick(T.buildings) : T.tree;
    world.scenery.push({ mesh: acquire(tpl, side * rand(8, 12), 0, SPAWN_Z) });
  }

  function shuffledLanes() {
    const a = [0, 1, 2];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /* Row patterns. Every pattern leaves at least one lane free of hazards, and harder ones unlock as the run goes on. */
  const PATTERNS = [
    { w: () => 1.4, safe: true, run: (a) => spawnTaxCuts(a) },
    { w: () => 1.2, run: (a, b) => { spawnHazard('tax', a); if (Math.random() < 0.7) spawnTaxCuts(b); } },
    { w: (d) => 0.6 + d, run: (a, b, c) => { spawnHazard('tax', a); spawnHazard('tax', b); spawnTaxCuts(c); } },
    { w: () => 1.3, run: (a, b) => { spawnHazard('tape', a); spawnTaxCuts(b); } },
    { w: (d) => d * 1.3, run: (a, b, c) => { spawnHazard('tape', a); spawnHazard('tape', b); spawnTaxCuts(c); } },
    { w: (d) => d * 1.1, run: (a, b, c) => { spawnHazard('tax', a); spawnHazard('tape', b); spawnTaxCuts(c); } },
    { w: () => POWER.powerupChance * 6, safe: true, run: (a, b) => { spawnPowerup(pick(['scissors', 'consultant']), a); spawnTaxCuts(b); } },   // a power-up in one lane, tax cuts in another
  ];
  function spawnRow() {
    const d = clamp(S.time / 90, 0, 1);
    const bossNear = world.bosses.some((b) => b.mesh.position.z > SPAWN_Z + 8 && b.mesh.position.z < 3);
    const pool = PATTERNS.filter((p) => !bossNear || p.safe || S.car);   // while a boss is on the road, only pickups: the boss is the obstacle
    let total = 0;
    const ws = pool.map((p) => (total += Math.max(0, p.w(d)), total));
    const r = Math.random() * total;
    const p = pool[ws.findIndex((v) => r <= v)] || pool[0];
    const [a, b, c] = shuffledLanes();
    p.run(a, b, c);
  }

  /* ---------- player ---------- */
  const tapeWrap = new THREE.Group();   // red tape that wraps him when an orb hits
  {
    const red = new THREE.MeshStandardMaterial({ color: 0xd7141f, emissive: 0x3a0306, transparent: true });
    tapeWrap.userData.mat = red;
    for (const [y, t, w, d] of [[1.52, 0.14, 1.06, 0.44], [1.76, -0.14, 1.06, 0.44], [2.0, 0.14, 1.06, 0.44], [1.18, -0.1, 0.58, 0.3], [0.92, 0.2, 0.58, 0.3], [0.66, -0.2, 0.58, 0.3], [0.4, 0.2, 0.58, 0.3], [0.16, -0.12, 0.58, 0.3]]) {
      const m = mesh(new THREE.BoxGeometry(w, 0.085, d), red);
      m.position.y = y;
      m.rotation.z = t;
      tapeWrap.add(m);
    }
    tapeWrap.visible = false;
    player.add(tapeWrap);
  }

  /** A gentle toss: the tape tugs him into a neighbouring lane and lofts him in a smooth backflip. Controls lock for under half a second. */
  function tapeThrow(withTape = true) {
    if (S.mode !== 'playing' && S.mode !== 'dying') return;
    S.thrown = 0.45;
    S.tapeLeft = withTape ? 1.1 : 0;
    const dir = S.lane === 0 ? 1 : S.lane === 2 ? -1 : Math.random() < 0.5 ? -1 : 1;
    S.lane = clamp(S.lane + dir, 0, 2);
    S.throwDir = dir;
    S.vy = JUMP_V * 0.62;
    S.throwAir = S.vy / PHYS.gravityUp + S.vy / Math.sqrt(PHYS.gravityUp * PHYS.gravityDown);   // up time + down time
    S.airT = 0;
    S.onGround = false;
    S.fastFalling = false;
    S.noSpin = true;   // no turn-to-camera spin during a toss
    if (withTape) audio.sfx.tape();
  }

  const AIR_MIX = new Array(POSE_N).fill(0);   // scratch pose for blending the jump poses
  const CAUSES = {
    tax: 'Blown up by a tax bomb',
    tape: 'Tangled in red tape',
    boss: (by) => `Ran into ${CHARACTERS[by]?.name ?? 'the Government'}`,
    shot: (by) => `Wrapped in ${CHARACTERS[by]?.name ?? 'the Government'}'s red tape`,
  };

  function hurt(cause = 'tape', by = '') {
    if (S.car) return false;   // nothing hurts him in the car
    if (S.invuln > 0 || S.mode !== 'playing') return false;
    if (S.shield > 0) {   // a boss can't be cracked open: his touch pops the shield instead (everything else the shield just breaks)
      S.shield = 0; S.shieldT = 0; S.invuln = 1.0; S.shake = Math.max(S.shake, 0.4);
      fx.burst(player.position.x, S.y + 1.5, 0, 0x1f4fb8, 22, { speed: 5, up: 3, life: 0.6 });
      popup('CONSULTANT TAKES THE BLAME!', '#3a6fe0');
      news('blame', true);
      audio.sfx.blame();
      return false;
    }
    S.lives--;
    S.invuln = PHYS.hitInvuln;
    S.shake = 0.9;
    S.hitStop = 0.07;
    S.glance = 1.2;
    S.slow = 0.78;               // a little rubber-banding so you can recover
    S.streak = 0; S.mult = 1;
    S.hitBy = typeof CAUSES[cause] === 'function' ? CAUSES[cause](by) : CAUSES[cause];
    S.hitById = by;
    fx.hit(player.position.x, S.y + 1.3, 0);
    glass.punch(0.8);
    comic(pick(['WHAM!', 'BONK!', 'THUD!', 'OOF!']), '#ff8a8a');
    flash();
    vibrate(120);
    audio.sfx.hit();
    popup(pick(['OUCH!', 'AUDITED!', 'RED TAPE!', 'DENIED!', 'NOT TODAY!']), '#ff6b6b');
    if (S.lives > 0) news(S.lives === 1 ? 'lastLife' : ({ tape: 'hitTape', tax: 'hitTax', boss: 'hitBoss', shot: 'hitShot' })[cause], true);
    else beginDying();
    return true;
  }

  /** The tax bomb: a stack of tax papers goes off under him. */
  function detonate(m) {
    boom.explode(m.position.x, 1.0, m.position.z - 1.4, 0.6);   // a little ahead of him, so the blast is on screen as he runs into it
    shockAt(_v.set(m.position.x, 1.0, m.position.z - 1.4));
    boomGlow = 1;
    if (!reduceMotion()) { const b = $('blast'); b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); }
    S.shake = Math.max(S.shake, 1.7);
    S.hitStop = 0.1;
    S.slow = 0.5;   // the blast knocks the wind out of the run
    vibrate(220);
    audio.sfx.explosion();
    popup('TAX BOMB!', '#ffb347');
  }
  /** With the blame shield up, whatever he runs into cracks open (crack.js takes over `m` and releases it when it breaks). */
  function crackOpen(kind, m) {
    crack.open(kind, m, release);
    cos.shieldPulse();
    fx.burst(m.position.x, m.position.y + 1.0, m.position.z, 0x2a5cc8, 20, { speed: 6, up: 4, life: 0.6 });
    S.cutScore += POWER.crackBonus;
    S.shake = Math.max(S.shake, 0.45);
    popup(pick(['CRACKED OPEN!', 'SHATTERED!', 'SMASHED!']), '#3a6fe0');
    audio.sfx.crack();
  }

  /* Hit testing uses real boxes. z is swept from where the object was last step to where it is now, so nothing tunnels at speed. */
  function collide() {
    const car = !!S.car;   // in the car he is much bigger, and everything he touches is smashed
    const px = player.position.x, hw = car ? 0.95 : PHYS.playerHalfW, hd = car ? 1.5 : PHYS.playerHalfD;
    const y0 = S.y, y1 = S.y + (car ? 1.2 : PHYS.playerHeight);
    const hits = (x, ya, yb, z, pz, halfW, halfD) =>
      Math.abs(px - x) < halfW + hw && y0 < yb && y1 > ya &&
      Math.max(z, pz) + halfD > -hd && Math.min(z, pz) - halfD < hd;

    for (let i = world.hazards.length - 1; i >= 0; i--) {
      const h = world.hazards[i], f = HAZ[h.kind], m = h.mesh;
      if (!hits(m.position.x, 0, f.h, m.position.z, h.pz, f.halfW, f.halfD)) continue;
      if (car) {
        world.hazards.splice(i, 1);
        carSmashHazard(h.kind, m);
      } else if (S.shieldT > 0) {   // the blame shield cracks it open
        world.hazards.splice(i, 1);
        crackOpen(h.kind, m);
      } else if (S.cutT > 0) {   // the ceremonial scissors cut straight through it
        fx.burst(m.position.x, 1.0, m.position.z, 0xff6a73, 16, { speed: 5, up: 3, life: 0.6 });
        release(m);
        world.hazards.splice(i, 1);
        S.cutScore += POWER.scissorsBonus;
        popup(pick(['SNIP!', 'RIBBON CUT!', 'CUT THROUGH!']), '#ff6a73');
        audio.sfx.snip();
      } else if (h.kind === 'tax') {   // a tax stack goes off in his face
        if (hurt('tax')) {
          world.hazards.splice(i, 1);
          const dying = S.mode === 'dying';
          tapeThrow(false);   // (the run's own state: he changes lane and hops, so the game carries on in step with the ragdoll)
          detonate(m);
          release(m);
          const side = S.throwDir || 1;
          ragdollPlayer({ vel: new THREE.Vector3(side * rand(3, 5), dying ? rand(12, 14) : rand(9, 10.5), rand(2, 5)), spin: rand(6, 9) * (Math.random() < 0.5 ? -1 : 1), axis: new THREE.Vector3(1, 0, 0.3).normalize(), tether: !dying, gravityScale: dying ? 1 : 1.7 });
        }
      } else hurt(h.kind);
    }
    for (const b of world.bosses) {
      const m = b.mesh;
      if (b.ragE) continue;
      if (hits(m.position.x, 0, bossHeight, m.position.z, b.pz, 0.5, 0.32)) { if (car) carHitBoss(b); else { b.touched = true; hurt('boss', b.kind); } }
      if (!b.passed && m.position.z > 1.2) {   // got past a boss without touching him
        b.passed = true;
        if (S.mode === 'playing' && !b.touched) { S.cutScore += 50; popup('DODGED! +50', '#ffd34d'); }
      }
    }
    for (let i = world.shots.length - 1; i >= 0; i--) {
      const sh = world.shots[i], m = sh.mesh;
      if (hits(m.position.x, 0.75, 1.55, m.position.z, sh.pz, 0.25, 0.4)) {
        world.shots.splice(i, 1);
        if (car) carSmashHazard('shot', m);
        else if (S.shieldT > 0) crackOpen('shot', m);
        else { release(m); if (hurt('shot', sh.from)) tapeThrow(); }
      }
    }
    for (let i = world.taxCuts.length - 1; i >= 0; i--) {
      const c = world.taxCuts[i], m = c.mesh;
      if (hits(m.position.x, c.cy - 0.5, c.cy + 0.4, m.position.z, c.pz, 0.36, 0.12)) {
        collectTaxCut(m, c.gold);
        release(m);
        world.taxCuts.splice(i, 1);
      }
    }
    for (let i = world.powerups.length - 1; i >= 0; i--) {
      const pu = world.powerups[i], m = pu.mesh;
      if (hits(m.position.x, 0.4, 1.9, m.position.z, pu.pz, 0.5, 0.3)) {
        collectPowerup(pu.kind);
        release(m);
        world.powerups.splice(i, 1);
      }
    }
  }

  function collectPowerup(kind) {
    S.glance = 0.7;
    fx.burst(player.position.x, S.y + 1.5, 0, kind === 'scissors' ? 0xff6a73 : 0x1f4fb8, 22, { speed: 5, up: 3, life: 0.7 });
    audio.sfx.power();
    if (kind === 'scissors') { S.cutT = POWER.scissorsSecs; popup('RIBBON-CUTTING CEREMONY!', '#ff6a73'); news('scissors', true); }
    else { S.shieldT = POWER.shieldSecs; S.shield = 1; popup('BLAME SHIELD UP!', '#3a6fe0'); news('consultant', true); }
  }

  function collectTaxCut(m, gold = false) {
    const val = gold ? POWER.goldValue : 1, before = S.taxCuts;
    S.taxCuts += val;
    S.streak++;
    S.bestStreak = Math.max(S.bestStreak, S.streak);
    const mult = Math.min(5, 1 + Math.floor(S.streak / 10));
    if (mult > S.mult) popup(`x${mult} STREAK!`, '#ffd34d');
    S.mult = mult;
    S.cutScore += 10 * mult * val;
    S.glance = 0.7;
    W.coins += val;
    if (Math.floor(before / 5) !== Math.floor(S.taxCuts / 5)) saveWallet();
    for (const ms of [1, 10, 25, 50, 100, 150]) if (before < ms && S.taxCuts >= ms) news('tc' + ms, true);
    if (before < BUDGET_AT && S.taxCuts >= BUDGET_AT) { S.budgetT = BUDGET_SECS; popup('LIBERAL BUDGET!', '#3a6fe0'); audio.sfx.budget(); news('budget', true); }
    const call = STREAK_CALLS[S.streak];
    if (call) { popup(call, '#ffd34d'); news('streak', true); audio.sfx.fanfare(); }
    else if (gold) { popup('SURPLUS FOUND! +10', '#ffd34d'); news('gold', true); audio.sfx.gold(); }
    else { popup(pick(PICKUP_POPS), '#7CFC9A'); audio.sfx.coin(S.streak); if (Math.random() < 0.2) news('taxcut'); }
  }

  function prune() {
    for (const k in world) {
      const list = world[k];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].mesh.position.z > DESPAWN_Z || (list[i].ragE && (list[i].ragE.t > 4.5 || list[i].mesh.position.z < -150))) {
          if (list[i].warn) scene.remove(list[i].warn);
          if (list[i].ragE) { endRagdoll(list[i].ragE); resetPerson(list[i].mesh); }
          release(list[i].mesh);
          list.splice(i, 1);
        }
      }
    }
  }

  function clearWorld() {
    sbCleanup();
    if (S.car) setCar(false, true);
    carFx.visible = false;
    for (const k in world) {
      for (const e of world[k]) { if (e.warn) scene.remove(e.warn); if (e.ragE) { endRagdoll(e.ragE); resetPerson(e.mesh); } release(e.mesh); }
      world[k].length = 0;
    }
    for (const e of [...ragdolls]) endRagdoll(e);
    clearBombs();
    if (S.ko) { S.ko.mesh.scale.setScalar(1); release(S.ko.mesh); S.ko = null; }
    S.bossKO = false;
    S.blast = null; S.throwing = null; S.cine = null;
    debris.clear();
    phys.clear();
    bounds.length = 0;
    addRunBounds();
    fx.clear();
    crack.clear();
    boom.clear();
    boomGlow = 0;
    $('fx').replaceChildren();
    popCount = 0;
  }

  /* ---------- game flow ---------- */
  const show = (id, on) => $(id).classList.toggle('hidden', !on);

  function setMode(mode) {
    S.mode = mode;
    worldFx.stageMode(mode === 'menu');
    cos.resetCape();   // the player moves between the stage and the road
    $('pauseBtn').style.display = mode === 'playing' ? 'block' : 'none';
    $('hud').style.display = mode === 'menu' || mode === 'loading' || mode === 'sandbox' ? 'none' : 'flex';
    $('sbBar').classList.toggle('hidden', mode !== 'sandbox');
    $('sbHint').classList.toggle('hidden', mode !== 'sandbox');
    document.body.dataset.mode = mode;
    if (mode === 'menu') { audio.music.setIntensity(0.35); audio.music.setTempo(0); }
  }

  function startGame() {
    if (S.mode === 'playing' || S.mode === 'paused' || S.mode === 'dying' || S.mode === 'countdown') return;
    audio.unlock();
    clearWorld();
    Object.assign(S, {
      time: 0, speed: RUN.startSpeed, dist: 0, taxCuts: 0, cutScore: 0, streak: 0, bestStreak: 0, mult: 1, lives: 3,
      lane: 1, vx: 0, y: 0, vy: 0, onGround: true, airT: 0, fastFalling: false, invuln: 1.0, shake: 0, hitStop: 0, slow: 1,
      rowDist: 22, sceneryDist: 0, nextBossDist: 180, bossCount: 0, thrown: 0, tapeLeft: 0, noSpin: false, budgetT: 0, cutT: 0, shield: 0, shieldT: 0,
      jumpBufferT: 0, laneBuffer: 0, laneBufferDir: 0, hitBy: '', hitById: '', newBest: false, dyingT: 0, apex: 0, throwing: null, blast: null, timeScale: 1, cine: null, jumpCount: 0, chain: 0, bossKO: false, ko: null, sinceLand: 99,
    });
    if ((W.bombs || 0) < BOMB.freePerRun) { W.bombs = BOMB.freePerRun; saveWallet(); }   // a complimentary bomb every run
    S.car = false;
    setCar(W.carOn && (W.carSecs || 0) > 0, true);   // he starts in the car if he left it on
    player.position.set(0, 0, 0);
    show('menu', false);
    show('over', false);
    show('pause', false);
    setMode('playing');
    audio.music.start();
    audio.music.setIntensity(1);
    news('start', true);
    glass.storm();   // the rain comes down hard for the first few seconds
    if (!helpSeen()) { $('hint').classList.add('show'); setTimeout(() => $('hint').classList.remove('show'), 6500); }
  }

  function beginDying() {
    S.mode = 'dying';
    S.dyingT = 0;
    document.body.dataset.mode = 'dying';
    $('pauseBtn').style.display = 'none';
    audio.music.stop();
    audio.sfx.over();
  }

  function gameOver() {
    const score = scoreNow();
    S.newBest = score > S.best;
    if (S.newBest) { S.best = score; saveBest(score); }
    saveWallet();
    markHelpSeen();
    $('hint').classList.remove('show');
    $('finalScore').textContent = String(score);
    $('overStats').textContent = `${Math.floor(S.dist)} m  ·  ${S.taxCuts} tax cuts  ·  best streak ${S.bestStreak}`;
    const rank = RANKS.filter(([min]) => score >= min).pop()[1];
    $('overTitle').textContent = pick(OVER_TITLES);
    $('overMsg').textContent = `${S.newBest ? 'New best! Angus is not paying this.' : `Best ${S.best}`}  ·  Rank: ${rank}`;
    $('overMsg').classList.toggle('best', S.newBest);
    const by = $('overBy');
    by.textContent = S.hitBy || 'Audited!';
    const portrait = $('overPortrait');
    if (CHARACTERS[S.hitById]) { portrait.src = new URL(CHARACTERS[S.hitById].face, import.meta.url).href; portrait.style.display = 'block'; } else portrait.style.display = 'none';
    setMode('over');
    news('over', true, { score });
    S.overAt = performance.now();
    if (S.newBest) audio.sfx.best();
    show('over', true);
    $('againBtn').focus({ preventScroll: true });
  }

  function pauseGame() {
    if (S.mode !== 'playing') return;
    setMode('paused');
    show('pause', true);
    audio.suspend();
    $('resumeBtn').focus({ preventScroll: true });
  }
  function resumeGame() {
    if (S.mode !== 'paused') return;
    show('pause', false);
    show('settings', false);
    audio.resume();
    S.mode = 'countdown';
    document.body.dataset.mode = 'countdown';
    S.countdown = 1.5;
    S.countShown = 4;
  }

  function changeLane(d) {
    if (S.mode !== 'playing') return;
    if (S.thrown > 0) { S.laneBuffer = PHYS.laneBuffer; S.laneBufferDir = d; return; }   // remembered until the toss ends
    const next = clamp(S.lane + d, 0, 2);
    if (next === S.lane) return;
    S.lane = next;
    audio.sfx.lane();
    $('hint').classList.remove('show');
    if (Math.random() < 0.25) news('lane');
  }

  function jump() {
    if (S.mode !== 'playing') return;
    if (!S.onGround || S.thrown > 0) { S.jumpBufferT = PHYS.jumpBuffer; return; }   // pressed a touch early: it fires on landing
    S.vy = JUMP_V;
    S.airT = 0;
    S.apex = 0;
    S.onGround = false;
    S.fastFalling = false;
    S.chain = (S.sinceLand ?? 99) < 1 && (S.chain || 0) > 0 ? S.chain + 1 : 1;   // jumps in quick succession build a chain
    S.sinceLand = 0;
    if (S.chain >= 2) { popup(`JUMP CHAIN x${S.chain}`, S.chain >= 5 ? '#ff6b6b' : '#7fb2ff'); S.cutScore += 5 * S.chain; }
    S.jumpCount = (S.jumpCount || 0) + 1;
    if (S.jumpCount >= 10) { S.jumpCount = 0; S.bossKO = true; popup('10 JUMPS!  BOSS KNOCKOUT!', '#ff6b6b'); audio.sfx.fanfare(); }
    fx.dust(player.position.x, 0.1, 0, 4, { size: 0.5, spread: 1.4, alpha: 0.2, up: 0.4 });   // the push-off kicks up spray
    audio.sfx.jump();
    $('hint').classList.remove('show');
    if (Math.random() < 0.3) news('jump');
  }

  function fastFall() {
    if (S.mode !== 'playing' || S.onGround || S.noSpin) return;
    S.fastFalling = true;
  }

  function land() {
    const hard = S.fastFalling || S.vy < -22;
    S.y = 0;
    S.vy = 0;
    S.onGround = true;
    if (S.fastFalling) { S.shake = Math.max(S.shake, 0.3); vibrate(15); }
    S.fastFalling = false;
    fx.landing(player.position.x, 0);
    if (hard || S.apex > 1) audio.sfx.land();
    if (S.jumpBufferT > 0) { S.jumpBufferT = 0; jump(); }
  }

  /* ---------- input ---------- */
  function onFirstGesture() {
    audio.unlock();
    if (S.mode === 'menu') audio.music.start();
  }
  const primaryKeys = ['enter', ' '];
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k) && !e.target.closest?.('button, input, label')) e.preventDefault();
    if (e.repeat) return;
    onFirstGesture();
    if (k === 'm') { settings.sfx = settings.music = !(settings.sfx || settings.music); applySettings(); return; }
    const inOverlay = e.target.closest?.('button, input');
    if (k === 'c' && (S.mode === 'menu' || S.mode === 'playing')) { toggleCar(); return; }
    if (S.mode === 'menu') { if (!inOverlay && primaryKeys.includes(k)) startGame(); return; }
    if (S.mode === 'over') {
      if (!inOverlay && primaryKeys.includes(k) && performance.now() - S.overAt > 700) startGame();
      return;
    }
    if (S.mode === 'paused') {
      if (k === 'p' || k === 'escape' || (!inOverlay && primaryKeys.includes(k))) resumeGame();
      return;
    }
    if (S.mode === 'sandbox') {
      if (k === 'escape') backToMenu();
      else if (k === 'r') sbReset();
      else if (k === 't') sbToggleSlow();
      else if (k >= '1' && k <= '5') sbSetTool(SB_TOOLS[Number(k) - 1]);
      else if (k === 'b') sbSetTool('bomb');
      else if (k === 'arrowleft') sb.yaw += 0.12;
      else if (k === 'arrowright') sb.yaw -= 0.12;
      else if (k === 'arrowup') sb.pitch = clamp(sb.pitch + 0.08, -0.1, 1.2);
      else if (k === 'arrowdown') sb.pitch = clamp(sb.pitch - 0.08, -0.1, 1.2);
      return;
    }
    if (S.mode !== 'playing') return;
    if (k === 'arrowleft' || k === 'a') changeLane(-1);
    else if (k === 'arrowright' || k === 'd') changeLane(1);
    else if (k === 'arrowup' || k === 'w' || k === ' ') jump();
    else if (k === 'arrowdown' || k === 's') fastFall();
    else if (k === 'b') useBomb();
    else if (k === 'p' || k === 'escape') pauseGame();
  });

  // Touch and mouse: swipe sideways to change lane, up to jump, down to fall fast, tap to jump.
  let touch = null;
  addEventListener('pointerdown', (e) => { onFirstGesture(); touch = { x: e.clientX, y: e.clientY, used: false }; });
  addEventListener('pointermove', (e) => {
    if (!touch || S.mode !== 'playing') return;
    const dx = e.clientX - touch.x, dy = e.clientY - touch.y;
    if (Math.abs(dx) > 32 && Math.abs(dx) > Math.abs(dy)) { changeLane(dx > 0 ? 1 : -1); touch.x = e.clientX; touch.y = e.clientY; touch.used = true; }
    else if (dy < -34 && Math.abs(dy) > Math.abs(dx)) { jump(); touch.x = e.clientX; touch.y = e.clientY; touch.used = true; }
    else if (dy > 34 && Math.abs(dy) > Math.abs(dx)) { fastFall(); touch.x = e.clientX; touch.y = e.clientY; touch.used = true; }
  });
  const endTouch = (e) => {
    if (!touch) return;
    const t = touch;
    touch = null;
    if (e.type === 'pointerup' && S.mode === 'playing' && !t.used && Math.abs(e.clientX - t.x) < 14 && Math.abs(e.clientY - t.y) < 14) jump();
  };
  addEventListener('pointerup', endTouch);
  addEventListener('pointercancel', endTouch);

  // UI buttons stop their pointer events reaching the swipe handler above.
  for (const id of ['pauseBtn', 'muteBtn', 'bombBtn', 'carBtn']) {
    $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    $(id).addEventListener('pointerup', (e) => e.stopPropagation());
  }
  const press = (id, fn) => $(id).addEventListener('click', (e) => { e.currentTarget.blur(); audio.unlock(); audio.sfx.click(); fn(e); });

  press('pauseBtn', pauseGame);
  press('bombBtn', () => useBomb());
  press('carBtn', toggleCar);
  press('sandboxBtn', startSandbox);
  for (const b of document.querySelectorAll('#sbBar [data-tool]')) b.addEventListener('click', (e) => { e.currentTarget.blur(); sbSetTool(e.currentTarget.dataset.tool); });
  press('sbReset', sbReset);
  press('sbSlow', sbToggleSlow);
  press('sbMenu', () => backToMenu());
  press('startBtn', startGame);
  press('againBtn', startGame);
  press('resumeBtn', resumeGame);
  press('quitBtn', () => { show('pause', false); show('settings', false); clearWorld(); backToMenu(); });
  press('menuBtn', () => { show('over', false); backToMenu(); });
  press('muteBtn', () => { settings.sfx = settings.music = !(settings.sfx || settings.music); applySettings(); });

  function backToMenu() {
    clearWorld();
    player.position.set(0, 0, 0);
    Object.assign(S, { lane: 1, y: 0, vy: 0, onGround: true, vx: 0, thrown: 0, tapeLeft: 0, invuln: 0, glance: 0, noSpin: false, recover: 0, fastFalling: false });
    show('menu', true);
    setMode('menu');
    audio.resume();
    audio.music.start();
    $('startBtn').focus({ preventScroll: true });
    $('menuBest').textContent = S.best ? `Best ${S.best}` : '';
  }

  /* ---------- shop & settings ---------- */
  let shopFrom = 'menu';
  function renderShop() {
    $('walletLine').textContent = `Wallet: ${W.coins} tax cuts`;
    const list = $('shopList');
    list.replaceChildren();
    for (const it of ITEMS) {
      const row = document.createElement('div');
      row.className = 'row';
      const label = document.createElement('span');
      const isCar = it.id === 'car', have = isCar ? W.carSecs || 0 : W.bombs || 0;
      label.textContent = it.consumable ? `${it.name} (you have ${isCar ? fmtT(have) : have})` : it.name;
      const btn = document.createElement('button');
      if (it.consumable) {   // the bomb: buy up to BOMB.max
        const full = isCar ? have >= CAR.maxSecs : have >= BOMB.max;
        btn.textContent = full ? 'Full' : `Buy ${it.price}`;
        btn.disabled = full || W.coins < it.price;
        btn.onclick = () => {
          audio.unlock();
          W.coins -= it.price;
          if (isCar) W.carSecs = Math.min(CAR.maxSecs, (W.carSecs || 0) + CAR.secs); else W.bombs = (W.bombs || 0) + 1;
          audio.sfx.buy(); saveWallet(); renderShop();
        };
        row.append(label, btn);
        list.appendChild(row);
        continue;
      }
      btn.textContent = W.owned[it.id] ? (W.equipped[it.id] ? 'Unequip' : 'Equip') : `Buy ${it.price}`;
      btn.disabled = !W.owned[it.id] && W.coins < it.price;
      btn.onclick = () => {
        audio.unlock();
        if (!W.owned[it.id]) { W.coins -= it.price; W.owned[it.id] = true; W.equipped[it.id] = true; audio.sfx.buy(); } else { W.equipped[it.id] = !W.equipped[it.id]; audio.sfx.click(); }
        if (W.equipped[it.id] && it.slots) {   // one item per slot: equipping this takes off anything it overlaps
          for (const o of ITEMS) if (o !== it && o.slots && o.slots.some((s) => it.slots.includes(s))) W.equipped[o.id] = false;
        }
        saveWallet();
        cos.apply();
        renderShop();
      };
      row.append(label, btn);
      list.appendChild(row);
    }
  }
  const openShop = (from) => () => { shopFrom = from; show(from, false); renderShop(); show('shop', true); $('shopClose').focus({ preventScroll: true }); };
  press('shopBtn', openShop('menu'));
  press('shopBtn2', openShop('over'));
  press('shopClose', () => { show('shop', false); show(shopFrom, true); });
  // Debug helper: add #debug to the URL to get a tax-cut cheat in the shop.
  if (/debug/.test(location.hash + location.search)) {
    const a = document.createElement('a');
    a.href = '#'; a.textContent = ' [+50]'; a.id = 'shopTest';
    a.onclick = (e) => { e.preventDefault(); W.coins += 50; saveWallet(); renderShop(); };
    $('walletLine').after(a);
  }

  let settingsFrom = 'menu';
  function applySettings() {
    audio.configure({ sfx: settings.sfx, music: settings.music });
    $('optSfx').checked = settings.sfx;
    $('optMusic').checked = settings.music;
    $('optShake').checked = settings.shake;
    $('optGlass').checked = settings.glass;
    $('optRain').checked = settings.rain;
    $('optQuality').value = settings.quality || 'auto';
    $('muteBtn').textContent = settings.sfx || settings.music ? '🔊' : '🔇';
    $('muteBtn').setAttribute('aria-label', settings.sfx || settings.music ? 'Mute' : 'Unmute');
    document.body.classList.toggle('calm', !settings.shake);
    saveSettings();
  }
  $('optQuality').addEventListener('change', (e) => { settings.quality = e.target.value; saveSettings(); location.reload(); });   // (re-reads the setting: the render budget is chosen at start-up)
  for (const [id, key] of [['optSfx', 'sfx'], ['optMusic', 'music'], ['optShake', 'shake'], ['optGlass', 'glass'], ['optRain', 'rain']]) $(id).addEventListener('change', (e) => { settings[key] = e.target.checked; applySettings(); });
  const openSettings = (from) => () => { settingsFrom = from; show(from, false); show('settings', true); $('settingsClose').focus({ preventScroll: true }); };
  press('settingsBtn', openSettings('menu'));
  press('settingsBtn2', openSettings('pause'));
  press('settingsClose', () => { show('settings', false); show(settingsFrom, true); });
  applySettings();

  /* ---------- pose, camera ---------- */
  function animatePlayer(dt) {
    cos.animate(dt);
    // The body runs away from the camera; the head turns back over the shoulder on pickups and hits,
    // and faces the camera on the pause and game-over screens.
    const glancing = (S.mode === 'paused' || S.mode === 'over' || S.glance > 0) && S.onGround;
    const sp = S.pose;   // last frame's pose: the head counter-rotates against the chest so he keeps looking down the road
    playerHead.rotation.y = damp(playerHead.rotation.y, glancing ? Math.PI * 0.92 : sp ? -sp[12] * 0.8 : 0, 12, dt);
    S.glance = Math.max(0, S.glance - dt);

    // Mid-jump he turns round to face the camera and back again. Progress follows his height (up, then down),
    // so it always finishes exactly at the landing, even after a fast fall.
    const flying = S.mode === 'playing' && !S.onGround && !S.noSpin;
    let spin = 0;
    if (flying && S.apex > 0.05) spin = S.vy > 0 ? 0.5 * (S.y / S.apex) : 1 - 0.5 * (S.y / S.apex);
    player.rotation.y = Math.PI + Math.PI * Math.sin(Math.PI * clamp(spin, 0, 1));

    const taped = !!W.equipped.tape;
    const playing = S.mode === 'playing' || S.mode === 'dying';
    const tossing = S.noSpin && !S.onGround;
    if (!S.onGround) S.wasAir = true; else if (S.wasAir) { S.wasAir = false; S.settle = 0.3; }   // just landed: ease from the air pose into the run
    S.settle = Math.max(0, S.settle - dt);
    player.rotation.x = 0;
    player.rotation.z = 0;
    playerHead.rotation.x = (sp ? -sp[13] * 0.75 : 0) + Math.sin(S.runT * 2) * (playing && S.onGround ? 0.03 : 0);
    playerHead.rotation.z = sp ? -sp[14] * 0.8 : 0;
    if (S.mode !== 'playing' && S.mode !== 'dying') { S.thrown = 0; S.tapeLeft = 0; }
    S.thrown = Math.max(0, S.thrown - dt);
    S.tapeLeft = Math.max(0, S.tapeLeft - dt);
    tapeWrap.visible = S.tapeLeft > 0;
    tapeWrap.userData.mat.opacity = Math.min(1, S.tapeLeft / 0.4);   // the tape fades away over its last moments

    // choose the pose to move towards, and how quickly
    let tgt, rate = 20;
    const lean = clamp(S.vx * 0.032, -0.32, 0.32);   // lean into lane changes
    if (tossing) {   // the toss: yank, tuck, flip, open out
      const k = Math.min(1, S.airT / (S.throwAir || 1));
      const p = tossPose(k);
      tgt = p.slice(1, 13).concat([0, 0.2, 0, 0.3, 0.3]); rate = 12;
      playerHead.rotation.x = p[13];
      player.rotation.z = S.throwDir * p[14];
      const f = clamp((k - 0.12) / 0.73, 0, 1);   // the flip starts after the yank and finishes before landing
      player.rotation.x = -(0.5 - 0.5 * Math.cos(Math.PI * f)) * Math.PI * 2;
    } else if (taped) {   // wrapped in red tape: limbs bound, so he hops and limps
      if (S.onGround && playing) S.runT += dt * S.speed * 0.45;
      const s = playing && S.onGround ? Math.sin(S.runT) : 0;
      player.position.y += Math.abs(s) * 0.4;
      player.rotation.z = s * 0.12 + lean;
      player.rotation.x = playing ? -0.1 : 0;
      tgt = new Array(POSE_N).fill(0);
    } else if (S.onGround) {
      if (playing) S.runT += dt * S.speed * 0.6;
      const gait = 0.92 + 0.2 * clamp((S.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed), 0, 1);   // longer strides and harder arm drive as he speeds up
      tgt = cyclePose(S.runT, playing ? gait : 0);
      rate = playing ? (S.settle > 0 ? 12 : 40) : 10;
      if (playing) { player.position.y += Math.abs(Math.sin(S.runT)) * 0.085; player.rotation.x = -0.05; player.rotation.z = lean + Math.sin(S.runT) * 0.025; }   // a bounce on every stride, a little forward lean and hip sway
    } else {
      const launching = S.airT < 0.14 && S.vy > 0;   // the push-off: pushed up tall, toes pointed
      if (S.fastFalling) tgt = FALL_POSE;
      else if (launching) tgt = LAUNCH_POSE;
      else {   // he pulls his knees up as he tops out, and reaches out for the landing as he falls
        const w = clamp(1 - Math.abs(S.vy) / 9, 0, 1);
        for (let i = 0; i < POSE_N; i++) AIR_MIX[i] = AIR_POSE[i] + (TUCK_POSE[i] - AIR_POSE[i]) * w;
        tgt = AIR_MIX;
      }
      rate = launching ? 26 : 12;
      player.rotation.z = lean;
    }
    if (S.mode === 'menu') {   // standing proudly on the stage: chest out, one hand on his hip, the other presenting the sign
      const tm = performance.now() / 1000;
      player.position.set(STAGE.x - 1.5, STAGE.y + Math.sin(tm * 1.6) * 0.02, STAGE.z + 0.9);
      player.rotation.set(-0.06, -0.28, 0);
      playerHead.rotation.y = damp(playerHead.rotation.y, 0.1 + Math.sin(tm * 0.7) * 0.12, 6, dt);
      if (!taped) { tgt = MENU_POSE.slice(); tgt[9] += Math.sin(tm * 2) * 0.05; tgt[5] = Math.sin(tm * 1.3) * 0.04; tgt[13] += Math.sin(tm * 1.8) * 0.015; tgt[12] += Math.sin(tm * 0.7) * 0.05; rate = 8; } else tgt = new Array(POSE_N).fill(0);
    } else {
      player.position.z = 0;
    }

    // landing: a short crouch and stumble before he settles
    if (S.noSpin && S.onGround) { S.noSpin = false; S.recover = 0.4; }
    S.recover = Math.max(0, S.recover - dt);
    if (S.recover > 0 && playing) {
      const r = S.recover / 0.4, crouch = Math.sin(Math.PI * (1 - r));
      tgt = tgt.slice();
      tgt[0] -= 0.4 * crouch; tgt[1] -= 0.4 * crouch;   // hips fold forward
      tgt[2] += 0.8 * crouch; tgt[3] += 0.8 * crouch;   // knees bend to take the landing
      tgt[6] -= 0.3 * crouch; tgt[7] -= 0.3 * crouch;
      tgt[13] += 0.3 * crouch; tgt[15] += 0.2 * crouch; tgt[16] += 0.2 * crouch;   // chest folds over his knees
      player.scale.set(1 + 0.05 * crouch, 1 - 0.12 * crouch, 1 + 0.05 * crouch);
      player.rotation.z += S.throwDir * 0.18 * r * Math.sin((1 - r) * 14);
    } else if (!tossing && !S.onGround && S.airT < 0.14 && S.vy > 0) {   // stretch up through the push-off
      const st = 1 - S.airT / 0.14;
      player.scale.set(1 - 0.05 * st, 1 + 0.08 * st, 1 - 0.05 * st);
    } else {
      player.scale.set(1, 1, 1);
    }

    if (S.car && playing) { tgt = DRIVE_POSE.slice(); tgt[12] += S.vx * 0.012; tgt[14] = -S.vx * 0.012; rate = 16; }   // driving: hands on the wheel

    // the bomb throw: wind the right arm back, then whip it forward over the shoulder as the chest turns into it
    if (S.throwing && playing) {
      const t = S.throwing.t;
      tgt = tgt.slice();
      if (t < 0.12) { const u = t / 0.12; tgt[5] = 1.1 * u; tgt[7] = -0.7 * u; tgt[9] = 0.5 * u; tgt[12] = -0.55 * u; tgt[13] += 0.08 * u; }
      else { const v = clamp((t - 0.12) / 0.13, 0, 1), e = v * v * (3 - 2 * v), r = clamp((t - 0.3) / 0.15, 0, 1); tgt[5] = (1.1 - 3.7 * e) * (1 - r) + tgt[5] * r; tgt[7] = (-0.7 + 0.5 * e) * (1 - r) + tgt[7] * r; tgt[9] = 0.5 * (1 - r); tgt[12] = (-0.55 + 1.0 * e) * (1 - r); tgt[13] += 0.2 * e * (1 - r); }
      rate = Math.max(rate, 34);
    }

    // every joint chases its target smoothly, so changing between poses never pops
    S.pose = S.pose || new Array(POSE_N).fill(0);
    const a = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < POSE_N; i++) S.pose[i] += ((tgt[i] || 0) - S.pose[i]) * a;
    applyPose(player, S.pose);
    blob.position.x = player.position.x;
    blob.position.z = player.position.z;
    blob.visible = S.mode !== 'menu' && !S.car;
    blob.material.opacity = 0.4 / (1 + 0.8 * S.y);   // fades as he jumps
  }

  function animateBoss(b, dt) {
    const tgt = cyclePose(b.anim * 7, 0.6);   // a jog: hips, knees, arms and elbows
    if (b.warnT > 0) { tgt[5] = 1.1; tgt[7] = -0.5; tgt[9] = 0.25; tgt[12] = 0.45; tgt[13] -= 0.1; }   // arm drawn back behind the head, chest wound up: the tell
    else if (b.throwing > 0) {   // whip the arm forward, the chest following through
      const u = 1 - b.throwing / 0.35, e = u * u * (3 - 2 * u);
      tgt[5] = 1.1 - 3.5 * e;
      tgt[7] = -0.5 - 0.8 * (1 - e);
      tgt[12] = 0.45 - 0.8 * e;
      tgt[13] += 0.2 * e;
    }
    b.pose = b.pose || tgt.slice();
    const bk = 1 - Math.exp(-(b.throwing > 0 || b.warnT > 0 ? 24 : 12) * dt);
    for (let i = 0; i < POSE_N; i++) b.pose[i] += (tgt[i] - b.pose[i]) * bk;
    applyPose(b.mesh, b.pose);
    // a taunting head bob
    b.head ??= b.mesh.getObjectByName('head');
    if (b.head) b.head.rotation.z = Math.sin(b.anim * 3.1) * 0.08;
  }

  function updateBoss(b, dt, move) {
    const m = b.mesh;
    if (b.ragE) { b.pz = m.position.z; b.warn.visible = false; return; }   // limp: the physics moves him now
    b.pz = m.position.z;
    m.position.z += move;
    if (b.warnT <= 0) {   // lanes are locked while a throw is lining up, so the tell is always honest
      b.swapT -= dt;
      if (b.swapT <= 0) {
        let next;
        do { next = Math.floor(Math.random() * 3); } while (next === b.lane);
        b.lane = next;
        b.swapT = rand(1.6, 2.8);
      }
    }
    m.position.x = damp(m.position.x, LANES[b.lane], 5, dt);

    b.throwT -= dt;
    const inRange = m.position.z > -45 && m.position.z < -8;
    if (b.warnT > 0) {
      b.warnT -= dt;
      if (b.warnT <= 0) { spawnShot(b); b.throwT = rand(1.3, 2.1); b.throwing = 0.35; }
    } else if (b.throwT <= 0 && inRange && S.mode === 'playing') {
      b.warnT = 0.55;
      audio.sfx.warn();
    }
    b.throwing = Math.max(0, b.throwing - dt);
    b.anim += dt;
    animateBoss(b, dt);

    b.label ??= m.getObjectByName('label');
    if (b.label) b.label.visible = m.position.z < -3;   // the name tag is huge up close

    // the red strip on the road shows the lane the throw is coming down
    const wz0 = m.position.z + 1.2, wz1 = 2;
    b.warn.visible = b.warnT > 0 && wz1 > wz0;
    if (b.warn.visible) {
      b.warn.position.set(LANES[b.lane], 0.05, (wz0 + wz1) / 2);
      b.warn.scale.z = wz1 - wz0;
    }
  }

  let camX = 0, fovKick = 0;
  const _look = new THREE.Vector3(), _cine = new THREE.Vector3();
  function updateCamera(dt) {
    if (S.mode === 'menu') { worldFx.menuCamera(); return; }
    if (S.mode === 'sandbox') { sandboxCamera(dt); return; }
    camX = damp(camX, player.position.x * 0.5, 6, dt);
    const sh = reduceMotion() ? 0 : S.shake;
    const ph = clamp(S.y * 0.3, 0, 1.5);   // the camera rises with every jump so his head never leaves the screen
    // trauma-based shake: smooth noise (not white noise), growing with the square of the trauma, like a real handheld camera taking a hit
    const tt = performance.now() / 1000, amp = sh * sh * 0.5 + sh * 0.12;
    const nz = (f, s) => Math.sin(tt * f + s) * 0.6 + Math.sin(tt * f * 2.37 + s * 1.9) * 0.4;
    camera.position.set(camX + nz(31, 1) * amp * 0.5, (S.car ? 4.8 : 4.4) + ph + nz(37, 2) * amp * 0.35, (S.car ? 9.4 : 8.2) + nz(29, 3) * amp * 0.15);
    _look.set(camX * 0.6, 1.5 + ph * 0.7, -6);
    if (S.cine && S.mode === 'playing') {   // follow a boss as he is launched: the camera swings round to watch him fly
      const c = S.cine;
      c.t += dt;
      if (c.e && c.e.rag.active && c.t < 1.6 && Number.isFinite(c.e.rag.centre.x + c.e.rag.centre.y + c.e.rag.centre.z)) {
        // a glance towards him, not a chase: the target is clamped to stay over the road, so the street is never lost
        const w = Math.sin(Math.PI * clamp(c.t / 1.6, 0, 1)) * 0.55, rc = c.e.rag.centre;
        _look.lerp(_cine.set(clamp(rc.x, -9, 9), clamp(rc.y, 0.8, 6), clamp(rc.z, -42, 3)), w);
        camera.position.y += _cine.y * 0.12 * w;
      } else S.cine = null;
    }
    camera.lookAt(_look);
    camera.rotateZ(nz(23, 4) * amp * 0.03);
    if (!reduceMotion() && S.mode === 'playing') camera.rotateZ(-(player.position.x - camX * 2) * 0.012);   // the camera leans into lane changes
    S.shake *= Math.exp(-8 * dt);
    const target = reduceMotion() ? 0 : clamp((S.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed), 0, 1) * 7 + (S.budgetT > 0 ? 3 : 0) + (S.cutT > 0 ? 2 : 0) + (S.car ? 4 : 0);   // a wider lens as you speed up and during power-ups
    fovKick = damp(fovKick, S.mode === 'playing' ? target : 0, 2, dt);
    const base = innerWidth / innerHeight < 0.9 ? 78 : 62;
    if (Math.abs(camera.fov - (base + fovKick)) > 0.01) { camera.fov = clamp(base + fovKick, 40, 100); camera.updateProjectionMatrix(); }
    if (!Number.isFinite(camera.position.x + camera.position.y + camera.position.z) || camera.position.y > 40 || Math.abs(camera.position.x) > 40) { camera.position.set(camX, 4.4, 8.2); camera.lookAt(0, 1.5, -6); S.cine = null; }   // never let the camera leave the scene
  }

  /* ---------- per-step simulation ---------- */
  function update(dt) {
    const active = S.mode === 'playing' || S.mode === 'dying';
    if (active) {
      const sim = S.mode === 'playing';
      S.time += dt;
      S.slow = Math.min(1, S.slow + dt * 0.4);
      const ramp = 1 - Math.exp(-S.time / (RUN.rampTime * 0.7));
      S.speed = (RUN.startSpeed + (RUN.maxSpeed - RUN.startSpeed) * ramp) * S.slow;
      const move = S.speed * dt;
      S.dist += move;

      if (sim) {
        S.rowDist -= move;
        if (S.rowDist <= 0) {
          spawnRow();
          S.rowDist = Math.max(rand(14, 22), S.speed * RUN.minRowGap);   // spaced by distance, but never closer than a fair reaction time
        }
        S.sceneryDist -= move;
        if (S.sceneryDist <= 0) { spawnScenery(Math.random() < 0.5 ? -1 : 1); S.sceneryDist = rand(4.5, 8.5); }
        if (S.dist >= S.nextBossDist) { spawnBoss(); S.nextBossDist = S.dist + rand(130, 190) * (S.car ? CAR.bossEveryScale : 1); }
      }

      for (const h of world.hazards) { h.pz = h.mesh.position.z; h.mesh.position.z += move; }
      for (const c of world.taxCuts) {
        c.pz = c.mesh.position.z;
        c.mesh.position.z += move;
        c.mesh.position.y = c.cy + Math.sin(S.time * 3 + c.bob) * 0.07;   // a gentle bob
        if (!c.gold) c.mesh.rotation.y += dt * 4;   // coins spin; the golden SURPLUS sign always faces you
        const pull = S.budgetT > 0 && c.mesh.position.z > -45 ? 6 : c.mesh.position.z > -7 && c.mesh.position.z < 1 ? 3 : 0;   // the budget vacuums them in; otherwise a gentle assist when close
        if (pull) {
          if (Math.abs(c.mesh.position.x - player.position.x) < (S.budgetT > 0 ? 9 : 1.3)) c.mesh.position.x = damp(c.mesh.position.x, player.position.x, pull, dt);
          if (S.budgetT > 0) c.mesh.position.z += 14 * dt;
        }
      }
      for (const s of world.scenery) s.mesh.position.z += move;
      for (const pu of world.powerups) { pu.pz = pu.mesh.position.z; pu.mesh.position.z += move; pu.mesh.rotation.y += dt * 2.5; pu.mesh.position.y = 1.1 + Math.sin(S.time * 3.3 + pu.mesh.position.x) * 0.12; }
      for (const b of world.bosses) updateBoss(b, dt, move);
      for (const sh of world.shots) { sh.pz = sh.mesh.position.z; sh.mesh.position.z += (S.speed + 16) * dt; sh.mesh.rotateOnAxis(TAPE_AXIS, dt * 13); }   // the thrown tape spins, diagonally
      worldFx.scroll(move, performance.now() / 1000, S.dist, dt);
      fx.update(dt, move);
      crack.update(dt, move);
      boom.update(dt, move, camera.position.z);

      // vertical motion: rise slowly, fall fast, optionally slam down
      if (!S.onGround) {
        S.airT += dt;
        S.vy -= (S.vy > 0 ? PHYS.gravityUp : PHYS.gravityDown) * dt;
        if (S.fastFalling && S.vy > PHYS.fastFall) S.vy = PHYS.fastFall;
        S.y += S.vy * dt;
        S.apex = Math.max(S.apex, S.y);
        if (S.y <= 0) land();
      }
      S.invuln = Math.max(0, S.invuln - dt);
      S.budgetT = S.taxCuts === 0 ? 0 : Math.max(0, S.budgetT - dt);
      S.cutT = Math.max(0, S.cutT - dt);
      S.shieldT = Math.max(0, S.shieldT - dt);
      S.shield = S.shieldT > 0 ? 1 : 0;
      S.jumpBufferT = Math.max(0, S.jumpBufferT - dt);
      S.sinceLand = (S.sinceLand ?? 99) + dt;
      if (S.thrown <= 0 && S.laneBuffer > 0) {   // a lane change pressed during the toss
        S.laneBuffer -= dt;
        if (S.laneBufferDir) { const d = S.laneBufferDir; S.laneBufferDir = 0; changeLane(d); }
      } else if (S.thrown > 0) S.laneBuffer = Math.max(0, S.laneBuffer);

      if (sim) { collide(); }
      prune();
      audio.music.setTempo(clamp((S.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed), 0, 1));
    } else if (S.mode === 'sandbox') {
      fx.update(dt, 0);
      crack.update(dt, 0);
      boom.update(dt, 0, camera.position.z);
      worldFx.scroll(0, performance.now() / 1000, 0, dt);   // (the lights keep sweeping)
      updateSandbox(dt);
    } else if (S.mode === 'over') {   // the game-over screen: the last blast keeps burning behind the card
      fx.update(dt, 0);
      crack.update(dt, 0);
      boom.update(dt, 0, camera.position.z);
    } else if (S.mode === 'countdown') {
      S.countdown -= dt;
      const n = Math.ceil(S.countdown / 0.5);
      if (n !== S.countShown && n >= 1) { S.countShown = n; $('count').textContent = String(n); $('count').classList.remove('pulse'); void $('count').offsetWidth; $('count').classList.add('pulse'); }
      if (S.countdown <= 0) { $('count').textContent = ''; S.mode = 'playing'; document.body.dataset.mode = 'playing'; $('pauseBtn').style.display = 'block'; S.invuln = Math.max(S.invuln, 0.8); }
    }

    // rigid bodies: the road slides under them, and the air moves with it
    if (active || S.mode === 'over' || S.mode === 'sandbox') {
      tetherPlayer(dt);
      phys.groundVel.set(0, 0, S.mode === 'over' || S.mode === 'sandbox' ? 0 : S.speed);
      phys.airVel.copy(phys.groundVel);
      phys.step(dt);
      phys.sync();
      stepRagdolls(dt);
      debris.update(dt);
      updateBombs(dt);
      if (S.throwing) { S.throwing.t += dt; if (!S.throwing.released && S.throwing.t >= 0.12) { S.throwing.released = true; releaseBomb(); } if (S.throwing.t > 0.45) S.throwing = null; }
      updateBlast(dt, S.mode === 'over' || S.mode === 'sandbox' ? 0 : S.speed * dt);
      if (S.mode === 'playing') updateKO(dt, S.speed * dt);
      if (S.mode === 'playing' && S.car) {   // the car's minutes run down only while he is driving
        W.carSecs -= dt / Math.max(0.12, S.timeScale || 1);
        carSave += dt;
        if (carSave > 5) { carSave = 0; saveWallet(); }
        if (W.carSecs <= 0) { W.carSecs = 0; W.carOn = false; setCar(false); popup('THE TAX CAR RETIRES!', '#ffd34d'); saveWallet(); }
      }
    }

    const limp = playerRag && !playerRag.rag.released;   // the ragdoll owns his transform while he is limp
    // sideways: a critically damped spring towards the chosen lane (also gives the lean its velocity)
    if (S.mode !== 'menu' && !limp) {
      const w = PHYS.laneOmega, x = player.position.x;
      S.vx += (w * w * (LANES[S.lane] - x) - 2 * w * S.vx) * dt;
      player.position.x = x + S.vx * dt;
    }
    if (!limp) player.position.y = S.y;
    player.visible = S.invuln <= 0 || Math.floor(S.invuln * 14) % 2 === 0;
    if (S.mode !== 'paused') {
      if (limp) {
        playerRag.t += dt;
        cos.animate(dt);
        if (playerRag.tether && playerRag.t > 0.3 && S.onGround) releasePlayerRag();   // he has landed: ease back into the run
      } else if (playerRag) {   // blending back from limp to the animated pose
        const pr = playerRag;
        pr.rag.resetJoints();
        animatePlayer(dt);
        if (S.mode === 'sandbox') player.rotation.y = 0;
        pr.blendT -= dt;
        const k = clamp(1 - pr.blendT / pr.blendDur, 0, 1);
        pr.rag.blend(k * k * (3 - 2 * k));
        if (pr.blendT <= 0) playerRag = null;
      } else { animatePlayer(dt); if (S.mode === 'sandbox') player.rotation.y = 0; }   // in the sandbox he faces the camera
    }
    if (S.car && S.mode !== 'menu' && S.mode !== 'sandbox' && !limp) {   // he sits in the car, which follows him and leans into the lane changes
      player.position.set(player.position.x, S.y - 0.3, 0.2);
      carFx.visible = true;
      carFx.update(dt, { x: player.position.x, y: S.y, vx: S.vx, vy: S.vy, speed: S.mode === 'playing' ? S.speed : 0 });
      if (S.mode === 'playing' && dt > 0) {
        if (Math.random() < 0.7) { carFx.exhaust(_v); for (const sx of [-0.4, 0.4]) fx.emit({ kind: 1, x: _v.x + sx, y: _v.y, z: _v.z, vx: 0, vy: rand(0, 0.6), vz: rand(2, 6), life: 0.22, size: 0.16, size1: 0.5, drag: 2, grav: 0, heat: 0.9, cool: 4, mode: 1, color: 0xffffff, alpha: 0.7, turb: 1 }); }
        if (S.onGround && Math.random() < 0.5) fx.splash(player.position.x + (Math.random() < 0.5 ? -0.86 : 0.86), 0.98, 1, 1.4);   // spray off the wheels
      }
    }
  }

  /* ---------- sizing, adaptive quality, main loop ---------- */
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(renderScale);
    renderer.setSize(w, h, false);
    glass.resize(w, h);
    camera.aspect = w / h;
    camera.fov = w / h < 0.9 ? 78 : 62;
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize);
  resize();

  /* Holding 60 fps without turning the picture to mush.
     Every ~0.75 s the average frame time is checked. If it is too slow the game gives things up in this order, and the
     picture stays sharp for as long as possible:
       stage 0  everything on
       stage 1-2 unused: the rain, window drops and lights always stay on
       stage 2  no post-processing: the scene is drawn straight to the screen at full resolution
       stage 3  only now does the render scale come down, in small steps, and never below MIN_SCALE
     After a long stretch of fast frames it tries to give things back, one step at a time, and if that is too slow
     it puts them away again and leaves them alone for several minutes. */
  const noAdapt = /noadapt/.test(location.hash + location.search) || settings.quality === 'max' || settings.quality === 'low';
  const MIN_SCALE = Math.min(1, MAX_SCALE), SLOW_MS = 24, FAST_MS = 19, RESTORE_AFTER = 25;
  let accT = 0, accN = 0, goodT = 0, stage = settings.quality === 'low' ? 2 : 0, settleT = 3, probingAt = 0, noRestoreUntil = 0;
  function applyStage() {
    // stage 1: no street reflection. stage 2: no bloom and fewer particles. stage 3+ : the resolution comes down (see adaptQuality).
    glass.setLevel(0);   // rain and window drops never switch off
    reflection.enabled = stage < 1;
    glass.features.bloom = stage < 2;
    fx.quality = stage < 2 ? 1 : 0.6;
    worldFx.lowDetail(false);
  }
  function setScale(v) {
    renderScale = clamp(v, MIN_SCALE, MAX_SCALE);
    resize();
  }
  function adaptQuality(dt) {
    if (S.mode === 'loading' || S.mode === 'paused' || noAdapt || document.hidden) { accT = accN = 0; return; }
    if (dt > 0.2) { accT = accN = 0; settleT = Math.max(settleT, 0.6); return; }   // a hitch (tab switch, shader build): don't judge on it
    if (settleT > 0) { settleT -= dt; return; }   // let a change settle before measuring
    accT += dt; accN++;
    if (accT < 0.75) return;
    const avg = (accT / accN) * 1000;
    accT = accN = 0;
    const now = performance.now();
    if (avg > SLOW_MS) {
      goodT = 0;
      if (probingAt && now - probingAt < 8000) noRestoreUntil = now + 300000;   // giving something back was too much: leave it off for a while
      probingAt = 0;
      if (stage < 2) { stage++; applyStage(); settleT = 2; }   // give up the expensive extras first
      else if (renderScale > MIN_SCALE + 0.01) { stage = 3; setScale(renderScale * 0.92); settleT = 2; }
    } else if (avg < FAST_MS) {
      goodT += 0.75;
      if (goodT > RESTORE_AFTER && now > noRestoreUntil && (stage > 0 || renderScale < MAX_SCALE - 0.01)) {
        goodT = 0; probingAt = now; settleT = 2;
        if (renderScale < MAX_SCALE - 0.01) setScale(Math.min(MAX_SCALE, renderScale * 1.1));
        else { stage = Math.min(stage, 2) - 1; applyStage(); }
      }
    }
  }

  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (window.__game?.manual) { glass.render(); return; }   // tests drive the simulation by hand
    adaptQuality(raw);

    let dt = raw;
    if (S.hitStop > 0) { S.hitStop -= raw; dt = 0; }   // a couple of frozen frames sell a hit
    if (S.mode === 'sandbox' && sb.slow) dt *= 0.22;
    if (S.timeScale < 1) { dt *= Math.max(0.12, S.timeScale); S.timeScale = Math.min(1, S.timeScale + raw * 0.85); }   // slow motion eases back to full speed
    if (S.mode === 'dying') {
      S.dyingT += raw;
      dt *= clamp(1 - S.dyingT / 0.7, 0.12, 1);   // slow motion into the game-over screen
      if (S.dyingT > 1.1) gameOver();
    }
    for (let rem = dt; rem > 1e-6;) {
      const step = Math.min(rem, 1 / 90);
      update(step);
      rem -= step;
    }
    if (dt === 0 && S.mode !== 'paused') animatePlayer(0);
    if (S.mode !== 'paused') cos.stepCape(dt);
    boomGlow = Math.max(0, boomGlow - raw * 2.2);
    hemi.intensity = 1.25 + 2.4 * boomGlow;
    updateCamera(raw);
    glass.setSpeed(S.mode === 'playing' ? clamp((S.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed), 0, 1) * 0.8 + 0.1 : 0);
    updateHud();
    glass.render();
  }

  /** Draw one of every spawnable thing in front of the camera for a moment. GPU uploads and shader links otherwise happen the first time something appears, which shows up as a stutter. */
  function prewarm() {
    worldFx.stageMode(false);
    camera.position.set(0, 4.4, 8.2);
    camera.lookAt(0, 1.5, -6);
    camera.updateMatrixWorld(true);
    const temp = [];
    let x = -3;
    for (const tpl of Object.values(T).flat()) {
      const m = tpl.clone(true);
      m.traverse((o) => { o.frustumCulled = false; });
      m.position.set(x, 0.5, -6);
      x += 0.4;
      scene.add(m);
      temp.push(m);
    }
    const warn = new THREE.Mesh(warnGeo, warnMat);
    warn.position.set(0, 0.05, -4);
    scene.add(warn);
    temp.push(warn);
    boom.prewarm(true);
    crack.prewarm(true);
    glass.render();
    glass.render();
    boom.prewarm(false);
    crack.prewarm(false);
    for (const m of temp) scene.remove(m);
    worldFx.stageMode(true);
  }

  /* ---------- lifecycle: pause when the tab is hidden, survive a lost GL context ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (!window.__game) pauseGame(); audio.suspend(); } else if (S.mode !== 'paused') audio.resume();
  });
  addEventListener('blur', () => { if (!window.__game) pauseGame(); });   // (the debug build keeps running when its window loses focus, so it can be driven from tests)
  $('game').addEventListener('webglcontextlost', (e) => { e.preventDefault(); pauseGame(); });

  if (/debug/.test(location.hash + location.search)) {
    window.__game = { carFx, setCar, toggleCar, carHitBoss, sb, startSandbox, knockPlayer, sbSpawnBoss, sbThrowBall, sbThrowBomb, sbDropStack, sbReset, updateKO, reflection, sun, ragdollPlayer, useBomb, releaseBomb, bombs, comic, debris, launchBoss, phys, ragdolls, throwRagdoll, endRagdoll, settings, worldFx, glass, rain, spawnPowerup, collectPowerup, collectTaxCut, popup, S, W, world, player, T, scene, camera, renderer, fx, startGame, spawnBoss, spawnHazard, spawnTaxCuts, jump, changeLane, fastFall, pauseGame, resumeGame, hurt, gameOver, clearWorld, boom, crack, detonate, crackOpen, tapeThrow, backToMenu, bossHeight, collide, update, updateCamera, spawnRow, cos, manual: false };
  }

  applyStage();         // (a 'Low' graphics setting starts with the extras already off)
  addRunBounds();
  glass.precompile();   // build every shader up front, so nothing hitches mid-run
  prewarm();            // and upload every geometry and texture, by drawing one of everything once
  $('loadBar').style.width = '100%';
  $('loader').classList.add('hidden');
  show('menu', true);
  setMode('menu');
  $('menuBest').textContent = S.best ? `Best ${S.best}` : '';
  $('startBtn').focus({ preventScroll: true });
  requestAnimationFrame(frame);
}

boot().catch((err) => {
  console.error(err);
  fatal('Something went wrong while starting the game. Please reload the page.');
});
