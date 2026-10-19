/* Campus Filing: the step-by-step filing guide.

   This is the point of the project. Everything before it, the questions,
   the dependency logic, the document reader, exists to get enough of a
   picture to produce this: open the software you picked, go to this
   screen, put this number in this box, skip that section and here is why.

   The alternative design was a chat window. It was rejected deliberately.
   A student who has never filed does not know what to ask, and a blank
   prompt asks them to supply the one thing they do not have. So the tool
   asks the questions and produces the sequence. The student is guided,
   not interviewed.

   What this receives is a tax situation: amounts, categorical answers,
   derived figures. It carries no name, no Social Security number, no
   employer, no address, because the walkthrough never collects any of
   those. Nothing is stored at either end. */

const { callAnthropic } = require("./_anthropic.js");

const MAX_OUTPUT_TOKENS = 6000;

const SOFTWARE = {
  freetaxusa: "FreeTaxUSA",
  turbotax: "TurboTax",
  freefile: "an IRS Free File partner product",
  fillable: "IRS Free File Fillable Forms",
  vita: "a VITA site, in person with a volunteer preparer",
  olt: "OLT.com",
  taxslayer: "TaxSlayer",
  cashapp: "Cash App Taxes"
};

const TOOL = {
  name: "write_guide",
  description: "Write the ordered, screen-by-screen guide for filing this return in the chosen software.",
  input_schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "One sentence telling the student what they are about to do and roughly how long it takes."
      },
      before_you_start: {
        type: "array",
        description: "What to have open or to hand before opening the software. Short imperative lines.",
        items: { type: "string" }
      },
      sections: {
        type: "array",
        description: "The guide itself, in the order the software presents it. One entry per screen or logical group of screens. Six to fourteen entries is typical.",
        items: {
          type: "object",
          properties: {
            screen: {
              type: "string",
              description: "What this screen is called in the product, as closely as you can name it, with where to find it. For example 'Personal Information, under the Personal tab' or 'Income > Wages (W-2)'."
            },
            what_to_do: {
              type: "string",
              description: "Two or three sentences on what happens on this screen and what the student should do."
            },
            entries: {
              type: "array",
              description: "The specific values to type on this screen. Omit where the screen needs no figures.",
              items: {
                type: "object",
                properties: {
                  box: { type: "string", description: "The field as the software labels it, e.g. 'Box 1, Wages, tips, other compensation'." },
                  value: { type: "string", description: "Exactly what to type, e.g. '500.00' or 'Yes' or 'Leave blank'." },
                  from: { type: "string", description: "Where this came from, e.g. 'Box 1 of your W-2' or 'your answer about living at home'." }
                },
                required: ["box", "value"]
              }
            },
            watch_out: {
              type: "string",
              description: "The mistake a student makes on this screen, if there is a common one. Leave empty otherwise."
            }
          },
          required: ["screen", "what_to_do"]
        }
      },
      after_filing: {
        type: "array",
        description: "What to do once it is submitted. Short lines.",
        items: { type: "string" }
      },
      skipped: {
        type: "array",
        description: "Screens or sections this student can skip, each with one clause saying why. This is as useful as the things to do.",
        items: { type: "string" }
      }
    },
    required: ["headline", "sections"]
  }
};

const SYSTEM = [
  "You write filing instructions for United States college students who have never filed a tax return, and who are sitting in front of the software with their documents.",
  "",
  "You are not a chat assistant and there is no one to ask you a follow-up question. Everything the student needs has to be in the guide. Assume they will follow it literally and in order.",
  "",
  "How to write it:",
  "",
  "1. Name the actual screens in the product, in the order that product presents them. 'Income, then Wages (W-2)' is useful. 'Enter your income' is not. If you are unsure of a product's exact wording, describe the screen by what it asks for and say where it usually sits in the navigation, rather than inventing a confident label.",
  "2. Give the actual numbers from this student's situation, not placeholders. If their wages are 500, write 500, never 'your wage figure'.",
  "3. Say what to skip and why. A student who does not know that the education credit belongs on their parents' return will hunt for it for twenty minutes.",
  "4. Name the mistake before they make it. The dependent checkbox, filing before a late 1099 arrives, claiming a credit that is not theirs, choosing a paid tier they do not need.",
  "5. Federal before state, and say so. If a nonresident state return is involved, that one comes before the resident return or the credit for tax paid to another state does not compute.",
  "6. Keep the reading level plain. Short sentences. No tax jargon without a five word gloss the first time.",
  "",
  "What not to do:",
  "",
  "Do not invent a figure that is not in the situation you were given. If something is needed and missing, say which document it comes from and tell the student to take it from there.",
  "Do not reproduce a product's copyrighted help text. Describe the screens in your own words.",
  "Do not give a figure for any box you were not told about. An empty box is an instruction too: say 'leave blank'.",
  "Do not promise a refund amount. The software computes it; the estimate in this tool is a sanity check.",
  "",
  "Always answer by calling the write_guide tool. Do not reply in prose."
].join("\n");

function describeSituation(s) {
  const lines = [];
  const money = function (n) { return "$" + Number(n || 0).toLocaleString("en-US"); };

  lines.push("Tax year: " + (s.taxYear || "the current year"));
  lines.push("Residency for tax purposes: " + (s.status || "not stated"));
  lines.push("Dependency: " + (s.dependency || "not determined") +
    (s.dependencyWhy ? " (" + s.dependencyWhy + ")" : ""));
  lines.push("Standard deduction that applies: " + money(s.standardDeduction));
  lines.push("Required to file: " + (s.mustFile ? "yes" : "no, but filing is still worthwhile") +
    (s.filingReasons && s.filingReasons.length ? " because " + s.filingReasons.join("; ") : ""));

  if (s.age) lines.push("Age: " + s.age);
  if (s.fullTimeStudent) lines.push("Full-time student for at least five months: yes");

  lines.push("");
  lines.push("Figures the student entered or confirmed from their documents:");
  const labels = {
    w2wage: "W-2 box 1 wages", w2fed: "federal income tax withheld",
    w2state: "state income tax withheld", tips: "social security tips",
    segross: "self-employment or gig gross income", seexp: "business expenses",
    interest: "interest income", dividends: "ordinary dividends",
    gains: "net capital gain or loss", unemp: "unemployment compensation",
    tuition: "1098-T box 1 tuition paid", scholarship: "1098-T box 5 scholarships and grants",
    books: "required books and supplies", roomboard: "room and board",
    loanint: "student loan interest paid", stipend: "fellowship or stipend"
  };
  let any = false;
  Object.keys(labels).forEach(function (k) {
    if (s.figures && typeof s.figures[k] === "number" && s.figures[k] !== 0) {
      any = true;
      lines.push("  " + labels[k] + ": " + money(s.figures[k]));
    }
  });
  if (!any) lines.push("  none entered");

  if (s.documents && s.documents.length) {
    lines.push("");
    lines.push("Documents they have: " + s.documents.join(", "));
  }

  lines.push("");
  lines.push("Derived:");
  if (typeof s.totalIncome === "number") lines.push("  total income " + money(s.totalIncome));
  if (typeof s.agi === "number") lines.push("  adjusted gross income " + money(s.agi));
  if (typeof s.taxableScholarship === "number" && s.taxableScholarship > 0) {
    lines.push("  taxable scholarship " + money(s.taxableScholarship) + ", which goes on Schedule 1 line 8r");
  }
  if (typeof s.seNet === "number" && s.seNet > 0) {
    lines.push("  net self-employment profit " + money(s.seNet) + ", needing Schedule C and Schedule SE");
  }
  if (typeof s.estimatedRefund === "number") {
    lines.push("  rough refund estimate " + money(s.estimatedRefund) + " (a sanity check, not a promise)");
  }

  lines.push("");
  lines.push("State situation: " + (s.states || "not determined"));

  if (s.flags && s.flags.length) {
    lines.push("");
    lines.push("Things flagged for this student:");
    s.flags.forEach(function (f) { lines.push("  " + f); });
  }

  if (s.educationCredit) {
    lines.push("");
    lines.push("Education credit: " + s.educationCredit);
  }

  return lines.join("\n");
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== "object" || !body.situation) {
    res.status(400).json({ error: "Send a situation to write a guide for." });
    return;
  }

  const key = typeof body.software === "string" ? body.software : "";
  const software = SOFTWARE[key];
  if (!software) {
    res.status(400).json({ error: "Pick one of the supported filing options first." });
    return;
  }

  const situation = describeSituation(body.situation);
  if (situation.length > 12000) {
    res.status(413).json({ error: "That situation is larger than this endpoint accepts." });
    return;
  }

  const prompt = [
    "Write the filing guide for this student, for " + software + ".",
    key === "vita"
      ? "They are going to a VITA site, so there are no software screens. Write the guide as what to bring, what the volunteer will ask, what to make sure gets onto the return, and what to check before signing."
      : (key === "fillable"
        ? "Fillable Forms have no interview. Write the guide in terms of the actual forms and line entries, naming each form and what goes where."
        : "Name the product's own screens and the order it presents them in."),
    "",
    situation
  ].join("\n");

  const out = await callAnthropic({
    system: SYSTEM,
    tool: TOOL,
    maxTokens: MAX_OUTPUT_TOKENS,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
  });

  if (!out.ok) {
    res.status(out.status).json(out.body);
    return;
  }

  const g = out.result;
  const sections = Array.isArray(g.sections) ? g.sections : [];

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    software: software,
    softwareKey: key,
    headline: typeof g.headline === "string" ? g.headline : "",
    beforeYouStart: Array.isArray(g.before_you_start) ? g.before_you_start.slice(0, 10) : [],
    sections: sections.slice(0, 20).map(function (s) {
      return {
        screen: String(s.screen || ""),
        whatToDo: String(s.what_to_do || ""),
        entries: Array.isArray(s.entries) ? s.entries.slice(0, 12).map(function (e) {
          return { box: String(e.box || ""), value: String(e.value || ""), from: String(e.from || "") };
        }) : [],
        watchOut: String(s.watch_out || "")
      };
    }),
    afterFiling: Array.isArray(g.after_filing) ? g.after_filing.slice(0, 10) : [],
    skipped: Array.isArray(g.skipped) ? g.skipped.slice(0, 12) : []
  });
};
