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
import { getIdentity } from "./identity.js";
import {
  ref, push, update, get, onChildAdded, onValue, runTransaction,
  query, orderByChild, equalTo, limitToLast, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export function getConversationId(uidA, uidB){
  return [uidA, uidB].sort().join("_");
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
        avatarColor: v.avatarColor
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
  const existing = await get(ref(database, `dmMeta/${conversationId}`));
  if (!existing.exists()){
    const now = serverTimestamp();
    const updates = {};
    updates[`dmMeta/${conversationId}`] = {
      participants: { [me.id]: true, [otherUid]: true },
      createdAt: now,
      updatedAt: now
    };
    updates[`dmInbox/${me.id}/${conversationId}`] = {
      otherUid, otherUsername: otherProfile.username,
      otherAvatarEmoji: otherProfile.avatarEmoji, otherAvatarColor: otherProfile.avatarColor,
      unreadCount: 0, updatedAt: now
    };
    updates[`dmInbox/${otherUid}/${conversationId}`] = {
      otherUid: me.id, otherUsername: me.username,
      otherAvatarEmoji: me.avatarEmoji, otherAvatarColor: me.avatarColor,
      unreadCount: 0, updatedAt: now
    };
    await update(ref(database), updates);
  }
  return conversationId;
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

export function subscribeConversationMessages(conversationId, cb){
  const q = query(ref(database, `dmMessages/${conversationId}`), limitToLast(50));
  return onChildAdded(q, snap => cb(snap.val()));
}
