import { useEffect, useRef, useState } from "react";
import { CalcGrid } from "./calcgrid";
import type { CalcModel, SaveState } from "./calcgrid";
import { loadModel, saveModel, clearDemo, uploadImage, fetchImage, deleteImage } from "./demoStore";

const REPO = "https://github.com/leojianliu-dot/calcgrid";

export default function App() {
  const [data, setData] = useState<CalcModel | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [nonce, setNonce] = useState(0); // bump to reload the sample after a reset
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setData(loadModel()); }, [nonce]);

  // CalcGrid emits a new model on every edit; we debounce-save it to localStorage.
  const onChange = (m: CalcModel) => {
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try { saveModel(m); setSaveState("saved"); } catch { setSaveState("error"); }
    }, 400);
  };

  const reset = () => {
    if (window.confirm("重置 Demo？这会清空本机的所有改动。\nReset the demo? This clears all your changes in this browser.")) {
      clearDemo();
      setSaveState("idle");
      setNonce((n) => n + 1);
    }
  };

  return (
    <div className="demo">
      <header className="demo-head">
        <div className="demo-title">
          <h1>CalcGrid</h1>
          <span className="tag">在线试用 · Live demo</span>
        </div>
        <p className="demo-sub">
          一个自研、开源、与持久化无关的网页电子表格组件。<br />
          A self-contained, persistence-agnostic Excel-like grid for React. Everything you type stays in <strong>your browser</strong>.
        </p>
        <div className="demo-actions">
          <button className="act-btn" onClick={reset}>↺ 重置 Demo / Reset</button>
          <a className="btnlink" href={REPO} target="_blank" rel="noopener noreferrer"><button className="act-btn">★ GitHub 源码 / Source</button></a>
        </div>
        <div className="demo-note">
          试试看：双击单元格编辑、输入 <code>=B2+B3</code> 写公式、点 <strong>📝 Note</strong> 加批注或粘贴截图、<strong>Ctrl+Z</strong> 撤销。
          数据仅保存在本机浏览器。<br />
          Tip: double-click to edit, type a formula like <code>=SUM(B2:B3)</code>, add a note/screenshot, undo with Ctrl+Z.
          <strong> On phones</strong>, tap-to-select &amp; double-tap-to-edit work; drag-select / drag-move need a mouse for now.
        </div>
      </header>

      {data ? (
        <CalcGrid
          key={nonce}
          data={data}
          onChange={onChange}
          images={{ upload: uploadImage, fetch: fetchImage, delete: deleteImage }}
          saveState={saveState}
        />
      ) : (
        <div className="meta small">Loading…</div>
      )}

      <footer className="demo-foot">
        First-party, no third-party spreadsheet engine. Notes are sanitized with DOMPurify. ·{" "}
        <a href={REPO} target="_blank" rel="noopener noreferrer">github.com/leojianliu-dot/calcgrid</a>
      </footer>
    </div>
  );
}
