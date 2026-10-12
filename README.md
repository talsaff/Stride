# Stride: adaptive treadmill coach (iPhone app)

A gentle, adaptive treadmill walking coach. It plans each walk from how your recent walks felt,
your energy and recovery today, and how long it has been since your last walk. Missing a week
never erases progress, and running is never required.

The app lives in [`docs/`](docs/) as an installable web app (PWA): plain HTML, CSS and
JavaScript modules, with no build step and no dependencies.

## Install on your iPhone

1. Open **https://talsaff.github.io/stride/** in **Safari** on your iPhone
   (see "Hosting" below if the link isn't live yet).
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Open **Stride** from your home screen. It runs full screen, works offline, and keeps all
   data on your phone. Use *Settings → Export backup* now and then.

## Hosting (one-time, on GitHub)

**Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose branch
**`main`** and folder **`/docs`**, then **Save**. After a minute or so the site is live at the
URL above.

GitHub Pages on a **private** repository needs a paid GitHub plan (e.g. GitHub Pro). On a free
plan, make the repository public first (Settings → General → Danger Zone → Change visibility).
The code contains no personal data: your workout history only ever lives on your phone.

## Development

Serve `docs/` with any static server (`python3 -m http.server -d docs`) and run the engine tests
with `cd docs && npm test` (Node 18+). The design, data schema, algorithm and example histories
are in [`docs/DESIGN.md`](docs/DESIGN.md).
