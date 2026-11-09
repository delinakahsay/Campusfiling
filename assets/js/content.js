/* Campus Filing: live site content.

   Two jobs, one fetch.

   Every visitor: apply the saved text and figure overrides, so the page
   shows what the tax content manager last published rather than what
   shipped. Figures are applied to TAX_YEARS itself and the data-tax
   spans refilled, which is what makes an edited standard deduction reach
   the walkthrough's arithmetic and every figure printed on the site, not
   just one table.

   The tax content manager: the same elements grow an Edit control, and
   a save goes back through /api/content to the database, which checks
   the role and records who changed what and when. Everything is applied
   as plain text through textContent, never markup, so nothing saved can
   carry script onto a public page.

   Slots are positional: the fifth paragraph on the FAQ page is
   faq:p:5. That is deliberate and it has a known cost: inserting a new
   question in the HTML shifts the numbering, and saved edits land one
   block off until resaved. The honest alternative is hand-naming every
   block in the markup, which nobody maintains. For this product the
   text changes often and the structure rarely, which is the trade this
   choice is built on. */

(function () {
  var CF = (window.CF = window.CF || {});

  var PAGE = (location.pathname.split("/").pop() || "index.html").replace(".html", "");

  /* Which blocks each page offers for editing. "plain" is text with line
     breaks kept; "titled" is a timeline entry whose first line renders
     bold, the way the markup already draws it. */
  var EDITABLE = {
    deadlines: [
      ["#main h2", "plain"],
      [".timeline .when", "plain"],
      [".timeline .what", "titled"],
      ["#main .split p", "plain"]
    ],
    faq: [
      ["#main h2", "plain"],
      ["#main details.qa summary", "plain"],
      ["#main details.qa p", "plain"],
      ["#main > .wrap > p", "plain"]
    ]
  };

  function regions() {
    var defs = EDITABLE[PAGE];
    if (!defs) return [];
    var out = [];
    defs.forEach(function (def) {
      var kindName = def[0].replace(/[^a-z]+/gi, "-").replace(/^-+|-+$/g, "").slice(-14);
      document.querySelectorAll(def[0]).forEach(function (el, i) {
        out.push({ el: el, kind: def[1], slot: PAGE + ":" + kindName + ":" + i });
      });
    });
    return out;
  }

  function renderInto(el, kind, text) {
    el.textContent = "";
    if (kind === "titled") {
      var lines = text.split("\n");
      var b = document.createElement("b");
      b.textContent = lines[0];
      el.appendChild(b);
      el.appendChild(document.createTextNode(lines.slice(1).join("\n")));
    } else {
      el.textContent = text;
    }
    if (text.indexOf("\n") > -1) el.style.whiteSpace = "pre-line";
  }

  function textOf(el, kind) {
    if (kind === "titled") {
      var b = el.querySelector("b");
      var title = b ? b.textContent : "";
      var clone = el.cloneNode(true);
      var cb = clone.querySelector("b");
      if (cb) cb.remove();
      return (title + "\n" + clone.textContent).trim();
    }
    return el.textContent.trim();
  }

  /* ---------- apply, for everyone ---------- */

  CF.content = fetch("/api/content", { credentials: "same-origin" })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .catch(function () { return { slots: {}, figures: [] }; });

  CF.applyFigures = applyFigures;

  function applyFigures(figures) {
    if (typeof TAX_YEARS === "undefined") return;
    (figures || []).forEach(function (f) {
      var year = TAX_YEARS[f.taxYear];
      if (!year) return;
      if (typeof year[f.figure] !== "number") return;
      year[f.figure] = f.value;
    });
    if (typeof fillTaxSpans === "function") fillTaxSpans();
  }

  function applySlots(slots) {
    regions().forEach(function (r) {
      if (Object.prototype.hasOwnProperty.call(slots, r.slot)) {
        renderInto(r.el, r.kind, slots[r.slot]);
      }
    });
  }

  /* ---------- the editor, for the tax content manager ---------- */

  function editor(region) {
    var el = region.el;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "edit-pen";
    button.textContent = "Edit";
    button.setAttribute("aria-label", "Edit this text");

    button.addEventListener("click", function () {
      var box = document.createElement("div");
      box.className = "edit-box";
      var area = document.createElement("textarea");
      area.className = "edit-area";
      area.value = textOf(el, region.kind);
      area.rows = Math.min(10, Math.max(3, area.value.split("\n").length + 1));
      if (region.kind === "titled") {
        var hint = document.createElement("p");
        hint.className = "edit-hint";
        hint.textContent = "The first line is the bold heading, the rest is the body.";
        box.appendChild(hint);
      }
      var row = document.createElement("div");
      row.className = "btn-row";
      var save = document.createElement("button");
      save.type = "button"; save.className = "btn btn-green btn-sm"; save.textContent = "Save";
      var cancel = document.createElement("button");
      cancel.type = "button"; cancel.className = "btn btn-ghost btn-sm"; cancel.textContent = "Cancel";
      var err = document.createElement("span");
      err.className = "error"; err.setAttribute("role", "alert");
      row.appendChild(save); row.appendChild(cancel); row.appendChild(err);
      box.appendChild(area); box.appendChild(row);

      el.style.display = "none";
      button.style.display = "none";
      el.parentNode.insertBefore(box, el.nextSibling);
      area.focus();

      function done() {
        box.remove();
        el.style.display = "";
        button.style.display = "";
      }
      cancel.addEventListener("click", done);

      save.addEventListener("click", async function () {
        save.disabled = true;
        err.textContent = "";
        var value = area.value.trim();
        var r2, data;
        try {
          r2 = await fetch("/api/content", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slot: region.slot, content: value })
          });
          data = await r2.json();
        } catch (e) {
          save.disabled = false;
          err.textContent = "Could not reach the server. Try again.";
          return;
        }
        save.disabled = false;
        if (!r2.ok) { err.textContent = (data && data.error) || "That did not save."; return; }
        if (value) renderInto(el, region.kind, value);
        done();
      });
    });

    el.parentNode.insertBefore(button, el.nextSibling);
  }

  function start() {
    CF.content.then(function (data) {
      applySlots(data.slots || {});
      applyFigures(data.figures || []);

      if (!CF.session) return;
      CF.session.then(function (user) {
        if (!user || user.role !== "tax_operations") return;
        if (!EDITABLE[PAGE]) return;
        document.body.classList.add("is-editing");
        regions().forEach(editor);
      }, function () { /* signed-out view is already applied */ });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
