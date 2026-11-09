/* Campus Filing: who is looking, answered once per page.

   Every page needs this and the gated pages need it before they render,
   so the request is made once here and shared. `require-account.js` and
   the account page both read `window.CF.session` rather than asking
   again, which is why this file is loaded first.

   The navigation is written here rather than in thirteen HTML files.
   Signed out it offers a way in; signed in it says who you are and
   offers a way out, which until now existed only as a button buried
   inside the account page.

   The role decides where "Account" points. It comes from the server,
   which reads it from the caller's profile row, so nothing a browser
   can edit changes what anyone is allowed to see. Pointing a navigation
   link at the staff dashboard would not help a student reach it: the
   reporting function refuses them, and the page says so. */

(function () {
  var CF = (window.CF = window.CF || {});

  CF.session = fetch("/api/auth", { credentials: "same-origin" })
    .then(function (r) {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then(function (d) { return (d && d.user) || null; });

  /* Deliberately not caught here. "Signed out" and "the account service
     is unreachable" are different answers, and the gate on the tools
     treats them differently: one sends you to sign in, the other shuts
     the tool and says so. Flattening a failure into null would quietly
     turn the second into the first. Each consumer catches for itself. */

  CF.isStaff = function (user) {
    return !!user && (user.role === "university_admin" || user.role === "tax_operations");
  };

  /* Pages sit at the root and one level down, so links are written
     relative to wherever this script was loaded from rather than
     assumed. */
  var base = (function () {
    var src = (document.currentScript && document.currentScript.src) || "";
    try { return new URL("../../", src).pathname; } catch (e) { return "/"; }
  })();

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  async function signOut() {
    try {
      await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "signout" })
      });
    } catch (e) { /* going home is the right move either way */ }
    location.href = base + "index.html";
  }

  /* What each role is offered. Staff do not get the student site: a
     university administrator has no use for a document checklist and
     tax operations is not here to file a return. Rebuilding the list is
     the honest version of this, rather than hiding links with CSS and
     leaving them in the page for anyone who looks. */
  var STAFF_NAV = {
    university_admin: [
      ["dashboard.html", "Overview"],
      ["about.html", "About Campus Filing"]
    ],
    tax_operations: [
      ["dashboard.html", "Overview"],
      ["dashboard.html?tab=taxyear", "Tax year"],
      ["about.html", "Methodology"]
    ]
  };

  /* "Delina Kahsay" gives DK. One word gives its first letter. With no
     name at all the address stands in, so the header never shows an
     empty circle while someone is signed in. */
  CF.initials = function (user) {
    var name = (user && user.name ? String(user.name) : "").trim();
    if (name) {
      var words = name.split(/\s+/).filter(Boolean);
      var first = words[0].charAt(0);
      var last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
      return (first + last).toUpperCase();
    }
    var email = (user && user.email) || "";
    return (email.charAt(0) || "?").toUpperCase();
  };

  function sessionSlot(user) {
    var slot = el("span", "nav-session");

    var who = el("a", "nav-initials", CF.initials(user));
    who.setAttribute("href", base + "account.html");
    /* The circle alone would read as decoration to a screen reader, and
       the initials alone would not say whose they are. */
    who.setAttribute("aria-label", "Your account, signed in as " + (user.name || user.email));
    who.setAttribute("title", user.name ? user.name + " (" + user.email + ")" : user.email);
    slot.appendChild(who);

    var out = el("button", "nav-signout", "Sign out");
    out.type = "button";
    out.addEventListener("click", signOut);
    slot.appendChild(out);
    return slot;
  }

  function render(user) {
    var nav = document.querySelector("nav.site-nav");
    if (!nav) return;

    if (!user) {
      var account = nav.querySelector('a[href$="account.html"]');
      if (account) account.textContent = "Sign in";
      nav.insertBefore(el("span", "nav-session"), nav.querySelector(".nav-cta"));
      return;
    }

    if (!CF.isStaff(user)) {
      var acct = nav.querySelector('a[href$="account.html"]');
      if (acct) acct.textContent = "My plans";
      nav.insertBefore(sessionSlot(user), nav.querySelector(".nav-cta"));
      return;
    }

    /* Staff: replace the student navigation outright. */
    var here = location.pathname.split("/").pop() + location.search;
    nav.textContent = "";
    (STAFF_NAV[user.role] || []).forEach(function (item) {
      var a = el("a", null, item[1]);
      a.setAttribute("href", base + item[0]);
      if (item[0] === here || (here === "dashboard.html" && item[0] === "dashboard.html")) {
        a.setAttribute("aria-current", "page");
      }
      nav.appendChild(a);
    });
    nav.appendChild(sessionSlot(user));
  }

  function start() {
    /* The navigation is the one place where an unreachable service and a
       signed-out visitor should look the same: offer a way in and let
       the page they land on explain itself. */
    CF.session.then(render, function () { render(null); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
