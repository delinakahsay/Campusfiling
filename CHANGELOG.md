# Fixes applied after code review

Four suites now. Run all of them from the project root:

```
node tests.js           20 checks, tax math
node tests-extract.js   19 checks, document reading
node tests-assisted.js  21 checks, reconciling the two readers
node tests-ui.js        13 checks, walkthrough interactions against a stub DOM
node tests-flow.js       8 checks, upload to applied, API stubbed
node tests-browser.js   43 checks, a real browser (npm install playwright)
```

None of this constitutes a complete tax-accuracy audit.

## October: the empty next page, and why it was the same bug as the one above

Reported as two problems. They were one.

A student pressed the AI reader, pressed Apply, went to the next section
and found every box empty. Nothing errored, and every suite passed,
because every piece did exactly what it had been told to do. The two
readers had differed on a figure, a difference arrived unticked by
design, and "Apply the ticked amounts" correctly applied the nothing that
was ticked.

The design was wrong in two ways at once.

It put an implementation detail in front of someone trying to file their
taxes. "The two readers disagree" is a sentence about this codebase, not
about their W-2. It invites doubt in a figure that is usually right and
offers no way to resolve it beyond what the review table already offered.

And on the document that prompted it, the local reader had read 5000 off
the page and the model had read 500. The model was right. There was no
toss-up to present: one reader is better at this, and where they differ
it should simply win.

So a difference now resolves to the assisted figure, every row arrives
ticked, and the review table says nothing about which component read
what. The column that used to explain the machinery now shows the text
the figure was read from, which is what someone checking against paper
actually needs. What the local reader had said is kept on the row as
`supersededLocal` for diagnosis and is never rendered.

The guardrail did not move. Every figure is still shown against its
source document and is still editable before it counts. That was always
the check that mattered; the disagreement banner was never doing the work
it appeared to be doing.

`tests-flow.js` exists because of this. It drives upload, assist, apply,
and then asserts on the input values in the sections ahead, with the API
stubbed. The unit suites all passed while this was broken, because the
bug lived in the space between them.

## October: a second reader, and a rule for believing it

The local reader cannot handle every document, and after the classifier
fixes the remaining failures were all layout: a W-2 whose text layer runs
right to left, a scan whose character recognition produced "1 Wege&, tips,
othff comp.", a photo from a phone with no text in it at all. Those were
being handed back as "type this one in".

A model reads those well. It is now available on each document, behind a
button, as a second opinion rather than a replacement.

### What is sent, and when

Nothing is sent automatically. Every document sits in the list with its
local result until someone presses its own button, and the button names
what it would transmit. The file is never uploaded. What goes is either
the text pdf.js already extracted, or a page image rendered locally when
there is no text to extract.

The request goes to `/api/read-document` on this domain, which holds the
key and calls Anthropic server side. That is not decoration: the content
security policy allows the browser to connect only to this domain, and a
key in client code is a key anyone can spend. The policy did not have to
be loosened.

Anthropic does not train on API inputs or outputs and does not retain the
content. Campus Filing stores none of it either, so when the tab closes
there is no copy anywhere. `privacy.html` was rewritten in the same commit
rather than after it, because it previously said nothing was transmitted
and that stopped being true.

### Both readers run, and disagreements are shown rather than resolved

The two fail in opposite ways, and that is the whole design:

| | How it fails |
|---|---|
| Local reader | Loudly. No caption match, no figure, nothing proposed. |
| Model | Quietly. A plausible figure in the right box with nothing marking it wrong. |

Trusting the model alone would mean trusting a reader whose mistakes are
invisible, on a document that becomes a tax return. So `reconcile()` in
`assets/js/assisted.js` compares them:

- **Both agree.** Strongest signal available. Pre-ticked, marked agreed.
- **Local found nothing.** The model's figure stands, labelled as coming
  from the model alone. This is the case the feature exists for.
- **The model declined.** The local figure stands.
- **They disagree.** Both figures are shown, neither is applied, and the
  student is asked to settle it against the paper.

That last row is the point. Two independent readers disagreeing about your
wages is the single most useful thing this tool can say, and resolving it
silently in either direction would throw that away. A low confidence
figure with nothing corroborating it also stays unticked.

Everything still passes through the same review table. Neither reader can
write a number into an answer.

## October: the reader was classifying documents by their fine print

Seven real documents were uploaded to the live site. Three were identified
as the wrong form and one produced a figure that existed nowhere on it.

The classifier searched the whole document for a form name and took the
first hit. Every real tax document carries the IRS "Instructions for
Recipient" boilerplate, and that boilerplate names other forms:

| Document | Says, in its instructions | Came back as |
|---|---|---|
| 1099-NEC | "You received this form instead of Form **W-2**" | W-2 |
| Consolidated 1099 | "the option that was reported to you on a Form **W-2**" | W-2 |
| 1095-B | "reported on Form **1095-A** rather than a Form 1095-B" | 1095-A |

W-2 was first in the list, so it won every tie. The name the reader found
was never the document's own; it was the document explaining a different
one. A 1099-NEC misclassifying as a W-2 is not an edge case, because that
sentence is on every 1099-NEC the IRS prints.

Evidence is now weighted rather than raced:

- **OMB control number**, strongest. It sits in the form's own header and
  not in prose about other forms. 1545-0116 is a 1099-NEC and nothing else.
- **Title phrase**, strong. "Wage and Tax Statement" in the header.
- **Bare name in running text**, weak, and discarded outright when the
  words before it point elsewhere ("instead of", "rather than", "reported
  on", "see").

All seven documents now classify correctly.

### Consolidated brokerage 1099s are refused on purpose

E\*TRADE and Robinhood packages are one PDF holding a 1099-INT, a
1099-DIV, a 1099-B, a 1099-MISC and sometimes a 1099-OID. The old model
was one file, one form, so it picked a section and dropped the rest. Worse,
it read the table of contents: the line "1099-INT Interest Income......2"
yielded an interest figure that appears nowhere on the form.

Several form types at full strength in one document now identify it as a
consolidated package. Nothing is auto filled, and the note says to import
it from the broker instead. Nobody should retype one of these, and the
per-sale detail has to reach Schedule D intact, so refusing is the correct
answer rather than a shortfall.

### Identifiers are no longer read as money

GW's W-2 emits its text layer right to left, which put the line
`OMB No. 1545-0029 ***-**-7795 Import Code: 3UEPJ96J` directly beneath the
wages caption. The reader returned **1545** as wages.

OMB numbers, EINs, masked SSNs, phone numbers and ZIP+4 are blanked before
any amount is looked for. The replacement is the same length as what it
covers, so every position stays valid.

### A recognised scan is refused rather than guessed at

One W-2 was a scan run through character recognition, with the recognised
text embedded as the text layer. It parses without error, but the words
are wrong:

```
1 Wege&, tips, othff comp.    2 Feder el income tax withheld
S Medicert weges end tips     6 Medicare tax withheld
```

The digits carry the same noise, and stray marks arrive as numbers. The
reader returned 111 for federal tax withheld on a form whose boxes read
354.65 and blank.

Box captions are fixed text set by the IRS, so they work as a ruler. A
clean W-2 matches 11 of 11; that scan matched 4. Below 70 per cent the
layer is treated as untrustworthy and no figure from it is offered.

### Two 1099s no longer overwrite each other

Wages accumulated across employers; everything else replaced, on the
reasoning that two 1098-Ts in one year means one is wrong. Real students
break that immediately. Two banks means two 1099-INTs. Two servicers means
two 1098-Es. A transfer student has a 1098-T from each school.

Replacing meant the second document silently erased the first, with
nothing on screen to say anything had been dropped. Every figure now adds,
which is safe because the same file cannot be added twice and removing a
file subtracts exactly what it contributed. Where a figure is about to
join one already in a box, the review row says so and shows the total.

Low confidence figures also arrive unticked now. Applying one has to be a
deliberate act, because the reader is saying it may be wrong.

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
