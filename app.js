(() => {
  "use strict";

  /* theme, nav shadow, cloak, install, toast: see chrome.js (loaded first) */
  const filtersBar = document.querySelector(".filters-bar");
  window.addEventListener("scroll", () => {
    filtersBar?.classList.toggle("pinned", window.scrollY > 260);
  }, { passive: true });
  const toast = window.toast || (() => {});

  /* ---------------- State ---------------- */
  let ALL_GAMES = [];
  let activeGenre = "all";
  let query = "";

  const grid = document.getElementById("grid");
  const emptyState = document.getElementById("emptyState");
  const resultsMeta = document.getElementById("resultsMeta");
  const chipRow = document.getElementById("chipRow");
  const searchInput = document.getElementById("searchInput");
  const searchWrap = document.getElementById("searchWrap");
  const clearBtn = document.getElementById("clearSearch");
  const gameCountEl = document.getElementById("gameCount");
  const genreCountEl = document.getElementById("genreCount");

  const SVG_PLAY = `<svg viewBox="0 0 24 24" fill="white"><circle cx="12" cy="12" r="11" fill="rgba(255,255,255,0.18)"/><path d="M10 8.5l6 3.5-6 3.5v-7z" fill="white"/></svg>`;
  const SVG_EXTERNAL = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

  function cardTemplate(game){
    const genreLabel = game.genres[0] || "";
    const isExternal = /^https?:\/\//.test(game.href);
    return `
    <article class="card" tabindex="0" role="button"
      aria-label="Play ${escapeHtml(game.title)}${isExternal ? " (opens in a new tab)" : ""}"
      data-id="${game.id}" data-href="${game.href}" data-title="${escapeHtml(game.title)}">
      <div class="card-thumb skeleton">
        <img loading="lazy" src="${game.img}" alt="" onerror="this.closest('.card-thumb').classList.add('skeleton'); this.style.display='none';"
             onload="this.classList.add('loaded'); this.closest('.card-thumb').classList.remove('skeleton');">
        ${isExternal ? `<span class="card-external" title="Opens in a new tab">${SVG_EXTERNAL}</span>` : ""}
        <div class="card-play">${SVG_PLAY}</div>
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(game.title)}</div>
        <div class="card-genre">${escapeHtml(genreLabel)}</div>
      </div>
    </article>`;
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }

  function matches(game){
    if (activeGenre !== "all" && !game.genres.includes(activeGenre)) return false;
    if (query){
      const hay = (game.title + " " + game.genres.join(" ")).toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  function render(){
    const filtered = ALL_GAMES.filter(matches);
    grid.innerHTML = filtered.map(cardTemplate).join("");
    emptyState.classList.toggle("show", filtered.length === 0);
    resultsMeta.textContent = query || activeGenre !== "all"
      ? `${filtered.length} game${filtered.length === 1 ? "" : "s"}`
      : `${filtered.length} games available`;
  }

  function buildChips(genres){
    const counts = {};
    ALL_GAMES.forEach(g => g.genres.forEach(gr => counts[gr] = (counts[gr]||0)+1));
    const sorted = Object.keys(counts).sort((a,b) => counts[b]-counts[a]);
    const chips = [
      { id: "all", label: "All Games" },
      ...sorted.map(g => ({ id: g, label: g }))
    ];
    chipRow.innerHTML = chips.map(c =>
      `<button class="chip ${c.id === activeGenre ? "active" : ""}" role="tab" aria-selected="${c.id === activeGenre}" data-genre="${c.id}">${escapeHtml(c.label)}</button>`
    ).join("");
    genreCountEl.textContent = sorted.length;
  }

  chipRow?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    activeGenre = btn.dataset.genre;
    [...chipRow.children].forEach(c => {
      const isActive = c === btn;
      c.classList.toggle("active", isActive);
      c.setAttribute("aria-selected", String(isActive));
    });
    render();
  });

  searchInput?.addEventListener("input", () => {
    query = searchInput.value.trim().toLowerCase();
    searchWrap.classList.toggle("has-value", !!searchInput.value);
    render();
  });
  clearBtn?.addEventListener("click", () => {
    searchInput.value = "";
    query = "";
    searchWrap.classList.remove("has-value");
    searchInput.focus();
    render();
  });

  grid?.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (card) openPlayer(card.dataset.href, card.dataset.title);
  });
  grid?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card");
    if (!card) return;
    e.preventDefault();
    openPlayer(card.dataset.href, card.dataset.title);
  });

  /* ---------------- Player modal ---------------- */
  const overlay = document.getElementById("playerOverlay");
  const playerBody = document.getElementById("playerBody");
  const playerTitle = document.getElementById("playerTitle");
  const closeBtn = document.getElementById("closePlayer");
  const fullscreenBtn = document.getElementById("fullscreenPlayer");
  let currentIframe = null;
  let lastFocused = null;

  function trapFocus(e){
    if (e.key !== "Tab") return;
    // The iframe is excluded on purpose: once it holds focus, its (often
    // cross-origin) game content can't bubble Escape back to us to close.
    const focusable = [...overlay.querySelectorAll('button, [href], [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first){
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last){
      e.preventDefault();
      first.focus();
    }
  }

  function openPlayer(href, title){
    // A handful of games don't tolerate being nested two iframes deep
    // (our modal -> their wrapper -> the actual game) even though they
    // work fine standalone — those get an external href in games.json
    // and open in a new tab instead of the in-page player.
    if (/^https?:\/\//.test(href)){
      const ok = window.confirm(
        `${title || "This game"} opens in a new tab.\n\n` +
        "Heads up: that new tab shows the game's real title and icon, not the Compass disguise — close it when you're done."
      );
      if (ok) window.open(href, "_blank", "noopener");
      return;
    }
    playerTitle.textContent = title || "";
    playerBody.innerHTML = `<div class="player-loading"><div class="spinner"></div><span>Loading ${escapeHtml(title||"game")}…</span></div>`;
    const iframe = document.createElement("iframe");
    iframe.src = href;
    iframe.allow = "fullscreen; autoplay; gamepad; clipboard-write; cross-origin-isolated";
    iframe.allowFullscreen = true;
    iframe.addEventListener("load", () => {
      playerBody.querySelector(".player-loading")?.remove();
    });
    playerBody.appendChild(iframe);
    currentIframe = iframe;
    lastFocused = document.activeElement;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    closeBtn?.focus();
    overlay.addEventListener("keydown", trapFocus);
    history.replaceState(null, "", "#" + href.split("/").pop().replace(".html",""));
  }
  function closePlayer(){
    overlay.classList.remove("open");
    overlay.removeEventListener("keydown", trapFocus);
    document.body.style.overflow = "";
    setTimeout(() => { playerBody.innerHTML = ""; currentIframe = null; }, 300);
    history.replaceState(null, "", location.pathname);
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
  }
  closeBtn?.addEventListener("click", closePlayer);
  overlay?.addEventListener("click", (e) => { if (e.target === overlay) closePlayer(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closePlayer();
  });
  fullscreenBtn?.addEventListener("click", () => {
    const target = playerBody.querySelector("iframe") || playerBody;
    if (target.requestFullscreen) target.requestFullscreen();
  });

  /* ---------------- Random game ---------------- */
  document.getElementById("randomBtn")?.addEventListener("click", () => {
    if (!ALL_GAMES.length) return;
    const g = ALL_GAMES[Math.floor(Math.random() * ALL_GAMES.length)];
    openPlayer(g.href, g.title);
  });

  /* ---------------- Load data ---------------- */
  fetch("games.json")
    .then(r => r.json())
    .then(data => {
      ALL_GAMES = data;
      gameCountEl.textContent = ALL_GAMES.length;
      buildChips();
      render();
      const hash = location.hash.replace("#", "");
      if (hash){
        const g = ALL_GAMES.find(g => g.id === hash);
        if (g) openPlayer(g.href, g.title);
      }
    })
    .catch(() => {
      grid.innerHTML = `<p style="color:var(--text-secondary)">Couldn't load the game library. Try refreshing.</p>`;
    });
})();
