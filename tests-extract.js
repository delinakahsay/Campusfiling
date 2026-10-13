/* Campus Filing: document reader tests.
   Run with: node tests-extract.js

   These exercise the part of the reader that turns positioned text into
   figures. pdf.js itself is not run here; its output shape is, which is
   where every misread we have seen actually came from.

   The W-2 cases are the important ones. A real W-2 prints captions on one
   row and amounts on the row beneath, and the previous reader flattened
   the page and took the first number after a caption. On the layout in
   `w2Real` below that returned 2 as the wage figure, picked up from the
   caption "2 Federal income tax withheld". */

const assert = require("assert");
const { itemsToLines, readLines, moneyCandidates } = require("./assets/js/extract.js");

let pass = 0, fail = 0;

function test(name, fn) {
  try { fn(); console.log("PASS " + name); pass++; }
  catch (e) { console.log("FAIL " + name + "\n      " + e.message); fail++; }
}

/* A text item in the shape pdf.js produces. */
function item(str, x, y, w) {
  return { str: str, transform: [1, 0, 0, 1, x, y], width: w === undefined ? str.length * 4.6 : w };
}

function found(result, field) {
  const hit = result.found.filter(function (f) { return f.field === field; })[0];
  return hit ? hit.value : null;
}

/* ---------- a W-2 drawn the way the IRS draws one ---------- */

const w2Real = itemsToLines([
  item("Form W-2 Wage and Tax Statement 2026", 20, 760),
  item("1 Wages, tips, other compensation", 20, 700),
  item("2 Federal income tax withheld", 300, 700),
  item("45,000.00", 20, 685),
  item("3,200.00", 300, 685),
  item("3 Social security wages", 20, 660),
  item("4 Social security tax withheld", 300, 660),
  item("45,000.00", 20, 645),
  item("2,790.00", 300, 645),
  item("16 State wages, tips, etc.", 20, 610),
  item("17 State income tax", 300, 610),
  item("45,000.00", 20, 595),
  item("1,842.00", 300, 595)
]);

test("W-2 wages come from the column beneath the caption, not the next caption", () => {
  const r = readLines(w2Real, "w2.pdf");
  assert.equal(r.type, "W-2");
  assert.equal(found(r, "w2wage"), 45000);
});

test("W-2 federal withholding is read from its own column", () => {
  assert.equal(found(readLines(w2Real, "w2.pdf"), "w2fed"), 3200);
});

test("W-2 state withholding is read from its own column", () => {
  assert.equal(found(readLines(w2Real, "w2.pdf"), "w2state"), 1842);
});

test("No W-2 figure is ever a single digit box number", () => {
  const r = readLines(w2Real, "w2.pdf");
  r.found.forEach(function (f) {
    assert.ok(Math.abs(f.value) >= 100, f.label + " came back as " + f.value + ", which is a box number, not money");
  });
});

/* ---------- a 1098-T, where the amount sits to the right ---------- */

const t1098 = itemsToLines([
  item("Form 1098-T Tuition Statement", 20, 760),
  item("1 Payments received for qualified tuition and related expenses", 20, 700),
  item("$ 28,450.00", 420, 700),
  item("5 Scholarships or grants", 20, 660),
  item("$ 31,200.00", 420, 660)
]);

test("1098-T reads amounts printed to the right of the caption", () => {
  const r = readLines(t1098, "1098t.pdf");
  assert.equal(r.type, "1098-T");
  assert.equal(found(r, "tuition"), 28450);
  assert.equal(found(r, "scholarship"), 31200);
});

/* ---------- a value must not be borrowed from the next box ---------- */

const crowded = itemsToLines([
  item("1099-INT Interest Income", 20, 760),
  item("1 Interest income", 20, 700),
  item("2 Early withdrawal penalty 45.00", 300, 700)
]);

test("An empty box does not borrow the neighbouring box's amount", () => {
  const r = readLines(crowded, "1099int.pdf");
  assert.equal(found(r, "interest"), null);
  assert.ok(r.needsManual, "an unreadable form should ask for manual entry");
});

/* ---------- money token rules ---------- */

test("Bare small integers are not treated as money", () => {
  assert.equal(moneyCandidates("1 2 17 45").length, 0);
});

test("Formatted amounts and large bare integers are treated as money", () => {
  assert.deepEqual(moneyCandidates("45,000.00").map(c => c.value), [45000]);
  assert.deepEqual(moneyCandidates("7840").map(c => c.value), [7840]);
});

test("Parenthesised amounts are read as negative", () => {
  assert.deepEqual(moneyCandidates("(1,250.00)").map(c => c.value), [-1250]);
});

/* ---------- an unrecognised document is refused, not guessed at ---------- */

test("An unrecognised document is refused rather than guessed at", () => {
  const r = readLines(itemsToLines([item("Lease agreement for 14 Elm Street", 20, 700)]), "lease.pdf");
  assert.equal(r.type, null);
  assert.equal(r.found.length, 0);
  assert.ok(r.needsManual);
});

/* ---------- low confidence is surfaced, not hidden ---------- */

test("An unformatted figure is flagged as low confidence", () => {
  const plain = itemsToLines([
    item("W-2 Wage and Tax Statement", 20, 760),
    item("1 Wages, tips, other compensation", 20, 700),
    item("7840", 20, 685)
  ]);
  const r = readLines(plain, "w2.pdf");
  assert.equal(found(r, "w2wage"), 7840);
  assert.equal(r.found[0].confidence, "low");
  assert.ok(/low confidence/i.test(r.note || ""), "the note should say so");
});

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
