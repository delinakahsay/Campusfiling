/* Campus Filing: the staff dashboard.

   Two audiences, one page. A university administrator sees their own
   institution. Tax operations sees every institution and a total.

   Which one you are is not decided here. This file asks the server who
   is signed in, and the server asks the database, which reads the role
   from the caller's profile row. The page then arranges what it was
   given. Nothing a browser can edit changes the answer: a student who
   opens this URL gets a refusal from the reporting function, not an
   empty table they might mistake for a working page.

   The numbers are counts. There is no request this page can make that
   returns a student's answers. */

(function () {
  var $ = function (id) { return document.getElementById(id); };

  var ROLE_LABEL = {
    university_admin: "University administrator",
    tax_operations: "Tax content manager"
  };

  function say(message, kind) {
    var n = $("dash-status");
    n.textContent = message;
    n.className = "note" + (kind ? " " + kind : "");
    n.hidden = false;
  }

  function show(id) { $(id).hidden = false; }

  function num(n) { return Number(n || 0).toLocaleString("en-US"); }

  function when(iso) {
    if (!iso) return "No activity yet";
    var d = new Date(iso);
    if (isNaN(d)) return "No activity yet";
    return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  }

  function render(user, rows) {
    $("dash-role").textContent = ROLE_LABEL[user.role] || "Dashboard";

    if (user.role === "tax_operations") {
      $("dash-title").textContent = "Campus Filing usage";
      $("dash-sub").textContent =
        rows.length === 1
          ? "Across one institution."
          : "Across " + rows.length + " institutions.";
    } else {
      $("dash-title").textContent = user.institution || "Your institution";
      $("dash-sub").textContent = "How your students are using Campus Filing.";
    }

    var totals = rows.reduce(function (a, r) {
      a.students += r.students; a.plans += r.plans; a.docs += r.documentsRead;
      a.enrolled += r.enrollment || 0;
      return a;
    }, { students: 0, plans: 0, docs: 0, enrolled: 0 });

    function pct(n, d) { return d ? (100 * n / d).toFixed(1) + "%" : "n/a"; }

    /* The two roles are asking different questions. A university wants
       to know whether the subscription is reaching its students, which
       the business case states as coverage against enrollment. The tax
       content manager is keeping the product correct, so the useful
       figure is how much work is going through it. */
    var tiles = user.role === "university_admin"
      ? [
          [pct(totals.plans, totals.enrolled), "Coverage of enrollment"],
          [num(totals.students) + " of " + num(totals.enrolled), "Students with an account"],
          [num(totals.plans), "Filing plans completed"],
          [pct(totals.plans, totals.students), "Plan completion rate"]
        ]
      : [
          [num(totals.students), "Students with an account"],
          [num(totals.plans), "Filing plans saved"],
          [num(totals.docs), "Documents read"],
          [pct(totals.plans, totals.enrolled), "Coverage of enrollment"]
        ];

    var box = $("dash-totals");
    box.textContent = "";
    tiles.forEach(function (t) {
      var d = document.createElement("div");
      d.className = "stat";
      var v = document.createElement("div"); v.className = "value"; v.textContent = t[0];
      var l = document.createElement("div"); l.className = "label"; l.textContent = t[1];
      d.appendChild(v); d.appendChild(l);
      box.appendChild(d);
    });
    show("dash-totals");

    /* One institution needs no table: the three figures above already
       say everything the table would repeat. */
    if (rows.length > 1) {
      var body = $("dash-rows");
      body.textContent = "";
      rows.forEach(function (r) {
        var tr = document.createElement("tr");
        [
          [r.institution, ""],
          [num(r.students), "num"],
          [num(r.plans), "num"],
          [num(r.documentsRead), "num"],
          [when(r.lastActivity), ""]
        ].forEach(function (cell) {
          var td = document.createElement("td");
          td.textContent = cell[0];
          if (cell[1]) td.className = cell[1];
          tr.appendChild(td);
        });
        body.appendChild(tr);
      });
      show("dash-table-wrap");
    }

    show("dash-privacy");

    if (!totals.students) {
      say("No student accounts yet. Figures appear here as students sign up and save plans.", "");
    }
  }

  /* ---------- the tax year view ----------

     Every figure the product calculates with, both supported years side
     by side, with the ones that moved marked. That is the shape the job
     actually takes: each season someone checks this list against the
     IRS release, and what matters is which numbers changed. */

  var MONEY = "money", RATE = "rate", PLAIN = "plain", TEXT = "text", BOOL = "bool",
      PERMILE = "permile";

  var FIELDS = [
    ["Filing", [
      ["deadline", "Filing deadline", TEXT],
      ["seasonOpens", "Season opens", TEXT],
      ["filedIn", "Filed during", PLAIN]
    ]],
    ["Standard deduction and dependency", [
      ["singleStandardDeduction", "Single standard deduction", MONEY],
      ["dependentFloor", "Dependent standard deduction floor", MONEY],
      ["dependentEarnedBump", "Added to earned income for a dependent", MONEY],
      ["unearnedFilingTrigger", "Unearned income filing trigger", MONEY],
      ["qualifyingRelativeIncomeTest", "Qualifying relative income test", MONEY],
      ["qualifyingChildAge", "Qualifying child age limit", PLAIN],
      ["studentAgeLimit", "Student age limit", PLAIN]
    ]],
    ["Education", [
      ["aotcMax", "American Opportunity credit, maximum", MONEY],
      ["aotcRefundable", "American Opportunity refundable portion", MONEY],
      ["aotcLifetimeYears", "American Opportunity, years allowed", PLAIN],
      ["llcMax", "Lifetime Learning credit, maximum", MONEY],
      ["studentLoanInterestCap", "Student loan interest deduction cap", MONEY],
      ["studentLoanPhaseoutStart", "Loan interest phase-out starts", MONEY],
      ["studentLoanPhaseoutEnd", "Loan interest phase-out ends", MONEY]
    ]],
    ["Self-employment", [
      ["selfEmploymentTrigger", "Self-employment filing trigger", MONEY],
      ["selfEmploymentRate", "Self-employment tax rate", RATE],
      ["selfEmploymentBase", "Share of net earnings that is taxed", RATE],
      ["selfEmploymentDeductionShare", "Deductible share of the tax", RATE]
    ]],
    ["Other figures", [
      ["capitalLossLimit", "Capital loss deduction limit", MONEY],
      ["mileageFirstHalf", "Mileage rate, first half", PERMILE],
      ["mileageSecondHalf", "Mileage rate, second half", PERMILE]
    ]],
    ["Free filing routes", [
      ["freeFileIncomeLimit", "Free File income limit", MONEY],
      ["freeFileLimitAppliesToYear", "That limit applies to", PLAIN],
      ["freeFilePartnerCount", "Free File partners", PLAIN],
      ["freeFileExtendedThrough", "Free File extended through", PLAIN],
      ["directFileAvailable", "Direct File available", BOOL]
    ]]
  ];

  function fmt(v, how) {
    if (v === null || v === undefined) return "not set";
    if (typeof v === "number" && !isFinite(v)) return "no limit";
    if (how === MONEY) return "$" + Number(v).toLocaleString("en-US");
    if (how === RATE) return (Number(v) * 100).toFixed(2).replace(/\.00$/, "") + "%";
    /* Dollars per mile, not a percentage. 0.725 is 72.5 cents a mile,
       and showing it as 72.5% would be a different number entirely. */
    if (how === PERMILE) return "$" + Number(v).toFixed(3) + " a mile";
    if (how === BOOL) return v ? "Yes" : "No";
    return String(v);
  }

  /* The top bracket has no ceiling. It is stored as Infinity, which
     JSON and toLocaleString both render as a symbol rather than a
     sentence. */
  function edge(v) {
    if (v === undefined) return "not set";
    if (v === null || (typeof v === "number" && !isFinite(v))) return "no limit";
    return "$" + Number(v).toLocaleString("en-US");
  }

  function cell(tr, text, cls) {
    var td = document.createElement("td");
    td.textContent = text;
    if (cls) td.className = cls;
    tr.appendChild(td);
    return td;
  }

  function renderTaxYear() {
    if (typeof TAX_YEARS === "undefined") return false;
    var years = Object.keys(TAX_YEARS).map(Number).sort();
    if (years.length < 2) return false;
    var a = TAX_YEARS[years[0]], b = TAX_YEARS[years[1]];
    var body = $("taxyear-rows");
    body.textContent = "";

    FIELDS.forEach(function (group) {
      var head = document.createElement("tr");
      var th = document.createElement("th");
      th.setAttribute("colspan", "4");
      th.setAttribute("scope", "colgroup");
      th.textContent = group[0];
      head.appendChild(th);
      body.appendChild(head);

      group[1].forEach(function (f) {
        var key = f[0], label = f[1], how = f[2];
        var tr = document.createElement("tr");
        cell(tr, label);
        cell(tr, fmt(a[key], how), "num");
        cell(tr, fmt(b[key], how), "num");
        cell(tr, a[key] === b[key] ? "" : "Changed");
        body.appendChild(tr);
      });
    });

    /* Brackets are a list rather than a figure, so they get their own
       rows at the bottom instead of being flattened into a count. */
    var bh = document.createElement("tr");
    var bth = document.createElement("th");
    bth.setAttribute("colspan", "4");
    bth.setAttribute("scope", "colgroup");
    bth.textContent = "Ordinary income brackets, single filer";
    bh.appendChild(bth);
    body.appendChild(bh);

    (b.brackets || []).forEach(function (br, i) {
      var prev = (a.brackets || [])[i] || {};
      var tr = document.createElement("tr");
      cell(tr, (br.rate * 100).toFixed(0) + "% up to");
      cell(tr, edge(prev.upTo), "num");
      cell(tr, edge(br.upTo), "num");
      cell(tr, prev.upTo === br.upTo ? "" : "Changed");
      body.appendChild(tr);
    });

    return true;
  }

  async function start() {
    var user = null;
    try {
      user = await window.CF.session;
    } catch (e) {
      say("The account service did not respond. Try again in a moment.", "note-stop");
      return;
    }

    if (!user) {
      location.replace("account.html?next=" + encodeURIComponent("/dashboard.html"));
      return;
    }
    if (!window.CF.isStaff(user)) {
      say("This page is for Campus Filing staff. Your filing plans are on the account page.", "note-warn");
      return;
    }

    /* The tax year view is tax operations' own, and it needs no server
       call: the figures ship with the site. */
    var tab = new URLSearchParams(location.search).get("tab");
    if (tab === "taxyear") {
      if (user.role !== "tax_operations") {
        say("The tax year figures are for Campus Filing tax operations.", "note-warn");
        return;
      }
      $("dash-role").textContent = ROLE_LABEL[user.role];
      $("dash-title").textContent = "Tax year figures";
      $("dash-sub").textContent = "What the product calculates with, and what moved this year.";
      if (renderTaxYear()) show("panel-taxyear");
      else say("The tax year figures could not be loaded.", "note-stop");
      return;
    }

    var res, data;
    try {
      res = await fetch("/api/usage", { credentials: "same-origin" });
      data = await res.json();
    } catch (e) {
      say("The reporting service did not respond. Try again in a moment.", "note-stop");
      return;
    }
    if (!res.ok) {
      say(data && data.error ? data.error : "That did not work. Try again in a moment.", "note-stop");
      return;
    }

    render(user, data.institutions || []);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
