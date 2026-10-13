# QA round: what changed

`node tests.js` 20 passed. `node tests-ui.js` 8 passed.

## Fixed

| Your note | What was wrong | Now |
|---|---|---|
| "Files stay on your device. Nothing uploads anywhere." | Technically true and completely misleading. It implied the tool read the file. It never did. | Upload removed entirely. Section 4 is a tick-box checklist of what you have. Practice figures load from a labelled button that says the numbers are invented. |
| W-2 income "heavily incorrect" | The figures were canned demo values dressed up as extraction. Not incorrect, invented. | Same fix. Nothing can now masquerade as a reading of your document. |
| 1099s and gig income not filled | Filename never matched the regex. | Gone with the feature. |
| Stock income/loss not recognized | There was no 1099-B loader at all. | Gone with the feature. The gain/loss field accepts negatives and caps the offset at the annual limit. |
| 1098-T not recognized | Same. | Same. |
| "under $24" | The renderer formatted every number as currency, so ages and year counts became dollars. | Keys are typed: text, count, rate, money. Three pages fixed. |
| 1040 vs 1040-NR row is confusing | Led with an abstraction. | Leads with who it affects, then explains why being here legally is not the same as being a resident for tax. |
| Include stipends | Not collected anywhere. | New field, plus scholarship-rule treatment: taxable only above tuition, fees, books and supplies, reported Schedule 1 line 8r, counted as earned income for the dependent standard deduction. Live note flags the services-versus-fellowship distinction. |
| School money row: some of this has no tax implication | The row implied everything listed produced a deduction. | Rewritten to say only two things matter, and that rent, meal plans, travel and self-paid tuition are not among them. |
| Glossary says "look something up" with no search | Broken promise. | Real filter across terms and definitions, with a live result count. |
| "How do we define liability" | Undefined anywhere. | Glossary entry walking income to deduction to brackets to credits to withholding, and stating that zero liability is normal for students and not a reason to skip filing. |
| "Now through December" | Undated. | "Through December 31, 2026", plus why that window matters. |
| Does IRS Free File still exist | It does. Direct File is the one that ended. | Verified. Extended by agreement through October 2029, eight partners, $89,000 AGI limit for 2025 returns. Stated on FAQ and deadlines. |
| International mistakes in the amend answer | Generic 1040-X advice, no mention of the 1040-versus-1040-NR case. | Added as the urgent case, with the visa and green card consequence. |
| Asylee or refugee | No option. | Added, plus "another visa, or my status changed during the year" which routes to the substantial presence test. |
| No filing guidance, just a recommendation | The real gap. | **Step-by-step worksheet.** Button on the plan. |

## The worksheet

Ordered steps generated from the answers, keyed to the chosen product.
FreeTaxUSA, TurboTax and Fillable Forms each get their own screen names;
anything else gets generic equivalents. Steps carry the actual figures.

Nonresidents get a refusal rather than a worksheet, because walking an
F-1 student through Form 1040 screens is walking them into the wrong return.

It names screens and schedules, not numbered 1040 lines. The 2026 Form 1040
is not published until December. The single exception is Schedule 1 line 8r,
stable since the 2022 redesign, and named because students never find it
otherwise. An on-screen caution says screen names shift slightly between years.

## Still open

1. Qualified dividends and long-term gains taxed as ordinary income.
2. Kiddie tax on large unearned income not modelled.
3. Education credits described but not netted into the refund figure.
4. Part-year state allocation and local taxes such as NYC and Philadelphia.
5. `about.html` still lists data sources with no findings attached.
