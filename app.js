import { recordGamePlay } from "./identity.js";
import * as Comments from "./comments.js";
import { pickFeaturedGame, getFeaturedStats } from "./featured.js";

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
  const exclusivesSection = document.getElementById("exclusivesSection");
  const exclusivesGrid = document.getElementById("exclusivesGrid");
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
      data-id="${game.id}" data-href="${game.href}" data-title="${escapeHtml(game.title)}" data-standalone="${!!game.standalone}">
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

  function renderExclusives(){
    const exclusives = ALL_GAMES.filter(g => g.exclusive);
    if (!exclusives.length){
      exclusivesSection.hidden = true;
      return;
    }
    exclusivesGrid.innerHTML = exclusives.map(cardTemplate).join("");
    exclusivesSection.hidden = false;
  }

  async function renderFeatured(){
    const featuredSection = document.getElementById("featuredSection");
    const featuredCard = document.getElementById("featuredCard");
    if (!featuredSection || !featuredCard) return;
    const game = pickFeaturedGame(ALL_GAMES.filter(g => !g.standalone));
    if (!game){ featuredSection.hidden = true; return; }
    featuredCard.innerHTML = cardTemplate(game);
    featuredSection.hidden = false;
    featuredCard.addEventListener("click", handleCardClick);
    featuredCard.addEventListener("keydown", handleCardKeydown);
    const stats = await getFeaturedStats(game.id);
    const badge = document.createElement("div");
    badge.className = "featured-stats";
    badge.textContent = `🔥 ${stats.today} play${stats.today === 1 ? "" : "s"} today · ${stats.week} this week`;
    featuredCard.querySelector(".card-body")?.appendChild(badge);
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

  function handleCardClick(e){
    const card = e.target.closest(".card");
    if (!card) return;
    if (card.dataset.standalone === "true"){ location.href = card.dataset.href; return; }
    openPlayer(card.dataset.href, card.dataset.title, card.dataset.id);
  }
  function handleCardKeydown(e){
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".card");
    if (!card) return;
    e.preventDefault();
    if (card.dataset.standalone === "true"){ location.href = card.dataset.href; return; }
    openPlayer(card.dataset.href, card.dataset.title, card.dataset.id);
  }
  grid?.addEventListener("click", handleCardClick);
  grid?.addEventListener("keydown", handleCardKeydown);
  exclusivesGrid?.addEventListener("click", handleCardClick);
  exclusivesGrid?.addEventListener("keydown", handleCardKeydown);

  /* ---------------- Player modal ---------------- */
  const overlay = document.getElementById("playerOverlay");
  const playerBody = document.getElementById("playerBody");
  const playerTitle = document.getElementById("playerTitle");
  const closeBtn = document.getElementById("closePlayer");
  const fullscreenBtn = document.getElementById("fullscreenPlayer");
  const downloadBtn = document.getElementById("downloadPlayer");
  const commentsToggle = document.getElementById("commentsToggle");
  const playerComments = document.getElementById("playerComments");
  let currentIframe = null;
  let lastFocused = null;
  let currentHref = null;
  let currentTitle = null;

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

  function openPlayer(href, title, gameId){
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
    currentHref = href;
    currentTitle = title || "";
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
    history.replaceState(null, "", "#" + (gameId || href.split("/").pop().replace(".html","")));

    if (gameId){
      recordGamePlay(gameId);
      Comments.mount(gameId);
      if (commentsToggle) commentsToggle.hidden = false;
    } else if (commentsToggle){
      commentsToggle.hidden = true;
    }
  }
  function closePlayer(){
    overlay.classList.remove("open");
    overlay.removeEventListener("keydown", trapFocus);
    document.body.style.overflow = "";
    setTimeout(() => { playerBody.innerHTML = ""; currentIframe = null; }, 300);
    history.replaceState(null, "", location.pathname);
    if (lastFocused && document.contains(lastFocused)) lastFocused.focus();
    lastFocused = null;
    Comments.unmount();
    if (playerComments){ playerComments.hidden = true; }
    if (commentsToggle) commentsToggle.setAttribute("aria-pressed", "false");
  }
  commentsToggle?.addEventListener("click", () => {
    if (!playerComments) return;
    const open = playerComments.hidden;
    playerComments.hidden = !open;
    commentsToggle.setAttribute("aria-pressed", String(open));
  });
  closeBtn?.addEventListener("click", closePlayer);
  overlay?.addEventListener("click", (e) => { if (e.target === overlay) closePlayer(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("open")) closePlayer();
  });
  fullscreenBtn?.addEventListener("click", () => {
    const target = playerBody.querySelector("iframe") || playerBody;
    if (target.requestFullscreen) target.requestFullscreen();
  });
  downloadBtn?.addEventListener("click", async () => {
    if (!currentHref || downloadBtn.disabled) return;
    const slug = (currentTitle || "game").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "game";
    downloadBtn.disabled = true;
    const originalLabel = downloadBtn.getAttribute("aria-label");
    try {
      const absoluteHref = new URL(currentHref, location.href).href;
      const { blob, succeeded, failures } = await window.GameDownloader.buildZip(absoluteHref, {
        onProgress: (msg) => { downloadBtn.setAttribute("aria-label", msg); toast(msg); },
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(
        failures.length
          ? `Downloaded ${succeeded.length} file(s) — ${failures.length} blocked by the host, see MANIFEST.txt.`
          : `Downloaded ${succeeded.length} file(s) for offline play.`
      );
    } catch {
      toast("Couldn't download this game.");
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.setAttribute("aria-label", originalLabel || "Download game");
    }
  });

  /* ---------------- Random game ---------------- */
  document.getElementById("randomBtn")?.addEventListener("click", () => {
    if (!ALL_GAMES.length) return;
    const g = ALL_GAMES[Math.floor(Math.random() * ALL_GAMES.length)];
    if (g.standalone){ location.href = g.href; return; }
    openPlayer(g.href, g.title, g.id);
  });

  /* ---------------- Load data ---------------- */
  fetch("games.json")
    .then(r => r.json())
    .then(data => {
      ALL_GAMES = data;
      gameCountEl.textContent = ALL_GAMES.length;
      renderFeatured();
      renderExclusives();
      buildChips();
      render();
      const hash = location.hash.replace("#", "");
      if (hash){
        const g = ALL_GAMES.find(g => g.id === hash);
        if (g && !g.standalone) openPlayer(g.href, g.title, g.id);
      }
    })
    .catch(() => {
      grid.innerHTML = `<p style="color:var(--text-secondary)">Couldn't load the game library. Try refreshing.</p>`;
    });
})();
