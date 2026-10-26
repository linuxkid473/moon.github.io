# The admin console

Open **admin.html** on the site (it is not linked for anyone else; when you are signed in as `ultrabsd` an "Admin" link appears in the nav).
Sign in with the normal site account `ultrabsd`, or with Google as `nathan.vihaan@gmail.com`. Anyone else who signs in sees "Not authorised".

| Tab | What it does |
| --- | --- |
| Overview | plays today / 7 days / all time, players, who is online now, plays per day, top games |
| Recommendations | what people want to see next: open / done / all, search, "asked for more than once", copy or export to CSV, delete |
| Comments | the latest comments on every game, with delete |
| Games | every game with its plays, sortable |
| Site | a site-wide announcement bar, and the switch for the "What game do you want to see next?" strip |

## One-time setup (the panel and the strip need the database rules)

1. Publish the rules. Firebase console > Realtime Database > Rules: paste in `database.rules.json` and Publish (or `firebase deploy --only database`).
   The rules are what really protect the recommendations and the site settings: only the admin can read or change them. Everyone else
   can only add a recommendation (text and time), not read, edit or delete.
2. The admin is either of:
   - the site account **ultrabsd** (`ultrabsd@moongames.app`). Make sure it exists (sign up with that username if it does not yet). Do this
     first: whoever signs up as `ultrabsd` is the admin, so nobody else can be allowed to take the name. Never delete it.
   - the Google account **nathan.vihaan@gmail.com**, with the "Sign in with Google" button. The rules only accept it once Google has verified the
     address, so nobody can pose as it. To switch it on: Firebase console > Authentication > Sign-in method > Google > Enable, and
     Authentication > Settings > Authorized domains > add the address the site is served from.
3. A Google sign-in is only for the admin page: the rest of the site treats it as signed out (it is not a player and its address is never shown).
   Signing in with Google in a browser signs out any site account in that same browser, and the other way round.

## Try the panel without signing in

On your own computer (`localhost` only): `admin.html?demo` shows the whole panel with made-up data and never touches Firebase.
