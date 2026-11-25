import React, { useEffect, useRef, useState } from 'react';
import { get, set, updateData, mutate } from '../../store';
import { Icon } from '../../icons';

type Pt = [number, number];
interface Stroke { points: Pt[]; color: string; size: number; opacity?: number }

export function strokePath(points: Pt[]): string {
  if (!points?.length) return '';
  if (points.length === 1) { const [x, y] = points[0]; return `M${x},${y} L${x + 0.1},${y + 0.1}`; }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[i + 1];
    d += ` Q${x1},${y1} ${((x1 + x2) / 2).toFixed(1)},${((y1 + y2) / 2).toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L${last[0]},${last[1]}`;
  return d;
}

const COLORS = ['#1f2328', '#5d6b78', '#e9643b', '#d9a03f', '#7fa65a', '#3e9e8f', '#4a86c7', '#7c63c4', '#c4588f', '#ffffff'];
const SIZES = [2, 4, 8, 14];
const W = 1000, H = 680;

export function SketchModal({ cardId }: { cardId: string }) {
  const card = get().cards[cardId];
  const [strokes, setStrokes] = useState<Stroke[]>(() => JSON.parse(JSON.stringify(card?.data.strokes || [])));
  const [redoStack, setRedo] = useState<Stroke[][]>([]);
  const [undoStack, setUndo] = useState<Stroke[][]>([]);
  const [tool, setTool] = useState<'pen' | 'marker' | 'eraser'>('pen');
  const [color, setColor] = useState('#1f2328');
  const [size, setSize] = useState(4);
  const svgRef = useRef<SVGSVGElement>(null);
  const cur = useRef<Stroke | null>(null);
  const [, force] = useState(0);
  const dims = { w: card?.data.width && card.data.strokes?.length ? card.data.width : W, h: card?.data.height && card.data.strokes?.length ? card.data.height : H };

  const toLocal = (e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [+p.x.toFixed(1), +p.y.toFixed(1)];
  };
  const pushUndo = () => { setUndo(u => [...u, strokes]); setRedo([]); };

  const eraseAt = (p: Pt) => {
    const rad = 10;
    const keep = strokes.filter(s => !s.points.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < rad + s.size / 2));
    if (keep.length !== strokes.length) setStrokes(keep);
  };

  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = toLocal(e);
    pushUndo();
    if (tool === 'eraser') { eraseAt(p); cur.current = { points: [], color: '', size: 0 }; return; }
    cur.current = { points: [p], color, size: tool === 'marker' ? size * 3 : size, opacity: tool === 'marker' ? 0.35 : 1 };
    force(x => x + 1);
  };
  const move = (e: React.PointerEvent) => {
    if (!cur.current) return;
    const p = toLocal(e);
    if (tool === 'eraser') { eraseAt(p); return; }
    const pts = cur.current.points;
    const l = pts[pts.length - 1];
    if (Math.hypot(l[0] - p[0], l[1] - p[1]) < 1.5) return;
    pts.push(p);
    force(x => x + 1);
  };
  const up = () => {
    const stroke = cur.current;
    cur.current = null;
    if (stroke && tool !== 'eraser' && stroke.points.length) setStrokes(s => [...s, stroke]);
  };

  const undo = () => { if (!undoStack.length) return; setRedo(r => [strokes, ...r]); setStrokes(undoStack[undoStack.length - 1]); setUndo(u => u.slice(0, -1)); };
  const redo = () => { if (!redoStack.length) return; setUndo(u => [...u, strokes]); setStrokes(redoStack[0]); setRedo(r => r.slice(1)); };

  const close = (save: boolean) => {
    if (save) updateData(cardId, { strokes, width: dims.w, height: dims.h });
    else if (!(card?.data.strokes || []).length && !strokes.length) mutate(d => { delete d.cards[cardId]; }, false);
    if (save && !strokes.length && !(card?.data.strokes || []).length) mutate(d => { delete d.cards[cardId]; }, false);
    set({ modal: null });
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); e.stopPropagation(); redo(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  if (!card) return null;
  const all = cur.current && tool !== 'eraser' ? [...strokes, cur.current] : strokes;
  return (
    <div className="modal-backdrop" data-ui>
      <div className="sketch-modal">
        <div className="sketch-tools">
          <button className={'icon-btn' + (tool === 'pen' ? ' active' : '')} title="Stylo" onClick={() => setTool('pen')}><Icon name="pen" /></button>
          <button className={'icon-btn' + (tool === 'marker' ? ' active' : '')} title="Surligneur" onClick={() => setTool('marker')}><Icon name="marker" /></button>
          <button className={'icon-btn' + (tool === 'eraser' ? ' active' : '')} title="Gomme" onClick={() => setTool('eraser')}><Icon name="eraser" /></button>
          <span className="tb-sep" />
          {COLORS.map(c => <button key={c} className={'color-dot' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => { setColor(c); if (tool === 'eraser') setTool('pen'); }} />)}
          <span className="tb-sep" />
          {SIZES.map(s => (
            <button key={s} className={'icon-btn small' + (s === size ? ' active' : '')} title={`Taille ${s}`} onClick={() => setSize(s)}>
              <span className="size-dot" style={{ width: s + 2, height: s + 2 }} />
            </button>
          ))}
          <span className="tb-sep" />
          <button className="icon-btn" title="Annuler (Ctrl Z)" disabled={!undoStack.length} onClick={undo}><Icon name="undo" /></button>
          <button className="icon-btn" title="Rétablir (Ctrl Maj Z)" disabled={!redoStack.length} onClick={redo}><Icon name="redo" /></button>
          <button className="link-btn" onClick={() => { pushUndo(); setStrokes([]); }}>Tout effacer</button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={() => close(false)}>Annuler</button>
          <button className="btn primary" onClick={() => close(true)}>Terminé</button>
        </div>
        <div className="sketch-area">
          <svg ref={svgRef} viewBox={`0 0 ${dims.w} ${dims.h}`} className={'sketch-svg tool-' + tool}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <rect width={dims.w} height={dims.h} fill="#fff" />
            {all.map((s, i) => <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} strokeOpacity={s.opacity ?? 1} fill="none" strokeLinecap="round" strokeLinejoin="round" />)}
          </svg>
        </div>
      </div>
    </div>
  );
}
