/* Live presence: "who's online" backed by Firebase RTDB onDisconnect().
   Imported by chat.js only — it's the one place presence surfaces in the UI. */
import { database } from "./firebase-init.js";
import { getIdentity, onIdentityChange, isValidPhotoURL } from "./identity.js";
import {
  ref, set, update, remove, onValue, onDisconnect, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const STALE_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 60 * 1000;

let started = false;
let cachedUsers = [];
const listeners = new Set();

function myPresenceRef(){
  return ref(database, "presence/" + getIdentity().id);
}
function presenceSnapshot(){
  const identity = getIdentity();
  return {
    username: identity.username,
    avatarEmoji: identity.avatarEmoji,
    avatarColor: identity.avatarColor,
    photoURL: isValidPhotoURL(identity.photoURL) ? identity.photoURL : null,
    lastSeen: serverTimestamp()
  };
}

export function startPresence(){
  if (started) return;
  started = true;

  const connectedRef = ref(database, ".info/connected");
  onValue(connectedRef, snap => {
    if (snap.val() !== true) return;
    const myRef = myPresenceRef();
    onDisconnect(myRef).remove();
    set(myRef, presenceSnapshot()).catch(() => {});
  });

  setInterval(() => {
    update(myPresenceRef(), { lastSeen: serverTimestamp() }).catch(() => {});
  }, HEARTBEAT_MS);

  onIdentityChange(() => {
    update(myPresenceRef(), presenceSnapshot()).catch(() => {});
  });

  window.addEventListener("beforeunload", () => {
    remove(myPresenceRef()).catch(() => {});
  });

  onValue(ref(database, "presence"), snap => {
    const val = snap.val();
    const now = Date.now();
    const users = [];
    if (val && typeof val === "object"){
      for (const [id, entry] of Object.entries(val)){
        if (!entry || typeof entry !== "object") continue;
        const lastSeen = typeof entry.lastSeen === "number" ? entry.lastSeen : 0;
        if (now - lastSeen > STALE_MS) continue;
        users.push({
          id,
          username: typeof entry.username === "string" ? entry.username.slice(0, 40) : "Anonymous",
          avatarEmoji: typeof entry.avatarEmoji === "string" ? entry.avatarEmoji : "🙂",
          avatarColor: typeof entry.avatarColor === "string" ? entry.avatarColor : "#5e5ce6",
          photoURL: isValidPhotoURL(entry.photoURL) ? entry.photoURL : null
        });
      }
    }
    cachedUsers = users;
    listeners.forEach(cb => { try { cb(users); } catch {} });
  });
}

export function subscribeOnlineUsers(cb){
  listeners.add(cb);
  cb(cachedUsers);
  return () => listeners.delete(cb);
}

export function getOnlineCount(){
  return cachedUsers.length;
}
