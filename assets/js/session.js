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

  function render(user) {
    var nav = document.querySelector("nav.site-nav");
    if (!nav) return;

    var account = nav.querySelector('a[href$="account.html"]');
    var slot = el("span", "nav-session");

    if (!user) {
      if (account) account.textContent = "Sign in";
      nav.insertBefore(slot, nav.querySelector(".nav-cta"));
      return;
    }

    if (account) {
      account.textContent = CF.isStaff(user) ? "Dashboard" : "My plans";
      if (CF.isStaff(user)) account.setAttribute("href", base + "dashboard.html");
    }

    slot.appendChild(el("span", "nav-who", user.email));
    var out = el("button", "nav-signout", "Sign out");
    out.type = "button";
    out.addEventListener("click", signOut);
    slot.appendChild(out);
    nav.insertBefore(slot, nav.querySelector(".nav-cta"));

    /* A student is the only one the walkthrough is for. Staff get a link
       to their own view instead of an invitation to file taxes. */
    var cta = nav.querySelector(".nav-cta");
    if (cta && CF.isStaff(user)) {
      cta.textContent = "Open dashboard";
      cta.setAttribute("href", base + "dashboard.html");
    }
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
