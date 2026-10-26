/* A small "Admin" link in the nav, shown only while signed in as the admin account (ultrabsd). Nobody else ever sees it. */
import { onAuthChange } from "./auth.js";

onAuthChange((user) => {
  const existing = document.getElementById("adminLink");
  if (!user || (user.email || "").toLowerCase() !== "ultrabsd@moongames.app") { existing?.remove(); return; }
  if (existing) return;
  const actions = document.querySelector(".nav-actions");
  if (!actions) return;
  const a = document.createElement("a");
  a.id = "adminLink"; a.href = "admin.html"; a.textContent = "Admin"; a.className = "icon-btn";
  a.style.cssText = "width:auto;padding:0 12px;font-size:13px;font-weight:600;text-decoration:none;color:inherit";
  actions.prepend(a);
});
