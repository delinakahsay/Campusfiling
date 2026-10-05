/* Campus Filing: single source of truth for every dollar figure and
   every jurisdiction rule. Nothing elsewhere in the codebase should
   hardcode a number or a state rule.

   Sources:
     Tax year 2026 figures: IRS Rev. Proc. 2025-32 (IR-2025-103)
     Tax year 2025 figures: IRS Rev. Proc. 2024-40 as amended by OBBBA
     Mileage 2026: IRS Notice 2026-10 as amended by Announcement 2026-11
     Free File: IRS 2026 filing season release
     Direct File: IRS notice to partner states, November 3, 2025
*/

const TAX_YEARS = {

  2026: {
    year: 2026,
    filedIn: 2027,
    deadline: "April 15, 2027",
    seasonOpens: "late January 2027",

    singleStandardDeduction: 16100,
    dependentFloor: 1350,
    dependentEarnedBump: 450,
    unearnedFilingTrigger: 1350,
    qualifyingRelativeIncomeTest: 5350,

    selfEmploymentTrigger: 400,
    selfEmploymentRate: 0.153,
    selfEmploymentBase: 0.9235,
    selfEmploymentDeductionShare: 0.5,

    qualifyingChildAge: 19,
    studentAgeLimit: 24,

    aotcMax: 2500,
    aotcRefundable: 1000,
    aotcLifetimeYears: 4,
    llcMax: 2000,

    studentLoanInterestCap: 2500,
    studentLoanPhaseoutStart: 85000,
    studentLoanPhaseoutEnd: 100000,

    capitalLossLimit: 3000,

    /* 2026 has two business mileage rates. Announcement 2026-11 raised
       the rate midyear, so a full year log has to be split. */
    mileageFirstHalf: 0.725,
    mileageSecondHalf: 0.76,

    /* The most recently published Free File AGI limit is the one for
       2025 returns filed in 2026. The limit for 2026 returns is not
       published until late 2026, so copy must say "most recent". */
    freeFileIncomeLimit: 89000,
    freeFileLimitAppliesToYear: 2025,

    /* Direct File was discontinued. Do not recommend it. */
    directFileAvailable: false,

    brackets: [
      { upTo: 12400, rate: 0.10 },
      { upTo: 50400, rate: 0.12 },
      { upTo: 105700, rate: 0.22 },
      { upTo: 201775, rate: 0.24 },
      { upTo: 256225, rate: 0.32 },
      { upTo: 640600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ]
  },

  2025: {
    year: 2025,
    filedIn: 2026,
    deadline: "April 15, 2026",
    seasonOpens: "late January 2026",

    singleStandardDeduction: 15750,
    dependentFloor: 1350,
    dependentEarnedBump: 450,
    unearnedFilingTrigger: 1350,
    qualifyingRelativeIncomeTest: 5200,

    selfEmploymentTrigger: 400,
    selfEmploymentRate: 0.153,
    selfEmploymentBase: 0.9235,
    selfEmploymentDeductionShare: 0.5,

    qualifyingChildAge: 19,
    studentAgeLimit: 24,

    aotcMax: 2500,
    aotcRefundable: 1000,
    aotcLifetimeYears: 4,
    llcMax: 2000,

    studentLoanInterestCap: 2500,
    studentLoanPhaseoutStart: 85000,
    studentLoanPhaseoutEnd: 100000,

    capitalLossLimit: 3000,

    mileageFirstHalf: 0.70,
    mileageSecondHalf: 0.70,

    freeFileIncomeLimit: 84000,
    freeFileLimitAppliesToYear: 2024,

    directFileAvailable: false,

    brackets: [
      { upTo: 11925, rate: 0.10 },
      { upTo: 48475, rate: 0.12 },
      { upTo: 103350, rate: 0.22 },
      { upTo: 197300, rate: 0.24 },
      { upTo: 250525, rate: 0.32 },
      { upTo: 626350, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 }
    ]
  }

};

const TAX = TAX_YEARS[2026];

/* States with no tax on wage income. */
const NO_INCOME_TAX = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];

/* Jurisdictions that do not tax nonresident wage income at all.
   DC is the important one for this project. A Virginia or Maryland
   student working in DC does not file a DC nonresident income tax
   return. If DC tax was withheld in error they file Form D-40B. */
const NONRESIDENT_WAGE_EXEMPT = {
  DC: {
    refundForm: "D-40B",
    note: "The District does not tax the wages of nonresidents, so there is no DC nonresident income tax return to file. If DC tax was withheld from your pay by mistake, file <span class='formref'>Form D-40B</span> to claim it back, and report the wages on your home state resident return."
  }
};

/* Reciprocity agreements, keyed by the state where the work happened.
   If you live in state A and work in state B and B lists A, then B does
   not tax those wages and you file only in A. */
const RECIPROCITY = {
  MD: ["PA", "VA", "WV", "DC"],
  VA: ["MD", "DC", "PA", "WV", "KY"],
  PA: ["IN", "MD", "NJ", "OH", "VA", "WV"],
  NJ: ["PA"],
  OH: ["IN", "KY", "MI", "PA", "WV"],
  IN: ["KY", "MI", "OH", "PA", "WI"],
  KY: ["IL", "IN", "MI", "OH", "VA", "WV", "WI"],
  MI: ["IL", "IN", "KY", "MN", "OH", "WI"],
  WI: ["IL", "IN", "KY", "MI"],
  IL: ["IA", "KY", "MI", "WI"],
  IA: ["IL"],
  MN: ["MI", "ND"],
  ND: ["MN", "MT"],
  MT: ["ND"],
  WV: ["KY", "MD", "OH", "PA", "VA"],
  AZ: ["CA", "IN", "OR", "VA"]
};

const STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"];

/* ---------- shared helpers ---------- */

function money(n) {
  const v = Math.round(n);
  return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US");
}

function dependentStandardDeduction(earnedIncome, t) {
  t = t || TAX;
  return Math.min(
    Math.max(t.dependentFloor, earnedIncome + t.dependentEarnedBump),
    t.singleStandardDeduction
  );
}

function federalIncomeTax(taxableIncome, t) {
  t = t || TAX;
  let tax = 0;
  let remaining = Math.max(0, taxableIncome);
  let floor = 0;
  for (const b of t.brackets) {
    if (remaining <= 0) break;
    const band = Math.min(remaining, b.upTo - floor);
    tax += band * b.rate;
    remaining -= band;
    floor = b.upTo;
  }
  return tax;
}

function selfEmploymentTax(netProfit, t) {
  t = t || TAX;
  if (netProfit < t.selfEmploymentTrigger) return 0;
  return netProfit * t.selfEmploymentBase * t.selfEmploymentRate;
}

/* Half of self employment tax is an adjustment to income, not a credit. */
function halfSelfEmploymentDeduction(netProfit, t) {
  t = t || TAX;
  return selfEmploymentTax(netProfit, t) * t.selfEmploymentDeductionShare;
}

/* Student loan interest is an above the line deduction, not a credit,
   and is unavailable to anyone who can be claimed as a dependent. */
function studentLoanDeduction(interestPaid, magi, isDependent, t) {
  t = t || TAX;
  if (isDependent) return 0;
  const base = Math.min(interestPaid || 0, t.studentLoanInterestCap);
  if (base === 0) return 0;
  if (magi <= t.studentLoanPhaseoutStart) return base;
  if (magi >= t.studentLoanPhaseoutEnd) return 0;
  const phased = (magi - t.studentLoanPhaseoutStart) /
    (t.studentLoanPhaseoutEnd - t.studentLoanPhaseoutStart);
  return base * (1 - phased);
}

/* Fill any element carrying data-tax with the matching constant so page
   copy cannot drift from this file. Text inside the tag is a fallback
   for anyone with scripting disabled, so keep it accurate. */
document.addEventListener("DOMContentLoaded", function () {
  document.querySelectorAll("[data-tax]").forEach(function (el) {
    const key = el.dataset.tax;
    const passthrough = ["year", "filedIn", "deadline", "seasonOpens", "freeFileLimitAppliesToYear"];
    if (passthrough.indexOf(key) > -1) { el.textContent = TAX[key]; return; }
    if (key === "mileageFirstHalf" || key === "mileageSecondHalf") {
      el.textContent = Math.round(TAX[key] * 100) + " cents";
      return;
    }
    const v = TAX[key];
    if (typeof v === "number") el.textContent = money(v);
  });
});
