# Campus Filing

A guided tax walkthrough for college students and recent graduates.
ISTM capstone, GW School of Business.

Twelve static pages, no build step, no framework, no dependencies.

## Running it in VS Code

1. Open the `campus-filing` folder in VS Code (File, Open Folder).
2. Install the **Live Server** extension by Ritwick Dey if you do not have it.
3. Right click `index.html` and choose **Open with Live Server**.

You can also double click `index.html` to open it in a browser directly.
Live Server is better because the drag and drop upload in the walkthrough
behaves more predictably over http than over the file protocol.

## Structure

```
campus-filing/
  index.html            Front page
  how-it-works.html     The three steps, the nine sections, what it does not do
  faq.html              Seven topic groups, deep linkable anchors
  estimate.html         Four question refund estimator
  deadlines.html        Season timeline
  privacy.html          What is collected and what is not
  about.html            Problem statement, methodology, data sources
  guides/
    index.html          Guide hub
    documents.html      Every form a student might receive
    international.html  F-1 and J-1 filers
    glossary.html       25 terms, one line each
  app/
    file.html           The nine section walkthrough
  assets/
    css/base.css        Tokens, reset, typography
    css/layout.css      Header, footer, page shells, grids
    css/components.css  Buttons, cards, notes, tables, accordions
    css/wizard.css      Walkthrough only
    css/home.css        Front page only
    js/tax-constants.js Every dollar figure, both tax years
    js/theme.js         Light and dark, loaded in the head
    js/nav.js           Mobile menu
    js/glossary.js      Glossary filter
    js/estimator.js     Estimator logic
    js/extract.js       Reading figures out of PDFs
    js/wizard.js        Walkthrough logic
    fonts/              Public Sans and Newsreader, latin subsets
    vendor/pdfjs/       pdf.js 3.11.174, Apache 2.0
  vercel.json           Security headers and the content security policy
  tests.js              Tax calculation
  tests-extract.js      Document reading, no browser needed
  tests-ui.js           Walkthrough interactions against a stub DOM
  tests-browser.js      Real browser, real pdf.js, contrast, offsite requests
```

## Tests

```
node tests.js           20 checks, tax math
node tests-extract.js   11 checks, document reading
node tests-ui.js        10 checks, walkthrough interactions
node tests-browser.js   36 checks, needs: npm install playwright
```

`tests-browser.js` is the one that matters most, and it exists because the
other three did not catch a live bug. The document reader was unit tested
against a hand written stand-in for pdf.js output, which passed while the
deployed site returned $2 of wages from a real W-2. It now runs the actual
library in a real browser. It skips cleanly if Playwright is not installed.

Header and footer markup is repeated in each page rather than injected with
JavaScript. That is intentional. `fetch()` fails on the file protocol, so an
injected header would break the moment someone double clicks a file instead
of running a server.

## Tax year

The site targets **tax year 2026**, filed by **April 15, 2027**. Figures come
from IRS Revenue Procedure 2025-32.

Calculation constants live in `assets/js/tax-constants.js`. Page examples,
fallback text, and some explanations also contain figures that need review. To roll the site to a new year:

1. Add a new year object to `TAX_YEARS`.
2. Change the `TAX` assignment below it.

Page copy stays in sync automatically. Any element with a `data-tax`
attribute is filled from the constants at load, for example:

```html
<span data-tax="singleStandardDeduction">$16,100</span>
```

The text inside the tag is a fallback for anyone with JavaScript disabled,
so keep it accurate when you update the constants.

## What is real and what is simulated

Real:
- Dependency logic per IRC section 152 and Publication 501, both the
  qualifying child and the qualifying relative tests
- Filing thresholds and the dependent standard deduction formula
- Federal bracket math and self-employment tax
- Multi state filing order, reciprocity agreements for sixteen work states,
  and the states that do not tax nonresident wages at all
- **Document reading.** Genuine extraction from the PDF text layer. No
  filename matching and nothing canned.
- Form validation and navigation throughout

Simulated:
- Nothing. The practice figures button is clearly labelled as invented
  numbers, and every message about it says so.

Not possible here:
- Scans and photographs. There is no OCR. Those files are accepted and
  listed, and the walkthrough tells the person to type the figures.

### How document reading works

`assets/js/extract.js` loads pdf.js, pulls each page's text layer, and
keeps every text item with its coordinates. Lines are reconstructed from
those coordinates, and a value is looked for in the caption's own column
on the rows beneath it before anything to the caption's right.

That ordering is the whole point. A W-2 prints captions on one row and
amounts on the row beneath:

```
1 Wages, tips, other compensation   2 Federal income tax withheld
45,000.00                           3,200.00
```

An earlier version flattened the page into one string and took the first
number after a caption, which on that layout is the `2` belonging to the
next caption. A tested sample returned $2 of wages instead of $45,000.
`tests-extract.js` and `tests-browser.js` both pin that case.

Two further rules keep box numbers out of the answers: a bare integer
under 100 is never treated as money, and a number followed by a known
caption is rejected.

Nothing extracted is ever written into an answer. Every figure goes to a
review table with a confidence label, against the file it came from, and
the person applies it or does not. Removing a file reverses whatever it
contributed.

### No third party, enforced

The site loads nothing from anywhere else. pdf.js is vendored under
`assets/vendor/pdfjs` and the webfonts under `assets/fonts`, because a CDN
request tells a third party who opened a tax tool and when, and because
campus networks block CDNs often enough to break uploads for the students
least able to diagnose it.

`vercel.json` sets `default-src 'self'` with every directive self-only,
plus `form-action 'none'`, `frame-ancestors 'none'` and no inline script.
`tests-browser.js` records every request each page makes and fails if one
leaves the domain, so the privacy page's claim is tested rather than
asserted.

Deliberately absent:
- No field anywhere collects a Social Security number, bank account number,
  date of birth, or address. This is a design decision, not an oversight.
  Keep it that way, and if a reviewer asks, point at `privacy.html`.

## Phase two: accounts and saved returns

Not built yet, deliberately. The plan:

**Hosting.** Neon and Supabase both offer a free Postgres tier that
provisions in about ten minutes and is more than enough for a capstone.
Railway and Render are equivalent with tighter free limits. For a purely
local demo, SQLite in a file needs no host at all.

**The rule that matters.** Do not put real student tax data in a class
project database. Build the schema, build the auth, seed it with generated
sample profiles, and say so on the privacy page. A panel will respect a
deliberate boundary more than a working login holding real income figures.

**Draft schema**

```
users            id, email, password_hash, created_at
profiles         user_id, home_state, school_state, grad_year, filing_status
tax_years        id, user_id, year, dependency_status, standard_deduction,
                 total_income, filed_on, software_used
documents        id, tax_year_id, form_type, storage_key, uploaded_at
answers          id, tax_year_id, question_key, value
```

`answers` as a key value table rather than fifty columns is what makes year
over year comparison and mid-season resumption straightforward.

**Pages to add:** `app/login.html`, `app/dashboard.html`, `app/year.html`.

## Known gaps to discuss

1. **Line level guidance.** The plan names forms and boxes in plain language
   rather than saying "enter this on line 11a." Line numbers move between
   years, state forms renumber constantly, and instructing someone what to
   type on a specific line moves toward unlicensed tax preparation. If the
   team wants it, scope it to one state and one year and label it on screen.
2. **The refund estimate ignores credits.** Education credits appear in the
   plan text and in the action list but do not net into the number in the
   summary rail. The card above the estimate says so explicitly.
3. **Investment income is taxed as ordinary income.** Qualified dividends
   and long term capital gains have their own rate schedule, which is not
   modelled, so the estimate overstates tax for anyone with gains.
4. **The kiddie tax is not modelled.** A dependent with large unearned
   income is taxed at a parent's rate on the excess via Form 8615. The
   walkthrough does not ask for parent income, so it cannot compute this.
5. **Part year state allocation and local taxes.** Moving mid year is
   flagged but not apportioned, and city taxes such as New York City and
   Philadelphia are not covered.
6. **No plan permalink.** The plan lives in page memory. Answers can be
   saved to a file and resumed from it; a shareable link needs accounts.

## Data sources for the analysis component

- IRS Statistics of Income, individual returns and ZIP code data
- IRS Free File and Direct File program statistics
- IPEDS enrollment by institution
- National Society of Accountants fee survey
- FTC filings in the matter of Intuit


## September design update

See COPY-PASTE-GUIDE.md for the changed files and installation steps.
The homepage uses assets/css/home.css and assets/images/filing-folder.png.
The folder illustration is AI-generated. Preview labels are accessible HTML.
