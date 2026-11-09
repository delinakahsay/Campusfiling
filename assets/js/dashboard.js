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
    tax_operations: "Tax operations"
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
      return a;
    }, { students: 0, plans: 0, docs: 0 });

    $("t-students").textContent = num(totals.students);
    $("t-plans").textContent = num(totals.plans);
    $("t-docs").textContent = num(totals.docs);
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
