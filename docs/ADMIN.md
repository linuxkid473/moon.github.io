# The admin console

Open **admin.html** on the site (it is not linked for anyone else; when you are signed in as `ultrabsd` an "Admin" link appears in the nav).
Sign in with the normal site account `ultrabsd`. Anyone else who signs in sees "Not authorised".

| Tab | What it does |
| --- | --- |
| Overview | plays today / 7 days / all time, players, who is online now, plays per day, top games |
| Recommendations | what people want to see next: open / done / all, search, "asked for more than once", copy or export to CSV, delete |
| Comments | the latest comments on every game, with delete |
| Games | every game with its plays, sortable |
| Site | a site-wide announcement bar, and the switch for the "What game do you want to see next?" strip |

## One-time setup (the panel and the strip need the database rules)

1. Make sure the account **ultrabsd** exists on the site (sign up with that username if it does not yet). Do this first: whoever signs up
   as `ultrabsd` is the admin, so nobody else can be allowed to take the name.
2. Firebase console > Realtime Database > Rules: paste in `database.rules.json` and Publish (or `firebase deploy --only database`).
   The rules are what really protect the recommendations and the site settings: only the `ultrabsd@moongames.app` account can read or
   change them. Everyone else can only add a recommendation (text and time), not read, edit or delete.

If you ever delete the `ultrabsd` account, someone else could register the name and become the admin. Don't delete it.

## Try the panel without signing in

On your own computer (`localhost` only): `admin.html?demo` shows the whole panel with made-up data and never touches Firebase.
