// CalcGrid — a self-contained, persistence-agnostic Excel-like grid.
// Drop it into any frontend: give it a CalcModel + onChange, and inject image
// upload/fetch/delete. No API or app dependency lives inside this folder.
export { default as CalcGrid } from "./CalcGrid";
export type {
  CalcModel,
  CalcAnnotation,
  CalcCellStyle,
  CalcCellData,
  CalcImageRef,
  CalcImages,
  SaveState,
} from "./types";
// Formula engine + number formatting are reusable on their own too.
export { makeResolver, evalFormula, translateFormula, balanceParens, colLetterToNum, numToColLetter } from "./calc";
export { fmtAccounting, isNegativeNum } from "./format";
