/* Campus Filing: one saved plan, read back.

   This page recomputes nothing. The walkthrough wrote a summary of what
   it concluded at the moment the student saved, and this renders that.
   A second implementation of the tax arithmetic here could drift from
   the first and show a student a different refund than the plan did,
   which is the one thing a saved plan must never do.

   A plan saved before summaries existed has none. That is a normal
   state, not an error: the page says so and offers the walkthrough,
   which can rebuild it. */

(function () {
  var $ = function (id) { return document.getElementById(id); };

  var DOC_LABEL = {
    w2: "Form W-2", "1098t": "Form 1098-T", "1098e": "Form 1098-E",
    "1099nec": "Form 1099-NEC", "1099misc": "Form 1099-MISC",
    "1099int": "Form 1099-INT", "1099div": "Form 1099-DIV",
    "1099b": "Form 1099-B", "1099k": "Form 1099-K", "1099g": "Form 1099-G",
    "1099r": "Form 1099-R", "1095a": "Form 1095-A", "1042s": "Form 1042-S",
    none: "No documents yet"
  };

  function money(n) {
    if (typeof n !== "number") return "n/a";
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US");
  }

  function say(message, kind) {
    var n = $("plan-status");
    n.textContent = message;
    n.className = "note" + (kind ? " " + kind : "");
    n.hidden = false;
  }

  function tile(value, label, tone) {
    var d = document.createElement("div");
    d.className = "stat" + (tone ? " stat-" + tone : "");
    var v = document.createElement("div");
    v.className = "value";
    v.textContent = value;
    var l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    d.appendChild(v); d.appendChild(l);
    return d;
  }

  function row(tbody, label, value) {
    if (value === null || value === undefined || value === "") return;
    var tr = document.createElement("tr");
    var th = document.createElement("th");
    th.setAttribute("scope", "row");
    th.textContent = label;
    var td = document.createElement("td");
    td.textContent = value;
    tr.appendChild(th); tr.appendChild(td);
    tbody.appendChild(tr);
  }

  function render(year, s) {
    $("plan-year").textContent = String(year);
    $("plan-edit").setAttribute("href", "app/file.html?resume=" + encodeURIComponent(year));

    /* The headline is the thing the student came back to find out. */
    var owed = typeof s.refund === "number" && s.refund < 0;
    $("plan-headline").textContent = typeof s.refund !== "number"
      ? "Your filing plan"
      : (owed ? "You owe " + money(Math.abs(s.refund)) : "You should get " + money(s.refund) + " back");

    $("plan-sub").textContent = s.software
      ? "File with " + s.software + ". " + (s.returns || "")
      : (s.returns || "");

    var stats = $("plan-stats");
    stats.textContent = "";
    if (typeof s.refund === "number") {
      stats.appendChild(tile(money(Math.abs(s.refund)),
        owed ? "Estimated amount owed" : "Estimated refund", owed ? "warn" : "good"));
    }
    if (s.software) stats.appendChild(tile(s.software, "File with"));
    if (typeof s.mustFile === "boolean") {
      stats.appendChild(tile(s.mustFile ? "Required" : "Not required",
        s.mustFile ? "You must file" : "Filing is optional, but worth it"));
    }
    if (s.educationCredit) stats.appendChild(tile(s.educationCredit, "Education credit"));

    var steps = s.steps || [];
    var list = $("plan-steps");
    list.textContent = "";
    steps.forEach(function (text) {
      var li = document.createElement("li");
      li.textContent = text;
      list.appendChild(li);
    });
    $("plan-steps-empty").hidden = steps.length > 0;

    var docs = s.documents || [];
    var ul = $("plan-docs");
    ul.textContent = "";
    docs.forEach(function (key) {
      var li = document.createElement("li");
      li.textContent = DOC_LABEL[key] || key;
      ul.appendChild(li);
    });
    $("plan-docs-empty").hidden = docs.length > 0;

    var detail = $("plan-detail");
    detail.textContent = "";
    row(detail, "Total income", typeof s.income === "number" ? money(s.income) : null);
    row(detail, "Standard deduction", typeof s.standardDeduction === "number" ? money(s.standardDeduction) : null);
    row(detail, "Dependency", s.dependency);
    row(detail, "Returns to file", s.returns);
    row(detail, "Education credit", s.educationCredit);

    $("plan-body").hidden = false;
  }

  async function start() {
    var user;
    try { user = await window.CF.session; }
    catch (e) { say("The account service did not respond. Try again in a moment.", "note-stop"); return; }
    if (!user) return; /* require-account.js is already redirecting */

    var year = new URLSearchParams(location.search).get("year");
    if (!year || !/^\d{4}$/.test(year)) {
      say("No plan was named. Pick one from your account page.", "note-warn");
      return;
    }

    var res, data;
    try {
      res = await fetch("/api/plans?year=" + encodeURIComponent(year), { credentials: "same-origin" });
      data = await res.json();
    } catch (e) {
      say("That plan could not be loaded. Try again in a moment.", "note-stop");
      return;
    }
    if (res.status === 404) { say("There is no saved plan for " + year + ".", "note-warn"); return; }
    if (!res.ok) { say(data && data.error ? data.error : "That plan could not be loaded.", "note-stop"); return; }

    if (!data.summary) {
      say("This plan was saved before summaries existed, so there is nothing to show here yet. "
        + "Open it in the walkthrough and save it again to rebuild it.", "note-warn");
      $("plan-year").textContent = String(year);
      $("plan-edit").setAttribute("href", "app/file.html?resume=" + encodeURIComponent(year));
      $("plan-body").hidden = false;
      $("plan-stats").textContent = "";
      $("plan-steps-empty").hidden = false;
      $("plan-docs-empty").hidden = false;
      return;
    }

    render(year, data.summary);
  }

  $("plan-print") && $("plan-print").addEventListener("click", function () { window.print(); });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
