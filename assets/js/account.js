/* Campus Filing: the account page.

   Talks only to /api/auth and /api/plans on this domain. The session is
   held in HttpOnly cookies this script cannot read, which is the point:
   nothing on the page, including a script someone manages to inject,
   can lift a token out of it. */

(function () {
  const $ = function (id) { return document.getElementById(id); };
  let mode = "signin";

  async function api(path, options) {
    options = options || {};
    try {
      const res = await fetch(path, {
        method: options.method || "GET",
        headers: options.body ? { "Content-Type": "application/json" } : {},
        body: options.body ? JSON.stringify(options.body) : undefined,
        credentials: "same-origin"
      });
      let data = {};
      try { data = await res.json(); } catch (e) { data = {}; }
      return { ok: res.ok, status: res.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: { error: "Could not reach the server. Check your connection and try again." } };
    }
  }

  function status(message, kind) {
    const el = $("acct-status");
    if (!message) { el.hidden = true; return; }
    el.hidden = false;
    el.className = "note " + (kind || "");
    el.textContent = message;
  }

  function show(which) {
    ["acct-loading", "acct-out", "acct-reset", "acct-in"].forEach(function (id) {
      $(id).hidden = id !== which;
    });
  }

  function busy(button, on, label) {
    if (on) { button.dataset.label = button.textContent; button.textContent = label; }
    else if (button.dataset.label) { button.textContent = button.dataset.label; }
    button.disabled = on;
  }

  /* ---------- signed out ---------- */

  function setMode(next) {
    mode = next;
    const signup = mode === "signup";
    $("auth-title").textContent = signup ? "Create an account" : "Sign in";
    $("auth-submit").textContent = signup ? "Create account" : "Sign in";
    $("auth-switch").textContent = signup ? "Already have an account? Sign in" : "New here? Create an account";
    $("auth-password").autocomplete = signup ? "new-password" : "current-password";
    $("auth-password-help").hidden = !signup;
    $("auth-name-field").hidden = !signup;
    $("auth-err").textContent = "";
  }

  async function submitAuth(e) {
    e.preventDefault();
    const email = $("auth-email").value.trim();
    const password = $("auth-password").value;
    const err = $("auth-err");
    err.textContent = "";
    if (!email || !password) { err.textContent = "Enter your email and password."; return; }
    if (mode === "signup" && password.length < 8) { err.textContent = "Choose a password of at least 8 characters."; return; }

    const button = $("auth-submit");
    busy(button, true, mode === "signup" ? "Creating account" : "Signing in");
    const payload = { action: mode, email: email, password: password };
    if (mode === "signup") payload.name = $("auth-name").value.trim();
    const r = await api("/api/auth", { method: "POST", body: payload });
    busy(button, false);

    if (!r.ok) { err.textContent = r.data.error || "That did not work. Try again."; return; }
    $("auth-password").value = "";
    if (r.data.confirmEmail) {
      status("Account created. Check " + email + " for a confirmation link, then come back here to sign in.", "note-good");
      setMode("signin");
      return;
    }
    status("");
    await signedIn(r.data.user);
  }

  async function submitForgot(e) {
    e.preventDefault();
    const email = $("forgot-email").value.trim();
    const err = $("forgot-err");
    err.textContent = "";
    if (!email) { err.textContent = "Enter your email."; return; }
    const button = $("forgot-submit");
    busy(button, true, "Sending");
    const r = await api("/api/auth", { method: "POST", body: { action: "recover", email: email } });
    busy(button, false);
    if (!r.ok) { err.textContent = r.data.error || "That did not work. Try again."; return; }
    $("forgot").hidden = true;
    status("If an account uses " + email + ", a reset link is on its way. It opens this page.", "note-good");
  }

  /* ---------- signed in ---------- */

  /* Where to go once signed in, when a gated page sent the student here.
     Only a same-origin absolute path is honoured. A value beginning "//"
     or carrying a scheme would turn this into an open redirect, which is
     worth guarding even though the link is one we write ourselves. */
  function safeNext() {
    const raw = new URLSearchParams(location.search).get("next");
    if (!raw) return null;
    if (raw.charAt(0) !== "/" || raw.charAt(1) === "/" || raw.indexOf("\\") >= 0) return null;
    return raw;
  }

  async function signedIn(user) {
    const next = safeNext();
    if (next) { location.replace(next); return; }

    /* Staff have no filing plans of their own to show here. The role
       arrives with the identity from the server, which read it from the
       profile row, so this is a convenience rather than a control: the
       dashboard refuses a student on its own account. */
    if (user.role === "university_admin" || user.role === "tax_operations") {
      location.replace("dashboard.html");
      return;
    }
    $("acct-email").textContent = user.email;
    $("info-name").textContent = user.name || "Not set";
    $("info-institution").textContent = user.institution || "Not recognised";
    $("name-value").value = user.name || "";
    show("acct-in");
    await loadPlans();
  }

  function formatWhen(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) +
      ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  async function loadPlans() {
    const err = $("plans-err");
    err.textContent = "";
    const r = await api("/api/plans");
    if (r.status === 401) { signedOut("Your session has ended. Sign in again."); return; }
    if (!r.ok) { err.textContent = r.data.error || "Saved plans could not be loaded."; return; }

    const plans = r.data.plans || [];
    const body = $("plans-body");
    body.innerHTML = "";
    $("plans-empty").hidden = plans.length > 0;
    $("plans-wrap").hidden = plans.length === 0;

    plans.forEach(function (p) {
      const tr = document.createElement("tr");
      const year = document.createElement("th");
      year.scope = "row";
      year.textContent = String(p.taxYear);
      const when = document.createElement("td");
      when.textContent = formatWhen(p.updatedAt);

      const actions = document.createElement("td");
      const wrap = document.createElement("div");
      wrap.className = "plan-actions";
      /* Open goes to the summary, not back into the nine sections. Most
         returns here are to re-read what the plan said, not to change an
         answer, and the summary offers the walkthrough as its own next
         step for the times it is. */
      const open = document.createElement("a");
      open.className = "btn btn-sm";
      open.href = "plan.html?year=" + encodeURIComponent(p.taxYear);
      open.textContent = "Open";
      open.setAttribute("aria-label", "Open your " + p.taxYear + " plan");

      const edit = document.createElement("a");
      edit.className = "btn btn-ghost btn-sm";
      edit.href = "app/file.html?resume=" + encodeURIComponent(p.taxYear);
      edit.textContent = "Edit answers";
      edit.setAttribute("aria-label", "Edit the answers behind your " + p.taxYear + " plan");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn-ghost btn-sm";
      del.textContent = "Delete";
      del.setAttribute("aria-label", "Delete your " + p.taxYear + " plan");
      armed(del, "Confirm delete", async function () {
        busy(del, true, "Deleting");
        const d = await api("/api/plans?year=" + encodeURIComponent(p.taxYear), { method: "DELETE" });
        busy(del, false);
        if (!d.ok) { err.textContent = d.data.error || "That plan could not be deleted."; return; }
        status("Your " + p.taxYear + " plan was deleted.", "note-good");
        await loadPlans();
      });
      wrap.appendChild(open);
      wrap.appendChild(edit);
      wrap.appendChild(del);
      actions.appendChild(wrap);

      tr.appendChild(year);
      tr.appendChild(when);
      tr.appendChild(actions);
      body.appendChild(tr);
    });
  }

  /* A destructive button asks twice: the first click arms it, the second
     acts, and it disarms itself after a few seconds. Same as Start over. */
  function armed(button, armedLabel, action) {
    let timer = null;
    const label = button.textContent;
    button.addEventListener("click", function () {
      if (!button.classList.contains("btn-armed")) {
        button.classList.add("btn-armed");
        button.textContent = armedLabel;
        timer = setTimeout(function () {
          button.classList.remove("btn-armed");
          button.textContent = label;
        }, 5000);
        return;
      }
      clearTimeout(timer);
      button.classList.remove("btn-armed");
      button.textContent = label;
      action();
    });
  }

  function signedOut(message, kind) {
    show("acct-out");
    setMode("signin");
    status(message || "", kind || "note-warn");
  }

  async function signOut() {
    const button = $("signout");
    busy(button, true, "Signing out");
    await api("/api/auth", { method: "POST", body: { action: "signout" } });
    busy(button, false);
    signedOut("You are signed out.", "note-good");
  }

  async function submitPassword(formId, inputId, buttonId, errId, onDone) {
    const err = $(errId);
    err.textContent = "";
    const password = $(inputId).value;
    if (password.length < 8) { err.textContent = "Choose a password of at least 8 characters."; return; }
    const button = $(buttonId);
    busy(button, true, "Saving");
    const r = await api("/api/auth", { method: "POST", body: { action: "password", password: password } });
    busy(button, false);
    if (!r.ok) { err.textContent = r.data.error || "That did not work. Try again."; return; }
    $(inputId).value = "";
    onDone(r.data.user);
  }

  /* ---------- arriving from an email link ---------- */

  /* Supabase puts the session in the URL fragment. It is read once,
     handed to the server, and wiped from the address bar so it is not
     left in history or copied into a shared link. */
  function fragment() {
    if (!location.hash || location.hash.length < 2) return null;
    const params = new URLSearchParams(location.hash.slice(1));
    history.replaceState(null, "", location.pathname + location.search);
    return params;
  }

  async function init() {
    $("auth-form").addEventListener("submit", submitAuth);
    $("auth-switch").addEventListener("click", function () { setMode(mode === "signin" ? "signup" : "signin"); });
    $("forgot-open").addEventListener("click", function () {
      $("forgot").hidden = false;
      $("forgot-email").value = $("auth-email").value;
      $("forgot-email").focus();
    });
    $("forgot-form").addEventListener("submit", submitForgot);
    $("signout").addEventListener("click", signOut);

    $("name-form").addEventListener("submit", async function (e) {
      e.preventDefault();
      const err = $("name-err");
      err.textContent = "";
      const button = $("name-submit");
      busy(button, true, "Saving");
      const r = await api("/api/auth", {
        method: "POST", body: { action: "name", name: $("name-value").value.trim() }
      });
      busy(button, false);
      if (!r.ok) { err.textContent = r.data.error || "That did not work."; return; }
      $("info-name").textContent = r.data.name || "Not set";
      status("Name saved. Your initials update when the page reloads.", "note-good");
    });
    $("change-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitPassword("change-form", "change-password", "change-submit", "change-err", function () {
        status("Password changed.", "note-good");
      });
    });
    $("reset-form").addEventListener("submit", function (e) {
      e.preventDefault();
      submitPassword("reset-form", "reset-password", "reset-submit", "reset-err", function (user) {
        status("Password changed. You are signed in.", "note-good");
        signedIn(user);
      });
    });
    armed($("delete-account"), "Yes, delete everything", async function () {
      const button = $("delete-account");
      busy(button, true, "Deleting");
      const r = await api("/api/auth", { method: "POST", body: { action: "delete", confirm: "delete" } });
      busy(button, false);
      if (!r.ok) { $("delete-err").textContent = r.data.error || "Your account could not be deleted."; return; }
      signedOut("Your account and every saved plan were deleted.", "note-good");
    });


    const params = fragment();
    if (params && params.get("error")) {
      signedOut("That link has expired or was already used. Request a new one.", "note-stop");
      return;
    }
    if (params && params.get("access_token") && params.get("refresh_token")) {
      const r = await api("/api/auth", { method: "POST", body: {
        action: "adopt", access_token: params.get("access_token"), refresh_token: params.get("refresh_token")
      } });
      if (!r.ok) { signedOut(r.data.error, "note-stop"); return; }
      if (params.get("type") === "recovery") { show("acct-reset"); $("reset-password").focus(); return; }
      status("Your email is confirmed and you are signed in.", "note-good");
      await signedIn(r.data.user);
      return;
    }

    const me = await api("/api/auth");
    if (me.ok && me.data.user) { await signedIn(me.data.user); return; }
    if (!me.ok) { signedOut(me.data.error || "The account service did not respond. Try again in a moment.", "note-stop"); return; }
    signedOut();

    /* Why they are here, if a gated tool sent them. This runs after
       signedOut() rather than before, because signedOut resets the form
       to sign-in and clears the message, which wiped both. Someone
       arriving from a gated tool usually has no account yet, so the
       form opens on create rather than sign in. */
    if (safeNext()) {
      setMode("signup");
      status("The filing tools need an account. Create one and you will be taken straight there.", "");
    } else if (new URLSearchParams(location.search).get("from") === "save") {
      setMode("signup");
      status("Sign in or create an account, then go back to your plan and save it.", "");
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();
