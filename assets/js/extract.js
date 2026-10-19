/* Campus Filing: real document reading.

   PDFs from payroll portals, bursar systems and brokerages are almost
   always digital, meaning they carry a real text layer. We pull that text
   out with pdf.js and look for the labelled amounts. That is genuine
   extraction, not a filename lookup.

   Why this reads geometry rather than flat text
   ---------------------------------------------
   The first version of this file flattened every page to one string and
   took the first number that appeared after a label. On a real W-2 that
   is wrong, because the form prints its labels in one row and its values
   in the row beneath:

       1 Wages, tips, other compensation   2 Federal income tax withheld
       45,000.00                           3,200.00

   Flattened, the text after "Wages, tips, other compensation" begins
   "2 Federal income tax withheld", so the reader returned 2 as the wage
   figure. A tested sample came back as $2 instead of $45,000. That is the
   misread behind the report that W-2 income was heavily incorrect.

   So every text item is kept with its coordinates, items are grouped into
   lines, and a value is looked for in the label's own column on the lines
   below it before anything to its right is considered. Numbers that are
   really box numbers are rejected outright.

   What this still cannot do: photographs and scans have no text layer.
   There is no OCR here. Those files are accepted, listed, and the user is
   told plainly to type the figures from them.

   Nothing extracted is ever written straight into an answer. Every value
   goes to a review table first and the user confirms it against the
   paper. A silent wrong number is worse than no number. */

/* pdf.js is served from this site rather than a CDN. Two reasons, and
   both are the point of the project:

   1. The privacy page promises that reading a document contacts nothing.
      A CDN request is a contact, and it tells Cloudflare which visitor
      opened a tax tool and when.
   2. Campus and corporate networks block CDNs often enough that the
      upload feature would fail for exactly the students least able to
      work out why.

   The version here is pdfjs-dist 3.11.174, under assets/vendor/pdfjs,
   Apache 2.0, licence alongside it. Updating it is a deliberate act. */

const PDFJS_BASE = (function () {
  if (typeof document === "undefined") return "";
  const s = document.currentScript;
  if (s && s.src) return s.src.replace(/js\/extract\.js.*$/, "vendor/pdfjs/");
  return "/assets/vendor/pdfjs/";
})();

const PDFJS_SRC = PDFJS_BASE + "pdf.min.js";
const PDFJS_WORKER = PDFJS_BASE + "pdf.worker.min.js";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 8;

let pdfjsPromise = null;

function loadPdfJs() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = PDFJS_SRC;
    s.onload = function () {
      if (!window.pdfjsLib) { reject(new Error("pdf.js did not load")); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = function () { pdfjsPromise = null; reject(new Error("the PDF reader could not be loaded")); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

/* ---------- page to lines ----------

   Each line is { y, items: [{ x, w, str }], text, offsets: [...] }.
   offsets[i] is the character index in `text` where items[i] begins, which
   is what lets a label found by regex be traced back to an x position. */

const LINE_TOLERANCE = 3;

function itemsToLines(items) {
  const placed = [];

  items.forEach(function (it) {
    const str = (it.str || "");
    if (!str.trim()) return;
    const t = it.transform || [1, 0, 0, 1, 0, 0];
    const x = t[4], y = t[5];
    let line = null;
    for (const cand of placed) {
      if (Math.abs(cand.y - y) <= LINE_TOLERANCE) { line = cand; break; }
    }
    if (!line) { line = { y: y, items: [] }; placed.push(line); }
    line.items.push({ x: x, w: it.width || 0, str: str });
  });

  placed.sort(function (a, b) { return b.y - a.y; });

  placed.forEach(function (line) {
    line.items.sort(function (a, b) { return a.x - b.x; });
    let text = "";
    line.offsets = [];
    line.items.forEach(function (item, i) {
      if (i > 0) text += " ";
      line.offsets.push(text.length);
      text += item.str;
    });
    line.text = text;
  });

  return placed;
}

async function pdfLines(file) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const pages = Math.min(doc.numPages, MAX_PAGES);
  let all = [];
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const lines = itemsToLines(content.items);
    lines.forEach(function (l) { l.page = i; });
    all = all.concat(lines);
  }
  return all;
}

/* ---------- classification ----------

   The first version searched the whole document for a form name and took
   the first hit. That fails on every real tax document, because every one
   of them ships with the IRS "Instructions for Recipient" boilerplate,
   and that boilerplate names other forms:

     1099-NEC: "You received this form instead of Form W-2 because..."
     1099-B:   "...the option that was reported to you on a Form W-2."
     1095-B:   "...will generally be reported on Form 1095-A rather than
                a Form 1095-B."

   W-2 was first in the list, so a 1099-NEC, a consolidated brokerage 1099
   and a 1095-B all classified as W-2 or 1095-A. The name was never the
   document's own; it was the document telling you about a different one.

   Evidence is weighted instead:

     OMB control number  strongest. Printed in the form's own header block
                         and essentially never in prose about other forms.
     Title phrase        strong. "Wage and Tax Statement" in the header.
     Bare name in prose  weak, and discarded outright when the words just
                         before it point somewhere else.

   A brokerage consolidated 1099 carries several of these at full strength
   at once, which is how it is detected rather than flattened to whichever
   section happened to be printed first. */

const OMB_FORMS = {
  "1545-0008": "W-2", "1545-0029": "W-2",
  "1545-1574": "1098-T", "1545-1576": "1098-E",
  "1545-0116": "1099-NEC", "1545-0115": "1099-MISC",
  "1545-0112": "1099-INT", "1545-0110": "1099-DIV",
  "1545-0715": "1099-B", "1545-0117": "1099-OID",
  "1545-2205": "1099-K", "1545-0120": "1099-G",
  "1545-0119": "1099-R", "1545-2896": "1099-DA",
  "1545-2232": "1095-A", "1545-2252": "1095-B", "1545-2251": "1095-C",
  "1545-0096": "1042-S"
};

const OMB_TOKEN = /15\d\d-\d{4}/g;

/* The header line a form prints about itself. */
const TITLE_SIGNATURES = [
  { type: "W-2", test: /Wage and Tax Statement|W-2 and EARNINGS SUMMARY/i },
  { type: "1098-T", test: /Tuition Statement/i },
  { type: "1098-E", test: /Student Loan Interest Statement/i },
  { type: "1099-NEC", test: /Nonemployee Compensation/i },
  { type: "1099-MISC", test: /Miscellaneous Information|Miscellaneous Income/i },
  { type: "1099-K", test: /Payment Card and Third Party Network Transactions/i },
  { type: "1099-INT", test: /\bInterest Income\b/i },
  { type: "1099-DIV", test: /Dividends and Distributions/i },
  { type: "1099-B", test: /Proceeds From Broker/i },
  { type: "1099-G", test: /Certain Government Payments/i },
  { type: "1099-R", test: /Distributions From Pensions/i },
  { type: "1095-A", test: /Health Insurance Marketplace Statement/i },
  { type: "1095-B", test: /Health Coverage\b/i },
  { type: "1095-C", test: /Employer-Provided Health Insurance Offer/i },
  { type: "1042-S", test: /Foreign Person'?s U\.?S\.? Source Income/i }
];

/* The bare name, wherever it appears. Weak on its own. */
const NAME_SIGNATURES = [
  { type: "W-2", test: /\bW-?2\b/gi },
  { type: "1098-T", test: /\b1098-?T\b/gi },
  { type: "1098-E", test: /\b1098-?E\b/gi },
  { type: "1099-NEC", test: /\b1099-?NEC\b/gi },
  { type: "1099-MISC", test: /\b1099-?MISC\b/gi },
  { type: "1099-K", test: /\b1099-?K\b/gi },
  { type: "1099-INT", test: /\b1099-?INT\b/gi },
  { type: "1099-DIV", test: /\b1099-?DIV\b/gi },
  { type: "1099-B", test: /\b1099-?B\b/gi },
  { type: "1099-OID", test: /\b1099-?OID\b/gi },
  { type: "1099-G", test: /\b1099-?G\b/gi },
  { type: "1099-R", test: /\b1099-?R\b/gi },
  { type: "1099-DA", test: /\b1099-?DA\b/gi },
  { type: "1095-A", test: /\b1095-?A\b/gi },
  { type: "1095-B", test: /\b1095-?B\b/gi },
  { type: "1095-C", test: /\b1095-?C\b/gi },
  { type: "1042-S", test: /\b1042-?S\b/gi }
];

/* Wording that makes the following form name somebody else's. Tested
   against the text immediately before the match. */
const CROSS_REFERENCE =
  /(instead of|rather than|in place of|in lieu of|replaces?|replaced by|will replace|see|refer to|reported (?:to you )?on|report(?:ed|s)? on|may be reported on|will be reported on|not reported on|combined (?:with|into)|along with|as well as|also receive|receive a|attach(?:ed)? to)\s+(a |an |the |your |new )*(Forms?|Schedules?)?\s*$/i;

const CROSS_REFERENCE_WINDOW = 46;

const SCORE_OMB = 6;
const SCORE_TITLE = 4;
const SCORE_NAME = 1;
const STRONG = SCORE_TITLE;

/* A consolidated brokerage package is several of these bound together. */
const BROKERAGE = ["1099-INT", "1099-DIV", "1099-B", "1099-MISC", "1099-OID", "1099-DA"];

function scoreForms(text, filename) {
  const scores = {};
  function add(type, n) { scores[type] = (scores[type] || 0) + n; }

  let m;
  OMB_TOKEN.lastIndex = 0;
  while ((m = OMB_TOKEN.exec(text)) !== null) {
    const type = OMB_FORMS[m[0]];
    if (type) add(type, SCORE_OMB);
  }

  TITLE_SIGNATURES.forEach(function (sig) {
    if (sig.test.test(text)) add(sig.type, SCORE_TITLE);
  });

  NAME_SIGNATURES.forEach(function (sig) {
    sig.test.lastIndex = 0;
    let hit;
    while ((hit = sig.test.exec(text)) !== null) {
      const before = text.slice(Math.max(0, hit.index - CROSS_REFERENCE_WINDOW), hit.index);
      if (!CROSS_REFERENCE.test(before)) add(sig.type, SCORE_NAME);
    }
  });

  /* The filename is a hint, never more than that. People rename files. */
  if (filename) {
    NAME_SIGNATURES.forEach(function (sig) {
      sig.test.lastIndex = 0;
      if (sig.test.test(filename)) add(sig.type, SCORE_NAME);
    });
  }

  return scores;
}

/* Returns { type, parts }. parts is filled only for a consolidated
   package, and lists the sections found inside it. */
function classifyDocument(text, filename) {
  const scores = scoreForms(text || "", filename || "");
  const ranked = Object.keys(scores).sort(function (a, b) { return scores[b] - scores[a]; });

  if (!ranked.length) return { type: null, parts: [] };

  const strongBrokerage = ranked.filter(function (t) {
    return BROKERAGE.indexOf(t) > -1 && scores[t] >= STRONG;
  });

  if (strongBrokerage.length >= 2) {
    return { type: "Consolidated 1099", parts: strongBrokerage.sort() };
  }

  /* Anything scoring only on bare names is a mention, not an identity. */
  if (scores[ranked[0]] < STRONG) {
    const named = ranked[0];
    return { type: scores[named] >= SCORE_NAME * 2 ? named : null, parts: [], weak: true };
  }

  return { type: ranked[0], parts: [] };
}

/* ---------- number parsing ----------

   A money token is kept only if it looks like money. A bare one or two
   digit integer sitting next to a label is a box number, and treating one
   as a dollar figure is how the previous reader produced $2 of wages. */

const MONEY_TOKEN = /\(?-?\$?\s?\d[\d,]*(?:\.\d{1,2})?\)?/g;

function parseMoneyToken(tok) {
  const negative = /^\(.*\)$/.test(tok.trim());
  const v = parseFloat(tok.replace(/[()$,\s]/g, ""));
  if (isNaN(v)) return null;
  return negative ? -Math.abs(v) : v;
}

/* Formatted means it carries a decimal or a thousands separator. Those are
   almost always real amounts. Bare integers are accepted but ranked below
   formatted ones, and bare integers under 100 are refused entirely because
   on these forms they are overwhelmingly box numbers, not dollars. */
/* Identifiers that are digits but are not amounts. A W-2 prints its OMB
   control number, the employer's EIN, a masked SSN and often an import
   code, all within a few millimetres of the money boxes. GW's W-2 emits
   its text layer right to left, which put "OMB No. 1545-0029" directly
   under the wages caption, and the reader returned 1545 as wages.

   These are blanked before any amount is looked for. The replacement is
   the same length as what it covers so every index stays valid. */
const IDENTIFIERS = [
  /OMB\s*No\.?\s*\d{2,4}-\d{4}/gi,   /* OMB control number, with its label */
  /\b\d{2,4}-\d{2,}(?:-\d+)*\b/g,    /* EIN, OMB, phone, ZIP+4, account numbers */
  /\*{2,}[-*\d]*/g,                  /* masked SSN */
  /\b\d{9}\b/g,                      /* bare SSN or routing number */
  /\b(?:19|20)\d{2}\s+(?:Tax|Form|W-2)/gi /* a year heading next to a form name */
];

function maskIdentifiers(text) {
  let out = text;
  IDENTIFIERS.forEach(function (re) {
    re.lastIndex = 0;
    out = out.replace(re, function (hit) { return " ".repeat(hit.length); });
  });
  return out;
}

function moneyCandidates(raw) {
  const text = maskIdentifiers(raw);
  const out = [];
  let m;
  MONEY_TOKEN.lastIndex = 0;
  while ((m = MONEY_TOKEN.exec(text)) !== null) {
    const tok = m[0];
    const value = parseMoneyToken(tok);
    if (value === null || Math.abs(value) >= 10000000) continue;
    const formatted = /[.,]/.test(tok);
    if (!formatted && Math.abs(value) < 100) continue;
    out.push({ value: value, index: m.index, length: tok.length, formatted: formatted });
  }
  return out;
}

/* Every label phrase the reader knows, used to recognise a neighbouring
   box caption so its leading number is never mistaken for an amount. */
const ANY_LABEL = new RegExp([
  "Wages,?\\s*tips", "Federal income tax withheld", "Social security wages",
  "Social security tax", "Medicare wages", "Medicare tax", "State wages",
  "State income tax", "Local wages", "Local income tax", "Allocated tips",
  "Dependent care", "Nonqualified plans", "Payments received", "Amounts billed",
  "Scholarships or grants", "Adjustments", "Student loan interest",
  "Nonemployee compensation", "Gross amount", "Interest income",
  "Total ordinary dividends", "Qualified dividends", "Unemployment compensation",
  "Proceeds", "Cost or other basis"
].join("|"), "i");

/* ---------- field location ----------

   Find where a label sits, then look for its value in this order:
     1. directly beneath it, in its own column  (how W-2 boxes are drawn)
     2. to its right on the same line, stopping at the next caption
         (how 1098-T and most 1099s are drawn)
   The first rule comes first because getting it backwards is what broke
   the W-2 case. */

const COLUMN_LEFT_SLACK = 12;
const COLUMN_RIGHT_SLACK = 90;
const ROWS_BELOW = 2;

function findLabel(lines, patterns) {
  for (const p of patterns) {
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      p.lastIndex = 0;
      const m = p.exec(line.text);
      if (!m) continue;

      /* Trace the match back to the item that carries it, for its x. */
      let startX = null, endX = null;
      for (let i = 0; i < line.items.length; i++) {
        const off = line.offsets[i];
        const end = off + line.items[i].str.length;
        if (startX === null && end > m.index) startX = line.items[i].x;
        if (off < m.index + m[0].length) endX = line.items[i].x + (line.items[i].w || 0);
      }
      if (startX === null) continue;
      return { lineIndex: li, start: m.index, end: m.index + m[0].length, startX: startX, endX: endX };
    }
  }
  return null;
}

function valueBelow(lines, hit) {
  const base = lines[hit.lineIndex];
  for (let step = 1; step <= ROWS_BELOW; step++) {
    const line = lines[hit.lineIndex + step];
    if (!line || line.page !== base.page) break;

    const inColumn = [];
    line.items.forEach(function (item, i) {
      if (item.x < hit.startX - COLUMN_LEFT_SLACK) return;
      if (item.x > hit.startX + COLUMN_RIGHT_SLACK) return;
      inColumn.push({ str: item.str, offset: line.offsets[i] });
    });
    if (!inColumn.length) continue;

    const text = inColumn.map(function (x) { return x.str; }).join(" ");
    const cands = moneyCandidates(text).filter(function (c) {
      return !ANY_LABEL.test(text.slice(c.index + c.length, c.index + c.length + 28));
    });
    if (!cands.length) continue;

    const formatted = cands.filter(function (c) { return c.formatted; });
    const pick = (formatted.length ? formatted : cands)[0];
    return { value: pick.value, confidence: pick.formatted ? "high" : "low", where: "below" };
  }
  return null;
}

function valueRight(lines, hit) {
  const line = lines[hit.lineIndex];
  const after = line.text.slice(hit.end);

  /* Stop at the next caption on this line, so a value is never borrowed
     from the box next door. */
  const nextLabel = ANY_LABEL.exec(after);
  const window = nextLabel ? after.slice(0, nextLabel.index) : after.slice(0, 120);

  const cands = moneyCandidates(window);
  if (!cands.length) return null;
  const formatted = cands.filter(function (c) { return c.formatted; });
  const pick = (formatted.length ? formatted : cands)[0];
  return { value: pick.value, confidence: pick.formatted ? "medium" : "low", where: "right" };
}

function findValue(lines, patterns) {
  const hit = findLabel(lines, patterns);
  if (!hit) return null;
  return valueBelow(lines, hit) || valueRight(lines, hit);
}

const FIELD_RULES = {
  "W-2": [
    { field: "w2wage", label: "Box 1, wages", patterns: [/Wages,?\s*tips,?\s*other compensation/i] },
    { field: "w2fed", label: "Box 2, federal tax withheld", patterns: [/Federal income tax withheld/i] },
    { field: "w2state", label: "Box 17, state tax withheld", patterns: [/State income tax/i] },
    { field: "tips", label: "Box 7, social security tips", patterns: [/Social security tips/i] }
  ],
  "1098-T": [
    { field: "tuition", label: "Box 1, payments received for tuition", patterns: [/Payments received for qualified tuition/i] },
    { field: "scholarship", label: "Box 5, scholarships or grants", patterns: [/Scholarships or grants/i] }
  ],
  "1098-E": [
    { field: "loanint", label: "Box 1, student loan interest received", patterns: [/Student loan interest received/i] }
  ],
  "1099-NEC": [
    { field: "segross", label: "Box 1, nonemployee compensation", patterns: [/Nonemployee compensation/i] }
  ],
  "1099-K": [
    { field: "segross", label: "Box 1a, gross payment card transactions", patterns: [/Gross amount of payment card/i] }
  ],
  "1099-INT": [
    { field: "interest", label: "Box 1, interest income", patterns: [/Interest income/i] }
  ],
  "1099-DIV": [
    { field: "dividends", label: "Box 1a, ordinary dividends", patterns: [/Total ordinary dividends/i] }
  ],
  "1099-B": [
    { field: "gains", label: "Realized gain or loss", patterns: [/Realized (?:gain|loss)/i, /Net (?:gain|loss)/i, /Total (?:gain|loss)/i] }
  ],
  "1099-G": [
    { field: "unemp", label: "Box 1, unemployment compensation", patterns: [/Unemployment compensation/i] }
  ]
};

/* Forms we recognize but deliberately do not auto-fill. */
const NO_AUTOFILL = {
  "1095-A": "Marketplace coverage is flagged for you, but the monthly figures on this form feed Form 8962 and have to be entered in your filing software directly.",
  "1095-B": "This is proof that you had health coverage. You do not need it to file and nothing from it goes on your return. Keep it with your records. It is often mistaken for a 1095-A, which is the Marketplace form that does affect a return.",
  "1095-C": "This is your employer's record that it offered you coverage. You do not need it to file and nothing from it goes on your return. Keep it with your records.",
  "1042-S": "This form means you may be a nonresident for tax purposes. The walkthrough will ask about that at section one, and the numbers here do not belong in the fields below.",
  "1099-R": "A retirement or pension distribution needs the taxable amount, the distribution code in box 7, and possibly an early withdrawal penalty on Form 5329. Too much depends on that code to read it off the page, so enter this one in your filing software directly.",
  "1099-B": "Only the summary total is picked up. Every individual sale still has to reach Schedule D, so import the 1099-B into your filing software rather than retyping it."
};

/* ---------- text layer quality ----------

   Some PDFs are scans that were run through character recognition, and
   the recognised text is embedded as the text layer. It reads as a real
   digital document and parses without error, but the words are wrong:

     "1 Wege&, tips, othff comp.   2 Feder el income tax withheld"
     "S Medicert weges end tips    6 Medicare tax withheld"

   and the digits carry the same noise, so stray marks arrive as numbers.
   One of these produced 111 for federal tax withheld on a form whose
   boxes actually read 354.65 and blank.

   The box captions on these forms are fixed text set by the IRS, so they
   are a usable ruler. When almost none of them match exactly, the layer
   is not trustworthy and no figure from it should be offered. */

const STANDARD_CAPTIONS = {
  "W-2": [/Wages,?\s*tips,?\s*other compensation/i, /Federal income tax withheld/i,
    /Social security wages/i, /Social security tax withheld/i,
    /Medicare wages and tips/i, /Medicare tax withheld/i,
    /Social security tips/i, /State wages,?\s*tips/i, /State income tax/i,
    /Employer identification number/i, /Wage and Tax Statement/i],
  "1098-T": [/Payments received for qualified tuition/i, /Scholarships or grants/i,
    /Adjustments made for a prior year/i, /Tuition Statement/i],
  "1098-E": [/Student loan interest received/i, /Student Loan Interest Statement/i],
  "1099-NEC": [/Nonemployee compensation/i, /Federal income tax withheld/i],
  "1099-INT": [/Interest income/i, /Early withdrawal penalty/i, /Federal income tax withheld/i],
  "1099-DIV": [/Total ordinary dividends/i, /Qualified dividends/i],
  "1099-G": [/Unemployment compensation/i],
  "1099-K": [/Gross amount of payment card/i]
};

/* Measured against real documents: a clean W-2 matches 11 of 11 captions,
   a recognised scan of one matched 4. The gap is wide, so the threshold
   does not have to be delicate. */
const CLEAN_CAPTION_SHARE = 0.7;
const MIN_CLEAN_CAPTIONS = 2;

/* Returns true when enough of the form's own captions survived intact. */
function captionsLookClean(type, text) {
  const expected = STANDARD_CAPTIONS[type];
  if (!expected) return true;
  const clean = expected.filter(function (re) { return re.test(text); }).length;
  const needed = Math.max(MIN_CLEAN_CAPTIONS, Math.ceil(expected.length * CLEAN_CAPTION_SHARE));
  return clean >= Math.min(needed, expected.length);
}

/* A consolidated brokerage 1099 is several forms bound into one PDF, with
   per-transaction detail that belongs on Schedule D. Nobody should retype
   one, and every filing package imports them directly. Refusing to read it
   is the correct answer, not a shortfall. */
function consolidatedNote(parts) {
  const names = parts.join(", ");
  return "This is a consolidated 1099, meaning one PDF holding several forms: " + names +
    ". Do not retype it. Every filing package imports these directly from your broker, " +
    "which is both faster and the only way the per-sale detail reaches Schedule D correctly. " +
    "Look for an import option and your account or document ID, usually printed on the first page. " +
    "Nothing from this file has been filled in for you.";
}

/* ---------- pure entry point, testable without a browser ---------- */

function readLines(lines, filename) {
  const flat = lines.map(function (l) { return l.text; }).join(" ");
  const verdict = classifyDocument(flat, filename);
  const result = { type: verdict.type, parts: verdict.parts || [],
    found: [], note: null, needsManual: false };

  if (!result.type) {
    result.needsManual = true;
    result.note = "The text came through, but this does not match any tax form the tool knows. Check it is the right file, then enter anything relevant by hand.";
    return result;
  }

  /* A consolidated package is identified and then left alone on purpose. */
  if (result.type === "Consolidated 1099") {
    result.note = consolidatedNote(result.parts);
    return result;
  }

  if (!captionsLookClean(result.type, flat)) {
    result.needsManual = true;
    result.note = "This looks like a scan that was put through character recognition, and the recognition was poor. The form is readable enough to tell it is a " +
      result.type + ", but its printed labels came through garbled, which means any figure read from it would be a guess. Nothing has been filled in. Type the amounts from the paper.";
    return result;
  }

  (FIELD_RULES[result.type] || []).forEach(function (r) {
    const v = findValue(lines, r.patterns);
    if (v) result.found.push({ field: r.field, label: r.label, value: v.value, confidence: v.confidence });
  });

  if (NO_AUTOFILL[result.type]) result.note = NO_AUTOFILL[result.type];

  if (!result.found.length && !NO_AUTOFILL[result.type]) {
    result.needsManual = true;
    result.note = "Recognized as a " + result.type + ", but the amounts are laid out in a way the reader did not follow. Issuers format these very differently. Type the figures in yourself.";
  } else if (result.found.some(function (f) { return f.confidence === "low"; })) {
    result.note = (result.note ? result.note + " " : "") +
      "Some figures here were read with low confidence, meaning they were not printed in a form the reader is sure about. Check those against the paper with extra care.";
  }

  return result;
}

/* ---------- public entry point ---------- */

async function readDocument(file) {
  /* text, isImage and scanned are what the assisted reader needs to decide
     what it would send, if the user asks for it. Nothing is sent from here. */
  const result = {
    name: file.name, size: file.size, type: null,
    found: [], note: null, needsManual: false,
    text: "", isImage: false, scanned: false
  };

  if (file.size > MAX_FILE_BYTES) {
    result.needsManual = true;
    result.note = "This file is larger than " + Math.round(MAX_FILE_BYTES / 1048576) + " MB, which is far bigger than any tax form. It was not read. Check it is the right file.";
    return result;
  }

  if (file.size === 0) {
    result.needsManual = true;
    result.note = "This file is empty. It may not have finished downloading from your payroll or bursar portal.";
    return result;
  }

  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

  if (!isPdf) {
    result.type = classifyDocument("", file.name).type;
    result.needsManual = true;
    result.isImage = true;
    result.note = "This is a photo, and there is no text inside it for the local reader to find. The assisted reader can look at it if you ask, otherwise type the figures in yourself.";
    return result;
  }

  let lines = [];
  try {
    lines = await pdfLines(file);
  } catch (e) {
    result.needsManual = true;
    const msg = e && e.message ? e.message : "";
    result.note = /password|encrypt/i.test(msg)
      ? "This PDF is password protected. Open it in a PDF reader, save an unlocked copy, and add that instead."
      : (/reader could not be loaded/i.test(msg)
        ? "The PDF reader did not load, so nothing could be read from this file. Your network may be blocking part of this site. The file is listed with your records; type its figures in yourself."
        : "This PDF could not be opened for reading. It is saved with your records; type the figures from it yourself.");
    return result;
  }

  const flat = lines.map(function (l) { return l.text; }).join(" ");
  result.text = flat;

  if (flat.replace(/\s/g, "").length < 40) {
    result.type = classifyDocument("", file.name).type;
    result.needsManual = true;
    result.scanned = true;
    result.text = "";
    result.note = "This PDF is a scan rather than a digital document, so it holds a picture of the form instead of readable text. The assisted reader can look at the page image if you ask, otherwise type the figures in yourself.";
    return result;
  }

  const read = readLines(lines, file.name);
  result.type = read.type;
  result.parts = read.parts || [];
  result.found = read.found;
  result.note = read.note;
  result.needsManual = read.needsManual;
  return result;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { itemsToLines, readLines, moneyCandidates, classifyDocument, scoreForms };
}
