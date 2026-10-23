# Mytikas Joist Span Finder

A free, public web page for GCs, contractors and engineers: describe the floor
and the span, and it lists the Mytikas Steel 2" flange (S200) floor joists that
make it, lightest first.

## Where the numbers come from

- **Spans:** ClarkDietrich *Cold-Formed Structural Framing Products Technical
  Design Guide* (CD-STR-TechGuide, eff. 06/01/24), floor joist tables pp. 63–88,
  as extracted by Eric Bonick in
  `ClarkDietrich_Floor_Joist_Span_Limits_Mytikas_Profiles_v2.xlsx` (10/23/2026).
  9 load cases × 2 live-load deflection limits × 2 span conditions × 3 spacings
  × 15 profiles = 1,620 values.
- **Weights (lb/ft):** the same guide, pp. 13–17.
- **Live-load presets:** typical minimums from IBC Table 1607.1.
- **Dead-load presets:** typical values, to be confirmed by our engineers.

Loads that fall between published tables use the next heavier table (both dead
and live load at least as large), so the answer is always on the safe side. A
test proves that every heavier table allows equal or shorter spans.

## Files

| Path | What it is |
| --- | --- |
| `data/source/` | Text exports of Eric's workbook (the source record) |
| `data/floor-joist-spans.csv` | All 1,620 values, one per row, for anyone to check |
| `data/check/all-data-rows.tsv` | Rows from the workbook's own "All Data" tab, used by the tests |
| `src/data.js` | The span tables the page uses (generated; don't edit) |
| `src/logic.js` | Picks the table, ranks the joists, formats spans |
| `src/app.js`, `src/body.html`, `src/styles.css` | The page |
| `scripts/extract-workbook.mjs` | Rebuilds the data from the workbook exports |
| `src/quote.js` | Checks quote requests and writes the note for sales |
| `functions/api/quote.js` | Sends quote requests to Go High Level (runs on Cloudflare) |
| `scripts/build.mjs` | Builds `dist/index.html`, one self-contained file |

No packages to install. Node 20 or later.

```sh
npm test        # checks every value against the workbook
npm run build   # writes dist/index.html
```

## Updating the numbers

1. Export the new workbook to text (sheets 1–11, and sheet 12 "All Data") and
   replace the two files in `data/source/`.
2. `npm run extract`, then `npm test`. The tests must pass before publishing.
3. `npm run build`.

## Quote requests → Go High Level

The "Request a quote" form posts to `/api/quote`, a Cloudflare Pages Function.
It re-checks the selection, creates or updates the contact in Go High Level
(source "Joist span finder", tags `joist span finder` and `role: …`) and adds a
note with the joist, span, loads, job, rough quantity and a link that reopens
their exact selection. A GHL workflow triggered by the `joist span finder` tag
can notify sales or open an opportunity.

It needs two secrets in Cloudflare Pages → mytikas-spans → Settings →
Variables and secrets (Production):

- `GHL_API_TOKEN`: a Go High Level private integration token with
  contacts write access (Settings → Private Integrations)
- `GHL_LOCATION_ID`: the Mytikas sub-account's location ID

Until both are set the form tells visitors to email or call instead.

## Hosting

Cloudflare Pages, connected to this repository's `main` branch:
build command `npm run build`, output directory `dist`.
`dist/index.html` also works on GitHub Pages or inside a page on
mytikasindustries.com.
