/* Campus Filing: the tools require an account.

   Included on the walkthrough and the estimator. The reference pages,
   the guides, deadlines, the FAQ, privacy and about, stay open to
   anyone, because gating public tax information helps nobody and a
   privacy page nobody can read is not a privacy page.

   What this is, and what it is not. The walkthrough computes everything
   in the browser, so there is no server resource behind this door. The
   check is a product rule, not a security boundary: anyone who turns off
   JavaScript or reads the page source can still use the arithmetic. The
   thing that genuinely needs protecting, a student's saved answers, is
   guarded in the database by Row Level Security, which the browser
   cannot talk its way around.

   The page is hidden until the answer comes back, so the tool never
   flashes up before the redirect. Every branch restores it, and a
   failsafe restores it anyway if the request hangs, because a blank
   page is a worse failure than an ungated one. */

(function () {
  var doc = document;
  var src = (doc.currentScript && doc.currentScript.src) || "";
  var accountUrl;
  try {
    accountUrl = new URL("../../account.html", src).href;
  } catch (e) {
    accountUrl = "/account.html";
  }

  var HIDE = "body>*:not(#gate-msg){visibility:hidden}";
  var style = doc.createElement("style");
  style.id = "gate-style";
  style.textContent = HIDE;
  (doc.head || doc.documentElement).appendChild(style);

  function reveal() {
    var s = doc.getElementById("gate-style");
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }

  var failsafe = setTimeout(reveal, 8000);

  /* Shown when the account service cannot be reached at all. The tool
     stays shut rather than opening on a failed check, but it says so
     plainly instead of bouncing the student to a sign-in page that is
     equally unreachable. */
  function serviceDown() {
    var wrap = doc.createElement("div");
    wrap.id = "gate-msg";
    wrap.setAttribute("role", "alert");
    wrap.style.cssText =
      "max-width:34rem;margin:14vh auto;padding:28px 30px;font:16px/1.65 system-ui,sans-serif;" +
      "border:1px solid #D8D4CC;border-radius:10px;background:#fff;color:#1B2B44";
    var h = doc.createElement("h1");
    h.style.cssText = "margin:0 0 10px;font-size:22px";
    h.textContent = "The account service is not responding";
    var p = doc.createElement("p");
    p.style.cssText = "margin:0 0 16px;color:#5A6470";
    p.textContent = "This tool needs you signed in, and we cannot check that right now. " +
      "It is usually brief. Try again in a moment.";
    var a = doc.createElement("a");
    a.href = location.href;
    a.textContent = "Try again";
    a.style.cssText = "color:#1C6B4A;font-weight:600";
    wrap.appendChild(h); wrap.appendChild(p); wrap.appendChild(a);
    (doc.body || doc.documentElement).appendChild(wrap);
  }

  function toAccount() {
    var next = location.pathname + location.search;
    location.replace(accountUrl + "?next=" + encodeURIComponent(next));
  }

  /* session.js loads first and has already asked. Reuse its answer
     rather than making a second identical request, which would show the
     navigation for one state while the gate acted on another. */
  var asking = (window.CF && window.CF.session)
    ? window.CF.session
    : fetch("/api/auth", { credentials: "same-origin" })
        .then(function (r) {
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        })
        .then(function (d) { return (d && d.user) || null; });

  asking
    .then(function (user) {
      clearTimeout(failsafe);
      if (user) { reveal(); return; }
      toAccount();
    })
    .catch(function () {
      clearTimeout(failsafe);
      if (doc.body) serviceDown();
      else doc.addEventListener("DOMContentLoaded", serviceDown);
    });
})();
