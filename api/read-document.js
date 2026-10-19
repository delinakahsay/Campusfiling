/* Campus Filing: the model-assisted document reader.

   This runs on Vercel, not in the browser, for one reason: the API key
   cannot be in client code. Anything shipped to the browser is public,
   and a key in there is a key anyone can spend.

   What reaches this function is never the user's file. The browser sends
   either the text pdf.js already pulled out of the PDF, or, when there is
   no usable text, a rendered image of the page. Both are produced locally
   first. Nothing here is written to disk, logged, or kept after the
   response is sent.

   This is the second reader. The browser runs the deterministic one in
   extract.js first and sends what it found, so the model's answer can be
   compared against it rather than replacing it. Where the two agree, the
   figure is trustworthy. Where they disagree, the user is shown both and
   neither is applied. See reconcile() in wizard.js. */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

/* Either name works. ANTHROPIC_API_KEY is what Anthropic's own tooling
   uses and is the one to prefer, but ANTHROPIC_KEY is a natural thing to
   type and getting it wrong costs a deploy and a confusing 503. Accepting
   both is cheaper than the support question. */
function apiKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_KEY || "";
}

const MAX_TEXT_CHARS = 60000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 1500;
const TIMEOUT_MS = 45000;

/* The fields the walkthrough actually has boxes for. The model is not
   allowed to invent a field name, because a value with a name nothing
   recognises would be silently dropped and look like a read failure. */
const FIELDS = {
  w2wage: "W-2 box 1, wages, tips and other compensation",
  w2fed: "W-2 box 2 or 1099 federal income tax withheld",
  w2state: "W-2 box 17, state income tax withheld",
  tips: "W-2 box 7, social security tips",
  segross: "1099-NEC box 1 nonemployee compensation, 1099-MISC, or 1099-K gross amount",
  interest: "1099-INT box 1, interest income",
  dividends: "1099-DIV box 1a, total ordinary dividends",
  gains: "1099-B net realised gain or loss, negative for a loss",
  unemp: "1099-G box 1, unemployment compensation",
  tuition: "1098-T box 1, payments received for qualified tuition",
  scholarship: "1098-T box 5, scholarships or grants",
  loanint: "1098-E box 1, student loan interest received",
  stipend: "A fellowship or stipend amount from an award letter"
};

const FORM_TYPES = ["W-2", "1098-T", "1098-E", "1099-NEC", "1099-MISC", "1099-K",
  "1099-INT", "1099-DIV", "1099-B", "1099-G", "1099-R", "1095-A", "1095-B",
  "1095-C", "1042-S", "Consolidated 1099", "Other"];

const TOOL = {
  name: "record_form",
  description: "Record what this tax document is and the figures printed on it.",
  input_schema: {
    type: "object",
    properties: {
      form_type: {
        type: "string",
        enum: FORM_TYPES,
        description: "The form this document actually is. Judge by its own header and OMB control number, never by a form it mentions in its instructions. A 1099-NEC says 'you received this form instead of Form W-2' and is still a 1099-NEC. A brokerage package holding several 1099s is 'Consolidated 1099'."
      },
      fields: {
        type: "array",
        description: "One entry per figure you can read with confidence. Omit a field entirely rather than guessing at it. Return an empty array if the document is too damaged to read.",
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: Object.keys(FIELDS) },
            value: { type: "number", description: "The amount in dollars. No currency symbol, no thousands separators. Negative for a loss." },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
            evidence: { type: "string", description: "The exact text you read this from, copied character for character, so a person can find it on the page." }
          },
          required: ["field", "value", "confidence", "evidence"]
        }
      },
      unreadable: {
        type: "boolean",
        description: "True when the document is too damaged, too low quality, or too unfamiliar to read any figure from."
      },
      note: {
        type: "string",
        description: "One short sentence for the student, only if something about this document needs saying. Leave empty otherwise."
      }
    },
    required: ["form_type", "fields", "unreadable"]
  }
};

const SYSTEM = [
  "You read United States tax documents and report the figures printed on them.",
  "",
  "You are the second reader. A deterministic parser has already run and its result is given to you. Do not try to agree with it. An independent answer is the entire point, because the two are compared afterwards and a disagreement is shown to the student.",
  "",
  "Rules that matter more than completeness:",
  "",
  "1. Never infer, derive or calculate a figure. Report only what is printed. If box 2 is blank, it is blank; do not reason about what withholding ought to be.",
  "2. Omit a field rather than guess. A missing figure makes the student type one number. A wrong figure goes onto a tax return. These are not comparable costs.",
  "3. Identify the form by its own header and OMB control number. Tax forms quote other forms constantly in their instructions for recipient, and that is the single most common way to misread one.",
  "4. Numbers near a money box are often not money: OMB control numbers, employer identification numbers, masked social security numbers, box numbers, account and document IDs, phone numbers, ZIP codes. None of these are amounts.",
  "5. Some documents are scans put through character recognition, and the text you get will be visibly garbled. The digits carry the same errors as the words. If the labels are mangled, the figures are not reliable either: set unreadable and return no fields.",
  "6. Text extracted from a PDF can arrive out of visual order, including right to left or column by column. Work out the real layout before pairing a caption with an amount.",
  "7. A consolidated brokerage 1099 holds several forms at once. Report form_type as Consolidated 1099 and return no fields. These import directly into filing software and must not be retyped.",
  "8. A 1095-B or 1095-C has no figures that go on a return. Report the type and return no fields.",
  "",
  "Confidence: high means the caption and the amount are unambiguous and clearly paired. medium means you are confident in the figure but the layout required inference. low means you are reporting it only because it is probably right. Use low freely; it is surfaced to the student as something to check, not hidden."
].join("\n");

function fieldReference() {
  return Object.keys(FIELDS).map(function (k) { return "  " + k + ": " + FIELDS[k]; }).join("\n");
}

function localSummary(localType, localFound) {
  if (!Array.isArray(localFound) || !localFound.length) {
    return "The deterministic parser read no figures from this document" +
      (localType ? " and classified it as " + localType + "." : " and could not classify it.");
  }
  const rows = localFound.map(function (f) {
    return "  " + f.field + " = " + f.value + " (confidence " + (f.confidence || "unknown") + ")";
  }).join("\n");
  return "The deterministic parser classified this as " + (localType || "unknown") +
    " and read:\n" + rows;
}

function bad(res, status, message) {
  res.status(status).json({ error: message });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return bad(res, 405, "POST only.");

  const key = apiKey();
  if (!key) {
    return bad(res, 503, "The assisted reader is not configured on this deployment. Set ANTHROPIC_API_KEY (or ANTHROPIC_KEY) and redeploy.");
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { return bad(res, 400, "Body was not JSON."); }
  }
  if (!body || typeof body !== "object") return bad(res, 400, "Body was not JSON.");

  const text = typeof body.text === "string" ? body.text : "";
  const image = typeof body.image === "string" ? body.image : "";
  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "image/png";
  const localType = typeof body.localType === "string" ? body.localType : null;
  const localFound = Array.isArray(body.localFound) ? body.localFound.slice(0, 20) : [];

  if (!text && !image) return bad(res, 400, "Nothing to read: send text or an image.");
  if (text.length > MAX_TEXT_CHARS) return bad(res, 413, "That document is larger than this reader accepts.");
  if (image && image.length * 0.75 > MAX_IMAGE_BYTES) return bad(res, 413, "That image is larger than this reader accepts.");
  if (image && ["image/png", "image/jpeg", "image/webp", "image/gif"].indexOf(mediaType) === -1) {
    return bad(res, 400, "Unsupported image type.");
  }

  const content = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
  }
  content.push({
    type: "text",
    text: [
      "Read this tax document.",
      "",
      "Fields you may report:",
      fieldReference(),
      "",
      localSummary(localType, localFound),
      "",
      "Reach your own conclusion independently.",
      text ? "\nText extracted from the document follows. It may be out of visual order.\n\n" + text : ""
    ].join("\n")
  });

  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM,
        tools: [TOOL],
        tool_choice: { type: "tool", name: "record_form" },
        messages: [{ role: "user", content: content }]
      })
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e && e.name === "AbortError";
    return bad(res, 504, aborted
      ? "The assisted reader took too long and was stopped. Type this document in by hand."
      : "The assisted reader could not be reached. Type this document in by hand.");
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    /* The upstream body can echo request content, so it is never forwarded
       to the browser. For diagnosis, the status and the error category are
       logged, and the upstream message only for the statuses that are about
       the key or the model rather than the document: those cannot contain
       anything a student uploaded. */
    let category = "", detail = "";
    try {
      const err = await upstream.json();
      category = (err && err.error && err.error.type) || "";
      if ([400, 401, 403, 404].indexOf(upstream.status) > -1) {
        detail = (err && err.error && err.error.message) || "";
      }
    } catch (e) { /* nothing to add */ }

    console.error("assisted reader upstream " + upstream.status +
      (category ? " " + category : "") +
      (detail ? ": " + String(detail).slice(0, 300) : "") +
      " (model " + MODEL + ")");

    const status = upstream.status === 429 ? 429 : 502;
    return bad(res, status, upstream.status === 429
      ? "The assisted reader is rate limited right now. Try again shortly, or type this one in."
      : "The assisted reader returned an error. Type this document in by hand.");
  }

  let payload;
  try { payload = await upstream.json(); }
  catch (e) { return bad(res, 502, "The assisted reader returned something unreadable."); }

  const block = (payload.content || []).filter(function (b) {
    return b.type === "tool_use" && b.name === "record_form";
  })[0];

  if (!block || !block.input) {
    return bad(res, 502, "The assisted reader did not return a result in the expected shape.");
  }

  const out = block.input;
  const fields = Array.isArray(out.fields) ? out.fields : [];

  /* Re-validate on the way out. The schema is a request, not a guarantee. */
  const clean = fields.filter(function (f) {
    return f && typeof f.field === "string" &&
      Object.prototype.hasOwnProperty.call(FIELDS, f.field) &&
      typeof f.value === "number" && isFinite(f.value) &&
      Math.abs(f.value) < 10000000;
  }).map(function (f) {
    return {
      field: f.field,
      value: f.value,
      confidence: ["high", "medium", "low"].indexOf(f.confidence) > -1 ? f.confidence : "low",
      evidence: typeof f.evidence === "string" ? f.evidence.slice(0, 200) : ""
    };
  });

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    type: FORM_TYPES.indexOf(out.form_type) > -1 ? out.form_type : null,
    fields: out.unreadable ? [] : clean,
    unreadable: !!out.unreadable,
    note: typeof out.note === "string" ? out.note.slice(0, 400) : ""
  });
};
