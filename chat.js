/* Moon Games chat drawer — same public chatroom backend as the original
   harshulgoon.github.io/chatroom.html (Firebase Realtime Database), just
   rebuilt as a site-wide, gameplay-integrated drawer with a matching UI. */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getDatabase, ref, push, onChildAdded, serverTimestamp, limitToLast, query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDWLUjSbCBuj5SR7MoqLo46EArhz_m4INc",
  authDomain: "chatroom-128ee.firebaseapp.com",
  databaseURL: "https://chatroom-128ee-default-rtdb.firebaseio.com",
  projectId: "chatroom-128ee",
  storageBucket: "chatroom-128ee.firebasestorage.app",
  messagingSenderId: "182268717548",
  appId: "1:182268717548:web:3a6bc1391aa25ea6b9f8c9",
  measurementId: "G-N8C16YX5VN"
};
const GIPHY_API_KEY = "U0f10I8Pc4dCa5Rc1nyBtfIV3tJ1wSOH";

const AVATAR_COLORS = ["#ff6b6b","#f7b731","#20bf6b","#0fb9b1","#2d98da","#8854d0","#eb3b5a","#fa8231"];
function colorFor(name){
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name){
  return (name || "?").trim().slice(0, 2).toUpperCase();
}
function escapeHtml(text){
  const div = document.createElement("div");
  div.textContent = text ?? "";
  return div.innerHTML;
}

/* ---------------- Build DOM ---------------- */
const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_GIF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><text x="12" y="15" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">GIF</text></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;

// Popup mode: a standalone window (chatpopup.html?popup=1) opened
// alongside a game that plays in its own tab, so chat stays available
// even when the game itself can't be embedded in-page. No FAB needed —
// the whole window IS the chat, open from the start.
const isPopupMode = new URLSearchParams(location.search).get("popup") === "1";

const fab = document.createElement("button");
fab.className = "chat-fab";
fab.id = "chatFab";
fab.setAttribute("aria-label", "Open chat");
fab.innerHTML = `${ICON_CHAT}<span class="badge" id="chatBadge">0</span>`;
document.body.appendChild(fab);

const panel = document.createElement("div");
panel.className = "chat-panel";
panel.id = "chatPanel";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Community chat");
panel.innerHTML = `
  <div class="chat-header">
    <span class="dot" aria-hidden="true"></span>
    <div>
      <h3>Moon Games Chat</h3>
      <span>Live &middot; everyone playing right now</span>
    </div>
    <div class="spacer"></div>
    <button class="icon-btn" id="chatCloseBtn" aria-label="Close chat" style="width:32px;height:32px">${ICON_CLOSE}</button>
  </div>
  <div class="chat-messages" id="chatMessages">
    <div class="chat-empty" id="chatEmpty">No messages yet &mdash; say hi 👋</div>
  </div>
  <div class="chat-inputbar">
    <div class="chat-username-row">
      <input type="text" id="chatUsername" placeholder="Your name" maxlength="20">
      <span class="char-count" id="chatCharCount"></span>
    </div>
    <div style="position:relative">
      <div class="chat-gif-picker" id="chatGifPicker">
        <div class="chat-gif-picker-head">
          <input type="text" id="chatGifSearch" placeholder="Search GIFs&hellip;">
          <button class="icon-btn" id="chatGifCloseBtn" style="width:32px;height:32px" aria-label="Close GIF picker">${ICON_CLOSE}</button>
        </div>
        <div class="chat-gif-grid" id="chatGifGrid"><div class="chat-gif-status">Loading trending GIFs&hellip;</div></div>
        <div class="chat-gif-credit">Powered by GIPHY</div>
      </div>
      <div class="chat-row">
        <button class="icon-btn" id="chatGifBtn" aria-label="Send a GIF" title="Send a GIF">${ICON_GIF}</button>
        <textarea id="chatMessageInput" rows="1" maxlength="500" placeholder="Message the community&hellip;"></textarea>
        <button class="send" id="chatSendBtn" aria-label="Send message" disabled>${ICON_SEND}</button>
      </div>
    </div>
  </div>
`;
document.body.appendChild(panel);

if (isPopupMode){
  fab.hidden = true;
  panel.classList.add("popup-mode");
}

const els = {
  fab, panel,
  badge: document.getElementById("chatBadge"),
  closeBtn: document.getElementById("chatCloseBtn"),
  messages: document.getElementById("chatMessages"),
  empty: document.getElementById("chatEmpty"),
  username: document.getElementById("chatUsername"),
  charCount: document.getElementById("chatCharCount"),
  input: document.getElementById("chatMessageInput"),
  sendBtn: document.getElementById("chatSendBtn"),
  gifBtn: document.getElementById("chatGifBtn"),
  gifPicker: document.getElementById("chatGifPicker"),
  gifSearch: document.getElementById("chatGifSearch"),
  gifGrid: document.getElementById("chatGifGrid"),
  gifCloseBtn: document.getElementById("chatGifCloseBtn"),
};

/* ---------------- State ---------------- */
let isOpen = false;
let unread = 0;
let hasReceivedFirstBatch = false;

const savedName = localStorage.getItem("chatUsername");
if (savedName) els.username.value = savedName;
els.username.addEventListener("change", () => {
  localStorage.setItem("chatUsername", els.username.value.trim());
});

function setOpen(open){
  isOpen = open;
  els.panel.classList.toggle("open", open);
  els.fab.setAttribute("aria-expanded", String(open));
  if (open){
    unread = 0;
    updateBadge();
    setTimeout(() => els.input.focus(), 200);
    els.messages.scrollTop = els.messages.scrollHeight;
  } else {
    closeGifPicker();
  }
}
function updateBadge(){
  els.badge.textContent = unread > 9 ? "9+" : String(unread);
  els.badge.classList.toggle("show", unread > 0 && !isOpen);
}
els.fab.addEventListener("click", () => setOpen(!isOpen));
els.closeBtn.addEventListener("click", () => setOpen(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen) setOpen(false);
});
if (isPopupMode){
  els.closeBtn.hidden = true; // nothing to "close" back to in a standalone window
  setOpen(true);
}

/* ---------------- Firebase ---------------- */
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const messagesRef = ref(database, "messages");
const recentMessagesQuery = query(messagesRef, limitToLast(50));

onChildAdded(recentMessagesQuery, (snapshot) => {
  renderMessage(snapshot.val());
  if (hasReceivedFirstBatch && !isOpen){
    unread++;
    updateBadge();
  }
});
// crude "first batch has loaded" flag so we don't count history as unread
setTimeout(() => { hasReceivedFirstBatch = true; }, 1200);

function renderMessage(message){
  if (!message) return;
  els.empty.remove();
  const myName = (els.username.value || "Anonymous").trim();
  const isOwn = message.username === myName && myName !== "Anonymous";

  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "now";

  const wrap = document.createElement("div");
  wrap.className = "chat-msg" + (isOwn ? " own" : "");

  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.style.background = colorFor(message.username || "?");
  avatar.textContent = initials(message.username);

  const col = document.createElement("div");
  col.className = "chat-bubble-col";

  const meta = document.createElement("div");
  meta.className = "chat-meta";
  meta.innerHTML = `<span class="name">${escapeHtml(message.username || "Anonymous")}</span><span class="time">${time}</span>`;

  const bubble = document.createElement("div");
  if (message.gifUrl){
    bubble.className = "chat-bubble gif-bubble";
    bubble.innerHTML = `<img src="${escapeHtml(message.gifUrl)}" alt="GIF" loading="lazy">`;
  } else {
    bubble.className = "chat-bubble";
    bubble.textContent = message.text || "";
  }

  col.appendChild(meta);
  col.appendChild(bubble);
  wrap.appendChild(avatar);
  wrap.appendChild(col);
  els.messages.appendChild(wrap);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function sendMessage(){
  const text = els.input.value.trim();
  if (!text) return;
  const username = els.username.value.trim() || "Anonymous";
  push(messagesRef, { username, text, timestamp: serverTimestamp() });
  els.input.value = "";
  autosize();
  updateSendState();
}
function sendGif(gifUrl){
  const username = els.username.value.trim() || "Anonymous";
  push(messagesRef, { username, gifUrl, timestamp: serverTimestamp() });
}

function updateSendState(){
  els.sendBtn.disabled = els.input.value.trim().length === 0;
  els.charCount.textContent = els.input.value.length > 400 ? `${els.input.value.length}/500` : "";
}
function autosize(){
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 90) + "px";
}
els.input.addEventListener("input", () => { autosize(); updateSendState(); });
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    sendMessage();
  }
});
els.sendBtn.addEventListener("click", sendMessage);

/* ---------------- GIPHY ---------------- */
let gifSearchTimeout = null;
let gifPickerOpen = false;

function openGifPicker(){
  gifPickerOpen = true;
  els.gifPicker.classList.add("open");
  loadTrendingGifs();
  setTimeout(() => els.gifSearch.focus(), 50);
}
function closeGifPicker(){
  gifPickerOpen = false;
  els.gifPicker.classList.remove("open");
}
els.gifBtn.addEventListener("click", () => gifPickerOpen ? closeGifPicker() : openGifPicker());
els.gifCloseBtn.addEventListener("click", closeGifPicker);

async function loadTrendingGifs(){
  els.gifGrid.innerHTML = `<div class="chat-gif-status">Loading trending GIFs&hellip;</div>`;
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_API_KEY}&limit=24&rating=pg-13`);
    const data = await res.json();
    renderGifs(data.data);
  } catch {
    els.gifGrid.innerHTML = `<div class="chat-gif-status">Couldn't load GIFs.</div>`;
  }
}
async function searchGifs(q){
  els.gifGrid.innerHTML = `<div class="chat-gif-status">Searching&hellip;</div>`;
  try {
    const res = await fetch(`https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(q)}&limit=24&rating=pg-13`);
    const data = await res.json();
    if (!data.data.length){ els.gifGrid.innerHTML = `<div class="chat-gif-status">No GIFs found.</div>`; return; }
    renderGifs(data.data);
  } catch {
    els.gifGrid.innerHTML = `<div class="chat-gif-status">Search failed.</div>`;
  }
}
function renderGifs(gifs){
  els.gifGrid.innerHTML = "";
  gifs.forEach(gif => {
    const img = document.createElement("img");
    img.src = gif.images.fixed_height_small.url;
    img.alt = gif.title || "GIF";
    img.loading = "lazy";
    img.addEventListener("click", (e) => {
      e.stopPropagation();
      sendGif(`https://media.giphy.com/media/${gif.id}/giphy.gif`);
      closeGifPicker();
    });
    els.gifGrid.appendChild(img);
  });
}
els.gifSearch.addEventListener("input", (e) => {
  clearTimeout(gifSearchTimeout);
  const q = e.target.value.trim();
  gifSearchTimeout = setTimeout(() => q ? searchGifs(q) : loadTrendingGifs(), 400);
});
document.addEventListener("click", (e) => {
  if (gifPickerOpen && !els.gifPicker.contains(e.target) && e.target !== els.gifBtn && !els.gifBtn.contains(e.target)){
    closeGifPicker();
  }
});
