/* Unified local identity + stats — a lightweight, localStorage-based "account"
   (no server, no auth). Every other new module (presence, comments, rooms,
   leaderboards) reads/writes through this instead of touching localStorage
   or players/<id> directly, so there's exactly one source of truth. */
import { database } from "./firebase-init.js";
import {
  ref, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const IDENTITY_KEY = "moongames.identity";
const STATS_KEY = "moongames.stats";
const LEGACY_USERNAME_KEY = "chatUsername";
const MAX_USERNAME_LEN = 20;
const PLAY_COOLDOWN_MS = 5 * 60 * 1000;

export const AVATAR_EMOJIS = ["🐙","🦊","🐻","🐼","🦁","🐯","🐸","🐵","🦄","🐲","🐢","🦉","🐺","🐰","🦖","🐨"];
export const AVATAR_COLORS = ["#ff6b6b","#f7b731","#20bf6b","#0fb9b1","#2d98da","#8854d0","#eb3b5a","#fa8231"];

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

let identity = loadJSON(IDENTITY_KEY, null);
if (!identity || typeof identity.id !== "string"){
  identity = {
    id: randomId(),
    username: "",
    avatarEmoji: AVATAR_EMOJIS[Math.floor(Math.random() * AVATAR_EMOJIS.length)],
    avatarColor: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
    createdAt: Date.now()
  };
  migrateLegacyUsername(identity);
  saveJSON(IDENTITY_KEY, identity);
}

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

export function setUsername(name){
  const clean = String(name || "").trim().slice(0, MAX_USERNAME_LEN);
  identity.username = clean || randomUsername();
  persistIdentity();
  return getIdentity();
}

export function setAvatar(emoji, color){
  if (AVATAR_EMOJIS.includes(emoji)) identity.avatarEmoji = emoji;
  if (AVATAR_COLORS.includes(color)) identity.avatarColor = color;
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

export const MoonIdentity = {
  getIdentity, setUsername, setAvatar, onIdentityChange,
  getStats, onStatsChange,
  recordGamePlay, recordChatMessage, recordComment, recordTicTacToeResult, recordVisit,
  getUnlockedAchievements, getAllAchievements,
  AVATAR_EMOJIS, AVATAR_COLORS
};
window.MoonIdentity = MoonIdentity;
