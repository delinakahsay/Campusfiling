/* Campus Filing: the step-by-step filing guide.

   Everything before this exists to make this possible. The questions, the
   dependency tests, the document reader: all of it is building a picture
   complete enough to say open this product, go to this screen, type this
   number in this box, skip that section and here is why.

   The design this replaces was a chat window. A student who has never
   filed does not know what to ask, and a blank prompt demands the one
   thing they do not have. So the tool asks the questions and hands back a
   sequence. Guided, not interviewed.

   Nothing here is generic. The figures in the guide are the student's own
   figures, read off their own documents. */

const GUIDE_ENDPOINT = "/api/filing-guide.js".replace(/\.js$/, "");
const GUIDE_TIMEOUT_MS = 70000;

/* Everything the guide writer needs, and nothing it does not. There is no
   name, no Social Security number, no employer and no address in here,
   because the walkthrough never collects any of them. */
function buildSituation() {
  const d = derive();
  const figures = {};
  ["w2wage", "w2fed", "w2state", "tips", "stipend", "segross", "seexp",
   "interest", "dividends", "gains", "unemp", "tuition", "scholarship",
   "books", "roomboard", "loanint"].forEach(function (k) {
    if (typeof A[k] === "number" && A[k] !== 0) figures[k] = A[k];
  });

  const states = d.states;
  const stateParts = stateSummary(states);

  const flags = [];
  if (A.marketplace === "yes") flags.push("Has marketplace insurance, so needs Form 1095-A and Form 8962 before filing.");
  if (A.foreign === "yes") flags.push("Has a foreign account, which may require an FBAR filed separately through FinCEN.");
  if (A.retire === "yes") flags.push("Contributed to a retirement account, but is disqualified from the Saver's Credit as a full-time student or dependent.");
  if (A.gains < 0) flags.push("Has an investment loss, so needs Schedule D and Form 8949.");
  if (A.extra.indexOf("dependent_own") > -1) flags.push("Has a dependent of their own, which opens the Child Tax Credit and possibly the Earned Income Credit.");
  if (A.extra.indexOf("moved") > -1) flags.push("Moved during the year, so at least one state return is part-year.");
  if (A.extra.indexOf("prior") > -1) flags.push("Has unfiled prior years, which need that year's forms and that year's software.");
  if (A.confirmed === "no") flags.push("Has not confirmed the dependency question with their parents yet.");
  if (d.taxableScholarship > 0) flags.push("Part of their aid is taxable and goes on Schedule 1 line 8r, not on the wages line.");

  let educationCredit = "";
  if (d.treatAsDependent) {
    educationCredit = "The 1098-T and the education credit belong on the return of whoever claims them, not on this one. They should send their parents the form and their book receipts.";
  } else if (A.halftime === "yes") {
    educationCredit = "They can claim the American Opportunity Credit themselves on Form 8863." +
      ((A.age !== null && A.age < TAX.studentAgeLimit)
        ? " The refundable portion is disallowed because they are under " + TAX.studentAgeLimit + " with a living parent, unless they provided more than half their own support from earned income."
        : " Up to " + money(TAX.aotcRefundable) + " of it is refundable.");
  } else {
    educationCredit = "Not enrolled at least half time, so the American Opportunity Credit does not apply. The Lifetime Learning Credit on Form 8863 has no enrollment minimum.";
  }

  return {
    taxYear: TAX.year,
    status: A.status === "citizen" ? "resident for tax purposes"
      : (A.status === "nra" ? "nonresident alien" : A.status),
    dependency: d.dep.status,
    dependencyWhy: d.dep.test || d.dep.why || "",
    standardDeduction: d.sd,
    mustFile: d.mustFile,
    filingReasons: d.reasons,
    age: A.age,
    fullTimeStudent: A.fulltime === "yes",
    figures: figures,
    documents: A.havedoc.slice(),
    totalIncome: d.total,
    agi: d.agi,
    taxableScholarship: d.taxableScholarship,
    seNet: d.seNet,
    estimatedRefund: d.refund,
    states: stateParts.length ? stateParts.join(", ") : "federal only",
    flags: flags,
    educationCredit: educationCredit
  };
}

async function fetchGuide(softwareKey) {
  const controller = new AbortController();
  const timer = setTimeout(function () { controller.abort(); }, GUIDE_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(GUIDE_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ software: softwareKey, situation: buildSituation() })
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e && e.name === "AbortError"
      ? "That took too long. Try again, or use the worksheet below instead."
      : "Could not reach the guide service. Try again, or use the worksheet below instead.");
  }
  clearTimeout(timer);

  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  if (!res.ok) throw new Error((payload && payload.error) || "The guide could not be written. Try again.");
  if (!payload) throw new Error("The guide service returned something unreadable.");
  return payload;
}

/* ---------- rendering ---------- */

function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderGuide(g) {
  const box = $("guide");
  if (!box) return;

  let h = '<div class="guide">';
  h += '<div class="guide-head">' +
    '<p class="eyebrow">Step by step</p>' +
    '<h3>Filing in ' + esc(g.software) + '</h3>' +
    (g.headline ? '<p class="lede">' + esc(g.headline) + '</p>' : "") +
    '</div>';

  h += '<div class="note note-warn"><p><strong>Check every figure against your own forms before you submit.</strong> ' +
    'This is a student project, not tax preparation, and the screens in any product get renamed and rearranged. ' +
    'If what you see does not match what is written here, trust the screen in front of you.</p></div>';

  if (g.beforeYouStart && g.beforeYouStart.length) {
    h += '<h4>Before you open it</h4><ul class="checklist">' +
      g.beforeYouStart.map(function (x) {
        return '<li><span class="mark">&#9744;</span><span>' + esc(x) + '</span></li>';
      }).join("") + '</ul>';
  }

  h += '<ol class="guide-steps">';
  (g.sections || []).forEach(function (s, i) {
    h += '<li class="guide-step">' +
      '<div class="gs-num">' + (i + 1) + '</div>' +
      '<div class="gs-body">' +
      '<h4>' + esc(s.screen) + '</h4>' +
      '<p>' + esc(s.whatToDo) + '</p>';

    if (s.entries && s.entries.length) {
      h += '<table class="data gs-entries"><thead><tr><th>Field</th><th>What to enter</th><th>From</th></tr></thead><tbody>' +
        s.entries.map(function (e) {
          return '<tr><td>' + esc(e.box) + '</td>' +
            '<td class="num"><strong>' + esc(e.value) + '</strong></td>' +
            '<td class="gs-from">' + esc(e.from) + '</td></tr>';
        }).join("") + '</tbody></table>';
    }

    if (s.watchOut) {
      h += '<p class="gs-watch"><strong>Watch out.</strong> ' + esc(s.watchOut) + '</p>';
    }

    h += '</div></li>';
  });
  h += '</ol>';

  if (g.skipped && g.skipped.length) {
    h += '<h4>You can skip these</h4><ul class="guide-skip">' +
      g.skipped.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join("") + '</ul>';
  }

  if (g.afterFiling && g.afterFiling.length) {
    h += '<h4>Once you have submitted</h4><ul class="checklist">' +
      g.afterFiling.map(function (x) {
        return '<li><span class="mark">&#9744;</span><span>' + esc(x) + '</span></li>';
      }).join("") + '</ul>';
  }

  h += '</div>';

  box.innerHTML = h;
  box.hidden = false;
}

/* ---------- the button that appears once a product is picked ---------- */

function offerGuide(softwareKey, softwareName) {
  const slot = $("guide-launch");
  if (!slot) return;

  slot.innerHTML = '<div class="btn-row">' +
    '<button type="button" class="btn btn-green" id="build-guide">Show me what to fill in on ' + esc(softwareName) + '</button>' +
    '<span class="aside" id="guide-status"></span></div>';

  const btn = $("build-guide");
  btn.addEventListener("click", function () {
    btn.disabled = true;
    btn.textContent = "Writing your guide";
    const status = $("guide-status");
    if (status) status.textContent = "This takes a few seconds. It is being written for your figures, not picked off a shelf.";

    fetchGuide(softwareKey).then(function (g) {
      renderGuide(g);
      btn.disabled = false;
      btn.textContent = "Rewrite the guide";
      if (status) status.textContent = "";
      const guide = $("guide");
      if (guide) guide.scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (e) {
      btn.disabled = false;
      btn.textContent = "Try again";
      if (status) status.textContent = (e && e.message) || "That did not work.";
    });
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildSituation, renderGuide };
}
