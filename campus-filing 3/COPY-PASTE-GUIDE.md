# Campus Filing: where to paste the updates

## Easiest option: use the complete folder

1. Unzip `campus-filing-updated.zip`.
2. Open the included `campus-filing` folder in VS Code.
3. Right-click `index.html` and select **Open with Live Server**, or open it directly in your browser.

This folder includes all 12 pages and the existing scripts, so it works as a complete project. No package installation or build step is required. Keep a backup of your current folder if you have made further edits since uploading it.

## To update your existing project instead

Paths below are relative to your existing `campus-filing` folder. For each text file, open the replacement from the ZIP, copy its entire contents, open the corresponding file in your project, select all, paste, and save. Replace the contents, rather than appending the replacement underneath the old code.

| Replacement in the ZIP | Where it goes | What changed |
| --- | --- | --- |
| `index.html` | Main project folder | New homepage, folder preview, linked student situations, shorter copy, green closing panel |
| `assets/css/home.css` | `assets/css/` | New file containing homepage styles |
| `assets/css/layout.css` | `assets/css/` | Cream header, quieter footer, shared navigation styles |
| `assets/css/wizard.css` | `assets/css/` | Compact mobile progress and expandable sidebar styling |
| `app/file.html` | `app/` | Summary disclosure markup, progress label, shorter introduction |
| `assets/js/wizard.js` | `assets/js/` | Mobile sidebar behavior, progress updates, disabled future steps, reduced-motion scrolling |
| `assets/images/filing-folder.png` | `assets/images/` | New folder illustration. Copy the image file itself, not its contents |
| Remaining HTML pages | Their matching folders | Updated navigation button label and footer text color |
| `tests-ui.js` | Main project folder | Five regression checks using actual wizard functions and a minimal DOM harness |
| `README.md` and `CHANGELOG.md` | Main project folder | Installation notes and corrected explanation of test coverage |

The remaining HTML pages are `about.html`, `deadlines.html`, `estimate.html`, `faq.html`, `how-it-works.html`, `privacy.html`, and the four HTML files inside `guides/`. Copying all the HTML files ensures that navigation labels and footer colors stay consistent.

Create `assets/images/` if it does not exist. The new homepage already links to `assets/css/home.css` and `assets/images/filing-folder.png`. Keep these names exactly, without upload suffixes such as `(1)` or `(2)`.

## What this update does

- Retains the existing static HTML, CSS, and vanilla JavaScript structure.
- Adds a large folder illustration with selectable HTML preview text. The preview becomes a readable block below the image on small screens.
- Replaces repeated homepage card grids with linked rows.
- Uses a single primary action: **Build my filing plan**.
- Keeps the full sidebar on desktop and collapses it into **View summary and sections** on mobile.
- Applies a subtle image lift only to hover-capable devices without a reduced-motion preference.
- Preserves the supplied tax calculation code. This is a presentation and navigation update, not a new tax-accuracy audit.

## Checks completed

Run these optional checks from the project folder if Node.js is installed:

```sh
node tests.js
node tests-ui.js
```

Results during preparation: 20 existing calculation/example checks passed and 5 interaction checks passed. Local file references, in-page anchors, duplicate IDs, and JavaScript syntax were also checked across all 12 pages.

The interaction suite uses a minimal DOM harness. It does not replace a browser layout test, a screen-reader audit, or a tax-accuracy review. Open the homepage and walkthrough on desktop and mobile before publishing.

No hosting or publishing is required to use these files locally.
