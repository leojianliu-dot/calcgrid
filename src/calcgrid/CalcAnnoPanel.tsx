import { useEffect, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { numToColLetter } from "./calc";
import type { CalcAnnotation } from "./types";

const DEFAULT_W = 340, DEFAULT_H = 380, MIN_W = 220, MIN_H = 160;

// The note is rendered back into a contentEditable, so it MUST be sanitized on
// both write and read — it's shared across the whole team (stored-XSS otherwise).
// Allow only the lightweight formatting the toolbar produces (bold / italic / red).
const NOTE_TAGS = ["b", "strong", "i", "em", "u", "br", "span", "font", "div", "p"];
const cleanNote = (html: string) => DOMPurify.sanitize(html, { ALLOWED_TAGS: NOTE_TAGS, ALLOWED_ATTR: ["style", "color"] });

// A non-blocking, draggable + corner-resizable panel for one cell annotation
// (a note and/or a screenshot). Position/size/open-state are persisted by the
// parent via onPatch (history:false — these are view tweaks, not undo steps).
// Image I/O is injected (uploadImage / fetchImage) so this component has no
// direct API dependency — it's part of the persistence-agnostic CalcGrid module.
export default function CalcAnnoPanel({
  anno,
  index,
  num,
  uploadImage,
  fetchImage,
  onPatch,
  onDelete,
  onClose,
}: {
  anno: CalcAnnotation;
  index: number;
  num: number; // serial number shown on the button + panel (so multiple unnamed ones are distinguishable)
  uploadImage: (file: File) => Promise<number>;
  fetchImage: (id: number) => Promise<{ contentType: string; dataBase64: string }>;
  onPatch: (patch: Partial<CalcAnnotation>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const noteRef = useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [title, setTitle] = useState(anno.title ?? "");
  const [editingTitle, setEditingTitle] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);

  const w0 = anno.w ?? DEFAULT_W, h0 = anno.h ?? DEFAULT_H;
  const clampX = (x: number) => Math.min(Math.max(8, x), Math.max(8, window.innerWidth - 60));
  const clampY = (y: number) => Math.min(Math.max(8, y), Math.max(8, window.innerHeight - 60));
  const [pos, setPos] = useState({
    x: clampX(anno.x ?? window.innerWidth - w0 - 24),
    y: clampY(anno.y ?? 76 + index * 36),
  });
  const [size, setSize] = useState({ w: w0, h: h0 });

  // Keep local view-state in sync with the shared model when it changes outside an
  // active drag (e.g. an undo of a move, or another user moving it).
  useEffect(() => { if (anno.x != null && anno.y != null) setPos({ x: clampX(anno.x), y: clampY(anno.y) }); }, [anno.x, anno.y]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (anno.w != null && anno.h != null) setSize({ w: anno.w, h: anno.h }); }, [anno.w, anno.h]);
  useEffect(() => { setTitle(anno.title ?? ""); }, [anno.title]);

  // Load the screenshot bytes (if any).
  useEffect(() => {
    let cancel = false;
    if (anno.imageId) {
      fetchImage(anno.imageId)
        .then((d) => { if (!cancel) setUrl(`data:${d.contentType};base64,${d.dataBase64}`); })
        .catch(() => { /* ignore */ });
    } else {
      setUrl(null);
    }
    return () => { cancel = true; };
  }, [anno.imageId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialise the note's HTML once per annotation (uncontrolled contentEditable), sanitized.
  useEffect(() => {
    if (noteRef.current) noteRef.current.innerHTML = cleanNote(anno.note || "");
  }, [anno.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const startDrag = (e: React.MouseEvent) => {
    // Don't start a drag from the close button or the (editing) title input — and
    // no preventDefault, so a double-click on the title still registers. The bar
    // has user-select:none, so dragging won't select text.
    if ((e.target as HTMLElement).closest("button, input")) return;
    const sx = pos.x, sy = pos.y, mx = e.clientX, my = e.clientY;
    let moved = false, nx = sx, ny = sy;
    const move = (ev: MouseEvent) => {
      if (!moved && (Math.abs(ev.clientX - mx) > 3 || Math.abs(ev.clientY - my) > 3)) moved = true;
      if (moved) { nx = clampX(sx + (ev.clientX - mx)); ny = clampY(sy + (ev.clientY - my)); setPos({ x: nx, y: ny }); }
    };
    const end = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); if (moved) onPatch({ x: nx, y: ny }); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const sw = size.w, sh = size.h, mx = e.clientX, my = e.clientY;
    let nw = sw, nh = sh;
    const move = (ev: MouseEvent) => { nw = Math.max(MIN_W, sw + (ev.clientX - mx)); nh = Math.max(MIN_H, sh + (ev.clientY - my)); setSize({ w: nw, h: nh }); };
    const end = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); onPatch({ w: nw, h: nh }); };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
  };

  const onBodyPaste = async (e: React.ClipboardEvent) => {
    const file = Array.from(e.clipboardData.files || []).find((f) => f.type.startsWith("image/"));
    if (!file) return; // let text paste fall through (e.g. into the note)
    e.preventDefault();
    const dataUrl: string = await new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = rej;
      fr.readAsDataURL(file);
    });
    try {
      const imageId = await uploadImage(file); // host wires this to the API + sheet id

      setUrl(dataUrl);
      onPatch({ imageId });
    } catch {
      alert("Sorry — that screenshot could not be uploaded. Please try again.");
    }
  };

  const fmt = (cmd: string, val?: string) => { noteRef.current?.focus(); document.execCommand(cmd, false, val); };
  const cell = `${numToColLetter(anno.c)}${anno.r}`;

  return (
    <div className="anno-panel" style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }} onPaste={onBodyPaste}>
      <div className="anno-bar" onMouseDown={startDrag}>
        <span className="anno-cell">{cell}</span>
        <span className="anno-num">#{num}</span>
        {editingTitle ? (
          <input
            className="anno-title-edit"
            autoFocus
            placeholder="Title"
            value={title}
            onChange={(e) => { setTitle(e.target.value); onPatch({ title: e.target.value }); }}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); setEditingTitle(false); } }}
          />
        ) : (
          <span
            className={`anno-title-text${title ? "" : " untitled"}`}
            title="Double-click to rename"
            onDoubleClick={() => setEditingTitle(true)}
          >
            {title || "Untitled"}
          </span>
        )}
        <button className="anno-x" title="Close (keeps the note on the sheet)" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>✕</button>
      </div>

      <div className="anno-body">
        {anno.imageId ? (
          url ? <img className="anno-img" src={url} alt={title || "Screenshot"} /> : <div className="anno-imgph">Loading image…</div>
        ) : (
          <div className="anno-drop">Paste a screenshot here (Ctrl+V) — optional</div>
        )}

        <div className="anno-notetools">
          <button title="Bold" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("bold")}><b>B</b></button>
          <button title="Red text" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("foreColor", "#dc2626")} style={{ color: "#dc2626" }}>A</button>
          <button title="Black text" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt("foreColor", "#111210")}>A</button>
        </div>
        <div
          ref={noteRef}
          className="anno-note"
          contentEditable
          data-ph="Type a note…"
          suppressContentEditableWarning
          onBlur={() => onPatch({ note: cleanNote(noteRef.current?.innerHTML || "") })}
        />
      </div>

      <div className="anno-foot">
        {confirmDel ? (
          <>
            <span className="anno-confirm">Delete this note?</span>
            <button className="act-btn anno-del" onClick={onDelete}>Delete</button>
            <button className="act-btn" onClick={() => setConfirmDel(false)}>Cancel</button>
          </>
        ) : (
          <button className="act-btn" title="Delete this note" onClick={() => setConfirmDel(true)}>Delete</button>
        )}
        <span style={{ flex: 1 }} />
      </div>

      <span className="anno-resize" title="Drag to resize" onMouseDown={startResize} />
    </div>
  );
}
