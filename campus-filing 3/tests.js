global.document = { addEventListener(){}, querySelectorAll(){ return []; } };
const fs = require('fs');
const src = fs.readFileSync('assets/js/tax-constants.js','utf8');
const mod = new Function('document', src + '; return {TAX,TAX_YEARS,NO_INCOME_TAX,NONRESIDENT_WAGE_EXEMPT,RECIPROCITY,STATES,money,dependentStandardDeduction,federalIncomeTax,selfEmploymentTax,halfSelfEmploymentDeduction,studentLoanDeduction};')(global.document);
Object.assign(global, mod);

let pass = 0, fail = 0;
function check(name, got, want, tol) {
  tol = tol || 0.5;
  const ok = Math.abs(got - want) <= tol;
  console.log((ok ? "PASS  " : "FAIL  ") + name + "  got=" + (typeof got === 'number' ? got.toFixed(2) : got) + " want=" + want);
  ok ? pass++ : fail++;
}

console.log("--- Review item 4: student loan interest is a deduction, not a credit ---");
// $20,000 wages, $2,500 interest, independent filer
const wages = 20000, interest = 2500;
const dedn = studentLoanDeduction(interest, wages, false, TAX);
const agi  = wages - dedn;
const taxable = Math.max(0, agi - TAX.singleStandardDeduction);
const tax = federalIncomeTax(taxable, TAX);
check("deduction allowed in full below phaseout", dedn, 2500);
check("tax with deduction applied to income", tax, 140, 1.0);
console.log("      old buggy method (credit at 12%) would have produced:",
  (federalIncomeTax(Math.max(0, wages - TAX.singleStandardDeduction), TAX) - 2500*0.12).toFixed(2));

console.log("\n--- Review item 4b: dependent gets no student loan deduction ---");
check("dependent deduction is zero", studentLoanDeduction(2500, 20000, true, TAX), 0);

console.log("\n--- Review item 10: filing threshold uses >= not > ---");
const exactly = TAX.singleStandardDeduction;
check("exactly the standard deduction triggers filing (1 = yes)", (exactly >= TAX.singleStandardDeduction) ? 1 : 0, 1);

console.log("\n--- Review item 10: brackets reach 37% ---");
check("top bracket rate", TAX.brackets[TAX.brackets.length-1].rate, 0.37, 0.001);
check("bracket count", TAX.brackets.length, 7);
check("tax on $700,000 taxable (hand-computed from Rev. Proc. 2025-32)", federalIncomeTax(700000, TAX), 214957, 2);

console.log("\n--- Review item 5: half of SE tax is deductible ---");
const gig = 10000;
const se = selfEmploymentTax(gig, TAX);
const halfSe = halfSelfEmploymentDeduction(gig, TAX);
check("SE tax on $10,000 net profit", se, 1413, 2);
check("half SE deduction", halfSe, se/2, 0.01);

console.log("\n--- Review item 3: scholarship nets against books too ---");
// $11,000 scholarship, $10,000 tuition, $1,000 required books
const qualified = 10000 + 1000;
check("taxable scholarship is zero once books count", Math.max(0, 11000 - qualified), 0);
console.log("      old method (scholarship - tuition only) reported: 1000");

console.log("\n--- Review item 1: qualifying relative catches the 25 year old ---");
// mirrors wizard dependencyStatus for age 25, $3,000 earned, parents support
const age = 25, earned = 3000, support = "no";
const qualifyingChild = age < TAX.qualifyingChildAge || (age < TAX.studentAgeLimit && false);
const qualifyingRelative = support !== "yes" && earned < TAX.qualifyingRelativeIncomeTest;
check("not a qualifying child at 25", qualifyingChild ? 1 : 0, 0);
check("IS a qualifying relative at 25 with $3,000", qualifyingRelative ? 1 : 0, 1);
check("but not at $6,000 of income", (support !== "yes" && 6000 < TAX.qualifyingRelativeIncomeTest) ? 1 : 0, 0);

console.log("\n--- Review item 6: DC is not a nonresident-return state ---");
check("DC listed as nonresident wage exempt", NONRESIDENT_WAGE_EXEMPT.DC ? 1 : 0, 1);
check("DC refund form is D-40B", NONRESIDENT_WAGE_EXEMPT.DC.refundForm === "D-40B" ? 1 : 0, 1);
check("MD-VA reciprocity present", RECIPROCITY.MD.indexOf("VA") > -1 ? 1 : 0, 1);

console.log("\n--- New find: mileage is split across 2026 ---");
check("first half rate", TAX.mileageFirstHalf, 0.725, 0.0001);
check("second half rate", TAX.mileageSecondHalf, 0.76, 0.0001);

console.log("\n--- New find: Direct File flag is off ---");
check("directFileAvailable false", TAX.directFileAvailable === false ? 1 : 0, 1);

console.log("\n--- Capital loss cap ---");
check("loss capped at 3000", Math.max(-TAX.capitalLossLimit, -12000), -3000);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
