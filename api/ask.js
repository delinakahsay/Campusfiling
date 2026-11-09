/* Campus Filing: the walkthrough assistant.

   POST /api/ask  { question, section, context }

   This is deliberately not a chatbot. The product's whole argument is
   that a student who has never filed does not know what to ask, so a
   blank prompt is the wrong interface. What this is instead: help with
   the section the student is already looking at. It knows which of the
   nine sections they are on, it answers about that, and it declines
   anything outside the subject rather than being obliging about it.

   Three limits are worth naming because they are the ones that keep
   this from becoming the thing the product rejected:

   The model is told what section the student is on and answers in that
   frame. It is given the derived figures, the same ones already sent to
   the filing guide, so it can answer "why is my refund that number"
   rather than reciting generalities. It never receives a name, a Social
   Security number, an employer or an address, because the walkthrough
   has no field for any of them.

   It answers through a tool rather than in free prose, so the reply
   arrives with a scope flag the server can act on and a length the
   server can enforce. A model that decides a question is off-topic says
   so in a field rather than in a paragraph that has to be parsed.

   And it is closed to anyone not signed in, like the other two
   endpoints that spend credits. */

const { callAnthropic } = require("./_anthropic.js");
const sb = require("./_supabase.js");

const MAX_QUESTION = 500;
const MAX_REPLY = 900;

const SECTIONS = [
  "Your status for tax purposes",
  "About you",
  "Can someone claim you",
  "Upload your documents",
  "Money that came in",
  "School money",
  "Other situations",
  "States and software",
  "Your filing plan"
];

const TOOL = {
  name: "answer",
  description: "Answer the student's question about the section they are on.",
  input_schema: {
    type: "object",
    properties: {
      reply: {
        type: "string",
        description: "The answer, in plain language, at most three short paragraphs. Empty when the question is out of scope."
      },
      in_scope: {
        type: "boolean",
        description: "False when the question is not about filing taxes as a student, or asks for something this tool must not give."
      },
      refusal: {
        type: "string",
        description: "When in_scope is false, one sentence saying what this assistant does instead. Empty otherwise."
      },
      section: {
        type: "integer",
        description: "1 to 9, the walkthrough section that answers this best, when it is not the one they are on. Omit otherwise."
      }
    },
    required: ["reply", "in_scope"]
  }
};

const SYSTEM = [
  "You are the helper inside Campus Filing, a guided tax walkthrough for university students.",
  "",
  "The student is partway through a nine-section walkthrough and has asked a question from the section they are on. Answer that question, in the context of that section, in plain language a first-time filer understands. Short is better: three paragraphs at the very most, usually one.",
  "",
  "Rules you do not bend:",
  "1. You give guidance, never tax advice, and never tell a student a figure to enter. Explain what a box means and where the number comes from on their own form.",
  "2. You never invent a figure. If the question is about their numbers, use only the figures given to you below. If a figure you need is not there, say which section supplies it.",
  "3. If the question is not about filing taxes as a student, set in_scope to false and fill refusal. That includes requests to write code, answer general knowledge, or discuss anything unrelated. Be brief and friendly about it.",
  "4. Nonresident students on F-1 or J-1 visas file Form 1040-NR and Form 8843 and must not be pointed at resident filing software. If the question touches this, say so.",
  "5. Never ask for, and never repeat, a Social Security number, a bank account number, an address or an employer name. The walkthrough does not collect them and neither do you.",
  "6. If another section of the walkthrough answers the question better, set section to its number so the student can be sent there.",
  "",
  "Always reply by calling the answer tool."
].join("\n");

/* Only the shapes the walkthrough itself produces. Anything else that
   arrives is dropped rather than passed upstream, so a crafted request
   cannot use this endpoint to send arbitrary text to the model. */
function cleanContext(c) {
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const n = function (v) { return typeof v === "number" && isFinite(v) ? Math.round(v) : null; };
  const s = function (v, max) { return typeof v === "string" && v.length <= (max || 90) ? v : null; };
  return {
    income: n(c.income),
    refund: n(c.refund),
    standardDeduction: n(c.standardDeduction),
    dependency: s(c.dependency, 60),
    mustFile: typeof c.mustFile === "boolean" ? c.mustFile : null,
    returns: s(c.returns, 160),
    status: s(c.status, 40)
  };
}

function describe(ctx) {
  if (!ctx) return "No figures yet: the student has not answered enough of the walkthrough.";
  const bits = [];
  if (ctx.status) bits.push("Tax status: " + ctx.status);
  if (ctx.dependency) bits.push("Dependency: " + ctx.dependency);
  if (ctx.income !== null) bits.push("Total income so far: $" + ctx.income);
  if (ctx.standardDeduction !== null) bits.push("Standard deduction: $" + ctx.standardDeduction);
  if (ctx.refund !== null) {
    bits.push(ctx.refund >= 0
      ? "Estimated refund: $" + ctx.refund
      : "Estimated amount owed: $" + Math.abs(ctx.refund));
  }
  if (ctx.mustFile !== null) bits.push("Required to file: " + (ctx.mustFile ? "yes" : "no, but filing is worthwhile"));
  if (ctx.returns) bits.push("Returns due: " + ctx.returns);
  return bits.length ? bits.join("\n") : "No figures yet.";
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sb.send(res, 405, { error: "POST only." });
  }
  if (!sb.sameOrigin(req)) {
    return sb.send(res, 403, { error: "That request did not come from this site." });
  }

  const token = await sb.requireSession(req, res);
  if (!token) return;

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object") {
    return sb.send(res, 400, { error: "Body was not JSON." });
  }

  const question = String(body.question || "").trim();
  if (!question) return sb.send(res, 400, { error: "Ask a question first." });
  if (question.length > MAX_QUESTION) {
    return sb.send(res, 413, { error: "That question is longer than this assistant takes. Try a shorter one." });
  }

  const index = Number(body.section);
  const sectionNumber = Number.isInteger(index) && index >= 1 && index <= 9 ? index : 1;
  const sectionName = SECTIONS[sectionNumber - 1];
  const ctx = cleanContext(body.context);

  const userMessage = [
    "Section " + sectionNumber + " of 9: " + sectionName,
    "",
    "What the walkthrough has worked out so far:",
    describe(ctx),
    "",
    "The student asks:",
    question
  ].join("\n");

  const result = await callAnthropic({
    system: SYSTEM,
    tool: TOOL,
    maxTokens: 1200,
    messages: [{ role: "user", content: userMessage }]
  });

  if (!result.ok) {
    return sb.send(res, result.status, result.body);
  }

  /* callAnthropic has already pulled the tool result out and reported
     truncation, so there is nothing left to parse here. */
  const answer = result.result;
  if (!answer || typeof answer !== "object") {
    return sb.send(res, 502, { error: "The answer came back in an unexpected shape. Try again." });
  }

  if (answer.in_scope === false) {
    return sb.send(res, 200, {
      inScope: false,
      reply: String(answer.refusal || "I can only help with filing taxes as a student. Ask me about the section you are on.").slice(0, 300)
    });
  }

  const reply = String(answer.reply || "").slice(0, MAX_REPLY);
  if (!reply) {
    return sb.send(res, 502, { error: "The answer came back empty. Try asking again." });
  }

  await sb.recordDocumentRead(token, "guide");

  res.setHeader("Cache-Control", "no-store");
  return sb.send(res, 200, {
    inScope: true,
    reply: reply,
    section: Number.isInteger(answer.section) && answer.section >= 1 && answer.section <= 9
      ? answer.section : null,
    sectionName: Number.isInteger(answer.section) && answer.section >= 1 && answer.section <= 9
      ? SECTIONS[answer.section - 1] : null
  });
};
