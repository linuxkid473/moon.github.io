/* Moon Games admin console (admin.html).
   Signs in with the site's normal account (username + password), or with Google, and only opens for the user "ultrabsd" or the admin's
   Gmail. That check here is just so the page knows what to show: the real lock is in database.rules.json, where reading and changing
   recommendations and the site settings is only allowed for those two accounts, so nobody else can get at them by editing this file.
   Tabs: Overview, Recommendations (what people want to see next), Comments (moderation), Games, Site (announcement and switches).
   For testing, on localhost only, admin.html?demo shows the whole panel with made-up data and never touches Firebase. */
import { database } from "./firebase-init.js";
import { onAnyAuthChange, logIn, logOut, signInWithGoogle } from "./auth.js";
import { ref, get, onValue, set, update, remove } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const ADMIN_EMAIL = "ultrabsd@moongames.app";         // the site account
const ADMIN_GMAIL = "nathan.vihaan@gmail.com";           // or this Google account (only counts once Google has verified it)
const isAdminUser = (u) => { const e = (u?.email || "").toLowerCase(); return e === ADMIN_EMAIL || (e === ADMIN_GMAIL && u.emailVerified === true); };
const DB_URL = "https://moongames-eba7f-default-rtdb.asia-southeast1.firebasedatabase.app";
const DEMO = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has("demo");

/* ---------- small helpers ---------- */
const h = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return e;
};
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-AU") : "—");
const dayStr = (back = 0) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
const ago = (ts) => {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
};
const when = (ts) => (ts ? new Date(ts).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
const download = (name, text, type) => { const a = h("a", { href: URL.createObjectURL(new Blob([text], { type })), download: name }); document.body.append(a); a.click(); a.remove(); };

/* ---------- data: the real Firebase, or made-up data for ?demo on localhost ---------- */
function liveApi() {
  return {
    watchRecs: (cb) => onValue(ref(database, "recommendations"), (s) => {
      const out = [];
      s.forEach((c) => { const v = c.val(); if (v && typeof v.text === "string") out.push({ id: c.key, text: v.text, ts: typeof v.ts === "number" ? v.ts : 0, done: !!v.done }); });
      cb(out);
    }, () => cb(null)),
    setRecDone: (id, done) => update(ref(database, `recommendations/${id}`), { done }),
    delRec: (id) => remove(ref(database, `recommendations/${id}`)),
    stats: async () => (await get(ref(database, "stats/games"))).val() || {},
    playerCount: async () => { const j = await (await fetch(`${DB_URL}/players.json?shallow=true`)).json(); return j ? Object.keys(j).length : 0; },
    watchOnline: (cb) => onValue(ref(database, "presence"), (s) => {
      const now = Date.now(); let n = 0;
      s.forEach((c) => { const t = c.val()?.lastSeen; if (typeof t === "number" && now - t < 3 * 60000) n++; });
      cb(n);
    }),
    comments: async () => {
      const all = (await get(ref(database, "comments"))).val() || {}, out = [];
      for (const [gid, g] of Object.entries(all)) for (const [id, c] of Object.entries(g?.items || {})) {
        if (c && typeof c.text === "string") out.push({ gid, id, username: String(c.username || "Anonymous").slice(0, 40), text: c.text.slice(0, 500), ts: typeof c.timestamp === "number" ? c.timestamp : 0 });
      }
      return out.sort((a, b) => b.ts - a.ts);
    },
    delComment: (gid, id) => remove(ref(database, `comments/${gid}/items/${id}`)),
    getSite: async () => (await get(ref(database, "site"))).val() || {},
    saveSite: (o) => set(ref(database, "site"), o),
  };
}
function demoApi() {
  const now = Date.now();
  let recs = [
    ["Geometry Dash please", 3], ["geometry dash!", 20], ["Can you add Minecraft? I want to build stuff with my friends.\nThanks", 50], ["something like Among Us", 130],
    ["Geometry Dash", 300], ["Subway Surfers 2", 700], ["A proper chess game with an AI to play against", 1500], ["fnaf", 2600],
  ].map(([text, mins], i) => ({ id: "r" + i, text, ts: now - mins * 60000, done: i === 6 }));
  const watchers = new Set();
  const stats = {};
  for (const [i, id] of ["slope", "subwaysurf", "retrobowl", "angustaylor", "2048", "cookieclicker", "ovo", "drifthunters", "run3", "tinyfishing"].entries()) {
    const daily = {}; for (let d = 0; d < 14; d++) daily[dayStr(d)] = Math.round((40 - i * 3) * (1 + Math.sin(d + i) * 0.4) + 5);
    stats[id] = { total: Object.values(daily).reduce((a, b) => a + b, 0) * 7, daily };
  }
  let comments = [
    { gid: "slope", id: "c1", username: "PlayerOne", text: "this game is so hard but so good", ts: now - 40 * 60000 },
    { gid: "angustaylor", id: "c2", username: "ultrabsd", text: "new 3D edition is out!", ts: now - 5 * 3600000 },
    { gid: "2048", id: "c3", username: "Player4821", text: "got to 4096 finally", ts: now - 26 * 3600000 },
  ];
  let site = { announcement: { text: "New: the Angus Taylah 3D edition just got a big update.", enabled: false }, recsEnabled: true };
  const fire = () => watchers.forEach((cb) => cb(recs.map((r) => ({ ...r }))));
  return {
    watchRecs: (cb) => { watchers.add(cb); cb(recs.map((r) => ({ ...r }))); return () => watchers.delete(cb); },
    setRecDone: async (id, done) => { recs.find((r) => r.id === id).done = done; fire(); },
    delRec: async (id) => { recs = recs.filter((r) => r.id !== id); fire(); },
    stats: async () => stats,
    playerCount: async () => 1342,
    watchOnline: (cb) => { cb(7); return () => {}; },
    comments: async () => comments.map((c) => ({ ...c })),
    delComment: async (gid, id) => { comments = comments.filter((c) => !(c.gid === gid && c.id === id)); },
    getSite: async () => JSON.parse(JSON.stringify(site)),
    saveSite: async (o) => { site = JSON.parse(JSON.stringify(o)); },
  };
}
const api = DEMO ? demoApi() : liveApi();

/* ---------- state ---------- */
const root = document.getElementById("app");
let games = [];
let view = "loading", user = null, tab = "overview";
let recs = undefined;            // undefined: loading, null: couldn't read, array: the list
let recFilter = "open", recQuery = "";
let cleanups = [];               // things to stop when the tab or the view changes
let stopRecs = null;
const TABS = [["overview", "Overview"], ["recs", "Recommendations"], ["comments", "Comments"], ["games", "Games"], ["site", "Site"]];
const gameTitle = (id) => games.find((g) => g.id === id)?.title || id;
const stopAll = () => { cleanups.forEach((f) => { try { f(); } catch { /* already stopped */ } }); cleanups = []; };

/* ---------- sign-in and access ---------- */
function renderLogin(message = "") {
  stopAll();
  const err = h("div", { class: "adm-err", text: message, role: "alert" });
  const u = h("input", { id: "admUser", type: "text", autocomplete: "username", autocapitalize: "none", spellcheck: "false" });
  const p = h("input", { id: "admPass", type: "password", autocomplete: "current-password" });
  const go = h("button", { class: "adm-btn primary", type: "submit", text: "Sign in", style: "width:100%;margin-top:16px;padding:10px" });
  const form = h("form", { class: "adm-center", onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ""; go.disabled = true;
    try { await logIn(u.value, p.value); } catch (x) { err.textContent = x.message || "Couldn't sign in."; go.disabled = false; }
  } }, h("h1", { text: "Admin" }), h("p", { text: "Sign in with your Moon Games account, or with Google." }),
  h("label", { for: "admUser", text: "Username" }), u, h("label", { for: "admPass", text: "Password" }), p, go,
  h("div", { class: "adm-or", text: "or" }),
  h("button", { class: "adm-btn", type: "button", text: "Sign in with Google", style: "width:100%;padding:10px", onclick: async () => {
    err.textContent = "";
    try { await signInWithGoogle(); } catch (x) { err.textContent = x.message; }
  } }), err);
  root.replaceChildren(form);
  u.focus();
}
function renderDenied() {
  stopAll();
  root.replaceChildren(h("div", { class: "adm-center" }, h("h1", { text: "Not authorised" }), h("p", { text: "This page is only for the site's admin." }),
    h("button", { class: "adm-btn", type: "button", text: "Sign out", onclick: () => logOut() }), " ", h("a", { class: "adm-btn", href: "index.html", text: "Back to the site", style: "text-decoration:none;display:inline-block" })));
}

/* ---------- the panel ---------- */
function renderPanel() {
  stopAll();
  const main = h("main", { class: "adm-main", id: "admMain" });
  const tabs = h("nav", { class: "adm-tabs", role: "tablist" });
  const drawTabs = () => tabs.replaceChildren(...TABS.map(([id, label]) => {
    const open = id === "recs" && Array.isArray(recs) ? recs.filter((r) => !r.done).length : 0;
    return h("button", { class: "adm-tab" + (tab === id ? " on" : ""), role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; drawTabs(); show(); } }, label, open ? h("span", { class: "adm-badge", text: String(open) }) : null);
  }));
  root.replaceChildren(
    DEMO ? h("div", { class: "adm-demo", text: "DEMO: made-up data, nothing is saved" }) : null,
    h("header", { class: "adm-top" }, h("div", { class: "adm-brand" }, h("i"), "Moon Games ", h("small", { text: "admin" })), tabs,
      h("div", { class: "adm-who" }, h("a", { href: "index.html", text: "← Site", style: "color:inherit" }), user?.name || "", DEMO ? null : h("button", { class: "adm-btn", type: "button", text: "Sign out", onclick: () => logOut() }))),
    main);
  const fns = { overview, recs: recsTab, comments: commentsTab, games: gamesTab, site: siteTab };
  const show = () => { stopAll(); const pane = h("div"); main.replaceChildren(pane); fns[tab](pane); };
  stopRecs?.();
  stopRecs = api.watchRecs((list) => { recs = list; drawTabs(); if (tab === "recs") show(); });
  drawTabs();
  show();
}

/* Overview */
async function overview(el) {
  el.append(h("h2", { text: "Overview" }), h("p", { class: "adm-sub", text: "How the site is doing." }));
  const cards = h("div", { class: "adm-cards" }), body = h("div");
  el.append(cards, body);
  const [stats, players] = await Promise.all([api.stats().catch(() => ({})), api.playerCount().catch(() => null)]);
  if (!el.isConnected) return;   // (they switched tab while it loaded)
  const days = Array.from({ length: 14 }, (_, i) => dayStr(13 - i));
  const perDay = Object.fromEntries(days.map((d) => [d, 0]));
  const perGame = [];
  let total = 0;
  for (const [id, g] of Object.entries(stats)) {
    let week = 0;
    for (const [d, n] of Object.entries(g?.daily || {})) { if (d in perDay && typeof n === "number") perDay[d] += n; if (d >= dayStr(6) && typeof n === "number") week += n; }
    total += g?.total || 0;
    perGame.push({ id, week, total: g?.total || 0 });
  }
  const online = h("b", { text: "…" });
  const card = (value, label) => h("div", { class: "adm-card" }, typeof value === "object" ? value : h("b", { text: value }), h("span", { text: label }));
  cards.append(card(num(perDay[dayStr(0)]), "plays today"), card(num(days.slice(-7).reduce((a, d) => a + perDay[d], 0)), "plays, last 7 days"), card(num(total), "plays, all time"),
    card(num(players), "players"), card(online, "online now"), card(num(games.length), "games"),
    card(Array.isArray(recs) ? String(recs.filter((r) => !r.done).length) : "—", "open recommendations"));
  cleanups.push(api.watchOnline((n) => { online.textContent = String(n); }));
  const max = Math.max(1, ...Object.values(perDay));
  const chart = h("div", { class: "adm-bars" }, days.map((d) => h("div", { title: `${d}: ${perDay[d]} plays` }, h("i", { style: `height:${Math.max(2, (perDay[d] / max) * 100)}%` }), h("em", { text: d.slice(8) }))));
  const top = perGame.sort((a, b) => b.week - a.week).slice(0, 10), topMax = Math.max(1, top[0]?.week || 1);
  body.append(h("div", { class: "adm-grid2" },
    h("div", { class: "adm-panel" }, h("h3", { text: "Plays per day (last 14 days, UTC)" }), chart),
    h("div", { class: "adm-panel" }, h("h3", { text: "Top games this week" }), top.length
      ? h("div", { class: "adm-rows" }, top.map((g) => h("div", { class: "adm-row" }, h("span", { text: gameTitle(g.id), title: gameTitle(g.id) }), h("i", { style: `width:${(g.week / topMax) * 100}%` }), h("b", { text: num(g.week) }))))
      : h("p", { class: "adm-note", text: "No plays recorded yet." }))));
}

/* Recommendations */
function recsTab(el) {
  el.append(h("h2", { text: "Recommendations" }), h("p", { class: "adm-sub", text: "What people want to see next." }));
  if (recs === undefined) { el.append(h("p", { class: "adm-empty", text: "Loading…" })); return; }
  if (recs === null) {
    el.append(h("div", { class: "adm-panel" }, h("h3", { text: "Couldn't read the recommendations" }),
      h("p", { class: "adm-note", text: "The database rules for recommendations haven't been published yet, or this account isn't ultrabsd. See docs/ADMIN.md." })));
    return;
  }
  // the same request in different words counts as one: one text contains the other
  const groups = new Map();
  for (const r of recs) {
    const k = norm(r.text); if (!k) continue;
    const same = [...groups.keys()].find((o) => o === k || (Math.min(o.length, k.length) >= 4 && (o.includes(k) || k.includes(o))));
    const key = same ?? k, g = groups.get(key) || { n: 0, sample: r.text.trim().split("\n")[0].slice(0, 80) };
    g.n++;
    if (same && k.length < same.length) { g.sample = r.text.trim().split("\n")[0].slice(0, 80); groups.delete(same); groups.set(k, g); } else groups.set(key, g);
  }
  const asks = [...groups.values()].filter((g) => g.n > 1).sort((a, b) => b.n - a.n).slice(0, 12);
  if (asks.length) el.append(h("div", { class: "adm-panel" }, h("h3", { text: "Asked for more than once" }), h("div", { class: "adm-asks" }, asks.map((g) => h("span", {}, h("b", { text: g.n + "×" }), g.sample)))));

  const list = h("div", { class: "adm-list" });
  const draw = () => {
    const q = recQuery.trim().toLowerCase();
    const rows = recs.filter((r) => (recFilter === "all" || (recFilter === "done") === r.done) && (!q || r.text.toLowerCase().includes(q))).sort((a, b) => b.ts - a.ts);
    list.replaceChildren(...(rows.length ? rows.map((r) => h("div", { class: "adm-item" + (r.done ? " done" : "") },
      h("div", { class: "adm-text" }, r.text, h("div", { class: "adm-meta", title: when(r.ts), text: `${ago(r.ts)} · ${when(r.ts)}` })),
      h("div", { class: "adm-acts" },
        h("button", { class: "adm-btn", type: "button", text: r.done ? "Reopen" : "Done", onclick: () => api.setRecDone(r.id, !r.done).catch(() => alert("Couldn't update that.")) }),
        h("button", { class: "adm-btn danger", type: "button", text: "Delete", onclick: () => { if (confirm("Delete this recommendation?")) api.delRec(r.id).catch(() => alert("Couldn't delete that.")); } })))) : [h("div", { class: "adm-empty", text: recs.length ? "Nothing matches." : "No recommendations yet." })]));
  };
  const seg = h("div", { class: "adm-seg" }, [["open", "Open"], ["done", "Done"], ["all", "All"]].map(([id, label]) =>
    h("button", { type: "button", class: recFilter === id ? "on" : "", text: label, onclick: (e) => { recFilter = id; [...seg.children].forEach((b) => b.classList.toggle("on", b === e.currentTarget)); draw(); } })));
  const search = h("input", { type: "search", placeholder: "Search…", value: recQuery, "aria-label": "Search recommendations", oninput: (e) => { recQuery = e.target.value; draw(); } });
  const csv = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    download(`recommendations-${dayStr(0)}.csv`, ["time,done,text", ...[...recs].sort((a, b) => a.ts - b.ts).map((r) => [esc(new Date(r.ts).toISOString()), r.done, esc(r.text)].join(","))].join("\n"), "text/csv");
  };
  const copy = async (e) => { try { await navigator.clipboard.writeText([...recs].filter((r) => !r.done).sort((a, b) => a.ts - b.ts).map((r, i) => `${i + 1}. ${r.text.trim().replace(/\s*\n\s*/g, " / ")}`).join("\n")); e.target.textContent = "Copied"; setTimeout(() => (e.target.textContent = "Copy open list"), 1500); } catch { alert("Couldn't copy."); } };
  el.append(h("div", { class: "adm-bar" }, seg, search, h("button", { class: "adm-btn", type: "button", text: "Copy open list", onclick: copy }), h("button", { class: "adm-btn", type: "button", text: "Export CSV", onclick: csv })), list);
  draw();
}

/* Comments */
async function commentsTab(el) {
  el.append(h("h2", { text: "Comments" }), h("p", { class: "adm-sub", text: "The latest comments on every game. Delete anything that shouldn't be there." }));
  const list = h("div", { class: "adm-list" }, h("div", { class: "adm-empty", text: "Loading…" }));
  let all = [], q = "";
  const draw = () => {
    const rows = all.filter((c) => !q || (c.text + " " + c.username + " " + gameTitle(c.gid)).toLowerCase().includes(q)).slice(0, 150);
    list.replaceChildren(...(rows.length ? rows.map((c) => h("div", { class: "adm-item" },
      h("div", { class: "adm-text" }, c.text, h("div", { class: "adm-meta", text: `${c.username} on ${gameTitle(c.gid)} · ${ago(c.ts)}` })),
      h("div", { class: "adm-acts" }, h("button", { class: "adm-btn danger", type: "button", text: "Delete", onclick: async () => {
        if (!confirm("Delete this comment?")) return;
        try { await api.delComment(c.gid, c.id); all = all.filter((x) => x !== c); draw(); } catch { alert("Couldn't delete that."); }
      } })))) : [h("div", { class: "adm-empty", text: all.length ? "Nothing matches." : "No comments yet." })]));
  };
  const load = async () => { try { all = await api.comments(); } catch { all = []; list.replaceChildren(h("div", { class: "adm-empty", text: "Couldn't load comments." })); return; } draw(); };
  el.append(h("div", { class: "adm-bar" }, h("input", { type: "search", placeholder: "Search comments, users, games…", "aria-label": "Search comments", oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } }),
    h("button", { class: "adm-btn", type: "button", text: "Refresh", onclick: load })), list);
  await load();
}

/* Games */
async function gamesTab(el) {
  el.append(h("h2", { text: "Games" }), h("p", { class: "adm-sub", text: `All ${games.length} games and how often they are played.` }));
  const stats = await api.stats().catch(() => ({}));
  if (!el.isConnected) return;
  const t0 = dayStr(0), w0 = dayStr(6);
  const rows = games.map((g) => {
    const s = stats[g.id] || {}; let week = 0;
    for (const [d, n] of Object.entries(s.daily || {})) if (d >= w0 && typeof n === "number") week += n;
    return { id: g.id, title: g.title, genre: (g.genres || [])[0] || "", exclusive: !!g.exclusive, today: s.daily?.[t0] || 0, week, total: s.total || 0 };
  });
  let sortKey = "total", dir = -1, q = "";
  const body = h("tbody");
  const draw = () => {
    const list = rows.filter((r) => !q || (r.title + " " + r.genre).toLowerCase().includes(q)).sort((a, b) => (typeof a[sortKey] === "string" ? a[sortKey].localeCompare(b[sortKey]) : a[sortKey] - b[sortKey]) * dir);
    body.replaceChildren(...list.map((r) => h("tr", {}, h("td", {}, r.title, r.exclusive ? h("span", { class: "adm-tag", text: "Exclusive", style: "margin-left:8px" }) : null), h("td", { text: r.genre }), h("td", { class: "n", text: num(r.today) }), h("td", { class: "n", text: num(r.week) }), h("td", { class: "n", text: num(r.total) }))));
  };
  const th = (key, label, n) => h("th", { class: n ? "n" : "", text: label, onclick: () => { dir = sortKey === key ? -dir : key === "title" || key === "genre" ? 1 : -1; sortKey = key; draw(); } });
  el.append(h("div", { class: "adm-bar" }, h("input", { type: "search", placeholder: "Search games…", "aria-label": "Search games", oninput: (e) => { q = e.target.value.trim().toLowerCase(); draw(); } })),
    h("table", { class: "adm-table" }, h("thead", {}, h("tr", {}, th("title", "Game"), th("genre", "Genre"), th("today", "Today", true), th("week", "7 days", true), th("total", "All time", true))), body));
  draw();
}

/* Site: an announcement bar and the on/off switch for the recommendations strip */
async function siteTab(el) {
  el.append(h("h2", { text: "Site" }), h("p", { class: "adm-sub", text: "Changes show up for every visitor within a minute or so." }));
  let site = {};
  try { site = await api.getSite(); if (!el.isConnected) return; } catch { el.append(h("p", { class: "adm-note", text: "Couldn't load the current settings (publish the database rules first, see docs/ADMIN.md)." })); }
  const text = h("textarea", { id: "annText", rows: "3", maxlength: "200", placeholder: "e.g. New games added this week!" }); text.value = site.announcement?.text || "";
  const on = h("input", { type: "checkbox", id: "annOn" }); on.checked = !!site.announcement?.enabled;
  const recsOn = h("input", { type: "checkbox", id: "recsOn" }); recsOn.checked = site.recsEnabled !== false;
  const status = h("span", { class: "adm-ok" });
  const save = h("button", { class: "adm-btn primary", type: "button", text: "Save", onclick: async () => {
    save.disabled = true; status.textContent = "";
    try { await api.saveSite({ announcement: { text: text.value.trim().slice(0, 200), enabled: on.checked && !!text.value.trim(), ts: Date.now() }, recsEnabled: recsOn.checked }); status.textContent = "Saved"; }
    catch { status.textContent = ""; alert("Couldn't save. Publish the database rules first (docs/ADMIN.md)."); }
    save.disabled = false;
  } });
  el.append(h("div", { class: "adm-panel adm-form" },
    h("h3", { text: "Announcement" }), h("p", { class: "adm-note", text: "A small bar at the top of the site (visitors can dismiss it)." }),
    h("label", { for: "annText", text: "Message (200 characters at most)" }), text,
    h("label", { class: "adm-check" }, on, "Show the announcement"),
    h("h3", { text: "Recommendations strip", style: "margin-top:22px" }),
    h("label", { class: "adm-check" }, recsOn, "Show \"What game do you want to see next?\" at the top of the site"),
    h("div", { style: "margin-top:16px" }, save, status)));
}

/* ---------- start ---------- */
async function start() {
  try { games = await (await fetch("games.json")).json(); } catch { games = []; }
  if (DEMO) { user = { name: "ultrabsd" }; view = "panel"; renderPanel(); return; }
  onAnyAuthChange((u) => {
    const email = (u?.email || "").toLowerCase();
    if (!u) { view = "login"; stopRecs?.(); stopRecs = null; recs = undefined; renderLogin(); }
    else if (isAdminUser(u)) { user = { name: email.endsWith("@moongames.app") ? email.split("@")[0] : email }; if (view !== "panel") { view = "panel"; renderPanel(); } }
    else { view = "denied"; stopRecs?.(); stopRecs = null; renderDenied(); }
  });
}
start();
