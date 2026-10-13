# Fixes applied after code review

Four suites now. Run all of them from the project root:

```
node tests.js           20 checks, tax math
node tests-extract.js   11 checks, document reading
node tests-ui.js        10 checks, walkthrough interactions against a stub DOM
node tests-browser.js   39 checks, a real browser (npm install playwright)
```

None of this constitutes a complete tax-accuracy audit.

## October: light is the default, dark is a choice

The theme originally followed `prefers-color-scheme`, so the site opened
dark on any machine set to dark. That is the usual convention and it is
wrong for this project. The walkthrough gets demonstrated on classroom
projectors and on borrowed laptops, where a dark render washes out, and
whoever is presenting does not find out until the screen is already up.

The system preference is no longer consulted anywhere. Every visitor gets
light. The control in the footer is the only route into dark, and the
choice it writes to `campusfiling-theme` is still the single value this
site keeps in browser storage.

Three browser checks hold this in place: that a machine reporting a dark
system preference still renders light, that no `data-theme` is forced onto
the page before anyone picks one, and that the footer control still
reaches dark from that same machine.

## October: the W-2 misread, found by reproducing it on the live site

The reported symptom was that W-2 income pulled from a document was
heavily incorrect. The cause: the reader flattened each PDF page into a
single string and took the first number following a caption. A W-2 prints
captions on one row and amounts on the row beneath:

```
1 Wages, tips, other compensation   2 Federal income tax withheld
45,000.00                           3,200.00
```

Flattened, the text after "Wages, tips, other compensation" begins
"2 Federal income tax withheld", so the reader returned **2** as the wage
figure. Reproduced against the deployed site: $2 instead of $45,000, with
Box 2 and Box 17 missed entirely.

`extract.js` now keeps each text item's coordinates, rebuilds lines from
them, and looks for a value in the caption's own column on the rows
beneath before considering anything to its right. A bare integer under 100
is never money, and a number followed by a known caption is rejected as a
box number.

**The testing lesson, which is the more useful finding.** The first fix
shipped with passing unit tests while the live site was still wrong,
because those tests used a hand written stand-in for pdf.js output rather
than pdf.js. `tests-browser.js` runs the real library in a real browser,
and it caught it. Any component whose input comes from a third party
library should be tested against that library.

## October: third party requests removed

pdf.js came from cdnjs and the webfonts from Google. Both are now served
from the site itself. A CDN request breaks uploads on networks that block
CDNs, and a font request hands a visitor's IP address and current page to
a third party, which is a strange thing for a tax tool to do while
promising nothing leaves the tab.

The Content Security Policy is now `default-src 'self'` with every
directive self-only, and `tests-browser.js` fails if any page requests
anything offsite. The claim on the privacy page is tested, not asserted.

## October: a caching mistake, recorded because it was mine

A first pass at `vercel.json` set `max-age=3600` on `/assets/`. Filenames
here carry no content hash, so that leaves a returning visitor running a
mix of old and new JavaScript after a deploy. It cost half an hour of
testing against stale code before the symptom was understood. Removed.

## Found outside the review, and more serious than anything in it

**IRS Direct File no longer exists.** The IRS notified its 25 partner states
on November 3, 2025 that Direct File would not be available in Filing Season
2026, with no future launch date set. The site recommended it in five places.
All removed. The plan now carries an explicit note, because a great deal of
advice written in 2024 and 2025 still recommends it and students will hit
that advice.

Remaining free routes: IRS Free File partners, Free File Fillable Forms,
MilTax, and VITA clinics.

## Correctness fixes

| # | Was | Now |
|---|-----|-----|
| 1 | Only the qualifying child test ran, so a 25-year-old supported by parents was marked independent | Qualifying relative test added, gated on the `qualifyingRelativeIncomeTest` constant |
| 1b | "I'm not sure" about support silently produced a definitive dependent answer | Returns `undetermined`, which surfaces its own plan card and labels the assumption |
| 2 | Independent branch recommended the AOTC regardless of prior years claimed | Eligibility and refundability are separate checks; four prior years routes to the LLC |
| 3 | Taxable scholarship was `scholarship - tuition` | `scholarship - (tuition + required books and supplies)` |
| 3b | Told users to write SCH beside the wages line | Schedule 1, line 8r, correct since tax year 2022 |
| 4 | Student loan interest subtracted from tax as `deduction * 0.12` | Above-the-line deduction against AGI, with dependent ineligibility and the phaseout |
| 5 | Deduction for half of self-employment tax omitted in both calculators | Implemented in `halfSelfEmploymentDeduction`, applied in both |
| 5b | Estimator claimed the walkthrough "handles" everything it skipped | Both now list their exclusions explicitly |
| 5c | Investment losses became zero | Signed input, capped at the annual `capitalLossLimit` |
| 6 | Recommended a "DC nonresident return" for a Virginia resident working in DC | DC added to `NONRESIDENT_WAGE_EXEMPT`; routes to Form D-40B refund claim |
| 6b | No reciprocity handling | `RECIPROCITY` table covering 16 work states |
| 6c | Three returns still rendered the string "Two returns" | Count computed from the returns array |
| 7 | Married users got single-filer brackets | Returns `unsupported` and stops, rather than producing a confidently wrong number |
| 7b | "I am not sure" about residency proceeded silently | Produces a substantial presence test card |
| 8 | Plan went stale when an answer changed after generation | `buildPlan()` runs on every entry to section nine, from any route |
| 9 | `renderFiles()` concatenated filenames into `innerHTML` | Built with `createElement` and `textContent` |
| 9b | Removing a document left its values behind | Each record tracks what it applied and reverses it |
| 9c | A second W-2 was ignored | W-2 loaders accumulate |
| 10 | Brackets stopped at 32% | Full seven brackets through 37% |
| 10b | Mileage rate was the 2025 value of 70 cents | 2026 is split: 72.5 cents through June 30, 76 cents from July 1 (Announcement 2026-11) |
| 10c | Free File limit of $84,000 | $89,000, labelled as applying to 2025 returns, with copy saying the current-year limit is not yet published |
| 10d | Filing threshold used `>` | `>=`, matching Publication 501's "at least" phrasing |

## Clarity and accessibility

- Upload messaging says "loaded sample values" everywhere, never "read"
- Negative amounts are rejected with a message instead of silently zeroed
- Errors carry `role="alert"` and take focus; the running summary is a live region
- Section changes move keyboard focus to the new heading
- "Federal tax withheld" is described as a prepayment, not "the money you get back"
- The walkthrough header now says refreshing clears your answers
- `privacy.html` no longer claims saving requires an account

## Technical fundamentals

- `assets/favicon.svg` and `assets/og.png` added, wired into all 12 pages
- Open Graph and Twitter card tags on every page
- `theme-color` meta tag
- Copyright line in every footer
- `tests.js` added

## Not changed, and why

**No loading states.** Every calculation here is synchronous and completes in
under a millisecond. Adding a skeleton or a spinner would mean inserting an
artificial delay to display it. Fake latency to look polished is itself the
thing the design critique is warning about.

**No hover animation, no purple, no emoji, no gradients, no testimonials.**
These were never in the build. Public Sans and Newsreader were chosen over
Inter and Poppins for the same reason.

**Still no line-by-line entries** beyond genuinely stable references like
Schedule 1 line 8r. See `README.md`.

## Still open

1. State logic covers residency, reciprocity, and nonresident wage exemption,
   but not part-year allocation or local taxes such as NYC and Philadelphia.
2. Qualified dividends and long-term capital gains are taxed as ordinary
   income, which overstates tax for anyone with investment gains. Disclosed
   in the plan.
3. The kiddie tax on large unearned income is not modelled.
4. Education credits are described but not netted into the refund estimate.
5. `about.html` lists data sources without linked datasets or findings. That
   is the analysis component and it is genuinely not done yet.
