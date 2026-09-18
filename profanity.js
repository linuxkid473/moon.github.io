/* Shared profanity filter — extracted from chat.js so comments.js can reuse
   the same word list and the same opt-in localStorage preference. */
const PROFANITY_STORAGE_KEY = "chatProfanityFilter"; // "on" | "off"
const PROFANITY_WORDS = [
  "fuck","shit","bitch","asshole","bastard","cunt","dick","piss","pussy",
  "slut","whore","fag","faggot","nigger","nigga","retard","cock","twat",
  "damn","crap"
];
const PROFANITY_RE = new RegExp("\\b(?:" + PROFANITY_WORDS.join("|") + ")\\w*", "gi");

export function censorText(text){
  return text.replace(PROFANITY_RE, (match) => match[0] + "*".repeat(Math.max(match.length - 1, 1)));
}
export function isProfanityFilterOn(){
  return localStorage.getItem(PROFANITY_STORAGE_KEY) === "on";
}
export function setProfanityFilterPref(on){
  localStorage.setItem(PROFANITY_STORAGE_KEY, on ? "on" : "off");
}
export function hasStoredProfanityPref(){
  return localStorage.getItem(PROFANITY_STORAGE_KEY) !== null;
}

/* Hard block (not just censor) on specific names — always on, not gated by
   the opt-in profanity filter pref. Normalizes leetspeak substitutions,
   strips non-letters (so spacing/punctuation can't dodge it), and collapses
   repeated letters (so "viihaaan" still matches "vihaan") before matching. */
const BLOCKED_NAMES_RAW = ["vihaan", "tony", "aaryan"];
const LEET_MAP = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function normalizeForBlocklist(text){
  let s = String(text || "").toLowerCase();
  s = s.replace(/[013457@$!]/g, ch => LEET_MAP[ch] || ch);
  s = s.replace(/[^a-z]/g, "");
  s = s.replace(/(.)\1+/g, "$1");
  return s;
}
const BLOCKED_NAMES = BLOCKED_NAMES_RAW.map(normalizeForBlocklist);

export function containsBlockedName(text){
  const normalized = normalizeForBlocklist(text);
  return BLOCKED_NAMES.some(name => normalized.includes(name));
}
