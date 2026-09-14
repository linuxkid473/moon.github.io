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

  function cardTemplate(game){
    const genreLabel = game.genres[0] || "";
    return `
    <article class="card" tabindex="0" role="button"
      aria-label="Play ${escapeHtml(game.title)}"
      data-id="${game.id}" data-href="${game.href}" data-title="${escapeHtml(game.title)}">
      <div class="card-thumb skeleton">
        <img loading="lazy" src="${game.img}" alt="" onerror="this.closest('.card-thumb').classList.add('skeleton'); this.style.display='none';"
             onload="this.classList.add('loaded'); this.closest('.card-thumb').classList.remove('skeleton');">
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
      `<button class="chip ${c.id === activeGenre ? "active" : ""}" data-genre="${c.id}">${escapeHtml(c.label)}</button>`
    ).join("");
    genreCountEl.textContent = sorted.length;
  }

  chipRow?.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    activeGenre = btn.dataset.genre;
    [...chipRow.children].forEach(c => c.classList.toggle("active", c === btn));
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

  function openPlayer(href, title){
    playerTitle.textContent = title || "";
    playerBody.innerHTML = `<div class="player-loading"><div class="spinner"></div><span>Loading ${escapeHtml(title||"game")}…</span></div>`;
    const iframe = document.createElement("iframe");
    iframe.src = href;
    iframe.allow = "fullscreen; autoplay; gamepad; clipboard-write";
    iframe.allowFullscreen = true;
    iframe.addEventListener("load", () => {
      playerBody.querySelector(".player-loading")?.remove();
    });
    playerBody.appendChild(iframe);
    currentIframe = iframe;
    overlay.classList.add("open");
    document.body.style.overflow = "hidden";
    history.replaceState(null, "", "#" + href.split("/").pop().replace(".html",""));
  }
  function closePlayer(){
    overlay.classList.remove("open");
    document.body.style.overflow = "";
    setTimeout(() => { playerBody.innerHTML = ""; currentIframe = null; }, 300);
    history.replaceState(null, "", location.pathname);
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
