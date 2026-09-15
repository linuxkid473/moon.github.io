/* Real-time 2-player Tic-Tac-Toe over Firebase RTDB. Room state is the
   single source of truth (rooms/<code>); moves and rematches are both
   applied via runTransaction so concurrent writes from both players never
   corrupt the board. */
import { database } from "./firebase-init.js";
import { getIdentity, recordTicTacToeResult, AVATAR_EMOJIS, AVATAR_COLORS } from "./identity.js";
import {
  ref, get, set, update, remove, onValue, onDisconnect, runTransaction, serverTimestamp,
  query, orderByChild, limitToFirst
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — avoids visual ambiguity
const WIN_LINES = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

const els = {
  lobby: document.getElementById("tttLobby"),
  lobbyMsg: document.getElementById("tttLobbyMsg"),
  createBtn: document.getElementById("tttCreateBtn"),
  joinCode: document.getElementById("tttJoinCode"),
  joinBtn: document.getElementById("tttJoinBtn"),
  waiting: document.getElementById("tttWaiting"),
  code: document.getElementById("tttCode"),
  copyBtn: document.getElementById("tttCopyBtn"),
  leaveWaitingBtn: document.getElementById("tttLeaveWaitingBtn"),
  boardPanel: document.getElementById("tttBoardPanel"),
  playerX: document.getElementById("tttPlayerX"),
  playerO: document.getElementById("tttPlayerO"),
  status: document.getElementById("tttStatus"),
  board: document.getElementById("tttBoard"),
  rematchBtn: document.getElementById("tttRematchBtn"),
  leaveBtn: document.getElementById("tttLeaveBtn"),
};

let currentCode = null;
let myRole = null;
let unsubscribeRoom = null;
let lastRecordedBoard = null;
let rematchResetInFlight = false;

/* ---------------- Board cells (built once) ---------------- */
for (let i = 0; i < 9; i++){
  const btn = document.createElement("button");
  btn.className = "ttt-cell";
  btn.type = "button";
  btn.dataset.index = String(i);
  btn.setAttribute("aria-label", "Cell " + (i + 1));
  els.board.appendChild(btn);
}
els.board.addEventListener("click", e => {
  const cell = e.target.closest(".ttt-cell");
  if (cell && !cell.disabled) makeMove(Number(cell.dataset.index));
});

function showPanel(name){
  els.lobby.hidden = name !== "lobby";
  els.waiting.hidden = name !== "waiting";
  els.boardPanel.hidden = name !== "board";
}
function showLobbyMsg(msg){
  els.lobbyMsg.textContent = msg;
  els.lobbyMsg.hidden = false;
}
function clearLobbyMsg(){
  els.lobbyMsg.hidden = true;
}

function generateRoomCode(){
  let s = "";
  for (let i = 0; i < 5; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function playerSnapshot(){
  const identity = getIdentity();
  return { id: identity.id, username: identity.username, avatarEmoji: identity.avatarEmoji, avatarColor: identity.avatarColor, connected: true };
}
function checkWinner(board){
  for (const line of WIN_LINES){
    const [a, b, c] = line;
    if (board[a] !== "-" && board[a] === board[b] && board[b] === board[c]) return { winner: board[a], line };
  }
  if (!board.includes("-")) return { winner: "draw" };
  return null;
}

/* ---------------- Create / join ---------------- */
async function createRoom(){
  els.createBtn.disabled = true;
  clearLobbyMsg();
  try {
    let code = null;
    for (let i = 0; i < 5; i++){
      const candidate = generateRoomCode();
      const snap = await get(ref(database, "rooms/" + candidate));
      if (!snap.exists()){ code = candidate; break; }
    }
    if (!code){ showLobbyMsg("Couldn't create a room — try again."); return; }
    await set(ref(database, "rooms/" + code), {
      code, createdAt: serverTimestamp(), status: "waiting",
      board: "---------", turn: "X",
      players: { X: playerSnapshot(), O: null },
      winner: null, winningLine: null,
      rematch: { X: false, O: false },
      updatedAt: Date.now()
    });
    myRole = "X";
    enterRoom(code);
  } catch {
    showLobbyMsg("Couldn't create a room — try again.");
  } finally {
    els.createBtn.disabled = false;
  }
}

async function joinRoomByCode(code){
  code = (code || "").trim().toUpperCase();
  if (!code) return;
  els.joinBtn.disabled = true;
  clearLobbyMsg();

  const roomRef = ref(database, "rooms/" + code);
  // Firebase RTDB transactions only see the real current value while an
  // active listener is already attached to that exact path — on a tab that
  // has never synced this path before, runTransaction sees current=null
  // FOREVER (not just a transient first pass) even though a plain get()
  // moments earlier correctly shows the data exists. So attach a listener
  // and keep it alive for the whole join attempt, including the transaction.
  let unsub;
  try {
    const latest = await new Promise(resolve => {
      unsub = onValue(roomRef, snap => resolve(snap.val()), { onlyOnce: false });
    });

    if (latest === null){ showLobbyMsg("Room not found."); return; }
    const myId = getIdentity().id;

    if (latest.players?.X?.id === myId){
      myRole = "X";
      await update(ref(database, `rooms/${code}/players/X`), { connected: true });
      enterRoom(code);
      return;
    }
    if (latest.players?.O?.id === myId){
      myRole = "O";
      await update(ref(database, `rooms/${code}/players/O`), { connected: true });
      enterRoom(code);
      return;
    }
    if (latest.status !== "waiting" || latest.players?.O){
      showLobbyMsg("Room is full or finished.");
      return;
    }

    const txResult = await runTransaction(roomRef, current => {
      if (!current) return;
      if (current.status === "waiting" && !current.players?.O){
        current.players.O = playerSnapshot();
        current.status = "active";
        current.updatedAt = Date.now();
        return current;
      }
      return;
    });
    if (!txResult.committed){ showLobbyMsg("Room is full or finished."); return; }
    myRole = "O";
    enterRoom(code);
  } catch {
    showLobbyMsg("Couldn't join that room.");
  } finally {
    unsub?.();
    els.joinBtn.disabled = false;
  }
}

function enterRoom(code){
  currentCode = code;
  lastRecordedBoard = null;
  const url = new URL(location.href);
  url.searchParams.set("room", code);
  history.replaceState(null, "", url);
  onDisconnect(ref(database, `rooms/${code}/players/${myRole}/connected`)).set(false);
  subscribeRoom(code);
}

function subscribeRoom(code){
  if (unsubscribeRoom) unsubscribeRoom();
  unsubscribeRoom = onValue(ref(database, "rooms/" + code), snap => {
    const room = snap.val();
    if (!room){ showLobbyMsg("That room no longer exists."); showPanel("lobby"); return; }
    renderRoom(room);
  });
}

function leaveRoom(){
  if (currentCode && myRole){
    update(ref(database, `rooms/${currentCode}/players/${myRole}`), { connected: false }).catch(() => {});
  }
  if (unsubscribeRoom){ unsubscribeRoom(); unsubscribeRoom = null; }
  currentCode = null;
  myRole = null;
  lastRecordedBoard = null;
  const url = new URL(location.href);
  url.searchParams.delete("room");
  history.replaceState(null, "", url);
  showPanel("lobby");
}

/* ---------------- Rendering ---------------- */
function renderPlayerBadge(el, player){
  el.innerHTML = "";
  if (!player){
    const span = document.createElement("span");
    span.className = "ttt-player-empty";
    span.textContent = "Waiting for opponent…";
    el.appendChild(span);
    return;
  }
  const avatar = document.createElement("span");
  avatar.className = "profile-avatar";
  avatar.style.background = AVATAR_COLORS.includes(player.avatarColor) ? player.avatarColor : "#5e5ce6";
  avatar.textContent = AVATAR_EMOJIS.includes(player.avatarEmoji) ? player.avatarEmoji : "🙂";
  const name = document.createElement("span");
  name.className = "ttt-player-name";
  name.textContent = typeof player.username === "string" ? player.username.slice(0, 40) : "Anonymous";
  el.append(avatar, name);
  if (player.connected === false){
    const offline = document.createElement("span");
    offline.className = "ttt-player-offline";
    offline.textContent = "offline";
    el.appendChild(offline);
  }
}

function maybeRecordResult(room){
  if (lastRecordedBoard === room.board) return;
  lastRecordedBoard = room.board;
  if (room.winner === "draw") recordTicTacToeResult("draw");
  else if (room.winner === myRole) recordTicTacToeResult("win");
  else if (room.winner) recordTicTacToeResult("loss");
}

function resetForRematch(code){
  if (rematchResetInFlight) return;
  rematchResetInFlight = true;
  update(ref(database, "rooms/" + code), {
    board: "---------", turn: "X", status: "active",
    winner: null, winningLine: null,
    rematch: { X: false, O: false },
    updatedAt: Date.now()
  }).catch(() => {}).finally(() => { rematchResetInFlight = false; });
}

function renderRoom(room){
  if (room.status === "waiting"){
    els.code.textContent = room.code || currentCode;
    showPanel("waiting");
    return;
  }
  showPanel("board");
  renderPlayerBadge(els.playerX, room.players?.X);
  renderPlayerBadge(els.playerO, room.players?.O);

  const board = typeof room.board === "string" && room.board.length === 9 ? room.board : "---------";
  const winLine = Array.isArray(room.winningLine) ? room.winningLine : [];
  [...els.board.children].forEach((cell, i) => {
    const v = board[i];
    cell.textContent = v === "-" ? "" : v;
    cell.classList.toggle("x", v === "X");
    cell.classList.toggle("o", v === "O");
    cell.classList.toggle("win", winLine.includes(i));
    cell.disabled = v !== "-" || room.status !== "active" || room.turn !== myRole;
  });

  if (room.status === "finished"){
    if (room.winner === "draw") els.status.textContent = "It's a draw!";
    else if (room.winner === myRole) els.status.textContent = "You won! 🎉";
    else els.status.textContent = "You lost.";
    els.rematchBtn.hidden = false;
    const rematch = room.rematch || {};
    els.rematchBtn.disabled = !!rematch[myRole];
    els.rematchBtn.textContent = rematch[myRole] ? "Waiting for opponent…" : "Rematch";
    maybeRecordResult(room);
    if (rematch.X && rematch.O && myRole === "X") resetForRematch(currentCode);
  } else {
    els.rematchBtn.hidden = true;
    let statusText = room.turn === myRole ? "Your turn" : "Opponent's turn";
    const opponent = myRole === "X" ? room.players?.O : room.players?.X;
    if (opponent && opponent.connected === false) statusText += " — opponent disconnected";
    els.status.textContent = statusText;
  }
}

function makeMove(index){
  if (!currentCode || !myRole) return;
  runTransaction(ref(database, "rooms/" + currentCode), room => {
    if (!room) return;
    if (room.status !== "active" || room.turn !== myRole) return;
    const cells = room.board.split("");
    if (cells[index] !== "-") return;
    cells[index] = myRole;
    room.board = cells.join("");
    const result = checkWinner(room.board);
    if (result){
      room.status = "finished";
      room.winner = result.winner;
      room.winningLine = result.line || null;
    } else {
      room.turn = myRole === "X" ? "O" : "X";
    }
    room.updatedAt = Date.now();
    return room;
  }).catch(() => {});
}

function requestRematch(){
  if (!currentCode || !myRole) return;
  update(ref(database, `rooms/${currentCode}/rematch`), { [myRole]: true }).catch(() => {});
}

/* ---------------- Opportunistic room cleanup ----------------
   There's no server here, so nothing ever expires finished/abandoned
   rooms on its own. Instead, any visitor's client — throttled to at most
   once per hour, so this stays cheap — sweeps a small batch of the oldest
   rooms and deletes any that have sat untouched for 24+ hours (a finished
   game nobody left, or a "waiting" room nobody ever joined). Best-effort:
   failures are swallowed since this must never block real gameplay. */
const CLEANUP_STORAGE_KEY = "moongames.lastRoomCleanup";
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const ROOM_STALE_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 25;

async function cleanupOldRoomsIfDue(){
  let last = 0;
  try { last = Number(localStorage.getItem(CLEANUP_STORAGE_KEY)) || 0; } catch {}
  if (Date.now() - last < CLEANUP_INTERVAL_MS) return;
  try { localStorage.setItem(CLEANUP_STORAGE_KEY, String(Date.now())); } catch {}

  try {
    const oldestRooms = query(ref(database, "rooms"), orderByChild("updatedAt"), limitToFirst(CLEANUP_BATCH_SIZE));
    const snap = await get(oldestRooms);
    const val = snap.val();
    if (!val || typeof val !== "object") return;
    const cutoff = Date.now() - ROOM_STALE_MS;
    const deletions = Object.entries(val)
      .filter(([, room]) => !(typeof room?.updatedAt === "number" && room.updatedAt >= cutoff))
      .map(([code]) => remove(ref(database, "rooms/" + code)).catch(() => {}));
    if (deletions.length) await Promise.all(deletions);
  } catch {
    // Best-effort — a missing index or a denied read just means we try again next hour.
  }
}

/* ---------------- Wiring ---------------- */
els.createBtn.addEventListener("click", createRoom);
els.joinBtn.addEventListener("click", () => joinRoomByCode(els.joinCode.value));
els.joinCode.addEventListener("keydown", e => { if (e.key === "Enter") joinRoomByCode(els.joinCode.value); });
els.leaveWaitingBtn.addEventListener("click", leaveRoom);
els.leaveBtn.addEventListener("click", leaveRoom);
els.rematchBtn.addEventListener("click", requestRematch);
els.copyBtn.addEventListener("click", async () => {
  if (!currentCode) return;
  const link = location.origin + location.pathname + "?room=" + currentCode;
  try {
    await navigator.clipboard.writeText(link);
    window.toast?.("Invite link copied");
  } catch {
    window.toast?.("Couldn't copy — share the code instead");
  }
});

/* ---------------- Auto-join from ?room= ---------------- */
const initialRoom = new URL(location.href).searchParams.get("room");
if (initialRoom) joinRoomByCode(initialRoom);

cleanupOldRoomsIfDue();
