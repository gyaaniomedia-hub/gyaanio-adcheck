/*
 * Gyaanio AdCheck PDF reports.
 * Builds a real A4 portrait PDF in the browser with pdfmake and saves it as a file.
 * Fonts, logo and watermark load lazily the first time a report is requested.
 */
(function () {
  "use strict";

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/assets\/report-pdf\.js.*$/, "") : "";
  })();

  var C = {
    orange: "#E55121",
    orangeDeep: "#C2431A",
    tint: "#FBE9E2",
    stone: "#F3F0EB",
    black: "#0B0B0B",
    coal: "#161616",
    ink: "#111111",
    line: "#DAD5CD",
    muted: "#6B6864",
    white: "#FFFFFF"
  };

  var FOOTER_1 = "Checked by Gyaanio AdCheck, gyaaniomedia.com, WhatsApp +971 56 904 6294";
  var FOOTER_2 = "Guidance only, not legal advice. Confirm details with your Trakheesi permit.";

  var ready = null;
  var assets = {};

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.async = true;
      s.onload = res; s.onerror = function () { rej(new Error("Could not load " + src)); };
      document.head.appendChild(s);
    });
  }

  function fetchB64(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("Could not load " + url);
      return r.arrayBuffer();
    }).then(function (buf) {
      var bytes = new Uint8Array(buf), bin = "", CH = 0x8000;
      for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(bin);
    });
  }

  function loadImage(url) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error("Could not load " + url)); };
      img.src = url;
    });
  }

  // The Gyaanio mark, rotated and set to about 6 percent opacity, baked into a PNG.
  function makeWatermark(img) {
    var angle = -32 * Math.PI / 180;
    var w = img.naturalWidth, h = img.naturalHeight;
    var cw = Math.ceil(Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle)));
    var ch = Math.ceil(Math.abs(w * Math.sin(angle)) + Math.abs(h * Math.cos(angle)));
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    var x = c.getContext("2d");
    x.globalAlpha = 0.06;
    x.translate(cw / 2, ch / 2);
    x.rotate(angle);
    x.drawImage(img, -w / 2, -h / 2);
    return { data: c.toDataURL("image/png"), ratio: ch / cw };
  }

  function imageToDataURL(img) {
    var c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  }

  function init() {
    if (ready) return ready;
    var fontFiles = {
      "Poppins-Regular.ttf": "assets/fonts/Poppins-Regular.ttf",
      "Poppins-SemiBold.ttf": "assets/fonts/Poppins-SemiBold.ttf",
      "PlayfairDisplay-SemiBold.ttf": "assets/fonts/PlayfairDisplay-SemiBold.ttf",
      "PlayfairDisplay-Bold.ttf": "assets/fonts/PlayfairDisplay-Bold.ttf"
    };
    var lib = window.pdfMake ? Promise.resolve() : loadScript(BASE + "assets/vendor/pdfmake.min.js");
    ready = lib.then(function () {
      var names = Object.keys(fontFiles);
      return Promise.all([
        Promise.all(names.map(function (n) { return fetchB64(BASE + fontFiles[n]); })),
        loadImage(BASE + "assets/gyaanio-logo-dark.png"),
        loadImage(BASE + "assets/gyaanio-mark.png")
      ]).then(function (out) {
        var vfs = {};
        names.forEach(function (n, i) { vfs[n] = out[0][i]; });
        assets.vfs = vfs;
        assets.logo = imageToDataURL(out[1]);
        assets.logoRatio = out[1].naturalHeight / out[1].naturalWidth;
        assets.watermark = makeWatermark(out[2]);
        assets.fonts = {
          Poppins: { normal: "Poppins-Regular.ttf", bold: "Poppins-SemiBold.ttf", italics: "Poppins-Regular.ttf", bolditalics: "Poppins-SemiBold.ttf" },
          Playfair: { normal: "PlayfairDisplay-SemiBold.ttf", bold: "PlayfairDisplay-Bold.ttf", italics: "PlayfairDisplay-SemiBold.ttf", bolditalics: "PlayfairDisplay-Bold.ttf" }
        };
      });
    });
    ready.catch(function () { ready = null; });
    return ready;
  }

  /* Text helpers */
  function clean(s) {
    return String(s == null ? "" : s)
      .replace(/\s*[\u2012-\u2015\u2212]\s*/g, ", ")
      .replace(/([A-Za-z])[\u2010\u2011-](?=[A-Za-z])/g, "$1 ")
      .replace(/\s+\-\s+/g, ", ");
  }

  // Bracketed placeholders show in orange so the reader sees what to fill in.
  function withPlaceholders(text) {
    var parts = [], re = /\[[^\]]+\]/g, last = 0, m;
    text = clean(text);
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ text: text.slice(last, m.index) });
      parts.push({ text: m[0], color: C.orangeDeep, bold: true });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts.length ? parts : [{ text: "" }];
  }

  function todayLong() {
    return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  }

  function slug(s) {
    return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "_").slice(0, 40);
  }

  function statusKey(s) {
    s = String(s || "").toLowerCase();
    if (s.indexOf("pass") === 0 || s === "ok") return "pass";
    if (s.indexOf("fail") === 0) return "fail";
    return "warn";
  }

  function verdictKey(v) {
    var s = String(v || "").toUpperCase();
    if (s.indexOf("PASS") === 0) return "pass";
    if (s.indexOf("FAIL") === 0) return "fail";
    if (s) return "fix";
    return "none";
  }
  var VERDICT_LABEL = { pass: "PASS", fix: "FIX NEEDED", fail: "FAIL", none: "NOT CHECKED" };
  var VERDICT_LINE = { pass: "Ready to publish", fix: "Needs fixing before it runs", fail: "Not ready to publish", none: "Could not be checked" };

  // Status chips: orange only. Fail is solid, warn is tinted, pass is quiet stone.
  function chip(key, label) {
    var st = {
      fail: { fillColor: C.orange, color: C.white },
      fix: { fillColor: C.tint, color: C.orangeDeep },
      warn: { fillColor: C.tint, color: C.orangeDeep },
      pass: { fillColor: C.stone, color: C.ink },
      none: { fillColor: C.stone, color: C.muted }
    }[key];
    return {
      table: { widths: ["auto"], body: [[{ text: label, style: "chip", color: st.color, fillColor: st.fillColor, margin: [6, 2, 6, 1] }]] },
      layout: "noBorders"
    };
  }

  var hairline = {
    hLineWidth: function (i, node) { return (i === 0 || i === node.table.body.length) ? 0 : 0.5; },
    vLineWidth: function () { return 0; },
    hLineColor: function (i, node) { return i === 1 && node.table.headerRows ? C.ink : C.line; },
    paddingLeft: function (i) { return i === 0 ? 0 : 8; },
    paddingRight: function (i, node) { return i === node.table.widths.length - 1 ? 0 : 8; },
    paddingTop: function () { return 7; },
    paddingBottom: function () { return 7; }
  };

  function boxLayout(fill) {
    return {
      hLineWidth: function () { return 0.5; },
      vLineWidth: function () { return 0.5; },
      hLineColor: function () { return C.line; },
      vLineColor: function () { return C.line; },
      fillColor: function () { return fill; },
      paddingLeft: function () { return 14; },
      paddingRight: function () { return 14; },
      paddingTop: function () { return 12; },
      paddingBottom: function () { return 12; }
    };
  }

  function sectionTitle(text, note) {
    return {
      stack: [
        {
          columns: [
            { text: text, style: "h2", width: "*" },
            note ? { text: note, style: "note", width: "auto", alignment: "right", margin: [0, 6, 0, 0] } : { text: "", width: "auto" }
          ]
        },
        { canvas: [{ type: "line", x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: C.line }], margin: [0, 4, 0, 10] }
      ],
      margin: [0, 22, 0, 0],
      headlineLevel: 1
    };
  }

  // Holds a heading with the block that follows it so neither is stranded.
  function keepTogether() {
    var items = Array.prototype.slice.call(arguments);
    items.forEach(function (n) { delete n.headlineLevel; });
    return { stack: items, unbreakable: true };
  }

  function coverBlock(o) {
    var logoW = 132;
    var right = [{ text: "REPORT DATE", style: "eyebrowMuted", alignment: "right" }, { text: o.date, style: "meta", alignment: "right" }];
    var titleStack = [
      { text: "GYAANIO ADCHECK", style: "eyebrow", margin: [0, 0, 0, 6] },
      { text: "Ad Compliance Report", style: "h1" }
    ];
    if (o.subtitle) titleStack.push({ text: o.subtitle, style: "lead", margin: [0, 4, 0, 0] });
    var prepared = [];
    if (o.brokerage) {
      var pf = [{ text: "PREPARED FOR", style: "eyebrowMuted" }, { text: clean(o.brokerage), style: "brokerage" }];
      prepared.push({
        columns: (o.brokerLogo ? [{ image: o.brokerLogo, fit: [44, 44], width: 52 }] : []).concat([{ stack: pf, width: "*", margin: [0, o.brokerLogo ? 6 : 0, 0, 0] }]),
        margin: [0, 14, 0, 0]
      });
    }
    return [
      {
        columns: [
          { image: assets.logo, width: logoW },
          { stack: right, width: "*", margin: [0, 8, 0, 0] }
        ]
      },
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 1, lineColor: C.orange }], margin: [0, 16, 0, 22] },
      { stack: titleStack },
      { stack: prepared }
    ];
  }

  function verdictBlock(key, score, summary, counts) {
    var scoreText = score == null || score === "" ? "?" : String(score);
    var tally = counts ? counts.pass + " pass    " + counts.warn + " warn    " + counts.fail + " fail" : "";
    return {
      table: {
        widths: [110, "*"],
        body: [[
          {
            stack: [
              { text: "SCORE", style: "eyebrow", color: C.orange },
              { text: [{ text: scoreText, style: "score" }, { text: " / 100", style: "scoreOf" }], margin: [0, 2, 0, 0] }
            ],
            fillColor: C.black, margin: [18, 16, 6, 16]
          },
          {
            stack: [
              { columns: [{ text: VERDICT_LINE[key], style: "verdict", width: "*" }, { stack: [chip(key, VERDICT_LABEL[key])], width: "auto", margin: [0, 4, 0, 0] }], columnGap: 10 },
              summary ? { text: clean(summary), style: "onDark", margin: [0, 6, 0, 0] } : {},
              tally ? { text: tally.toUpperCase(), style: "tally", margin: [0, 10, 0, 0] } : {}
            ],
            fillColor: C.coal, margin: [16, 16, 18, 16]
          }
        ]]
      },
      layout: "noBorders",
      unbreakable: true,
      margin: [0, 26, 0, 0]
    };
  }

  function rulesTable(checks) {
    var body = [[
      { text: "RULE AND FINDING", style: "th" },
      { text: "STATUS", style: "th", alignment: "right" }
    ]];
    (checks || []).forEach(function (c, i) {
      var k = statusKey(c.status);
      var label = k === "pass" ? "PASS" : k === "fail" ? "FAIL" : "WARN";
      var stack = [
        { text: [{ text: String(i + 1).padStart(2, "0") + "   ", color: C.orange, bold: true }, { text: clean(c.rule) }], style: "ruleName" },
        { text: clean(c.finding), style: "body", margin: [0, 3, 0, 0] }
      ];
      if (c.fix && k !== "pass") stack.push({ text: [{ text: "Fix  ", bold: true, color: C.ink }, { text: clean(c.fix) }], style: "fix", margin: [0, 5, 0, 0] });
      body.push([{ stack: stack }, { stack: [chip(k, label)], alignment: "right" }]);
    });
    if (body.length === 1) body.push([{ text: "No rules were returned for this ad.", style: "body" }, ""]);
    return {
      table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: ["*", 62], body: body },
      layout: hairline
    };
  }

  function correctedBlock(text) {
    return {
      table: { widths: ["*"], body: [[{ text: withPlaceholders(text || "No corrected version was returned."), style: "adText" }]] },
      layout: boxLayout(C.stone)
    };
  }

  function baseDoc(content, meta) {
    var wm = assets.watermark;
    return {
      pageSize: "A4",
      pageOrientation: "portrait",
      pageMargins: [48, 58, 48, 74],
      info: { title: meta.title, author: "Gyaanio Media", subject: "Ad Compliance Report", creator: "Gyaanio AdCheck" },
      defaultStyle: { font: "Poppins", fontSize: 9.5, lineHeight: 1.35, color: C.ink },
      background: function (page, size) {
        var w = size.width * 0.78, h = w * wm.ratio;
        return { image: wm.data, width: w, absolutePosition: { x: (size.width - w) / 2, y: (size.height - h) / 2 } };
      },
      header: function (page) {
        if (page === 1) return null;
        return {
          margin: [48, 24, 48, 0],
          stack: [
            { columns: [
              { text: [{ text: "GYAANIO ADCHECK", color: C.orange, bold: true }, { text: "    " + meta.running }], style: "running", width: "*" },
              { text: meta.date, style: "running", alignment: "right", width: "auto" }
            ] },
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: C.line }], margin: [0, 6, 0, 0] }
          ]
        };
      },
      footer: function (page, pages) {
        return {
          margin: [48, 14, 48, 0],
          stack: [
            { canvas: [{ type: "line", x1: 0, y1: 0, x2: 499, y2: 0, lineWidth: 0.5, lineColor: C.line }] },
            { columns: [
              { text: FOOTER_1, style: "foot", width: "*" },
              { text: "Page " + page + " of " + pages, style: "footPage", width: "auto" }
            ], margin: [0, 8, 0, 0] },
            { text: FOOTER_2, style: "footNote", margin: [0, 2, 0, 0] }
          ]
        };
      },
      // Keep a section heading with what follows it.
      pageBreakBefore: function (node) {
        return node.headlineLevel === 1 && node.startPosition && node.startPosition.verticalRatio > 0.78;
      },
      content: content,
      styles: {
        eyebrow: { font: "Poppins", bold: true, fontSize: 7.5, characterSpacing: 1.6, color: C.orange },
        eyebrowMuted: { font: "Poppins", bold: true, fontSize: 7, characterSpacing: 1.4, color: C.muted },
        meta: { fontSize: 10, bold: true, color: C.ink, margin: [0, 2, 0, 0] },
        h1: { font: "Playfair", bold: true, fontSize: 30, lineHeight: 1.1, color: C.black },
        lead: { fontSize: 10.5, color: C.muted },
        brokerage: { font: "Playfair", fontSize: 15, color: C.black, margin: [0, 1, 0, 0] },
        h2: { font: "Playfair", bold: true, fontSize: 15, color: C.black },
        h3: { font: "Playfair", bold: true, fontSize: 12.5, color: C.black },
        note: { fontSize: 8, color: C.muted },
        score: { font: "Playfair", bold: true, fontSize: 34, color: C.white },
        scoreOf: { fontSize: 9, color: "#A9A39A" },
        verdict: { font: "Playfair", bold: true, fontSize: 17, color: C.white, lineHeight: 1.15 },
        onDark: { fontSize: 9.5, color: "#D9D4CC" },
        tally: { fontSize: 7.5, bold: true, characterSpacing: 1.2, color: C.orange },
        chip: { fontSize: 7, bold: true, characterSpacing: 1, lineHeight: 1.1 },
        th: { fontSize: 7, bold: true, characterSpacing: 1.3, color: C.muted },
        ruleName: { fontSize: 10, bold: true, color: C.black },
        body: { fontSize: 9.2, color: "#3A3733" },
        fix: { fontSize: 9, color: "#3A3733" },
        adText: { fontSize: 9.8, lineHeight: 1.5, color: C.ink },
        small: { fontSize: 8.4, color: "#3A3733" },
        statK: { fontSize: 7, bold: true, characterSpacing: 1.3, color: C.muted },
        statV: { font: "Playfair", bold: true, fontSize: 24, color: C.black, lineHeight: 1.1 },
        statP: { fontSize: 7.8, color: C.muted },
        running: { fontSize: 7.5, color: C.muted, characterSpacing: 0.4 },
        foot: { fontSize: 7.5, color: C.ink },
        footPage: { fontSize: 7.5, bold: true, color: C.ink },
        footNote: { fontSize: 7, color: C.muted }
      }
    };
  }

  function save(doc, filename) {
    return new Promise(function (resolve, reject) {
      try {
        window.pdfMake.createPdf(doc, null, assets.fonts, assets.vfs).getBlob(function (blob) {
          var file = blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" });
          if (window.navigator.msSaveOrOpenBlob) { window.navigator.msSaveOrOpenBlob(file, filename); resolve(filename); return; }
          var url = URL.createObjectURL(file);
          var a = document.createElement("a");
          a.href = url; a.download = filename; a.rel = "noopener";
          a.style.display = "none";
          document.body.appendChild(a);
          if (typeof a.download === "undefined") window.open(url, "_blank"); else a.click();
          setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 30000);
          resolve(filename);
        });
      } catch (e) { reject(e); }
    });
  }

  /* Single ad report */
  function single(o) {
    return init().then(function () {
      var r = o.result || {};
      var checks = Array.isArray(r.checks) ? r.checks : [];
      var counts = { pass: 0, warn: 0, fail: 0 };
      checks.forEach(function (c) { counts[statusKey(c.status)]++; });
      var key = verdictKey(r.verdict || (counts.fail ? "FAIL" : counts.warn ? "FIX" : "PASS"));
      var date = todayLong();
      var flags = [o.offplan ? "Off plan" : "Ready property", o.hasQr ? "QR code confirmed on creative" : "QR code not confirmed"].join("    ");

      var content = coverBlock({ date: date, brokerage: o.brokerage, subtitle: "Single advertisement review against DLD and RERA advertising rules" });
      content.push(verdictBlock(key, r.score, r.summary, counts));
      if (o.ad) {
        content.push(keepTogether(sectionTitle("Advertisement reviewed", flags), { table: { widths: ["*"], body: [[{ text: clean(o.ad), style: "small" }]] }, layout: boxLayout(C.white) }));
      }
      content.push(sectionTitle("Rule by rule", checks.length + " rules checked"));
      content.push(rulesTable(checks));
      content.push(keepTogether(sectionTitle("Corrected advertisement", "Orange brackets are details only you can supply"), correctedBlock(r.rewritten_ad || r.corrected_ad)));

      var doc = baseDoc(content, { title: "Ad Compliance Report", running: "Ad Compliance Report" + (o.brokerage ? "    " + clean(o.brokerage) : ""), date: date });
      var name = "Gyaanio_Ad_Compliance_Report_" + (o.brokerage ? slug(o.brokerage) + "_" : "") + new Date().toISOString().slice(0, 10).replace(/\D/g, "") + ".pdf";
      return save(doc, name);
    });
  }

  /* Brokerage audit report */
  // Any uploaded logo (PNG, JPG, SVG, WebP) is redrawn as PNG so the PDF can embed it.
  function logoToPng(data) {
    if (!data || !/^data:image\//i.test(data)) return Promise.resolve(null);
    return loadImage(data).then(function (img) {
      var w = img.naturalWidth || 300, h = img.naturalHeight || 300, k = Math.min(1, 400 / Math.max(w, h));
      if (/svg/i.test(data.slice(0, 30))) k = 400 / Math.max(w, h);
      var c = document.createElement("canvas");
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    }).catch(function () { return null; });
  }

  function audit(o) {
    return init().then(function () { return logoToPng(o.logoData); }).then(function (brokerLogo) {
      var date = todayLong();
      var t = o.totals;
      var n = t.checked;
      var p = function (x) { return n ? Math.round((x / n) * 100) : 0; };
      var content = coverBlock({
        date: date,
        brokerage: o.brokerage,
        brokerLogo: brokerLogo,
        subtitle: "Brokerage audit of " + o.results.length + " " + (o.results.length === 1 ? "advertisement" : "advertisements") + " against DLD and RERA advertising rules"
      });

      // Totals
      function stat(k, v, sub, accent) {
        return { stack: [{ text: k, style: "statK" }, { text: String(v), style: "statV", color: accent || C.black, margin: [0, 4, 0, 0] }, { text: sub, style: "statP" }] };
      }
      content.push(sectionTitle("Totals", t.avg != null ? "Average score " + t.avg + " / 100" : ""));
      content.push({
        table: {
          widths: ["*", "*", "*", "*"],
          body: [[
            stat("ADS CHECKED", n, t.notChecked ? t.notChecked + " not checked" : "of " + o.results.length + " submitted"),
            stat("PASS", t.pass, p(t.pass) + "% of ads"),
            stat("FIX NEEDED", t.fix, p(t.fix) + "% of ads", C.orangeDeep),
            stat("FAIL", t.fail, p(t.fail) + "% of ads", C.orange)
          ]]
        },
        layout: {
          hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; },
          hLineColor: function () { return C.line; }, vLineColor: function () { return C.line; },
          paddingLeft: function () { return 12; }, paddingRight: function () { return 12; },
          paddingTop: function () { return 12; }, paddingBottom: function () { return 12; }
        },
        unbreakable: true
      });
      content.push({
        table: {
          widths: ["*", "auto"],
          body: [[
            { stack: [{ text: "ESTIMATED FINE EXPOSURE", style: "eyebrow" }, { text: t.fail + " failing " + (t.fail === 1 ? "ad" : "ads") + " at AED 50,000 per ad", style: "onDark", margin: [0, 3, 0, 0] }], fillColor: C.black, margin: [16, 12, 0, 12] },
            { text: "AED " + (t.fail * 50000).toLocaleString("en-US"), font: "Playfair", bold: true, fontSize: 22, color: C.orange, fillColor: C.black, margin: [10, 14, 16, 10], alignment: "right" }
          ]]
        },
        layout: "noBorders",
        unbreakable: true,
        margin: [0, 10, 0, 0]
      });

      // Top violations
      var violHead = sectionTitle("Top violations", "Ads that failed or need a fix on each rule");
      if (o.top.length) {
        var vbody = [[{ text: "#", style: "th" }, { text: "RULE", style: "th" }, { text: "ADS AFFECTED", style: "th", alignment: "right" }, { text: "SHARE", style: "th", alignment: "right" }]];
        o.top.forEach(function (v, i) {
          vbody.push([
            { text: String(i + 1), font: "Playfair", bold: true, color: C.orange, fontSize: 11 },
            { text: clean(v.name), bold: true },
            { text: v.ads + " of " + n + (v.fail ? "  (" + v.fail + " fail)" : ""), alignment: "right" },
            { text: p(v.ads) + "%", alignment: "right", bold: true }
          ]);
        });
        content.push(violHead);
        content.push({ table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [18, "*", 110, 50], body: vbody }, layout: hairline });
      } else {
        content.push(violHead);
        content.push({ text: "No rule was broken by any ad checked.", style: "body" });
      }

      // Full table
      content.push(sectionTitle("Every ad checked", o.results.length + " " + (o.results.length === 1 ? "ad" : "ads")));
      var tbody = [[
        { text: "#", style: "th" }, { text: "ADVERTISEMENT", style: "th" },
        { text: "VERDICT", style: "th" }, { text: "SCORE", style: "th", alignment: "right" }
      ]];
      o.results.forEach(function (r, i) {
        var k = verdictKey(r.verdict);
        var flags = [r.ad.offplan ? "Off plan" : "", r.ad.qr ? "QR present" : ""].filter(Boolean).join("    ");
        var ex = clean(r.ad.text).replace(/\s+/g, " ");
        if (ex.length > 260) ex = ex.slice(0, 257).replace(/\s+\S*$/, "") + "...";
        tbody.push([
          { text: String(i + 1), bold: true, color: C.orange },
          { stack: [{ text: ex, style: "small" }].concat(flags ? [{ text: flags.toUpperCase(), style: "statK", margin: [0, 3, 0, 0] }] : []) },
          { stack: [chip(k, VERDICT_LABEL[k])] },
          { text: r.score != null ? [{ text: String(r.score), bold: true }, { text: " / 100", color: C.muted, fontSize: 7.5 }] : "", alignment: "right" }
        ]);
      });
      content.push({ table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [18, "*", 74, 52], body: tbody }, layout: hairline });

      // Ad by ad detail
      o.results.forEach(function (r, i) {
        var k = verdictKey(r.verdict);
        var head = sectionTitle("Ad " + (i + 1) + " in detail", VERDICT_LABEL[k] + (r.score != null ? "    " + r.score + " / 100" : ""));
        var intro = [head, { table: { widths: ["*"], body: [[{ text: clean(r.ad.text), style: "small" }]] }, layout: boxLayout(C.white), margin: [0, 0, 0, 12] }];
        if (r.error) intro.push({ text: "This ad could not be checked: " + clean(r.error), style: "body" });
        else if (r.summary) intro.push({ text: clean(r.summary), style: "body", margin: [0, 0, 0, 4] });
        var block = keepTogether.apply(null, intro);
        if (i === 0) content.push({ text: "", margin: [0, 18, 0, 0] });
        content.push(block);
        if (r.error) return;
        content.push(rulesTable(r.checks));
        if (r.rewritten) {
          content.push(keepTogether({ text: "Corrected advertisement", style: "h3", margin: [0, 16, 0, 8] }, correctedBlock(r.rewritten)));
        }
      });

      var doc = baseDoc(content, { title: "Ad Compliance Report", running: "Brokerage audit" + (o.brokerage ? "    " + clean(o.brokerage) : ""), date: date });
      var name = "Gyaanio_Ad_Compliance_Audit_" + (o.brokerage ? slug(o.brokerage) + "_" : "") + new Date().toISOString().slice(0, 10).replace(/\D/g, "") + ".pdf";
      return save(doc, name);
    });
  }

  window.GyaanioReport = { single: single, audit: audit, preload: init };
})();
