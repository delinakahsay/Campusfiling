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
  item("5 Medicare wages and tips", 20, 635),
  item("6 Medicare tax withheld", 300, 635),
  item("45,000.00", 20, 620),
  item("652.50", 300, 620),
  item("b Employer identification number (EIN) 53-0196584", 20, 730),
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
    item("b Employer identification number (EIN) 53-0196584", 20, 730),
    item("1 Wages, tips, other compensation", 20, 700),
    item("7840", 20, 685),
    item("2 Federal income tax withheld", 300, 700),
    item("3 Social security wages", 20, 660),
    item("4 Social security tax withheld", 300, 660),
    item("5 Medicare wages and tips", 20, 635),
    item("6 Medicare tax withheld", 300, 635),
    item("16 State wages, tips, etc.", 20, 610),
    item("17 State income tax", 300, 610)
  ]);
  const r = readLines(plain, "w2.pdf");
  assert.equal(found(r, "w2wage"), 7840);
  assert.equal(r.found[0].confidence, "low");
  assert.ok(/low confidence/i.test(r.note || ""), "the note should say so");
});

/* ---------- classification against real document wording ----------

   Every case below is a line lifted from a document a student actually
   uploaded, and every one of them defeated the first classifier. The
   pattern is always the same: the document names a different form in its
   IRS instruction boilerplate, and a search for a name anywhere in the
   text found that one first. W-2 was first in the list, so a 1099-NEC, a
   brokerage package and a 1095-B all came back as W-2 or 1095-A. */

test("A 1099-NEC is not a W-2 because its instructions mention one", () => {
  const nec = itemsToLines([
    item("Form 1099-NEC Nonemployee Compensation OMB No. 1545-0116", 20, 760),
    item("1 Nonemployee compensation", 20, 700),
    item("5,000.00", 20, 685),
    item("4 Federal income tax withheld", 300, 700),
    item("Instructions for Recipient", 20, 400),
    item("You received this form instead of Form W-2 because the payer did not", 20, 385),
    item("consider you an employee and did not withhold income tax.", 20, 372)
  ]);
  const r = readLines(nec, "Extern 1099.pdf");
  assert.equal(r.type, "1099-NEC");
  assert.equal(found(r, "segross"), 5000);
});

test("A 1095-B is not a 1095-A because its instructions name one", () => {
  const b = itemsToLines([
    item("Form 1095-B (2025) Health Coverage OMB No. 1545-2252", 20, 760),
    item("Instructions for Recipient", 20, 700),
    item("If you or another family member received health insurance coverage", 20, 685),
    item("through a Health Insurance Marketplace, that coverage will generally", 20, 672),
    item("be reported on a Form 1095-A rather than a Form 1095-B.", 20, 659)
  ]);
  const r = readLines(b, "2025 - Form 1095-B - Health Coverage.pdf");
  assert.equal(r.type, "1095-B");
  assert.equal(r.found.length, 0, "a 1095-B has nothing to fill in");
  assert.ok(/do not need it to file/i.test(r.note || ""), "it should say the form is not needed to file");
});

test("A consolidated brokerage 1099 is identified as one, not as a W-2", () => {
  const consolidated = itemsToLines([
    item("2025 Consolidated Form 1099", 20, 760),
    item("Form 1099-INT Interest Income OMB No. 1545-0112", 20, 720),
    item("Form 1099-DIV Dividends and Distributions OMB No. 1545-0110", 20, 700),
    item("Form 1099-B Proceeds From Broker Transactions OMB No. 1545-0715", 20, 680),
    item("the option that was reported to you on a Form W-2. If box 5 is", 20, 400)
  ]);
  const r = readLines(consolidated, "Robinhood Markets Consolidated Form 1099.pdf");
  assert.equal(r.type, "Consolidated 1099");
  assert.equal(r.found.length, 0, "nothing from a consolidated package should be auto filled");
  assert.ok(/import/i.test(r.note || ""), "it should say to import rather than retype");
  assert.ok(r.parts.indexOf("1099-INT") > -1 && r.parts.indexOf("1099-B") > -1,
    "it should list what is inside: got " + r.parts.join(", "));
});

test("A standalone 1099-INT still reads normally", () => {
  const int = itemsToLines([
    item("OMB No. 1545-0112 Form 1099-INT Interest Income", 20, 760),
    item("1 Interest income", 20, 700),
    item("13.10", 20, 685),
    item("2 Early withdrawal penalty", 300, 700),
    item("4 Federal income tax withheld", 20, 660)
  ]);
  const r = readLines(int, "statement.pdf");
  assert.equal(r.type, "1099-INT");
  assert.equal(found(r, "interest"), 13.1);
});

/* ---------- identifiers are not amounts ----------

   GW's W-2 emits its text layer right to left, which put the line
   "OMB No. 1545-0029 ***-**-7795 Import Code: 3UEPJ96J" directly beneath
   the wages caption. The reader returned 1545 as wages. */

test("An OMB control number beneath a caption is not read as wages", () => {
  const mirrored = itemsToLines([
    item("Form W-2 Wage and Tax Statement", 20, 760),
    item("Federal income tax withheld 2 Wages, tips, other compensation 1 Employer identification number (EIN) b", 20, 700),
    item("OMB No. 1545-0029 ***-**-7795 Import Code: 3UEPJ96J", 20, 685),
    item("Social security tax withheld 4 Social security wages 3", 20, 660),
    item("Medicare tax withheld 6 Medicare wages and tips 5", 20, 635),
    item("State income tax 17 State wages, tips, etc. 16", 20, 610)
  ]);
  const r = readLines(mirrored, "GW W2.pdf");
  assert.equal(r.type, "W-2");
  assert.equal(found(r, "w2wage"), null, "the OMB number must not become a wage figure");
  r.found.forEach(function (f) {
    assert.notEqual(f.value, 1545, f.label + " picked up the OMB control number");
    assert.notEqual(f.value, 29, f.label + " picked up half of the OMB control number");
  });
});

test("An employer identification number is not read as money", () => {
  const c = moneyCandidates("b Employer identification number (EIN) 53-0196584");
  assert.equal(c.length, 0, "an EIN came back as " + c.map(function (x) { return x.value; }).join(", "));
});

/* ---------- a recognised scan is refused rather than guessed at ----------

   A W-2 scanned and run through character recognition came back with
   captions like "1 Wege&, tips, othff comp." and "S Medicert weges end
   tips". The digits carry the same noise, and the reader returned 111 for
   federal tax withheld on a form whose boxes read 354.65 and blank. */

test("A garbled recognition layer produces no figures at all", () => {
  const scanned = itemsToLines([
    item("2025 W-2 and EARNINGS SUMMARY", 20, 760),
    item("1 Wege&, tips, othff comp. 2 Feder el income tax withheld", 20, 700),
    item("354.65", 20, 685),
    item("3 Soclel security wages 4 Social security tax withheld", 20, 660),
    item("354.65 21.99", 20, 645),
    item("S Medicert weges end tips 6 Medicare tax withheld", 20, 620),
    item("354.65 11 354.65 I 354.65", 20, 605)
  ]);
  const r = readLines(scanned, "W2 AE.pdf");
  assert.equal(r.type, "W-2", "it is still recognisable as a W-2");
  assert.equal(r.found.length, 0, "but no figure from it is trustworthy");
  assert.ok(r.needsManual);
  assert.ok(/character recognition/i.test(r.note || ""), "the note should explain why");
});

test("A clean W-2 is not mistaken for a bad scan", () => {
  const r = readLines(w2Real, "w2.pdf");
  assert.equal(found(r, "w2wage"), 45000, "a clean form must still read");
  assert.ok(!/character recognition/i.test(r.note || ""));
});

console.log("\n" + pass + " passed, " + fail + " failed.");
process.exit(fail ? 1 : 0);
