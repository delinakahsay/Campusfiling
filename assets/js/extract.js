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

/* ---------- classification ---------- */

const FORM_SIGNATURES = [
  { type: "W-2", test: /\bW-?2\b|Wage and Tax Statement/i },
  { type: "1098-T", test: /1098-?T|Tuition Statement/i },
  { type: "1098-E", test: /1098-?E|Student Loan Interest Statement/i },
  { type: "1099-NEC", test: /1099-?NEC|Nonemployee Compensation/i },
  { type: "1099-K", test: /1099-?K|Payment Card and Third Party/i },
  { type: "1099-INT", test: /1099-?INT|Interest Income/i },
  { type: "1099-DIV", test: /1099-?DIV|Dividends and Distributions/i },
  { type: "1099-B", test: /1099-?B|Proceeds From Broker/i },
  { type: "1099-G", test: /1099-?G|Certain Government Payments/i },
  { type: "1095-A", test: /1095-?A|Health Insurance Marketplace Statement/i },
  { type: "1042-S", test: /1042-?S|Foreign Person'?s U\.?S\.? Source Income/i }
];

function classify(text, filename) {
  const hay = (text || "") + " " + (filename || "");
  for (const sig of FORM_SIGNATURES) if (sig.test.test(hay)) return sig.type;
  return null;
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
function moneyCandidates(text) {
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
  "1042-S": "This form means you may be a nonresident for tax purposes. The walkthrough will ask about that at section one, and the numbers here do not belong in the fields below.",
  "1099-B": "Only the summary total is picked up. Every individual sale still has to reach Schedule D, so import the 1099-B into your filing software rather than retyping it."
};

/* ---------- pure entry point, testable without a browser ---------- */

function readLines(lines, filename) {
  const flat = lines.map(function (l) { return l.text; }).join(" ");
  const result = { type: classify(flat, filename), found: [], note: null, needsManual: false };

  if (!result.type) {
    result.needsManual = true;
    result.note = "The text came through, but this does not match any tax form the tool knows. Check it is the right file, then enter anything relevant by hand.";
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
  const result = {
    name: file.name, size: file.size, type: null,
    found: [], note: null, needsManual: false
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
    result.type = classify("", file.name);
    result.needsManual = true;
    result.note = "This is an image, and there is no text to read inside it. The file is saved with your records, but you will need to type the figures from it yourself.";
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
  if (flat.replace(/\s/g, "").length < 40) {
    result.type = classify("", file.name);
    result.needsManual = true;
    result.note = "This PDF is a scan rather than a digital document, so it holds a picture of the form instead of readable text. Type the figures from it yourself.";
    return result;
  }

  const read = readLines(lines, file.name);
  result.type = read.type;
  result.found = read.found;
  result.note = read.note;
  result.needsManual = read.needsManual;
  return result;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { itemsToLines, readLines, moneyCandidates, classify };
}
