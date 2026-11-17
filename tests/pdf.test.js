// Run: node tests/pdf.test.js
// Serves the repo locally, checks one sample ad on index.html and a five ad audit on audit.html
// against the live function, downloads both PDF reports and renders every page to PNG.
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tests", "screenshots");

const SAMPLE = "Luxury 2BR in Dubai Marina, guaranteed 10% ROI! Best price in the market, limited units. Call now 0501234567";
const ADS = [
  "Guaranteed 12% ROI! Off plan 1 bedroom apartments in JVC, risk free investment with a golden visa included. Only 3 units left, book today. Call 050 123 4567.",
  "Spacious 2 bedroom apartment for sale in Dubai Marina, 1,250 sq ft, sea view, AED 2,100,000. Trakheesi permit 7123456789. Palm Crest Realty, RERA ORN 12345, agent BRN 54321.",
  "Off plan townhouses in Dubai South by Emaar. 3 bedrooms, 2,400 sq ft, from AED 1,850,000 with a 60/40 payment plan. Escrow account 1002003004, completion Q4 2028. Trakheesi permit 7234567890. Palm Crest Realty, RERA ORN 12345.",
  "Luxury villa in Arabian Ranches for rent, 4 bedrooms, AED 380,000 per year. Contact us now for a viewing.",
  "Studio in Business Bay, 450 sq ft, AED 820,000, vacant on transfer. Trakheesi permit 7345678901. Palm Crest Realty, RERA ORN 12345, agent BRN 54321. Scan the QR code to verify.",
];
const FLAGS = [{ offplan: true, qr: false }, { offplan: false, qr: true }, { offplan: true, qr: true }, { offplan: false, qr: false }, { offplan: false, qr: true }];
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200"><rect width="200" height="200" fill="#0B0B0B"/><path d="M100 36 L160 150 H40 Z" fill="none" stroke="#E55121" stroke-width="12"/><circle cx="100" cy="118" r="16" fill="#E55121"/></svg>`;

function serve() {
  return new Promise((resolve) => {
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf" };
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

function render(pdf, prefix) {
  execFileSync("pdftoppm", ["-png", "-r", "80", pdf, path.join(OUT, prefix)]);
  const info = execFileSync("pdfinfo", [pdf]).toString();
  const text = execFileSync("pdftotext", ["-layout", pdf, "-"]).toString();
  return { pages: +(/Pages:\s+(\d+)/.exec(info) || [])[1], size: (/Page size:\s+(.+)/.exec(info) || [])[1], text };
}

function checkText(name, r, expect) {
  const fails = [];
  for (const s of expect) if (!r.text.includes(s)) fails.push("missing: " + s);
  const footers = (r.text.match(/Checked by Gyaanio AdCheck, gyaaniomedia\.com, WhatsApp \+971 56 904 6294/g) || []).length;
  const notes = (r.text.match(/Guidance only, not legal advice\. Confirm details with your Trakheesi permit\./g) || []).length;
  if (footers !== r.pages) fails.push(`footer on ${footers} of ${r.pages} pages`);
  if (notes !== r.pages) fails.push(`disclaimer on ${notes} of ${r.pages} pages`);
  for (let i = 1; i <= r.pages; i++) if (!r.text.includes(`Page ${i} of ${r.pages}`)) fails.push(`no page number ${i}`);
  const dash = r.text.match(/.{0,25}[‐-―−].{0,25}|[A-Za-z]-[A-Za-z]/g);
  if (dash) fails.push("dash in copy: " + JSON.stringify(dash.slice(0, 5)));
  console.log(`${name}: ${r.pages} pages, ${r.size}, footer ${footers}/${r.pages}` + (fails.length ? "\n  FAIL " + fails.join("\n  FAIL ") : ", all text checks pass"));
  return fails.length === 0;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^(single|audit)_pdf.*\.png$|\.pdf$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const logoPath = path.join(OUT, "palmcrest_logo.svg");
  fs.writeFileSync(logoPath, LOGO_SVG);
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}`;
  const browser = await chromium.launch();
  let ok = true;

  for (const vp of [{ n: "desktop", o: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 } }, { n: "phone", o: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }]) {
    const ctx = await browser.newContext({ ...vp.o, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Single ad
    await page.goto(base + "/index.html");
    await page.screenshot({ path: path.join(OUT, `index-${vp.n}.png`), fullPage: true });
    await page.click("#sampleBtn");
    await page.fill("#brokerName", "Palm Crest Realty");
    await page.click("#runBtn");
    await page.waitForSelector("#results:not(.hidden)", { timeout: 120000 });
    await page.screenshot({ path: path.join(OUT, `index-${vp.n}-results.png`), fullPage: true });
    const [d1] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#pdfBtn")]);
    const singlePdf = path.join(OUT, `single-report-${vp.n}.pdf`);
    await d1.saveAs(singlePdf);
    console.log(`${vp.n} single download name: ${d1.suggestedFilename()}`);
    const r1 = render(singlePdf, `single_pdf_${vp.n}`);
    ok = checkText(`${vp.n} single PDF`, r1, ["Ad Compliance Report", "Palm Crest Realty", "Rule by rule", "Corrected advertisement", "/ 100"]) && ok;

    // Five ad audit
    await page.goto(base + "/audit.html");
    await page.fill("#brokerName", "Palm Crest Realty");
    await page.setInputFiles("#logoInput", logoPath);
    await page.fill("#adsInput", ADS.join("\n===\n"));
    await page.waitForFunction(() => document.querySelectorAll(".ad-item").length === 5);
    for (let i = 0; i < FLAGS.length; i++) {
      const item = page.locator(`.ad-item[data-i="${i}"]`);
      await item.locator('input[data-k="offplan"]').setChecked(FLAGS[i].offplan);
      await item.locator('input[data-k="qr"]').setChecked(FLAGS[i].qr);
    }
    await page.click("#runBtn");
    await page.waitForSelector("#reportSection.on", { timeout: 400000 });
    await page.screenshot({ path: path.join(OUT, `audit-${vp.n}-report.png`), fullPage: true });
    const [d2] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#printBtn")]);
    const auditPdf = path.join(OUT, `audit-report-${vp.n}.pdf`);
    await d2.saveAs(auditPdf);
    console.log(`${vp.n} audit download name: ${d2.suggestedFilename()}`);
    const r2 = render(auditPdf, `audit_pdf_${vp.n}`);
    ok = checkText(`${vp.n} audit PDF`, r2, ["Ad Compliance Report", "Palm Crest Realty", "Totals", "Top violations", "Every ad checked", "Ad 5 in detail", "ESTIMATED FINE EXPOSURE"]) && ok;

    // Page copy has no dashes
    for (const u of ["/index.html", "/write.html", "/audit.html"]) {
      await page.goto(base + u);
      const t = await page.evaluate(() => document.body.innerText);
      const bad = t.match(/.{0,20}[‐-―−].{0,20}|[A-Za-z]-[A-Za-z]/g);
      if (bad) { ok = false; console.log(`FAIL dash on ${u}:`, bad); }
      if (vp.n === "desktop" && u === "/write.html") await page.screenshot({ path: path.join(OUT, `write-${vp.n}.png`), fullPage: true });
    }
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    if (sw > vp.o.viewport.width) { ok = false; console.log(`FAIL horizontal scroll ${sw}`); }
    if (errors.length) { ok = false; console.log("FAIL page errors:", errors); }
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(ok ? "ALL CHECKS PASSED" : "SOME CHECKS FAILED");
  process.exit(ok ? 0 : 1);
})();
