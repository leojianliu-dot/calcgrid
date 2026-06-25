import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { balanceParens, colLetterToNum, makeResolver, numToColLetter, translateFormula } from "./calc";
import { fmtAccounting, isNegativeNum } from "./format";
import { useFormulaPointMode } from "./useFormulaPointMode";
import CalcAnnoPanel from "./CalcAnnoPanel";
import "./calcgrid.css";
import type { CalcAnnotation, CalcCellData, CalcCellStyle, CalcImages, CalcModel, SaveState } from "./types";

// Free-form figures show to 2 decimals (ratios/rates keep cents) with the firm
// convention: thousands separators + negatives red in (parentheses).
const CALC_DECIMALS = 0; // default: whole numbers (integer); raise per-cell with the decimal buttons

// Recognize a typed date (mm/dd/yy[yy] with / - . separators) and normalize to MM/DD/YYYY.
function normalizeDate(s: string): string | null {
  const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\s*$/.exec(s);
  if (!m) return null;
  const mo = +m[1], d = +m[2];
  let y = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return null;
  if (m[3].length === 2) y = y < 50 ? 2000 + y : 1900 + y; // 00–49 → 2000s, 50–99 → 1900s
  const daysInMonth = new Date(y, mo, 0).getDate(); // real calendar days (handles 2/31, leap years)
  if (d > daysInMonth) return null;
  return `${String(mo).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

type Cell = { row: number; col: number };
type Sel = { aRow: number; aCol: number; hRow: number; hCol: number };

// Cells referenced by a formula (for edit-mode highlighting). Expands ranges.
function refsInFormula(text: string): Set<string> {
  const out = new Set<string>();
  if (!text.trimStart().startsWith("=")) return out;
  const re = /([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const c1 = colLetterToNum(m[1]), r1 = parseInt(m[2], 10);
    if (m[3]) {
      const c2 = colLetterToNum(m[3]), r2 = parseInt(m[4], 10);
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) out.add(`${r}:${c}`);
    } else {
      out.add(`${r1}:${c1}`);
    }
  }
  return out;
}

// Percent format: value is a fraction (0.25 → "25%"); negatives in (parens) like the accounting format.
function fmtPercent(v: number, dp: number): string {
  if (!Number.isFinite(v)) return "";
  const body = (Math.abs(v) * 100).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) + "%";
  return v < 0 ? `(${body})` : body;
}

// Preset swatch palette for the font/fill color menus (no OS gradient picker).
const PALETTE = ["#111210", "#6b7280", "#ffffff", "#d97757", "#dc2626", "#ea580c", "#d97706", "#16a34a", "#0ea5e9", "#2563eb", "#7c3aed", "#db2777"];
function ColorPalette({ onPick, onClear }: { onPick: (c: string) => void; onClear: () => void }) {
  return (
    <div className="calc-palette" onMouseDown={(e) => e.preventDefault()}>
      {PALETTE.map((c) => (
        <button key={c} className="calc-swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />
      ))}
      <button className="calc-swatch calc-swatch-none" title="None" onClick={onClear}>✕</button>
    </div>
  );
}

// Excel-style border icons for the borders menu (a faint context grid with the
// applied edge[s] drawn dark).
type BorderKind = "all" | "outline" | "top" | "bottom" | "double" | "none";
function BorderIcon({ kind }: { kind: BorderKind }) {
  const L = "#c9c7c4", D = "#111210";
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {kind !== "none" && <rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke={L} strokeWidth="1" />}
      {kind === "all" && (
        <>
          <line x1="8" y1="2.5" x2="8" y2="13.5" stroke={D} strokeWidth="1" />
          <line x1="2.5" y1="8" x2="13.5" y2="8" stroke={D} strokeWidth="1" />
          <rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke={D} strokeWidth="1" />
        </>
      )}
      {kind === "outline" && <rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke={D} strokeWidth="1" />}
      {kind === "top" && <line x1="2" y1="3" x2="14" y2="3" stroke={D} strokeWidth="1.5" />}
      {kind === "bottom" && <line x1="2" y1="13" x2="14" y2="13" stroke={D} strokeWidth="1.5" />}
      {kind === "double" && (
        <>
          <line x1="2" y1="11.5" x2="14" y2="11.5" stroke={D} strokeWidth="1" />
          <line x1="2" y1="13.5" x2="14" y2="13.5" stroke={D} strokeWidth="1" />
        </>
      )}
      {kind === "none" && <rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke={L} strokeWidth="1" strokeDasharray="2 2" />}
    </svg>
  );
}

// Unified toolbar icons — inline SVG (one stroke weight, currentColor) so they
// render identically on every device (no missing-font glyph boxes) and look modern.
type TbIconName =
  | "undo" | "redo" | "alignLeft" | "alignCenter" | "alignRight" | "wrap"
  | "fill" | "note" | "clear" | "delRow" | "delCol" | "help" | "trash";
function TbIcon({ name }: { name: TbIconName }) {
  const S = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "undo": return <svg {...S}><path d="M8 7l-4 4 4 4" /><path d="M4 11h9a6 6 0 0 1 0 12H9" /></svg>;
    case "redo": return <svg {...S}><path d="M16 7l4 4-4 4" /><path d="M20 11h-9a6 6 0 0 0 0 12h4" /></svg>;
    case "alignLeft": return <svg {...S}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="11" x2="13" y2="11" /><line x1="4" y1="16" x2="20" y2="16" /><line x1="4" y1="21" x2="13" y2="21" /></svg>;
    case "alignCenter": return <svg {...S}><line x1="4" y1="6" x2="20" y2="6" /><line x1="7" y1="11" x2="17" y2="11" /><line x1="4" y1="16" x2="20" y2="16" /><line x1="7" y1="21" x2="17" y2="21" /></svg>;
    case "alignRight": return <svg {...S}><line x1="4" y1="6" x2="20" y2="6" /><line x1="11" y1="11" x2="20" y2="11" /><line x1="4" y1="16" x2="20" y2="16" /><line x1="11" y1="21" x2="20" y2="21" /></svg>;
    case "wrap": return <svg {...S}><line x1="4" y1="6" x2="20" y2="6" /><path d="M4 12h13a3 3 0 0 1 0 6h-5" /><path d="M14 15l-3 3 3 3" /><line x1="4" y1="18" x2="8" y2="18" /></svg>;
    case "fill": return <svg {...S}><path d="M7 10V7a3 3 0 0 1 6 0v3" /><path d="M5 10h10l-1.4 8.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8L5 10z" /></svg>;
    case "note": return <svg {...S}><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" /></svg>;
    case "clear": return <svg {...S}><path d="M8 18l-3.5-3.5a2 2 0 0 1 0-3l7-7a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3L13 18z" /><line x1="6" y1="21" x2="20" y2="21" /></svg>;
    case "delRow": return <svg {...S}><rect x="3.5" y="9" width="17" height="6" rx="1.5" /><line x1="15" y1="20" x2="21" y2="20" /></svg>;
    case "delCol": return <svg {...S}><rect x="9" y="3.5" width="6" height="17" rx="1.5" /><line x1="3" y1="20" x2="6.5" y2="20" /></svg>;
    case "help": return <svg {...S}><circle cx="12" cy="12" r="9" /><path d="M9.2 9.3a3 3 0 0 1 5.6 1.2c0 2-3 2.5-3 4" /><line x1="12" y1="17.5" x2="12" y2="17.5" /></svg>;
    case "trash": return <svg {...S}><line x1="4" y1="7" x2="20" y2="7" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /></svg>;
  }
}

// CalcGrid — a persistence-agnostic, Excel-like editable grid.
//
// It takes an initial `data` model and emits a new model via `onChange` on every
// edit; the HOST owns where/when that's persisted (debounce, API, etc.). Image
// I/O is injected via `images` (upload/fetch/delete) so the grid has no API or
// sheet-id dependency. Optional `fillValue` (the → button), `onDeleteSheet` (the
// 🗑 button), `tabs` (a sheet switcher), and `saveState` (a status pill) are all
// host concerns surfaced through props.
//
// Interaction: SELECT / EDIT modes like Excel & Sheets — click a column letter /
// row number to select a whole column / row (Shift extends), the corner selects
// all; a formatting toolbar applies style to the selection.
export default function CalcGrid({
  data,
  onChange,
  images,
  fillValue,
  onDeleteSheet,
  tabs,
  saveState = "idle",
}: {
  data: CalcModel;
  onChange: (model: CalcModel) => void;
  images: CalcImages;
  fillValue?: (value: number) => void; // present when the sheet is field-scoped (→ button)
  onDeleteSheet?: () => void;          // present when the host allows deleting the sheet (🗑)
  tabs?: React.ReactNode;              // sheet-switcher tabs, rendered under the toolbar
  saveState?: SaveState;               // host save status, shown as a small pill
}) {
  const [model, setModel] = useState<CalcModel | null>(data);
  const [active, setActive] = useState<Cell | null>({ row: 1, col: 1 });
  const [sel, setSel] = useState<Sel | null>({ aRow: 1, aCol: 1, hRow: 1, hCol: 1 });
  const [editing, setEditing] = useState<Cell | null>(null);
  const [draft, setDraft] = useState("");
  const [entryMode, setEntryMode] = useState<"enter" | "edit">("edit");
  const [colorMenu, setColorMenu] = useState<null | "font" | "fill" | "border">(null);
  const [copyRegion, setCopyRegion] = useState<{ r1: number; c1: number; r2: number; c2: number } | null>(null); // copied-area marquee
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null); // its measured pixel rect
  const [showHelp, setShowHelp] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [placing, setPlacing] = useState<Partial<CalcAnnotation> | null>(null); // "click an empty cell to drop this note" mode
  const [dropTarget, setDropTarget] = useState<string | null>(null); // "r:c" cell highlighted while dragging an anchor button
  const undoStack = useRef<CalcModel[]>([]); // past models (whole-snapshot undo)
  const redoStack = useRef<CalcModel[]>([]);
  const UNDO_MAX = 60;

  const cancelEdit = useRef(false);
  const dragging = useRef(false);
  const headerDrag = useRef<null | "col" | "row">(null); // click-drag select over the header frame
  const gridRef = useRef<HTMLDivElement | null>(null);
  const fxInputRef = useRef<HTMLInputElement | null>(null);
  const modelRef = useRef<CalcModel | null>(data); // sync source of truth for async/rapid writes
  const clipRef = useRef<{ grid: (CalcCellData | null)[][]; r0: number; c0: number } | null>(null); // internal copy buffer
  const lastTsv = useRef<string>(""); // text we put on the system clipboard (to detect internal vs external paste)

  const ck = (r: number, c: number) => `${r}:${c}`;
  const raw = (row: number, col: number) => model?.cells[ck(row, col)]?.v ?? "";

  const DEFAULT_W = 150, ROWHEAD_W = 34, ADDCOL_W = 26; // px (ADDCOL_W = the "+ column" gutter)
  const colW = (c: number) => model?.colWidths?.[c] ?? DEFAULT_W;

  // Apply a new model: update local state + the sync ref, push undo history (unless
  // {history:false} for live/intermediate updates like a mid-drag resize), and notify
  // the host to persist via onChange. The host owns debounce / API / save status.
  const saveModel = (next: CalcModel, opts?: { history?: boolean }) => {
    if ((opts?.history ?? true) && modelRef.current) {
      undoStack.current.push(modelRef.current);
      if (undoStack.current.length > UNDO_MAX) undoStack.current.shift();
      redoStack.current = [];
      setCanUndo(true); setCanRedo(false);
    }
    setModel(next);
    modelRef.current = next;
    onChange(next);
  };

  const undo = () => {
    if (editing || !undoStack.current.length || !modelRef.current) return;
    const prev = undoStack.current.pop()!;
    redoStack.current.push(modelRef.current);
    setModel(prev); modelRef.current = prev; onChange(prev);
    setCopyRegion(null);
    setCanUndo(undoStack.current.length > 0); setCanRedo(true);
  };
  const redo = () => {
    if (editing || !redoStack.current.length || !modelRef.current) return;
    const next = redoStack.current.pop()!;
    undoStack.current.push(modelRef.current);
    setModel(next); modelRef.current = next; onChange(next);
    setCanUndo(true); setCanRedo(redoStack.current.length > 0);
  };

  const writeCell = (row: number, col: number, v: string) => {
    const m = modelRef.current; // read the live model, not the render-closed-over one (avoids dropping rapid edits)
    if (!m) return;
    const key = ck(row, col);
    const cells = { ...m.cells };
    const prev = cells[key];
    if (v === "" && !(prev && prev.s)) delete cells[key];
    else cells[key] = prev?.s ? { v, s: prev.s } : { v };
    saveModel({ ...m, cells });
  };

  const resolver = useMemo(
    () => makeResolver((col, row) => model?.cells[`${row}:${col}`]?.v ?? ""),
    [model],
  );

  const display = (row: number, col: number): string => {
    const r = raw(row, col);
    if (r === "") return "";
    const s = model?.cells[ck(row, col)]?.s;
    const dp = s?.dp ?? (s?.fmt === "pct" ? 2 : CALC_DECIMALS);
    const fmtNum = (v: number) => {
      if (s?.fmt === "pct") return fmtPercent(v, dp);
      let out = fmtAccounting(v, dp);
      if (s?.cur) out = out.startsWith("(") ? "($" + out.slice(1) : "$" + out;
      return out;
    };
    if (r.startsWith("=")) {
      try { return fmtNum(resolver(col, row)); } catch { return "#ERR"; }
    }
    const n = Number(r.replace(/[$,]/g, ""));
    if (Number.isFinite(n) && /[0-9]/.test(r)) return fmtNum(n);
    return r; // non-numeric text passes through
  };

  const cellNegative = (row: number, col: number): boolean => {
    const r = raw(row, col);
    if (r === "") return false;
    try { return isNegativeNum(r.startsWith("=") ? resolver(col, row) : r, CALC_DECIMALS); } catch { return false; }
  };

  const computed = (row: number, col: number): number => {
    try { return resolver(col, row); } catch { return NaN; }
  };

  const pm = useFormulaPointMode({
    editing,
    draft,
    setDraft,
    cellRef: (row, col) => `${numToColLetter(col)}${row}`,
    isReferenceable: (row, col) => row >= 1 && col >= 1,
    rowCount: model?.numRows ?? 1,
    colCount: model?.numCols ?? 1,
  });

  const refSet = useMemo(() => (editing ? refsInFormula(draft) : new Set<string>()), [editing, draft]);

  useEffect(() => {
    if (editing && pm.editInputRef.current) {
      const el = pm.editInputRef.current;
      el.focus();
      const len = el.value.length;
      try { el.setSelectionRange(len, len); } catch { /* */ }
    }
  }, [editing, pm.editInputRef]);

  useEffect(() => {
    const up = () => { dragging.current = false; headerDrag.current = null; };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  // Close the color menu when clicking outside it.
  useEffect(() => {
    if (!colorMenu) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".calc-colorwrap")) setColorMenu(null); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [colorMenu]);

  // Measure the copied area's pixel rect so the marching-ants marquee can be drawn
  // as a single thin overlay (re-measured whenever the copy region or layout changes).
  useEffect(() => {
    const grid = gridRef.current;
    if (!copyRegion || !grid) { setMarquee(null); return; }
    const { r1, c1, r2, c2 } = copyRegion;
    const tl = grid.querySelector<HTMLElement>(`[data-cell="${r1}:${c1}"]`);
    const br = grid.querySelector<HTMLElement>(`[data-cell="${r2}:${c2}"]`);
    if (!tl || !br) { setMarquee(null); return; }
    const g = grid.getBoundingClientRect();
    const a = tl.getBoundingClientRect(), b = br.getBoundingClientRect();
    setMarquee({
      left: a.left - g.left + grid.scrollLeft,
      top: a.top - g.top + grid.scrollTop,
      width: b.right - a.left,
      height: b.bottom - a.top,
    });
  }, [copyRegion, model]);

  // Cancel placement mode with Escape (works regardless of focus).
  useEffect(() => {
    if (!placing) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPlacing(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  const inSel = (row: number, col: number) => {
    if (!sel) return false;
    return (
      row >= Math.min(sel.aRow, sel.hRow) && row <= Math.max(sel.aRow, sel.hRow) &&
      col >= Math.min(sel.aCol, sel.hCol) && col <= Math.max(sel.aCol, sel.hCol)
    );
  };

  const commitEdit = useCallback(async () => {
    const e = editing;
    if (!e || !model) return;
    setEditing(null);
    if (cancelEdit.current) { cancelEdit.current = false; return; }
    let text = draft.startsWith("=") ? balanceParens(draft) : draft;
    if (!draft.startsWith("=")) { const dt = normalizeDate(text); if (dt) text = dt; } // auto-format dates → MM/DD/YYYY
    if ((model.cells[ck(e.row, e.col)]?.v ?? "") === text) return;
    writeCell(e.row, e.col, text);
  }, [editing, draft, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (row: number, col: number, extend = false) => {
    setActive({ row, col });
    setSel((s) => (extend && s ? { ...s, hRow: row, hCol: col } : { aRow: row, aCol: col, hRow: row, hCol: col }));
  };

  // Whole-column / whole-row / select-all (from the header frame).
  const selectColumn = (col: number, extend = false) => {
    if (!model) return;
    setActive({ row: 1, col });
    setSel((s) => (extend && s ? { aRow: 1, aCol: s.aCol, hRow: model.numRows, hCol: col } : { aRow: 1, aCol: col, hRow: model.numRows, hCol: col }));
    focusGrid();
  };
  const selectRow = (row: number, extend = false) => {
    if (!model) return;
    setActive({ row, col: 1 });
    setSel((s) => (extend && s ? { aRow: s.aRow, aCol: 1, hRow: row, hCol: model.numCols } : { aRow: row, aCol: 1, hRow: row, hCol: model.numCols }));
    focusGrid();
  };
  const selectAll = () => {
    if (!model) return;
    setActive({ row: 1, col: 1 });
    setSel({ aRow: 1, aCol: 1, hRow: model.numRows, hCol: model.numCols });
    focusGrid();
  };

  const beginEdit = (row: number, col: number, initial?: string, mode: "enter" | "edit" = "edit") => {
    if (annoByCell.has(`${row}:${col}`)) { setActive({ row, col }); return; } // reserved by a note — don't type over it
    setCopyRegion(null);
    setActive({ row, col });
    setSel({ aRow: row, aCol: col, hRow: row, hCol: col });
    setDraft(initial ?? raw(row, col));
    setEntryMode(mode);
    setEditing({ row, col });
  };

  const focusGrid = () => gridRef.current?.focus();

  const move = (dr: number, dc: number, extend = false) => {
    if (!active || !model) return;
    const r = Math.max(1, Math.min(model.numRows, active.row + dr));
    const c = Math.max(1, Math.min(model.numCols, active.col + dc));
    select(r, c, extend);
  };

  // ---- Formatting (applies to the current selection) ----------------------
  const applyStyle = (patch: Partial<CalcCellStyle>) => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    const cells = { ...m.cells };
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const key = ck(r, c);
      const prev = cells[key];
      const merged = { ...(prev?.s || {}), ...patch } as Record<string, unknown>;
      const cleaned = Object.fromEntries(Object.entries(merged).filter(([, v]) => v != null && v !== false && v !== ""));
      const v = prev?.v ?? "";
      if (v === "" && Object.keys(cleaned).length === 0) delete cells[key];
      else cells[key] = Object.keys(cleaned).length ? { v, s: cleaned as CalcCellStyle } : { v };
    }
    saveModel({ ...m, cells });
  };

  const activeStyle = active ? model?.cells[ck(active.row, active.col)]?.s : undefined;
  const toggleBold = () => applyStyle({ bold: activeStyle?.bold ? undefined : true });
  const curDp = () => activeStyle?.dp ?? (activeStyle?.fmt === "pct" ? 2 : CALC_DECIMALS);
  const bumpDp = (d: number) => applyStyle({ dp: Math.max(0, Math.min(6, curDp() + d)) });
  const clearFormat = () =>
    applyStyle({ align: undefined, color: undefined, fill: undefined, bold: undefined, wrap: undefined, size: undefined, fmt: undefined, dp: undefined });
  const gridlinesOn = model ? model.showGridlines !== false : true;
  const toggleGridlines = () => { const m = modelRef.current; if (m) saveModel({ ...m, showGridlines: m.showGridlines === false }); };
  const toggleCurrency = () => applyStyle({ cur: activeStyle?.cur ? undefined : true });

  // Apply black cell borders to the selection (single/double underline, top line, box, none).
  const applyBorder = (kind: "all" | "outline" | "top" | "bottom" | "double" | "none") => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    const cells = { ...m.cells };
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const prev = cells[ck(r, c)];
      const s: CalcCellStyle = { ...(prev?.s || {}) };
      let bd: NonNullable<CalcCellStyle["bd"]> = { ...(s.bd || {}) };
      if (kind === "none") bd = {};
      else if (kind === "all") bd = { t: true, b: 1, l: true, r: true };
      else if (kind === "outline") { if (r === r1) bd.t = true; if (r === r2) bd.b = 1; if (c === c1) bd.l = true; if (c === c2) bd.r = true; }
      else if (kind === "top") bd.t = true;
      else if (kind === "bottom") bd.b = 1;
      else if (kind === "double") bd.b = 2;
      if (Object.keys(bd).length) s.bd = bd; else delete s.bd;
      const v = prev?.v ?? "";
      if (v === "" && Object.keys(s).length === 0) delete cells[ck(r, c)];
      else cells[ck(r, c)] = Object.keys(s).length ? { v, s } : { v };
    }
    saveModel({ ...m, cells });
  };

  // Drag a column header's right edge to resize. If the dragged column is part
  // of a multi-column selection, all selected columns resize together.
  const onColResizeStart = (e: React.PointerEvent, col: number) => {
    e.preventDefault();
    e.stopPropagation(); // don't also select the column
    if (!model) return;
    let cols = [col];
    if (sel) {
      const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
      if (col >= c1 && col <= c2 && c2 > c1) { cols = []; for (let c = c1; c <= c2; c++) cols.push(c); }
    }
    const before = modelRef.current; // pre-resize snapshot → a single undo step
    const startW: Record<number, number> = {};
    for (const c of cols) startW[c] = colW(c);
    const startX = e.clientX;
    const move = (ev: MouseEvent) => {
      if (!modelRef.current) return;
      const delta = ev.clientX - startX;
      const colWidths = { ...(modelRef.current.colWidths || {}) };
      for (const c of cols) colWidths[c] = Math.max(40, Math.round(startW[c] + delta));
      const next = { ...modelRef.current, colWidths };
      setModel(next); modelRef.current = next; // live; persisted on mouseup
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      if (modelRef.current && before && modelRef.current !== before) {
        undoStack.current.push(before); // one undo for the whole drag
        if (undoStack.current.length > UNDO_MAX) undoStack.current.shift();
        redoStack.current = []; setCanUndo(true); setCanRedo(false);
        saveModel(modelRef.current, { history: false });
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const clearSelection = () => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    const cells = { ...m.cells };
    let changed = false;
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
      const key = ck(r, c);
      if (cells[key]) {
        if (cells[key].s) cells[key] = { v: "", s: cells[key].s }; else delete cells[key];
        changed = true;
      }
    }
    if (changed) saveModel({ ...m, cells });
  };

  // Fill the top row / left column of the selection across the rest of it,
  // translating relative references ($-anchored parts stay put) like Excel.
  const fillDown = () => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    if (r2 <= r1) return;
    const cells = { ...m.cells };
    for (let c = c1; c <= c2; c++) {
      const src = cells[ck(r1, c)];
      for (let r = r1 + 1; r <= r2; r++) {
        if (!src) { delete cells[ck(r, c)]; continue; }
        const v = src.v.startsWith("=") ? translateFormula(src.v, r - r1, 0) : src.v;
        cells[ck(r, c)] = src.s ? { v, s: { ...src.s } } : { v };
      }
    }
    saveModel({ ...m, cells });
  };
  const fillRight = () => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    if (c2 <= c1) return;
    const cells = { ...m.cells };
    for (let r = r1; r <= r2; r++) {
      const src = cells[ck(r, c1)];
      for (let c = c1 + 1; c <= c2; c++) {
        if (!src) { delete cells[ck(r, c)]; continue; }
        const v = src.v.startsWith("=") ? translateFormula(src.v, 0, c - c1) : src.v;
        cells[ck(r, c)] = src.s ? { v, s: { ...src.s } } : { v };
      }
    }
    saveModel({ ...m, cells });
  };

  // ---- Clipboard (events fire on the focused grid container in select mode) ----
  const tsvOfSelection = (): string => {
    if (!sel || !model) return "";
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    const out: string[] = [];
    for (let r = r1; r <= r2; r++) {
      const row: string[] = [];
      for (let c = c1; c <= c2; c++) {
        const cell = model.cells[ck(r, c)];
        let val = "";
        if (cell) {
          if (cell.v.startsWith("=")) { const n = computed(r, c); val = Number.isFinite(n) ? String(n) : ""; }
          else val = cell.v;
        }
        row.push(val);
      }
      out.push(row.join("\t"));
    }
    return out.join("\n");
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (!sel || !model || editing) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    const grid: (CalcCellData | null)[][] = [];
    for (let r = r1; r <= r2; r++) {
      const gRow: (CalcCellData | null)[] = [];
      for (let c = c1; c <= c2; c++) { const cell = model.cells[ck(r, c)]; gRow.push(cell ? { ...cell } : null); }
      grid.push(gRow);
    }
    clipRef.current = { grid, r0: r1, c0: c1 };
    setCopyRegion({ r1, c1, r2, c2 }); // show the marching-ants marquee
    const tsv = tsvOfSelection();
    lastTsv.current = tsv;
    e.clipboardData.setData("text/plain", tsv);
    e.preventDefault();
  };
  const onCut = (e: React.ClipboardEvent) => { onCopy(e); if (!editing) clearSelection(); };

  // Paste a 2D grid into the sheet. When the current selection is larger than
  // the source and a whole multiple of it, fill/tile across the selection (a
  // single copied cell fills the whole selection — Excel behavior). `origin`
  // (the source's top-left, internal copies only) enables formula translation.
  const pasteGrid = (grid: (CalcCellData | null)[][], origin: { r0: number; c0: number } | null) => {
    const m = modelRef.current;
    if (!active || !m || !grid.length) return;
    const clipRows = grid.length, clipCols = Math.max(...grid.map((r) => r.length));
    if (!clipCols) return;
    let R1 = active.row, C1 = active.col, R2 = R1 + clipRows - 1, C2 = C1 + clipCols - 1;
    if (sel) {
      const sr1 = Math.min(sel.aRow, sel.hRow), sr2 = Math.max(sel.aRow, sel.hRow);
      const sc1 = Math.min(sel.aCol, sel.hCol), sc2 = Math.max(sel.aCol, sel.hCol);
      const selRows = sr2 - sr1 + 1, selCols = sc2 - sc1 + 1;
      if ((selRows > clipRows || selCols > clipCols) && selRows % clipRows === 0 && selCols % clipCols === 0) {
        R1 = sr1; C1 = sc1; R2 = sr2; C2 = sc2; // fill / tile the selection
      }
    }
    // Cap runaway growth from a huge external paste (and tell the user we trimmed).
    const MAX_ROWS = 2000, MAX_COLS = 200;
    if (R2 > MAX_ROWS || C2 > MAX_COLS) { alert(`Paste is too large — limited to ${MAX_ROWS} rows × ${MAX_COLS} columns.`); R2 = Math.min(R2, MAX_ROWS); C2 = Math.min(C2, MAX_COLS); }
    let numRows = m.numRows, numCols = m.numCols;
    const cells = { ...m.cells };
    for (let tr = R1; tr <= R2; tr++) for (let tc = C1; tc <= C2; tc++) {
      if (tr < 1 || tc < 1) continue;
      if (tr > numRows) numRows = tr;
      if (tc > numCols) numCols = tc;
      const sr = (tr - R1) % clipRows, sc = (tc - C1) % clipCols;
      const src = grid[sr]?.[sc] ?? null;
      if (!src) { delete cells[ck(tr, tc)]; continue; }
      let v = src.v;
      if (origin && v.startsWith("=")) v = translateFormula(v, tr - (origin.r0 + sr), tc - (origin.c0 + sc));
      cells[ck(tr, tc)] = src.s ? { v, s: { ...src.s } } : { v };
    }
    saveModel({ ...m, numRows, numCols, cells });
  };
  // ---- Cell annotations (a note and/or a screenshot anchored to one empty cell) ----
  const annoByCell = useMemo(() => {
    const m = new Map<string, { a: CalcAnnotation; num: number }>();
    (model?.annotations || []).forEach((a, i) => m.set(`${a.r}:${a.c}`, { a, num: i + 1 }));
    return m;
  }, [model]);

  const newId = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `a${Date.now()}-${Math.round(Math.random() * 1e6)}`);

  // A cell can host an annotation only if it's empty and not already annotated.
  const cellFree = (r: number, c: number, exceptId?: string) => {
    if (raw(r, c) !== "") return false;
    const e = annoByCell.get(`${r}:${c}`);
    return !e || e.a.id === exceptId;
  };

  const addAnnotationAt = (r: number, c: number, init: Partial<CalcAnnotation>) => {
    const cur = modelRef.current; if (!cur) return;
    const anno: CalcAnnotation = { id: newId(), r, c, open: true, ...init };
    saveModel({ ...cur, annotations: [...(cur.annotations || []), anno] }, { history: true });
  };

  // Add an annotation: drop it on the active cell if that cell is free, otherwise
  // enter placement mode so we never silently cover existing content.
  const requestAnnotation = (init: Partial<CalcAnnotation>) => {
    if (active && cellFree(active.row, active.col)) addAnnotationAt(active.row, active.col, init);
    else { setPlacing(init); focusGrid(); }
  };

  const patchAnno = (id: string, patch: Partial<CalcAnnotation>, history = false) => {
    const cur = modelRef.current; if (!cur) return;
    saveModel({ ...cur, annotations: (cur.annotations || []).map((a) => (a.id === id ? { ...a, ...patch } : a)) }, { history });
  };
  const removeAnno = (a: CalcAnnotation) => {
    const cur = modelRef.current; if (!cur) return;
    saveModel({ ...cur, annotations: (cur.annotations || []).filter((g) => g.id !== a.id) }, { history: true });
    if (a.imageId) images.delete?.(a.imageId); // free the bytes (host best-effort)
  };
  const toggleAnno = (a: CalcAnnotation) => patchAnno(a.id, { open: !a.open });

  // Upload a screenshot file (via the injected host uploader), then place an annotation.
  const addScreenshotFromFile = async (file: File) => {
    try {
      const imageId = await images.upload(file);
      requestAnnotation({ imageId });
    } catch {
      alert("Sorry — that screenshot could not be uploaded. Please try again.");
    }
  };

  // Drag an anchor button to re-anchor it to another empty cell (a click = toggle panel).
  const startAnnoDrag = (e: React.PointerEvent, a: CalcAnnotation) => {
    e.preventDefault(); e.stopPropagation();
    const mx = e.clientX, my = e.clientY;
    let moved = false, target: string | null = null;
    const move = (ev: PointerEvent) => {
      if (!moved && (Math.abs(ev.clientX - mx) > 4 || Math.abs(ev.clientY - my) > 4)) moved = true;
      if (!moved) return;
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest("[data-cell]");
      const key = el ? el.getAttribute("data-cell") : null;
      const ok = key ? (() => { const [r, c] = key.split(":").map(Number); return cellFree(r, c, a.id); })() : false;
      target = ok ? key : null;
      setDropTarget(target);
    };
    const end = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end);
      setDropTarget(null);
      if (!moved) { toggleAnno(a); return; }
      if (target) { const [r, c] = target.split(":").map(Number); patchAnno(a.id, { r, c }, true); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (!active || !model || editing) return;
    const file = Array.from(e.clipboardData.files || []).find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); void addScreenshotFromFile(file); return; } // pasted screenshot → annotation
    const text = e.clipboardData.getData("text/plain");
    e.preventDefault();
    if (clipRef.current && text === lastTsv.current) {
      pasteGrid(clipRef.current.grid, { r0: clipRef.current.r0, c0: clipRef.current.c0 }); // internal: formulas + styles
    } else {
      const rows = text.replace(/\r/g, "").split("\n");
      if (rows.length && rows[rows.length - 1] === "") rows.pop();
      const grid: (CalcCellData | null)[][] = rows.map((line) => line.split("\t").map((val) => (val === "" ? null : { v: val })));
      pasteGrid(grid, null); // external (e.g. from Excel): values/text
    }
  };

  // SELECT-mode keys (the grid container has focus; no cell is being edited).
  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !active) return;
    const k = e.key;
    if (k === "ArrowUp") { e.preventDefault(); move(-1, 0, e.shiftKey); }
    else if (k === "ArrowDown") { e.preventDefault(); move(1, 0, e.shiftKey); }
    else if (k === "ArrowLeft") { e.preventDefault(); move(0, -1, e.shiftKey); }
    else if (k === "ArrowRight") { e.preventDefault(); move(0, 1, e.shiftKey); }
    else if (k === "Tab") { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
    else if (k === "Enter" || k === "F2") { e.preventDefault(); beginEdit(active.row, active.col); }
    else if (k === "Delete" || k === "Backspace") { e.preventDefault(); clearSelection(); }
    else if (k === "Escape") { setCopyRegion(null); }
    else if ((e.ctrlKey || e.metaKey) && (k === "d" || k === "D")) { e.preventDefault(); fillDown(); }
    else if ((e.ctrlKey || e.metaKey) && (k === "r" || k === "R")) { e.preventDefault(); fillRight(); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (k === "z" || k === "Z")) { e.preventDefault(); undo(); }
    else if ((e.ctrlKey || e.metaKey) && ((k === "y" || k === "Y") || (e.shiftKey && (k === "z" || k === "Z")))) { e.preventDefault(); redo(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const initial = (k === "+" || k === "-") ? "=" + k : k; // + / - start a formula (Excel-style)
      beginEdit(active.row, active.col, initial, "enter");
    }
  };

  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (pm.onEditKeyDown(e, row, col)) return;
    const k = e.key;
    if (k === "Escape") { e.preventDefault(); cancelEdit.current = true; void commitEdit().then(focusGrid); }
    else if (k === "Enter") { e.preventDefault(); void commitEdit().then(() => { move(e.shiftKey ? -1 : 1, 0); focusGrid(); }); }
    else if (k === "Tab") { e.preventDefault(); void commitEdit().then(() => { move(0, e.shiftKey ? -1 : 1); focusGrid(); }); }
    else if (k === "ArrowUp") { e.preventDefault(); void commitEdit().then(() => { move(-1, 0); focusGrid(); }); }
    else if (k === "ArrowDown") { e.preventDefault(); void commitEdit().then(() => { move(1, 0); focusGrid(); }); }
    else if (k === "ArrowLeft" && entryMode === "enter") { e.preventDefault(); void commitEdit().then(() => { move(0, -1); focusGrid(); }); }
    else if (k === "ArrowRight" && entryMode === "enter") { e.preventDefault(); void commitEdit().then(() => { move(0, 1); focusGrid(); }); }
  };

  const onCellMouseDown = (e: React.MouseEvent, row: number, col: number) => {
    if (placing) { // placement mode: drop the pending note on an empty cell
      e.preventDefault();
      if (cellFree(row, col)) { addAnnotationAt(row, col, placing); setPlacing(null); }
      return;
    }
    const formulaEditing = !!editing && draft.trimStart().startsWith("=");
    if (formulaEditing && row >= 1 && col >= 1 && !(editing!.row === row && editing!.col === col)) {
      pm.onCellMouseDown(e, row, col);
      return;
    }
    e.preventDefault();
    if (editing) void commitEdit();
    select(row, col);
    dragging.current = true;
    focusGrid();
  };

  const onCellMouseEnter = (row: number, col: number) => {
    if (pm.pointing) { pm.onCellMouseEnter(row, col); return; }
    if (dragging.current && active) { setActive({ row, col }); setSel((s) => (s ? { ...s, hRow: row, hCol: col } : s)); }
  };

  const addRow = () => { const m = modelRef.current; if (m) saveModel({ ...m, numRows: m.numRows + 1 }); };
  const addCol = () => { const m = modelRef.current; if (m) saveModel({ ...m, numCols: m.numCols + 1 }); };

  // Delete the rows / columns spanned by the current selection: drop their cells,
  // shift everything past them back, and shift/drop any cell annotations (freeing the
  // image bytes of annotations that fall inside the deleted band).
  const deleteSelectedRows = () => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const r1 = Math.min(sel.aRow, sel.hRow), r2 = Math.max(sel.aRow, sel.hRow);
    const n = r2 - r1 + 1;
    if (n >= m.numRows) return; // never delete the last row
    const cells: CalcModel["cells"] = {};
    for (const key in m.cells) {
      const [r, c] = key.split(":").map(Number);
      if (r < r1) cells[key] = m.cells[key];
      else if (r > r2) cells[`${r - n}:${c}`] = m.cells[key];
    }
    const dropped = (m.annotations || []).filter((a) => a.r >= r1 && a.r <= r2);
    const annotations = (m.annotations || []).filter((a) => !(a.r >= r1 && a.r <= r2)).map((a) => (a.r > r2 ? { ...a, r: a.r - n } : a));
    const numRows = m.numRows - n;
    saveModel({ ...m, numRows, cells, annotations });
    dropped.forEach((a) => { if (a.imageId) images.delete?.(a.imageId); });
    setActive({ row: Math.min(r1, numRows), col: active?.col ?? 1 });
    setSel({ aRow: Math.min(r1, numRows), aCol: 1, hRow: Math.min(r1, numRows), hCol: m.numCols });
  };
  const deleteSelectedCols = () => {
    const m = modelRef.current;
    if (!sel || !m) return;
    const c1 = Math.min(sel.aCol, sel.hCol), c2 = Math.max(sel.aCol, sel.hCol);
    const n = c2 - c1 + 1;
    if (n >= m.numCols) return; // never delete the last column
    const cells: CalcModel["cells"] = {};
    for (const key in m.cells) {
      const [r, c] = key.split(":").map(Number);
      if (c < c1) cells[key] = m.cells[key];
      else if (c > c2) cells[`${r}:${c - n}`] = m.cells[key];
    }
    const colWidths: Record<number, number> = {};
    for (const k in m.colWidths || {}) { const c = Number(k); if (c < c1) colWidths[c] = m.colWidths![c]; else if (c > c2) colWidths[c - n] = m.colWidths![c]; }
    const dropped = (m.annotations || []).filter((a) => a.c >= c1 && a.c <= c2);
    const annotations = (m.annotations || []).filter((a) => !(a.c >= c1 && a.c <= c2)).map((a) => (a.c > c2 ? { ...a, c: a.c - n } : a));
    const numCols = m.numCols - n;
    saveModel({ ...m, numCols, cells, colWidths, annotations });
    dropped.forEach((a) => { if (a.imageId) images.delete?.(a.imageId); });
    setActive({ row: active?.row ?? 1, col: Math.min(c1, numCols) });
    setSel({ aRow: 1, aCol: Math.min(c1, numCols), hRow: m.numRows, hCol: Math.min(c1, numCols) });
  };

  if (!model) return null;

  const isNumericCell = (row: number, col: number): boolean => {
    const r = raw(row, col);
    if (r === "") return false;
    if (r.startsWith("=")) return true;
    return Number.isFinite(Number(r.replace(/[$,]/g, ""))) && /[0-9]/.test(r);
  };
  // Long text spills over the cell(s) to its right when they're empty (Excel-style).
  const spillRight = (row: number, col: number): boolean => col >= model.numCols || raw(row, col + 1) === "";

  // Style for a non-editing cell (flex layout → use justifyContent for align).
  const cellDivStyle = (row: number, col: number): React.CSSProperties => {
    const s = model.cells[ck(row, col)]?.s;
    const numeric = isNumericCell(row, col);
    const st: React.CSSProperties = {};
    // Default alignment: numbers right, text left — unless explicitly set.
    if (s?.align) st.justifyContent = s.align === "left" ? "flex-start" : s.align === "center" ? "center" : "flex-end";
    else st.justifyContent = numeric ? "flex-end" : "flex-start";
    if (s?.color) st.color = s.color;
    if (s?.fill) st.background = s.fill;
    if (s?.bold) st.fontWeight = 700;
    if (s?.size) st.fontSize = s.size;
    if (s?.wrap) { st.whiteSpace = "normal"; st.overflow = "visible"; st.wordBreak = "break-word"; }
    else if (!numeric && spillRight(row, col)) { st.overflow = "visible"; st.position = "relative"; st.zIndex = 1; }
    // Gridlines + cell borders are drawn entirely with box-shadow INSETS so adjacent
    // cells never stack two lines (the old "double box" look). Each boundary is drawn
    // once: every cell paints its own RIGHT + BOTTOM (the light gridline, or a black
    // custom border when set); LEFT/TOP are painted only at a region's outer edge
    // (where the neighbour isn't already drawing that shared line). The grid's far
    // top/left outer edges are covered by the header frame.
    const GRID = "var(--line)";
    const BD = "#111210"; // custom border (near-black)
    const bd = s?.bd;
    const leftBd = model.cells[ck(row, col - 1)]?.s?.bd;
    const topBd = model.cells[ck(row - 1, col)]?.s?.bd;
    const seg: string[] = [];
    // RIGHT edge
    if (bd?.r) seg.push(`inset -1px 0 0 ${BD}`);
    else if (gridlinesOn) seg.push(`inset -1px 0 0 ${GRID}`);
    // BOTTOM edge (b === 2 → double line)
    if (bd?.b === 2) seg.push(`inset 0 -1px 0 ${BD}`, `inset 0 -3px 0 ${BD}`);
    else if (bd?.b === 1) seg.push(`inset 0 -1px 0 ${BD}`);
    else if (gridlinesOn) seg.push(`inset 0 -1px 0 ${GRID}`);
    // LEFT edge — only when the left neighbour isn't already drawing a right border
    if (bd?.l && !leftBd?.r) seg.push(`inset 1px 0 0 ${BD}`);
    // TOP edge — only when the top neighbour isn't already drawing a bottom border
    if (bd?.t && !topBd?.b) seg.push(`inset 0 1px 0 ${BD}`);
    // Reference-image block: a quiet, light-blue frame (the corner triangle is the
    // main affordance — the frame should not compete with content).
    for (const im of model.images || []) {
      if (row >= im.r1 && row <= im.r2 && col >= im.c1 && col <= im.c2) {
        const IMG = "rgba(37,99,235,0.35)";
        if (row === im.r1) seg.push(`inset 0 1px 0 ${IMG}`);
        if (row === im.r2) seg.push(`inset 0 -1px 0 ${IMG}`);
        if (col === im.c1) seg.push(`inset 1px 0 0 ${IMG}`);
        if (col === im.c2) seg.push(`inset -1px 0 0 ${IMG}`);
      }
    }
    if (seg.length) st.boxShadow = seg.join(",");
    return st;
  };
  const inputStyle = (row: number, col: number): React.CSSProperties => {
    const s = model.cells[ck(row, col)]?.s;
    const st: React.CSSProperties = {};
    st.textAlign = s?.align ?? (isNumericCell(row, col) ? "right" : "left");
    if (s?.color) st.color = s.color;
    if (s?.fill) st.background = s.fill;
    if (s?.bold) st.fontWeight = 700;
    if (s?.size) st.fontSize = s.size;
    return st;
  };

  const cellEl = (row: number, col: number) => {
    const editingThis = !!editing && editing.row === row && editing.col === col;
    if (editingThis) {
      return (
        <input
          ref={(el) => { if (el) pm.editInputRef.current = el; }}
          className="calc-cell value"
          style={inputStyle(row, col)}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); pm.endKeyboardPoint(); }}
          onBlur={(e) => { if (pm.pointing) return; if (e.relatedTarget === fxInputRef.current) return; void commitEdit(); }}
          onKeyDown={(e) => onEditKeyDown(e, row, col)}
        />
      );
    }
    const activeThis = !!active && active.row === row && active.col === col;
    const selected = inSel(row, col) && !activeThis;
    const pointHi = pm.inRange(row, col);
    const isRef = !!editing && refSet.has(ck(row, col));
    const neg = cellNegative(row, col);
    return (
      <div
        className={
          `calc-cell calc-celldiv value` +
          `${activeThis ? " calc-active" : ""}${selected ? " calc-selected" : ""}` +
          `${isRef ? " calc-ref" : ""}${pointHi ? " calc-point" : ""}${neg ? " num-negative" : ""}`
        }
        style={cellDivStyle(row, col)}
        onMouseDown={(e) => onCellMouseDown(e, row, col)}
        onMouseEnter={() => onCellMouseEnter(row, col)}
        onDoubleClick={() => beginEdit(row, col)}
      >
        {display(row, col)}
      </div>
    );
  };

  const colSelected = (c: number) => !!sel && c >= Math.min(sel.aCol, sel.hCol) && c <= Math.max(sel.aCol, sel.hCol);
  const rowSelected = (r: number) => !!sel && r >= Math.min(sel.aRow, sel.hRow) && r <= Math.max(sel.aRow, sel.hRow);

  return (
    <div className="calc-sheet">
      <div className="calc-toolbar">
        <button className="calc-tb calc-tb-ico" title="Undo (Ctrl+Z)" disabled={!canUndo} onMouseDown={(e) => e.preventDefault()} onClick={undo}><TbIcon name="undo" /></button>
        <button className="calc-tb calc-tb-ico" title="Redo (Ctrl+Y)" disabled={!canRedo} onMouseDown={(e) => e.preventDefault()} onClick={redo}><TbIcon name="redo" /></button>
        <span className="calc-tb-sep" />
        <button className={`calc-tb${activeStyle?.bold ? " on" : ""}`} title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={toggleBold}><b>B</b></button>
        <select
          className="calc-tb calc-tb-sel"
          title="Font size"
          value={activeStyle?.size ?? 13}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyStyle({ size: Number(e.target.value) })}
        >
          {[10, 11, 12, 13, 14, 16, 18, 20, 24].map((sz) => <option key={sz} value={sz}>{sz}</option>)}
        </select>
        <span className="calc-tb-sep" />
        <button className={`calc-tb calc-tb-ico${activeStyle?.align === "left" ? " on" : ""}`} title="Align left" onMouseDown={(e) => e.preventDefault()} onClick={() => applyStyle({ align: "left" })}><TbIcon name="alignLeft" /></button>
        <button className={`calc-tb calc-tb-ico${activeStyle?.align === "center" ? " on" : ""}`} title="Align center" onMouseDown={(e) => e.preventDefault()} onClick={() => applyStyle({ align: "center" })}><TbIcon name="alignCenter" /></button>
        <button className={`calc-tb calc-tb-ico${activeStyle?.align === "right" ? " on" : ""}`} title="Align right" onMouseDown={(e) => e.preventDefault()} onClick={() => applyStyle({ align: "right" })}><TbIcon name="alignRight" /></button>
        <button className={`calc-tb calc-tb-ico${activeStyle?.wrap ? " on" : ""}`} title="Wrap text" onMouseDown={(e) => e.preventDefault()} onClick={() => applyStyle({ wrap: activeStyle?.wrap ? undefined : true })}><TbIcon name="wrap" /></button>
        <span className="calc-tb-sep" />
        <span className="calc-colorwrap">
          <button className="calc-tb" title="Font color" onMouseDown={(e) => e.preventDefault()} onClick={() => setColorMenu(colorMenu === "font" ? null : "font")}>
            <span style={{ borderBottom: `3px solid ${activeStyle?.color || "#111210"}`, lineHeight: 1 }}>A</span>
          </button>
          {colorMenu === "font" && <ColorPalette onPick={(c) => { applyStyle({ color: c }); setColorMenu(null); }} onClear={() => { applyStyle({ color: undefined }); setColorMenu(null); }} />}
        </span>
        <span className="calc-colorwrap">
          <button className="calc-tb calc-tb-ico" title="Fill color" onMouseDown={(e) => e.preventDefault()} onClick={() => setColorMenu(colorMenu === "fill" ? null : "fill")}><TbIcon name="fill" /></button>
          {colorMenu === "fill" && <ColorPalette onPick={(c) => { applyStyle({ fill: c }); setColorMenu(null); }} onClear={() => { applyStyle({ fill: undefined }); setColorMenu(null); }} />}
        </span>
        <span className="calc-tb-sep" />
        <select
          className="calc-tb calc-tb-sel"
          title="Number format"
          value={activeStyle?.fmt === "pct" ? "pct" : "num"}
          onMouseDown={(e) => e.stopPropagation()}
          onChange={(e) => applyStyle({ fmt: e.target.value === "pct" ? "pct" : "num" })}
        >
          <option value="num">Number</option>
          <option value="pct">Percent</option>
        </select>
        <button className="calc-tb" title="Fewer decimals" onMouseDown={(e) => e.preventDefault()} onClick={() => bumpDp(-1)}>.0–</button>
        <button className="calc-tb" title="More decimals" onMouseDown={(e) => e.preventDefault()} onClick={() => bumpDp(1)}>.0+</button>
        <button className={`calc-tb${activeStyle?.cur ? " on" : ""}`} title="Currency ($)" onMouseDown={(e) => e.preventDefault()} onClick={toggleCurrency}>$</button>
        <span className="calc-tb-sep" />
        <span className="calc-colorwrap">
          <button className="calc-tb calc-tb-ico" title="Borders" onMouseDown={(e) => e.preventDefault()} onClick={() => setColorMenu(colorMenu === "border" ? null : "border")}><BorderIcon kind="outline" /></button>
          {colorMenu === "border" && (
            <div className="calc-palette calc-bordermenu" onMouseDown={(e) => e.preventDefault()}>
              <button className="calc-bdicon" title="All borders" onClick={() => { applyBorder("all"); setColorMenu(null); }}><BorderIcon kind="all" /></button>
              <button className="calc-bdicon" title="Outside box" onClick={() => { applyBorder("outline"); setColorMenu(null); }}><BorderIcon kind="outline" /></button>
              <button className="calc-bdicon" title="Top border" onClick={() => { applyBorder("top"); setColorMenu(null); }}><BorderIcon kind="top" /></button>
              <button className="calc-bdicon" title="Bottom border (underline)" onClick={() => { applyBorder("bottom"); setColorMenu(null); }}><BorderIcon kind="bottom" /></button>
              <button className="calc-bdicon" title="Double bottom border" onClick={() => { applyBorder("double"); setColorMenu(null); }}><BorderIcon kind="double" /></button>
              <button className="calc-bdicon" title="No borders" onClick={() => { applyBorder("none"); setColorMenu(null); }}><BorderIcon kind="none" /></button>
            </div>
          )}
        </span>
        <span className="calc-tb-sep" />
        <button className="calc-tb calc-tb-lbl" title="Add a note / screenshot to a cell (or just paste a screenshot onto an empty cell)" onMouseDown={(e) => e.preventDefault()} onClick={() => requestAnnotation({})}><TbIcon name="note" /> Note</button>
        <button className="calc-tb calc-tb-ico" title="Clear formatting" onMouseDown={(e) => e.preventDefault()} onClick={clearFormat}><TbIcon name="clear" /></button>
        <span className="calc-tb-sep" />
        <label className="calc-tb" title="Show gridlines"><input type="checkbox" checked={gridlinesOn} onChange={toggleGridlines} /> Gridlines</label>
        <span className="calc-tb-sep" />
        <button className="calc-tb calc-tb-lbl" title="Delete the selected row(s)" onMouseDown={(e) => e.preventDefault()} onClick={deleteSelectedRows}><TbIcon name="delRow" /> Row</button>
        <button className="calc-tb calc-tb-lbl" title="Delete the selected column(s)" onMouseDown={(e) => e.preventDefault()} onClick={deleteSelectedCols}><TbIcon name="delCol" /> Col</button>
        <span className="calc-tb-spacer" />
        {saveState !== "idle" && (
          <span className={`calc-savestate calc-save-${saveState}`} title="Save status">
            {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save failed"}
          </span>
        )}
        <button className="calc-tb calc-tb-ico" title="Help — how to use this sheet" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowHelp(true)}><TbIcon name="help" /></button>
        {onDeleteSheet && (
          <button className="calc-tb calc-tb-ico calc-tb-danger" title="Delete this whole sheet" onMouseDown={(e) => e.preventDefault()} onClick={onDeleteSheet}><TbIcon name="trash" /></button>
        )}
      </div>

      {placing && (
        <div className="calc-placing">
          Click an <strong>empty cell</strong> to place the {placing.imageId ? "screenshot" : "note"} — or press <strong>Esc</strong> to cancel.
        </div>
      )}

      {tabs && <div className="calc-tabrow">{tabs}</div>}

      <div className="calc-fxbar">
        <span className="calc-fxaddr">{active ? `${numToColLetter(active.col)}${active.row}` : ""}</span>
        <input
          ref={fxInputRef}
          className="calc-fxinput"
          placeholder="Cell content / formula"
          value={
            active && editing && editing.row === active.row && editing.col === active.col
              ? draft
              : active
              ? raw(active.row, active.col)
              : ""
          }
          onFocus={() => { if (active && !editing) beginEdit(active.row, active.col, undefined, "edit"); }}
          onChange={(e) => {
            if (!active) return;
            if (!editing) beginEdit(active.row, active.col, e.target.value, "edit");
            else { setDraft(e.target.value); pm.endKeyboardPoint(); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); void commitEdit().then(focusGrid); }
            else if (e.key === "Escape") { e.preventDefault(); cancelEdit.current = true; void commitEdit().then(focusGrid); }
          }}
        />
      </div>

      <div className="calc-grid" tabIndex={0} ref={gridRef} onKeyDown={onGridKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste}>
        <table
          className={`calc-table${pm.pointing ? " pointing" : ""}${gridlinesOn ? "" : " calc-nogrid"}`}
          style={{ tableLayout: "fixed", width: ROWHEAD_W + ADDCOL_W + Array.from({ length: model.numCols }, (_, c) => colW(c + 1)).reduce((a, b) => a + b, 0) }}
        >
          <colgroup>
            <col style={{ width: ROWHEAD_W }} />
            {Array.from({ length: model.numCols }, (_, c) => <col key={c + 1} style={{ width: colW(c + 1) }} />)}
            <col style={{ width: ADDCOL_W }} />
          </colgroup>
          <thead>
            <tr>
              <th className="calc-corner" title="Select all" onMouseDown={(e) => { e.preventDefault(); selectAll(); }}></th>
              {Array.from({ length: model.numCols }, (_, c) => {
                const col = c + 1;
                return (
                  <th
                    key={col}
                    className={`calc-colhead${colSelected(col) ? " sel" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); selectColumn(col, e.shiftKey); headerDrag.current = "col"; }}
                    onMouseEnter={() => { if (headerDrag.current === "col") { setActive({ row: 1, col }); setSel((s) => (s ? { ...s, aRow: 1, hRow: model.numRows, hCol: col } : s)); } }}
                  >
                    {numToColLetter(col)}
                    <span className="calc-colresize" title="Drag to resize" onPointerDown={(e) => onColResizeStart(e, col)} />
                  </th>
                );
              })}
              <th className="calc-addhead" title="Add a column" onMouseDown={(e) => { e.preventDefault(); addCol(); }}>+</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: model.numRows }, (_, r) => {
              const row = r + 1;
              return (
                <tr key={row}>
                  <th
                    className={`calc-rowhead${rowSelected(row) ? " sel" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); selectRow(row, e.shiftKey); headerDrag.current = "row"; }}
                    onMouseEnter={() => { if (headerDrag.current === "row") { setActive({ row, col: 1 }); setSel((s) => (s ? { ...s, aCol: 1, hCol: model.numCols, hRow: row } : s)); } }}
                  >
                    {row}
                  </th>
                  {Array.from({ length: model.numCols }, (_, c) => {
                    const col = c + 1;
                    const showFill = !!fillValue && !editing && !!active && active.row === row && active.col === col;
                    const entry = annoByCell.get(`${row}:${col}`);
                    const anno = entry?.a;
                    const isDrop = dropTarget === `${row}:${col}`;
                    return (
                      <td key={col} className={`calc-valuecell${isDrop ? " calc-droptarget" : ""}`} data-cell={`${row}:${col}`}>
                        {anno ? (
                          <button
                            className={`calc-annobtn${anno.open ? " open" : ""}`}
                            title="Note — click to show/hide, drag to move"
                            onPointerDown={(e) => startAnnoDrag(e, anno)}
                          >
                            {anno.imageId ? "📷 " : "📝 "}#{entry!.num}{anno.title ? ` ${anno.title}` : ""}
                          </button>
                        ) : (
                          cellEl(row, col)
                        )}
                        {showFill && !anno && (
                          <button
                            className="calc-send"
                            title="Send this value to the field"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => fillValue!(computed(row, col))}
                          >
                            →
                          </button>
                        )}
                      </td>
                    );
                  })}
                  <td className="calc-addspacer" />
                </tr>
              );
            })}
            <tr className="calc-addrow">
              <th className="calc-addhead" title="Add a row" onMouseDown={(e) => { e.preventDefault(); addRow(); }}>+</th>
              <td colSpan={model.numCols + 1} />
            </tr>
          </tbody>
        </table>
        {marquee && <div className="calc-marquee" style={marquee} />}
      </div>

      {(model.annotations || []).map((a, i) =>
        a.open ? (
          <CalcAnnoPanel
            key={a.id}
            anno={a}
            index={i}
            num={i + 1}
            uploadImage={images.upload}
            fetchImage={images.fetch}
            onPatch={(patch) => patchAnno(a.id, patch)}
            onDelete={() => removeAnno(a)}
            onClose={() => patchAnno(a.id, { open: false })}
          />
        ) : null,
      )}

      {showHelp && (
        <div className="calc-overlay" onMouseDown={() => setShowHelp(false)}>
          <div className="calc-modal calc-help" onMouseDown={(e) => e.stopPropagation()}>
            <div className="calc-modal-head">
              <strong>How to use this sheet</strong>
              <button className="act-btn" onClick={() => setShowHelp(false)}>✕ Close</button>
            </div>
            <ul className="calc-help-list">
              <li><strong>Select / edit:</strong> click a cell to select; <strong>double-click</strong>, <strong>F2</strong>, or just start typing to edit.</li>
              <li><strong>Whole row / column:</strong> click a <strong>row number</strong> or <strong>column letter</strong> (<strong>Shift</strong> extends the selection), then format with the toolbar.</li>
              <li><strong>Move:</strong> <strong>arrows / Tab / Enter</strong>; <strong>Shift+arrow</strong> selects a range; <strong>Delete</strong> clears the contents.</li>
              <li><strong>Formulas:</strong> start with <code>=</code> (or <code>+</code> / <code>-</code>), e.g. <code>=A4*A3</code>. While editing, point at cells with the <strong>arrow keys</strong> or by <strong>click/drag</strong>. <strong>Enter</strong> commits, <strong>Esc</strong> cancels.</li>
              <li><strong>Copy / fill:</strong> <strong>Ctrl+C / V</strong> copy &amp; paste (formulas adjust like Excel; pasting from Excel works too). <strong>Ctrl+D</strong> fills down, <strong>Ctrl+R</strong> fills right.</li>
              <li><strong>Undo / redo:</strong> <strong>Ctrl+Z</strong> / <strong>Ctrl+Y</strong> (or the <strong>↶ ↷</strong> buttons). Undo works while navigating; while typing inside a cell, Ctrl+Z is the normal text undo.</li>
              <li><strong>Anchors:</strong> use <code>$A$1</code> to anchor a reference, or press <strong>F4</strong> while editing to cycle a reference's anchors.</li>
              <li><strong>Rows / columns:</strong> click the <strong>+</strong> at the bottom-left to add a row, or the <strong>+</strong> at the top-right to add a column. Use <strong>⌦ Row</strong> / <strong>⌦ Col</strong> in the toolbar to delete the selected ones.</li>
              <li><strong>Notes &amp; screenshots:</strong> click <strong>📝 Note</strong> (or paste a screenshot) to drop a small <strong>note button</strong> on a cell — it only ever lands on an <strong>empty</strong> cell. Click the button to show/hide its panel; drag it to another empty cell to move it. The panel is movable + resizable, takes a title, a note (bold / red), and a pasted screenshot, and <strong>stays open for everyone</strong> until closed.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
