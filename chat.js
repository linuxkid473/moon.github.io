/* Moon Games chat drawer — community chat now runs on the site's OWN
   Firebase project (moongames-eba7f, via firebase-init.js), same as
   comments/DMs/presence, instead of the old third-party chatroom-128ee
   project. Private DMs are a separate feature layered on top (see dm.js)
   and gated to real accounts only — guests keep full access to community
   chat but see a sign-in prompt in place of the DM list. A maximize toggle
   expands the panel into a large window with a sidebar so community chat +
   multiple DM threads can all stay live and be switched between, instead
   of being stuck in the corner. */
import {
  ref, push, set, remove, onDisconnect, onChildAdded, onChildRemoved, onValue,
  serverTimestamp, limitToLast, query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";
import { database } from "./firebase-init.js";
import {
  getIdentity, onIdentityChange, setUsername, recordChatMessage,
  isLoggedIn, onAuthReady, isValidPhotoURL,
  AVATAR_EMOJIS, AVATAR_COLORS
} from "./identity.js";
import { startPresence, subscribeOnlineUsers } from "./presence.js";
import { censorText, isProfanityFilterOn, setProfanityFilterPref, hasStoredProfanityPref, containsBlockedName } from "./profanity.js";
import {
  getAccountProfile, searchAccountByUsername, openConversationWith, removeConversation,
  sendDirectMessage, deleteDirectMessage,
  fetchRecentMessages, fetchOlderMessages, subscribeNewMessages, subscribeRemovedMessages,
  subscribeInbox, markConversationRead,
  setTyping, subscribeTyping
} from "./dm.js";

const GIPHY_API_KEY = "U0f10I8Pc4dCa5Rc1nyBtfIV3tJ1wSOH";

function colorFor(name){
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name){
  return (name || "?").trim().slice(0, 2).toUpperCase();
}
// Shared by every avatar rendered anywhere in the chat widget (bubbles,
// online list, DM sidebar/search, the user card) — photoURL always wins
// when present and valid, otherwise falls back to the emoji+color combo.
// Uses el.src (never innerHTML) so an untrusted photoURL can't inject markup.
function paintAvatar(el, { photoURL, avatarEmoji, avatarColor, username }){
  el.innerHTML = "";
  if (isValidPhotoURL(photoURL)){
    el.style.background = "none";
    const img = document.createElement("img");
    img.src = photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    el.appendChild(img);
  } else if (AVATAR_EMOJIS.includes(avatarEmoji)){
    el.style.background = avatarColor && AVATAR_COLORS.includes(avatarColor) ? avatarColor : colorFor(username || "");
    el.textContent = avatarEmoji;
  } else {
    el.style.background = colorFor(username || "");
    el.textContent = initials(username);
  }
}

// Session-lived cache so re-rendering the DM sidebar (fires on every inbox
// change) doesn't re-fetch every other party's profile each time — a photo
// someone sets mid-session won't be picked up here until next page load,
// which is an acceptable tradeoff for how rarely that happens.
const avatarPhotoCache = {};
async function resolveAvatarPhoto(uid){
  if (!uid) return null;
  if (uid in avatarPhotoCache) return avatarPhotoCache[uid];
  const profile = await getAccountProfile(uid).catch(() => null);
  const photoURL = profile?.photoURL || null;
  avatarPhotoCache[uid] = photoURL;
  return photoURL;
}
/* ---------------- Build DOM ---------------- */
const ICON_CHAT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_GIF = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><text x="12" y="15" font-size="8" font-weight="700" text-anchor="middle" fill="currentColor" stroke="none">GIF</text></svg>`;
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
const ICON_FILTER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>`;
const ICON_MAXIMIZE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>`;
const ICON_MINIMIZE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
const ICON_X_SMALL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const fab = document.createElement("button");
fab.className = "chat-fab";
fab.id = "chatFab";
fab.setAttribute("aria-label", "Open chat");
fab.setAttribute("aria-expanded", "false");
fab.innerHTML = `${ICON_CHAT}<span class="badge" id="chatBadge">0</span>`;
document.body.appendChild(fab);

const unreadAnnouncer = document.createElement("div");
unreadAnnouncer.className = "sr-only";
unreadAnnouncer.setAttribute("aria-live", "polite");
document.body.appendChild(unreadAnnouncer);

const panel = document.createElement("div");
panel.className = "chat-panel";
panel.id = "chatPanel";
panel.setAttribute("role", "dialog");
panel.setAttribute("aria-label", "Community chat");
panel.innerHTML = `
  <div class="chat-header">
    <button class="icon-btn" id="chatBackBtn" aria-label="Back to conversations">${ICON_BACK}</button>
    <span class="dot" aria-hidden="true"></span>
    <div>
      <h3 id="chatTitle">Moon Games Chat</h3>
      <span id="chatLiveCount">Live &middot; everyone playing right now</span>
    </div>
    <div class="spacer"></div>
    <button class="icon-btn" id="chatFilterBtn" aria-label="Toggle swear word filter" aria-pressed="false" title="Filter swear words">${ICON_FILTER}</button>
    <button class="icon-btn" id="chatMaximizeBtn" aria-label="Maximize chat" aria-pressed="false" title="Maximize chat">${ICON_MAXIMIZE}</button>
    <button class="icon-btn" id="chatCloseBtn" aria-label="Close chat">${ICON_CLOSE}</button>
  </div>
  <div class="chat-body">
    <div class="chat-sidebar" id="chatSidebar">
      <button class="chat-sidebar-item active" id="chatSidebarCommunity" data-conv="community" type="button">
        <span class="chat-sidebar-icon" aria-hidden="true">💬</span>
        <span class="chat-sidebar-item-col"><span class="chat-sidebar-label">Community Chat</span></span>
      </button>
      <div class="chat-dm-section chat-hide" id="chatDmSection">
        <div class="chat-sidebar-heading">Direct Messages</div>
        <div class="chat-dm-list" id="chatDmList"></div>
        <div class="chat-dm-new">
          <button class="pill-btn" id="chatDmNewBtn" type="button">+ New message</button>
          <div class="chat-dm-search chat-hide" id="chatDmSearchWrap">
            <input type="text" id="chatDmSearch" placeholder="Search username&hellip;" maxlength="20" aria-label="Search username to message">
            <div class="chat-dm-search-results" id="chatDmSearchResults"></div>
          </div>
        </div>
      </div>
      <div class="chat-dm-guest-prompt chat-hide" id="chatDmGuestPrompt">
        <p>Sign in to send direct messages.</p>
        <button class="pill-btn primary" id="chatDmSignInBtn" type="button">Sign in</button>
      </div>
    </div>
    <div class="chat-main" id="chatMain">
      <div class="chat-online" id="chatOnline">
        <button class="chat-online-toggle" id="chatOnlineToggle" aria-expanded="false">
          <span id="chatOnlineToggleLabel">Who's online (0)</span>
          <span aria-hidden="true">▾</span>
        </button>
        <div class="chat-online-list" id="chatOnlineList" hidden></div>
      </div>
      <div class="chat-filter-prompt" id="chatFilterPrompt" hidden>
        <p>Filter swear words in chat?</p>
        <div class="chat-filter-prompt-actions">
          <button class="pill-btn" id="chatFilterNo">No thanks</button>
          <button class="pill-btn primary" id="chatFilterYes">Yes, filter it</button>
        </div>
      </div>
      <div class="chat-messages" id="chatMessages">
        <div class="chat-empty" id="chatEmpty">No messages yet &mdash; say hi 👋</div>
      </div>
      <div class="chat-typing-indicator" id="chatTypingIndicator" hidden></div>
      <div class="chat-inputbar">
        <div class="chat-username-row" id="chatUsernameRow">
          <input type="text" id="chatUsername" placeholder="Your name" aria-label="Your name" maxlength="20">
          <span class="char-count" id="chatCharCount"></span>
        </div>
        <div style="position:relative">
          <div class="chat-gif-picker" id="chatGifPicker">
            <div class="chat-gif-picker-head">
              <input type="text" id="chatGifSearch" placeholder="Search GIFs&hellip;">
              <button class="icon-btn" id="chatGifCloseBtn" aria-label="Close GIF picker">${ICON_CLOSE}</button>
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
    </div>
  </div>
`;
document.body.appendChild(panel);

// Small floating card shown when a username is clicked anywhere (community
// chat bubbles, the online list) — offers a "Message" button for account
// holders. Lives outside #chatPanel so it can float above it in any mode.
const userCard = document.createElement("div");
userCard.className = "chat-user-card";
userCard.id = "chatUserCard";
userCard.hidden = true;
userCard.innerHTML = `
  <div class="chat-user-card-head">
    <span class="profile-avatar lg" id="chatUserCardAvatar"></span>
    <span class="chat-user-card-name" id="chatUserCardName"></span>
  </div>
  <p class="chat-user-card-note" id="chatUserCardNote" hidden></p>
  <button class="pill-btn primary" id="chatUserCardMsgBtn" type="button" hidden>Message</button>
`;
document.body.appendChild(userCard);

const els = {
  fab, panel,
  badge: document.getElementById("chatBadge"),
  backBtn: document.getElementById("chatBackBtn"),
  title: document.getElementById("chatTitle"),
  closeBtn: document.getElementById("chatCloseBtn"),
  maximizeBtn: document.getElementById("chatMaximizeBtn"),
  messages: document.getElementById("chatMessages"),
  empty: document.getElementById("chatEmpty"),
  typingIndicator: document.getElementById("chatTypingIndicator"),
  usernameRow: document.getElementById("chatUsernameRow"),
  username: document.getElementById("chatUsername"),
  charCount: document.getElementById("chatCharCount"),
  input: document.getElementById("chatMessageInput"),
  sendBtn: document.getElementById("chatSendBtn"),
  gifBtn: document.getElementById("chatGifBtn"),
  gifPicker: document.getElementById("chatGifPicker"),
  gifSearch: document.getElementById("chatGifSearch"),
  gifGrid: document.getElementById("chatGifGrid"),
  gifCloseBtn: document.getElementById("chatGifCloseBtn"),
  filterBtn: document.getElementById("chatFilterBtn"),
  filterPrompt: document.getElementById("chatFilterPrompt"),
  filterYesBtn: document.getElementById("chatFilterYes"),
  filterNoBtn: document.getElementById("chatFilterNo"),
  liveCount: document.getElementById("chatLiveCount"),
  online: document.getElementById("chatOnline"),
  onlineToggle: document.getElementById("chatOnlineToggle"),
  onlineToggleLabel: document.getElementById("chatOnlineToggleLabel"),
  onlineList: document.getElementById("chatOnlineList"),
  sidebar: document.getElementById("chatSidebar"),
  sidebarCommunity: document.getElementById("chatSidebarCommunity"),
  dmSection: document.getElementById("chatDmSection"),
  dmList: document.getElementById("chatDmList"),
  dmNewBtn: document.getElementById("chatDmNewBtn"),
  dmSearchWrap: document.getElementById("chatDmSearchWrap"),
  dmSearch: document.getElementById("chatDmSearch"),
  dmSearchResults: document.getElementById("chatDmSearchResults"),
  dmGuestPrompt: document.getElementById("chatDmGuestPrompt"),
  dmSignInBtn: document.getElementById("chatDmSignInBtn"),
  userCard,
  userCardAvatar: document.getElementById("chatUserCardAvatar"),
  userCardName: document.getElementById("chatUserCardName"),
  userCardNote: document.getElementById("chatUserCardNote"),
  userCardMsgBtn: document.getElementById("chatUserCardMsgBtn"),
};

/* ---------------- State ---------------- */
let isOpen = false;
let isMaximized = false;
let unread = 0;
let dmUnreadTotal = 0;
let hasReceivedFirstBatch = false;
let lastFocused = null;
let activeConv = "community"; // "community" | a DM conversationId
let activeDmProfile = null;
let activeDmAddUnsub = null;
let activeDmRemoveUnsub = null;
let activeDmTypingUnsub = null;
let communityTypingNames = [];
let typingActive = false;
let typingClearTimer = null;
let lastTypingWriteAt = 0;
const TYPING_IDLE_MS = 4000; // stop reporting "typing" after this long with no keystrokes
const TYPING_REFRESH_MS = 2500; // don't re-write "still typing" more often than this
const TYPING_STALE_MS = 6000; // ignore a typing entry this old (sender's tab likely died)

/* ---------------- Presence ---------------- */
startPresence();
let onlineListOpen = false;
els.onlineToggle.addEventListener("click", () => {
  onlineListOpen = !onlineListOpen;
  els.onlineToggle.setAttribute("aria-expanded", String(onlineListOpen));
  els.onlineList.hidden = !onlineListOpen;
});
subscribeOnlineUsers(users => {
  const n = users.length;
  els.onlineToggleLabel.textContent = `Who's online (${n})`;
  if (activeConv === "community"){
    els.liveCount.textContent = n === 1 ? "1 person online now" : `${n} people online now`;
  }
  els.onlineList.innerHTML = "";
  users.forEach(u => {
    const row = document.createElement("div");
    row.className = "chat-online-row";
    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    paintAvatar(avatar, { photoURL: u.photoURL, avatarEmoji: u.avatarEmoji, avatarColor: u.avatarColor, username: u.username });
    const nameEl = document.createElement("span");
    nameEl.className = "chat-clickable-name";
    nameEl.textContent = u.username; // textContent only — never innerHTML — since it's untrusted
    nameEl.addEventListener("click", (e) => {
      e.stopPropagation();
      openUserCard(nameEl, u.id, u.username);
    });
    row.append(avatar, nameEl);
    els.onlineList.appendChild(row);
  });
});

/* ---------------- Profanity filter (client-side only, opt-in) ---------------- */
function setProfanityFilter(on){
  setProfanityFilterPref(on);
  els.filterBtn.classList.toggle("active", on);
  els.filterBtn.setAttribute("aria-pressed", String(on));
  // Re-apply to already-rendered text bubbles without re-fetching anything.
  els.messages.querySelectorAll(".chat-bubble[data-raw-text]").forEach(bubble => {
    const raw = bubble.dataset.rawText;
    bubble.textContent = on ? censorText(raw) : raw;
  });
}
function openFilterPrompt(){
  els.filterPrompt.hidden = false;
}
function closeFilterPrompt(){
  els.filterPrompt.hidden = true;
}
const hadStoredProfanityPref = hasStoredProfanityPref();
els.filterBtn.addEventListener("click", () => setProfanityFilter(!isProfanityFilterOn()));
els.filterYesBtn.addEventListener("click", () => { setProfanityFilter(true); closeFilterPrompt(); });
els.filterNoBtn.addEventListener("click", () => { setProfanityFilter(false); closeFilterPrompt(); });
// Sync the button's visual state without writing a default — writing here
// would make the "have we ever asked?" check below always false.
els.filterBtn.classList.toggle("active", isProfanityFilterOn());
els.filterBtn.setAttribute("aria-pressed", String(isProfanityFilterOn()));

function trapFocus(e){
  if (e.key !== "Tab") return;
  const focusable = [...els.panel.querySelectorAll('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(el => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first){
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last){
    e.preventDefault();
    first.focus();
  }
}

els.username.value = getIdentity().username;
els.username.addEventListener("change", () => {
  setUsername(els.username.value);
});
onIdentityChange(identity => {
  if (document.activeElement !== els.username) els.username.value = identity.username;
});

function setOpen(open){
  isOpen = open;
  els.panel.classList.toggle("open", open);
  els.fab.setAttribute("aria-expanded", String(open));
  if (open){
    lastFocused = document.activeElement;
    unread = 0;
    updateBadge();
    setTimeout(() => els.input.focus(), 200);
    els.messages.scrollTop = els.messages.scrollHeight;
    els.panel.addEventListener("keydown", trapFocus);
    if (!hadStoredProfanityPref && !hasStoredProfanityPref()) openFilterPrompt();
  } else {
    closeGifPicker();
    stopTyping();
    els.panel.removeEventListener("keydown", trapFocus);
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
    // A DM's unread count can grow for a conversation you're not actively
    // viewing even while the panel is open (only viewing that specific
    // thread clears it), so the badge's visibility needs recomputing here
    // too — not just when new messages arrive.
    updateBadge();
  }
}
function updateBadge(){
  const total = unread + dmUnreadTotal;
  els.badge.textContent = total > 9 ? "9+" : String(total);
  els.badge.classList.toggle("show", total > 0 && !isOpen);
  if (total > 0 && !isOpen){
    unreadAnnouncer.textContent = `${total} new message${total === 1 ? "" : "s"}`;
  }
}
els.fab.addEventListener("click", () => setOpen(!isOpen));
els.closeBtn.addEventListener("click", () => setOpen(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isOpen) setOpen(false);
});

/* ---------------- Maximize ---------------- */
function setMaximized(on){
  isMaximized = on;
  els.panel.classList.toggle("maximized", on);
  document.body.classList.toggle("chat-maximized", on);
  els.maximizeBtn.innerHTML = on ? ICON_MINIMIZE : ICON_MAXIMIZE;
  els.maximizeBtn.setAttribute("aria-label", on ? "Restore chat size" : "Maximize chat");
  els.maximizeBtn.setAttribute("aria-pressed", String(on));
  els.messages.scrollTop = els.messages.scrollHeight;
}
els.maximizeBtn.addEventListener("click", () => setMaximized(!isMaximized));
els.backBtn.addEventListener("click", () => els.panel.classList.remove("conversation-open"));

/* ---------------- Firebase (community chat, moongames-eba7f) ---------------- */
const messagesRef = ref(database, "messages");
const recentMessagesQuery = query(messagesRef, limitToLast(50));

// Messages come straight out of a public Firebase Realtime Database that
// anyone can write to directly (not just through this UI), so every field
// is treated as fully untrusted: strict type/shape checks, no innerHTML
// with any message-derived value, and GIFs only render when the URL is
// actually a giphy.com media URL — never rendered as raw HTML.
const GIF_URL_RE = /^https:\/\/media[0-9]*\.giphy\.com\/media\/.*\.(?:gif|webp|mp4)(?:\?.*)?$/i;
const MAX_TEXT_LEN = 2000;
const MAX_NAME_LEN = 40;

function safeString(value, maxLen){
  if (typeof value !== "string") return "";
  return value.slice(0, maxLen);
}

function appendBubble({ username, avatarEmoji, avatarColor, photoURL, text, gifUrl, timestamp, isOwn, identityId, key, onDelete, prepend }){
  els.empty?.remove();

  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "now";

  const wrap = document.createElement("div");
  wrap.className = "chat-msg" + (isOwn ? " own" : "");
  if (key) wrap.dataset.key = key;

  const avatar = document.createElement("div");
  avatar.className = "chat-avatar";
  avatar.style.fontSize = (isValidPhotoURL(photoURL) || AVATAR_EMOJIS.includes(avatarEmoji)) ? "14px" : "";
  paintAvatar(avatar, { photoURL, avatarEmoji, avatarColor, username });

  const col = document.createElement("div");
  col.className = "chat-bubble-col";

  const meta = document.createElement("div");
  meta.className = "chat-meta";
  const nameSpan = document.createElement("span");
  nameSpan.className = "name";
  nameSpan.textContent = username;
  if (identityId && !isOwn){
    nameSpan.classList.add("chat-clickable-name");
    nameSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      openUserCard(nameSpan, identityId, username);
    });
  }
  const timeSpan = document.createElement("span");
  timeSpan.className = "time";
  timeSpan.textContent = time;
  meta.appendChild(nameSpan);
  meta.appendChild(timeSpan);
  if (onDelete){
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "chat-msg-delete";
    delBtn.setAttribute("aria-label", "Delete message");
    delBtn.title = "Delete message";
    delBtn.innerHTML = ICON_TRASH;
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this message?")) return;
      delBtn.disabled = true;
      try {
        await onDelete();
        wrap.remove();
      } catch {
        delBtn.disabled = false;
        alert("Couldn't delete that message — try again in a moment.");
      }
    });
    meta.appendChild(delBtn);
  }

  const bubble = document.createElement("div");
  if (gifUrl){
    bubble.className = "chat-bubble gif-bubble";
    const img = document.createElement("img");
    img.src = gifUrl;
    img.alt = "GIF";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    bubble.appendChild(img);
  } else {
    bubble.className = "chat-bubble";
    bubble.dataset.rawText = text;
    bubble.textContent = isProfanityFilterOn() ? censorText(text) : text;
  }

  col.appendChild(meta);
  col.appendChild(bubble);
  wrap.appendChild(avatar);
  wrap.appendChild(col);
  if (prepend){
    els.messages.insertBefore(wrap, els.messages.firstChild);
  } else {
    els.messages.appendChild(wrap);
    els.messages.scrollTop = els.messages.scrollHeight;
  }
}

function removeBubbleByKey(key){
  if (!key) return;
  const el = els.messages.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (el) el.remove();
}

function renderMessage(message, prepend){
  if (!message || typeof message !== "object") return;

  const key = typeof message.key === "string" ? message.key : null;
  const username = safeString(message.username, MAX_NAME_LEN).trim() || "Anonymous";
  const text = safeString(message.text, MAX_TEXT_LEN);
  const gifUrl = typeof message.gifUrl === "string" && GIF_URL_RE.test(message.gifUrl) ? message.gifUrl : null;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : null;
  const avatarEmoji = AVATAR_EMOJIS.includes(message.avatarEmoji) ? message.avatarEmoji : null;
  const avatarColor = AVATAR_COLORS.includes(message.avatarColor) ? message.avatarColor : null;
  const photoURL = isValidPhotoURL(message.photoURL) ? message.photoURL : null;
  const identityId = typeof message.identityId === "string" ? message.identityId.slice(0, 60) : null;

  const isOwn = identityId
    ? identityId === getIdentity().id
    : username === (els.username.value || "Anonymous").trim() && username !== "Anonymous";

  appendBubble({
    username, avatarEmoji, avatarColor, photoURL, text, gifUrl, timestamp, isOwn, identityId, key, prepend,
    onDelete: isOwn && key ? () => deleteCommunityMessage(key) : null
  });
}

function renderDmMessage(message, otherProfile, conversationId, prepend){
  if (!message || typeof message !== "object") return;
  const key = typeof message.key === "string" ? message.key : null;
  const me = getIdentity();
  const senderId = typeof message.senderId === "string" ? message.senderId : null;
  const isOwn = senderId === me.id;
  const text = safeString(message.text, MAX_TEXT_LEN);
  const gifUrl = typeof message.gifUrl === "string" && GIF_URL_RE.test(message.gifUrl) ? message.gifUrl : null;
  const timestamp = typeof message.timestamp === "number" ? message.timestamp : null;
  const username = isOwn ? (me.username || "You") : (otherProfile?.username || "Unknown");
  const avatarEmoji = isOwn ? me.avatarEmoji : otherProfile?.avatarEmoji;
  const avatarColor = isOwn ? me.avatarColor : otherProfile?.avatarColor;
  const photoURL = isOwn ? me.photoURL : otherProfile?.photoURL;
  appendBubble({
    username, avatarEmoji, avatarColor, photoURL, text, gifUrl, timestamp, isOwn, key, prepend,
    onDelete: isOwn && key ? () => deleteDirectMessage(conversationId, key) : null
  });
}

// Community history is cached (rather than left purely as DOM) so switching
// back to it from a DM thread can replay it without re-subscribing.
let communityMessages = [];
const COMMUNITY_CACHE_MAX = 50;

function deleteCommunityMessage(key){
  // Not caught here — see the delete-button handler in appendBubble(),
  // which only removes the bubble once this actually resolves.
  return remove(ref(database, "messages/" + key));
}

onChildAdded(recentMessagesQuery, (snapshot) => {
  const msg = { key: snapshot.key, ...snapshot.val() };
  communityMessages.push(msg);
  if (communityMessages.length > COMMUNITY_CACHE_MAX) communityMessages.shift();
  if (activeConv === "community") renderMessage(msg);
  if (hasReceivedFirstBatch && !isOpen){
    unread++;
    updateBadge();
  }
});
onChildRemoved(recentMessagesQuery, (snapshot) => {
  communityMessages = communityMessages.filter(m => m.key !== snapshot.key);
  if (activeConv === "community") removeBubbleByKey(snapshot.key);
});
// crude "first batch has loaded" flag so we don't count history as unread
setTimeout(() => { hasReceivedFirstBatch = true; }, 1200);

/* ---------------- Typing indicator ---------------- */
// Community typing lives on the same public, rules-less chatroom-128ee
// project as the messages themselves — same trust model (untrusted, but
// cheap and low-stakes to get wrong). DM typing lives on moongames-eba7f
// and is participant-scoped by database.rules.json (dmTyping).
function renderTypingIndicator(names){
  if (!names || !names.length){
    els.typingIndicator.hidden = true;
    els.typingIndicator.textContent = "";
    return;
  }
  let text;
  if (names.length === 1) text = `${names[0]} is typing…`;
  else if (names.length === 2) text = `${names[0]} and ${names[1]} are typing…`;
  else text = `${names[0]}, ${names[1]} and ${names.length - 2} more are typing…`;
  els.typingIndicator.textContent = text;
  els.typingIndicator.hidden = false;
}

function writeCommunityTyping(isTyping){
  const identity = getIdentity();
  const typingRef = ref(database, "typing/" + identity.id);
  if (isTyping){
    onDisconnect(typingRef).remove();
    set(typingRef, { username: (els.username.value.trim() || identity.username || "Anonymous").slice(0, MAX_NAME_LEN), timestamp: serverTimestamp() }).catch(() => {});
  } else {
    onDisconnect(typingRef).cancel();
    remove(typingRef).catch(() => {});
  }
}

onValue(ref(database, "typing"), (snapshot) => {
  const now = Date.now();
  const myId = getIdentity().id;
  const names = [];
  snapshot.forEach(child => {
    if (child.key === myId) return;
    const v = child.val();
    if (v && typeof v.timestamp === "number" && now - v.timestamp < TYPING_STALE_MS){
      names.push(safeString(v.username, MAX_NAME_LEN).trim() || "Someone");
    }
  });
  communityTypingNames = names;
  if (activeConv === "community") renderTypingIndicator(names);
});

function reportTyping(){
  const now = Date.now();
  if (!typingActive || now - lastTypingWriteAt > TYPING_REFRESH_MS){
    lastTypingWriteAt = now;
    typingActive = true;
    if (activeConv === "community") writeCommunityTyping(true);
    else if (activeDmProfile) setTyping(activeConv, true);
  }
  clearTimeout(typingClearTimer);
  typingClearTimer = setTimeout(stopTyping, TYPING_IDLE_MS);
}
function stopTyping(){
  clearTimeout(typingClearTimer);
  if (!typingActive) return;
  typingActive = false;
  if (activeConv === "community") writeCommunityTyping(false);
  else if (activeDmProfile) setTyping(activeConv, false);
}

/* ---------------- Conversation switching (community <-> DMs) ---------------- */
function resetMessagesView(emptyText){
  els.messages.innerHTML = `<div class="chat-empty" id="chatEmpty">${emptyText}</div>`;
  els.empty = document.getElementById("chatEmpty");
}
function detachActiveConversation(){
  if (activeDmAddUnsub){ activeDmAddUnsub(); activeDmAddUnsub = null; }
  if (activeDmRemoveUnsub){ activeDmRemoveUnsub(); activeDmRemoveUnsub = null; }
  if (activeDmTypingUnsub){ activeDmTypingUnsub(); activeDmTypingUnsub = null; }
  dmOldestKey = null;
  dmNoMoreHistory = false;
  dmLoadingOlder = false;
  stopTyping();
}
function setActiveSidebarItem(){
  els.sidebarCommunity.classList.toggle("active", activeConv === "community");
  els.dmList.querySelectorAll(".chat-dm-item").forEach(item => {
    item.classList.toggle("active", item.dataset.conv === activeConv);
  });
}
function setConversationOpen(open){
  els.panel.classList.toggle("conversation-open", open);
}

// The "Your name" quick-rename field only makes sense for guests — once
// logged in, the username is locked to whatever was used to sign up (see
// identity.js's setUsername/onAuthChange), so the field is just hidden
// rather than shown-but-inert.
function updateUsernameRowVisibility(){
  els.usernameRow.classList.toggle("chat-hide", activeConv !== "community" || isLoggedIn());
}

function switchToCommunity(){
  if (activeConv === "community"){ setConversationOpen(true); return; }
  detachActiveConversation();
  activeConv = "community";
  activeDmProfile = null;
  els.title.textContent = "Moon Games Chat";
  els.online.classList.remove("chat-hide");
  updateUsernameRowVisibility();
  els.input.placeholder = "Message the community…";
  panel.setAttribute("aria-label", "Community chat");
  resetMessagesView("No messages yet — say hi 👋");
  communityMessages.forEach(renderMessage);
  renderTypingIndicator(communityTypingNames);
  setActiveSidebarItem();
  setConversationOpen(true);
}

async function switchToDm(conversationId, profile){
  if (activeConv === conversationId){ setConversationOpen(true); return; }
  detachActiveConversation();
  activeConv = conversationId;
  activeDmProfile = profile;
  els.title.textContent = profile.username || "Direct message";
  els.liveCount.textContent = "Direct message";
  els.online.classList.add("chat-hide");
  els.usernameRow.classList.add("chat-hide");
  els.input.placeholder = `Message ${profile.username || "them"}…`;
  panel.setAttribute("aria-label", `Direct message with ${profile.username || "user"}`);
  resetMessagesView(`Say hi to ${profile.username || "them"} 👋`);
  renderTypingIndicator([]);
  activeDmTypingUnsub = subscribeTyping(conversationId, othersTyping => {
    if (activeConv === conversationId) renderTypingIndicator(othersTyping ? [profile.username || "They"] : []);
  });
  markConversationRead(conversationId);
  if (dmInboxCache[conversationId]) dmInboxCache[conversationId].unreadCount = 0;
  recomputeDmUnreadTotal();
  renderDmSidebarList();
  setActiveSidebarItem();
  setConversationOpen(true);

  // Refetched live (not just trusted from the cached inbox/search-result
  // fields) so a photo (or emoji/color) the other person set after this
  // conversation was created still shows correctly.
  const [recent, freshProfile] = await Promise.all([
    fetchRecentMessages(conversationId).catch(() => []),
    getAccountProfile(profile.uid).catch(() => null)
  ]);
  if (activeConv !== conversationId) return; // switched to something else while this loaded
  if (freshProfile) profile = activeDmProfile = { ...profile, ...freshProfile };
  recent.forEach(entry => renderDmMessage(entry, profile, conversationId));
  dmOldestKey = recent.length ? recent[0].key : null;
  dmNoMoreHistory = recent.length < 20;
  let newestKey = recent.length ? recent[recent.length - 1].key : null;
  activeDmAddUnsub = subscribeNewMessages(conversationId, newestKey, entry => {
    newestKey = entry.key;
    renderDmMessage(entry, profile, conversationId);
  });
  activeDmRemoveUnsub = subscribeRemovedMessages(conversationId, key => removeBubbleByKey(key));
}
els.sidebarCommunity.addEventListener("click", switchToCommunity);

/* ---------------- DM history pagination (scroll up to load older) ---------------- */
let dmOldestKey = null;
let dmNoMoreHistory = false;
let dmLoadingOlder = false;

async function loadOlderDmMessages(){
  if (dmLoadingOlder || dmNoMoreHistory || !dmOldestKey || activeConv === "community") return;
  const conversationId = activeConv;
  const profile = activeDmProfile;
  dmLoadingOlder = true;
  els.messages.classList.add("loading-older");
  const older = await fetchOlderMessages(conversationId, dmOldestKey).catch(() => []);
  dmLoadingOlder = false;
  els.messages.classList.remove("loading-older");
  if (activeConv !== conversationId) return; // switched away while this loaded
  if (!older.length){ dmNoMoreHistory = true; return; }
  const prevScrollHeight = els.messages.scrollHeight;
  const prevScrollTop = els.messages.scrollTop;
  older.slice().reverse().forEach(entry => renderDmMessage(entry, profile, conversationId, true));
  dmOldestKey = older[0].key;
  if (older.length < 20) dmNoMoreHistory = true;
  els.messages.scrollTop = prevScrollTop + (els.messages.scrollHeight - prevScrollHeight);
}
els.messages.addEventListener("scroll", () => {
  if (activeConv !== "community" && els.messages.scrollTop < 60) loadOlderDmMessages();
});

/* ---------------- DM inbox + sidebar list ---------------- */
let dmInboxUnsub = null;
let dmInboxCache = {};

function recomputeDmUnreadTotal(){
  dmUnreadTotal = Object.values(dmInboxCache)
    .reduce((sum, e) => sum + (typeof e.unreadCount === "number" ? e.unreadCount : 0), 0);
  updateBadge();
}

function renderDmSidebarList(){
  const entries = Object.values(dmInboxCache).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  els.dmList.innerHTML = "";
  entries.forEach(entry => {
    // A <div role="button"> rather than a real <button> — the remove "x"
    // below has to be a proper <button> of its own, and buttons can't nest.
    const item = document.createElement("div");
    item.className = "chat-sidebar-item chat-dm-item" + (activeConv === entry.conversationId ? " active" : "");
    item.dataset.conv = entry.conversationId;
    item.setAttribute("role", "button");
    item.tabIndex = 0;

    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    paintAvatar(avatar, { avatarEmoji: entry.otherAvatarEmoji, avatarColor: entry.otherAvatarColor, username: entry.otherUsername });
    resolveAvatarPhoto(entry.otherUid).then(photoURL => {
      if (photoURL) paintAvatar(avatar, { photoURL, avatarEmoji: entry.otherAvatarEmoji, avatarColor: entry.otherAvatarColor, username: entry.otherUsername });
    });

    const col = document.createElement("span");
    col.className = "chat-sidebar-item-col";
    const name = document.createElement("span");
    name.className = "chat-sidebar-label";
    name.textContent = safeString(entry.otherUsername, MAX_NAME_LEN) || "Unknown";
    const preview = document.createElement("span");
    preview.className = "chat-sidebar-preview";
    const lm = entry.lastMessage;
    preview.textContent = lm ? (lm.gifUrl ? "GIF" : safeString(lm.text, 60)) : "";
    col.append(name, preview);

    item.append(avatar, col);
    const unreadCount = typeof entry.unreadCount === "number" ? entry.unreadCount : 0;
    if (unreadCount > 0){
      const badge = document.createElement("span");
      badge.className = "chat-sidebar-badge";
      badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
      item.appendChild(badge);
    }

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "chat-dm-remove";
    const otherName = safeString(entry.otherUsername, MAX_NAME_LEN) || "this user";
    removeBtn.setAttribute("aria-label", `Remove conversation with ${otherName}`);
    removeBtn.title = "Remove conversation";
    removeBtn.innerHTML = ICON_X_SMALL;
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Remove this conversation with ${otherName}? It'll disappear from your list — they'll still have theirs.`)) return;
      removeConversation(entry.conversationId).then(() => {
        if (activeConv === entry.conversationId) switchToCommunity();
      });
    });
    item.appendChild(removeBtn);

    const activate = () => switchToDm(entry.conversationId, {
      uid: entry.otherUid, username: entry.otherUsername,
      avatarEmoji: entry.otherAvatarEmoji, avatarColor: entry.otherAvatarColor
    });
    item.addEventListener("click", activate);
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " "){ e.preventDefault(); activate(); }
    });
    els.dmList.appendChild(item);
  });
}

function attachDmInbox(){
  detachDmInbox();
  dmInboxUnsub = subscribeInbox(list => {
    dmInboxCache = {};
    list.forEach(entry => { dmInboxCache[entry.conversationId] = entry; });
    renderDmSidebarList();
    recomputeDmUnreadTotal();
  });
}
function detachDmInbox(){
  if (dmInboxUnsub){ dmInboxUnsub(); dmInboxUnsub = null; }
  dmInboxCache = {};
  els.dmList.innerHTML = "";
  dmUnreadTotal = 0;
  updateBadge();
}

/* ---------------- Account gating for DMs ---------------- */
let lastGateState = null;
function renderDmGate(loggedIn){
  els.dmGuestPrompt.classList.toggle("chat-hide", loggedIn);
  els.dmSection.classList.toggle("chat-hide", !loggedIn);
  updateUsernameRowVisibility();
  if (loggedIn){
    attachDmInbox();
  } else {
    detachDmInbox();
    els.dmSearchWrap.classList.add("chat-hide");
    els.dmSearch.value = "";
    els.dmSearchResults.innerHTML = "";
    if (activeConv !== "community") switchToCommunity();
  }
}
function handleGateChange(){
  const loggedIn = isLoggedIn();
  if (loggedIn === lastGateState) return;
  lastGateState = loggedIn;
  renderDmGate(loggedIn);
}
onAuthReady(loggedIn => { lastGateState = loggedIn; renderDmGate(loggedIn); });
onIdentityChange(handleGateChange);
els.dmSignInBtn.addEventListener("click", (e) => {
  // Stop this click from bubbling to document — profile.js's own
  // outside-click handler would otherwise see it (after synchronously
  // opening the popover via the programmatic click below) and treat it
  // as a click outside the popover, closing it again immediately.
  e.stopPropagation();
  document.getElementById("profileBtn")?.click();
});

/* ---------------- DM: start a new conversation by username ---------------- */
let dmSearchTimeout = null;
els.dmNewBtn.addEventListener("click", () => {
  const willShow = els.dmSearchWrap.classList.contains("chat-hide");
  els.dmSearchWrap.classList.toggle("chat-hide", !willShow);
  if (willShow) setTimeout(() => els.dmSearch.focus(), 50);
});
function renderDmSearchResults(results){
  els.dmSearchResults.innerHTML = "";
  if (!results.length){
    els.dmSearchResults.innerHTML = `<div class="chat-dm-search-empty">No account found</div>`;
    return;
  }
  results.forEach(r => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "chat-dm-search-row";
    const avatar = document.createElement("span");
    avatar.className = "profile-avatar";
    paintAvatar(avatar, { photoURL: r.photoURL, avatarEmoji: r.avatarEmoji, avatarColor: r.avatarColor, username: r.username });
    const name = document.createElement("span");
    name.textContent = safeString(r.username, MAX_NAME_LEN) || "Unknown";
    row.append(avatar, name);
    row.addEventListener("click", async () => {
      row.disabled = true;
      try {
        const conversationId = await openConversationWith(r.uid, r);
        els.dmSearch.value = "";
        els.dmSearchResults.innerHTML = "";
        els.dmSearchWrap.classList.add("chat-hide");
        switchToDm(conversationId, r);
      } catch { /* ignore — network hiccup or race with rules */ }
    });
    els.dmSearchResults.appendChild(row);
  });
}
els.dmSearch.addEventListener("input", () => {
  clearTimeout(dmSearchTimeout);
  const q = els.dmSearch.value.trim();
  if (!q){ els.dmSearchResults.innerHTML = ""; return; }
  dmSearchTimeout = setTimeout(async () => {
    const results = await searchAccountByUsername(q).catch(() => []);
    renderDmSearchResults(results);
  }, 350);
});

/* ---------------- Click-a-username -> Message card ---------------- */
// Wired from community chat bubbles and the "who's online" list — the
// only two places a username appears outside of an already-open DM.
let userCardRequestId = null;
function positionUserCard(anchorEl){
  const rect = anchorEl.getBoundingClientRect();
  const cardWidth = 220;
  let left = Math.min(rect.left, window.innerWidth - cardWidth - 12);
  left = Math.max(12, left);
  let top = rect.bottom + 6;
  els.userCard.style.left = `${left}px`;
  els.userCard.style.top = `${top}px`;
  // Flip above the anchor if it would otherwise run off the bottom edge —
  // measured after an initial layout pass since the card's height depends
  // on which state (loading/note/button) is currently showing.
  requestAnimationFrame(() => {
    const cardRect = els.userCard.getBoundingClientRect();
    if (cardRect.bottom > window.innerHeight - 12){
      els.userCard.style.top = `${Math.max(12, rect.top - cardRect.height - 6)}px`;
    }
  });
}
function closeUserCard(){
  els.userCard.hidden = true;
  userCardRequestId = null;
}
async function openUserCard(anchorEl, identityId, fallbackUsername){
  if (!identityId) return;
  const requestId = identityId + ":" + Date.now();
  userCardRequestId = requestId;
  els.userCardName.textContent = fallbackUsername || "…";
  paintAvatar(els.userCardAvatar, { username: fallbackUsername });
  els.userCardMsgBtn.hidden = true;
  els.userCardMsgBtn.onclick = null;
  els.userCardNote.hidden = false;
  els.userCardNote.textContent = "Loading…";
  els.userCard.hidden = false;
  positionUserCard(anchorEl);

  const profile = await getAccountProfile(identityId).catch(() => null);
  if (userCardRequestId !== requestId) return; // a newer click superseded this one

  if (!profile){
    els.userCardNote.textContent = "This user doesn't have an account.";
    return;
  }
  els.userCardName.textContent = profile.username;
  paintAvatar(els.userCardAvatar, { photoURL: profile.photoURL, avatarEmoji: profile.avatarEmoji, avatarColor: profile.avatarColor, username: profile.username });

  if (profile.uid === getIdentity().id){
    els.userCardNote.textContent = "That's you.";
    return;
  }
  if (!isLoggedIn()){
    els.userCardNote.textContent = "Sign in to send direct messages.";
    return;
  }
  els.userCardNote.hidden = true;
  els.userCardMsgBtn.hidden = false;
  els.userCardMsgBtn.onclick = async () => {
    closeUserCard();
    try {
      const conversationId = await openConversationWith(profile.uid, profile);
      if (!isOpen) setOpen(true);
      if (!isMaximized) setMaximized(true);
      switchToDm(conversationId, profile);
    } catch { /* ignore — network hiccup or rules race */ }
  };
}
document.addEventListener("click", (e) => {
  if (!els.userCard.hidden && !els.userCard.contains(e.target) && !e.target.classList.contains("chat-clickable-name")){
    closeUserCard();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.userCard.hidden) closeUserCard();
});

/* ---------------- Sending ---------------- */
function identityFields(){
  const identity = getIdentity();
  const fields = { identityId: identity.id, avatarEmoji: identity.avatarEmoji, avatarColor: identity.avatarColor };
  // Embedded per-message (like avatarEmoji/avatarColor already are) rather
  // than looked up live, so it stays small: photos are pre-compressed to a
  // tiny data URL in profile.js before ever reaching identity.photoURL.
  if (isValidPhotoURL(identity.photoURL)) fields.photoURL = identity.photoURL;
  return fields;
}
function sendMessage(){
  const text = els.input.value.trim();
  if (!text) return;
  if (containsBlockedName(text)){
    alert("That message can't be sent.");
    return;
  }
  if (activeConv === "community"){
    const username = els.username.value.trim() || "Anonymous";
    push(messagesRef, { username, text, timestamp: serverTimestamp(), ...identityFields() });
    recordChatMessage();
  } else if (activeDmProfile){
    sendDirectMessage(activeConv, activeDmProfile.uid, { text }).catch(() => {});
  }
  stopTyping();
  els.input.value = "";
  autosize();
  updateSendState();
}
function sendGif(gifUrl){
  if (activeConv === "community"){
    const username = els.username.value.trim() || "Anonymous";
    push(messagesRef, { username, gifUrl, timestamp: serverTimestamp(), ...identityFields() });
    recordChatMessage();
  } else if (activeDmProfile){
    sendDirectMessage(activeConv, activeDmProfile.uid, { gifUrl }).catch(() => {});
  }
}

function updateSendState(){
  els.sendBtn.disabled = els.input.value.trim().length === 0;
  els.charCount.textContent = els.input.value.length > 400 ? `${els.input.value.length}/500` : "";
}
function autosize(){
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 90) + "px";
}
els.input.addEventListener("input", () => {
  autosize();
  updateSendState();
  if (els.input.value.trim()) reportTyping();
  else stopTyping();
});
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
