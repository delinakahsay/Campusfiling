/* Campus Filing: the end to end flow that matters.
   Run with: node tests-flow.js   (needs: npm install playwright)

   This exists because of a bug that every other suite missed. A student
   uploaded a document, pressed the AI reader, pressed Apply, moved to the
   next section, and found every box empty.

   Nothing had errored. The two readers had disagreed, a disagreement
   arrived unticked by design, and "Apply the ticked amounts" correctly
   applied the nothing that was ticked. Every unit test passed, because
   each piece did exactly what it was told.

   So this suite drives the whole path with the API stubbed: read a
   document, assist it, apply, and then look at the actual input values on
   the sections ahead. The assertion is the one that matters to a person:
   after pressing Apply, are the numbers there. */

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
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", function () { resolve(server); });
  });
}

/* A W-2 laid out the way a real one is: captions on a row, amounts on the
   row beneath, two columns across. */
function w2Pdf() {
  const rows = [
    ["Form W-2 Wage and Tax Statement 2026"],
    ["b Employer identification number (EIN) 53-0196584"],
    ["1 Wages, tips, other compensation", "2 Federal income tax withheld"],
    ["5,000.00", "320.00"],
    ["3 Social security wages", "4 Social security tax withheld"],
    ["5,000.00", "310.00"],
    ["5 Medicare wages and tips", "6 Medicare tax withheld"],
    ["5,000.00", "72.50"],
    ["7 Social security tips", ""],
    ["16 State wages, tips, etc.", "17 State income tax"],
    ["5,000.00", "184.00"]
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
  catch (e) { console.log("SKIP flow tests: playwright is not installed."); return 0; }

  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port;

  let browser;
  try { browser = await chromium.launch(); }
  catch (e) { console.log("SKIP flow tests: no browser available."); server.close(); return 0; }

  const page = await browser.newPage();
  let pass = 0, fail = 0;
  function check(name, ok, detail) {
    if (ok) { console.log("PASS " + name); pass++; }
    else { console.log("FAIL " + name + (detail ? "\n      " + detail : "")); fail++; }
  }

  /* The reader is stubbed. What is under test is the flow around it, and a
     real call would make this suite slow, costly and non deterministic. */
  let stub = { type: "W-2", fields: [], unreadable: false, note: "" };
  await page.route("**/api/read-document", function (route) {
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stub) });
  });

  await page.goto(base + "/app/file.html", { waitUntil: "networkidle" });

  async function runFlow(aiFields) {
    stub = { type: "W-2", fields: aiFields, unreadable: false, note: "" };
    return page.evaluate(async function (pdfText) {
      /* Reset between runs. */
      ["w2wage", "w2fed", "w2state"].forEach(function (id) { document.getElementById(id).value = ""; });
      A.files = [];
      pending = [];

      const file = new File([new Blob([pdfText], { type: "application/pdf" })], "w2.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      handleFiles(dt.files);

      /* Wait for the local read to settle. */
      for (let i = 0; i < 80 && (!A.files[0] || A.files[0].status === "reading"); i++) {
        await new Promise(function (r) { setTimeout(r, 50); });
      }

      await runAssist(A.files[0].id);
      for (let i = 0; i < 80 && A.files[0].assist === "running"; i++) {
        await new Promise(function (r) { setTimeout(r, 50); });
      }

      const beforeApply = {
        rows: pending.length,
        ticked: Array.from(document.querySelectorAll("[data-review]")).filter(function (b) { return b.checked; }).length
      };

      document.getElementById("apply-review").click();

      return {
        beforeApply: beforeApply,
        w2wage: document.getElementById("w2wage").value,
        w2fed: document.getElementById("w2fed").value,
        w2state: document.getElementById("w2state").value
      };
    }, w2Pdf());
  }

  /* The reported bug. The local reader reads 5000 from the page, the AI
     reader reads 500, and the student ends up with empty boxes. */
  const conflict = await runFlow([
    { field: "w2wage", value: 500, confidence: "high", evidence: "5,000.00" },
    { field: "w2fed", value: 320, confidence: "high", evidence: "320.00" }
  ]);

  check("A disagreement still produces rows to apply",
    conflict.beforeApply.rows > 0, JSON.stringify(conflict.beforeApply));
  check("A disagreement arrives ticked so Apply does something",
    conflict.beforeApply.ticked === conflict.beforeApply.rows,
    conflict.beforeApply.ticked + " of " + conflict.beforeApply.rows + " ticked");
  check("After Apply the wage box is filled in",
    conflict.w2wage !== "", "box held \"" + conflict.w2wage + "\"");
  check("The assisted figure is the one that wins a disagreement",
    Number(conflict.w2wage) === 500, "box held " + conflict.w2wage);
  check("Every other box from that document is filled in too",
    conflict.w2fed !== "" && conflict.w2state !== "",
    "fed \"" + conflict.w2fed + "\" state \"" + conflict.w2state + "\"");

  /* Agreement must still work, and must not double the figure. */
  const agreed = await runFlow([
    { field: "w2wage", value: 5000, confidence: "high", evidence: "5,000.00" }
  ]);
  check("Agreement fills the box exactly once",
    Number(agreed.w2wage) === 5000, "box held " + agreed.w2wage);

  /* A document the AI reader declines must still apply the local reading. */
  const aiSilent = await runFlow([]);
  check("A figure the AI reader did not report still applies from the local read",
    Number(aiSilent.w2wage) === 5000, "box held " + aiSilent.w2wage);

  /* Nothing in the interface should name the machinery. */
  const wording = await page.evaluate(function () {
    const html = document.getElementById("review").innerHTML;
    return {
      saysDisagree: /disagree/i.test(html),
      saysLocalReader: /local reader/i.test(html),
      namesBothReaders: /AI reader read/i.test(html)
    };
  });
  check("The review table does not tell the student the readers disagreed",
    !wording.saysDisagree && !wording.namesBothReaders, JSON.stringify(wording));

  await browser.close();
  server.close();
  console.log("\n" + pass + " passed, " + fail + " failed.");
  return fail;
}

main().then(function (fail) { process.exit(fail ? 1 : 0); })
  .catch(function (e) { console.error(e); process.exit(1); });
