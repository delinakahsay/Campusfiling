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
    js/tax-constants.js Every dollar figure, both tax years
    js/nav.js           Mobile menu
    js/estimator.js     Estimator logic
    js/wizard.js        Walkthrough logic
```

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
- Dependency logic per IRC section 152 and Publication 501
- Filing thresholds and the dependent standard deduction formula
- Federal bracket math and self-employment tax
- Multi state filing order logic
- Form validation and navigation throughout

Simulated:
- Document extraction. `EXTRACTORS` at the top of `wizard.js` matches on
  filename and returns plausible values. To demo it, create empty test files
  named `w2.pdf`, `1098t.pdf`, `1099nec.pdf`, `1098e.pdf`, and `1095a.pdf`
  and drop them into section 4. Fields fill and turn green. In production
  this is an OCR service.

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
2. **State logic is generic.** Resident versus nonresident and filing order
   are correct, but reciprocity agreements are not encoded. That matters
   most for DC, Maryland, and Virginia.
3. **The refund estimate ignores credits.** They appear in the plan text but
   do not net into the number in the summary rail.
4. **No plan permalink.** The plan lives in page memory and disappears on
   refresh. Phase two solves this with accounts.

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
