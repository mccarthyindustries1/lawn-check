# Lawn Check (web app): setup guide

You'll put the app on a free GitHub page, add it to your iPhone's Home Screen, and let a free daily job send you a notification. About 20 minutes. You never need Xcode for this.

**Important:** the GitHub repository must be **public** (free plan requirement). Anything you upload is visible to anyone. Nothing personal is in these files. Your ZIP code and alert address go only into a private "secret" in step 6.

## 1. Make a GitHub account and repository
1. Go to github.com and sign up (free).
2. Click **+** (top right) > **New repository**. Name it `lawn-check`, choose **Public**, click **Create repository**.

## 2. Upload the app files
1. Unzip `lawn-check-web.zip` on your Mac.
2. On the new repository page click **uploading an existing file**.
3. Select everything inside the unzipped folder (including the `icons` and `scripts` folders) and drag it into the browser. Wait until all files show.
4. Click **Commit changes**.

## 3. Add the daily job
1. In the repository click **Add file > Create new file**.
2. In the name box type exactly: `.github/workflows/daily-check.yml` (typing the slashes makes the folders).
3. Open `github-workflow-daily-check.yml` from the unzipped folder in TextEdit, copy everything, paste it into the big box.
4. Click **Commit changes** > **Commit changes**.

## 4. Turn on the website
1. Repository **Settings > Pages**.
2. Under **Branch** pick `main` and `/ (root)`, click **Save**.
3. After a minute or two the page shows your address: `https://YOURNAME.github.io/lawn-check/`.

## 5. Put it on your iPhone
1. In **Safari** on the iPhone open that address.
2. Tap **Share > Add to Home Screen**. If you see **Open as Web App**, leave it on. Tap **Add**.
3. Open **Lawn Check from the new Home Screen icon** (not Safari). Type your ZIP and tap **Check**.
4. In the **Daily alert** box tap **Turn on alerts** and tap **Allow**.
5. Tap **Copy setup code**.

## 6. Give GitHub the secrets
Repository **Settings > Secrets and variables > Actions > New repository secret**. Add:
- **ALERT_CONFIG**: paste the setup code from step 5.
- **VAPID_PRIVATE_KEY**: paste the single line from `VAPID_PRIVATE_KEY.txt` (sent to you separately). Keep it private.
- Optional **VAPID_SUBJECT**: `mailto:` followed by your email. Only add this if alerts fail with a "BadJwtToken" or similar error.

## 7. Test it
1. Repository **Actions** tab. If asked, click **I understand my workflows, enable them**.
2. Click **Daily lawn check > Run workflow > Run workflow**.
3. Within about a minute your iPhone should show the notification. A manual run always sends. If the run shows a red X, open it and read the message.

From then on it runs every morning around 7:15 AM Eastern (6:15 in winter) and sends the verdict.

## 8. Make the alert count your waterings
The **I watered** button works on its own, but the morning alert only knows about it if the app can save your log into your repository. You'll make a small access token for that, once.

1. On github.com click your profile photo (top right) > **Settings**.
2. At the bottom of the left list click **Developer settings** > **Personal access tokens** > **Fine-grained tokens** > **Generate new token**.
3. Name: `Lawn Check`. Expiration: the longest offered (about a year).
4. **Repository access:** choose **Only select repositories** and pick `lawn-check`.
5. Open **Repository permissions**, find **Contents**, and set it to **Read and write**. Leave everything else alone.
6. Click **Generate token** and copy it right away (GitHub shows it only once).
7. On your iPhone, open Lawn Check **from the Home Screen icon**, check your ZIP, scroll to **Daily alert**, and open **Make the alert count your waterings**.
8. The repository name is filled in (change it if wrong). Paste the token and tap **Save and sync**. It should say "Sync is on."

From now on, every time you tap **I watered**, the app saves it to a file called `log.json` in your repository, and the morning job reads that file before deciding what to send.

Good to know:
- The token lives only inside the app on your iPhone. Never paste it into a repository file or into a chat.
- `log.json` is public, like the rest of the repository. It holds only dates and inches watered, nothing else. Entries older than two weeks are dropped.
- Each save is a small update to the repository, which also keeps GitHub from pausing the daily job for inactivity. That is likely, but I couldn't confirm it from GitHub's documentation.
- When the token expires, the log still works on your phone but shows "not to GitHub". Make a new token (same steps) and paste it in.
- If you change the log from another device, the app picks up the shared copy the next time you check.

## Only get alerts when watering is needed
**Settings > Secrets and variables > Actions > Variables tab > New repository variable**: name `ALERT_MODE`, value `needed`. Remove it to go back to a daily message.

## If something goes wrong
- **Page says "NOAA rain data unavailable..."**: it fell back to a model estimate. Copy the text and send it to Claude.
- **No notification**: it must be added to the Home Screen and opened from there; check Settings > Notifications > Lawn Check.
- **Alerts stop after weeks**: GitHub pauses scheduled jobs in repositories with no activity for 60 days. Open the Actions tab and re-enable the workflow. Also, if you re-add the app to the Home Screen or change ZIP, repeat step 5 and replace the ALERT_CONFIG secret ("alert address has expired" in the run log means the same).
- **Alert ignores a watering**: open the app and look for "Saved to your daily alert too" under the log after tapping I watered. If it says "not to GitHub", sync needs attention (step 8). The alert reads the log when the job runs, so a watering logged after about 7 AM counts the next day.
- **Changing ZIP**: change it in the app, then copy a fresh setup code into ALERT_CONFIG.

Forecast data: Open-Meteo.com (free for personal use, CC BY 4.0). Past rain: NOAA.
