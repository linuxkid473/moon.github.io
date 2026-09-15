/* Shared Firebase app/database for the site's OWN Firebase project (players,
   presence, stats, rooms, comments). This is a different project from the
   one chat.js uses — chat stays on the original third-party project. */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1dMhLTj6uJdMm13KTdJkjxIjVmgpRtKY",
  authDomain: "moongames-eba7f.firebaseapp.com",
  databaseURL: "https://moongames-eba7f-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "moongames-eba7f",
  storageBucket: "moongames-eba7f.firebasestorage.app",
  messagingSenderId: "969815822844",
  appId: "1:969815822844:web:a130bc740efdef3aada279"
};

// Named (not "[DEFAULT]") because chat.js initializes its own default app
// for the separate third-party chat project — two default-named apps would
// collide. Also guarded against double-evaluation of this module (some
// environments fetch/execute a given <script type=module> more than once
// per page load), which would otherwise throw "app/duplicate-app".
export const app = getApps().some(a => a.name === "moongames")
  ? getApp("moongames")
  : initializeApp(firebaseConfig, "moongames");
export const database = getDatabase(app);
