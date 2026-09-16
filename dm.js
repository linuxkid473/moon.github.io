/* Private direct messages — built on the site's OWN Firebase project
   (moongames-eba7f, via firebase-init.js) rather than the community chat's
   separate chatroom-128ee project, because DMs need to be secured against a
   real Firebase Auth uid and only moongames-eba7f has Auth wired up. Only
   logged-in accounts (identity.loggedIn / isLoggedIn()) can open or send
   DMs — chat.js is responsible for gating the UI; this module assumes it's
   only called for a logged-in identity.

   Data-only module (no DOM), mirroring presence.js's separation of concerns:
   chat.js owns all rendering and calls these functions. */
import { database } from "./firebase-init.js";
import { getIdentity, isValidPhotoURL } from "./identity.js";
import {
  ref, push, update, get, set, remove, onDisconnect, onChildAdded, onChildRemoved, onValue, runTransaction,
  query, orderByChild, orderByKey, equalTo, endBefore, startAfter, limitToLast, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const PAGE_SIZE = 20;

// A typing write is only trusted for up to this long — if onDisconnect
// didn't fire in time (crash, network drop) a stale entry still clears
// itself client-side once every reader's clock passes this window.
const TYPING_TTL_MS = 6000;

export function getConversationId(uidA, uidB){
  return [uidA, uidB].sort().join("_");
}

export async function getAccountProfile(uid){
  if (!uid) return null;
  const snap = await get(ref(database, `players/${uid}`));
  const v = snap.val();
  if (!v || v.hasAccount !== true) return null;
  return {
    uid,
    username: typeof v.username === "string" ? v.username : "Unknown",
    avatarEmoji: v.avatarEmoji,
    avatarColor: v.avatarColor,
    photoURL: isValidPhotoURL(v.photoURL) ? v.photoURL : null
  };
}

export async function searchAccountByUsername(username){
  const trimmed = String(username || "").trim();
  if (!trimmed) return [];
  const myId = getIdentity().id;
  const q = query(ref(database, "players"), orderByChild("username"), equalTo(trimmed));
  const snap = await get(q);
  const results = [];
  snap.forEach(child => {
    const v = child.val();
    if (v && v.hasAccount === true && child.key !== myId){
      results.push({
        uid: child.key,
        username: typeof v.username === "string" ? v.username : "Unknown",
        avatarEmoji: v.avatarEmoji,
        avatarColor: v.avatarColor,
        photoURL: isValidPhotoURL(v.photoURL) ? v.photoURL : null
      });
    }
  });
  return results;
}

export async function openConversationWith(otherUid, otherProfile){
  const me = getIdentity();
  if (!me.loggedIn || !otherUid || otherUid === me.id){
    throw new Error("Can't start that conversation.");
  }
  const conversationId = getConversationId(me.id, otherUid);
  // Checked independently (not just dmMeta) so re-opening a conversation
  // whose dmMeta/other-side survived but whose OWN inbox entry was removed
  // (see removeConversation) correctly recreates just the missing piece,
  // instead of silently doing nothing because dmMeta already existed.
  const [metaSnap, myInboxSnap] = await Promise.all([
    get(ref(database, `dmMeta/${conversationId}`)),
    get(ref(database, `dmInbox/${me.id}/${conversationId}`))
  ]);
  const now = serverTimestamp();
  const updates = {};
  if (!metaSnap.exists()){
    updates[`dmMeta/${conversationId}`] = {
      participants: { [me.id]: true, [otherUid]: true },
      createdAt: now,
      updatedAt: now
    };
  }
  if (!myInboxSnap.exists()){
    updates[`dmInbox/${me.id}/${conversationId}`] = {
      otherUid, otherUsername: otherProfile.username,
      otherAvatarEmoji: otherProfile.avatarEmoji, otherAvatarColor: otherProfile.avatarColor,
      unreadCount: 0, updatedAt: now
    };
  }
  if (Object.keys(updates).length) await update(ref(database), updates);
  return conversationId;
}

// "Delete" a conversation from just your own inbox — the other person keeps
// theirs, and dmMessages/dmMeta are untouched, so messaging them again later
// (openConversationWith) picks the same history back up.
export function removeConversation(conversationId){
  const me = getIdentity();
  if (!me.loggedIn) return Promise.resolve();
  return remove(ref(database, `dmInbox/${me.id}/${conversationId}`)).catch(() => {});
}

export async function sendDirectMessage(conversationId, otherUid, payload){
  const me = getIdentity();
  if (!me.loggedIn) throw new Error("Sign in required.");
  const newRef = push(ref(database, `dmMessages/${conversationId}`));
  const now = serverTimestamp();
  const message = { senderId: me.id, timestamp: now, ...payload };
  const preview = { senderId: me.id, timestamp: now, ...payload };
  const updates = {};
  updates[`dmMessages/${conversationId}/${newRef.key}`] = message;
  updates[`dmMeta/${conversationId}/lastMessage`] = preview;
  updates[`dmMeta/${conversationId}/updatedAt`] = now;
  updates[`dmInbox/${me.id}/${conversationId}/lastMessage`] = preview;
  updates[`dmInbox/${me.id}/${conversationId}/updatedAt`] = now;
  updates[`dmInbox/${me.id}/${conversationId}/unreadCount`] = 0;
  updates[`dmInbox/${otherUid}/${conversationId}/lastMessage`] = preview;
  updates[`dmInbox/${otherUid}/${conversationId}/updatedAt`] = now;
  await update(ref(database), updates);
  // Fan-out increment for the recipient's unread badge — a separate
  // transaction because update() can only set values, not increment them.
  await runTransaction(ref(database, `dmInbox/${otherUid}/${conversationId}/unreadCount`),
    n => (typeof n === "number" ? n : 0) + 1);
}

export function markConversationRead(conversationId){
  const me = getIdentity();
  if (!me.loggedIn) return Promise.resolve();
  return update(ref(database, `dmInbox/${me.id}/${conversationId}`), { unreadCount: 0 }).catch(() => {});
}

export function subscribeInbox(cb){
  const me = getIdentity();
  if (!me.loggedIn){ cb([]); return () => {}; }
  const inboxRef = ref(database, `dmInbox/${me.id}`);
  return onValue(inboxRef, snap => {
    const list = [];
    snap.forEach(child => { list.push({ conversationId: child.key, ...child.val() }); });
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    cb(list);
  });
}

// Pagination: fetch the most recent page once (not a live listener), then
// separately attach a live "tail" (subscribeNewMessages) for anything from
// here forward — mixing a live limitToLast() listener with manual "load
// older" would fight itself, since limitToLast() emits onChildRemoved for
// whatever falls out of its window as new messages arrive.
export async function fetchRecentMessages(conversationId, limit = PAGE_SIZE){
  const q = query(ref(database, `dmMessages/${conversationId}`), limitToLast(limit));
  const snap = await get(q);
  const messages = [];
  snap.forEach(child => { messages.push({ key: child.key, ...child.val() }); });
  return messages; // oldest -> newest
}

// One older page, ending right before `beforeKey` (exclusive).
export async function fetchOlderMessages(conversationId, beforeKey, limit = PAGE_SIZE){
  if (!beforeKey) return [];
  const q = query(ref(database, `dmMessages/${conversationId}`), orderByKey(), endBefore(beforeKey), limitToLast(limit));
  const snap = await get(q);
  const messages = [];
  snap.forEach(child => { messages.push({ key: child.key, ...child.val() }); });
  return messages; // oldest -> newest
}

// Live tail: fires for every message added after `afterKey` (the newest key
// already rendered) — unbounded, so unlike limitToLast() it never fires
// onChildRemoved just because the window slid.
export function subscribeNewMessages(conversationId, afterKey, cb){
  const base = ref(database, `dmMessages/${conversationId}`);
  const q = afterKey ? query(base, orderByKey(), startAfter(afterKey)) : query(base, orderByKey());
  return onChildAdded(q, snap => cb({ key: snap.key, ...snap.val() }));
}

export function subscribeRemovedMessages(conversationId, cb){
  return onChildRemoved(ref(database, `dmMessages/${conversationId}`), snap => cb(snap.key));
}

export function deleteDirectMessage(conversationId, messageId){
  const me = getIdentity();
  if (!me.loggedIn) return Promise.reject(new Error("Sign in required."));
  // Not caught here — the caller (chat.js) only removes the bubble from
  // the DOM once this actually resolves, so a rejected delete (denied by
  // rules, network drop) doesn't make a message look gone when it isn't.
  return remove(ref(database, `dmMessages/${conversationId}/${messageId}`));
}

export function setTyping(conversationId, isTyping){
  const me = getIdentity();
  if (!me.loggedIn) return Promise.resolve();
  const typingRef = ref(database, `dmTyping/${conversationId}/${me.id}`);
  if (isTyping){
    onDisconnect(typingRef).remove();
    return set(typingRef, serverTimestamp()).catch(() => {});
  }
  onDisconnect(typingRef).cancel();
  return remove(typingRef).catch(() => {});
}

// cb(isOtherPersonTyping: boolean) — only the other participant's entry is
// considered, own writes never echo back as "someone is typing".
export function subscribeTyping(conversationId, cb){
  const me = getIdentity();
  const typingRef = ref(database, `dmTyping/${conversationId}`);
  return onValue(typingRef, snap => {
    const now = Date.now();
    let othersTyping = false;
    snap.forEach(child => {
      if (child.key === me.id) return;
      const ts = child.val();
      if (typeof ts === "number" && now - ts < TYPING_TTL_MS) othersTyping = true;
    });
    cb(othersTyping);
  });
}
