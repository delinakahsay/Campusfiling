/* Campus Filing: the nine section walkthrough.
   Requires tax-constants.js to be loaded first.

   Nothing persists. Answers live in the A object and are gone when the
   tab closes or reloads. That is deliberate, see privacy.html. */

/* Sample values used to demonstrate the prefill interaction. This is not
   document parsing. Filenames are matched and canned figures are loaded,
   which is why every message says "sample values" rather than "read". */
const SAMPLE_LOADERS = [
  { match: /w-?2/i, label: "W-2", fields: { w2wage: 7840, w2fed: 412, w2state: 186 }, accumulate: true },
  { match: /1098-?t/i, label: "1098-T", fields: { tuition: 28450, scholarship: 31200 } },
  { match: /1098-?e/i, label: "1098-E", fields: { loanint: 640 } },
  { match: /1099-?(nec|k|misc)/i, label: "1099-NEC", fields: { segross: 3120 } },
  { match: /1099-?(int|div)/i, label: "1099-INT", fields: { interest: 84 } },
  { match: /1095-?a/i, label: "1095-A", fields: {} },
  { match: /1099-?g/i, label: "1099-G", fields: { unemp: 1200 } }
];

const SECTIONS = [
  "Your status", "About you", "Dependency", "Documents", "Income",
  "School money", "Other situations", "States and software", "Your filing plan"
];

const A = { extra: [], files: [] };
let current = 0;
let furthest = 0;
let fileSeq = 0;

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

function init() {
  SECTIONS.forEach(function (name, i) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    const n = document.createElement("span");
    n.className = "num";
    n.textContent = String(i + 1);
    const t = document.createElement("span");
    t.textContent = name;
    b.appendChild(n);
    b.appendChild(t);
    b.addEventListener("click", function () { if (i <= furthest) go(i); });
    li.appendChild(b);
    $("steps").appendChild(li);
  });

  ["homestate", "schoolstate"].forEach(function (id) {
    const sel = $(id);
    sel.innerHTML = "";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Select";
    sel.appendChild(blank);
    STATES.forEach(function (s) {
      const o = document.createElement("option");
      o.value = s;
      o.textContent = s;
      sel.appendChild(o);
    });
  });

  document.querySelectorAll("[data-back]").forEach(function (b) {
    b.addEventListener("click", function () { go(parseInt(b.dataset.back, 10) - 1); });
  });

  document.querySelectorAll("[data-next]").forEach(function (b) {
    b.addEventListener("click", function () {
      const step = parseInt(b.dataset.next, 10);
      if (!validate(step)) return;
      go(step + 1);
    });
  });

  wireRail();
  wireReactions();
  wireFiles();

  document.addEventListener("input", function () {
    document.querySelectorAll(".error").forEach(function (e) { e.textContent = ""; });
    refreshSummary();
  });
  document.addEventListener("change", refreshSummary);

  $("print").addEventListener("click", function () { window.print(); });
  $("restart").addEventListener("click", restart);

  go(0);
}

/* ---------- navigation ---------- */

function wireRail() {
  const rail = $("rail-disclosure");
  if (!rail) return;
  const compact = window.matchMedia("(max-width: 940px)");
  function syncRail() { rail.open = !compact.matches; }
  syncRail();
  compact.addEventListener("change", syncRail);
}

function go(i) {
  current = i;
  furthest = Math.max(furthest, i);

  /* The plan is rebuilt every time section nine is entered, from any
     route, so a changed answer can never leave a stale plan on screen. */
  if (i === SECTIONS.length - 1) buildPlan();

  for (let k = 0; k < SECTIONS.length; k++) {
    const p = $("p" + k);
    if (p) p.hidden = k !== i;
  }
  $("steps").querySelectorAll("button").forEach(function (b, k) {
    b.classList.toggle("active", k === i);
    b.classList.toggle("done", k < furthest);
    b.disabled = k > furthest;
    if (k === i) b.setAttribute("aria-current", "step");
    else b.removeAttribute("aria-current");
  });

  refreshSummary();
  const progress = $("mobile-progress");
  if (progress) progress.textContent = "Step " + (i + 1) + " of " + SECTIONS.length + " · " + SECTIONS[i];
  const rail = $("rail-disclosure");
  if (rail && window.matchMedia("(max-width: 940px)").matches) rail.open = false;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });

  /* Move keyboard focus to the new section heading. */
  const heading = $("p" + i) && $("p" + i).querySelector("h2");
  if (heading) { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }
}

/* ---------- reading answers ---------- */

function radio(name) {
  const el = document.querySelector('input[name="' + name + '"]:checked');
  return el ? el.value : null;
}

function num(id) {
  const v = $(id).value;
  if (v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) || n < 0 ? 0 : n;
}

function numSigned(id) {
  const v = $(id).value;
  if (v === "") return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

const MONEY_FIELDS = ["w2wage", "w2fed", "w2state", "tips", "segross", "seexp",
  "interest", "dividends", "unemp", "tuition", "scholarship",
  "books", "roomboard", "loanint"];

function collect() {
  A.status = radio("status");
  A.ssn = radio("ssn");
  A.age = $("age").value === "" ? null : parseInt($("age").value, 10);
  A.year = $("year").value;
  A.marital = radio("marital");
  A.fulltime = radio("fulltime");
  A.support = radio("support");
  A.lived = radio("lived");
  A.confirmed = radio("confirmed");
  MONEY_FIELDS.forEach(function (k) { A[k] = num(k); });
  A.gains = numSigned("gains");
  A.aotc = radio("aotc");
  A.halftime = radio("halftime");
  A.marketplace = radio("marketplace");
  A.retire = radio("retire");
  A.foreign = radio("foreign");
  A.extra = Array.from(document.querySelectorAll('input[name="extra"]:checked')).map(function (e) { return e.value; });
  A.homestate = $("homestate").value;
  A.schoolstate = $("schoolstate").value;
  A.workedschool = $("workedschool").value;
  A.workedother = $("workedother").value;
  A.software = radio("software");
}

/* ---------- dependency ---------- */

/* Returns one of: dependent, independent, undetermined, unsupported.
   The old build tested only the qualifying child rules and treated an
   "I am not sure" support answer as a definitive dependent result. Both
   were wrong, and both could flip the standard deduction. */
function dependencyStatus(earned) {
  if (A.age === null) return { status: "undetermined", why: "age not answered" };

  if (A.marital === "married") {
    return {
      status: "unsupported",
      why: "Married filers need joint or separate brackets and a different set of dependency rules. This walkthrough only handles single filers."
    };
  }

  const qualifyingChild =
    A.age < TAX.qualifyingChildAge ||
    (A.age < TAX.studentAgeLimit && A.fulltime === "yes");

  if (A.support === "unsure") {
    return {
      status: "undetermined",
      why: "You are not sure whether you paid more than half of your own support. That one answer decides your standard deduction, so it has to be resolved before you file."
    };
  }

  const paysOwnWay = A.support === "yes";
  const livesApart = A.lived === "own";

  if (qualifyingChild && !paysOwnWay && !livesApart) {
    return { status: "dependent", test: "qualifying child" };
  }

  /* Qualifying relative. A student too old for the child test can still
     be a dependent if their gross income is under the exemption amount
     and someone else provides more than half their support. */
  if (!paysOwnWay && earned < TAX.qualifyingRelativeIncomeTest) {
    return { status: "dependent", test: "qualifying relative" };
  }

  return { status: "independent" };
}

/* ---------- the math ---------- */

function derive() {
  const seNet = Math.max(0, (A.segross || 0) - (A.seexp || 0));

  /* Qualified education expenses for a tax free scholarship include
     tuition, required fees, and required books and supplies. The old
     build ignored books, which overstated taxable scholarship. */
  const qualifiedEd = (A.tuition || 0) + (A.books || 0);
  const taxableScholarship = Math.max(0, (A.scholarship || 0) - qualifiedEd);

  const earned = (A.w2wage || 0) + (A.tips || 0) + seNet + taxableScholarship;

  /* Capital losses offset other income up to the annual limit. */
  const netGains = Math.max(-TAX.capitalLossLimit, A.gains || 0);
  const unearned = (A.interest || 0) + (A.dividends || 0) + netGains + (A.unemp || 0);

  const total = earned + unearned;

  const dep = dependencyStatus(earned);
  const treatAsDependent = dep.status === "dependent" || dep.status === "undetermined";

  const sd = treatAsDependent
    ? dependentStandardDeduction(earned, TAX)
    : TAX.singleStandardDeduction;

  /* Adjustments to income, applied before tax is calculated. */
  const halfSe = halfSelfEmploymentDeduction(seNet, TAX);
  const provisionalAgi = Math.max(0, total - halfSe);
  const loanDeduction = studentLoanDeduction(A.loanint || 0, provisionalAgi, treatAsDependent, TAX);
  const agi = Math.max(0, total - halfSe - loanDeduction);

  /* Filing thresholds. Publication 501 phrases these as "at least",
     so the comparison is >= rather than >. */
  const reasons = [];
  if (treatAsDependent) {
    if (earned >= TAX.singleStandardDeduction) reasons.push("earned income of " + money(TAX.singleStandardDeduction) + " or more");
    if (unearned >= TAX.unearnedFilingTrigger) reasons.push("unearned income of " + money(TAX.unearnedFilingTrigger) + " or more");
    if (total >= sd && total > 0) reasons.push("total income at or above your " + money(sd) + " standard deduction");
  } else if (total >= TAX.singleStandardDeduction) {
    reasons.push("income of " + money(TAX.singleStandardDeduction) + " or more");
  }
  if (seNet >= TAX.selfEmploymentTrigger) reasons.push("net self-employment income of " + money(TAX.selfEmploymentTrigger) + " or more");
  if (A.marketplace === "yes") reasons.push("marketplace insurance requiring Form 8962");

  const taxable = Math.max(0, agi - sd);
  const incomeTax = federalIncomeTax(taxable, TAX);
  const seTax = selfEmploymentTax(seNet, TAX);
  const totalTax = incomeTax + seTax;
  const refund = (A.w2fed || 0) - totalTax;

  return {
    seNet, taxableScholarship, qualifiedEd, earned, unearned, netGains, total,
    dep, treatAsDependent, sd, halfSe, loanDeduction, agi,
    reasons, mustFile: reasons.length > 0,
    taxable, incomeTax, seTax, totalTax, refund,
    states: stateReturns()
  };
}

/* ---------- state logic ---------- */

/* Returns an object describing every state obligation, including the
   case where a state does not tax nonresident wages at all. */
function stateReturns() {
  const home = A.homestate, school = A.schoolstate, worked = A.workedschool;
  const out = { resident: null, nonresident: [], refundOnly: [], notes: [], thirdState: A.workedother === "yes" };

  if (!home) return out;
  if (NO_INCOME_TAX.indexOf(home) === -1) out.resident = home;

  if (school && worked === "yes" && school !== home) {
    if (NO_INCOME_TAX.indexOf(school) > -1) {
      out.notes.push(school + " does not tax wage income, so there is nothing to file there.");
    } else if (NONRESIDENT_WAGE_EXEMPT[school]) {
      out.refundOnly.push(school);
      out.notes.push(NONRESIDENT_WAGE_EXEMPT[school].note);
    } else if (RECIPROCITY[school] && RECIPROCITY[school].indexOf(home) > -1) {
      out.notes.push(school + " and " + home + " have a reciprocity agreement, so " + school +
        " does not tax your wages. File a nonresidence certificate with your employer so they stop withholding " +
        school + " tax, and report the wages on your " + home + " return.");
    } else {
      out.nonresident.push(school);
    }
  }

  return out;
}

function stateCount(s) {
  return (s.resident ? 1 : 0) + s.nonresident.length + s.refundOnly.length + (s.thirdState ? 1 : 0);
}

function stateSummary(s) {
  const parts = [];
  if (s.resident) parts.push(s.resident + " resident");
  s.nonresident.forEach(function (x) { parts.push(x + " nonresident"); });
  s.refundOnly.forEach(function (x) { parts.push(x + " refund claim"); });
  if (s.thirdState) parts.push("a third state");
  return parts;
}

/* ---------- live summary ---------- */

function refreshSummary() {
  collect();
  const d = derive();

  const depLabel = {
    dependent: "Claimed by parents",
    independent: "Files independently",
    undetermined: "Needs one more answer",
    unsupported: "Not supported here"
  }[d.dep.status];

  $("sum-dep").textContent = depLabel;
  $("sum-sd").textContent = A.age === null ? "Not calculated" : money(d.sd);
  $("sum-inc").textContent = money(d.total);
  $("sum-req").textContent = A.age === null ? "Not determined" : (d.mustFile ? "Yes" : "No, but file anyway");

  const parts = stateSummary(d.states);
  $("sum-ret").textContent = parts.length ? "Federal plus " + parts.join(", ") : "Federal only";

  $("sum-refund").textContent = d.refund >= 0 ? money(d.refund) : money(Math.abs(d.refund)) + " owed";
  $("sum-refund").style.color = d.refund >= 0 ? "var(--forest)" : "var(--rust)";
}

/* ---------- inline reactions ---------- */

function wireReactions() {
  document.querySelectorAll('input[name="status"]').forEach(function (el) {
    el.addEventListener("change", function () {
      $("nra-warn").hidden = radio("status") !== "nra";
      $("spt-warn").hidden = radio("status") !== "unsure";
    });
  });

  document.querySelectorAll('input[name="marital"]').forEach(function (el) {
    el.addEventListener("change", function () { $("married-warn").hidden = radio("marital") !== "married"; });
  });

  document.querySelectorAll('input[name="marketplace"]').forEach(function (el) {
    el.addEventListener("change", function () { $("mkt-warn").hidden = radio("marketplace") !== "yes"; });
  });

  ["support", "lived", "confirmed"].forEach(function (n) {
    document.querySelectorAll('input[name="' + n + '"]').forEach(function (el) {
      el.addEventListener("change", function () {
        collect();
        if (!A.support || !A.lived) return;
        const d = derive();
        const box = $("dep-verdict");
        box.hidden = false;
        if (d.dep.status === "dependent") {
          box.className = "note";
          box.innerHTML = "You meet the " + d.dep.test + " test, so someone can claim you. On <span class='formref'>Form 1040</span> page one you check the box reading <strong>Someone can claim you as a dependent</strong>, and your standard deduction is limited to " + money(d.sd) + " instead of the full " + money(TAX.singleStandardDeduction) + ".";
        } else if (d.dep.status === "independent") {
          box.className = "note note-good";
          box.innerHTML = "Nobody can claim you under either the qualifying child or qualifying relative test. You leave the dependent box unchecked and take the full " + money(TAX.singleStandardDeduction) + " standard deduction. Confirm with your parents before filing.";
        } else {
          box.className = "note note-warn";
          box.innerHTML = "<strong>Unresolved.</strong> " + d.dep.why + " The rest of this walkthrough will assume you are a dependent, which is the more common answer for a student, but treat that as provisional until you work through the support worksheet in <span class='formref'>Publication 501</span> with your parents.";
        }
      });
    });
  });

  ["segross", "seexp"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      const net = Math.max(0, num("segross") - num("seexp"));
      const w = $("se-warn");
      w.hidden = net < TAX.selfEmploymentTrigger;
      if (!w.hidden) {
        w.innerHTML = "Net profit of " + money(net) + " crosses the " + money(TAX.selfEmploymentTrigger) +
          " threshold, so you owe self-employment tax of roughly " + money(selfEmploymentTax(net, TAX)) +
          " and file <span class='formref'>Schedule C</span> and <span class='formref'>Schedule SE</span>. Half of that tax comes back as a deduction against your income. Nobody withheld any of it for you.";
      }
    });
  });

  ["tuition", "scholarship", "books", "roomboard"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      const qualified = num("tuition") + num("books");
      const excess = Math.max(0, num("scholarship") - qualified);
      const w = $("sch-warn");
      w.hidden = excess <= 0;
      if (!w.hidden) {
        w.innerHTML = money(excess) + " of scholarship money exceeded your qualified expenses of " + money(qualified) +
          " in tuition, required fees, books and supplies. That excess is taxable income, and it goes on <span class='formref'>Schedule 1, line 8r</span>, described there as scholarship and fellowship grants not reported on Form W-2. Software usually files this under a less common income screen that is easy to miss.";
      }
    });
  });

  ["homestate", "schoolstate", "workedschool"].forEach(function (id) {
    $(id).addEventListener("change", function () {
      collect();
      const n = $("state-note");
      if (!A.homestate || !A.schoolstate || !A.workedschool) { n.hidden = true; return; }
      const s = stateReturns();
      n.hidden = false;
      n.className = "note";
      const bits = [];
      if (A.homestate === A.schoolstate) {
        bits.push(NO_INCOME_TAX.indexOf(A.homestate) > -1
          ? A.homestate + " has no state income tax on wages, so you file federal only."
          : "Home and school are both " + A.homestate + ", so you file one resident return there.");
      } else {
        bits.push("Going to school in " + A.schoolstate + " does not change your domicile. You remain a " + A.homestate + " resident.");
        s.notes.forEach(function (x) { bits.push(x); });
        if (s.nonresident.length) {
          bits.push("File the <strong>" + s.nonresident[0] + " nonresident return first</strong>, then your " + A.homestate +
            " resident return, claiming a credit for tax paid to " + s.nonresident[0] +
            ". In the other order the credit will not calculate and you will pay twice on the same wages.");
        }
      }
      n.innerHTML = bits.map(function (b) { return "<p>" + b + "</p>"; }).join("");
    });
  });

  document.querySelectorAll('input[name="software"]').forEach(function (el) {
    el.addEventListener("change", function () {
      const n = $("soft-note");
      if (radio("software") === "turbotax") {
        n.hidden = false;
        n.innerHTML = "Worth knowing before you commit. TurboTax's free edition covers only simple returns, and adding a 1098-T, a 1099-NEC, or a state return typically moves you to a paid tier. Intuit settled with the Federal Trade Commission over how that free edition was advertised. FreeTaxUSA handles the same forms at no federal cost.";
      } else {
        n.hidden = true;
      }
    });
  });
}

/* ---------- files ---------- */

function wireFiles() {
  const drop = $("drop"), input = $("files");

  $("browse").addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function (e) { handleFiles(e.target.files); input.value = ""; });

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { handleFiles(e.dataTransfer.files); });
}

function handleFiles(list) {
  let loaded = 0;

  Array.from(list).forEach(function (f) {
    const hit = SAMPLE_LOADERS.find(function (x) { return x.match.test(f.name); });
    const rec = { id: ++fileSeq, name: f.name, size: f.size, label: hit ? hit.label : null, applied: {} };
    A.files.push(rec);
    if (!hit) return;

    Object.keys(hit.fields).forEach(function (k) {
      const el = $(k);
      if (!el) return;
      const value = hit.fields[k];
      const currentValue = el.value === "" ? 0 : parseFloat(el.value) || 0;

      /* Multiple W-2s accumulate rather than the second being ignored. */
      if (hit.accumulate) {
        el.value = currentValue + value;
        rec.applied[k] = value;
      } else if (currentValue === 0) {
        el.value = value;
        rec.applied[k] = value;
      } else {
        return;
      }

      el.classList.add("prefilled");
      const tag = document.querySelector('[data-tag="' + k + '"]');
      if (tag) tag.classList.add("on");
      loaded++;
    });

    if (hit.label === "1095-A") {
      const mk = document.querySelector('input[name="marketplace"][value="yes"]');
      if (mk) { mk.checked = true; $("mkt-warn").hidden = false; rec.applied.marketplace = true; }
    }
  });

  renderFiles();

  const note = $("extract-note");
  if (loaded) {
    note.hidden = false;
    note.textContent = "Loaded " + loaded + " sample value" + (loaded === 1 ? "" : "s") +
      " from the filenames you dropped in. These are demonstration figures, not readings of your documents. Replace every one of them with the real numbers from your forms before you file.";
  }
  refreshSummary();
}

/* Removing a document also removes the values it put in, so the plan
   never reflects a document that is no longer listed. */
function removeFile(id) {
  const idx = A.files.findIndex(function (f) { return f.id === id; });
  if (idx === -1) return;
  const rec = A.files[idx];

  Object.keys(rec.applied).forEach(function (k) {
    if (k === "marketplace") {
      const mk = document.querySelector('input[name="marketplace"][value="yes"]');
      if (mk) { mk.checked = false; $("mkt-warn").hidden = true; }
      return;
    }
    const el = $(k);
    if (!el) return;
    const currentValue = el.value === "" ? 0 : parseFloat(el.value) || 0;
    const next = Math.max(0, currentValue - rec.applied[k]);
    el.value = next === 0 ? "" : next;
    if (next === 0) {
      el.classList.remove("prefilled");
      const tag = document.querySelector('[data-tag="' + k + '"]');
      if (tag) tag.classList.remove("on");
    }
  });

  A.files.splice(idx, 1);
  renderFiles();
  refreshSummary();
}

/* Filenames are user supplied. They go in with textContent, never
   innerHTML, so a crafted filename cannot inject markup. */
function renderFiles() {
  const ul = $("filelist");
  ul.innerHTML = "";

  A.files.forEach(function (f) {
    const li = document.createElement("li");

    const grow = document.createElement("div");
    grow.className = "grow";
    const nameEl = document.createElement("div");
    nameEl.className = "fname";
    nameEl.textContent = f.name;
    const metaEl = document.createElement("div");
    metaEl.className = "fmeta";
    metaEl.textContent = Math.max(1, Math.round(f.size / 1024)) + " KB";
    grow.appendChild(nameEl);
    grow.appendChild(metaEl);

    const tag = document.createElement("span");
    tag.className = "tag" + (f.label ? "" : " tag-muted");
    tag.textContent = f.label ? "Sample values for " + f.label : "Not recognized";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Remove";
    btn.setAttribute("aria-label", "Remove " + f.name);
    btn.addEventListener("click", function () { removeFile(f.id); });

    li.appendChild(grow);
    li.appendChild(tag);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

/* ---------- validation ---------- */

function fail(step, msg) {
  const el = document.querySelector('[data-err="' + step + '"]');
  el.textContent = msg;
  el.focus({ preventScroll: false });
  return false;
}

function validate(step) {
  document.querySelectorAll(".error").forEach(function (e) { e.textContent = ""; });
  if (step === 0) {
    if (!radio("status")) return fail(0, "Choose one to continue.");
    if (!radio("ssn")) return fail(0, "Answer the identification question.");
  }
  if (step === 1) {
    const a = parseInt($("age").value, 10);
    if (isNaN(a) || a < 13 || a > 99) return fail(1, "Enter your age as a number between 13 and 99.");
    if (!radio("marital")) return fail(1, "Choose your marital status.");
    if (!radio("fulltime")) return fail(1, "Answer the full-time student question.");
  }
  if (step === 2) {
    if (!radio("support")) return fail(2, "Answer the support question.");
    if (!radio("lived")) return fail(2, "Answer where you lived.");
    if (!radio("confirmed")) return fail(2, "Answer the question about your parents.");
  }
  if (step === 4) {
    const negatives = MONEY_FIELDS.filter(function (k) {
      const raw = $(k) ? $(k).value : "";
      return raw !== "" && parseFloat(raw) < 0;
    });
    if (negatives.length) return fail(4, "Amounts cannot be negative. Only the investment gains box accepts a loss.");
  }
  if (step === 5) {
    if (!radio("aotc")) return fail(5, "Answer the prior credit question.");
    if (!radio("halftime")) return fail(5, "Answer the enrollment question.");
  }
  if (step === 6) {
    if (!radio("marketplace")) return fail(6, "Answer the health coverage question.");
    if (!radio("retire")) return fail(6, "Answer the retirement question.");
    if (!radio("foreign")) return fail(6, "Answer the foreign account question.");
  }
  if (step === 7) {
    if (!$("homestate").value) return fail(7, "Choose your home state.");
    if (!$("schoolstate").value) return fail(7, "Choose your school's state.");
    if (!$("workedschool").value) return fail(7, "Answer whether you worked in your school's state.");
    if (!$("workedother").value) return fail(7, "Answer the third state question.");
    if (!radio("software")) return fail(7, "Choose how you plan to file.");
  }
  return true;
}

/* ---------- the plan ---------- */

function card(kind, title, paras) {
  return '<div class="result-card is-' + kind + '"><h3>' + title + '</h3>' +
    paras.map(function (p) { return "<p>" + p + "</p>"; }).join("") + '</div>';
}

function buildPlan() {
  collect();
  const d = derive();
  const out = $("plan");
  if (!out) return;

  if (A.status === "nra") {
    out.innerHTML = card("stop", "You are on a different track entirely", [
      "You file <span class='formref'>Form 1040-NR</span> and <span class='formref'>Form 8843</span>. Form 8843 is required even with zero income.",
      "TurboTax and FreeTaxUSA cannot produce a nonresident return. They will accept your data and generate a Form 1040, which is the wrong form and creates problems at visa renewal or a green card application later.",
      "Contact your international student office. Most universities buy Sprintax access codes and give them out free. If you have already filed a 1040 in a prior year, you can correct it with <span class='formref'>Form 1040-X</span>.",
      "Full detail is in the <a href='../guides/international.html'>international students guide</a>."
    ]);
    return;
  }

  let h = "";

  if (A.status === "unsure") {
    h += card("flag", "Settle your tax residency first", [
      "You answered that you are not sure whether you are a resident for tax purposes. Everything below assumes you are. If you are on an F-1 or J-1 visa, it may not apply at all.",
      "The substantial presence test counts your days in the United States: all days this year, one third of last year's days, and one sixth of the year before. Reach 183 and you are a resident for tax purposes. F-1 and J-1 students do not count any days for their first five calendar years, and J-1 scholars for their first two.",
      "If you have been on an F or J visa for five years or less, stop and read the <a href='../guides/international.html'>international students guide</a> instead of continuing."
    ]);
  }

  if (d.dep.status === "unsupported") {
    h += card("stop", "This walkthrough cannot handle your situation", [
      d.dep.why,
      "A married filer needs married filing jointly or separately brackets, a different standard deduction, and a dependency analysis that accounts for your spouse. Producing a single filer answer for you would be wrong rather than approximate, so nothing below is calculated.",
      "A VITA site can handle this at no cost, and most campuses host one."
    ]);
    out.innerHTML = h;
    return;
  }

  if (d.dep.status === "undetermined") {
    h += card("flag", "One answer still has to be resolved", [
      d.dep.why,
      "Everything below assumes you are a dependent, because that is the more common answer for a student and it is the conservative one. If it turns out you paid more than half your own support, your standard deduction rises from " + money(d.sd) + " to " + money(TAX.singleStandardDeduction) + " and the education credit moves to you.",
      "Work through the support worksheet in <span class='formref'>Publication 501</span> with your parents before you file."
    ]);
  } else {
    h += card(d.dep.status === "dependent" ? "info" : "ok",
      d.dep.status === "dependent" ? "You are claimed as a dependent" : "You file as your own taxpayer", [
      d.dep.status === "dependent"
        ? "You meet the " + d.dep.test + " test. On page one of <span class='formref'>Form 1040</span>, in the block under your name, check the box reading <strong>Someone can claim you as a dependent</strong>. In FreeTaxUSA this is on the Personal Information screen. In TurboTax it is phrased as whether anyone else can claim you."
        : "Neither the qualifying child nor the qualifying relative test applies to you, so nobody can claim you. Leave the dependent checkbox unchecked.",
      d.dep.status === "dependent"
        ? "Your standard deduction is <strong>" + money(d.sd) + "</strong>, calculated as your " + money(d.earned) + " of earned income plus " + money(TAX.dependentEarnedBump) + ", with a floor of " + money(TAX.dependentFloor) + " and a cap of " + money(TAX.singleStandardDeduction) + "."
        : "Your standard deduction is the full <strong>" + money(TAX.singleStandardDeduction) + "</strong>.",
      A.confirmed === "no"
        ? "You have not confirmed this with your parents yet. Do that before you submit. If you both claim, the second return filed is rejected electronically and has to go in on paper, which delays the refund by six to eight weeks."
        : "You have already confirmed this with your parents, which is the step most students skip."
    ]);
  }

  h += card(d.mustFile ? "flag" : "ok",
    d.mustFile ? "You are required to file" : "Not required, but you should file anyway", [
    d.mustFile
      ? "Trigger: " + d.reasons.join(". Also: ") + ". The deadline is " + TAX.deadline + "."
      : "Your " + money(d.total) + " of income sits under your " + money(d.sd) + " standard deduction, so no return is legally required.",
    (A.w2fed > 0 && !d.mustFile)
      ? "Your employer withheld <strong>" + money(A.w2fed) + "</strong> in federal tax. Withheld tax is a prepayment, not a fee, and you get back whatever exceeds what you owe. Here that looks like the full amount. Filing takes about twenty minutes."
      : (d.refund >= 0
        ? "Estimated refund of <strong>" + money(d.refund) + "</strong>, from " + money(A.w2fed) + " withheld against roughly " + money(d.totalTax) + " of tax."
        : "You are estimated to <strong>owe " + money(Math.abs(d.refund)) + "</strong>. " +
          (d.seTax > 0 ? "Most of that is self-employment tax on gig income, which nobody withheld for you. " : "") +
          "If you cannot pay it all at once, file on time anyway and set up an IRS payment plan. The late filing penalty is far larger than the late payment penalty."),
    "Refunds expire three years after the original deadline, so earlier unfiled years are still worth going back for."
  ]);

  h += card("info", "What this estimate does and does not include", [
    "Included: your standard deduction, federal brackets, self-employment tax, the deduction for half of self-employment tax" +
      (d.loanDeduction > 0 ? ", and " + money(d.loanDeduction) + " of student loan interest" : "") + ".",
    "Not included: education credits, which are described below but not netted into the number. Qualified dividend and long term capital gain rates, which are treated here as ordinary income and so overstate tax for anyone with investment gains. State tax of any kind. The kiddie tax on large unearned income.",
    "Your filing software computes the real figure. Treat the number above as a sanity check on what the software tells you, not as a substitute for it."
  ]);

  if (d.seNet >= TAX.selfEmploymentTrigger) {
    h += card("flag", "Gig income needs two extra schedules", [
      "Net profit of " + money(d.seNet) + " means <span class='formref'>Schedule C</span> to report the business and <span class='formref'>Schedule SE</span> for self-employment tax of roughly " + money(d.seTax) + ". Half of that, " + money(d.halfSe) + ", comes back as a deduction against your income.",
      "Mileage in " + TAX.year + " has two rates because the IRS raised it midyear. Trips through June 30 are deducted at " + Math.round(TAX.mileageFirstHalf * 100) + " cents per mile, trips from July 1 at " + Math.round(TAX.mileageSecondHalf * 100) + " cents. Split your log at that date or you will understate the deduction.",
      "If this continues next year you may need quarterly estimated payments on <span class='formref'>Form 1040-ES</span>, due in April, June, September, and January."
    ]);
  }

  if (d.taxableScholarship > 0) {
    h += card("flag", "Part of your scholarship is taxable", [
      money(d.taxableScholarship) + " of aid exceeded your qualified education expenses of " + money(d.qualifiedEd) + ", which are tuition, required fees, and required books and supplies. Aid that pays for room, board, or travel is taxable income.",
      "It goes on <span class='formref'>Schedule 1, line 8r</span>, listed there as scholarship and fellowship grants not reported on Form W-2, and flows to line 8 of your Form 1040. Older guidance telling you to write SCH beside the wages line has been out of date since tax year 2022.",
      "This is also why some students who expected a refund end up owing. Nothing was withheld from that money."
    ]);
  }

  const aotcYears = A.aotc === "unknown" ? null : parseInt(A.aotc, 10);
  const aotcExhausted = aotcYears !== null && aotcYears >= TAX.aotcLifetimeYears;
  const meetsAotcEnrollment = A.halftime === "yes";
  const aotcAvailable = !aotcExhausted && meetsAotcEnrollment;

  if (d.treatAsDependent) {
    h += card("info", "The education credit belongs to whoever claims you", [
      "Your <span class='formref'>1098-T</span> goes on their return, not yours. Send them the form and your book receipts. If you claim it yourself by mistake, both returns get flagged and at least one has to be amended.",
      aotcExhausted
        ? "All " + TAX.aotcLifetimeYears + " years of the American Opportunity Credit have already been used for you, so it is no longer available on anyone's return. Your parents should look at the Lifetime Learning Credit instead, worth up to " + money(TAX.llcMax) + " with no year limit and no enrollment minimum."
        : (meetsAotcEnrollment
          ? "They can claim the American Opportunity Credit, worth up to " + money(TAX.aotcMax) + ". Years used so far: " + (aotcYears === null ? "unknown, so check prior year returns before claiming" : aotcYears) + " of " + TAX.aotcLifetimeYears + "."
          : "You were not enrolled at least half time, which rules out the American Opportunity Credit. The Lifetime Learning Credit, up to " + money(TAX.llcMax) + ", has no enrollment minimum and is the one to look at."),
      "Student loan interest is not deductible by a dependent, even when the loan is in your name. That deduction moves to whoever claims you only if the loan is legally theirs, which it usually is not, so in most cases nobody gets it this year."
    ]);
  } else {
    const refundableAvailable = aotcAvailable && !(A.age !== null && A.age < TAX.studentAgeLimit);
    h += card("info", "You can claim the education credit yourself", [
      aotcAvailable
        ? "File <span class='formref'>Form 8863</span> and claim the American Opportunity Credit, worth up to " + money(TAX.aotcMax) + ". You met the half-time enrollment requirement and have " + (aotcYears === null ? "an unknown number of" : (TAX.aotcLifetimeYears - aotcYears)) + " years remaining of the " + TAX.aotcLifetimeYears + " year lifetime limit."
        : (aotcExhausted
          ? "You have used all " + TAX.aotcLifetimeYears + " years of the American Opportunity Credit, so it is not available. File <span class='formref'>Form 8863</span> for the Lifetime Learning Credit instead, worth up to " + money(TAX.llcMax) + " with no year limit."
          : "You were not enrolled at least half time, so the American Opportunity Credit does not apply. File <span class='formref'>Form 8863</span> for the Lifetime Learning Credit, worth up to " + money(TAX.llcMax) + ", which has no enrollment minimum."),
      aotcAvailable
        ? (refundableAvailable
          ? "Up to " + money(TAX.aotcRefundable) + " of it is refundable, meaning it can produce a refund even if you owe no tax."
          : "Because you are under " + TAX.studentAgeLimit + " and have a living parent, the refundable portion is disallowed unless you provided more than half your own support from earned income. The credit will offset tax you owe but will not generate a refund on its own.")
        : "The Lifetime Learning Credit is entirely nonrefundable. It reduces tax you owe and stops at zero, so with little or no tax liability it may be worth nothing this year.",
      d.loanDeduction > 0
        ? "You can also deduct " + money(d.loanDeduction) + " of student loan interest without itemizing. That is already reflected in the estimate above."
        : "Student loan interest is deductible up to " + money(TAX.studentLoanInterestCap) + " once you start paying it, phasing out between " + money(TAX.studentLoanPhaseoutStart) + " and " + money(TAX.studentLoanPhaseoutEnd) + " of income."
    ]);
  }

  const docs = [];
  if (A.w2wage > 0) docs.push(["W-2", "From every employer you had. Arrives by January 31, usually in a payroll portal rather than the mail."]);
  if (A.segross > 0) docs.push(["1099-NEC or 1099-K", "From each gig platform. You owe tax on the income whether or not a form arrives."]);
  if (A.interest > 0 || A.dividends > 0 || A.gains !== 0) docs.push(["1099-INT, 1099-DIV, or 1099-B", "From your bank and brokerage. These arrive later than W-2s, often mid-February, so do not file before they land."]);
  docs.push(["1098-T", "From your school's bursar or student account portal."]);
  if (A.loanint > 0) docs.push(["1098-E", "From your loan servicer if you paid $600 or more in interest."]);
  if (A.marketplace === "yes") docs.push(["1095-A", "From Healthcare.gov. Required before you file, and it feeds Form 8962."]);
  if (A.unemp > 0) docs.push(["1099-G", "From your state unemployment office."]);
  if (A.extra.indexOf("hsa") > -1) docs.push(["1099-SA and 5498-SA", "From your HSA custodian, feeding Form 8889."]);
  docs.push(["Last year's return", "Software asks for prior year adjusted gross income to verify your identity when you e-file."]);

  h += '<div class="result-card is-info"><h3>Gather these before you open any software</h3><ul class="checklist">' +
    docs.map(function (x) {
      return '<li><span class="mark">&#10003;</span><span><span class="formref">' + x[0] + '</span> ' + x[1] + '</span></li>';
    }).join("") + '</ul></div>';

  const s = d.states;
  const stateBody = [];
  const count = stateCount(s);

  if (count === 0) {
    stateBody.push("Federal only. " + (A.homestate && NO_INCOME_TAX.indexOf(A.homestate) > -1
      ? A.homestate + " does not tax wage income."
      : "No state return is triggered by your answers."));
  } else {
    const parts = stateSummary(s);
    stateBody.push(count === 1
      ? "One state filing: " + parts[0] + "."
      : count + " state filings: " + parts.join(", ") + ".");
  }

  s.notes.forEach(function (n) { stateBody.push(n); });

  if (s.nonresident.length && s.resident) {
    stateBody.push("Order matters. File the <strong>" + s.nonresident.join(" and ") +
      " nonresident return" + (s.nonresident.length > 1 ? "s" : "") + " first</strong>, then your " + s.resident +
      " resident return, claiming a credit for tax paid to the other state" + (s.nonresident.length > 1 ? "s" : "") +
      ". In the reverse order the credit does not compute and you are taxed twice on the same wages.");
  }
  if (s.thirdState) {
    stateBody.push("You also worked in a third state. Check whether it taxes nonresident wages and whether it has a reciprocity agreement with " + (s.resident || "your home state") + " before assuming a return is owed there.");
  }
  if (A.extra.indexOf("moved") > -1) {
    stateBody.push("You moved during the year, so at least one of these is a part-year return rather than a full year one. Each state wants the income you earned while you were a resident there.");
  }
  stateBody.push("Attending school in another state does not change your domicile. Your license, voter registration, and permanent address determine it.");
  h += card("info", "State returns", stateBody);

  const flags = [];
  if (A.marketplace === "yes") flags.push("You need <span class='formref'>Form 1095-A</span> before you file, and <span class='formref'>Form 8962</span> to reconcile the subsidy. Filing without it is the most common cause of a held refund.");
  if (A.foreign === "yes") flags.push("A foreign account over $10,000 at any point in the year requires an <span class='formref'>FBAR</span> filed separately through FinCEN, not with your return.");
  if (A.retire === "yes" && (d.treatAsDependent || A.fulltime === "yes")) flags.push("You contributed to a retirement account, but full-time students and dependents are both disqualified from the Saver's Credit. The contribution is still good for you, it just does not generate a credit this year.");
  if (A.gains < 0) flags.push("You entered an investment loss. Losses offset gains first and then up to " + money(TAX.capitalLossLimit) + " of other income per year, with the remainder carried forward. You still file <span class='formref'>Schedule D</span> and <span class='formref'>Form 8949</span>, and reporting the loss usually helps you.");
  if (A.extra.indexOf("dependent_own") > -1) flags.push("Having a dependent of your own opens the Child Tax Credit and possibly the Earned Income Credit. Worth walking through with a VITA volunteer rather than software.");
  if (A.extra.indexOf("prior") > -1) flags.push("You can still file the three most recent unfiled years. Each needs that year's forms and that year's software.");
  if (A.ssn === "no") flags.push("You need a Social Security number or ITIN to file. If you need an ITIN, <span class='formref'>Form W-7</span> is submitted with your paper return and takes several weeks.");
  if (flags.length) h += card("flag", "Things to handle before you file", flags);

  let rec, why;
  if (d.seNet >= TAX.selfEmploymentTrigger) {
    rec = "FreeTaxUSA";
    why = "Schedule C and Schedule SE are included free here. TurboTax routes gig income to a self-employed tier that runs well over $100 for the same two forms.";
  } else if (d.agi <= TAX.freeFileIncomeLimit) {
    rec = "An IRS Free File partner";
    why = "Your income is comfortably under the most recently published Free File limit of " + money(TAX.freeFileIncomeLimit) +
      ", which applied to " + TAX.freeFileLimitAppliesToYear + " returns. The limit for this year is published each winter and has risen every year, so check the IRS Free File page before assuming. Eight partners participate, each with its own extra restrictions on age, state, and income.";
  } else {
    rec = "FreeTaxUSA";
    why = "Free federal filing including the education and investment forms, with a modest per state charge.";
  }

  if (A.software === "vita") {
    rec = "Your campus VITA site";
    why = "Certified volunteers, free, and they catch things software misses. Many business schools run one staffed by accounting students. Bring every document on the checklist above.";
  } else if (A.software && A.software !== "undecided") {
    const names = { freefile: "an IRS Free File partner", freetaxusa: "FreeTaxUSA", turbotax: "TurboTax", fillable: "IRS Free File Fillable Forms" };
    h += card(A.software === "turbotax" ? "flag" : "ok", "About the software you picked", [
      "You chose " + (names[A.software] || A.software) + ".",
      A.software === "turbotax"
        ? "Be ready for the free tier to end. Adding a 1098-T, a 1099, or a state return typically moves you to a paid product. Intuit settled with the Federal Trade Commission over how that free edition was advertised. If you would rather not pay, " + rec + " handles the same forms."
        : (A.software === "fillable"
          ? "Fillable Forms have no income limit and no guided interview. They are electronic versions of the paper forms with basic math checking, so they suit someone who already knows which forms they need. If that is not you, " + rec + " will be less painful."
          : "Good fit for your situation. " + why)
    ]);
  }

  if (!A.software || A.software === "undecided" || A.software === "vita") {
    h += card("ok", "Where to file: " + rec, [
      why,
      "Whatever you choose, choose direct deposit. Paper checks take four to six weeks longer, and a mailed check to a campus address over the summer is a common way for refunds to go missing."
    ]);
  }

  h += card("info", "Note on IRS Direct File", [
    "If someone tells you to use IRS Direct File, it no longer exists. The IRS told its 25 partner states in November 2025 that Direct File would not be available and set no future launch date. A lot of advice written in 2024 and 2025 still recommends it.",
    "Free File, Free File Fillable Forms, MilTax for military families, and VITA clinics are the remaining free routes."
  ]);

  out.innerHTML = h;
}

/* ---------- restart ---------- */

function restart() {
  if (!confirm("Clear every answer and start over?")) return;
  document.querySelectorAll(".panel input, .panel select").forEach(function (el) {
    if (el.type === "radio" || el.type === "checkbox") el.checked = false;
    else el.value = "";
    el.classList.remove("prefilled");
  });
  document.querySelectorAll(".prefill-tag").forEach(function (t) { t.classList.remove("on"); });
  ["nra-warn", "spt-warn", "married-warn", "mkt-warn", "se-warn", "sch-warn", "state-note", "soft-note", "dep-verdict", "extract-note"]
    .forEach(function (id) { const el = $(id); if (el) el.hidden = true; });
  A.files = [];
  A.extra = [];
  renderFiles();
  $("plan").innerHTML = "";
  furthest = 0;
  go(0);
}
