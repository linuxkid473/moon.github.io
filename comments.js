/* Per-game comments + like toggle, mounted inside the player overlay's
   side panel. mount(gameId) must be paired with unmount() before mounting a
   different gameId, so listeners never leak across games. */
import { database } from "./firebase-init.js";
import { getIdentity, recordComment, isLoggedIn, onIdentityChange } from "./identity.js";
import { censorText, isProfanityFilterOn, containsBlockedName } from "./profanity.js";
import {
  ref, push, onChildAdded, onValue, runTransaction, serverTimestamp, limitToLast, query
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const MAX_TEXT_LEN = 500;
const MAX_NAME_LEN = 40;

let els = null;
let unsubscribers = [];
let currentGameId = null;

function safeString(value, maxLen){
  return typeof value === "string" ? value.slice(0, maxLen) : "";
}

function ensureEls(){
  if (els) return els;
  els = {
    list: document.getElementById("commentsList"),
    form: document.getElementById("commentsForm"),
    input: document.getElementById("commentsInput"),
    likeBtn: document.getElementById("commentsLike"),
    likeIcon: document.getElementById("commentsLikeIcon"),
    likeCount: document.getElementById("commentsLikeCount"),
    loginPrompt: document.getElementById("commentsLoginPrompt"),
    loginBtn: document.getElementById("commentsLoginBtn"),
  };
  els.loginBtn.addEventListener("click", () => document.getElementById("profileBtn")?.click());
  return els;
}

function renderAuthGate(){
  const loggedIn = isLoggedIn();
  els.form.hidden = !loggedIn;
  els.likeBtn.disabled = !loggedIn;
  els.loginPrompt.hidden = loggedIn;
}

function renderComment(comment){
  const username = safeString(comment.username, MAX_NAME_LEN).trim() || "Anonymous";
  const text = safeString(comment.text, MAX_TEXT_LEN);
  const timestamp = typeof comment.timestamp === "number" ? comment.timestamp : null;
  const avatarEmoji = typeof comment.avatarEmoji === "string" ? comment.avatarEmoji : "🙂";
  const avatarColor = typeof comment.avatarColor === "string" ? comment.avatarColor : "#5e5ce6";

  const row = document.createElement("div");
  row.className = "comment-row";

  const avatar = document.createElement("span");
  avatar.className = "profile-avatar";
  avatar.style.background = avatarColor;
  avatar.textContent = avatarEmoji;

  const col = document.createElement("div");
  col.className = "comment-col";
  const meta = document.createElement("div");
  meta.className = "comment-meta";
  const nameSpan = document.createElement("span");
  nameSpan.className = "comment-name";
  nameSpan.textContent = username;
  const timeSpan = document.createElement("span");
  timeSpan.className = "comment-time";
  timeSpan.textContent = timestamp ? new Date(timestamp).toLocaleDateString() : "";
  meta.append(nameSpan, timeSpan);

  const body = document.createElement("div");
  body.className = "comment-text";
  body.dataset.rawText = text;
  body.textContent = isProfanityFilterOn() ? censorText(text) : text;

  col.append(meta, body);
  row.append(avatar, col);
  els.list.appendChild(row);
  els.list.scrollTop = els.list.scrollHeight;
}

export function mount(gameId){
  if (!gameId || typeof gameId !== "string") return;
  unmount();
  currentGameId = gameId;
  const e = ensureEls();
  e.list.innerHTML = "";
  renderAuthGate();
  unsubscribers.push(onIdentityChange(renderAuthGate));

  const itemsQuery = query(ref(database, `comments/${gameId}/items`), limitToLast(50));
  const offItems = onChildAdded(itemsQuery, snap => renderComment(snap.val() || {}));
  unsubscribers.push(offItems);

  const offLikeCount = onValue(ref(database, `comments/${gameId}/likeCount`), snap => {
    const n = typeof snap.val() === "number" ? snap.val() : 0;
    e.likeCount.textContent = String(n);
  });
  unsubscribers.push(offLikeCount);

  const myId = getIdentity().id;
  const offMyLike = onValue(ref(database, `comments/${gameId}/likes/${myId}`), snap => {
    const liked = snap.val() === true;
    e.likeIcon.textContent = liked ? "❤️" : "🤍";
    e.likeBtn.setAttribute("aria-pressed", String(liked));
  });
  unsubscribers.push(offMyLike);

  e.form.onsubmit = ev => {
    ev.preventDefault();
    const text = e.input.value.trim();
    if (!text || !currentGameId || !isLoggedIn()) return;
    if (containsBlockedName(text)){
      alert("That comment can't be posted.");
      return;
    }
    const identity = getIdentity();
    push(ref(database, `comments/${currentGameId}/items`), {
      identityId: identity.id,
      username: identity.username,
      avatarEmoji: identity.avatarEmoji,
      avatarColor: identity.avatarColor,
      text: text.slice(0, MAX_TEXT_LEN),
      timestamp: serverTimestamp()
    }).catch(() => {});
    recordComment();
    e.input.value = "";
  };

  e.likeBtn.onclick = () => {
    if (!currentGameId || !isLoggedIn()) return;
    const gid = currentGameId;
    // Capture the delta once, synchronously, before any async work starts —
    // a transaction's update function can be re-invoked on retry, and by
    // then aria-pressed may already reflect the OTHER transaction's result,
    // which would silently flip the sign of an in-flight retry.
    const delta = e.likeBtn.getAttribute("aria-pressed") === "true" ? -1 : 1;
    runTransaction(ref(database, `comments/${gid}/likes/${myId}`), liked => liked ? null : true).catch(() => {});
    runTransaction(ref(database, `comments/${gid}/likeCount`), n => (n || 0) + delta).catch(() => {});
  };
}

export function unmount(){
  unsubscribers.forEach(off => { try { off(); } catch {} });
  unsubscribers = [];
  currentGameId = null;
  if (els){
    els.list.innerHTML = "";
    els.form.onsubmit = null;
    els.likeBtn.onclick = null;
  }
}
