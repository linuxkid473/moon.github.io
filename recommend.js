/* Two small things at the very top of the page, both controlled from the admin console (admin.html, "Site" tab):
   1. "What game do you want to see next?": a slim, dismissible strip that opens into a small box (200 words at most). What people
      type is saved, readable only by the admin, to the site's own Firebase project (/recommendations), and shows up in the admin
      console. Dismiss it, or send something, and it stays away for a week. Only the text and the time are saved.
   2. An optional announcement bar (a short message the admin can switch on), dismissible, and it stays dismissed until the text changes. */
(() => {
  const MAX_WORDS = 200, MAX_CHARS = 1800, HIDE_DAYS = 7, COOLDOWN_MS = 60000;
  const KEY_HIDE = "mgRecHideUntil", KEY_LAST = "mgRecLast", KEY_ANN = "mgAnnSeen";
  const DB_URL = "https://moongames-eba7f-default-rtdb.asia-southeast1.firebasedatabase.app";
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode: it just comes back next visit */ } };
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
  const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
  const hash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return String(h); };
  const nav = document.querySelector(".nav");
  const place = (node) => { if (nav) nav.before(node); else document.body.prepend(node); };

  /* the admin's settings: { announcement: { text, enabled }, recsEnabled }. Unreachable or unset means the defaults. */
  async function siteSettings() {
    try {
      const c = new AbortController(); const timer = setTimeout(() => c.abort(), 3500);
      const r = await fetch(`${DB_URL}/site.json`, { signal: c.signal }); clearTimeout(timer);
      return r.ok ? (await r.json()) || {} : {};
    } catch { return {}; }
  }

  function announcement(a) {
    if (!a || !a.enabled || typeof a.text !== "string" || !a.text.trim()) return;
    const id = hash(a.text);
    if (get(KEY_ANN) === id) return;
    const bar = el(`<div class="rec rec-note" role="status"><div class="rec-bar"><span class="rec-msg"></span><button class="rec-x" type="button" aria-label="Dismiss">×</button></div></div>`);
    bar.querySelector(".rec-msg").textContent = a.text.trim().slice(0, 200);
    bar.querySelector(".rec-x").addEventListener("click", () => { set(KEY_ANN, id); bar.remove(); });
    place(bar);
  }

  function strip() {
    if (Number(get(KEY_HIDE)) > Date.now()) return;
    const box = el(`<div class="rec" role="region" aria-label="Game suggestions">
      <div class="rec-bar"><span class="rec-msg">💡 What game do you want to see next?</span>
        <button class="rec-open" type="button" aria-expanded="false" aria-controls="recForm">Tell us</button>
        <button class="rec-x" type="button" aria-label="Hide this for a week">×</button></div>
      <form class="rec-form" id="recForm" hidden autocomplete="off">
        <label class="rec-sr" for="recText">Which game do you want to see next?</label>
        <textarea id="recText" maxlength="${MAX_CHARS}" placeholder="Name a game, or describe what you'd like to play…"></textarea>
        <input class="rec-hp" type="text" name="website" tabindex="-1" aria-hidden="true" autocomplete="off">
        <div class="rec-row"><span class="rec-count" aria-live="polite">0 / ${MAX_WORDS} words</span><span class="rec-status" role="status"></span>
          <button class="rec-send" type="submit" disabled>Send</button></div></form></div>`);
    place(box);

    const $ = (s) => box.querySelector(s);
    const form = $(".rec-form"), text = $("#recText"), count = $(".rec-count"), status = $(".rec-status"), send = $(".rec-send"), open = $(".rec-open"), msg = $(".rec-msg");
    const hideForAWhile = () => { set(KEY_HIDE, String(Date.now() + HIDE_DAYS * 86400000)); box.remove(); };
    const toggle = (on) => { form.hidden = !on; open.setAttribute("aria-expanded", String(on)); if (on) text.focus(); };

    open.addEventListener("click", () => toggle(form.hidden));
    $(".rec-x").addEventListener("click", hideForAWhile);
    box.addEventListener("keydown", (e) => { if (e.key === "Escape" && !form.hidden) { toggle(false); open.focus(); } });

    const update = () => {
      const n = words(text.value);
      count.textContent = `${n} / ${MAX_WORDS} words`;
      count.classList.toggle("over", n > MAX_WORDS);
      send.disabled = n === 0 || n > MAX_WORDS;
      status.textContent = ""; status.classList.remove("err");
    };
    text.addEventListener("input", update);

    /** the real write (window.mgRecWrite can replace it, which is how the form is tested without touching the database) */
    async function save(value) {
      // loaded only now, so a hiccup here can never affect the rest of the page
      const [{ database }, { ref, push, set: fbSet, serverTimestamp }] = await Promise.all([
        import("./firebase-init.js"),
        import("https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js"),
      ]);
      await fbSet(push(ref(database, "recommendations")), { text: value, ts: serverTimestamp() });
    }

    const say = (t, err = false) => { status.textContent = t; status.classList.toggle("err", err); };
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = text.value.trim();
      const n = words(value);
      if (!n || n > MAX_WORDS) return;
      if (form.website && form.website.value) { hideForAWhile(); return; }   // (a bot filled the hidden field: pretend it worked)
      if (Date.now() - Number(get(KEY_LAST) || 0) < COOLDOWN_MS) { say("One moment, then you can send another.", true); return; }
      send.disabled = true; say("Sending…");
      try {
        await Promise.race([(window.mgRecWrite || save)(value), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 10000))]);
        set(KEY_LAST, String(Date.now()));
        msg.textContent = "💡 Thanks! Noted.";
        toggle(false); open.hidden = true;
        set(KEY_HIDE, String(Date.now() + HIDE_DAYS * 86400000));
        setTimeout(() => box.remove(), 3500);
      } catch {
        say("Couldn't send that right now. Please try again later.", true);
        send.disabled = false;
      }
    });
  }

  (async () => {
    const site = await siteSettings();
    announcement(site.announcement);
    if (site.recsEnabled !== false) strip();
  })();
})();
