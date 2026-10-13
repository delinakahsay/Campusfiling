/* Campus Filing: the nine section walkthrough.
   Requires tax-constants.js to be loaded first.

   Nothing persists. Answers live in the A object and are gone when the
   tab closes or reloads. That is deliberate, see privacy.html. */

/* Practice figures for the demo button. These are invented. The build
   does not read uploaded documents, so nothing here is derived from a
   file. Every message about them says "practice figures" so a tester
   never mistakes them for extracted values. */
const DEMO_FIGURES = {
  w2wage: 7840, w2fed: 412, w2state: 186, tips: 0,
  stipend: 0,
  segross: 3120, seexp: 640,
  interest: 84, dividends: 0, gains: -450, unemp: 0,
  tuition: 28450, scholarship: 31200, books: 900, roomboard: 0,
  loanint: 0
};

const SECTIONS = [
  "Your status", "About you", "Dependency", "Documents", "Income",
  "School money", "Other situations", "States and software", "Your filing plan"
];

const A = { extra: [], havedoc: [], files: [] };
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
  const wsBtn = $("show-worksheet");
  if (wsBtn) wsBtn.addEventListener("click", buildWorksheet);
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

const MONEY_FIELDS = ["w2wage", "w2fed", "w2state", "tips", "stipend",
  "segross", "seexp", "interest", "dividends", "unemp", "tuition",
  "scholarship", "books", "roomboard", "loanint"];

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
  A.havedoc = Array.from(document.querySelectorAll('input[name="havedoc"]:checked')).map(function (e) { return e.value; });
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
  const scholarshipExcess = Math.max(0, (A.scholarship || 0) - qualifiedEd);

  /* A fellowship or stipend with no W-2 follows the scholarship rules:
     taxable to the extent it is not spent on qualified education
     expenses, reported on Schedule 1 line 8r, and counted as earned
     income for the dependent standard deduction. Qualified expenses are
     applied to scholarship money first, so only what is left over can
     shelter the stipend. */
  const edShelterLeft = Math.max(0, qualifiedEd - (A.scholarship || 0));
  const taxableStipend = Math.max(0, (A.stipend || 0) - edShelterLeft);
  const taxableScholarship = scholarshipExcess + taxableStipend;

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
    seNet, taxableScholarship, taxableStipend, scholarshipExcess, qualifiedEd, earned, unearned, netGains, total,
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
      const s = radio("status");
      $("nra-warn").hidden = s !== "nra";
      $("spt-warn").hidden = s !== "unsure" && s !== "other-visa";
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

  const stipendEl = $("stipend");
  if (stipendEl) {
    stipendEl.addEventListener("input", function () {
      collect();
      const d = derive();
      const w = $("stipend-note");
      w.hidden = num("stipend") <= 0;
      if (!w.hidden) {
        w.className = "note";
        w.innerHTML = d.taxableStipend > 0
          ? money(d.taxableStipend) + " of this stipend is taxable, because your qualified education expenses were already used up by scholarship money. It goes on <span class='formref'>Schedule 1, line 8r</span> and counts as earned income when your standard deduction is calculated. If the stipend was actually payment for required teaching or research, it is wages instead and belongs on a W-2, so ask your department which it was."
          : "Your qualified education expenses cover this stipend, so none of it is taxable this year. If the stipend was payment for required teaching or research it is wages rather than a fellowship, which changes the answer, so confirm with your department.";
      }
    });
  }

  ["tuition", "scholarship", "books", "roomboard", "stipend"].forEach(function (id) {
    $(id).addEventListener("input", function () {
      const qualified = num("tuition") + num("books");
      const excess = Math.max(0, num("scholarship") + num("stipend") - qualified);
      const w = $("sch-warn");
      w.hidden = excess <= 0;
      if (!w.hidden) {
        w.innerHTML = money(excess) + " of scholarship and stipend money exceeded your qualified expenses of " + money(qualified) +
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

/* ---------- documents ---------- */

/* Files are read in the browser by extract.js. Extracted amounts are
   proposed in a review table and only written into answers when the user
   confirms them. Each applied value is recorded against its file, so
   removing the file removes what it contributed. */

let pending = [];

function wireFiles() {
  const drop = $("drop"), input = $("files");
  if (!drop || !input) return;

  $("browse").addEventListener("click", function () { input.click(); });
  input.addEventListener("change", function (e) { handleFiles(e.target.files); input.value = ""; });

  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) { e.preventDefault(); handleFiles(e.dataTransfer.files); });

  const demo = $("load-demo");
  if (demo) demo.addEventListener("click", loadDemoFigures);
}

function handleFiles(list) {
  const files = Array.from(list || []);
  if (!files.length) return;

  files.forEach(function (f) {
    const rec = { id: ++fileSeq, name: f.name, size: f.size, type: null,
      status: "reading", note: null, applied: {} };
    A.files.push(rec);
    renderFiles();

    readDocument(f).then(function (res) {
      rec.type = res.type;
      rec.note = res.note;
      rec.status = res.found.length ? "found" : (res.needsManual ? "manual" : "recognized");
      if (res.type) autoCheckHaveDoc(res.type);
      if (res.found.length) {
        res.found.forEach(function (x) { pending.push({ fileId: rec.id, fileName: rec.name, formType: res.type, field: x.field, label: x.label, value: x.value }); });
      }
      renderFiles();
      renderReview();
      refreshSummary();
    }).catch(function () {
      rec.status = "manual";
      rec.note = "This file could not be read. It is listed with your records; type its figures in yourself.";
      renderFiles();
    });
  });
}

const TYPE_TO_HAVEDOC = { "W-2": "w2", "1099-NEC": "1099nec", "1099-K": "1099nec",
  "1098-T": "1098t", "1099-B": "1099b", "1099-INT": "1099int", "1099-DIV": "1099int",
  "1098-E": "1098e", "1095-A": "1095a" };

function autoCheckHaveDoc(formType) {
  const key = TYPE_TO_HAVEDOC[formType];
  if (!key) return;
  const box = document.querySelector('input[name="havedoc"][value="' + key + '"]');
  if (box) box.checked = true;
  if (formType === "1095-A") {
    const mk = document.querySelector('input[name="marketplace"][value="yes"]');
    if (mk && !mk.checked) { mk.checked = true; const w = $("mkt-warn"); if (w) w.hidden = false; }
  }
}

const STATUS_TEXT = {
  reading: ["Reading", "tag-muted"],
  found: ["Amounts to check", ""],
  recognized: ["Recognized", ""],
  manual: ["Type this one in", "tag-muted"]
};

function renderFiles() {
  const ul = $("filelist");
  if (!ul) return;
  ul.innerHTML = "";

  A.files.forEach(function (f) {
    const li = document.createElement("li");
    li.style.flexWrap = "wrap";

    const grow = document.createElement("div");
    grow.className = "grow";
    const nameEl = document.createElement("div");
    nameEl.className = "fname";
    nameEl.textContent = f.name;
    const metaEl = document.createElement("div");
    metaEl.className = "fmeta";
    metaEl.textContent = Math.max(1, Math.round(f.size / 1024)) + " KB" + (f.type ? " \u00b7 " + f.type : "");
    grow.appendChild(nameEl);
    grow.appendChild(metaEl);

    const st = STATUS_TEXT[f.status] || STATUS_TEXT.manual;
    const tag = document.createElement("span");
    tag.className = "tag " + st[1];
    tag.textContent = st[0];

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Remove";
    btn.setAttribute("aria-label", "Remove " + f.name);
    btn.addEventListener("click", function () { removeFile(f.id); });

    li.appendChild(grow);
    li.appendChild(tag);
    li.appendChild(btn);

    if (f.note) {
      const n = document.createElement("div");
      n.className = "fmeta";
      n.style.flexBasis = "100%";
      n.textContent = f.note;
      li.appendChild(n);
    }

    ul.appendChild(li);
  });
}

/* The review table. Nothing reaches an answer without passing through it. */
function renderReview() {
  const box = $("review");
  if (!box) return;

  if (!pending.length) { box.hidden = true; box.innerHTML = ""; return; }

  const rows = pending.map(function (x, i) {
    return '<tr>' +
      '<td><label style="font-weight:400;display:flex;gap:9px;align-items:flex-start">' +
      '<input type="checkbox" data-review="' + i + '" checked />' +
      '<span>' + x.label + '<br /><span style="color:var(--muted);font-size:13px">' + x.formType + ' \u00b7 ' + x.fileName + '</span></span></label></td>' +
      '<td class="num"><input type="number" data-reviewval="' + i + '" value="' + x.value + '" style="max-width:130px;text-align:right" /></td>' +
      '</tr>';
  }).join("");

  box.hidden = false;
  box.innerHTML =
    '<h3 style="margin-top:26px">Check these against your forms</h3>' +
    '<div class="note note-warn"><p>These amounts were read out of your documents. Issuers lay these forms out very differently, so a misread is normal and expected. Compare each figure to the paper before you apply it, correct anything wrong, and untick anything that does not belong.</p></div>' +
    '<div class="table-wrap"><table class="data"><thead><tr><th>What was found</th><th class="num">Amount</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div class="btn-row">' +
    '<button type="button" class="btn btn-green btn-sm" id="apply-review">Apply the ticked amounts</button>' +
    '<button type="button" class="btn btn-ghost btn-sm" id="discard-review">Discard, I will type them</button>' +
    '</div>';

  const applyBtn = $("apply-review"), discardBtn = $("discard-review");
  if (applyBtn) applyBtn.addEventListener("click", applyReview);
  if (discardBtn) discardBtn.addEventListener("click", function () {
    pending = [];
    renderReview();
    const note = $("extract-note");
    if (note) { note.hidden = false; note.className = "note"; note.textContent = "Discarded. Type your figures into the sections ahead."; }
  });
}

function applyReview() {
  let applied = 0;

  pending.forEach(function (x, i) {
    const on = document.querySelector('[data-review="' + i + '"]');
    const valEl = document.querySelector('[data-reviewval="' + i + '"]');
    if (!on || !on.checked) return;

    const v = parseFloat(valEl ? valEl.value : x.value);
    if (isNaN(v)) return;

    const el = $(x.field);
    if (!el) return;

    /* Wages accumulate across employers. Everything else replaces, because
       two 1098-Ts for one year means one of them is wrong. */
    const accumulate = ["w2wage", "w2fed", "w2state", "segross"].indexOf(x.field) > -1;
    const currentValue = el.value === "" ? 0 : parseFloat(el.value) || 0;
    el.value = accumulate ? currentValue + v : v;

    const rec = A.files.filter(function (f) { return f.id === x.fileId; })[0];
    if (rec) rec.applied[x.field] = (rec.applied[x.field] || 0) + (accumulate ? v : v - currentValue);

    el.classList.add("prefilled");
    const tag = document.querySelector('[data-tag="' + x.field + '"]');
    if (tag) tag.classList.add("on");
    applied++;
  });

  pending = [];
  renderReview();

  const note = $("extract-note");
  if (note) {
    note.hidden = false;
    note.className = "note note-good";
    note.textContent = applied + (applied === 1 ? " amount was" : " amounts were") +
      " applied to the sections ahead. They are still yours to edit, and the plan uses whatever is in the fields when you reach it.";
  }

  ["segross", "seexp", "tuition", "scholarship", "books", "stipend"].forEach(function (id) {
    const el = $(id);
    if (el && el.dispatchEvent) el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  refreshSummary();
}

function removeFile(id) {
  const idx = A.files.findIndex(function (f) { return f.id === id; });
  if (idx === -1) return;
  const rec = A.files[idx];

  Object.keys(rec.applied).forEach(function (k) {
    const el = $(k);
    if (!el) return;
    const currentValue = el.value === "" ? 0 : parseFloat(el.value) || 0;
    const next = currentValue - rec.applied[k];
    el.value = next === 0 ? "" : next;
    if (next === 0) {
      el.classList.remove("prefilled");
      const tag = document.querySelector('[data-tag="' + k + '"]');
      if (tag) tag.classList.remove("on");
    }
  });

  pending = pending.filter(function (x) { return x.fileId !== id; });
  A.files.splice(idx, 1);
  renderFiles();
  renderReview();
  refreshSummary();
}

/* ---------- practice figures ---------- */

function loadDemoFigures() {
  Object.keys(DEMO_FIGURES).forEach(function (k) {
    const el = $(k);
    if (!el) return;
    el.value = DEMO_FIGURES[k];
    el.classList.add("prefilled");
    const tag = document.querySelector('[data-tag="' + k + '"]');
    if (tag) tag.classList.add("on");
  });

  document.querySelectorAll('input[name="havedoc"]').forEach(function (el) {
    if (["w2", "1099nec", "1098t", "1099b", "1099int"].indexOf(el.value) > -1) el.checked = true;
  });

  const note = $("extract-note");
  if (note) {
    note.hidden = false;
    note.className = "note note-warn";
    note.textContent = "Practice figures loaded. Every one of these numbers is invented and matches no real document. Replace them with your own before you rely on anything the plan says.";
  }

  ["segross", "seexp", "tuition", "scholarship", "books", "stipend"].forEach(function (id) {
    const el = $(id);
    if (el && el.dispatchEvent) el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  refreshSummary();
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
  if (A.stipend > 0) docs.push(["Fellowship or stipend award letter", "There may be no tax form at all for this. The award letter is what establishes the amount and whether it required services."]);
  docs.push(["Last year's return", "Software asks for prior year adjusted gross income to verify your identity when you e-file."]);

  const HAVE_KEY = { "W-2": "w2", "1099-NEC or 1099-K": "1099nec", "1098-T": "1098t",
    "1099-INT, 1099-DIV, or 1099-B": "1099b", "1098-E": "1098e", "1095-A": "1095a",
    "Last year's return": "prior" };

  h += '<div class="result-card is-info"><h3>Gather these before you open any software</h3><ul class="checklist">' +
    docs.map(function (x) {
      const k = HAVE_KEY[x[0]];
      const have = k && A.havedoc.indexOf(k) > -1;
      return '<li><span class="mark">' + (have ? "&#10003;" : "&#9744;") + '</span><span><span class="formref">' + x[0] + '</span> ' +
        (have ? "You have this." : x[1]) + '</span></li>';
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


/* ---------- step-by-step worksheet ---------- */

/* Named screens for guided software are stable year to year. Form and
   schedule names are stable. Individual 1040 line numbers are not: the
   2026 form is not published until December, so the only line numbers
   used here are ones that have held since the 2022 redesign, and the
   worksheet says so on screen. */

const SOFTWARE_LABEL = {
  freefile: "your IRS Free File partner",
  fillable: "Free File Fillable Forms",
  freetaxusa: "FreeTaxUSA",
  turbotax: "TurboTax",
  vita: "your VITA appointment",
  undecided: "your filing software"
};

function screenFor(topic, software) {
  const map = {
    personal: {
      freetaxusa: "Personal, then Personal Information",
      turbotax: "My Info, then the questions about your parents",
      fillable: "Form 1040, page 1, the Standard Deduction block under your name",
      other: "the personal information or About You screen"
    },
    w2: {
      freetaxusa: "Income, then Wages (W-2)",
      turbotax: "Wages and Income, then Job (W-2)",
      fillable: "Form 1040, the wages line, and attach your W-2",
      other: "the wages or W-2 screen"
    },
    gig: {
      freetaxusa: "Income, then Business Income (Schedule C)",
      turbotax: "Wages and Income, then Self-employment income and expenses",
      fillable: "Schedule C, then Schedule SE",
      other: "the self-employment or business income screen"
    },
    invest: {
      freetaxusa: "Income, then Interest Income and Stocks or Investments",
      turbotax: "Wages and Income, then Investments and Savings",
      fillable: "Schedule B, then Form 8949 and Schedule D",
      other: "the interest, dividends, and investment sales screens"
    },
    scholarship: {
      freetaxusa: "Income, then Less Common Income, then Scholarships and Grants",
      turbotax: "Deductions and Credits, then Education, then the scholarship follow-up questions",
      fillable: "Schedule 1, line 8r",
      other: "a less common income or other income screen"
    },
    education: {
      freetaxusa: "Deductions and Credits, then Education Expenses",
      turbotax: "Deductions and Credits, then Education",
      fillable: "Form 8863",
      other: "the education credits screen"
    },
    loan: {
      freetaxusa: "Deductions and Credits, then Student Loan Interest",
      turbotax: "Deductions and Credits, then Education, then Student Loan Interest",
      fillable: "Schedule 1, the student loan interest deduction line",
      other: "the student loan interest screen"
    },
    marketplace: {
      freetaxusa: "Deductions and Credits, then Health Insurance (Form 1095-A)",
      turbotax: "Deductions and Credits, then Medical, then Affordable Care Act",
      fillable: "Form 8962",
      other: "the health insurance or 1095-A screen"
    },
    state: {
      freetaxusa: "State, then add each state return",
      turbotax: "State Taxes",
      fillable: "your state revenue department's own forms, which are not part of Fillable Forms",
      other: "the state return section"
    },
    finish: {
      freetaxusa: "Filing, then E-File",
      turbotax: "Review, then File",
      fillable: "the E-File Now button after running Do the Math",
      other: "the review and submit screens"
    }
  };
  const m = map[topic];
  return m[software] || m.other;
}

function buildWorksheet() {
  collect();
  const d = derive();
  const box = $("worksheet");
  if (!box) return;

  const sw = (A.software && A.software !== "undecided") ? A.software : "other";
  const name = SOFTWARE_LABEL[A.software] || SOFTWARE_LABEL.undecided;
  const steps = [];

  if (A.status === "nra") {
    box.hidden = false;
    box.innerHTML = '<div class="result-card is-stop"><h3>No worksheet for this path</h3>' +
      '<p>A step-by-step worksheet for Form 1040 would walk you into filing the wrong return. You need Form 1040-NR and Form 8843, which none of the software this worksheet covers can produce.</p>' +
      '<p>Read the <a href="../guides/international.html">international students guide</a> and get a Sprintax code from your international student office first.</p></div>';
    return;
  }

  steps.push(["Gather everything first",
    "Open nothing until you have every form on your checklist. Starting and stopping is how people end up entering a number twice or forgetting the 1099-B that arrives in February." +
    (A.havedoc.indexOf("prior") === -1 ? " You have not checked off last year's return, and you will be asked for its adjusted gross income to verify your identity." : "")]);

  steps.push(["Open " + name + " and start a " + TAX.year + " return",
    A.software === "freefile"
      ? "Start from the IRS Free File page on IRS.gov rather than going to the partner's own site. Beginning anywhere else usually means you are in the paid product wearing the same logo."
      : (A.software === "fillable"
        ? "Fillable Forms has no interview. You are typing onto the form itself, so have this worksheet open beside it."
        : "Create the account with an email you will still have next April, since that is how you retrieve this return next year.")]);

  steps.push([d.treatAsDependent ? "Check the dependent box" : "Leave the dependent box unchecked",
    "Go to " + screenFor("personal", sw) + ". " +
    (d.treatAsDependent
      ? "Answer yes when asked whether someone else can claim you. This is the single most common student error, and it is the difference between a " + money(d.sd) + " standard deduction and " + money(TAX.singleStandardDeduction) + "."
      : "Answer no. Nobody meets the qualifying child or qualifying relative test for you, so you take the full " + money(TAX.singleStandardDeduction) + " standard deduction.")]);

  if (A.w2wage > 0 || A.w2fed > 0) {
    steps.push(["Enter each W-2 exactly as printed",
      "Go to " + screenFor("w2", sw) + ". Type box 1 (" + money(A.w2wage) + "), box 2 (" + money(A.w2fed) + ")" +
      (A.w2state > 0 ? ", and box 17 (" + money(A.w2state) + ")" : "") +
      ". Enter one W-2 per employer. Do not add them together, because the IRS matches each one separately."]);
  }

  if (A.tips > 0) {
    steps.push(["Add tips that were not on a W-2",
      "Same screen, look for the unreported tips or other wages question. " + money(A.tips) + " of tip income still belongs on the return even though nobody sent you a form for it."]);
  }

  if (d.seNet >= TAX.selfEmploymentTrigger) {
    steps.push(["Set up the gig work as a business",
      "Go to " + screenFor("gig", sw) + ". Report " + money(A.segross) + " of gross income and " + money(A.seexp) + " of expenses, giving " + money(d.seNet) + " of net profit. " +
      "Self-employment tax of roughly " + money(d.seTax) + " is calculated from that, and half of it, " + money(d.halfSe) + ", comes back automatically as a deduction. You do not enter that half yourself."]);
    steps.push(["Split your mileage at June 30",
      TAX.year + " has two business mileage rates. Miles through June 30 deduct at " + Math.round(TAX.mileageFirstHalf * 100) + " cents, miles from July 1 at " + Math.round(TAX.mileageSecondHalf * 100) + " cents. Most software asks for one total. Enter them as two separate expense lines or you will understate the deduction."]);
  }

  if (A.interest > 0 || A.dividends > 0 || A.gains !== 0) {
    let detail = "Go to " + screenFor("invest", sw) + ". ";
    if (A.interest > 0) detail += "Interest " + money(A.interest) + ". ";
    if (A.dividends > 0) detail += "Dividends " + money(A.dividends) + ". ";
    if (A.gains !== 0) detail += "Sales of " + money(A.gains) + ". Import the 1099-B rather than typing it if the option exists, because every individual sale has to be listed. ";
    if (A.gains < 0) detail += "A loss offsets gains first and then up to " + money(TAX.capitalLossLimit) + " of other income, so reporting it helps you.";
    steps.push(["Enter investment income", detail.trim()]);
  }

  if (d.taxableScholarship > 0) {
    steps.push(["Report the taxable part of your school money",
      "Go to " + screenFor("scholarship", sw) + " and enter " + money(d.taxableScholarship) + ". " +
      "This is the amount your scholarships and stipends exceeded tuition, required fees, books and supplies. " +
      "It lands on Schedule 1, line 8r. Software will not find this on its own from your 1098-T, so if you skip this step the return is wrong and nothing will warn you."]);
  }

  if (d.treatAsDependent) {
    steps.push(["Skip the education credit entirely",
      "Do not enter your 1098-T for a credit. Whoever claims you gets it. If you claim it too, both returns are flagged and at least one has to be amended. Send your parents the 1098-T and your book receipts instead."]);
  } else {
    steps.push(["Claim your education credit",
      "Go to " + screenFor("education", sw) + " and enter your 1098-T along with " + money(A.books || 0) + " of books and supplies, which never appear on that form. " +
      (A.halftime === "yes" && A.aotc !== "4"
        ? "You qualify for the American Opportunity Credit."
        : "You are limited to the Lifetime Learning Credit.") +
      " Confirm with your parents that they are not claiming you before you submit."]);
  }

  if (!d.treatAsDependent && A.loanint > 0) {
    steps.push(["Deduct your student loan interest",
      "Go to " + screenFor("loan", sw) + " and enter " + money(A.loanint) + " from your 1098-E. You do not need to itemize for this."]);
  } else if (d.treatAsDependent && A.loanint > 0) {
    steps.push(["Do not deduct the student loan interest",
      "You paid " + money(A.loanint) + ", but a dependent cannot take this deduction and neither can your parents unless the loan is legally theirs. Leave it off rather than having the return corrected later."]);
  }

  if (A.marketplace === "yes") {
    steps.push(["Reconcile your marketplace insurance",
      "Go to " + screenFor("marketplace", sw) + " and enter your 1095-A. This produces Form 8962. Filing without it is a leading cause of held refunds, and the IRS will not process the return until it is there."]);
  }

  const s = d.states;
  const stParts = stateSummary(s);
  if (stParts.length) {
    let detail = "Go to " + screenFor("state", sw) + ". ";
    if (s.nonresident.length && s.resident) {
      detail += "Do the " + s.nonresident.join(" and ") + " nonresident return first, then " + s.resident +
        ". In that order the credit for tax paid to another state calculates. In the other order it does not and you pay twice.";
    } else {
      detail += "You need: " + stParts.join(", ") + ".";
    }
    s.notes.forEach(function (n) { detail += " " + n.replace(/<[^>]+>/g, ""); });
    steps.push(["File your state returns in this order", detail]);
  }

  steps.push(["Choose direct deposit, then review",
    "Go to " + screenFor("finish", sw) + ". Pick direct deposit rather than a paper check, which takes four to six weeks longer and gets lost when it is mailed to a campus address in June. " +
    "Before submitting, check the dependent box one more time. It is the field most often wrong on a student return."]);

  steps.push(["Save a copy of everything",
    "Download the completed PDF and keep it. You will need this year's adjusted gross income to e-file next year, and you have three years to amend if something turns out to be wrong."]);

  const html = steps.map(function (st, i) {
    return '<div class="result-card is-info"><h3>' + (i + 1) + '. ' + st[0] + '</h3><p>' + st[1] + '</p></div>';
  }).join("");

  box.hidden = false;
  box.innerHTML =
    '<h3 style="margin-top:2rem">Your step-by-step worksheet</h3>' +
    '<div class="note note-warn"><p><strong>Read this before you follow it.</strong> ' +
    'Screen names come from the ' + (TAX.year - 1) + ' versions of these products and move slightly between years. Where a screen name does not match, look for the nearest equivalent rather than skipping the step. ' +
    'This worksheet tells you where each figure goes. It does not check your math, and it is not a substitute for the software\u2019s own review step.</p></div>' +
    html;

  box.scrollIntoView({ behavior: "smooth", block: "start" });
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
  ["nra-warn", "spt-warn", "married-warn", "mkt-warn", "se-warn", "sch-warn", "state-note", "soft-note", "dep-verdict", "extract-note", "stipend-note", "review"]
    .forEach(function (id) { const el = $(id); if (el) el.hidden = true; });
  A.files = [];
  A.extra = [];
  A.havedoc = [];
  pending = [];
  renderFiles();
  renderReview();
  $("plan").innerHTML = "";
  const ws = $("worksheet"); if (ws) { ws.innerHTML = ""; ws.hidden = true; }
  furthest = 0;
  go(0);
}
