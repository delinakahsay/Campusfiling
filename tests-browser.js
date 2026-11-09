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
  /* The full caption set matters. The reader refuses to read a form whose
     printed labels are mostly garbled, on the grounds that it is looking
     at a bad scan, so a fixture carrying only two captions would be
     refused for the right reason and fail the test for the wrong one. */
  const rows = [
    ["Form W-2 Wage and Tax Statement 2026"],
    ["b Employer identification number (EIN) 53-0196584"],
    ["1 Wages, tips, other compensation", "2 Federal income tax withheld"],
    ["45,000.00", "3,200.00"],
    ["3 Social security wages", "4 Social security tax withheld"],
    ["45,000.00", "2,790.00"],
    ["5 Medicare wages and tips", "6 Medicare tax withheld"],
    ["45,000.00", "652.50"],
    ["7 Social security tips", ""],
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

  /* The walkthrough and the estimator are gated behind an account, so a
     signed-out page would redirect before any of these tests could run.
     This stub stands in for the signed-in student.

     It is registered on the context rather than the page on purpose: the
     account tests below register their own page-level /api/auth route and
     then unroute it, and page.unroute does not touch a context route, so
     this one survives to serve the tests that come after them. */
  await page.context().route("**/api/auth", function (route) {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { email: "student@example.edu", createdAt: null } })
    });
  });

  /* Site content, stubbed empty. The real endpoint is covered by
     tests-accounts.js; here every page just needs its fetch to resolve
     so the shipped text renders and nothing logs a failed resource. */
  await page.context().route("**/api/content", function (route) {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ slots: {}, figures: [] }) });
    }
    route.fulfill({ status: 403, contentType: "application/json",
      body: JSON.stringify({ error: "Only the tax content manager can change the site's text." }) });
  });

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
  const requests = [];
  page.on("request", function (r) {
    requests.push(r.url());
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

  /* The assisted reader is opt in, per document, and sends nothing by
     itself. The invariant worth protecting is that reading a document
     locally never calls the API, however the UI around it changes. */
  const assist = await page.evaluate(async (pdfText) => {
    const file = new File([new Blob([pdfText], { type: "application/pdf" })], "optin.pdf", { type: "application/pdf" });
    const res = await readDocument(file);
    return {
      wiredUp: typeof assistedRead === "function" && typeof reconcile === "function",
      kind: assistPayloadKind(res),
      says: assistDescription(res),
      sendsFile: false
    };
  }, w2Pdf());

  check("The assisted reader is present", assist.wiredUp);
  check("A text PDF would send its text, not the file", assist.kind === "text", "kind was " + assist.kind);
  check("The consent wording says what would be sent",
    /text already pulled out/i.test(assist.says || ""), "wording was " + assist.says);

  const apiCalls = requests.filter(function (u) { return /\/api\/read-document/.test(u); });
  check("Reading a document never calls the API on its own",
    apiCalls.length === 0, apiCalls.join(" | "));

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

  /* A deliberate 400 or 401 from /api is logged by the browser as a
     failed resource. Those are the cases under test, not faults. */
  const unexpected = function () {
    return errors.filter(function (e) { return !/status of 40[01] .*\/api\/(auth|plans)/.test(e); });
  };

  /* Accounts, with /api stubbed. The real endpoints are covered by
     tests-accounts.js; this checks the pages drive them correctly and
     still contact nothing offsite while doing it. */
  let signedIn = false;
  let savedBody = null;
  await page.route("**/api/auth", async function (route) {
    const req = route.request();
    if (req.method() === "GET") return route.fulfill({ json: { user: signedIn ? { email: "test@example.edu" } : null } });
    const body = req.postDataJSON();
    if (body.action === "signin") {
      if (body.password !== "practice-pass") return route.fulfill({ status: 400, json: { error: "That email and password do not match an account." } });
      signedIn = true;
      return route.fulfill({ json: { user: { email: body.email } } });
    }
    if (body.action === "signout") { signedIn = false; return route.fulfill({ json: { user: null } }); }
    return route.fulfill({ status: 400, json: { error: "Unknown action." } });
  });
  await page.route("**/api/plans**", async function (route) {
    const req = route.request();
    if (!signedIn) return route.fulfill({ status: 401, json: { error: "Sign in to use saved plans.", signedOut: true } });
    if (req.method() === "PUT") { savedBody = req.postDataJSON(); return route.fulfill({ json: { taxYear: 2026, updatedAt: "2026-11-08T17:00:00Z" } }); }
    if (req.url().indexOf("year=2026") > -1) return route.fulfill({ json: { answers: { version: 1, taxYear: 2026, fields: { age: "33" }, radios: {}, checks: [] } } });
    return route.fulfill({ json: { plans: [{ taxYear: 2026, updatedAt: "2026-11-08T17:00:00Z" }] } });
  });

  offsite.length = 0; errors.length = 0;
  await page.goto(base + "/account.html", { waitUntil: "networkidle" });
  check("Account page shows the sign-in form when signed out",
    await page.isVisible("#auth-form") && !(await page.isVisible("#acct-in")));

  await page.fill("#auth-email", "test@example.edu");
  await page.fill("#auth-password", "wrong-password");
  await page.click("#auth-submit");
  await page.waitForFunction(function () { return document.getElementById("auth-err").textContent.length > 0; });
  check("A wrong password shows the server's plain message",
    (await page.textContent("#auth-err")).indexOf("do not match") > -1);

  await page.fill("#auth-password", "practice-pass");
  await page.click("#auth-submit");
  await page.waitForSelector("#acct-in:not([hidden])");
  check("Signing in shows the email and the saved plans",
    (await page.textContent("#acct-email")) === "test@example.edu" &&
    (await page.getAttribute("#plans-body a", "href")) === "plan.html?year=2026");

  /* Open goes to the summary; editing the answers is its own link, so a
     student returning to re-read the plan is not dropped into section one. */
  check("A saved plan offers the summary first and the walkthrough second",
    (await page.getAttribute("#plans-body a:nth-of-type(1)", "href")) === "plan.html?year=2026" &&
    (await page.getAttribute("#plans-body a:nth-of-type(2)", "href")) === "app/file.html?resume=2026",
    (await page.$$eval("#plans-body a", function (as) { return as.map(function (a) { return a.getAttribute("href"); }).join(" , "); })));
  check("The account page contacts nothing offsite", unexpected().length === 0 && offsite.length === 0, unexpected().concat(offsite).join(" | "));

  offsite.length = 0; errors.length = 0;
  await page.goto(base + "/app/file.html?resume=2026", { waitUntil: "networkidle" });
  await page.waitForFunction(function () { return document.getElementById("age").value === "33"; }, null, { timeout: 5000 }).catch(function () {});
  check("Opening a saved plan restores its answers into the walkthrough",
    (await page.inputValue("#age")) === "33", "age is " + (await page.inputValue("#age")));
  check("The resume parameter is cleared from the address bar", page.url().indexOf("resume") < 0);

  const saved = await page.evaluate(async function () {
    await saveToAccount();
    const note = Array.from(document.querySelectorAll(".save-note")).filter(function (n) { return !n.hidden; })[0];
    return note ? note.textContent : "";
  });
  check("Save to my account sends the walkthrough's own answers object",
    savedBody && savedBody.answers && savedBody.answers.version === 1 && savedBody.answers.fields.age === "33" &&
    JSON.stringify(savedBody).indexOf("files") < 0, JSON.stringify(savedBody).slice(0, 120));
  check("Saving confirms which tax year was saved", saved.indexOf("2026 plan") > -1, saved);

  signedIn = false;
  const signedOutNote = await page.evaluate(async function () {
    await saveToAccount();
    const note = Array.from(document.querySelectorAll(".save-note")).filter(function (n) { return !n.hidden; })[0];
    return note ? note.innerHTML : "";
  });
  check("Saving while signed out explains it and links to sign in in a new tab",
    signedOutNote.indexOf("account.html?from=save") > -1 && signedOutNote.indexOf('target="_blank"') > -1, signedOutNote);
  check("The walkthrough's account features contact nothing offsite", unexpected().length === 0 && offsite.length === 0, unexpected().concat(offsite).join(" | "));
  await page.unroute("**/api/auth");
  await page.unroute("**/api/plans**");

  /* ---------- the account gate on the two tools ----------

     Page-level routes here, so each one overrides the signed-in context
     stub for the duration of its own check and is removed after. */

  async function withAuth(status, body, fn) {
    await page.route("**/api/auth", function (route) {
      route.fulfill({ status: status, contentType: "application/json", body: JSON.stringify(body) });
    });
    try { await fn(); } finally { await page.unroute("**/api/auth"); }
  }

  await withAuth(200, { user: null }, async function () {
    await page.goto(base + "/app/file.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    check("A signed-out student is sent from the walkthrough to sign-in",
      page.url().indexOf("/account.html?next=%2Fapp%2Ffile.html") > -1, page.url());
  });

  await withAuth(200, { user: null }, async function () {
    await page.goto(base + "/estimate.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    check("A signed-out student is sent from the estimator to sign-in",
      page.url().indexOf("/account.html?next=%2Festimate.html") > -1, page.url());
  });

  await withAuth(200, { user: { email: "student@example.edu" } }, async function () {
    await page.goto(base + "/app/file.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    check("A signed-in student reaches the walkthrough itself",
      page.url().indexOf("/app/file.html") > -1 && await page.locator("#p0").isVisible(), page.url());
  });

  /* A failed check must not quietly open the tool, and must not bounce
     the student to a sign-in page that is equally unreachable. */
  await withAuth(503, { error: "down" }, async function () {
    await page.goto(base + "/app/file.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const stayed = page.url().indexOf("/app/file.html") > -1;
    const hidden = !(await page.locator("#p0").isVisible());
    const told = await page.locator("#gate-msg").count() === 1;
    check("An unreachable account service shuts the tool and says so",
      stayed && hidden && told, "stayed=" + stayed + " hidden=" + hidden + " told=" + told);
  });

  /* Arriving from a gated tool, the form should open on create rather
     than sign in. It regressed once because signedOut() resets the mode
     and ran after the parameter was read. */
  await withAuth(200, { user: null }, async function () {
    await page.goto(base + "/account.html?next=%2Fapp%2Ffile.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const button = (await page.locator("#acct-out button[type=submit]").first().innerText()).toLowerCase();
    const said = (await page.locator("#acct-status").innerText()).toLowerCase();
    check("A student sent here by a gated tool lands on create, not sign in",
      button.indexOf("create") > -1 && said.indexOf("need an account") > -1,
      "button=" + button + " status=" + said);
  });

  /* ---------- the staff dashboard ---------- */

  const GW = {
    institution: "George Washington University",
    enrollment: 25374, students: 412, plans: 286, documentsRead: 931,
    lastActivity: "2026-11-08T18:00:00Z"
  };
  const HOWARD = {
    institution: "Howard University",
    enrollment: 9689, students: 77, plans: 40, documentsRead: 122, lastActivity: null
  };

  async function asRole(user, usage, usageStatus, fn) {
    await page.route("**/api/auth", function (route) {
      route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ user: user }) });
    });
    await page.route("**/api/usage", function (route) {
      route.fulfill({ status: usageStatus, contentType: "application/json",
        body: JSON.stringify(usageStatus === 200 ? usage
          : { error: "This page is for Campus Filing staff." }) });
    });
    try { await fn(); }
    finally { await page.unroute("**/api/auth"); await page.unroute("**/api/usage"); }
  }

  const TAXOPS = { email: "ops@example.com", role: "tax_operations", institution: null };
  const ADMIN = { email: "admin@example.com", role: "university_admin", institution: GW.institution };
  const STUDENT = { email: "s@gwmail.gwu.edu", role: "student", institution: GW.institution, name: "Sam Kettle" };

  await asRole(TAXOPS, { institutions: [GW, HOWARD] }, 200, async function () {
    await page.goto(base + "/dashboard.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const rows = await page.locator("#dash-rows tr").count();
    const students = await page.locator("#dash-totals .stat .value").first().innerText();
    check("Tax content manager sees every institution, totalled",
      rows === 2 && students === "489", "rows=" + rows + " students=" + students);
  });

  await asRole(ADMIN, { institutions: [GW] }, 200, async function () {
    await page.goto(base + "/dashboard.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const title = await page.locator("#dash-title").innerText();
    const tableShown = await page.locator("#dash-table-wrap").isVisible();
    check("A university administrator sees their own institution and no table",
      title === GW.institution && !tableShown, "title=" + title + " table=" + tableShown);
  });

  /* The refusal comes from the database, which the stub stands in for.
     What matters here is that the page shows no figures when refused. */
  await asRole(STUDENT, null, 403, async function () {
    await page.goto(base + "/dashboard.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const totals = await page.locator("#dash-totals").isVisible();
    const said = await page.locator("#dash-status").innerText();
    check("A student on the dashboard is refused and shown no figures",
      !totals && /staff/i.test(said), "totals=" + totals + " said=" + said);
  });

  await asRole(null, null, 403, async function () {
    await page.goto(base + "/dashboard.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    check("A signed-out visitor to the dashboard is sent to sign in",
      page.url().indexOf("/account.html?next=") > -1, page.url());
  });

  /* ---------- auth-aware navigation ---------- */

  await asRole(STUDENT, { institutions: [GW] }, 200, async function () {
    await page.goto(base + "/index.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const initials = await page.locator(".nav-initials").innerText();
    const href = await page.getAttribute(".nav-initials", "href");
    const out = await page.locator(".nav-signout").count();
    check("A signed-in student sees their initials, linked to their account, and a way out",
      initials === "SK" && /account\.html$/.test(href || "") && out === 1,
      "initials=" + initials + " href=" + href + " signout=" + out);
  });

  /* No name on the account: the address stands in, so the header never
     shows an empty circle while someone is signed in. */
  await asRole({ email: "nobody@gwmail.gwu.edu", role: "student", institution: GW.institution },
    { institutions: [GW] }, 200, async function () {
      await page.goto(base + "/index.html", { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const initials = await page.locator(".nav-initials").innerText();
      check("A student with no name saved still gets an initial", initials === "N", initials);
    });

  await asRole(null, null, 403, async function () {
    await page.goto(base + "/index.html", { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const account = await page.locator('nav.site-nav a[href$="account.html"]').innerText();
    const out = await page.locator(".nav-signout").count();
    check("A signed-out visitor is offered a way in and no way out",
      account === "Sign in" && out === 0, "account=" + account + " signout=" + out);
  });

  /* The reference pages are deliberately not gated. */
  await withAuth(200, { user: null }, async function () {
    for (const open of ["/guides/glossary.html", "/deadlines.html", "/privacy.html"]) {
      await page.goto(base + open, { waitUntil: "networkidle" });
      await page.waitForTimeout(250);
      check(open + " stays open without an account", page.url().indexOf(open) > -1, page.url());
    }
  });

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
