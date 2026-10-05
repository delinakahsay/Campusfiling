/* Campus Filing: four question refund estimator.
   Deliberately narrower than the walkthrough. It answers "roughly what
   am I getting back" and is explicit about everything it leaves out. */

document.addEventListener("DOMContentLoaded", function () {
  const form = document.getElementById("est-form");
  if (!form) return;

  const out = document.getElementById("est-out");
  const err = document.getElementById("est-err");

  function val(id) {
    const raw = document.getElementById(id).value;
    if (raw === "") return null;
    const n = parseFloat(raw);
    return isNaN(n) || n < 0 ? null : n;
  }

  function radio(name) {
    const el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  function run() {
    err.textContent = "";

    const wages = val("est-wages");
    const withheld = val("est-withheld");
    const gig = val("est-gig");
    const claimed = radio("est-claimed");

    if (wages === null) { err.textContent = "Enter your wages as a number, or 0 if you had none."; return; }
    if (withheld === null) { err.textContent = "Enter the federal tax withheld as a number, or 0."; return; }
    if (gig === null) { err.textContent = "Enter your gig profit as a number, or 0 if you had none."; return; }
    if (!claimed) { err.textContent = "Choose whether someone can claim you."; return; }

    const isDependent = claimed === "yes";
    const earned = wages + gig;

    const sd = isDependent
      ? dependentStandardDeduction(earned, TAX)
      : TAX.singleStandardDeduction;

    /* Half of self employment tax reduces income before tax is figured.
       Leaving it out overstates tax for every gig worker. */
    const se = selfEmploymentTax(gig, TAX);
    const halfSe = halfSelfEmploymentDeduction(gig, TAX);
    const agi = Math.max(0, earned - halfSe);

    const taxable = Math.max(0, agi - sd);
    const income = federalIncomeTax(taxable, TAX);
    const total = income + se;
    const net = withheld - total;

    let headline, tone, detail;

    if (net >= 0) {
      headline = money(net) + " back";
      tone = "note-good";
      detail = net === 0
        ? "You break even. Nothing was withheld and nothing is owed."
        : "You prepaid " + money(withheld) + " through your paycheck against about " + money(total) + " of tax, so the difference comes back to you.";
    } else {
      headline = money(Math.abs(net)) + " owed";
      tone = "note-warn";
      detail = se > 0
        ? "About " + money(se) + " of that is self-employment tax on your gig income, which no one withheld for you. File on time even if you cannot pay it all at once, because the late filing penalty is far larger than the late payment penalty."
        : "Not enough was withheld from your pay to cover the tax. File on time and set up a payment plan if you need one.";
    }

    const lines = [
      ["Total income", money(earned)],
      ["Less half of self-employment tax", se > 0 ? money(-halfSe) : money(0)],
      ["Adjusted gross income", money(agi)],
      ["Standard deduction", money(sd) + (isDependent ? " (dependent limit)" : "")],
      ["Taxable income", money(taxable)],
      ["Federal income tax", money(income)]
    ];
    if (se > 0) lines.push(["Self-employment tax", money(se)]);
    lines.push(["Federal tax withheld", money(withheld)]);

    const rows = lines.map(function (r) {
      return '<tr><td>' + r[0] + '</td><td class="num">' + r[1] + '</td></tr>';
    }).join("");

    out.innerHTML =
      '<div class="note ' + tone + '" style="max-width:none">' +
        '<div style="font-size:30px;font-weight:600;line-height:1.2;font-variant-numeric:tabular-nums">' + headline + '</div>' +
        '<p style="margin-top:6px">' + detail + '</p>' +
      '</div>' +
      '<div class="table-wrap"><table class="data"><tbody>' + rows + '</tbody></table></div>' +
      '<p class="caption">Tax year ' + TAX.year + ', single filer brackets. This estimate covers wages, gig profit, the standard deduction, self-employment tax, and the deduction for half of it. It does <strong>not</strong> cover education credits, taxable scholarship money, investment income or losses, marketplace insurance reconciliation, or any state tax. Each of those can move the number by hundreds of dollars.</p>' +
      '<div class="btn-row"><a class="btn btn-green" href="app/file.html">Run the full walkthrough</a>' +
      '<span class="aside">It covers scholarships, credits, investments, and state returns.</span></div>';

    out.hidden = false;
    out.setAttribute("aria-live", "polite");
    out.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  document.getElementById("est-run").addEventListener("click", run);

  form.addEventListener("input", function () { err.textContent = ""; });

  form.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); run(); }
  });
});
