/* Angus Taylah promo: a slim bar, a compact card, a small sticker and a footer link. Quiet on purpose. Every one opens the game through its normal card. */
(() => {
  const ID = "angustaylor";
  const PHOTO = "resources/angustaylor-photo.jpg";
  const HIDE_KEY = "apHideBar";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: it just comes back next visit */ } };
  const play = () => {
    const card = document.querySelector(`.card[data-id="${ID}"]`);
    if (card) card.click(); else location.href = "iframes/angustaylor.html";
  };
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
  const onKey = (node) => node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });

  // 1. a slim bar at the top. Dismiss it once and it stays gone.
  if (get(HIDE_KEY) !== "1") {
    const top = el(`<div class="ap-top" role="button" tabindex="0" aria-label="Play Angus Taylah: Fighting Taxes">
      <span class="ap-msg"><b>New:</b> Angus Taylah: Fighting Taxes</span><span class="ap-cta">Play ▶</span>
      <button class="ap-x" aria-label="Hide this bar">×</button></div>`);
    document.body.prepend(top);
    document.documentElement.style.setProperty("--ap-offset", top.offsetHeight + "px");
    top.addEventListener("click", (e) => {
      if (e.target.closest(".ap-x")) { e.stopPropagation(); top.remove(); set(HIDE_KEY, "1"); document.documentElement.style.setProperty("--ap-offset", "0px"); return; }
      play();
    });
    onKey(top);
  }

  // 2. a compact card under the page hero
  const hero = el(`<section class="ap-hero" role="button" tabindex="0" aria-label="Play Angus Taylah: Fighting Taxes">
    <img src="${PHOTO}" alt="" />
    <div class="ap-txt"><b>Angus Taylah: Fighting Taxes</b><span>New 3D edition. Free, no download.</span></div>
    <button class="ap-play" type="button">Play</button></section>`);
  const heroSec = document.querySelector("main .hero");
  if (heroSec) heroSec.after(hero); else document.querySelector("main")?.prepend(hero);
  hero.addEventListener("click", play);
  onKey(hero);

  // 3. a small round sticker in the corner
  const flt = el(`<button class="ap-float" type="button" title="Play Angus Taylah" aria-label="Play Angus Taylah: Fighting Taxes"><img src="${PHOTO}" alt="" /></button>`);
  document.body.append(flt);
  flt.addEventListener("click", play);

  // 4. footer link
  const fc = document.querySelector(".footer-col:nth-child(2)");
  if (fc) { const a = el(`<a class="ap-foot" href="iframes/angustaylor.html">Play Angus Taylah</a>`); fc.append(a); }
})();
