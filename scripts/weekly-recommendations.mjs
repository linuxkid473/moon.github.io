// Weekly digest of "what game do you want to see next?" (see recommend.js).
// Reads the last 7 days of /recommendations from the site's Firebase project and emails a short summary plus the COMPLETE list.
//
//   FIREBASE_SERVICE_ACCOUNT  the service-account JSON (a GitHub secret)
//   SMTP_USER, SMTP_PASS      the sending account (a Gmail address and an app password; GitHub secrets)
//   MAIL_TO                   defaults to nathan.vihaan@gmail.com
//   SMTP_HOST / SMTP_PORT     default smtp.gmail.com / 465
//   DAYS                      how far back to look (default 7)
// To try it without Firebase or email:  INPUT_FILE=sample.json DRY_RUN=1 node scripts/weekly-recommendations.mjs
import fs from "node:fs";

const MAIL_TO = process.env.MAIL_TO || "nathan.vihaan@gmail.com";
const DAYS = Number(process.env.DAYS || 7);
const DRY = process.env.DRY_RUN === "1";
const DB_URL = process.env.FIREBASE_DATABASE_URL || "https://moongames-eba7f-default-rtdb.asia-southeast1.firebasedatabase.app";
const TZ = "Australia/Sydney";

async function load(since) {
  if (process.env.INPUT_FILE) {
    const raw = JSON.parse(fs.readFileSync(process.env.INPUT_FILE, "utf8"));
    return Object.values(raw).filter((r) => r && typeof r.text === "string" && r.ts >= since);
  }
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT is not set (see scripts/RECOMMENDATIONS.md).");
  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)), databaseURL: DB_URL });
  const snap = await admin.database().ref("recommendations").orderByChild("ts").startAt(since).once("value");
  const out = [];
  snap.forEach((c) => { const v = c.val(); if (v && typeof v.text === "string") out.push(v); });
  await admin.app().delete();
  return out;
}

const fmt = (ms, opts) => new Intl.DateTimeFormat("en-AU", { timeZone: TZ, ...opts }).format(new Date(ms));
const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();

export function buildEmail(recs, now = Date.now(), days = DAYS) {
  const since = now - days * 86400000;
  recs = [...recs].sort((a, b) => a.ts - b.ts);
  const groups = new Map();
  // the same request in different words ("Geometry Dash", "geometry dash!", "Geometry Dash please") counts as one: one text contains the other
  for (const r of recs) {
    const k = norm(r.text);
    if (!k) continue;
    const same = [...groups.keys()].find((o) => o === k || (Math.min(o.length, k.length) >= 4 && (o.includes(k) || k.includes(o))));
    const key = same ?? k, g = groups.get(key) || { n: 0, sample: r.text.trim() };
    g.n++;
    if (same && k.length < same.length) { groups.delete(same); groups.set(k, g); } else groups.set(key, g);
  }
  const repeated = [...groups.values()].filter((g) => g.n > 1).sort((a, b) => b.n - a.n).slice(0, 10);
  const lines = [];
  lines.push(`Moon Games: what people want to see next`);
  lines.push(`${fmt(since, { day: "numeric", month: "short" })} to ${fmt(now, { day: "numeric", month: "short", year: "numeric" })} (Sydney time)`);
  lines.push("");
  lines.push(`${recs.length} recommendation${recs.length === 1 ? "" : "s"} this week, ${groups.size} different.`);
  if (repeated.length) {
    lines.push("", "MOST REQUESTED (asked for more than once)");
    for (const g of repeated) lines.push(`  ${g.n}x  ${g.sample.length > 120 ? g.sample.slice(0, 117) + "..." : g.sample}`);
  }
  lines.push("", "COMPLETE LIST (oldest first)");
  if (!recs.length) lines.push("  Nobody sent a recommendation this week.");
  recs.forEach((r, i) => lines.push(`  ${i + 1}. [${fmt(r.ts, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}] ${r.text.trim().replace(/\s*\n\s*/g, " / ")}`));
  return { subject: `Moon Games: ${recs.length} game recommendation${recs.length === 1 ? "" : "s"} this week`, text: lines.join("\n") };
}

async function main() {
  const now = Date.now();
  const recs = await load(now - DAYS * 86400000);
  const mail = buildEmail(recs, now);
  if (DRY) { console.log(`To: ${MAIL_TO}\nSubject: ${mail.subject}\n\n${mail.text}`); return; }
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) throw new Error("SMTP_USER / SMTP_PASS are not set (see scripts/RECOMMENDATIONS.md).");
  const nodemailer = (await import("nodemailer")).default;
  const port = Number(process.env.SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST || "smtp.gmail.com", port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
  await transport.sendMail({ from: `Moon Games <${process.env.SMTP_USER}>`, to: MAIL_TO, subject: mail.subject, text: mail.text });
  console.log(`Sent ${recs.length} recommendation(s) to ${MAIL_TO}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message || e); process.exit(1); });
