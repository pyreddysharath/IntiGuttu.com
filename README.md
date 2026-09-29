# Inti Guttu (ఇంటి గుట్టు) - JSON-controlled build


This is the JSON-driven version of the app: all content lives in external
JSON files instead of being embedded in the HTML. `app.js` fetches them at
runtime and renders the page.

## Folder layout

```
index.html              Page shell (masthead, tabs, search, footer, forms)
app.js                  All app logic: fetches the JSON below and renders it
css/base.css            Shared layout/typography/component styles
assets/icons.json       Shared category-icon SVG fragments
assets/diagrams.json    Shared illustration SVGs (used by a few first-aid items)
favicon/                Favicon + apple-touch-icon files (all sizes)
google-apps-script/
  feedback_apps_script.gs   Paste into a Google Sheet's Apps Script editor
                             to receive Contribute + Feedback submissions
                             (see the comment block at the top of the file).

sections/
  remedies/
    manifest.json        Tab label/icon + list of category files
    remedies.css         Styles specific to this tab (e.g. Emergency badge)
    images/              Put remedy images here, referenced from an item's
                          "images" array
    cooking-fixes.json
    kitchen-storage.json
    kitchen-hacks.json
    first-aid.json
    home-remedies.json

  diy/
    manifest.json
    diy.css               Brown palette + the "Precautions first" callout box
    images/
    electrical.json
    plumbing.json
    home-appliances.json
    cleaning-maintenance.json
    home-repair-furniture.json
    tech-gadgets.json
    vehicle-basics.json

  recipes/
    manifest.json          Lists India (with its states as subcategories)
                            plus every world country
    recipes.css             Olive palette + veg/non-veg and dish-type filters
    images/
    india/<state>.json      One file per Indian state/region
    world/<country>.json    One file per country
```

## JSON shape

Each category file looks like:

```json
{
  "label": "Cooking Fixes",
  "icon": "cook",
  "items": [
    { "heading": "Dish turned out too sweet", "details": ["step one", "step two"] }
  ]
}
```

DIY items additionally support a `"precautionsFirst"` array (rendered as the
"Precautions first" warning box) and an `"images"` array of
`{ "src": "images/foo.jpg", "alt": "..." }` objects. Recipe items
additionally support `"veg": true/false` and `"type"` (Curry, Fry, Rice,
Sweet, Tiffin/Snack, Other) for the filter chips.

To add or edit content, edit the relevant JSON file directly - no rebuild
step is needed, since the page reads these files at runtime.

## Running it

Because `app.js` uses `fetch()` to load the JSON files, most browsers will
block those requests if you open `index.html` directly as a `file://` URL
(a browser security restriction on local file access, not a bug in the
app). Serve the folder over HTTP instead:

```
cd inti-guttu-app
python3 -m http.server 8000
```

then open `http://localhost:8000/` in your browser. Any static web host
(GitHub Pages, Netlify, Vercel, a plain Apache/Nginx folder, etc.) works
the same way once uploaded.

## Contribute / Feedback forms

Both forms are wired to post to the same Google Apps Script Web App and
Google Sheet. Until you deploy `google-apps-script/feedback_apps_script.gs`
and paste the resulting Web App URL into the `APPS_SCRIPT_ENDPOINT`
constant near the top of `app.js`, both forms will still show the "Thanks!"
confirmation locally, but nothing is recorded anywhere - deploy the script
to actually collect submissions.
