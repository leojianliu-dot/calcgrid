import { useCallback, useEffect, useRef, useState } from "react";

// Reusable "Excel point mode" for any grid of editable cells in the workpaper.
//
// While a cell is being edited AND its text is a formula (starts with "="),
// you can insert cell references two ways:
//  - MOUSE: click another cell to insert its reference (e.g. "A3"); drag across
//    cells to insert a range ("A3:A8").
//  - KEYBOARD: press an arrow at a reference position (right after "=", an
//    operator, "(", "," or ":") to start "pointing" — a marquee starts at the
//    cell next to the FORMULA cell, its reference is spliced into the formula,
//    and arrows move it (Shift+arrow extends a range). Typing anything commits
//    the reference in place so the next arrow starts a fresh one.
//
// Robustness notes (both bugs hit during testing):
//  - The pending reference is rebuilt every press as `before + refStr + after`
//    where `before`/`after` are captured ONCE when pointing starts. There is no
//    position+length to drift, so it can never append ("A3 -> AA3 -> AAA3").
//  - All point state is RESET whenever the edited cell changes, so a point left
//    over from a previous cell can't bleed into a brand-new formula.

export type Cell = { row: number; col: number };

interface Options {
  editing: Cell | null;
  draft: string;
  setDraft: (s: string) => void;
  cellRef: (row: number, col: number) => string;
  isReferenceable: (row: number, col: number) => boolean;
  rowCount: number;
  colCount: number;
}

// A pending reference being pointed at: the formula split around it, plus the
// anchor/head cells. Used for both mouse drag and keyboard pointing.
interface PointState {
  before: string;
  after: string;
  aRow: number; aCol: number;
  hRow: number; hCol: number;
}

const ARROW_DELTA: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

// F4 cycles the $ anchors on the cell reference at (or just before) the caret:
// A1 → $A$1 → A$1 → $A1 → A1. Returns the new text + caret, or null if no ref.
function cycleAbsAt(text: string, caret: number): { text: string; caret: number } | null {
  const re = /(\$?)([A-Za-z]+)(\$?)(\d+)/g;
  let m: RegExpExecArray | null;
  let hit: { start: number; end: number; m: RegExpExecArray } | null = null;
  while ((m = re.exec(text))) {
    const start = m.index, end = start + m[0].length;
    if (caret >= start && caret <= end) { hit = { start, end, m }; break; } // caret inside/adjacent
    if (end <= caret) hit = { start, end, m }; // remember the last ref before the caret as fallback
  }
  if (!hit) return null;
  const [, ca, letters, ra, digits] = hit.m;
  let nca = ca, nra = ra;
  if (!ca && !ra) { nca = "$"; nra = "$"; }       // A1 → $A$1
  else if (ca && ra) { nca = ""; nra = "$"; }      // $A$1 → A$1
  else if (!ca && ra) { nca = "$"; nra = ""; }     // A$1 → $A1
  else { nca = ""; nra = ""; }                     // $A1 → A1
  const ref = `${nca}${letters}${nra}${digits}`;
  return { text: text.slice(0, hit.start) + ref + text.slice(hit.end), caret: hit.start + ref.length };
}

function refExpecting(text: string, caret: number): boolean {
  let i = caret - 1;
  while (i >= 0 && (text[i] === " " || text[i] === "\t")) i--;
  if (i < 0) return false;
  return "=+-*/(,:".includes(text[i]);
}

export function useFormulaPointMode({
  editing, draft, setDraft, cellRef, isReferenceable, rowCount, colCount,
}: Options) {
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);

  // Mouse drag point (drives blur/selection suppression via `pointing`).
  const [mouse, setMouse] = useState<PointState | null>(null);
  const mouseRef = useRef<PointState | null>(null);
  const setMousePt = (p: PointState | null) => { mouseRef.current = p; setMouse(p); };

  // Keyboard point: authoritative in a ref (sync), mirrored to state for the
  // highlight only.
  const [keyHi, setKeyHi] = useState<PointState | null>(null);
  const kbRef = useRef<PointState | null>(null);
  const setKb = (p: PointState | null) => { kbRef.current = p; setKeyHi(p); };

  // Live mirror of the draft so a synchronous keydown reads the true value.
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  const writeDraft = (text: string) => { draftRef.current = text; setDraft(text); };

  // Reset ALL point state whenever the edited cell changes (start or finish an
  // edit). Without this, a point left over from the previous cell resumes on
  // the next cell's first arrow press.
  useEffect(() => { setKb(null); setMousePt(null); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const isFormulaDraft = (text: string) => editing != null && text.trimStart().startsWith("=");

  // Keep focus on the formula input and move the caret past the inserted token.
  useEffect(() => {
    if (pendingCaret.current != null && editInputRef.current) {
      const pos = pendingCaret.current;
      editInputRef.current.focus();
      try { editInputRef.current.setSelectionRange(pos, pos); } catch { /* non-text input */ }
      pendingCaret.current = null;
    }
  }, [draft]);

  useEffect(() => {
    const up = () => setMousePt(null);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const clampRef = useCallback(
    (row: number, col: number): Cell => ({
      row: Math.max(1, Math.min(rowCount, row)),
      col: Math.max(1, Math.min(colCount, col)),
    }),
    [rowCount, colCount],
  );

  const refToken = (aRow: number, aCol: number, hRow: number, hCol: number) =>
    aRow === hRow && aCol === hCol ? cellRef(hRow, hCol) : `${cellRef(aRow, aCol)}:${cellRef(hRow, hCol)}`;

  // ---- Mouse pointing -----------------------------------------------------
  const onCellMouseDown = useCallback(
    (e: React.MouseEvent, row: number, col: number) => {
      const text = draftRef.current;
      if (!isFormulaDraft(text)) return;
      if (!isReferenceable(row, col)) return;
      if (editing && editing.row === row && editing.col === col) return;
      e.preventDefault();
      setKb(null);
      const input = editInputRef.current;
      const caret = input ? input.selectionStart ?? text.length : text.length;
      const before = text.slice(0, caret), after = text.slice(caret);
      const refStr = cellRef(row, col);
      writeDraft(before + refStr + after);
      setMousePt({ before, after, aRow: row, aCol: col, hRow: row, hCol: col });
      pendingCaret.current = before.length + refStr.length;
    },
    [isReferenceable, editing, cellRef], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onCellMouseEnter = useCallback(
    (row: number, col: number) => {
      const p = mouseRef.current;
      if (!p) return;
      if (!isReferenceable(row, col)) return;
      const refStr = refToken(p.aRow, p.aCol, row, col);
      writeDraft(p.before + refStr + p.after);
      setMousePt({ ...p, hRow: row, hCol: col });
      pendingCaret.current = p.before.length + refStr.length;
    },
    [isReferenceable, cellRef], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ---- Keyboard pointing --------------------------------------------------
  // Returns true if the key was consumed (caller should NOT also navigate).
  const onEditKeyDown = useCallback(
    (e: React.KeyboardEvent, editRow: number, editCol: number): boolean => {
      const text = draftRef.current;
      if (!isFormulaDraft(text)) return false;

      // F4: cycle the $ anchors on the reference at the caret.
      if (e.key === "F4") {
        e.preventDefault();
        const input = editInputRef.current;
        const caret = input ? input.selectionStart ?? text.length : text.length;
        const res = cycleAbsAt(text, caret);
        if (res) { writeDraft(res.text); pendingCaret.current = res.caret; }
        return true;
      }

      const delta = ARROW_DELTA[e.key];
      if (!delta) return false;

      const kb = kbRef.current;
      if (kb) {
        e.preventDefault();
        const head = clampRef(kb.hRow + delta[0], kb.hCol + delta[1]);
        const aRow = e.shiftKey ? kb.aRow : head.row;
        const aCol = e.shiftKey ? kb.aCol : head.col;
        const refStr = refToken(aRow, aCol, head.row, head.col);
        writeDraft(kb.before + refStr + kb.after);
        setKb({ before: kb.before, after: kb.after, aRow, aCol, hRow: head.row, hCol: head.col });
        pendingCaret.current = kb.before.length + refStr.length;
        return true;
      }

      const input = editInputRef.current;
      const caret = input ? input.selectionStart ?? text.length : text.length;
      if (!refExpecting(text, caret)) return true; // mid-formula caret move; don't navigate away
      e.preventDefault();
      const before = text.slice(0, caret), after = text.slice(caret);
      const head = clampRef(editRow + delta[0], editCol + delta[1]); // start next to the formula cell
      const refStr = cellRef(head.row, head.col);
      writeDraft(before + refStr + after);
      setKb({ before, after, aRow: head.row, aCol: head.col, hRow: head.row, hCol: head.col });
      pendingCaret.current = before.length + refStr.length;
      return true;
    },
    [editing, cellRef, clampRef], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const endKeyboardPoint = useCallback(() => setKb(null), []);

  // ---- Highlight ----------------------------------------------------------
  const inBox = (row: number, col: number, p: PointState) =>
    row >= Math.min(p.aRow, p.hRow) && row <= Math.max(p.aRow, p.hRow) &&
    col >= Math.min(p.aCol, p.hCol) && col <= Math.max(p.aCol, p.hCol);

  const inRange = useCallback(
    (row: number, col: number) => (mouse != null && inBox(row, col, mouse)) || (keyHi != null && inBox(row, col, keyHi)),
    [mouse, keyHi],
  );

  return {
    editInputRef,
    onCellMouseDown,
    onCellMouseEnter,
    onEditKeyDown,
    endKeyboardPoint,
    inRange,
    pointing: mouse != null,
  };
}
