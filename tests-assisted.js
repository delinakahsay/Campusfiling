/* Campus Filing: reconciliation tests.
   Run with: node tests-assisted.js

   Two readers run on every document: the deterministic one in extract.js
   and the model-assisted one behind /api/read-document. What matters is
   not either reader on its own but the rule for believing them, which is
   reconcile() in assets/js/assisted.js.

   The rule exists because the two fail differently. The local reader
   fails loudly: no match, nothing proposed. A model fails quietly: a
   plausible figure in the right box with nothing to mark it wrong. So a
   figure only arrives pre-ticked when something corroborates it, and a
   disagreement is never resolved silently.

   No network here. The API response shape is what is exercised. */

const assert = require("assert");
const { reconcile, sameAmount, assistPayloadKind, assistDescription,
  assistSupportsFile } = require("./assets/js/assisted.js");

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log("PASS " + name); pass++; }
  catch (e) { console.log("FAIL " + name + "\n      " + e.message); fail++; }
}

function row(rows, field) {
  return rows.filter(function (r) { return r.field === field; })[0];
}

function local(found) { return { found: found, type: "W-2" }; }
function ai(fields) { return { fields: fields, unreadable: false, note: "" }; }

/* ---------- agreement ---------- */

test("Two readers agreeing raises the figure to high confidence", () => {
  const rows = reconcile(
    local([{ field: "w2wage", label: "Box 1, wages", value: 45000, confidence: "medium" }]),
    ai([{ field: "w2wage", value: 45000, confidence: "high", evidence: "45,000.00" }])
  );
  const r = row(rows, "w2wage");
  assert.equal(r.source, "agreed");
  assert.equal(r.confidence, "high");
  assert.equal(r.ticked, true);
});

test("Agreement survives a rounding difference of a cent", () => {
  const rows = reconcile(
    local([{ field: "interest", label: "Box 1", value: 13.1, confidence: "high" }]),
    ai([{ field: "interest", value: 13.10, confidence: "high", evidence: "13.10" }])
  );
  assert.equal(row(rows, "interest").source, "agreed");
});

test("A dollar apart is not agreement", () => {
  assert.ok(!sameAmount(13.1, 14.1));
  assert.ok(sameAmount(13.1, 13.1));
});

/* ---------- the local reader could not do it ---------- */

test("Where the local reader found nothing, the AI figure stands and is ticked", () => {
  const rows = reconcile(
    { found: [], type: "W-2", needsManual: true },
    ai([{ field: "w2wage", value: 354.65, confidence: "high", evidence: "354.65" }])
  );
  const r = row(rows, "w2wage");
  assert.equal(r.source, "assisted");
  assert.equal(r.value, 354.65);
  assert.equal(r.ticked, true);
});

test("An AI figure keeps the confidence the model reported", () => {
  const rows = reconcile(
    { found: [], type: "W-2" },
    ai([{ field: "w2fed", value: 0, confidence: "low", evidence: "blank" }])
  );
  assert.equal(row(rows, "w2fed").confidence, "low");
});

test("A field only the AI reader knows still gets a readable label", () => {
  const rows = reconcile(
    { found: [], type: "1098-E" },
    ai([{ field: "loanint", value: 612.4, confidence: "high", evidence: "612.40" }])
  );
  assert.ok(/student loan interest/i.test(row(rows, "loanint").label),
    "got label: " + row(rows, "loanint").label);
});

/* ---------- the AI reader declined ---------- */

test("Where the AI reader reported nothing, the local figure stands", () => {
  const rows = reconcile(
    local([{ field: "w2wage", label: "Box 1, wages", value: 45000, confidence: "high" }]),
    ai([])
  );
  const r = row(rows, "w2wage");
  assert.equal(r.source, "local");
  assert.equal(r.ticked, true);
});

test("A low confidence local figure with no corroboration stays unticked", () => {
  const rows = reconcile(
    local([{ field: "w2wage", label: "Box 1, wages", value: 1545, confidence: "low" }]),
    ai([])
  );
  assert.equal(row(rows, "w2wage").ticked, false);
});

/* ---------- disagreement, the case the whole design exists for ---------- */

test("Two readers disagreeing applies neither figure", () => {
  const rows = reconcile(
    local([{ field: "w2wage", label: "Box 1, wages", value: 1545, confidence: "low" }]),
    ai([{ field: "w2wage", value: 45000, confidence: "high", evidence: "45,000.00" }])
  );
  const r = row(rows, "w2wage");
  assert.equal(r.source, "conflict");
  assert.equal(r.ticked, false, "a disagreement must never be pre-ticked");
});

test("A disagreement carries both figures so the person can see them", () => {
  const rows = reconcile(
    local([{ field: "w2wage", label: "Box 1, wages", value: 1545, confidence: "low" }]),
    ai([{ field: "w2wage", value: 45000, confidence: "high", evidence: "45,000.00" }])
  );
  const r = row(rows, "w2wage");
  assert.equal(r.value, 1545, "the local figure");
  assert.equal(r.other, 45000, "the AI figure");
});

test("A confident AI figure does not override a confident local one", () => {
  const rows = reconcile(
    local([{ field: "w2wage", label: "Box 1, wages", value: 45000, confidence: "high" }]),
    ai([{ field: "w2wage", value: 54000, confidence: "high", evidence: "54,000.00" }])
  );
  assert.equal(row(rows, "w2wage").source, "conflict",
    "two high confidence readers disagreeing is still a disagreement");
  assert.equal(row(rows, "w2wage").ticked, false);
});

/* ---------- several boxes at once ---------- */

test("Each box is reconciled on its own", () => {
  const rows = reconcile(
    local([
      { field: "w2wage", label: "Box 1", value: 45000, confidence: "high" },
      { field: "w2fed", label: "Box 2", value: 111, confidence: "low" }
    ]),
    ai([
      { field: "w2wage", value: 45000, confidence: "high", evidence: "45,000.00" },
      { field: "w2fed", value: 3200, confidence: "high", evidence: "3,200.00" },
      { field: "w2state", value: 1842, confidence: "medium", evidence: "1,842.00" }
    ])
  );
  assert.equal(rows.length, 3);
  assert.equal(row(rows, "w2wage").source, "agreed");
  assert.equal(row(rows, "w2fed").source, "conflict");
  assert.equal(row(rows, "w2state").source, "assisted");
});

test("Nothing from either reader produces no rows at all", () => {
  assert.equal(reconcile({ found: [] }, ai([])).length, 0);
});

/* ---------- what the consent button would send ---------- */

test("A PDF with text sends its text, never the file", () => {
  const res = { text: "Form W-2 Wage and Tax Statement ".repeat(4), isImage: false, scanned: false };
  assert.equal(assistPayloadKind(res), "text");
  assert.ok(/text already pulled out/i.test(assistDescription(res)));
});

test("A scanned PDF sends a rendered page, and says so", () => {
  const res = { text: "", isImage: false, scanned: true };
  assert.equal(assistPayloadKind(res), "render");
  assert.ok(/picture of this page/i.test(assistDescription(res)));
});

test("A photo sends the photo, and says so", () => {
  const res = { text: "", isImage: true, scanned: false };
  assert.equal(assistPayloadKind(res), "image");
  assert.ok(/this photo/i.test(assistDescription(res)));
});

test("A document with nothing to send offers no button", () => {
  assert.equal(assistPayloadKind({ text: "", isImage: false, scanned: false }), null);
  assert.equal(assistDescription({ text: "", isImage: false, scanned: false }), null);
});

test("HEIC is refused rather than sent as something no reader can open", () => {
  assert.ok(!assistSupportsFile({ name: "IMG_0431.HEIC" }));
  assert.ok(assistSupportsFile({ name: "w2.png" }));
});

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
