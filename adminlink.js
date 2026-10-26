/* A small "Admin" link in the nav, shown only while signed in as the admin (the ultrabsd account, or the admin's verified Gmail). Nobody else ever sees it. */
import { onAnyAuthChange } from "./auth.js";

const isAdmin = (u) => { const e = (u?.email || "").toLowerCase(); return e === "ultrabsd@moongames.app" || (e === "nathan.vihaan@gmail.com" && u.emailVerified === true); };

onAnyAuthChange((user) => {
  const existing = document.getElementById("adminLink");
  if (!isAdmin(user)) { existing?.remove(); return; }
  if (existing) return;
  const actions = document.querySelector(".nav-actions");
  if (!actions) return;
  const a = document.createElement("a");
  a.id = "adminLink"; a.href = "admin.html"; a.textContent = "Admin"; a.className = "icon-btn";
  a.style.cssText = "width:auto;padding:0 12px;font-size:13px;font-weight:600;text-decoration:none;color:inherit";
  actions.prepend(a);
});
