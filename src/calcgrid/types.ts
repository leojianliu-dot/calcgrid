// ---- CalcGrid model (the persistence-agnostic document) -------------------
// The whole sheet is one JSON document. The host decides where it's stored; the
// grid only takes a CalcModel + emits a new one via onChange.

export interface CalcCellStyle {
  align?: "left" | "center" | "right";
  color?: string; // font color (hex)
  fill?: string;  // background fill (hex)
  bold?: boolean;
  wrap?: boolean;        // wrap long text (else clipped)
  size?: number;         // font size (px)
  fmt?: "num" | "pct";   // number format (default "num")
  dp?: number;           // decimal places (default 0 = integer)
  cur?: boolean;         // currency ($) prefix
  bd?: { t?: boolean; b?: 1 | 2; l?: boolean; r?: boolean }; // cell borders (b: 1 single, 2 double)
}
export interface CalcCellData {
  v: string;            // raw content (number, text, or =formula)
  s?: CalcCellStyle;    // optional per-cell style
}
// Legacy reference-image ref (pre-annotation snapshots). Migration source only.
export interface CalcImageRef {
  id: number;
  r1: number; c1: number; r2: number; c2: number;
  caption?: string;
}
// A cell annotation: a note and/or a screenshot anchored to a single (empty) cell.
export interface CalcAnnotation {
  id: string;            // stable client id
  r: number; c: number;  // anchor cell (1-based)
  title?: string;        // optional button label (else "Screenshot" / "Note")
  note?: string;         // sanitized simple HTML (bold / italic / red) or plain text
  imageId?: number;      // host image id (omitted for a pure note)
  open?: boolean;        // panel shown (default true on create)
  x?: number; y?: number; w?: number; h?: number; // panel position + size (px)
}
export interface CalcModel {
  numRows: number;
  numCols: number;
  cells: Record<string, CalcCellData>; // keyed "row:col"
  colWidths?: Record<number, number>;  // col -> px
  showGridlines?: boolean;             // default true
  annotations?: CalcAnnotation[];
  images?: CalcImageRef[];             // LEGACY: host migrates to annotations on load
}

// Host-injected image I/O (so the grid has no API dependency).
export interface CalcImages {
  upload: (file: File) => Promise<number>;                                  // -> imageId
  fetch: (id: number) => Promise<{ contentType: string; dataBase64: string }>;
  delete?: (id: number) => void;                                            // free bytes (best-effort)
}

export type SaveState = "idle" | "saving" | "saved" | "error";
