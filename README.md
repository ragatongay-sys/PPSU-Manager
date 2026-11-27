# PPSU Game Management – online hosting (GitHub + Netlify)

Anyone with the link can open the app on any device. The administrator publishes
from the app and viewers see the update automatically; umpires score from their own
phones and viewers see live scores.

## How it works

| Piece | What it does |
|---|---|
| `public/index.html` | The app (viewer, umpire and organizer screens). A plain static file, so the site always loads. |
| `public/pb-shim.js` | Gives the app its shared database, publishing and admin sign-in, using the functions below. |
| `netlify/functions/api.mjs` (+ `netlify/lib/`) | Shared scoreboard (umpire accounts + live match scores), publishing, admin key check. Data is kept in Netlify Blobs. |

Tournament set-up data (divisions, teams, schedules) stays in the **organizer's browser**.
Pressing **Publish** copies the public snapshot to Netlify so everyone sees it.
Use the app's backup/export feature before clearing browser data or switching devices.

## 1. Put the code on GitHub

```bash
cd ppsu-game-management          # this folder
git init
git add .
git commit -m "PPSU Game Management online"
git branch -M main
# create an empty repository on github.com first, then:
git remote add origin https://github.com/<your-user>/<your-repo>.git
git push -u origin main
```

## 2. Deploy on Netlify

1. In Netlify choose **Add new site → Import an existing project → GitHub** and pick the repository.
2. Build settings are read from `netlify.toml`: no build command, publish directory `public`, functions `netlify/functions`. Leave them as they are.
3. Before the first deploy open **Site configuration → Environment variables** and add:
   * `ADMIN_KEY` – **required.** A long secret only you know (for example 20+ random characters). It is the key you type when choosing *Administrator*, and it is what allows publishing.
   * `UMP_MGR_HASH` – optional. Leave unset to keep the existing "PPSU" umpire-manager login working as before.
4. Click **Deploy**. Your link looks like `https://<site-name>.netlify.app` (you can rename it or attach your own domain under *Domain management*).
5. Every `git push` to `main` redeploys automatically.

Changed `ADMIN_KEY` later? Edit the variable and trigger **Deploys → Trigger deploy**.

## 3. Using it

* **Administrator:** open the link → *Administrator* → enter the admin key (remembered on that device) → sign in with the app's administrator account as before → **Publish**. Open pages of viewers refresh themselves within about 15 seconds.
* **Umpires:** open the same link → *Umpire*. The administrator (or the default PPSU manager login) creates umpire accounts under *Manage umpires*. Sign-in is checked on the server.
* **Viewers:** just open the link. No sign-in.
* **End event / End open play** in the app clear what viewers see and the live scores.
* To forget the admin key on a shared device: browser console → `__pbForgetAdminKey()`.

## If you see "Page not found"

1. **`netlify.toml` must be at the top level of the GitHub repository** (next to the `public` and `netlify` folders). If you pushed a parent folder, either move the files up one level or set **Site configuration → Build & deploy → Base directory** to the folder that contains `netlify.toml`.
2. **Publish directory must be `public`** and `public/index.html` must exist (Site configuration → Build & deploy → Build settings).
3. **Deploy from GitHub**, not by dragging the zip or the folder into Netlify (drag-and-drop skips the functions' dependencies).
4. Open **Deploys → latest deploy → Deploy log**; it should end with "Site is live" and list the `api` function under **Functions**.
5. After fixing settings use **Deploys → Trigger deploy → Clear cache and deploy site**.

Any unknown address (for example `/something`) now opens the app instead of an error, and the page still loads if the functions are temporarily unavailable (it just shows the last built-in data until they are back).

## Notes and limits

* Live scores refresh by polling every ~4 s (paused when the tab is hidden); responses are cached at Netlify's edge for 3 s so crowds of viewers cost very few function calls. Netlify's free plan covers typical club events; check your plan's function-call allowance for very large crowds.
* The scoreboard accepts writes to `pbmatch` (live scores) from anyone who has the link, like any open scoring page. Umpire accounts can only be created/changed with the admin key or the PPSU manager login. Umpire password hashes are never sent to browsers.
* Keep `ADMIN_KEY` secret. Anyone who has it can publish.

## Development

```bash
npm install
npx netlify dev     # run everything locally (needs the Netlify CLI)
```
