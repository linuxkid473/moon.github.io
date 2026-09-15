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
