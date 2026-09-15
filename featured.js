/* Daily featured game: a date-seeded deterministic pick, identical for every
   visitor on a given day, with zero Firebase writes. */
import { database } from "./firebase-init.js";
import { ref, get } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

function hashString(str){
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export function pickFeaturedGame(allGames, seed = "day"){
  if (!Array.isArray(allGames) || !allGames.length) return null;
  const sorted = [...allGames].sort((a, b) => a.id.localeCompare(b.id));
  const now = new Date();
  const key = seed === "week"
    ? now.getFullYear() + "-W" + String(Math.ceil((((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + new Date(now.getFullYear(), 0, 1).getDay() + 1) / 7))
    : now.toISOString().slice(0, 10);
  const index = hashString(key) % sorted.length;
  return sorted[index];
}

export async function getFeaturedStats(gameId){
  try {
    const snap = await get(ref(database, `stats/games/${gameId}`));
    const val = snap.val() || {};
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = (val.daily && typeof val.daily[today] === "number") ? val.daily[today] : 0;
    let weekCount = 0;
    if (val.daily && typeof val.daily === "object"){
      for (let i = 0; i < 7; i++){
        const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        if (typeof val.daily[day] === "number") weekCount += val.daily[day];
      }
    }
    return { today: todayCount, total: typeof val.total === "number" ? val.total : 0, week: weekCount };
  } catch {
    return { today: 0, total: 0, week: 0 };
  }
}
