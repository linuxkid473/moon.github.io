/* Optional real accounts on top of the local-identity system: username +
   password via Firebase Authentication's email/password provider. Firebase
   Auth wants an email, so a username is mapped to a synthetic, never-
   emailed address (username@moongames.app) — invisible to the user, who
   only ever sees "username" and "password". No 2FA, matches what was
   asked for.

   Passwords are handled entirely by Firebase Auth — never read, hashed,
   or stored by our own code or database (the RTDB `players` node is
   public-read, so it must never hold credentials). */
import { app } from "./firebase-init.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = getAuth(app);
const EMAIL_DOMAIN = "@moongames.app";
const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

function usernameToEmail(username){
  return username.trim().toLowerCase() + EMAIL_DOMAIN;
}

export function validateUsername(username){
  return USERNAME_RE.test((username || "").trim());
}
export function validatePassword(password){
  return typeof password === "string" && password.length >= 6;
}

function friendlyError(err){
  switch (err?.code){
    case "auth/email-already-in-use": return "That username is already taken.";
    case "auth/invalid-email": return "Usernames can only have letters, numbers, and underscores.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential": return "Incorrect username or password.";
    case "auth/too-many-requests": return "Too many attempts — try again in a bit.";
    default: return "Something went wrong — try again.";
  }
}

export async function signUp(username, password){
  if (!validateUsername(username)) throw new Error("Usernames must be 3-20 letters, numbers, or underscores.");
  if (!validatePassword(password)) throw new Error("Password must be at least 6 characters.");
  try {
    const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
    return cred.user;
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

export async function logIn(username, password){
  if (!username || !password) throw new Error("Enter a username and password.");
  try {
    const cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
    return cred.user;
  } catch (err) {
    throw new Error(friendlyError(err));
  }
}

export function logOut(){
  return signOut(auth);
}

export function getCurrentAuthUser(){
  return auth.currentUser;
}

export function onAuthChange(cb){
  return onAuthStateChanged(auth, cb);
}
