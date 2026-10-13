/* Campus Filing: real document reading.

   PDFs from payroll portals, bursar systems and brokerages are almost
   always digital, meaning they carry a real text layer. We pull that text
   out with pdf.js and look for the labelled amounts. That is genuine
   extraction, not a filename lookup.

   What it cannot do: photographs and scans have no text layer. There is
   no OCR here. Those files are accepted, stored and listed, and the user
   is told plainly to type the figures from them.

   Nothing extracted is ever written straight into an answer. Every value
   goes to a review table first and the user confirms it against the paper.
   A silent wrong number is worse than no number. */

const PDFJS_SRC = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

let pdfjsPromise = null;

function loadPdfJs() {
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
    s.onerror = function () { reject(new Error("pdf.js could not be fetched")); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}

/* ---------- text layer ---------- */

async function pdfText(file) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  let out = "";
  const pages = Math.min(doc.numPages, 6);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map(function (it) { return it.str; }).join(" ") + "\n";
  }
  return out.replace(/\s+/g, " ").trim();
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

/* ---------- amount parsing ---------- */

/* Pull the first plausible dollar amount that follows a label. Box layouts
   differ between issuers, so this reads the label text rather than
   assuming a fixed position. */
function amountAfter(text, patterns, windowChars) {
  windowChars = windowChars || 90;
  for (const p of patterns) {
    const m = p.exec(text);
    if (!m) continue;
    const slice = text.slice(m.index + m[0].length, m.index + m[0].length + windowChars);
    const num = /(-?\$?\s?[\d,]+(?:\.\d{2})?)/.exec(slice);
    if (!num) continue;
    const v = parseFloat(num[1].replace(/[$,\s]/g, ""));
    if (!isNaN(v) && Math.abs(v) < 10000000) return v;
  }
  return null;
}

const FIELD_RULES = {
  "W-2": [
    { field: "w2wage", label: "Box 1, wages", patterns: [/Wages,?\s*tips,?\s*other compensation/i, /\bBox\s*1\b/i] },
    { field: "w2fed", label: "Box 2, federal tax withheld", patterns: [/Federal income tax withheld/i, /\bBox\s*2\b/i] },
    { field: "w2state", label: "Box 17, state tax withheld", patterns: [/State income tax/i, /\bBox\s*17\b/i] }
  ],
  "1098-T": [
    { field: "tuition", label: "Box 1, payments received for tuition", patterns: [/Payments received for qualified tuition/i, /\bBox\s*1\b/i] },
    { field: "scholarship", label: "Box 5, scholarships or grants", patterns: [/Scholarships or grants/i, /\bBox\s*5\b/i] }
  ],
  "1098-E": [
    { field: "loanint", label: "Box 1, student loan interest received", patterns: [/Student loan interest received/i, /\bBox\s*1\b/i] }
  ],
  "1099-NEC": [
    { field: "segross", label: "Box 1, nonemployee compensation", patterns: [/Nonemployee compensation/i, /\bBox\s*1\b/i] }
  ],
  "1099-K": [
    { field: "segross", label: "Box 1a, gross payment card transactions", patterns: [/Gross amount of payment card/i, /\bBox\s*1a\b/i] }
  ],
  "1099-INT": [
    { field: "interest", label: "Box 1, interest income", patterns: [/Interest income/i, /\bBox\s*1\b/i] }
  ],
  "1099-DIV": [
    { field: "dividends", label: "Box 1a, ordinary dividends", patterns: [/Total ordinary dividends/i, /\bBox\s*1a\b/i] }
  ],
  "1099-B": [
    { field: "gains", label: "Realized gain or loss", patterns: [/Realized (?:gain|loss)/i, /Net (?:gain|loss)/i, /Total (?:gain|loss)/i] }
  ],
  "1099-G": [
    { field: "unemp", label: "Box 1, unemployment compensation", patterns: [/Unemployment compensation/i, /\bBox\s*1\b/i] }
  ]
};

/* Forms we recognize but deliberately do not auto-fill. */
const NO_AUTOFILL = {
  "1095-A": "Marketplace coverage is flagged for you, but the monthly figures on this form feed Form 8962 and have to be entered in your filing software directly.",
  "1042-S": "This form means you may be a nonresident for tax purposes. The walkthrough will ask about that at section one, and the numbers here do not belong in the fields below.",
  "1099-B": "Only the summary total is picked up. Every individual sale still has to reach Schedule D, so import the 1099-B into your filing software rather than retyping it."
};

/* ---------- public entry point ---------- */

async function readDocument(file) {
  const result = {
    name: file.name, size: file.size, type: null,
    found: [], note: null, needsManual: false
  };

  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";

  if (!isPdf) {
    result.type = classify("", file.name);
    result.needsManual = true;
    result.note = "This is an image, and there is no text to read inside it. The file is saved with your records, but you will need to type the figures from it yourself.";
    return result;
  }

  let text = "";
  try {
    text = await pdfText(file);
  } catch (e) {
    result.needsManual = true;
    result.note = "This PDF could not be opened for reading. It is saved with your records; type the figures from it yourself.";
    return result;
  }

  result.type = classify(text, file.name);

  if (text.length < 40) {
    result.needsManual = true;
    result.note = "This PDF is a scan rather than a digital document, so it holds a picture of the form instead of readable text. Type the figures from it yourself.";
    return result;
  }

  if (!result.type) {
    result.needsManual = true;
    result.note = "The text came through, but this does not match any tax form the tool knows. Check it is the right file, then enter anything relevant by hand.";
    return result;
  }

  const rules = FIELD_RULES[result.type] || [];
  rules.forEach(function (r) {
    const v = amountAfter(text, r.patterns);
    if (v !== null) result.found.push({ field: r.field, label: r.label, value: v });
  });

  if (NO_AUTOFILL[result.type]) result.note = NO_AUTOFILL[result.type];

  if (!result.found.length && !NO_AUTOFILL[result.type]) {
    result.needsManual = true;
    result.note = "Recognized as a " + result.type + ", but the amounts are laid out in a way the reader did not follow. Issuers format these very differently. Type the figures in yourself.";
  }

  return result;
}
