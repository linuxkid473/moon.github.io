/* Shared site chrome: theme, nav shadow, toast, cloak, PWA install.
   Loaded on every page; app.js (index only) builds on top of it. */
(() => {
  "use strict";

  const root = document.documentElement;
  const THEME_KEY = "moongames.theme";

  function applyTheme(t){
    if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
    else root.removeAttribute("data-theme");
  }
  applyTheme(localStorage.getItem(THEME_KEY));

  function currentEffectiveTheme(){
    const stored = localStorage.getItem(THEME_KEY);
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.getElementById("themeToggle")?.addEventListener("click", () => {
    const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });

  /* Tab disguise: Compass <-> Dashboard, matches window.applyBrandMode() in <head> */
  document.getElementById("brandModeToggle")?.addEventListener("click", () => {
    const next = (localStorage.getItem("brandMode") || "normal") === "alt" ? "normal" : "alt";
    localStorage.setItem("brandMode", next);
    if (typeof window.applyBrandMode === "function") window.applyBrandMode();
    window.toast?.(next === "alt" ? "Tab disguised as Dashboard" : "Tab disguised as Compass");
  });

  const nav = document.querySelector(".nav");
  window.addEventListener("scroll", () => {
    nav?.classList.toggle("scrolled", window.scrollY > 4);
  }, { passive: true });

  const toastEl = document.getElementById("toast");
  let toastTimer = null;
  window.toast = function toast(msg){
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2200);
  };

  document.getElementById("cloakBtn")?.addEventListener("click", () => {
    const w = window.open("about:blank", "_blank", "width=1000,height=700");
    if (!w){ window.toast("Allow pop-ups to use Cloak Site"); return; }
    w.document.write(`
      <!doctype html><html><head><title>New Tab</title>
      <link rel="icon" href="data:,">
      </head><body style="margin:0"><iframe src="${location.href}" style="border:0;width:100vw;height:100vh"></iframe></body></html>
    `);
    window.toast("Opened in disguised window");
  });

  let deferredPrompt = null;
  const installBtn = document.getElementById("installBtn");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  });
  window.addEventListener("appinstalled", () => { if (installBtn) installBtn.hidden = true; });

  if ("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
})();
