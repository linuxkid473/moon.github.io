/* Blockyard — a live multiplayer arena shooter. One shared arena; every
   visitor who opens this page drops into the same space. Client-authoritative
   throughout (positions, hits, kills) — same trust model as the rest of the
   site (public, unauthenticated Firebase RTDB, no server to referee). */
import * as THREE from "three";
import { PointerLockControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/PointerLockControls.js";
import { database } from "./firebase-init.js";
import { getIdentity, onIdentityChange, recordGamePlay, AVATAR_EMOJIS, AVATAR_COLORS } from "./identity.js";
import {
  ref, set, update, onValue, onChildAdded, onDisconnect, runTransaction, push,
  query, limitToLast
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const ARENA_HALF = 28;
const EYE_HEIGHT = 1.7;
const MOVE_SPEED = 6.5;
const SPRINT_MULT = 1.5;
const JUMP_VELOCITY = 7.5;
const GRAVITY = -20;
const PLAYER_RADIUS = 0.5;
const DAMAGE = 34;
const FIRE_COOLDOWN_MS = 350;
const RESPAWN_MS = 3000;
const STALE_MS = 12000;
const NET_HZ_MS = 100;
const MAX_HEALTH = 100;

const SPAWN_POINTS = [
  [-22, 0, -22], [22, 0, -22], [-22, 0, 22], [22, 0, 22],
  [0, 0, -24], [0, 0, 24], [-24, 0, 0], [24, 0, 0]
];
const COVER_BOXES = [
  { x: -8, z: -6, w: 3, d: 3, h: 2.4, color: 0x5e5ce6 },
  { x: 8, z: 6, w: 3, d: 3, h: 2.4, color: 0x0a84ff },
  { x: 10, z: -10, w: 4, d: 2, h: 1.6, color: 0xff6b6b },
  { x: -10, z: 10, w: 2, d: 4, h: 1.6, color: 0x20bf6b },
  { x: 0, z: 0, w: 5, d: 5, h: 1.2, color: 0xf7b731 },
  { x: -16, z: 0, w: 2, d: 6, h: 2.8, color: 0x8854d0 },
  { x: 16, z: 0, w: 2, d: 6, h: 2.8, color: 0xeb3b5a },
  { x: 0, z: -16, w: 6, d: 2, h: 2.8, color: 0xfa8231 },
];

const els = {
  stage: document.getElementById("fpsStage"),
  canvas: document.getElementById("fpsCanvas"),
  start: document.getElementById("fpsStart"),
  playBtn: document.getElementById("fpsPlayBtn"),
  hud: document.getElementById("fpsHud"),
  exitBtn: document.getElementById("fpsExitBtn"),
  onlineCount: document.getElementById("fpsOnlineCount"),
  healthFill: document.getElementById("fpsHealthFill"),
  killCount: document.getElementById("fpsKillCount"),
  feed: document.getElementById("fpsFeed"),
  respawn: document.getElementById("fpsRespawn"),
  respawnTimer: document.getElementById("fpsRespawnTimer"),
};

/* ---------------- Three.js scene ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b14);

const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);

const renderer = new THREE.WebGLRenderer({ canvas: els.canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

function resize(){
  const w = els.stage.clientWidth, h = els.stage.clientHeight;
  camera.aspect = w / Math.max(h, 1);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", resize);

scene.add(new THREE.HemisphereLight(0x8899ff, 0x1a1a22, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(30, 40, 10);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2 + 4, ARENA_HALF * 2 + 4),
  new THREE.MeshStandardMaterial({ color: 0x17171f })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const gridHelper = new THREE.GridHelper(ARENA_HALF * 2, 28, 0x33334a, 0x24242f);
gridHelper.position.y = 0.01;
scene.add(gridHelper);

const colliders = []; // { box3, mesh }
function addWall(x, z, w, d, h){
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color: 0x2a2a38 })
  );
  mesh.position.set(x, h / 2, z);
  scene.add(mesh);
  colliders.push({ box3: new THREE.Box3().setFromObject(mesh) });
}
const WALL_H = 6, WALL_T = 1;
addWall(0, -ARENA_HALF - WALL_T / 2, ARENA_HALF * 2 + WALL_T * 2, WALL_T, WALL_H);
addWall(0, ARENA_HALF + WALL_T / 2, ARENA_HALF * 2 + WALL_T * 2, WALL_T, WALL_H);
addWall(-ARENA_HALF - WALL_T / 2, 0, WALL_T, ARENA_HALF * 2 + WALL_T * 2, WALL_H);
addWall(ARENA_HALF + WALL_T / 2, 0, WALL_T, ARENA_HALF * 2 + WALL_T * 2, WALL_H);

for (const c of COVER_BOXES){
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(c.w, c.h, c.d),
    new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.6 })
  );
  mesh.position.set(c.x, c.h / 2, c.z);
  scene.add(mesh);
  colliders.push({ box3: new THREE.Box3().setFromObject(mesh) });
}

/* ---------------- Controls ---------------- */
const controls = new PointerLockControls(camera, els.canvas);
const rig = controls.getObject();
rig.position.set(0, EYE_HEIGHT, 0);
scene.add(rig);

const keys = new Set();
let velocityY = 0;
let grounded = true;

document.addEventListener("keydown", e => {
  keys.add(e.code);
  if (e.code === "Space" && grounded && controls.isLocked){ velocityY = JUMP_VELOCITY; grounded = false; }
});
document.addEventListener("keyup", e => keys.delete(e.code));

function resolveCollisions(pos){
  const playerBox = new THREE.Box3(
    new THREE.Vector3(pos.x - PLAYER_RADIUS, 0, pos.z - PLAYER_RADIUS),
    new THREE.Vector3(pos.x + PLAYER_RADIUS, 2, pos.z + PLAYER_RADIUS)
  );
  for (const { box3 } of colliders){
    if (!playerBox.intersectsBox(box3)) continue;
    const overlapX = Math.min(playerBox.max.x, box3.max.x) - Math.max(playerBox.min.x, box3.min.x);
    const overlapZ = Math.min(playerBox.max.z, box3.max.z) - Math.max(playerBox.min.z, box3.min.z);
    if (overlapX < overlapZ){
      pos.x += (pos.x < (box3.min.x + box3.max.x) / 2) ? -overlapX : overlapX;
    } else {
      pos.z += (pos.z < (box3.min.z + box3.max.z) / 2) ? -overlapZ : overlapZ;
    }
    playerBox.min.set(pos.x - PLAYER_RADIUS, 0, pos.z - PLAYER_RADIUS);
    playerBox.max.set(pos.x + PLAYER_RADIUS, 2, pos.z + PLAYER_RADIUS);
  }
  const bound = ARENA_HALF - 0.6;
  pos.x = Math.max(-bound, Math.min(bound, pos.x));
  pos.z = Math.max(-bound, Math.min(bound, pos.z));
}

/* ---------------- Remote players ---------------- */
const remotePlayers = new Map(); // id -> { group, body, head, label, target:{x,y,z,rotY}, lastSeen }

function buildAvatarMesh(color){
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.4, 1.0, 4, 8),
    new THREE.MeshStandardMaterial({ color })
  );
  body.position.y = 0.9;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xffe0bd })
  );
  head.position.y = 1.65;
  group.add(body, head);
  return { group, body, head };
}

function ensureRemote(id, data){
  let rp = remotePlayers.get(id);
  if (!rp){
    const colorHex = AVATAR_COLORS.includes(data.avatarColor) ? data.avatarColor : "#5e5ce6";
    const { group, body, head } = buildAvatarMesh(new THREE.Color(colorHex));
    scene.add(group);
    const label = document.createElement("div");
    label.className = "fps-nametag";
    label.textContent = (typeof data.username === "string" ? data.username : "Player").slice(0, 20);
    els.hud.appendChild(label);
    rp = { group, body, head, label, target: { x: 0, y: 0, z: 0, rotY: 0 }, lastSeen: Date.now() };
    remotePlayers.set(id, rp);
  }
  return rp;
}
function removeRemote(id){
  const rp = remotePlayers.get(id);
  if (!rp) return;
  scene.remove(rp.group);
  rp.label.remove();
  remotePlayers.delete(id);
}

/* ---------------- Networking ---------------- */
const arenaPlayersRef = ref(database, "fpsArena/players");
const myId = getIdentity().id;
const myRef = ref(database, "fpsArena/players/" + myId);

let joined = false;
let myHealth = MAX_HEALTH;
let myKills = 0;
let dead = false;

function randomSpawn(){
  return SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)];
}
function playerSnapshot(spawn){
  const identity = getIdentity();
  return {
    username: identity.username,
    avatarEmoji: AVATAR_EMOJIS.includes(identity.avatarEmoji) ? identity.avatarEmoji : "🙂",
    avatarColor: AVATAR_COLORS.includes(identity.avatarColor) ? identity.avatarColor : "#5e5ce6",
    x: spawn[0], y: spawn[1], z: spawn[2], rotY: 0,
    health: MAX_HEALTH, kills: 0, deaths: 0,
    updatedAt: Date.now()
  };
}

function joinArena(){
  if (joined) return;
  joined = true;
  const spawn = randomSpawn();
  rig.position.set(spawn[0], EYE_HEIGHT, spawn[2]);
  myHealth = MAX_HEALTH;
  myKills = 0;
  updateHealthUI();
  updateKillUI();

  // A listener must be attached before any transaction on this subtree is
  // reliable (RTDB transactions can otherwise see a stale/null value
  // indefinitely on a connection that's never synced this path — see the
  // Tic-Tac-Toe join fix). This listener also drives all remote rendering.
  onValue(arenaPlayersRef, snap => {
    const val = snap.val() || {};
    const now = Date.now();
    for (const [id, data] of Object.entries(val)){
      if (!data || typeof data !== "object") continue;
      if (id === myId){
        if (typeof data.kills === "number") { myKills = data.kills; updateKillUI(); }
        if (typeof data.health === "number" && data.health !== myHealth){
          myHealth = data.health;
          updateHealthUI();
          if (myHealth <= 0 && !dead) startRespawnSequence();
        }
        continue;
      }
      const rp = ensureRemote(id, data);
      rp.lastSeen = now;
      if (typeof data.x === "number") rp.target.x = data.x;
      if (typeof data.y === "number") rp.target.y = data.y;
      if (typeof data.z === "number") rp.target.z = data.z;
      if (typeof data.rotY === "number") rp.target.rotY = data.rotY;
    }
    for (const id of [...remotePlayers.keys()]){
      if (!val[id]) removeRemote(id);
    }
    els.onlineCount.textContent = `${Object.keys(val).length} in the arena`;
  });

  set(myRef, playerSnapshot(spawn)).catch(() => {});
  onDisconnect(myRef).remove();

  const feedQuery = query(ref(database, "fpsArena/feed"), limitToLast(20));
  onChildAdded(feedQuery, snap => {
    const entry = snap.val();
    if (!entry || typeof entry !== "object") return;
    if (Date.now() - (entry.timestamp || 0) > 8000) return; // old history replayed on join, skip
    renderFeedRow(entry);
  });

  setInterval(sweepStale, 3000);
}

function sweepStale(){
  const now = Date.now();
  for (const [id, rp] of remotePlayers){
    if (now - rp.lastSeen > STALE_MS) removeRemote(id);
  }
}

function renderFeedRow(entry){
  const row = document.createElement("div");
  row.className = "fps-feed-row";
  const shooter = document.createElement("span");
  shooter.className = "shooter";
  shooter.textContent = typeof entry.shooter === "string" ? entry.shooter.slice(0, 20) : "Someone";
  const mid = document.createTextNode(" eliminated ");
  const victim = document.createElement("span");
  victim.className = "victim";
  victim.textContent = typeof entry.victim === "string" ? entry.victim.slice(0, 20) : "someone";
  row.append(shooter, mid, victim);
  els.feed.appendChild(row);
  while (els.feed.children.length > 5) els.feed.removeChild(els.feed.firstChild);
  setTimeout(() => row.remove(), 5000);
}

let lastNetSend = 0;
function maybeSendPosition(){
  const now = Date.now();
  if (now - lastNetSend < NET_HZ_MS) return;
  lastNetSend = now;
  update(myRef, {
    x: rig.position.x, y: rig.position.y - EYE_HEIGHT, z: rig.position.z,
    rotY: rig.rotation.y, updatedAt: now
  }).catch(() => {});
}

function updateHealthUI(){
  const pct = Math.max(0, myHealth) / MAX_HEALTH * 100;
  els.healthFill.style.width = pct + "%";
  els.healthFill.classList.toggle("low", myHealth <= 34);
}
function updateKillUI(){ els.killCount.textContent = String(myKills); }

let respawnTimeout = null;
function startRespawnSequence(){
  dead = true;
  // Deliberately NOT calling controls.unlock() here — the pointer stays
  // locked through death so respawning resumes play seamlessly (matches
  // how a real arena shooter behaves) instead of dropping the player back
  // to a "click to play" screen every time they die. The `dead` flag alone
  // already blocks movement/shooting while the death overlay is up.
  els.respawn.classList.add("show");
  let remaining = Math.ceil(RESPAWN_MS / 1000);
  els.respawnTimer.textContent = `Respawning in ${remaining}…`;
  const tick = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) els.respawnTimer.textContent = `Respawning in ${remaining}…`;
  }, 1000);
  respawnTimeout = setTimeout(() => {
    clearInterval(tick);
    const spawn = randomSpawn();
    rig.position.set(spawn[0], EYE_HEIGHT, spawn[2]);
    velocityY = 0;
    myHealth = MAX_HEALTH;
    updateHealthUI();
    update(myRef, { x: spawn[0], y: spawn[1], z: spawn[2], health: MAX_HEALTH, updatedAt: Date.now() }).catch(() => {});
    dead = false;
    els.respawn.classList.remove("show");
    // Edge case: the browser lets a player press Escape to force-exit
    // pointer lock even while dead, regardless of our JS. If that happened,
    // there's nothing left to auto-resume into — fall back to the start
    // screen so they have a way back in.
    if (!controls.isLocked) els.start.style.display = "flex";
  }, RESPAWN_MS);
}

/* ---------------- Shooting ---------------- */
const raycaster = new THREE.Raycaster();
let lastShotAt = 0;

function shoot(){
  if (!controls.isLocked || dead) return;
  const now = Date.now();
  if (now - lastShotAt < FIRE_COOLDOWN_MS) return;
  lastShotAt = now;

  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const envHit = raycaster.intersectObjects(colliders.length ? scene.children.filter(o => o.geometry && o !== rig) : [], false);
  const targets = [];
  for (const [id, rp] of remotePlayers) targets.push(rp.body, rp.head);
  const playerHits = raycaster.intersectObjects(targets, false);

  if (!playerHits.length) return;
  const closestEnvDist = envHit.length ? envHit[0].distance : Infinity;
  if (playerHits[0].distance > closestEnvDist) return; // blocked by a wall/cover first

  const hitMesh = playerHits[0].object;
  let hitId = null;
  for (const [id, rp] of remotePlayers){
    if (rp.body === hitMesh || rp.head === hitMesh){ hitId = id; break; }
  }
  if (!hitId) return;

  const targetHealthRef = ref(database, `fpsArena/players/${hitId}/health`);
  runTransaction(targetHealthRef, current => {
    const cur = typeof current === "number" ? current : MAX_HEALTH;
    return Math.max(0, cur - DAMAGE);
  }).then(result => {
    if (!result.committed) return;
    const newHealth = result.snapshot.val();
    if (newHealth === 0){
      myKills += 1;
      updateKillUI();
      runTransaction(ref(database, `fpsArena/players/${myId}/kills`), c => (typeof c === "number" ? c : 0) + 1).catch(() => {});
      runTransaction(ref(database, `fpsArena/players/${hitId}/deaths`), c => (typeof c === "number" ? c : 0) + 1).catch(() => {});
      const rp = remotePlayers.get(hitId);
      const victimName = rp?.label.textContent || "a player";
      push(ref(database, "fpsArena/feed"), {
        shooter: getIdentity().username, victim: victimName, timestamp: Date.now()
      }).catch(() => {});
    }
  }).catch(() => {});
}
els.canvas.addEventListener("mousedown", e => { if (e.button === 0) shoot(); });

/* ---------------- Lock / start flow ---------------- */
function startPlay(){
  resize();
  controls.lock();
}
els.playBtn.addEventListener("click", startPlay);
controls.addEventListener("lock", () => {
  els.start.style.display = "none";
  els.hud.classList.add("active");
  if (!joined){
    recordGamePlay("fps");
    joinArena();
  }
});
controls.addEventListener("unlock", () => {
  if (!dead) els.start.style.display = "flex";
});
els.exitBtn.addEventListener("click", () => { location.href = "index.html"; });
onIdentityChange(identity => {
  // If a name/avatar edit happens mid-match (via the profile popover),
  // push it live so other players see the update immediately.
  if (!joined) return;
  update(myRef, {
    username: identity.username,
    avatarEmoji: AVATAR_EMOJIS.includes(identity.avatarEmoji) ? identity.avatarEmoji : "🙂",
    avatarColor: AVATAR_COLORS.includes(identity.avatarColor) ? identity.avatarColor : "#5e5ce6",
  }).catch(() => {});
});

/* ---------------- Animation loop ---------------- */
const clock = new THREE.Clock();
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked && !dead){
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
    const sprint = keys.has("ShiftLeft") || keys.has("ShiftRight");
    const speed = MOVE_SPEED * (sprint ? SPRINT_MULT : 1);

    const dir = new THREE.Vector3(strafe, 0, -forward);
    if (dir.lengthSq() > 0){
      dir.normalize().multiplyScalar(speed * dt);
      // Rotate the flat move vector by the rig's yaw (mouse-look heading).
      const yaw = rig.rotation.y;
      const cos = Math.cos(yaw), sin = Math.sin(yaw);
      const dx = dir.x * cos - dir.z * sin;
      const dz = dir.x * sin + dir.z * cos;
      rig.position.x += dx;
      rig.position.z += dz;
    }

    velocityY += GRAVITY * dt;
    rig.position.y += velocityY * dt;
    if (rig.position.y <= EYE_HEIGHT){
      rig.position.y = EYE_HEIGHT;
      velocityY = 0;
      grounded = true;
    }

    const flatPos = { x: rig.position.x, z: rig.position.z };
    resolveCollisions(flatPos);
    rig.position.x = flatPos.x;
    rig.position.z = flatPos.z;

    maybeSendPosition();
  }

  for (const rp of remotePlayers.values()){
    rp.group.position.x += (rp.target.x - rp.group.position.x) * Math.min(1, dt * 10);
    rp.group.position.y += (rp.target.y - rp.group.position.y) * Math.min(1, dt * 10);
    rp.group.position.z += (rp.target.z - rp.group.position.z) * Math.min(1, dt * 10);
    rp.group.rotation.y = rp.target.rotY;

    const screenPos = rp.group.position.clone();
    screenPos.y += 2.1;
    screenPos.project(camera);
    const behind = screenPos.z > 1;
    rp.label.style.display = behind ? "none" : "block";
    if (!behind){
      const x = (screenPos.x * 0.5 + 0.5) * els.stage.clientWidth;
      const y = (-screenPos.y * 0.5 + 0.5) * els.stage.clientHeight;
      rp.label.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  renderer.render(scene, camera);
}
resize();
animate();
