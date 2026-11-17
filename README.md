# Gyaanio AdCheck

Gyaanio AdCheck is a static website served from the root of this repository via GitHub Pages.

## Pages

| File | Purpose |
| --- | --- |
| `index.html` | Home / landing page |
| `write.html` | Write ad copy |
| `audit.html` | Brokerage audit: check up to 50 ads in one run and download a branded A4 PDF report |

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

Live site: <https://adcheck.gyaaniomedia.com/>

## PDF reports

`assets/report-pdf.js` builds the A4 portrait "Ad Compliance Report" in the browser with pdfmake (`assets/vendor/pdfmake.min.js`) and saves it as a real PDF file on desktop and phone. It embeds Poppins and Playfair Display from `assets/fonts`, puts the dark Gyaanio Media logo (`assets/gyaanio-logo-dark.png`) at the top and the Gyaanio mark (`assets/gyaanio-mark.png`) as a diagonal watermark at about 6 percent opacity on every page, with the footer and page number. Table headers repeat on each page and rows never split.

## Tests

```bash
node tests/audit.test.js
```

Runs a five ad audit on `audit.html` against the live function in headless Chromium, checks the counts, fine exposure, print layout and copy, and saves screenshots and a PDF to `tests/screenshots`.

```bash
node tests/pdf.test.js
```

Checks one sample ad and a five ad audit on desktop and phone viewports, downloads both PDF reports, verifies A4 size, footer, disclaimer and page numbers on every page and no dashes in copy, then renders each page to PNG in `tests/screenshots` (needs `pdftoppm`, `pdfinfo` and `pdftotext`).
