/* Profile popover: view/edit the local identity (username + avatar) and see
   your own stats. Injected off #profileBtn, present on every page. */
import {
  getIdentity, setUsername, setAvatar, onIdentityChange,
  getStats, onStatsChange, AVATAR_EMOJIS, AVATAR_COLORS
} from "./identity.js";
import { signUp, logIn, logOut } from "./auth.js";

const btn = document.getElementById("profileBtn");
if (btn){
  btn.innerHTML = `<span class="profile-avatar" id="profileAvatarPreview"></span>`;

  const popover = document.createElement("div");
  popover.className = "profile-popover";
  popover.id = "profilePopover";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Your profile");
  popover.innerHTML = `
    <div class="profile-head">
      <span class="profile-avatar lg" id="profileBigAvatar"></span>
      <input type="text" id="profileUsername" maxlength="20" aria-label="Your username" placeholder="Your name">
    </div>
    <div class="profile-section">
      <div class="profile-label">Avatar</div>
      <div class="profile-emoji-grid" id="profileEmojiGrid"></div>
      <div class="profile-color-row" id="profileColorRow"></div>
    </div>
    <div class="profile-section">
      <div class="profile-label">Account</div>
      <div id="profileAccountLoggedOut">
        <div class="profile-auth-row">
          <input type="text" id="profileAuthUsername" placeholder="Username" maxlength="20" autocomplete="username">
          <input type="password" id="profileAuthPassword" placeholder="Password" autocomplete="current-password">
        </div>
        <div class="profile-auth-actions">
          <button class="pill-btn primary" id="profileLoginBtn" type="button">Log in</button>
          <button class="pill-btn" id="profileSignupBtn" type="button">Sign up</button>
        </div>
        <p class="profile-auth-msg" id="profileAuthMsg" hidden></p>
        <p class="profile-auth-hint">Create an account to keep your name, avatar, and stats across devices &mdash; and to comment on games.</p>
      </div>
      <div id="profileAccountLoggedIn" hidden>
        <p class="profile-auth-msg logged-in">You're logged in.</p>
        <button class="pill-btn" id="profileLogoutBtn" type="button">Log out</button>
      </div>
    </div>
    <div class="profile-section">
      <div class="profile-label">Your stats</div>
      <div class="profile-stats" id="profileStats"></div>
    </div>
    <a class="pill-btn profile-achievements-link" href="leaderboards.html#achievements">View all achievements</a>
  `;
  document.body.appendChild(popover);

  const els = {
    btn, popover,
    avatarPreview: document.getElementById("profileAvatarPreview"),
    bigAvatar: document.getElementById("profileBigAvatar"),
    username: document.getElementById("profileUsername"),
    emojiGrid: document.getElementById("profileEmojiGrid"),
    colorRow: document.getElementById("profileColorRow"),
    stats: document.getElementById("profileStats"),
    loggedOutBox: document.getElementById("profileAccountLoggedOut"),
    loggedInBox: document.getElementById("profileAccountLoggedIn"),
    authUsername: document.getElementById("profileAuthUsername"),
    authPassword: document.getElementById("profileAuthPassword"),
    loginBtn: document.getElementById("profileLoginBtn"),
    signupBtn: document.getElementById("profileSignupBtn"),
    authMsg: document.getElementById("profileAuthMsg"),
    logoutBtn: document.getElementById("profileLogoutBtn"),
  };

  els.emojiGrid.innerHTML = AVATAR_EMOJIS.map(e =>
    `<button type="button" class="profile-emoji-btn" data-emoji="${e}" aria-label="Choose avatar ${e}">${e}</button>`
  ).join("");
  els.colorRow.innerHTML = AVATAR_COLORS.map(c =>
    `<button type="button" class="profile-color-btn" data-color="${c}" style="background:${c}" aria-label="Choose color ${c}"></button>`
  ).join("");

  function renderAvatar(identity){
    els.avatarPreview.textContent = identity.avatarEmoji;
    els.avatarPreview.style.background = identity.avatarColor;
    els.bigAvatar.textContent = identity.avatarEmoji;
    els.bigAvatar.style.background = identity.avatarColor;
    [...els.emojiGrid.children].forEach(b => b.classList.toggle("active", b.dataset.emoji === identity.avatarEmoji));
    [...els.colorRow.children].forEach(b => b.classList.toggle("active", b.dataset.color === identity.avatarColor));
  }
  function renderUsername(identity){
    if (document.activeElement !== els.username) els.username.value = identity.username;
  }
  function renderAuthState(identity){
    els.loggedOutBox.hidden = !!identity.loggedIn;
    els.loggedInBox.hidden = !identity.loggedIn;
  }
  function renderStats(stats){
    const rows = [
      ["Games played", stats.totalPlays],
      ["Distinct games", stats.distinctGamesPlayedCount],
      ["Day streak", stats.streak.current],
      ["Chat messages", stats.chatMessagesSent],
      ["Comments left", stats.commentsPosted],
      ["Tic-Tac-Toe record", `${stats.tictactoe.wins}-${stats.tictactoe.losses}-${stats.tictactoe.draws}`],
    ];
    els.stats.innerHTML = rows.map(([label, value]) =>
      `<div class="profile-stat-row"><span>${label}</span><strong>${value}</strong></div>`
    ).join("");
  }

  renderAvatar(getIdentity());
  renderUsername(getIdentity());
  renderAuthState(getIdentity());
  renderStats(getStats());
  onIdentityChange(identity => { renderAvatar(identity); renderUsername(identity); renderAuthState(identity); });
  onStatsChange(renderStats);

  function setAuthMsg(text, isError){
    els.authMsg.textContent = text;
    els.authMsg.hidden = !text;
    els.authMsg.classList.toggle("error", !!isError);
  }
  function setAuthBusy(busy){
    els.loginBtn.disabled = busy;
    els.signupBtn.disabled = busy;
  }
  async function handleAuth(action){
    const username = els.authUsername.value.trim();
    const password = els.authPassword.value;
    setAuthMsg("");
    setAuthBusy(true);
    try {
      await action(username, password);
      els.authPassword.value = "";
      setAuthMsg("");
    } catch (err) {
      setAuthMsg(err.message || "Something went wrong.", true);
    } finally {
      setAuthBusy(false);
    }
  }
  els.loginBtn.addEventListener("click", () => handleAuth(logIn));
  els.signupBtn.addEventListener("click", () => handleAuth(signUp));
  els.logoutBtn.addEventListener("click", () => logOut());

  els.username.addEventListener("change", () => setUsername(els.username.value));
  els.emojiGrid.addEventListener("click", e => {
    const b = e.target.closest(".profile-emoji-btn");
    if (b) setAvatar(b.dataset.emoji, getIdentity().avatarColor);
  });
  els.colorRow.addEventListener("click", e => {
    const b = e.target.closest(".profile-color-btn");
    if (b) setAvatar(getIdentity().avatarEmoji, b.dataset.color);
  });

  let isOpen = false;
  function position(){
    const r = btn.getBoundingClientRect();
    popover.style.top = (r.bottom + 8) + "px";
    popover.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  }
  function setOpen(open){
    isOpen = open;
    if (open) position();
    popover.classList.toggle("open", open);
    btn.setAttribute("aria-expanded", String(open));
  }
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", e => { e.stopPropagation(); setOpen(!isOpen); });
  document.addEventListener("click", e => {
    if (isOpen && !popover.contains(e.target) && e.target !== btn) setOpen(false);
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && isOpen) setOpen(false); });
  window.addEventListener("resize", () => { if (isOpen) position(); });
}
