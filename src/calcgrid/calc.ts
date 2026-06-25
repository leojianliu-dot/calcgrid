// Small spreadsheet formula engine for calc sheets — the shared "calculator
// brain". Cell refs are Excel-style: column letter (A=col 1, B=col 2…) + data
// row number (1-based). Supports + - * /, parentheses, unary +/-, comparisons
// (for IF), and functions SUM / MIN / MAX / AVERAGE / ROUND / ABS / IF.
// Ranges (A1:B3) are allowed inside aggregate functions.

export function colLetterToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function numToColLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

type Tok = { t: "num" | "ref" | "fn" | "op" | "lp" | "rp" | "comma" | "colon"; v: string };

function tokenize(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      toks.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "$" || /[A-Za-z]/.test(c)) {
      // A reference may carry $ anchors: $A$1, $A1, A$1, A1.
      const refM = /^\$?[A-Za-z]+\$?[0-9]+/.exec(s.slice(i));
      if (refM) {
        toks.push({ t: "ref", v: refM[0] });
        i += refM[0].length;
        continue;
      }
      if (/[A-Za-z]/.test(c)) {
        let j = i + 1;
        while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
        toks.push({ t: "fn", v: s.slice(i, j).toUpperCase() });
        i = j;
        continue;
      }
      throw new Error(`Bad character: ${c}`);
    }
    if (c === "(") { toks.push({ t: "lp", v: c }); i++; continue; }
    if (c === ")") { toks.push({ t: "rp", v: c }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma", v: c }); i++; continue; }
    if (c === ":") { toks.push({ t: "colon", v: c }); i++; continue; }
    if (c === "<") {
      if (s[i + 1] === "=") { toks.push({ t: "op", v: "<=" }); i += 2; }
      else if (s[i + 1] === ">") { toks.push({ t: "op", v: "<>" }); i += 2; }
      else { toks.push({ t: "op", v: "<" }); i++; }
      continue;
    }
    if (c === ">") {
      if (s[i + 1] === "=") { toks.push({ t: "op", v: ">=" }); i += 2; }
      else { toks.push({ t: "op", v: ">" }); i++; }
      continue;
    }
    if (c === "=") { toks.push({ t: "op", v: "=" }); i++; continue; }
    if ("+-*/".includes(c)) { toks.push({ t: "op", v: c }); i++; continue; }
    throw new Error(`Bad character: ${c}`);
  }
  return toks;
}

export type Resolver = (col: number, row: number) => number;

// Excel-style tolerance: append any missing ')' so an unclosed formula still
// parses — e.g. "=SUM(A1:A5" evaluates as "=SUM(A1:A5)". Handy after dragging a
// range into a function, where the closing paren hasn't been typed yet. (No
// string literals in our formula grammar, so a char count is safe.)
export function balanceParens(src: string): string {
  let bal = 0;
  for (const ch of src) {
    if (ch === "(") bal++;
    else if (ch === ")") bal--;
  }
  return bal > 0 ? src + ")".repeat(bal) : src;
}

// Shift the relative parts of every cell reference in a formula by (dRow, dCol).
// $-anchored row/column parts are left unchanged (absolute). Used by fill-down
// /fill-right and copy/paste so formulas adjust the way they do in Excel.
// The lookbehind avoids matching the "e5" inside things like "1e5".
export function translateFormula(src: string, dRow: number, dCol: number): string {
  return src.replace(/(?<![A-Za-z0-9$])(\$?)([A-Za-z]+)(\$?)(\d+)/g, (_m, ca: string, letters: string, ra: string, digits: string) => {
    const col = ca ? letters : numToColLetter(Math.max(1, colLetterToNum(letters) + dCol));
    const row = ra ? digits : String(Math.max(1, parseInt(digits, 10) + dRow));
    return `${ca}${col}${ra}${row}`;
  });
}

// Evaluate one formula string (without the leading '='). `resolve` returns the
// numeric value of a referenced cell (which may itself be a formula).
// `cellValue` (optional) returns a cell's numeric value or null for a blank/
// non-numeric cell, so range aggregates (AVERAGE/MIN/MAX) can ignore blanks the
// way Excel does. When omitted, ranges fall back to `resolve` (blank → 0).
export function evalFormula(src: string, resolve: Resolver, cellValue?: (col: number, row: number) => number | null): number {
  const toks = tokenize(balanceParens(src));
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (tt: string) => {
    const t = next();
    if (!t || t.t !== tt) throw new Error(`Expected ${tt}`);
  };
  const parseRef = (ref: string) => {
    const m = ref.match(/^\$?([A-Za-z]+)\$?([0-9]+)$/); // $ anchors don't affect evaluation
    if (!m) throw new Error(`Bad ref ${ref}`);
    return { col: colLetterToNum(m[1]), row: parseInt(m[2], 10) };
  };

  function parseExpr(): number {
    return parseComparison();
  }
  function parseComparison(): number {
    const left = parseAddSub();
    const t = peek();
    if (t && t.t === "op" && ["<", ">", "<=", ">=", "=", "<>"].includes(t.v)) {
      next();
      const r = parseAddSub();
      switch (t.v) {
        case "<": return left < r ? 1 : 0;
        case ">": return left > r ? 1 : 0;
        case "<=": return left <= r ? 1 : 0;
        case ">=": return left >= r ? 1 : 0;
        case "=": return left === r ? 1 : 0;
        case "<>": return left !== r ? 1 : 0;
      }
    }
    return left;
  }
  function parseAddSub(): number {
    let v = parseMulDiv();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = next().v;
      const r = parseMulDiv();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseMulDiv(): number {
    let v = parseUnary();
    while (peek() && peek().t === "op" && (peek().v === "*" || peek().v === "/")) {
      const op = next().v;
      const r = parseUnary();
      v = op === "*" ? v * r : r === 0 ? NaN : v / r;
    }
    return v;
  }
  function parseUnary(): number {
    if (peek() && peek().t === "op" && peek().v === "-") { next(); return -parseUnary(); }
    if (peek() && peek().t === "op" && peek().v === "+") { next(); return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary(): number {
    const t = peek();
    if (!t) throw new Error("Unexpected end of formula");
    if (t.t === "num") { next(); return parseFloat(t.v); }
    if (t.t === "lp") { next(); const v = parseExpr(); expect("rp"); return v; }
    if (t.t === "ref") { next(); const { col, row } = parseRef(t.v); return resolve(col, row); }
    if (t.t === "fn") return parseFunction();
    throw new Error(`Unexpected '${t.v}'`);
  }
  function parseFunction(): number {
    const name = next().v;
    expect("lp");
    const args: number[] = [];
    if (peek() && peek().t !== "rp") {
      do {
        args.push(...parseArg());
      } while (peek() && peek().t === "comma" && next());
    }
    expect("rp");
    const finite = args.filter((n) => Number.isFinite(n));
    switch (name) {
      case "SUM": return args.reduce((a, b) => a + (isNaN(b) ? 0 : b), 0);
      case "MIN": return finite.length ? Math.min(...finite) : 0; // empty range → 0 (not Infinity)
      case "MAX": return finite.length ? Math.max(...finite) : 0;
      case "AVERAGE": return finite.length ? finite.reduce((a, b) => a + b, 0) / finite.length : 0; // ignores blanks
      case "ABS": return args.length ? Math.abs(args[0]) : NaN;
      case "ROUND": { if (!args.length) return NaN; const f = Math.pow(10, args[1] ?? 0); return Math.round(args[0] * f) / f; }
      case "IF": return args[0] ? args[1] : args[2] ?? 0;
      default: throw new Error(`Unknown function ${name}`);
    }
  }
  // An argument is either a range (ref:ref → list of cell values) or an expression.
  // For ranges we use the blank-aware accessor so AVERAGE/MIN/MAX skip empty cells.
  function parseArg(): number[] {
    const t = peek();
    if (t && t.t === "ref" && toks[p + 1]?.t === "colon" && toks[p + 2]?.t === "ref") {
      const a = parseRef(next().v);
      next(); // colon
      const b = parseRef(next().v);
      const out: number[] = [];
      const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col);
      const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row);
      for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) {
        if (cellValue) { const v = cellValue(c, r); if (v !== null) out.push(v); } // skip blank/text cells
        else out.push(resolve(c, r));
      }
      return out;
    }
    return [parseExpr()];
  }

  const result = parseExpr();
  if (p < toks.length) throw new Error("Unexpected trailing input");
  return result;
}

// Build a resolver over a getRaw(col,row) accessor, with memoization and
// circular-reference detection. Non-formula cells parse as numbers (blank/text → 0).
export function makeResolver(getRaw: (col: number, row: number) => string): Resolver {
  const cache = new Map<string, number>();
  const visiting = new Set<string>();
  // Blank/text-aware value: null means "not a number" (blank or text) so range
  // aggregates can skip it. Formula cells resolve to their numeric result.
  const cellValue = (col: number, row: number): number | null => {
    const raw = (getRaw(col, row) ?? "").trim();
    if (raw === "") return null;
    if (raw.startsWith("=")) { const v = resolve(col, row); return Number.isFinite(v) ? v : null; }
    const n = parseFloat(raw.replace(/[$,]/g, ""));
    return isFinite(n) ? n : null;
  };
  const resolve: Resolver = (col, row) => {
    const key = `${col}:${row}`;
    if (cache.has(key)) return cache.get(key)!;
    if (visiting.has(key)) throw new Error("Circular reference");
    visiting.add(key);
    const raw = (getRaw(col, row) ?? "").trim();
    let val: number;
    if (raw.startsWith("=")) val = evalFormula(raw.slice(1), resolve, cellValue);
    else {
      const n = parseFloat(raw.replace(/[$,]/g, ""));
      val = isFinite(n) ? n : 0;
    }
    visiting.delete(key);
    cache.set(key, val);
    return val;
  };
  return resolve;
}
