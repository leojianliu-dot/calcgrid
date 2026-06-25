// Demo persistence: everything lives in the visitor's own browser (localStorage).
// This is the "host loader" layer — swap it for a real API and CalcGrid is unchanged.
import type { CalcModel } from "./calcgrid";

const MODEL_KEY = "calcgrid-demo-model-v1";
const IMG_PREFIX = "calcgrid-demo-img-";
const IMG_SEQ = "calcgrid-demo-img-seq";

function sampleModel(): CalcModel {
  return {
    numRows: 14,
    numCols: 7,
    showGridlines: true,
    cells: {
      "1:1": { v: "项目 Item", s: { bold: true } },
      "1:2": { v: "金额 Amount", s: { bold: true, align: "right" } },
      "2:1": { v: "收入 Revenue" },
      "2:2": { v: "1200", s: { cur: true } },
      "3:1": { v: "成本 Cost" },
      "3:2": { v: "-450", s: { cur: true } },
      "4:1": { v: "净额 Net", s: { bold: true } },
      "4:2": { v: "=B2+B3", s: { cur: true, bold: true, bd: { t: true, b: 2 } } },
      "6:1": { v: "毛利率 Margin" },
      "6:2": { v: "=B4/B2", s: { fmt: "pct", dp: 1 } },
      "8:1": { v: "← 试试：双击单元格编辑、输入 = 写公式" },
    },
    annotations: [
      {
        id: "demo-note-1",
        r: 2,
        c: 4,
        title: "欢迎试用 / Welcome",
        note: "这是一个<b>批注</b>：可写笔记，或<span style=\"color:#dc2626\">粘贴一张截图</span>。拖动标题栏可移动，拖右下角可缩放。",
        open: true,
        w: 320,
        h: 230,
      },
    ],
  };
}

export function loadModel(): CalcModel {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    if (raw) return JSON.parse(raw) as CalcModel;
  } catch { /* fall through to sample */ }
  return sampleModel();
}

export function saveModel(m: CalcModel): void {
  localStorage.setItem(MODEL_KEY, JSON.stringify(m));
}

export function clearDemo(): void {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (k === MODEL_KEY || k === IMG_SEQ || k.startsWith(IMG_PREFIX))) keys.push(k);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

// ---- Image I/O (base64 in localStorage) ----
function readDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = rej;
    fr.readAsDataURL(file);
  });
}

export async function uploadImage(file: File): Promise<number> {
  const dataUrl = await readDataUrl(file);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const id = Number(localStorage.getItem(IMG_SEQ) || "0") + 1;
  localStorage.setItem(IMG_SEQ, String(id));
  localStorage.setItem(IMG_PREFIX + id, JSON.stringify({ contentType: file.type || "image/png", dataBase64: base64 }));
  return id;
}

export async function fetchImage(id: number): Promise<{ contentType: string; dataBase64: string }> {
  const raw = localStorage.getItem(IMG_PREFIX + id);
  if (!raw) throw new Error("image not found");
  return JSON.parse(raw);
}

export function deleteImage(id: number): void {
  localStorage.removeItem(IMG_PREFIX + id);
}
