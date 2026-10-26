# "What game do you want to see next?"

A slim strip at the top of the site (`recommend.js`, `recommend.css`) lets visitors type what they want to play (200 words at most).
It is saved to the site's Firebase database under `/recommendations` (text and time only, nothing about the visitor) and nobody can read it
from a browser. Every Sunday a GitHub Action (`.github/workflows/weekly-recommendations.yml`) emails the week's summary and the complete list
to nathan.vihaan@gmail.com.

Three one-time steps make it work:

1. **Publish the database rules.** Firebase console > Realtime Database > Rules: paste in `database.rules.json` and Publish
   (or `firebase deploy --only database`). Until then the form says "Couldn't send that right now".
2. **Let the weekly job read the database.** Firebase console > Project settings > Service accounts > Generate new private key.
   In the GitHub repo: Settings > Secrets and variables > Actions > New repository secret, name `FIREBASE_SERVICE_ACCOUNT`, value = the whole JSON file.
3. **Let it send the email.** Create a Google App Password for the sending Gmail account (Google Account > Security > 2-Step Verification > App passwords).
   Add two repository secrets: `SMTP_USER` (the Gmail address) and `SMTP_PASS` (the app password).

Then try it: GitHub > Actions > "Weekly game recommendations email" > Run workflow.

Try the email text without Firebase or sending anything:
`INPUT_FILE=scripts/sample-recommendations.json DRY_RUN=1 node scripts/weekly-recommendations.mjs`
