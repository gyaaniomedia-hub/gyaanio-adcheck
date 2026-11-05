# Gyaanio AdCheck

Gyaanio AdCheck is a static website served from the root of this repository via GitHub Pages.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home / landing page |
| `write.html` | Write ad copy |
| `audit.html` | Audit an ad |

## Running locally

The site is plain HTML, CSS and JavaScript, so there is no build step. Serve the repository root with any static file server, for example:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/> in your browser (`/write.html` and `/audit.html` for the other pages).

Opening the files directly with `file://` may block API requests in some browsers, so a local server is recommended.

## API

The site has no backend in this repository. All API calls go to a **Supabase Edge Function**, which holds the server-side logic and secrets. The pages call that function over HTTPS; no API keys should be committed here.

## Deployment

Every push to `main` triggers `.github/workflows/pages.yml`, which uploads the repository root with `actions/upload-pages-artifact` and publishes it with `actions/deploy-pages`. The `.nojekyll` file tells GitHub Pages to serve files as-is without Jekyll processing.

Live site: <https://gyaaniomedia-hub.github.io/gyaanio-adcheck/>
