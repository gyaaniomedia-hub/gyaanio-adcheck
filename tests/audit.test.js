// Run: node tests/audit.test.js   (serves the repo locally, runs a five ad audit, saves screenshots)
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "tests", "screenshots");

const ADS = [
  "Guaranteed 12% ROI! Off plan 1 bedroom apartments in JVC, risk free investment with a golden visa included. Only 3 units left, book today. Call 050 123 4567.",
  "Spacious 2 bedroom apartment for sale in Dubai Marina, 1,250 sq ft, sea view, AED 2,100,000. Trakheesi permit 7123456789. Palm Crest Realty, RERA ORN 12345, agent BRN 54321.",
  "Off plan townhouses in Dubai South by Emaar. 3 bedrooms, 2,400 sq ft, from AED 1,850,000 with a 60/40 payment plan. Escrow account 1002003004, completion Q4 2028. Trakheesi permit 7234567890. Palm Crest Realty, RERA ORN 12345.",
  "Luxury villa in Arabian Ranches for rent, 4 bedrooms, AED 380,000 per year. Contact us now for a viewing.",
  "Studio in Business Bay, 450 sq ft, AED 820,000, vacant on transfer. Trakheesi permit 7345678901. Palm Crest Realty, RERA ORN 12345, agent BRN 54321. Scan the QR code to verify.",
];
const FLAGS = [ { offplan: true, qr: false }, { offplan: false, qr: true }, { offplan: true, qr: true }, { offplan: false, qr: false }, { offplan: false, qr: true } ];

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
<rect width="200" height="200" rx="28" fill="#0B0B0B"/><path d="M100 36 L160 150 H40 Z" fill="none" stroke="#C9A356" stroke-width="12"/>
<circle cx="100" cy="118" r="16" fill="#C9A356"/></svg>`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "audit.html");
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
      const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
      res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
      fs.createReadStream(p).pipe(res);
    }).listen(0, () => resolve(srv));
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const logoPath = path.join(OUT, "palmcrest_logo.svg");
  fs.writeFileSync(logoPath, LOGO_SVG);

  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/audit.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(url);
  await page.fill("#brokerName", "Palm Crest Realty");
  await page.setInputFiles("#logoInput", logoPath);
  await page.fill("#adsInput", ADS.join("\n===\n"));
  await page.waitForFunction(() => document.querySelectorAll(".ad-item").length === 5);

  for (let i = 0; i < FLAGS.length; i++) {
    const item = page.locator(`.ad-item[data-i="${i}"]`);
    await item.locator('input[data-k="offplan"]').setChecked(FLAGS[i].offplan);
    await item.locator('input[data-k="qr"]').setChecked(FLAGS[i].qr);
  }
  await page.screenshot({ path: path.join(OUT, "audit-input.png"), fullPage: true });

  const requests = [];
  page.on("request", (r) => { if (r.url().includes("/functions/v1/adcheck") && r.method() === "POST") requests.push(JSON.parse(r.postData())); });

  await page.click("#runBtn");
  await page.waitForSelector("#progress.on");
  await page.waitForSelector("#reportSection.on", { timeout: 5 * 60 * 1000 });

  const report = await page.evaluate(() => ({
    title: document.querySelector(".r-title h3").textContent,
    hasLogo: !!document.querySelector(".r-logo img"),
    stats: [...document.querySelectorAll(".stat .v")].map((e) => e.textContent),
    exposure: document.querySelector(".exposure .v").textContent,
    violations: [...document.querySelectorAll(".viol li")].map((li) => li.querySelector(".name").textContent + ": " + li.querySelector(".num").textContent),
    rows: [...document.querySelectorAll(".ads-table tbody tr")].map((tr) => tr.querySelector(".c-verdict").textContent + " " + tr.querySelector(".c-score").textContent),
    progress: document.querySelector("#progressPct").textContent,
    copy: document.body.innerText,
  }));

  const assert = (c, m) => { if (!c) throw new Error("FAILED: " + m); console.log("ok  " + m); };
  assert(requests.length === 5, "five sequential requests sent");
  assert(requests.every((r, i) => r.offplan === FLAGS[i].offplan && r.has_qr === FLAGS[i].qr), "per ad off plan and QR flags sent");
  assert(report.progress === "100%", "progress bar reached 100%");
  assert(report.title === "Palm Crest Realty" && report.hasLogo, "brokerage name and logo rendered");
  assert(report.stats[0] === "5", "total ads checked is 5");
  assert(+report.stats[1] + +report.stats[2] + +report.stats[3] === 5, "PASS + FIX NEEDED + FAIL add up to 5");
  assert(report.exposure === "AED " + (+report.stats[3] * 50000).toLocaleString("en-US"), "fine exposure is AED 50,000 per failing ad");
  assert(report.violations.length > 0 && report.violations.length <= 5, "top violations listed (max five)");
  assert(report.rows.length === 5, "table has every ad");
  const ui = report.copy.replace(/\n\d+\n/g, "\n");
  const pageCopy = await page.evaluate(() => [...document.querySelectorAll("body *:not(script):not(style):not(textarea):not(.ad-text):not(.ex)")]
    .flatMap((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent)).join(" ")
    + " " + [...document.querySelectorAll("[placeholder]")].map((e) => e.placeholder).join(" "));
  const dash = pageCopy.match(/.{0,30}[\u2010-\u2015\u2212-].{0,30}/g);
  assert(!dash, "no dashes anywhere in page copy" + (dash ? " " + JSON.stringify(dash) : ""));
  assert(errors.length === 0, "no page errors");
  assert(await page.evaluate(() => getComputedStyle(document.querySelector(".topbar")).backgroundColor === "rgb(11, 11, 11)"), "shared styles.css applied");

  console.log(JSON.stringify({ stats: report.stats, exposure: report.exposure, violations: report.violations, rows: report.rows }, null, 2));

  await page.locator("#report").screenshot({ path: path.join(OUT, "audit-report.png") });
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: path.join(OUT, "audit-print.png"), fullPage: true });
  const pdf = await page.pdf({ path: path.join(OUT, "audit-report.pdf"), preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: "screen" });
  const pdfText = pdf.toString("latin1");
  const pages = (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert(/\/MediaBox\s*\[0 0 59[45]\.\d+ 84[12]\.\d+\]/.test(pdfText), "PDF is A4 portrait");
  assert(pages === 1, "five ad audit prints on one A4 page (got " + pages + ")");

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(url);
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert(!overflow, "no horizontal scroll at phone width");

  await browser.close();
  srv.close();
  console.log("All checks passed. Screenshots in tests/screenshots");
})().catch((e) => { console.error(e); process.exit(1); });
