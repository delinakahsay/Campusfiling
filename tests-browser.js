/* Campus Filing: browser tests.
   Run with: node tests-browser.js

   These load the real pages in a real browser and drive them. The point
   is the document reader: its input is whatever pdf.js hands back, and
   a hand-written stand-in for that was how a W-2 misread survived a
   passing unit test suite. Here pdf.js actually parses a PDF.

   Needs: npm install playwright  (Chromium only). Skips cleanly if the
   browser is unavailable, so it never blocks the other suites. */

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

function serve() {
  return new Promise(function (resolve) {
    const server = http.createServer(function (req, res) {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
      const file = path.join(ROOT, rel || "index.html");
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

/* A PDF whose text items land where a real W-2 puts them: captions on one
   row, amounts on the row beneath, two columns across. */
function w2Pdf() {
  const rows = [
    ["Form W-2 Wage and Tax Statement 2026"],
    ["1 Wages, tips, other compensation", "2 Federal income tax withheld"],
    ["45,000.00", "3,200.00"],
    ["16 State wages, tips, etc.", "17 State income tax"],
    ["45,000.00", "1,842.00"]
  ];
  let ops = "", y = 740;
  rows.forEach(function (cells) {
    let x = 20;
    cells.forEach(function (cell) {
      ops += "BT /F1 9 Tf " + x + " " + y + " Td (" + cell + ") Tj ET ";
      x += 280;
    });
    y -= 18;
  });
  return "%PDF-1.4\n" +
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n" +
    "4 0 obj<</Length " + ops.length + ">>stream\n" + ops + "\nendstream\nendobj\n" +
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n" +
    "trailer<</Root 1 0 R/Size 6>>\n%%EOF";
}

async function main() {
  let chromium;
  try { chromium = require("playwright").chromium; }
  catch (e) { console.log("SKIP browser tests: playwright is not installed."); return 0; }

  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { console.log("SKIP browser tests: " + e.message.split("\n")[0]); server.close(); return 0; }

  const page = await browser.newPage();
  const errors = [];
  /* Webfonts come from Google and this runner may have no route to them.
     A missing font is a cosmetic matter, not a fault in the page, so it
     is not counted. Anything else is. */
  const IGNORE = /fonts\.(googleapis|gstatic)\.com/;
  page.on("pageerror", function (e) { if (!IGNORE.test(String(e))) errors.push(String(e)); });
  page.on("console", function (m) {
    if (m.type() !== "error") return;
    const where = (m.location() && m.location().url) || "";
    if (IGNORE.test(m.text()) || IGNORE.test(where)) return;
    errors.push(m.text() + (where ? " <- " + where : ""));
  });
  page.on("requestfailed", function (r) {
    if (!IGNORE.test(r.url())) errors.push("request failed: " + r.url());
  });

  let pass = 0, fail = 0;
  function check(name, ok, detail) {
    if (ok) { console.log("PASS " + name); pass++; }
    else { console.log("FAIL " + name + (detail ? "\n      " + detail : "")); fail++; }
  }

  /* The privacy page tells people to open the Network tab and see that
     nothing goes anywhere. That claim is only worth making if it is
     tested, so every request the pages make is recorded here. */
  const offsite = [];
  page.on("request", function (r) {
    if (r.url().indexOf(base) !== 0 && !/^(data|blob):/.test(r.url())) offsite.push(r.url());
  });

  await page.goto(base + "/app/file.html", { waitUntil: "networkidle" });

  check("The walkthrough loads with no console errors", errors.length === 0, errors.join(" | "));
  check("The walkthrough contacts nothing but this site", offsite.length === 0, offsite.join(" | "));
  check("The geometry reader is the one running",
    await page.evaluate(() => typeof itemsToLines === "function"));

  /* The case that matters. */
  const found = await page.evaluate(async (pdfText) => {
    const file = new File([new Blob([pdfText], { type: "application/pdf" })], "w2.pdf", { type: "application/pdf" });
    const res = await readDocument(file);
    const out = {};
    res.found.forEach(f => { out[f.field] = f.value; });
    return { out, type: res.type };
  }, w2Pdf());

  check("A real W-2 layout yields the wage figure, not the next box number",
    found.out.w2wage === 45000, "got " + found.out.w2wage);
  check("Federal withholding comes from its own column",
    found.out.w2fed === 3200, "got " + found.out.w2fed);
  check("State withholding comes from its own column",
    found.out.w2state === 1842, "got " + found.out.w2state);
  check("No extracted figure is a box number",
    Object.values(found.out).every(v => Math.abs(v) >= 100), JSON.stringify(found.out));

  /* Nothing may reach an answer without the review step. */
  const gate = await page.evaluate(() => ({
    wage: document.getElementById("w2wage").value,
    reviewShown: !document.getElementById("review").hidden
  }));
  check("Extraction alone writes nothing into the answers", gate.wage === "", "field held " + gate.wage);

  /* The erase control is present and reachable. */
  check("The walkthrough carries an erase control",
    await page.evaluate(() => !!document.getElementById("wipe")));

  /* The plan leads with an action list. */
  const actions = await page.evaluate(() => {
    document.querySelector('input[name="status"][value="citizen"]').checked = true;
    document.querySelector('input[name="ssn"][value="yes"]').checked = true;
    document.getElementById("age").value = "20";
    document.querySelector('input[name="marital"][value="single"]').checked = true;
    document.querySelector('input[name="fulltime"][value="yes"]').checked = true;
    document.querySelector('input[name="support"][value="no"]').checked = true;
    document.querySelector('input[name="lived"][value="parents"]').checked = true;
    document.querySelector('input[name="confirmed"][value="no"]').checked = true;
    document.getElementById("w2wage").value = "7840";
    document.getElementById("homestate").value = "MD";
    buildPlan();
    const list = document.getElementById("action-list");
    return { present: !!list, steps: list ? list.querySelectorAll("li").length : 0,
      firstCard: document.getElementById("plan").firstElementChild.id };
  });
  check("The plan opens with the action list", actions.firstCard === "action-list");
  check("The action list has numbered steps", actions.steps >= 4, "steps: " + actions.steps);

  /* Dark mode is where a token-based palette usually breaks: an accent
     that reads as a background in one theme becomes a pale fill with
     white text in the other. These measure the real painted colours. */
  const contrast = await page.evaluate(() => {
    function lum(c) {
      const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function ratio(fg, bg) {
      const a = lum(fg), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }
    function measure() {
      const out = {};
      const body = getComputedStyle(document.body).backgroundColor;
      out.bodyText = ratio(getComputedStyle(document.body).color, body);

      const primary = document.querySelector("[data-next]");
      if (primary) {
        const s = getComputedStyle(primary);
        out.primaryButton = ratio(s.color, s.backgroundColor);
      }
      const accent = document.querySelector(".btn-green") || document.querySelector(".nav-cta");
      if (accent) {
        const s = getComputedStyle(accent);
        out.accentButton = ratio(s.color, s.backgroundColor);
      }
      const panel = document.querySelector(".panel");
      if (panel) {
        const s = getComputedStyle(panel);
        out.panelText = ratio(getComputedStyle(document.body).color, s.backgroundColor);
      }
      return out;
    }
    const results = {};
    document.documentElement.setAttribute("data-theme", "light");
    results.light = measure();
    document.documentElement.setAttribute("data-theme", "dark");
    results.dark = measure();
    document.documentElement.removeAttribute("data-theme");
    return results;
  });

  ["light", "dark"].forEach(function (mode) {
    Object.keys(contrast[mode]).forEach(function (what) {
      const r = contrast[mode][what];
      check(mode + " theme: " + what + " meets 4.5:1 contrast",
        r >= 4.5, "ratio " + r.toFixed(2) + ":1");
    });
  });

  check("A theme control is present", await page.evaluate(() => !!document.getElementById("theme-toggle")));

  /* Light is the default for everyone, including a machine whose system
     preference is dark. This is deliberate: the site is demonstrated on
     projectors and on borrowed laptops, and inheriting dark there once
     produced a washed out, unreadable screen. Dark is reachable only
     through the footer control. */
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  const defaultTheme = await page.evaluate(function () {
    const bg = getComputedStyle(document.body).backgroundColor;
    const match = /(\d+), (\d+), (\d+)/.exec(bg);
    const light = match && Number(match[1]) > 200 && Number(match[2]) > 200;
    return { bg: bg, light: !!light, attr: document.documentElement.getAttribute("data-theme") };
  });
  check("A dark system preference does not darken the site",
    defaultTheme.light, "body background came back " + defaultTheme.bg);
  check("No theme is forced onto the page before anyone picks one",
    defaultTheme.attr === null, "data-theme was " + defaultTheme.attr);

  /* The control still has to work from that same dark-preferring machine. */
  const afterToggle = await page.evaluate(function () {
    document.getElementById("theme-toggle").click();
    return { attr: document.documentElement.getAttribute("data-theme"),
      stored: localStorage.getItem("campusfiling-theme") };
  });
  check("The footer control is the way into dark",
    afterToggle.attr === "dark" && afterToggle.stored === "dark",
    "attribute " + afterToggle.attr + ", stored " + afterToggle.stored);

  await page.emulateMedia({ colorScheme: null });
  await page.evaluate(function () { try { localStorage.clear(); } catch (e) {} });
  await page.reload();

  /* Enter should advance a section, the way any form behaves. */
  const keyed = await page.evaluate(async () => {
    go(0, false);
    document.querySelector('input[name="status"][value="citizen"]').checked = true;
    document.querySelector('input[name="ssn"][value="yes"]').checked = true;
    document.getElementById("age").focus();
    document.getElementById("age").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    return current;
  });
  check("Enter advances to the next section", keyed === 1, "landed on section " + keyed);

  /* Answers round-trip through a saved file, and documents never do. */
  const roundTrip = await page.evaluate(() => {
    go(0, false);
    document.querySelector('input[name="status"][value="citizen"]').checked = true;
    document.getElementById("age").value = "21";
    document.getElementById("w2wage").value = "9100";
    const saved = answersToObject();

    document.getElementById("age").value = "";
    document.getElementById("w2wage").value = "";
    document.querySelector('input[name="status"][value="citizen"]').checked = false;
    applyAnswers(saved);

    return {
      age: document.getElementById("age").value,
      wage: document.getElementById("w2wage").value,
      status: document.querySelector('input[name="status"][value="citizen"]').checked,
      mentionsFiles: JSON.stringify(saved).toLowerCase().indexOf(".pdf") > -1
    };
  });
  check("Saved answers restore exactly", roundTrip.age === "21" && roundTrip.wage === "9100" && roundTrip.status,
    JSON.stringify(roundTrip));
  check("A saved file carries no document contents", roundTrip.mentionsFiles === false);

  /* A file from another tax year must be refused, not silently applied. */
  const wrongYear = await page.evaluate(() => {
    document.getElementById("age").value = "21";
    applyAnswers({ version: 1, taxYear: 1999, fields: { age: "55" }, radios: {}, checks: [] });
    return document.getElementById("age").value;
  });
  check("A saved file from another tax year is refused", wrongYear === "21", "age became " + wrongYear);

  /* Reading a document must also stay local, worker and all. */
  check("Reading a document contacts nothing offsite", offsite.length === 0, offsite.join(" | "));

  /* Every other page, checked the same way. */
  for (const p of ["/index.html", "/privacy.html", "/estimate.html", "/faq.html",
                   "/deadlines.html", "/how-it-works.html", "/about.html",
                   "/guides/index.html", "/guides/documents.html",
                   "/guides/glossary.html", "/guides/international.html"]) {
    offsite.length = 0;
    errors.length = 0;
    await page.goto(base + p, { waitUntil: "networkidle" });
    check(p + " loads clean and contacts nothing offsite",
      errors.length === 0 && offsite.length === 0,
      errors.concat(offsite).join(" | "));
  }

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed.");
  return fail;
}

main().then(function (f) { process.exit(f ? 1 : 0); })
  .catch(function (e) { console.error(e); process.exit(1); });
