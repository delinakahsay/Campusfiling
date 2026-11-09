/* Campus Filing: help with the section you are on.

   Loaded only on the walkthrough. It is not a general chat window, and
   the interface says so: it opens with the name of the section the
   student is in and three questions people actually ask there, because
   the product's whole argument is that a student who has never filed
   does not know what to type into an empty box.

   It reads the current section from the DOM and the figures from the
   walkthrough's own derive(), so there is no second copy of either. If
   the walkthrough is not loaded, the panel still works and simply sends
   no figures. */

(function () {
  var MAX = 500;

  /* The openers are the questions students ask at each step. They do
     two jobs: they get someone started who would not have typed
     anything, and they show what this thing is for. */
  var OPENERS = [
    ["What does resident for tax purposes mean?", "I am on a student visa, does this apply to me?"],
    ["Why does my age matter?", "What counts as a full-time student?"],
    ["What does being claimed as a dependent change?", "How do I ask my parents about this?"],
    ["Which forms should I have?", "What if I never got a W-2?"],
    ["Where do I find my wages on a W-2?", "Does money from a side job count?"],
    ["Is my scholarship taxable?", "What is a 1098-T for?"],
    ["What is a marketplace plan?", "I got a 1095-A, what now?"],
    ["Why do I file in two states?", "Which state return goes first?"],
    ["Why is my refund this amount?", "What do I do first?"]
  ];

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  /* 1 to 9, read off whichever panel is showing. */
  function currentSection() {
    var open = document.querySelector(".panel:not([hidden])");
    if (!open || !open.id) return 1;
    var n = parseInt(String(open.id).replace(/\D/g, ""), 10);
    return isNaN(n) ? 1 : Math.min(9, Math.max(1, n + 1));
  }

  function sectionTitle() {
    var open = document.querySelector(".panel:not([hidden])");
    var h = open && open.querySelector("h2");
    return h ? h.textContent.trim() : "the walkthrough";
  }

  /* The same figures the filing guide already sends. Never a name, a
     Social Security number, an employer or an address: the walkthrough
     has no field for any of them. */
  function context() {
    try {
      if (typeof collect !== "function" || typeof derive !== "function") return null;
      collect();
      var d = derive();
      return {
        income: d.total,
        refund: d.refund,
        standardDeduction: d.sd,
        mustFile: !!d.mustFile,
        dependency: d.dep && d.dep.status ? String(d.dep.status) : null,
        status: typeof A === "object" && A.status ? String(A.status) : null,
        returns: (typeof stateSummary === "function" && d.states)
          ? (stateSummary(d.states).join(", ") || "Federal only") : null
      };
    } catch (e) {
      return null;
    }
  }

  var panel, log, input, send, toggle, openers, busy = false;

  function bubble(who, text) {
    var row = el("div", "ask-msg ask-" + who);
    row.appendChild(el("p", null, text));
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
    return row;
  }

  function setBusy(state) {
    busy = state;
    send.disabled = state;
    input.disabled = state;
    send.textContent = state ? "Asking" : "Ask";
  }

  async function ask(question) {
    if (busy || !question) return;
    if (question.length > MAX) {
      bubble("bot", "That question is longer than I take. Try a shorter one.");
      return;
    }
    if (openers) { openers.remove(); openers = null; }

    bubble("you", question);
    input.value = "";
    setBusy(true);
    var waiting = bubble("bot", "Thinking.");

    var res, data;
    try {
      res = await fetch("/api/ask", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: question,
          section: currentSection(),
          context: context()
        })
      });
      data = await res.json();
    } catch (e) {
      waiting.remove();
      bubble("bot", "I could not reach the assistant. Your answers on this page are untouched; try again in a moment.");
      setBusy(false);
      return;
    }

    waiting.remove();
    setBusy(false);

    if (res.status === 401) {
      bubble("bot", "Your session has ended. Sign in again and your question will go through.");
      return;
    }
    if (!res.ok) {
      bubble("bot", (data && data.error) || "That did not work. Try again in a moment.");
      return;
    }

    var row = bubble("bot", data.reply);
    /* Only when it points somewhere else. Being told the answer is in
       the section you are looking at is noise. */
    if (data.inScope && data.sectionName && data.section !== currentSection()) {
      row.appendChild(el("p", "ask-jump",
        "This is settled in section " + data.section + ", " + data.sectionName + "."));
    }
  }

  function buildOpeners() {
    var wrap = el("div", "ask-openers");
    wrap.appendChild(el("p", "ask-openers-head", "You are on " + sectionTitle() + ". People here often ask:"));
    (OPENERS[currentSection() - 1] || []).forEach(function (q) {
      var b = el("button", "ask-opener", q);
      b.type = "button";
      b.addEventListener("click", function () { ask(q); });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    if (!log.children.length && !openers) {
      openers = buildOpeners();
      log.appendChild(openers);
    }
    input.focus();
  }

  function close() {
    panel.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  }

  function build() {
    toggle = el("button", "ask-toggle", "Ask about this step");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "ask-panel");

    panel = el("div", "ask-panel");
    panel.id = "ask-panel";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Help with this step");

    var head = el("div", "ask-head");
    head.appendChild(el("strong", null, "Help with this step"));
    var x = el("button", "ask-close", "Close");
    x.type = "button";
    x.addEventListener("click", close);
    head.appendChild(x);

    log = el("div", "ask-log");
    log.setAttribute("aria-live", "polite");

    var form = el("form", "ask-form");
    input = el("input", "ask-input");
    input.type = "text";
    input.maxLength = MAX;
    input.placeholder = "Ask about this section";
    input.setAttribute("aria-label", "Your question about this section");
    send = el("button", "ask-send", "Ask");
    send.type = "submit";
    form.appendChild(input);
    form.appendChild(send);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      ask(input.value.trim());
    });

    var foot = el("p", "ask-foot",
      "Guidance, not tax advice. It can see the figures you have entered, never your name or any identifying detail.");

    panel.appendChild(head);
    panel.appendChild(log);
    panel.appendChild(form);
    panel.appendChild(foot);

    toggle.addEventListener("click", function () {
      panel.hidden ? open() : close();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) close();
    });

    var mount = el("div", "ask-mount");
    mount.appendChild(panel);
    mount.appendChild(toggle);
    document.body.appendChild(mount);
  }

  function start() {
    /* Students only. Staff have no walkthrough to be helped through,
       and the gate means nobody reaches this page signed out. */
    if (!window.CF || !window.CF.session) return;
    window.CF.session.then(function (user) {
      if (!user || window.CF.isStaff(user)) return;
      build();
    }, function () { /* the gate already explains an unreachable service */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
