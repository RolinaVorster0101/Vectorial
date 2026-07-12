# Vectorial

A browser-based vector graphics editor. Draw and edit shapes, paths, and text
directly in the canvas, with full node-level bezier editing, layers, and a
properties panel — no install required, just open the HTML file.

## Features

- **Tools**: select/move/resize, node editing (drag anchors & bezier handles,
  insert/delete nodes), pen tool, rectangle, ellipse, line, text
- **Layers panel**: reorder, rename, show/hide, lock
- **Properties panel**: fill, stroke, stroke width, opacity, font
- **Import**: SVG (including CSS classes, `<use>`/`<symbol>`, gradient fills,
  nested group transforms) and EPS (best-effort PostScript path extraction,
  converted to editable SVG shapes)
- **Export**: SVG
- Undo/redo, zoom/pan, keyboard shortcuts

## Project structure

```
index.html       — the built, self-contained app (open this in a browser)
src/shell.html   — HTML/CSS shell template
src/app.js       — application logic
build.py         — assembles src/ into index.html
```

## Building

The app is plain HTML/CSS/JS with no build dependencies. After editing files
in `src/`, regenerate `index.html` with:

```
python3 build.py
```

## Running

Just open `index.html` in a browser, or serve the folder with any static
file server (e.g. `python3 -m http.server`).

## Known limitations

- EPS import is a best-effort PostScript path interpreter, not a full
  PostScript implementation — fonts, embedded images, and patterns in the
  original file are not carried over.
- SVG import does not support clip paths, masks, patterns, filters, or
  embedded raster images. Gradient fills are approximated as a flat average
  color, since the editor's shape model doesn't support gradients natively.
- Export format is SVG only.
