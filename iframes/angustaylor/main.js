// Angus Taylah: Fighting Taxes. Game loop, physics, spawning, UI.
import { THREE, rand, pick, clamp, damp, loadImage, mesh, blobShadow } from './gfx.js';
import { LANES, SPAWN_Z, DESPAWN_Z, PHYS, JUMP_V, RUN, BUDGET_AT, BUDGET_SECS, CHARACTERS, BOSS_ORDER, ITEMS, POWER, STREAK_CALLS, PICKUP_POPS, RANKS, OVER_TITLES } from './config.js';
import { S, W, saveWallet, saveBest, settings, saveSettings, helpSeen, markHelpSeen } from './state.js';
import * as audio from './audio.js';
import { buildPerson, applyPose, cyclePose, tossPose, AIR_POSE, FALL_POSE, MENU_POSE } from './person.js';
import { createCosmetics } from './cosmetics.js';
import { createWorld, STAGE } from './world.js';
import { createFx } from './fx.js';
import { createRain } from './rain.js';
import { createGlass } from './glass.js';
import { createTicker } from './ticker.js';

const $ = (id) => document.getElementById(id);
const sky = 0x2a0814;   // dark red haze: the whole run is a rally stage

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
    renderer = new THREE.WebGLRenderer({ canvas: $('game'), antialias: false, powerPreference: 'high-performance' });   // the scene is drawn to its own anti-aliased target (glass.js), so the screen itself needs no MSAA
  } catch {
    fatal('Your browser could not start 3D graphics (WebGL). Try updating it, or turn on hardware acceleration.');
    return;
  }
  const MAX_SCALE = Math.min(window.devicePixelRatio || 1, 1.5);
  let renderScale = MAX_SCALE;   // pixels drawn per CSS pixel; the quality controller below moves this to hold 60 fps
  renderer.setPixelRatio(renderScale);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sky);
  scene.fog = new THREE.Fog(sky, 30, 120);
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 300);

  scene.add(new THREE.HemisphereLight(0xffa0aa, 0x4a1620, 1.6));
  const sun = new THREE.DirectionalLight(0xffc4c8, 2.6);
  sun.position.set(-6, 14, 8);
  sun.target.position.set(0, 0, -6);
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
  const worldFx = createWorld({ scene, camera });
  const { T } = worldFx;
  for (const id of BOSS_ORDER) { T[id] = buildPerson({ ...CHARACTERS[id], faceImage: faceImg[id] }); T[id].add(blobShadow(0.7, 0.55, 0.4)); }
  const bossHeight = Math.max(...BOSS_ORDER.map((id) => T[id].userData.headTop)) - 0.05;   // top of the head, for hit testing

  const player = buildPerson({ ...CHARACTERS.ANGUS, label: null, faceImage: faceImg.ANGUS });
  player.rotation.y = Math.PI;   // faces down the road (-z) so he runs forwards; the head turns back to the camera on pickups and hits
  scene.add(player);
  const playerHead = player.getObjectByName('head');
  const cos = createCosmetics({ scene, player, camera });
  const fx = createFx(scene);
  const rain = createRain(scene, worldFx.dotTex);
  const glass = createGlass({ renderer, scene, camera, rain });
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
    const b = S.budgetT > 0 ? Math.ceil(S.budgetT) : 0;
    setText('budget', b ? `LIBERAL BUDGET ${b}s` : '');
    $('budget').style.display = b ? 'block' : 'none';
    const pw = [S.cutT > 0 ? `✂ RIBBON-CUTTING ${Math.ceil(S.cutT)}s` : '', S.shield > 0 ? '💼 BLAME SHIELD' : ''].filter(Boolean).join('  ·  ');
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
    const pool = PATTERNS.filter((p) => !bossNear || p.safe);   // while a boss is on the road, only pickups: the boss is the obstacle
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
  function tapeThrow() {
    if (S.mode !== 'playing' && S.mode !== 'dying') return;
    S.thrown = 0.45;
    S.tapeLeft = 1.1;
    const dir = S.lane === 0 ? 1 : S.lane === 2 ? -1 : Math.random() < 0.5 ? -1 : 1;
    S.lane = clamp(S.lane + dir, 0, 2);
    S.throwDir = dir;
    S.vy = JUMP_V * 0.62;
    S.throwAir = S.vy / PHYS.gravityUp + S.vy / Math.sqrt(PHYS.gravityUp * PHYS.gravityDown);   // up time + down time
    S.airT = 0;
    S.onGround = false;
    S.fastFalling = false;
    S.noSpin = true;   // no turn-to-camera spin during a toss
    audio.sfx.tape();
  }

  const CAUSES = {
    tax: 'Crushed by a tax stack',
    tape: 'Tangled in red tape',
    boss: (by) => `Ran into ${CHARACTERS[by]?.name ?? 'the Government'}`,
    shot: (by) => `Wrapped in ${CHARACTERS[by]?.name ?? 'the Government'}'s red tape`,
  };

  function hurt(cause = 'tape', by = '') {
    if (S.invuln > 0 || S.mode !== 'playing') return false;
    if (S.shield > 0) {   // the consultant takes the blame instead
      S.shield = 0; S.invuln = 1.0; S.shake = Math.max(S.shake, 0.4);
      fx.burst(player.position.x, S.y + 1.5, 0, 0x7fb2ff, 22, { speed: 5, up: 3, life: 0.6 });
      popup('CONSULTANT TAKES THE BLAME!', '#7fb2ff');
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
    flash();
    vibrate(120);
    audio.sfx.hit();
    popup(pick(['OUCH!', 'AUDITED!', 'RED TAPE!', 'DENIED!', 'NOT TODAY!']), '#ff6b6b');
    if (S.lives > 0) news(S.lives === 1 ? 'lastLife' : ({ tape: 'hitTape', tax: 'hitTax', boss: 'hitBoss', shot: 'hitShot' })[cause], true);
    else beginDying();
    return true;
  }

  /* Hit testing uses real boxes. z is swept from where the object was last step to where it is now, so nothing tunnels at speed. */
  function collide() {
    const px = player.position.x, hw = PHYS.playerHalfW, hd = PHYS.playerHalfD;
    const y0 = S.y, y1 = S.y + PHYS.playerHeight;
    const hits = (x, ya, yb, z, pz, halfW, halfD) =>
      Math.abs(px - x) < halfW + hw && y0 < yb && y1 > ya &&
      Math.max(z, pz) + halfD > -hd && Math.min(z, pz) - halfD < hd;

    for (let i = world.hazards.length - 1; i >= 0; i--) {
      const h = world.hazards[i], f = HAZ[h.kind], m = h.mesh;
      if (!hits(m.position.x, 0, f.h, m.position.z, h.pz, f.halfW, f.halfD)) continue;
      if (S.cutT > 0) {   // the ceremonial scissors cut straight through it
        fx.burst(m.position.x, 1.0, m.position.z, 0xff6a73, 16, { speed: 5, up: 3, life: 0.6 });
        release(m);
        world.hazards.splice(i, 1);
        S.cutScore += POWER.scissorsBonus;
        popup(pick(['SNIP!', 'RIBBON CUT!', 'CUT THROUGH!']), '#ff6a73');
        audio.sfx.snip();
      } else hurt(h.kind);
    }
    for (const b of world.bosses) {
      const m = b.mesh;
      if (hits(m.position.x, 0, bossHeight, m.position.z, b.pz, 0.5, 0.32)) { b.touched = true; hurt('boss', b.kind); }
      if (!b.passed && m.position.z > 1.2) {   // got past a boss without touching him
        b.passed = true;
        if (S.mode === 'playing' && !b.touched) { S.cutScore += 50; popup('DODGED! +50', '#ffd34d'); }
      }
    }
    for (let i = world.shots.length - 1; i >= 0; i--) {
      const sh = world.shots[i], m = sh.mesh;
      if (hits(m.position.x, 0.75, 1.55, m.position.z, sh.pz, 0.25, 0.4)) {
        release(m);
        world.shots.splice(i, 1);
        if (hurt('shot', sh.from)) tapeThrow();
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
    fx.burst(player.position.x, S.y + 1.5, 0, kind === 'scissors' ? 0xff6a73 : 0x7fb2ff, 22, { speed: 5, up: 3, life: 0.7 });
    audio.sfx.power();
    if (kind === 'scissors') { S.cutT = POWER.scissorsSecs; popup('RIBBON-CUTTING CEREMONY!', '#ff6a73'); news('scissors', true); }
    else { S.shield = 1; popup('CONSULTANT HIRED!', '#7fb2ff'); news('consultant', true); }
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
    fx.burst(player.position.x, S.y + 1.5, 0, gold ? 0xffd34d : 0x7cfc9a, gold ? 26 : 9, { speed: 4, up: 3, life: 0.55 });
    for (const ms of [1, 10, 25, 50, 100, 150]) if (before < ms && S.taxCuts >= ms) news('tc' + ms, true);
    if (before < BUDGET_AT && S.taxCuts >= BUDGET_AT) { S.budgetT = BUDGET_SECS; popup('LIBERAL BUDGET!', '#7fb2ff'); audio.sfx.budget(); news('budget', true); }
    const call = STREAK_CALLS[S.streak];
    if (call) { popup(call, '#ffd34d'); news('streak', true); audio.sfx.fanfare(); }
    else if (gold) { popup('SURPLUS FOUND! +10', '#ffd34d'); news('gold', true); audio.sfx.gold(); }
    else { popup(pick(PICKUP_POPS), '#7CFC9A'); audio.sfx.coin(S.streak); if (Math.random() < 0.2) news('taxcut'); }
  }

  function prune() {
    for (const k in world) {
      const list = world[k];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].mesh.position.z > DESPAWN_Z) {
          if (list[i].warn) scene.remove(list[i].warn);
          release(list[i].mesh);
          list.splice(i, 1);
        }
      }
    }
  }

  function clearWorld() {
    for (const k in world) {
      for (const e of world[k]) { if (e.warn) scene.remove(e.warn); release(e.mesh); }
      world[k].length = 0;
    }
    fx.clear();
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
    $('hud').style.display = mode === 'menu' || mode === 'loading' ? 'none' : 'flex';
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
      rowDist: 22, sceneryDist: 0, nextBossDist: 180, bossCount: 0, thrown: 0, tapeLeft: 0, noSpin: false, budgetT: 0, cutT: 0, shield: 0,
      jumpBufferT: 0, laneBuffer: 0, laneBufferDir: 0, hitBy: '', hitById: '', newBest: false, dyingT: 0, apex: 0,
    });
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
    if (S.mode === 'menu') { if (!inOverlay && primaryKeys.includes(k)) startGame(); return; }
    if (S.mode === 'over') {
      if (!inOverlay && primaryKeys.includes(k) && performance.now() - S.overAt > 700) startGame();
      return;
    }
    if (S.mode === 'paused') {
      if (k === 'p' || k === 'escape' || (!inOverlay && primaryKeys.includes(k))) resumeGame();
      return;
    }
    if (S.mode !== 'playing') return;
    if (k === 'arrowleft' || k === 'a') changeLane(-1);
    else if (k === 'arrowright' || k === 'd') changeLane(1);
    else if (k === 'arrowup' || k === 'w' || k === ' ') jump();
    else if (k === 'arrowdown' || k === 's') fastFall();
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
  for (const id of ['pauseBtn', 'muteBtn']) {
    $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
    $(id).addEventListener('pointerup', (e) => e.stopPropagation());
  }
  const press = (id, fn) => $(id).addEventListener('click', (e) => { e.currentTarget.blur(); audio.unlock(); audio.sfx.click(); fn(e); });

  press('pauseBtn', pauseGame);
  press('startBtn', startGame);
  press('againBtn', startGame);
  press('resumeBtn', resumeGame);
  press('quitBtn', () => { show('pause', false); show('settings', false); clearWorld(); backToMenu(); });
  press('menuBtn', () => { show('over', false); backToMenu(); });
  press('muteBtn', () => { settings.sfx = settings.music = !(settings.sfx || settings.music); applySettings(); });

  function backToMenu() {
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
      label.textContent = it.name;
      const btn = document.createElement('button');
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
    $('muteBtn').textContent = settings.sfx || settings.music ? '🔊' : '🔇';
    $('muteBtn').setAttribute('aria-label', settings.sfx || settings.music ? 'Mute' : 'Unmute');
    document.body.classList.toggle('calm', !settings.shake);
    saveSettings();
  }
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
    playerHead.rotation.y = damp(playerHead.rotation.y, glancing ? Math.PI * 0.92 : 0, 12, dt);
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
    playerHead.rotation.x = Math.sin(S.runT * 2) * (playing && S.onGround ? 0.04 : 0);
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
      tgt = p.slice(1, 13); rate = 12;
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
      tgt = new Array(12).fill(0);
    } else if (S.onGround) {
      if (playing) S.runT += dt * S.speed * 0.6;
      tgt = cyclePose(S.runT, playing ? 1 : 0);
      rate = playing ? (S.settle > 0 ? 12 : 40) : 10;
      if (playing) { player.position.y += Math.abs(Math.sin(S.runT)) * 0.06; player.rotation.x = -0.08; player.rotation.z = lean; }   // a little bounce and a forward lean
    } else {
      tgt = S.fastFalling ? FALL_POSE : AIR_POSE; rate = 12;
      player.rotation.z = lean;
    }
    if (S.mode === 'menu') {   // standing proudly on the stage: chest out, one hand on his hip, the other presenting the sign
      const tm = performance.now() / 1000;
      player.position.set(STAGE.x - 1.5, STAGE.y + Math.sin(tm * 1.6) * 0.02, STAGE.z + 0.9);
      player.rotation.set(-0.06, -0.28, 0);
      playerHead.rotation.y = damp(playerHead.rotation.y, 0.1 + Math.sin(tm * 0.7) * 0.12, 6, dt);
      if (!taped) { tgt = MENU_POSE.slice(); tgt[9] += Math.sin(tm * 2) * 0.05; tgt[5] = Math.sin(tm * 1.3) * 0.04; rate = 8; } else tgt = new Array(12).fill(0);
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
      player.scale.set(1 + 0.05 * crouch, 1 - 0.12 * crouch, 1 + 0.05 * crouch);
      player.rotation.z += S.throwDir * 0.18 * r * Math.sin((1 - r) * 14);
    } else {
      player.scale.set(1, 1, 1);
    }

    // every joint chases its target smoothly, so changing between poses never pops
    S.pose = S.pose || new Array(12).fill(0);
    const a = 1 - Math.exp(-rate * dt);
    for (let i = 0; i < 12; i++) S.pose[i] += (tgt[i] - S.pose[i]) * a;
    applyPose(player, S.pose);
    blob.position.x = player.position.x;
    blob.position.z = player.position.z;
    blob.visible = S.mode !== 'menu';
    blob.material.opacity = 0.4 / (1 + 0.8 * S.y);   // fades as he jumps
  }

  function animateBoss(b, dt) {
    const tgt = cyclePose(b.anim * 7, 0.6);   // a jog: hips, knees, arms and elbows
    if (b.warnT > 0) { tgt[5] = 1.1; tgt[7] = -0.5; tgt[9] = 0.25; }   // arm drawn back behind the head: the tell
    else if (b.throwing > 0) {   // whip the arm forward
      const u = 1 - b.throwing / 0.35, e = u * u * (3 - 2 * u);
      tgt[5] = 1.1 - 3.5 * e;
      tgt[7] = -0.5 - 0.8 * (1 - e);
    }
    b.pose = b.pose || tgt.slice();
    const bk = 1 - Math.exp(-(b.throwing > 0 || b.warnT > 0 ? 24 : 12) * dt);
    for (let i = 0; i < 12; i++) b.pose[i] += (tgt[i] - b.pose[i]) * bk;
    applyPose(b.mesh, b.pose);
    // a taunting head bob
    b.head ??= b.mesh.getObjectByName('head');
    if (b.head) b.head.rotation.z = Math.sin(b.anim * 3.1) * 0.08;
  }

  function updateBoss(b, dt, move) {
    const m = b.mesh;
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
  function updateCamera(dt) {
    if (S.mode === 'menu') { worldFx.menuCamera(); return; }
    camX = damp(camX, player.position.x * 0.5, 6, dt);
    const sh = reduceMotion() ? 0 : S.shake;
    const ph = clamp(S.y * 0.3, 0, 1.5);   // the camera rises with every jump so his head never leaves the screen
    camera.position.set(camX + rand(-1, 1) * sh * 0.3, 4.4 + ph + rand(-1, 1) * sh * 0.2, 8.2);
    camera.lookAt(camX * 0.6, 1.5 + ph * 0.7, -6);
    if (!reduceMotion() && S.mode === 'playing') camera.rotateZ(-(player.position.x - camX * 2) * 0.012);   // the camera leans into lane changes
    S.shake *= Math.exp(-8 * dt);
    const target = reduceMotion() ? 0 : clamp((S.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed), 0, 1) * 7 + (S.budgetT > 0 ? 3 : 0) + (S.cutT > 0 ? 2 : 0);   // a wider lens as you speed up and during power-ups
    fovKick = damp(fovKick, S.mode === 'playing' ? target : 0, 2, dt);
    const base = innerWidth / innerHeight < 0.9 ? 78 : 62;
    if (Math.abs(camera.fov - (base + fovKick)) > 0.01) { camera.fov = base + fovKick; camera.updateProjectionMatrix(); }
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
        if (S.dist >= S.nextBossDist) { spawnBoss(); S.nextBossDist = S.dist + rand(130, 190); }
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
      S.jumpBufferT = Math.max(0, S.jumpBufferT - dt);
      if (S.thrown <= 0 && S.laneBuffer > 0) {   // a lane change pressed during the toss
        S.laneBuffer -= dt;
        if (S.laneBufferDir) { const d = S.laneBufferDir; S.laneBufferDir = 0; changeLane(d); }
      } else if (S.thrown > 0) S.laneBuffer = Math.max(0, S.laneBuffer);

      if (sim) { collide(); }
      prune();
      audio.music.setTempo(clamp((S.speed - RUN.startSpeed) / (RUN.maxSpeed - RUN.startSpeed), 0, 1));
    } else if (S.mode === 'countdown') {
      S.countdown -= dt;
      const n = Math.ceil(S.countdown / 0.5);
      if (n !== S.countShown && n >= 1) { S.countShown = n; $('count').textContent = String(n); $('count').classList.remove('pulse'); void $('count').offsetWidth; $('count').classList.add('pulse'); }
      if (S.countdown <= 0) { $('count').textContent = ''; S.mode = 'playing'; document.body.dataset.mode = 'playing'; $('pauseBtn').style.display = 'block'; S.invuln = Math.max(S.invuln, 0.8); }
    }

    // sideways: a critically damped spring towards the chosen lane (also gives the lean its velocity)
    if (S.mode !== 'menu') {
      const w = PHYS.laneOmega, x = player.position.x;
      S.vx += (w * w * (LANES[S.lane] - x) - 2 * w * S.vx) * dt;
      player.position.x = x + S.vx * dt;
    }
    player.position.y = S.y;
    player.visible = S.invuln <= 0 || Math.floor(S.invuln * 14) % 2 === 0;
    if (S.mode !== 'paused') animatePlayer(dt);
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

  /* Dynamic resolution: hold 60 fps by trading pixels for time.
     Every ~0.75 s the average frame time is checked. Too slow: drop the render scale a step. Comfortably fast for a while:
     probe a step back up, and if that makes it slow again, go back down and don't try that high for a while.
     Below some scales the finer rain is switched off too (all of it is reversible). */
  const noAdapt = /noadapt/.test(location.hash + location.search);
  const MIN_SCALE = 0.6, SLOW_MS = 18.5, FAST_MS = 17.4;
  let accT = 0, accN = 0, goodT = 0, ceiling = MAX_SCALE, ceilingUntil = 0, probing = false, settleT = 2.5;
  function setScale(v) {
    renderScale = clamp(v, MIN_SCALE, MAX_SCALE);
    resize();
    glass.setLevel(renderScale < 0.7 ? 2 : renderScale < 0.95 ? 1 : 0);   // lighter rain, then no window drops, as the scale falls
    if (renderScale < 0.8) worldFx.lowDetail(true); else worldFx.lowDetail(false);
  }
  function adaptQuality(dt) {
    if (S.mode === 'loading' || S.mode === 'paused' || noAdapt || document.hidden) { accT = accN = 0; return; }
    if (dt > 0.2) { accT = accN = 0; settleT = Math.max(settleT, 0.6); return; }   // a hitch (tab switch, shader build): don't judge on it
    if (settleT > 0) { settleT -= dt; return; }   // let a resize or a new run settle before measuring
    accT += dt; accN++;
    if (accT < 0.75) return;
    const avg = (accT / accN) * 1000;
    accT = accN = 0;
    if (avg > SLOW_MS) {
      goodT = 0;
      if (probing) { ceiling = Math.max(MIN_SCALE, renderScale / 1.1); ceilingUntil = performance.now() + 40000; probing = false; }   // the step up was too much
      if (renderScale > MIN_SCALE) { setScale(renderScale * (avg > 28 ? 0.8 : 0.9)); settleT = 1.0; }
    } else if (avg < FAST_MS) {
      probing = false;
      goodT += 0.75;
      if (performance.now() > ceilingUntil) ceiling = MAX_SCALE;
      if (goodT > 6 && renderScale < ceiling - 0.01) { goodT = 0; setScale(Math.min(ceiling, renderScale * 1.1)); probing = true; settleT = 1.0; }
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
    updateCamera(raw);
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
    glass.render();
    glass.render();
    for (const m of temp) scene.remove(m);
    worldFx.stageMode(true);
  }

  /* ---------- lifecycle: pause when the tab is hidden, survive a lost GL context ---------- */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseGame(); audio.suspend(); } else if (S.mode !== 'paused') audio.resume();
  });
  addEventListener('blur', () => pauseGame());
  $('game').addEventListener('webglcontextlost', (e) => { e.preventDefault(); pauseGame(); });

  if (/debug/.test(location.hash + location.search)) {
    window.__game = { settings, worldFx, glass, rain, spawnPowerup, collectPowerup, collectTaxCut, popup, S, W, world, player, T, scene, camera, renderer, fx, startGame, spawnBoss, spawnHazard, spawnTaxCuts, jump, changeLane, fastFall, pauseGame, resumeGame, hurt, gameOver, clearWorld, backToMenu, bossHeight, collide, update, updateCamera, spawnRow, cos, manual: false };
  }

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
