/* Leaderboards page: game-level stats (aggregated client-side from a single
   read) plus three player rankings (server-side limited via orderByChild),
   plus the current visitor's own achievement catalog. */
import { database } from "./firebase-init.js";
import { getAllAchievements, getUnlockedAchievements } from "./identity.js";
import {
  ref, get, query, orderByChild, limitToLast, onValue
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const els = {
  trending: document.getElementById("lbTrending"),
  mostPlayed: document.getElementById("lbMostPlayed"),
  tictactoe: document.getElementById("lbTicTacToe"),
  streaks: document.getElementById("lbStreaks"),
  chatty: document.getElementById("lbChatty"),
  achGrid: document.getElementById("achGrid"),
};

function safeStr(v, max){ return typeof v === "string" ? v.slice(0, max) : ""; }
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
function renderEmpty(el, msg){ el.innerHTML = `<li class="lb-empty">${msg}</li>`; }

let gamesById = new Map();
async function loadGames(){
  try {
    const res = await fetch("games.json");
    const data = await res.json();
    gamesById = new Map(data.map(g => [g.id, g]));
  } catch {}
}

function renderGameRows(el, rows){
  if (!rows.length){ renderEmpty(el, "No plays yet."); return; }
  el.innerHTML = "";
  rows.forEach((row, i) => {
    const game = gamesById.get(row.gameId);
    const li = document.createElement("li");
    li.className = "lb-row";
    const rank = document.createElement("span"); rank.className = "lb-rank"; rank.textContent = "#" + (i + 1);
    const img = document.createElement("img"); img.className = "lb-thumb"; img.loading = "lazy"; img.alt = ""; img.src = game?.img || "";
    const name = document.createElement("span"); name.className = "lb-name"; name.textContent = game?.title || row.gameId;
    const value = document.createElement("span"); value.className = "lb-value"; value.textContent = row.value + (row.value === 1 ? " play" : " plays");
    li.append(rank, img, name, value);
    el.appendChild(li);
  });
}

function renderPlayerRows(el, rows, formatValue){
  if (!rows.length){ renderEmpty(el, "No data yet."); return; }
  el.innerHTML = "";
  rows.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "lb-row";
    const rank = document.createElement("span"); rank.className = "lb-rank"; rank.textContent = "#" + (i + 1);
    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    avatar.style.background = row.avatarColor || "#5e5ce6";
    avatar.textContent = row.avatarEmoji || "🙂";
    const name = document.createElement("span"); name.className = "lb-name"; name.textContent = row.username;
    const value = document.createElement("span"); value.className = "lb-value"; value.textContent = formatValue(row.value);
    li.append(rank, avatar, name, value);
    el.appendChild(li);
  });
}

function last7Dates(){
  const out = [];
  for (let i = 0; i < 7; i++) out.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return out;
}

async function loadGameStats(){
  try {
    const snap = await get(ref(database, "stats/games"));
    const val = snap.val();
    if (!val || typeof val !== "object"){
      renderEmpty(els.trending, "No plays yet.");
      renderEmpty(els.mostPlayed, "No plays yet.");
      return;
    }
    const days = new Set(last7Dates());
    const trending = [];
    const mostPlayed = [];
    for (const [gameId, entry] of Object.entries(val)){
      if (!entry || typeof entry !== "object") continue;
      const total = typeof entry.total === "number" ? entry.total : 0;
      if (total > 0) mostPlayed.push({ gameId, value: total });
      let weekSum = 0;
      if (entry.daily && typeof entry.daily === "object"){
        for (const [day, count] of Object.entries(entry.daily)){
          if (days.has(day) && typeof count === "number") weekSum += count;
        }
      }
      if (weekSum > 0) trending.push({ gameId, value: weekSum });
    }
    trending.sort((a, b) => b.value - a.value);
    mostPlayed.sort((a, b) => b.value - a.value);
    renderGameRows(els.trending, trending.slice(0, 10));
    renderGameRows(els.mostPlayed, mostPlayed.slice(0, 10));
  } catch {
    renderEmpty(els.trending, "Couldn't load.");
    renderEmpty(els.mostPlayed, "Couldn't load.");
  }
}

function readPath(obj, path){
  return path.split("/").reduce((acc, key) => (acc && typeof acc === "object") ? acc[key] : undefined, obj);
}

function subscribePlayerLeaderboard(el, statPath, formatValue){
  const q = query(ref(database, "players"), orderByChild(statPath), limitToLast(10));
  onValue(q, snap => {
    const val = snap.val();
    const rows = [];
    if (val && typeof val === "object"){
      for (const entry of Object.values(val)){
        if (!entry || typeof entry !== "object") continue;
        const value = readPath(entry, statPath);
        if (typeof value !== "number" || value <= 0) continue;
        rows.push({
          value,
          username: safeStr(entry.username, 40) || "Anonymous",
          avatarEmoji: safeStr(entry.avatarEmoji, 8) || "🙂",
          avatarColor: safeStr(entry.avatarColor, 20) || "#5e5ce6",
        });
      }
    }
    rows.sort((a, b) => b.value - a.value);
    renderPlayerRows(el, rows.slice(0, 10), formatValue);
  }, () => renderEmpty(el, "Couldn't load."));
}

async function renderAchievements(){
  const all = await getAllAchievements();
  const unlocked = new Set(getUnlockedAchievements());
  els.achGrid.innerHTML = all.map(a => `
    <div class="ach-card ${unlocked.has(a.id) ? "unlocked" : ""}">
      <span class="ach-icon">${a.icon || "🏆"}</span>
      <div>
        <div class="ach-title">${escapeHtml(a.title)}</div>
        <div class="ach-desc">${escapeHtml(a.description)}</div>
      </div>
    </div>`).join("");
}

(async () => {
  await loadGames();
  loadGameStats();
  subscribePlayerLeaderboard(els.tictactoe, "stats/tictactoe/wins", v => v + (v === 1 ? " win" : " wins"));
  subscribePlayerLeaderboard(els.streaks, "stats/streak/longest", v => v + (v === 1 ? " day" : " days"));
  subscribePlayerLeaderboard(els.chatty, "stats/chatMessagesSent", v => v + (v === 1 ? " message" : " messages"));
  renderAchievements();
})();
