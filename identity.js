/* Unified local identity + stats — a lightweight, localStorage-based "account"
   (no server, no auth). Every other new module (presence, comments, rooms,
   leaderboards) reads/writes through this instead of touching localStorage
   or players/<id> directly, so there's exactly one source of truth. */
import { database } from "./firebase-init.js";
import {
  ref, get, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { onAuthChange } from "./auth.js";

const IDENTITY_KEY = "moongames.identity";
const STATS_KEY = "moongames.stats";
const LEGACY_USERNAME_KEY = "chatUsername";
const MAX_USERNAME_LEN = 20;
const PLAY_COOLDOWN_MS = 5 * 60 * 1000;

export const AVATAR_EMOJIS = ["🐙","🦊","🐻","🐼","🦁","🐯","🐸","🐵","🦄","🐲","🐢","🦉","🐺","🐰","🦖","🐨"];
export const AVATAR_COLORS = ["#ff6b6b","#f7b731","#20bf6b","#0fb9b1","#2d98da","#8854d0","#eb3b5a","#fa8231"];

// A custom profile photo is stored as a small base64 data: URL, directly on
// the identity/players record — no Firebase Storage bucket is set up for
// this project, and a tiny (64x64, compressed) image is cheap enough to
// keep inline. Validated strictly wherever it's rendered since players/<id>
// is a publicly-writable, fully untrusted record like everything else here.
export const PHOTO_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
export const MAX_PHOTO_URL_LEN = 60000;
export function isValidPhotoURL(value){
  return typeof value === "string" && value.length <= MAX_PHOTO_URL_LEN && PHOTO_URL_RE.test(value);
}

function randomId(){
  if (window.crypto?.randomUUID) return "id-" + window.crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
function randomUsername(){
  return "Player" + Math.floor(1000 + Math.random() * 9000);
}
function todayStr(d = new Date()){
  return d.toISOString().slice(0, 10);
}

function defaultStats(){
  return {
    totalPlays: 0,
    gamesPlayed: {},
    distinctGamesPlayedCount: 0,
    streak: { current: 0, longest: 0, lastVisitDate: null },
    chatMessagesSent: 0,
    commentsPosted: 0,
    tictactoe: { wins: 0, losses: 0, draws: 0 },
    achievementsUnlocked: {}
  };
}

function loadJSON(key, fallback){
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function migrateLegacyUsername(identity){
  if (identity.username) return identity;
  let legacy = null;
  try { legacy = localStorage.getItem(LEGACY_USERNAME_KEY); } catch {}
  identity.username = (legacy && legacy.trim()) ? legacy.trim().slice(0, MAX_USERNAME_LEN) : randomUsername();
  return identity;
}

function freshGuestIdentity(){
  const guest = {
    id: randomId(),
    username: "",
    avatarEmoji: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    photoURL: null,
    createdAt: Date.now(),
    loggedIn: false
  };
  migrateLegacyUsername(guest);
  return guest;
}

let identity = loadJSON(IDENTITY_KEY, null);
if (!identity || typeof identity.id !== "string"){
  identity = freshGuestIdentity();
  saveJSON(IDENTITY_KEY, identity);
}
if (typeof identity.loggedIn !== "boolean") identity.loggedIn = false;
if (typeof identity.photoURL !== "string") identity.photoURL = null;

let stats = loadJSON(STATS_KEY, null);
if (!stats || typeof stats !== "object"){
  stats = defaultStats();
  saveJSON(STATS_KEY, stats);
} else {
  // Fill in any fields missing from an older/partial saved shape.
  const d = defaultStats();
  stats = { ...d, ...stats,
    gamesPlayed: { ...d.gamesPlayed, ...(stats.gamesPlayed || {}) },
    streak: { ...d.streak, ...(stats.streak || {}) },
    tictactoe: { ...d.tictactoe, ...(stats.tictactoe || {}) },
    achievementsUnlocked: { ...d.achievementsUnlocked, ...(stats.achievementsUnlocked || {}) }
  };
}

const identityListeners = new Set();
const statsListeners = new Set();
function notifyIdentity(){ identityListeners.forEach(cb => { try { cb(identity); } catch {} }); }
function notifyStats(){ statsListeners.forEach(cb => { try { cb(stats); } catch {} }); }

let flushTimer = null;
function scheduleFlush(){
  clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    update(ref(database, "players/" + identity.id), {
      username: identity.username,
      avatarEmoji: identity.avatarEmoji,
      avatarColor: identity.avatarColor,
      photoURL: isValidPhotoURL(identity.photoURL) ? identity.photoURL : null,
      hasAccount: identity.loggedIn,
      stats: {
        totalPlays: stats.totalPlays,
        distinctGamesPlayedCount: stats.distinctGamesPlayedCount,
        chatMessagesSent: stats.chatMessagesSent,
        commentsPosted: stats.commentsPosted,
        tictactoe: stats.tictactoe,
        streak: { current: stats.streak.current, longest: stats.streak.longest }
      },
      updatedAt: Date.now()
    }).catch(() => {});
  }, 2000);
}

function persistIdentity(){ saveJSON(IDENTITY_KEY, identity); notifyIdentity(); scheduleFlush(); }
function persistStats(){ saveJSON(STATS_KEY, stats); notifyStats(); scheduleFlush(); }

/* ---------------- Public identity API ---------------- */
export function getIdentity(){ return { ...identity }; }

// Locked once logged in — an account's username is fixed to whatever it
// signed up with (see onAuthChange below), so it stays the same identity
// across chat, comments, and DMs with no way to change it mid-stream.
// Guests can still freely rename themselves; this is only a no-op for
// accounts.
export function setUsername(name){
  if (identity.loggedIn) return getIdentity();
  const clean = String(name || "").trim().slice(0, MAX_USERNAME_LEN);
  identity.username = clean || randomUsername();
  persistIdentity();
  return getIdentity();
}

export function setAvatar(emoji, color){
  if (AVATAR_EMOJIS.includes(emoji)) identity.avatarEmoji = emoji;
  if (AVATAR_COLORS.includes(color)) identity.avatarColor = color;
  // Picking an emoji/color is choosing "emoji mode" — a photo and the
  // emoji+color combo are mutually exclusive display states, so setting
  // one clears the other rather than leaving a hidden, unused photo behind.
  identity.photoURL = null;
  persistIdentity();
  return getIdentity();
}

// dataUrl must already be a small, compressed, square image — profile.js's
// upload flow produces one via canvas before calling this; nothing here
// resizes or compresses on its own.
// Account-gated, like DMs — a custom photo only makes sense tied to an
// account (a guest's local id resets on every device/clear, so an uploaded
// photo would just be silently orphaned). profile.js is responsible for
// hiding the upload UI for guests; this is the defense-in-depth check for
// anything that might call setPhoto() directly.
export function setPhoto(dataUrl){
  if (!identity.loggedIn) return getIdentity();
  if (!isValidPhotoURL(dataUrl)) return getIdentity();
  identity.photoURL = dataUrl;
  persistIdentity();
  return getIdentity();
}

export function clearPhoto(){
  identity.photoURL = null;
  persistIdentity();
  return getIdentity();
}

export function onIdentityChange(cb){
  identityListeners.add(cb);
  return () => identityListeners.delete(cb);
}

/* ---------------- Public stats API ---------------- */
export function getStats(){ return JSON.parse(JSON.stringify(stats)); }

export function onStatsChange(cb){
  statsListeners.add(cb);
  return () => statsListeners.delete(cb);
}

export function recordGamePlay(gameId){
  if (!gameId || typeof gameId !== "string") return false;
  const now = Date.now();
  const entry = stats.gamesPlayed[gameId];
  if (entry && now - entry.lastPlayedAt < PLAY_COOLDOWN_MS) return false;

  const isFirstTimeForGame = !entry;
  stats.gamesPlayed[gameId] = { count: (entry?.count || 0) + 1, lastPlayedAt: now };
  stats.totalPlays += 1;
  if (isFirstTimeForGame) stats.distinctGamesPlayedCount += 1;
  persistStats();

  const day = todayStr();
  runTransaction(ref(database, `stats/games/${gameId}/total`), v => (v || 0) + 1).catch(() => {});
  runTransaction(ref(database, `stats/games/${gameId}/daily/${day}`), v => (v || 0) + 1).catch(() => {});

  checkAchievements();
  return true;
}

export function recordChatMessage(){
  stats.chatMessagesSent += 1;
  persistStats();
  checkAchievements();
}

export function recordComment(){
  stats.commentsPosted += 1;
  persistStats();
  checkAchievements();
}

export function recordTicTacToeResult(result){
  if (result === "win") stats.tictactoe.wins += 1;
  else if (result === "loss") stats.tictactoe.losses += 1;
  else if (result === "draw") stats.tictactoe.draws += 1;
  else return;
  persistStats();
  checkAchievements();
}

export function recordVisit(){
  const today = todayStr();
  const last = stats.streak.lastVisitDate;
  if (last === today) return;
  if (last){
    const yesterday = todayStr(new Date(Date.now() - 86400000));
    stats.streak.current = (last === yesterday) ? stats.streak.current + 1 : 1;
  } else {
    stats.streak.current = 1;
  }
  stats.streak.longest = Math.max(stats.streak.longest, stats.streak.current);
  stats.streak.lastVisitDate = today;
  persistStats();
  checkAchievements();
}

/* ---------------- Achievements ---------------- */
let achievementsCache = null;
export async function getAllAchievements(){
  if (achievementsCache) return achievementsCache;
  try {
    const res = await fetch("achievements.json");
    const data = await res.json();
    achievementsCache = Array.isArray(data) ? data : [];
  } catch {
    achievementsCache = [];
  }
  return achievementsCache;
}

export function getUnlockedAchievements(){
  return Object.keys(stats.achievementsUnlocked);
}

function readStatPath(path){
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), stats);
}
function compare(value, op, target){
  switch (op){
    case "gte": return typeof value === "number" && value >= target;
    case "gt": return typeof value === "number" && value > target;
    case "eq": return value === target;
    default: return false;
  }
}

async function checkAchievements(){
  const all = await getAllAchievements();
  const newlyUnlocked = [];
  for (const ach of all){
    if (!ach || typeof ach.id !== "string" || stats.achievementsUnlocked[ach.id]) continue;
    const trigger = ach.trigger;
    if (!trigger || typeof trigger.stat !== "string") continue;
    const value = readStatPath(trigger.stat);
    if (compare(value, trigger.op, trigger.value)){
      stats.achievementsUnlocked[ach.id] = Date.now();
      newlyUnlocked.push(ach);
    }
  }
  if (!newlyUnlocked.length) return;
  saveJSON(STATS_KEY, stats);
  notifyStats();
  scheduleFlush();
  newlyUnlocked.forEach((ach, i) => {
    setTimeout(() => {
      window.toast?.(`${ach.icon || "🏆"} Achievement unlocked: ${ach.title}`);
      window.dispatchEvent(new CustomEvent("achievement:unlock", { detail: ach }));
    }, i * 2500);
  });
}

recordVisit();

/* ---------------- Account (optional layer on top of the guest identity) ----------------
   Signing in swaps the active id/username/avatar/numeric-stats over to the
   account's server record (or seeds that record from this device's current
   guest data, for a brand-new account) — every other module keeps calling
   getIdentity()/getStats() exactly as before and just sees it change.
   Per-game play cooldowns and unlocked achievements stay local/per-device
   even for an account, since they were never written server-side. */
let authResolved = false;
const authListeners = new Set();
function notifyAuthReady(){ authListeners.forEach(cb => { try { cb(identity.loggedIn); } catch {} }); }

onAuthChange(async (user) => {
  if (!user){
    if (identity.loggedIn){
      identity = freshGuestIdentity();
      stats = defaultStats();
      saveJSON(IDENTITY_KEY, identity);
      saveJSON(STATS_KEY, stats);
      notifyIdentity();
      notifyStats();
    }
    authResolved = true;
    notifyAuthReady();
    return;
  }

  // The username you log in with IS your display name everywhere (chat,
  // comments, DMs) once you have an account — permanently, not just as a
  // starting value. Derived fresh from the auth email on every login
  // (rather than trusted from whatever's stored in players/<uid>.username)
  // so it also self-heals any account whose stored name drifted from this
  // before that was enforced.
  const loginUsername = typeof user.email === "string" ? user.email.split("@")[0].slice(0, MAX_USERNAME_LEN) : "";

  try {
    const snap = await get(ref(database, "players/" + user.uid));
    const server = snap.val();
    if (server && server.stats){
      identity = {
        id: user.uid,
        username: loginUsername || (typeof server.username === "string" ? server.username : identity.username),
        avatarEmoji: AVATAR_EMOJIS.includes(server.avatarEmoji) ? server.avatarEmoji : identity.avatarEmoji,
        avatarColor: AVATAR_COLORS.includes(server.avatarColor) ? server.avatarColor : identity.avatarColor,
        photoURL: isValidPhotoURL(server.photoURL) ? server.photoURL : null,
        createdAt: identity.createdAt,
        loggedIn: true
      };
      const s = server.stats;
      stats = {
        ...stats,
        totalPlays: typeof s.totalPlays === "number" ? s.totalPlays : stats.totalPlays,
        distinctGamesPlayedCount: typeof s.distinctGamesPlayedCount === "number" ? s.distinctGamesPlayedCount : stats.distinctGamesPlayedCount,
        chatMessagesSent: typeof s.chatMessagesSent === "number" ? s.chatMessagesSent : stats.chatMessagesSent,
        commentsPosted: typeof s.commentsPosted === "number" ? s.commentsPosted : stats.commentsPosted,
        tictactoe: { ...stats.tictactoe, ...(s.tictactoe || {}) },
        streak: { ...stats.streak, ...(s.streak || {}) },
      };
    } else {
      // Brand new account, never persisted anything yet.
      identity = {
        ...identity,
        id: user.uid,
        username: loginUsername || identity.username,
        loggedIn: true
      };
    }
    saveJSON(IDENTITY_KEY, identity);
    notifyIdentity();
    recordVisit(); // re-evaluates today's streak against the now-current (account) identity
    // recordVisit() is a same-day no-op if the guest identity already logged
    // today's visit moments ago — that would otherwise skip persistStats(),
    // so explicitly (re)schedule a flush to make sure the account's record
    // actually gets written under its new id.
    scheduleFlush();
  } catch {
    // Network hiccup — stay on whatever local identity we already have.
  } finally {
    authResolved = true;
    notifyAuthReady();
  }
});

export function isLoggedIn(){ return !!identity.loggedIn; }
export function onAuthReady(cb){
  authListeners.add(cb);
  if (authResolved) cb(identity.loggedIn);
  return () => authListeners.delete(cb);
}

export const MoonIdentity = {
  getIdentity, setUsername, setAvatar, setPhoto, clearPhoto, onIdentityChange,
  getStats, onStatsChange,
  recordGamePlay, recordChatMessage, recordComment, recordTicTacToeResult, recordVisit,
  getUnlockedAchievements, getAllAchievements,
  isLoggedIn, onAuthReady,
  AVATAR_EMOJIS, AVATAR_COLORS
};
window.MoonIdentity = MoonIdentity;
