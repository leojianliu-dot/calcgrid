# CalcGrid

A self-contained, **persistence-agnostic**, Excel-like grid for **React + TypeScript** —
first-party (no third-party spreadsheet engine), with select/edit modes, a formula
engine, copy/paste + fill, undo/redo, a formatting toolbar, and movable cell
annotations (notes + screenshots).

## ▶ Live demo
**https://leojianliu-dot.github.io/calcgrid/** — everything you type stays in your own
browser (localStorage); no login, no backend.

> On a phone: tap-to-select and double-tap-to-edit work; drag-select / drag-to-move /
> corner-resize currently need a mouse (touch support is a planned follow-up).

## The reusable component
The component lives in [`src/calcgrid/`](src/calcgrid/) — see its
[README](src/calcgrid/README.md). It has **no API dependency**; the host supplies data
and persistence:

```tsx
import { CalcGrid } from "./calcgrid";

<CalcGrid
  data={model}                      // initial CalcModel (uncontrolled afterward)
  onChange={(next) => save(next)}   // fired on every edit — you persist it
  images={{ upload, fetch, delete }} // host wires image storage
/>
```

The rest of this repo is a tiny demo app (`src/App.tsx`, `src/demoStore.ts`) that wires
those callbacks to `localStorage`. Swap that layer for any backend and the grid is
unchanged.

## Run locally
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
```

## Deploy
Pushing to `main` builds and publishes the demo to GitHub Pages via
`.github/workflows/deploy.yml` (Pages source = GitHub Actions).

## Stack
React 18 · TypeScript · Vite · DOMPurify (note sanitizing). License: TBD.
