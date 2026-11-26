import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  useStore, get, set, mutate, checkpoint, setViewport, maxZ, collectPayload, pastePayload, insertIntoColumn,
  moveToBoard, trashCards, navigate, createCard, updateCard, makeCard, addCardDraft,
} from '../store';
import { registerCanvas, currentVp, screenToWorld, zoomAt, fitToContent, dropAt, clampZoom, DEFAULT_VP } from '../interaction';
import { cardRect, intersects, lineGeometry } from '../geometry';
import { CardView } from './CardView';
import { LinesLayer } from './LinesLayer';
import { insertFiles } from '../files';
import { EDITABLE_TYPES, UNSORTED, BG_COLORS, type Card } from '../types';
import { useBlobUrl } from './cards/MediaCards';
import { Icon } from '../icons';

type Session =
  | { kind: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { kind: 'marquee'; sx: number; sy: number; base: string[] }
  | {
    kind: 'move'; primary: string; cx: number; cy: number; started: boolean; alt: boolean; wasSelected: boolean; additive: boolean;
    ids: string[]; starts: Map<string, { x: number; y: number }>; lineStarts: Map<string, any>;
  }
  | { kind: 'resize'; id: string; sx: number; sw: number; sf: number; started: boolean }
  | { kind: 'lineEnd'; id: string; end: 'from' | 'to'; started: boolean }
  | { kind: 'lineMid'; id: string; started: boolean }
  | { kind: 'connect'; from: string; sx: number; sy: number }
  | { kind: 'pinch'; d0: number; z0: number; m0: { x: number; y: number }; v0: { x: number; y: number } };

const isEditableTarget = (t: EventTarget | null) => {
  const el = t as HTMLElement;
  return !!el?.closest?.('[contenteditable="true"], [contenteditable="plaintext-only"], input, textarea, select, button, a[href], [data-nodrag], audio, video, iframe');
};

export function Canvas() {
  const boardId = useStore(s => s.boardId);
  const cards = useStore(s => s.cards);
  const selection = useStore(s => s.selection);
  const editingId = useStore(s => s.editingId);
  const readOnly = useStore(s => s.readOnly);
  const storedVp = useStore(s => s.viewports[s.boardId]);
  const guides = useStore(s => s.guides) as any;
  const dropTarget = useStore(s => s.dropTarget);
  const vp = storedVp || DEFAULT_VP;
  const board = useStore(s => s.boards[s.boardId]);
  const bgUrl = useBlobUrl(board?.bgImage);
  const bgColor = BG_COLORS.find(c => c.id === (board?.bgColor ?? null))?.value;
  const darkBg = !bgUrl && (board?.bgColor === 'slate' || board?.bgColor === 'night');
  const bgStyle: React.CSSProperties = bgUrl
    ? { backgroundImage: `url("${bgUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : board?.bgColor ? { background: bgColor } : {};
  const ref = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [fileOver, setFileOver] = useState(false);

  const top = useMemo(() => Object.values(cards).filter(c => c.parent === boardId && !c.trashed && c.type !== 'line').sort((a, b) => a.z - b.z), [cards, boardId]);
  const selSet = useMemo(() => new Set(selection), [selection]);

  useLayoutEffect(() => { registerCanvas(ref.current); return () => registerCanvas(null); }, []);

  // Suivi des doigts (écran tactile) pour le zoom au pincement
  const touches = useRef(new Map<number, { x: number; y: number }>());
  useEffect(() => {
    const mv = (e: PointerEvent) => { if (touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); };
    const up = (e: PointerEvent) => { touches.current.delete(e.pointerId); };
    window.addEventListener('pointermove', mv, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => { window.removeEventListener('pointermove', mv, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', up, true); };
  }, []);

  // Vue initiale d'une planche jamais ouverte : on cadre le contenu.
  useEffect(() => {
    if (get().viewports[boardId]) return;
    const r = requestAnimationFrame(() => requestAnimationFrame(() => fitToContent(1)));
    return () => cancelAnimationFrame(r);
  }, [boardId]);

  // Molette : défilement, ctrl+molette / pincement : zoom.
  useEffect(() => {
    const el = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('[data-scroll]')) return;
      e.preventDefault();
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const v = currentVp();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(v.zoom * Math.exp(-e.deltaY * k * 0.0022), e.clientX, e.clientY);
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
        setViewport({ ...v, x: v.x - dx * k, y: v.y - dy * k });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Barre d'espace = mode main
  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !isEditableTarget(e.target) && !e.repeat) { setSpaceDown(true); e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceDown(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const endEditing = () => {
    const s = get();
    if (s.editingId) {
      set({ editingId: null, editPoint: null });
      (document.activeElement as HTMLElement)?.blur?.();
    }
  };

  // ---------------- Pointeur ----------------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('[data-ui]')) return;
    const s = get();
    set({ menu: null });
    const startPan = () => {
      session.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: currentVp().x, vy: currentVp().y };
      setPanning(true);
      attach();
    };
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        // deuxième doigt : on abandonne l'action en cours et on passe en pincement
        detach();
        const [a, b] = [...touches.current.values()];
        const r = ref.current!.getBoundingClientRect();
        const v = currentVp();
        session.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: v.zoom, m0: { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top }, v0: { x: v.x, y: v.y } };
        setMarquee(null);
        set({ guides: { v: [], h: [] } as any, dropTarget: null, columnDrop: null });
        attach();
        return;
      }
    }
    if (e.button === 1 || spaceDown) { e.preventDefault(); startPan(); return; }

    // poignées de ligne
    const lh = target.closest('[data-line-handle]') as HTMLElement | null;
    if (lh && !s.readOnly) {
      const id = lh.dataset.lineId!;
      const which = lh.dataset.lineHandle as 'from' | 'to' | 'mid';
      session.current = which === 'mid' ? { kind: 'lineMid', id, started: false } : { kind: 'lineEnd', id, end: which, started: false };
      e.stopPropagation();
      attach();
      return;
    }
    // point de connexion sur le bord d'une carte : tracer une flèche
    const cn = target.closest('[data-connector]') as HTMLElement | null;
    if (cn && !s.readOnly) {
      e.stopPropagation();
      session.current = { kind: 'connect', from: cn.dataset.connector!, sx: e.clientX, sy: e.clientY };
      attach();
      return;
    }
    // poignée de redimensionnement
    const rh = target.closest('[data-resize]') as HTMLElement | null;
    if (rh && !s.readOnly) {
      const id = rh.dataset.resize!;
      session.current = { kind: 'resize', id, sx: e.clientX, sw: s.cards[id].w, sf: s.cards[id].data?.size || 36, started: false };
      attach();
      return;
    }

    const lineEl = target.closest('[data-line-id]') as HTMLElement | null;
    const cardEl = target.closest('[data-card-id]') as HTMLElement | null;
    const id = lineEl?.dataset.lineId || cardEl?.dataset.cardId;

    if (!id) {
      // fond
      endEditing();
      if (s.readOnly || e.pointerType === 'touch') { set({ selection: [] }); startPan(); return; }
      const w = screenToWorld(e.clientX, e.clientY);
      const base = e.shiftKey || e.metaKey || e.ctrlKey ? s.selection : [];
      if (!base.length) set({ selection: [] });
      session.current = { kind: 'marquee', sx: w.x, sy: w.y, base };
      attach();
      return;
    }
    if (s.readOnly) { startPan(); return; }
    if (isEditableTarget(e.target)) return; // laisser l'édition native
    if (s.editingId && s.editingId !== id) endEditing();
    if (s.editingId === id && !target.closest('[data-card-chrome]')) {
      // on est dans la carte en cours d'édition mais hors zone de texte : on peut la déplacer
    }
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const wasSelected = s.selection.includes(id);
    if (additive) set({ selection: wasSelected ? s.selection.filter(x => x !== id) : [...s.selection, id] });
    else if (!wasSelected) set({ selection: [id] });
    session.current = {
      kind: 'move', primary: id, cx: e.clientX, cy: e.clientY, started: false, alt: e.altKey, wasSelected, additive,
      ids: [], starts: new Map(), lineStarts: new Map(),
    };
    attach();
  };

  const attach = () => {
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const detach = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  };

  const startMove = (m: Extract<Session, { kind: 'move' }>, e: PointerEvent) => {
    const s = get();
    let ids = (s.selection.includes(m.primary) ? s.selection : [m.primary]).filter(id => {
      const c = s.cards[id];
      if (!c || c.trashed) return false;
      return c.parent === s.boardId || s.cards[c.parent]?.type === 'column';
    });
    if (!ids.length) return false;
    const allTop = ids.every(id => s.cards[id].parent === s.boardId);
    if (m.alt && allTop) {
      const orig = ids;
      ids = pastePayload(collectPayload(orig), s.boardId, null, { x: 0, y: 0 });
      m.primary = ids[orig.indexOf(m.primary)] || ids[0];
    } else {
      checkpoint();
    }
    // détacher les cartes des colonnes en conservant leur position à l'écran
    const detachList = ids.filter(id => get().cards[id].parent !== s.boardId);
    let z = maxZ(s.boardId);
    const pos = new Map<string, { x: number; y: number }>();
    for (const id of detachList) {
      const el = document.querySelector(`[data-card-id="${id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      pos.set(id, screenToWorld(r.left, r.top));
    }
    mutate(d => {
      for (const id of ids) {
        const c = d.cards[id];
        if (pos.has(id)) { c.parent = s.boardId; c.x = Math.round(pos.get(id)!.x); c.y = Math.round(pos.get(id)!.y); }
        if (c.type !== 'line') c.z = ++z;
      }
    }, false);
    const st = get();
    m.ids = ids;
    m.starts = new Map(ids.map(id => [id, { x: st.cards[id].x, y: st.cards[id].y }]));
    m.lineStarts = new Map(ids.filter(id => st.cards[id].type === 'line').map(id => [id, JSON.parse(JSON.stringify(st.cards[id].data))]));
    set({ selection: ids, editingId: null });
    return true;
  };

  const onMove = (e: PointerEvent) => {
    const sess = session.current;
    if (!sess) return;
    const s = get();
    const v = currentVp();
    if (sess.kind === 'pan') {
      setViewport({ ...v, x: sess.vx + e.clientX - sess.sx, y: sess.vy + e.clientY - sess.sy });
      return;
    }
    if (sess.kind === 'pinch') {
      const pts = [...touches.current.values()];
      if (pts.length < 2) return;
      const [a, b] = pts;
      const r = ref.current!.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      const z = clampZoom(sess.z0 * d / sess.d0);
      const wx = (sess.m0.x - sess.v0.x) / sess.z0, wy = (sess.m0.y - sess.v0.y) / sess.z0;
      setViewport({ zoom: z, x: m.x - wx * z, y: m.y - wy * z });
      return;
    }
    if (sess.kind === 'marquee') {
      const w = screenToWorld(e.clientX, e.clientY);
      const r = { x: Math.min(sess.sx, w.x), y: Math.min(sess.sy, w.y), w: Math.abs(w.x - sess.sx), h: Math.abs(w.y - sess.sy) };
      if (r.w * v.zoom < 3 && r.h * v.zoom < 3) return;
      setMarquee(r);
      const hit = Object.values(s.cards).filter(c => c.parent === s.boardId && !c.trashed).filter(c => {
        if (c.type === 'line') {
          const g = lineGeometry(c, id => s.cards[id], s.boardId);
          return g && intersects(r, { x: g.handle.x - 2, y: g.handle.y - 2, w: 4, h: 4 });
        }
        return intersects(r, cardRect(c));
      }).map(c => c.id);
      const next = Array.from(new Set([...sess.base, ...hit]));
      if (next.join() !== s.selection.join()) set({ selection: next });
      return;
    }
    if (sess.kind === 'resize') {
      if (!sess.started) { checkpoint(); sess.started = true; }
      const c = s.cards[sess.id];
      const min = c.type === 'color' ? 90 : c.type === 'heading' ? 120 : 160;
      const w = Math.max(min, Math.round(sess.sw + (e.clientX - sess.sx) / v.zoom));
      if (c.type === 'heading' && !e.shiftKey) {
        // un titre s'agrandit en entier : la taille du texte suit la largeur (Maj = largeur seule)
        const size = Math.max(12, Math.min(240, Math.round(sess.sf * w / sess.sw)));
        updateCard(sess.id, d => { d.w = w; d.data.size = size; }, false);
      } else updateCard(sess.id, { w }, false);
      return;
    }
    if (sess.kind === 'connect') {
      if (Math.hypot(e.clientX - sess.sx, e.clientY - sess.sy) < 5) return;
      checkpoint();
      const p = screenToWorld(e.clientX, e.clientY);
      const line = makeCard('line', s.boardId, 0, 0, { from: { cardId: sess.from, x: p.x, y: p.y }, to: { cardId: null, x: Math.round(p.x), y: Math.round(p.y) } });
      line.z = maxZ(s.boardId) + 1;
      mutate(d => { addCardDraft(d, line); }, false);
      set({ selection: [line.id], editingId: null });
      session.current = { kind: 'lineEnd', id: line.id, end: 'to', started: true };
      return;
    }
    if (sess.kind === 'lineEnd' || sess.kind === 'lineMid') {
      if (!sess.started) { checkpoint(); sess.started = true; set({ selection: [sess.id] }); }
      const p = screenToWorld(e.clientX, e.clientY);
      if (sess.kind === 'lineMid') {
        const line = s.cards[sess.id];
        const g = lineGeometry({ ...line, data: { ...line.data, curve: { x: 0, y: 0 } } }, id => s.cards[id], s.boardId);
        if (!g) return;
        let cx = p.x - g.rawMid.x, cy = p.y - g.rawMid.y;
        if (Math.hypot(cx, cy) < 8 / v.zoom) { cx = 0; cy = 0; }
        updateCard(sess.id, c => { c.data.curve = { x: Math.round(cx), y: Math.round(cy) }; }, false);
        return;
      }
      const d = dropAt(e.clientX, e.clientY, new Set([sess.id]), { column: false, board: false });
      let cardId: string | null = null;
      if (d.kind === 'canvas') {
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        for (const el of els) {
          const ce = (el as HTMLElement).closest?.('[data-card-id]') as HTMLElement | null;
          const other = s.cards[sess.id]?.data[sess.end === 'to' ? 'from' : 'to']?.cardId;
          if (ce && s.cards[ce.dataset.cardId!]?.parent === s.boardId && ce.dataset.cardId !== other) { cardId = ce.dataset.cardId!; break; }
        }
      }
      const end = sess.end;
      updateCard(sess.id, c => { c.data[end] = { cardId, x: Math.round(p.x), y: Math.round(p.y) }; }, false);
      if (s.dropTarget !== cardId) set({ dropTarget: cardId });
      return;
    }
    if (sess.kind === 'move') {
      if (!sess.started) {
        if (Math.hypot(e.clientX - sess.cx, e.clientY - sess.cy) < 4) return;
        if (!startMove(sess, e)) { session.current = null; return; }
        sess.started = true;
        set({ dragging: true });
      }
      const st = get();
      let dx = (e.clientX - sess.cx) / v.zoom;
      let dy = (e.clientY - sess.cy) / v.zoom;
      // aimantation sur les autres cartes
      const gv: any[] = [], gh: any[] = [];
      const prim = st.cards[sess.primary];
      if (prim && prim.type !== 'line' && !(e.ctrlKey || e.metaKey)) {
        const s0 = sess.starts.get(sess.primary)!;
        const pr = cardRect(prim);
        const R = { x: s0.x + dx, y: s0.y + dy, w: pr.w, h: pr.h };
        const thr = 6 / v.zoom;
        const others = Object.values(st.cards).filter(c => c.parent === st.boardId && !c.trashed && c.type !== 'line' && !sess.ids.includes(c.id));
        let bestX: any = null, bestY: any = null;
        for (const o of others) {
          const r = cardRect(o);
          const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
          const mxs = [R.x, R.x + R.w / 2, R.x + R.w], mys = [R.y, R.y + R.h / 2, R.y + R.h];
          for (const a of xs) for (const b of mxs) { const diff = a - b; if (Math.abs(diff) < thr && (!bestX || Math.abs(diff) < Math.abs(bestX.diff))) bestX = { diff, at: a, r }; }
          for (const a of ys) for (const b of mys) { const diff = a - b; if (Math.abs(diff) < thr && (!bestY || Math.abs(diff) < Math.abs(bestY.diff))) bestY = { diff, at: a, r }; }
        }
        if (bestX) dx += bestX.diff;
        if (bestY) dy += bestY.diff;
        const F = { x: s0.x + dx, y: s0.y + dy, w: pr.w, h: pr.h };
        if (bestX) gv.push({ x: bestX.at, y1: Math.min(F.y, bestX.r.y) - 20, y2: Math.max(F.y + F.h, bestX.r.y + bestX.r.h) + 20 });
        if (bestY) gh.push({ y: bestY.at, x1: Math.min(F.x, bestY.r.x) - 20, x2: Math.max(F.x + F.w, bestY.r.x + bestY.r.w) + 20 });
      }
      set({ guides: { v: gv, h: gh } as any });
      mutate(d => {
        for (const id of sess.ids) {
          const c = d.cards[id];
          const s0 = sess.starts.get(id)!;
          c.x = Math.round(s0.x + dx); c.y = Math.round(s0.y + dy);
          if (c.type === 'line') {
            const l0 = sess.lineStarts.get(id);
            for (const k of ['from', 'to'] as const) {
              if (!l0[k].cardId || !sess.ids.includes(l0[k].cardId)) {
                if (!l0[k].cardId) c.data[k] = { cardId: null, x: Math.round(l0[k].x + dx), y: Math.round(l0[k].y + dy) };
              }
            }
          }
        }
      }, false);
      // cible de dépôt
      const movingTypes = sess.ids.map(id => st.cards[id]?.type);
      const canColumn = !movingTypes.includes('column') && !movingTypes.includes('line');
      const d = dropAt(e.clientX, e.clientY, new Set(sess.ids), { column: canColumn, board: !movingTypes.includes('line') });
      const dt = d.kind === 'board' ? d.cardId! : d.kind === 'crumb' ? 'crumb:' + d.cardId : d.kind === 'trash' || d.kind === 'unsorted' ? d.kind : null;
      const cd = d.kind === 'column' ? { columnId: d.cardId!, index: d.index! } : null;
      if (dt !== st.dropTarget) set({ dropTarget: dt });
      if (JSON.stringify(cd) !== JSON.stringify(st.columnDrop)) set({ columnDrop: cd });
    }
  };

  const onUp = (e: PointerEvent) => {
    detach();
    const sess = session.current;
    if (sess?.kind === 'pinch' && touches.current.size >= 2) return; // un doigt encore posé sur deux
    session.current = null;
    setPanning(false);
    setMarquee(null);
    if (get().dragging) set({ dragging: false });
    const s = get();
    if (!sess) return;
    if (sess.kind === 'connect') { set({ selection: [sess.from] }); return; }
    if (sess.kind === 'lineEnd' || sess.kind === 'lineMid') {
      set({ dropTarget: null });
      if (!sess.started) set({ selection: [sess.id] });
      return;
    }
    if (sess.kind !== 'move') return;
    if (!sess.started) {
      // simple clic
      const id = sess.primary;
      const c = s.cards[id];
      if (!sess.additive && s.selection.length > 1 && sess.wasSelected) set({ selection: [id] });
      else if (!sess.additive && sess.wasSelected && c && EDITABLE_TYPES.includes(c.type) && c.type !== 'board' && c.type !== 'image' && c.type !== 'link' && s.editingId !== id) {
        set({ editingId: id, editPoint: { x: e.clientX, y: e.clientY } });
      }
      return;
    }
    set({ guides: { v: [], h: [] } as any });
    const { dropTarget, columnDrop } = s;
    set({ dropTarget: null, columnDrop: null });
    if (columnDrop) {
      insertIntoColumn(sess.ids, columnDrop.columnId, columnDrop.index, false);
      set({ selection: sess.ids });
    } else if (dropTarget === 'trash') {
      trashCards(sess.ids);
    } else if (dropTarget?.startsWith('crumb:')) {
      moveToBoard(sess.ids, dropTarget.slice(6));
    } else if (dropTarget === 'unsorted') {
      moveToBoard(sess.ids, UNSORTED);
    } else if (dropTarget && s.cards[dropTarget]?.type === 'board') {
      moveToBoard(sess.ids, s.cards[dropTarget].data.boardId);
    }
  };

  useEffect(() => () => detach(), []);

  // ---------------- Double-clic ----------------
  const onDoubleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-ui]')) return;
    const s = get();
    const lh = target.closest('[data-line-handle="mid"]') as HTMLElement | null;
    if (lh && !s.readOnly) { updateCard(lh.dataset.lineId!, c => { c.data.curve = { x: 0, y: 0 }; }); return; }
    const lineEl = target.closest('[data-line-id]') as HTMLElement | null;
    if (lineEl && !s.readOnly) { set({ editingId: lineEl.dataset.lineId!, selection: [lineEl.dataset.lineId!] }); return; }
    const cardEl = target.closest('[data-card-id]') as HTMLElement | null;
    if (!cardEl) {
      if (s.readOnly) return;
      const p = screenToWorld(e.clientX, e.clientY);
      createCard('note', p.x - 140, p.y - 20);
      return;
    }
    const c = s.cards[cardEl.dataset.cardId!];
    if (!c) return;
    if (c.type === 'board' && !s.readOnly && target.closest('.board-title')) {
      if (s.editingId !== c.id) set({ editingId: c.id, editPoint: { x: e.clientX, y: e.clientY }, selection: [c.id] });
      return;
    }
    if (c.type === 'board') { navigate(c.data.boardId, { readOnly: s.readOnly }); return; }
    if (c.type === 'image') { set({ modal: { kind: 'lightbox', cardId: c.id } }); return; }
    if (s.readOnly) { if (c.type === 'document') set({ modal: { kind: 'document', cardId: c.id } }); return; }
    if (c.type === 'sketch') { set({ modal: { kind: 'sketch', cardId: c.id } }); return; }
    if (c.type === 'document') { set({ modal: { kind: 'document', cardId: c.id } }); return; }
    if (isEditableTarget(e.target) && s.editingId === c.id) return;
    set({ editingId: c.id, editPoint: { x: e.clientX, y: e.clientY }, selection: [c.id] });
  };

  // ---------------- Menu contextuel ----------------
  const onContextMenu = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-ui]')) return;
    if (isEditableTarget(e.target) && get().editingId) return; // menu natif dans le texte (correcteur)
    e.preventDefault();
    const s = get();
    const id = (target.closest('[data-line-id]') as HTMLElement)?.dataset.lineId || (target.closest('[data-card-id]') as HTMLElement)?.dataset.cardId;
    if (id) {
      if (!s.selection.includes(id)) set({ selection: [id] });
      set({ menu: { x: e.clientX, y: e.clientY, target: 'cards' } });
    } else {
      set({ menu: { x: e.clientX, y: e.clientY, target: 'canvas', world: screenToWorld(e.clientX, e.clientY) } });
    }
  };

  // ---------------- Fichiers déposés depuis l'ordinateur ----------------
  const onDragOver = (e: React.DragEvent) => {
    if (get().readOnly) return;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!fileOver) setFileOver(true);
      const d = dropAt(e.clientX, e.clientY, new Set(), { column: true, board: false });
      const cd = d.kind === 'column' ? { columnId: d.cardId!, index: d.index! } : null;
      if (JSON.stringify(cd) !== JSON.stringify(get().columnDrop)) set({ columnDrop: cd });
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    setFileOver(false);
    if (get().readOnly) return;
    e.preventDefault();
    const cd = get().columnDrop;
    set({ columnDrop: null });
    const p = screenToWorld(e.clientX, e.clientY);
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) { await insertFiles(files, { x: p.x - 140, y: p.y - 40 }, cd?.columnId, cd?.index); return; }
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uri) {
      const text = uri.split('\n').filter(l => !l.startsWith('#'))[0] || uri;
      const isLink = /^https?:\/\//i.test(text.trim());
      createCard(isLink ? 'link' : 'note', p.x - 140, p.y - 20, {
        data: isLink ? { url: text.trim() } : { html: `<p>${text.replace(/[<>&]/g, '')}</p>` }, edit: false,
        ...(cd ? { parent: cd.columnId, index: cd.index } : {}),
      });
    }
  };

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : readOnly ? 'grab' : 'default';
  const lines = useMemo(() => Object.values(cards).filter(c => c.parent === boardId && !c.trashed && c.type === 'line'), [cards, boardId]);

  return (
    <div
      ref={ref}
      className={'canvas' + (fileOver ? ' file-over' : '') + (readOnly ? ' readonly' : '') + (darkBg ? ' dark-bg' : '')}
      data-canvas
      style={{ cursor, ...bgStyle }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={e => { if (e.currentTarget === e.target) setFileOver(false); }}
      onDrop={onDrop}
    >
      <div className="world" style={{ transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`, ['--z' as any]: vp.zoom }}>
        {top.map(c => (
          <CardView key={c.id} card={c} selected={selSet.has(c.id)} editing={editingId === c.id} dropping={dropTarget === c.id} />
        ))}
        <LinesLayer lines={lines} />
        {marquee && <div className="marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        {guides.v.map((g: any, i: number) => <div key={'v' + i} className="guide v" style={{ left: g.x, top: g.y1, height: g.y2 - g.y1 }} />)}
        {guides.h.map((g: any, i: number) => <div key={'h' + i} className="guide h" style={{ top: g.y, left: g.x1, width: g.x2 - g.x1 }} />)}
      </div>
      {top.length === 0 && lines.length === 0 && <EmptyHint readOnly={readOnly} />}
      <ZoomControls zoom={vp.zoom} />
    </div>
  );
}

function EmptyHint({ readOnly }: { readOnly: boolean }) {
  const boardId = useStore(s => s.boardId);
  if (readOnly) return <div className="empty-hint"><p>Cette planche est vide.</p></div>;
  return (
    <div className="empty-hint">
      <p className="big">Cette planche est vide</p>
      <p>Glissez une carte depuis la barre d'outils à gauche, déposez des fichiers ici, ou double-cliquez pour écrire une note.</p>
      <button data-ui className="btn" onClick={() => set({ modal: { kind: 'templates', boardId } })}><Icon name="template" size={16} /> Partir d'un modèle</button>
    </div>
  );
}

function ZoomControls({ zoom }: { zoom: number }) {
  return (
    <div className="zoom-controls" data-ui>
      <button title="Dézoomer (Ctrl -)" onClick={() => zoomAt(clampZoom(zoom / 1.25))}><Icon name="minus" size={16} /></button>
      <button className="zoom-pct" title="Revenir à 100 % (Ctrl 0)" onClick={() => zoomAt(1)}>{Math.round(zoom * 100)} %</button>
      <button title="Zoomer (Ctrl +)" onClick={() => zoomAt(clampZoom(zoom * 1.25))}><Icon name="plus" size={16} /></button>
      <button title="Tout afficher (Ctrl 1)" onClick={() => fitToContent(1.5)}><Icon name="fit" size={16} /></button>
    </div>
  );
}
