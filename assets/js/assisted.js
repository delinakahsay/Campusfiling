/* Campus Filing: the assisted reader, and the rule for believing it.

   extract.js reads a document locally with no network at all. It is fast,
   free and verifiable, and it fails on layouts it was not written for:
   a W-2 whose text layer runs right to left, a scan whose character
   recognition produced "1 Wege&, tips, othff comp.", a photo taken on a
   phone.

   This module is the second attempt at exactly those. It sends what the
   browser already extracted, or a rendered image when there is no text,
   to a function on this site, which calls a model and returns figures.
   The file itself is never uploaded.

   Two things make this safe enough to ship:

   The user asks for it. There is no automatic send. A document sits in
   the list with its local result until someone clicks the button, and the
   button says what it is about to transmit.

   Neither reader is trusted alone. reconcile() below compares them. Two
   independent readers agreeing on a figure is real evidence. Two readers
   disagreeing is the most useful thing this tool can tell a student, and
   it is shown rather than resolved. A model reading a tax form fails
   differently from a regular expression: it returns a plausible number
   with no sign that it is wrong, where the local reader simply finds
   nothing. That asymmetry is the whole reason both of them run. */

const ASSIST_ENDPOINT = "/api/read-document";
const ASSIST_TIMEOUT_MS = 50000;
const RENDER_SCALE = 2.0;
const RENDER_MAX_EDGE = 2200;

/* ---------- what would be sent ---------- */

/* Plain words for the consent button, so nobody clicks it without knowing
   what leaves the browser. */
function assistPayloadKind(res) {
  if (res.isImage) return "image";
  if (res.scanned) return "render";
  if (res.text && res.text.length > 40) return "text";
  return null;
}

function assistDescription(res) {
  const kind = assistPayloadKind(res);
  if (kind === "text") return "the text already pulled out of this PDF";
  if (kind === "render") return "a picture of this page, because the PDF holds no readable text";
  if (kind === "image") return "this photo";
  return null;
}

/* ---------- turning a page into an image ---------- */

/* Only runs on consent, and only when there is no text worth sending. */
async function renderFirstPage(file) {
  const lib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const doc = await lib.getDocument({ data: buf, isEvalSupported: false }).promise;
  const page = await doc.getPage(1);

  let viewport = page.getViewport({ scale: RENDER_SCALE });
  const longest = Math.max(viewport.width, viewport.height);
  if (longest > RENDER_MAX_EDGE) {
    viewport = page.getViewport({ scale: RENDER_SCALE * (RENDER_MAX_EDGE / longest) });
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;

  const url = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return { data: url.slice(url.indexOf(",") + 1), mediaType: "image/png" };
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () {
      const url = String(reader.result || "");
      const comma = url.indexOf(",");
      if (comma === -1) { reject(new Error("unreadable")); return; }
      resolve({ data: url.slice(comma + 1), mediaType: (file.type || "image/png") });
    };
    reader.onerror = function () { reject(new Error("unreadable")); };
    reader.readAsDataURL(file);
  });
}

/* HEIC is what an iPhone produces and no browser will decode it for a
   canvas, so it cannot be converted here and the model cannot read it. */
function assistSupportsFile(file) {
  return !/\.(heic|heif)$/i.test(file.name);
}

/* ---------- the call ---------- */

async function assistedRead(file, localResult) {
  const kind = assistPayloadKind(localResult);
  if (!kind) throw new Error("There is nothing in this file to send.");
  if ((kind === "image") && !assistSupportsFile(file)) {
    throw new Error("HEIC photos cannot be read by anything here. Re-save it as a JPEG or PNG, or type the figures in.");
  }

  const body = {
    localType: localResult.type || null,
    localFound: (localResult.found || []).map(function (f) {
      return { field: f.field, value: f.value, confidence: f.confidence };
    })
  };

  if (kind === "text") {
    body.text = localResult.text;
  } else if (kind === "render") {
    const img = await renderFirstPage(file);
    body.image = img.data;
    body.mediaType = img.mediaType;
  } else {
    const img = await fileToBase64(file);
    body.image = img.data;
    body.mediaType = img.mediaType;
  }

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, ASSIST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(ASSIST_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e && e.name === "AbortError"
      ? "The assisted reader took too long. Type this one in by hand."
      : "The assisted reader could not be reached. Type this one in by hand.");
  }
  clearTimeout(timer);

  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }

  if (!res.ok) {
    throw new Error((payload && payload.error) || "The assisted reader returned an error. Type this one in by hand.");
  }
  if (!payload) throw new Error("The assisted reader returned something unreadable.");

  return {
    type: payload.type || null,
    fields: Array.isArray(payload.fields) ? payload.fields : [],
    unreadable: !!payload.unreadable,
    note: payload.note || ""
  };
}

/* ---------- believing one, the other, or neither ---------- */

/* Figures within a cent are the same figure. Tax forms print to cents and
   the two readers can round differently on the way there. */
const SAME_AMOUNT = 0.011;

function sameAmount(a, b) {
  return Math.abs(a - b) <= SAME_AMOUNT;
}

/* Takes both readings of one document and returns the rows to show.

   agreed      both read it, same number. The strongest signal available.
   assisted    local found nothing or was unsure; the model's figure stands.
   local       the model declined to read it; the local figure stands.
   conflict    both read it and they differ. Shown, never resolved.

   Only agreed and assisted arrive pre-ticked. A conflict is a question
   for the person holding the paper, and a low local reading on its own is
   still the thing that was wrong often enough to build this. */
function reconcile(localResult, assistedResult) {
  const rows = [];
  const localFound = (localResult && localResult.found) || [];
  const assistedFields = (assistedResult && assistedResult.fields) || [];

  const byField = {};
  localFound.forEach(function (f) { byField[f.field] = byField[f.field] || {}; byField[f.field].local = f; });
  assistedFields.forEach(function (f) { byField[f.field] = byField[f.field] || {}; byField[f.field].assisted = f; });

  Object.keys(byField).forEach(function (field) {
    const local = byField[field].local;
    const assisted = byField[field].assisted;
    const label = (local && local.label) || (assisted && FIELD_LABELS[field]) || field;

    if (local && assisted) {
      if (sameAmount(local.value, assisted.value)) {
        rows.push({ field: field, label: label, value: assisted.value,
          source: "agreed", confidence: "high", ticked: true,
          evidence: assisted.evidence || "" });
      } else {
        rows.push({ field: field, label: label, value: local.value,
          source: "conflict", confidence: "low", ticked: false,
          other: assisted.value, evidence: assisted.evidence || "" });
      }
      return;
    }

    if (assisted) {
      rows.push({ field: field, label: label, value: assisted.value,
        source: "assisted", confidence: assisted.confidence || "medium", ticked: true,
        evidence: assisted.evidence || "" });
      return;
    }

    rows.push({ field: field, label: label, value: local.value,
      source: "local", confidence: local.confidence || "medium",
      ticked: local.confidence !== "low", evidence: "" });
  });

  return rows;
}

/* Labels for fields only the assisted reader found, since the local
   reader is where the per-box wording normally comes from. */
const FIELD_LABELS = {
  w2wage: "Box 1, wages", w2fed: "Box 2, federal tax withheld",
  w2state: "Box 17, state tax withheld", tips: "Box 7, social security tips",
  segross: "Box 1, self-employment or gig income",
  interest: "Box 1, interest income", dividends: "Box 1a, ordinary dividends",
  gains: "Net gain or loss", unemp: "Box 1, unemployment compensation",
  tuition: "Box 1, payments received for tuition",
  scholarship: "Box 5, scholarships or grants",
  loanint: "Box 1, student loan interest received",
  stipend: "Fellowship or stipend amount"
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = { reconcile, sameAmount, assistPayloadKind, assistDescription, assistSupportsFile, FIELD_LABELS };
}
