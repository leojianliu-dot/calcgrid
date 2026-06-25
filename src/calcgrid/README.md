# CalcGrid

A self-contained, **persistence-agnostic** Excel-like grid for React + TypeScript.
First-party (no third-party spreadsheet engine), built for the Barlow & Hughan
internal tools and structured so it can be reused across Function-App frontends —
or extracted to its own repo / open-sourced — by copying this one folder.

## What it does
Select/edit modes (like Excel & Sheets), a formula engine with `$` anchors + F4
cycling, mouse/keyboard point mode, a formula bar, a formatting toolbar (font/
fill/align/number formats/currency/borders), single-line gridlines + custom
borders (drawn as de-duplicated box-shadow insets), copy/paste + fill with
reference translation, a marching-ants copy marquee, column resize, **undo/redo**,
and **cell annotations** (a note and/or screenshot anchored to a single empty
cell, shown as a button with a draggable/resizable persistent panel).

## The contract
```tsx
import { CalcGrid } from "./calcgrid";
import type { CalcModel } from "./calcgrid";

<CalcGrid
  data={model}                 // initial CalcModel (the grid is uncontrolled afterward)
  onChange={(next) => save(next)}   // fired on every edit — the HOST persists (debounce/API/etc.)
  images={{
    upload: (file) => Promise<number>,                                  // -> image id
    fetch:  (id)   => Promise<{ contentType: string; dataBase64: string }>,
    delete: (id)   => void,                                             // optional, best-effort
  }}
  fillValue={(n) => pushToField(n)}  // optional: shows the → button on the active cell
  onDeleteSheet={() => deleteSheet()} // optional: shows the 🗑 button
  tabs={<MyTabs/>}                    // optional: nodes rendered under the toolbar
  saveState="saved"                   // optional: "idle"|"saving"|"saved"|"error" pill
/>
```
The grid imports its own CSS (`calcgrid.css`). It expects four theme CSS variables
on the host (with firm defaults): `--line`, `--accent`, `--ink`, `--muted`.

## What's inside (all dependency-free of any app/API)
| File | Role |
|---|---|
| `CalcGrid.tsx` | The grid component (interaction, rendering, formatting, clipboard, undo, annotations). |
| `CalcAnnoPanel.tsx` | The draggable/resizable annotation panel (note + screenshot). |
| `calc.ts` | Formula engine (`makeResolver`, `evalFormula`, `translateFormula`, `balanceParens`, col⇄letter). |
| `format.ts` | `fmtAccounting` (thousands, red negatives in parens) + `isNegativeNum`. |
| `useFormulaPointMode.ts` | Excel point-mode hook (mouse + keyboard ref insertion, F4 `$` cycling). |
| `types.ts` | `CalcModel`, `CalcCellStyle`, `CalcCellData`, `CalcAnnotation`, `CalcImages`, `SaveState`. |
| `calcgrid.css` | All styles, imported by `CalcGrid`. |
| `index.ts` | Barrel export. |

The only external runtime dependency is **DOMPurify** (notes are sanitized).

## Using it in another app (the "loader" pattern)
Write a thin loader that owns persistence and wires the host's storage. The
Workpaper loader is [`../CalcSheet.tsx`](../CalcSheet.tsx): it loads a JSON
snapshot, debounces the save (and drives `saveState`), maps `images.*` to the
`wp.CalcImages` endpoints, and handles sheet deletion. Swap that file for your
own backend and the grid is unchanged.

## Known follow-ups
- **Per-cell memoization** (M7 from the review): cells re-render on every model
  change; fine for normal sheets, worth a memoized `<Cell>` for very large grids.
- **Theme self-containment**: for a standalone/open-source build, replace the
  `var(--…)` references with fallbacks or a small default theme.
