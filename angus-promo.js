/* Angus Taylah promo: top banner, hero ad, floating sticker, footer plug. Every ad opens the game through its normal card. */
(() => {
  const ID = "angustaylor";
  const PHOTO = "resources/angustaylor-photo.jpg";
  const play = () => {
    const card = document.querySelector(`.card[data-id="${ID}"]`);
    if (card) card.click(); else location.href = "iframes/angustaylor.html";
  };
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
  const TAGS = ["🔥 NEW: Angus Taylah: Fighting Taxes is HERE", "🌧️ Now in 3D, in the rain", "💸 Dodge the taxes. Dodge the bosses.", "🏃 Play free. No download.", "👑 Only on Moon Games"];

  // 1. sticky top banner
  const top = el(`<div class="ap-top" role="button" tabindex="0" aria-label="Play Angus Taylah: Fighting Taxes">
    <div class="ap-track"><span class="ap-run">${TAGS.join(" &nbsp;&nbsp;•&nbsp;&nbsp; ")}</span></div>
    <span class="ap-cta">PLAY NOW ▶</span><button class="ap-x" aria-label="Hide banner">×</button></div>`);
  document.body.prepend(top);
  document.documentElement.style.setProperty("--ap-offset", top.offsetHeight + "px");
  top.addEventListener("click", (e) => {
    if (e.target.closest(".ap-x")) { e.stopPropagation(); top.remove(); document.documentElement.style.setProperty("--ap-offset", "0px"); return; }
    play();
  });
  top.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });

  // 2. big hero ad, right under the page hero
  const hero = el(`<section class="ap-hero" role="button" tabindex="0" aria-label="Play Angus Taylah: Fighting Taxes">
    <div class="ap-rain" aria-hidden="true"></div>
    <img src="${PHOTO}" alt="" />
    <div><span class="ap-badge">★ NEW 3D EDITION ★</span>
      <h2>Angus Taylah<small>Fighting Taxes</small></h2>
      <p>The runner everyone is talking about. Sprint through a rain-soaked rally, grab TAX CUTS, jump the red tape and outrun the bosses.</p>
      <button class="ap-play" type="button">▶ Play free now</button>
      <div class="ap-chips"><span>🌧️ Rain on the glass</span><span>⚡ Power-ups</span><span>🏆 Beat your best</span><span>📱 Works on phones</span></div></div></section>`);
  const heroSec = document.querySelector("main .hero");
  if (heroSec) heroSec.after(hero); else document.querySelector("main")?.prepend(hero);
  hero.addEventListener("click", play);
  hero.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); play(); } });

  // 3. floating sticker
  const flt = el(`<button class="ap-float" type="button" aria-label="Play Angus Taylah: Fighting Taxes"><img src="${PHOTO}" alt="" /><span><small>NEW GAME</small>Play Angus Taylah ▶</span></button>`);
  document.body.append(flt);
  flt.addEventListener("click", play);

  // 4. footer plug
  const fc = document.querySelector(".footer-col:nth-child(2)");
  if (fc) { const a = el(`<a class="ap-foot" href="iframes/angustaylor.html">🔥 Play Angus Taylah</a>`); fc.append(a); }
})();
