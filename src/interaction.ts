import { create } from 'zustand';
import { get, set, setViewport, topCardsOf, createCard, mutate, maxZ, insertIntoColumn, childrenOf, checkpoint } from './store';
import { boundsOf, cardRect, lineGeometry } from './geometry';
import type { CardType, Viewport } from './types';
import { UNSORTED } from './types';
import { insertFiles, pickFiles } from './files';

let canvasEl: HTMLElement | null = null;
export function registerCanvas(el: HTMLElement | null) { canvasEl = el; }
export function getCanvas() { return canvasEl; }

export const DEFAULT_VP: Viewport = { x: 0, y: 0, zoom: 1 };
export function currentVp(): Viewport {
  const s = get();
  return s.viewports[s.boardId] || DEFAULT_VP;
}

export function screenToWorld(clientX: number, clientY: number) {
  const r = canvasEl?.getBoundingClientRect() || { left: 0, top: 0 } as DOMRect;
  const vp = currentVp();
  return { x: (clientX - r.left - vp.x) / vp.zoom, y: (clientY - r.top - vp.y) / vp.zoom };
}

export function viewCenterWorld() {
  const r = canvasEl?.getBoundingClientRect();
  if (!r) return { x: 200, y: 200 };
  return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
}

export const clampZoom = (z: number) => Math.min(4, Math.max(0.1, z));

export function zoomAt(newZoom: number, clientX?: number, clientY?: number) {
  const r = canvasEl?.getBoundingClientRect();
  if (!r) return;
  const vp = currentVp();
  const z = clampZoom(newZoom);
  const px = (clientX ?? r.left + r.width / 2) - r.left;
  const py = (clientY ?? r.top + r.height / 2) - r.top;
  setViewport({ zoom: z, x: px - (px - vp.x) * (z / vp.zoom), y: py - (py - vp.y) * (z / vp.zoom) });
}

export function contentBounds(boardId = get().boardId) {
  const s = get();
  const rects = topCardsOf(boardId).map(c => {
    if (c.type === 'line') {
      const g = lineGeometry(c, id => s.cards[id], boardId);
      if (!g) return null;
      return { x: Math.min(g.A.x, g.B.x, g.handle.x), y: Math.min(g.A.y, g.B.y, g.handle.y), w: Math.abs(g.A.x - g.B.x) + 1, h: Math.abs(g.A.y - g.B.y) + 1 };
    }
    return cardRect(c);
  }).filter(Boolean) as any[];
  return boundsOf(rects);
}

export function fitToContent(maxZoom = 1) {
  const r = canvasEl?.getBoundingClientRect();
  if (!r) return;
  const b = contentBounds();
  if (!b) { setViewport({ x: r.width / 2 - 300, y: 120, zoom: 1 }); return; }
  const pad = 80;
  const z = clampZoom(Math.min(maxZoom, (r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)));
  setViewport({ zoom: z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z });
}

/** Cadre la vue sur les cartes sélectionnées. */
export function zoomToSelection() {
  const r = canvasEl?.getBoundingClientRect();
  const s = get();
  const rects = s.selection.map(id => s.cards[id]).filter(c => c && c.parent === s.boardId && c.type !== 'line').map(cardRect);
  const b = boundsOf(rects);
  if (!r || !b) return;
  const pad = 100;
  const z = clampZoom(Math.min(2, (r.width - pad * 2) / Math.max(b.w, 1), (r.height - pad * 2) / Math.max(b.h, 1)));
  setViewport({ zoom: z, x: r.width / 2 - (b.x + b.w / 2) * z, y: r.height / 2 - (b.y + b.h / 2) * z });
}

export function centerOn(id: string) {
  const r = canvasEl?.getBoundingClientRect();
  const c = get().cards[id];
  if (!r || !c) return;
  const vp = currentVp();
  const cr = cardRect(c);
  const z = Math.max(vp.zoom, 0.6);
  setViewport({ zoom: z, x: r.width / 2 - (cr.x + cr.w / 2) * z, y: r.height / 2 - (cr.y + cr.h / 2) * z });
}

/** Position libre proche du centre de la vue pour une nouvelle carte. */
export function freeSpotNearCenter(w = 280, h = 140) {
  const c = viewCenterWorld();
  const x0 = c.x - w / 2, y0 = c.y - h / 2;
  const taken = topCardsOf(get().boardId).filter(k => k.type !== 'line').map(cardRect);
  const gap = 16;
  const free = (x: number, y: number) => !taken.some(r => x < r.x + r.w + gap && x + w + gap > r.x && y < r.y + r.h + gap && y + h + gap > r.y);
  if (free(x0, y0)) return { x: x0, y: y0 };
  // recherche en spirale d'un emplacement libre autour du centre
  const step = 40;
  for (let ring = 1; ring < 40; ring++) {
    for (let i = -ring; i <= ring; i++) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const x = x0 + dx * step, y = y0 + dy * step;
        if (free(x, y)) return { x, y };
      }
    }
  }
  return { x: x0, y: y0 };
}

// ---------- Cible de dépôt sous le pointeur ----------
export function cardIdsUp(el: Element | null): string[] {
  const out: string[] = [];
  let cur = el;
  while (cur) {
    const id = (cur as HTMLElement).dataset?.cardId;
    if (id) out.push(id);
    cur = cur.parentElement;
  }
  return out;
}

export interface DropInfo { kind: 'trash' | 'unsorted' | 'board' | 'column' | 'canvas' | 'none' | 'crumb'; cardId?: string; index?: number }

export function dropAt(clientX: number, clientY: number, moving: Set<string>, accept: { column: boolean; board: boolean }): DropInfo {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    if ((el as HTMLElement).closest?.('[data-ghost]')) continue;
    const dz = (el as HTMLElement).closest?.('[data-drop]') as HTMLElement | null;
    if (dz) {
      const v = dz.dataset.drop!;
      if (v.startsWith('crumb:')) return { kind: 'crumb' as any, cardId: v.slice(6) };
      return { kind: v as any };
    }
    const ids = cardIdsUp(el);
    if (ids.some(id => moving.has(id))) continue;
    if (ids.length) {
      const s = get();
      // on cherche la carte la plus proche qui accepte le dépôt
      for (const id of ids) {
        const c = s.cards[id];
        if (!c) continue;
        if (c.type === 'column' && accept.column) return { kind: 'column', cardId: id, index: columnIndexAt(id, clientY, moving) };
        if (c.type === 'board' && accept.board && c.parent === s.boardId) return { kind: 'board', cardId: id };
      }
      return { kind: 'canvas' };
    }
    if ((el as HTMLElement).closest?.('[data-canvas]')) return { kind: 'canvas' };
  }
  return { kind: 'none' };
}

export function columnIndexAt(columnId: string, clientY: number, moving: Set<string>) {
  const col = document.querySelector(`[data-card-id="${columnId}"]`);
  if (!col) return 0;
  const kids = Array.from(col.querySelectorAll(':scope [data-col-child]')) as HTMLElement[];
  const list = kids.filter(k => k.dataset.colChild === columnId && !moving.has(k.dataset.cardId!));
  let i = 0;
  for (const k of list) {
    const r = k.getBoundingClientRect();
    if (clientY > r.top + r.height / 2) i++;
  }
  return i;
}

// ---------- Glisser depuis la barre d'outils / le panneau À trier ----------
export interface Ghost { x: number; y: number; label: string; icon: string; active: boolean }
export const useGhost = create<{ ghost: Ghost | null }>(() => ({ ghost: null }));

type GhostSource = { kind: 'tool'; type: CardType | 'upload' } | { kind: 'existing'; cardId: string };

export function startGhostDrag(e: React.PointerEvent, src: GhostSource, label: string, icon: string, onClick: () => void) {
  if (e.button !== 0 || get().readOnly) return;
  const sx = e.clientX, sy = e.clientY;
  let active = false;
  const moving = new Set<string>(src.kind === 'existing' ? [src.cardId] : []);
  const accept = { column: !(src.kind === 'tool' && (src.type === 'column' || src.type === 'line')) && !(src.kind === 'existing' && ['column', 'line'].includes(get().cards[src.cardId]?.type)), board: false };
  const move = (ev: PointerEvent) => {
    if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) active = true;
    if (!active) return;
    useGhost.setState({ ghost: { x: ev.clientX, y: ev.clientY, label, icon, active } });
    const d = dropAt(ev.clientX, ev.clientY, moving, accept);
    set({ columnDrop: d.kind === 'column' ? { columnId: d.cardId!, index: d.index! } : null });
  };
  const up = async (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    useGhost.setState({ ghost: null });
    set({ columnDrop: null });
    if (!active) { onClick(); return; }
    const d = dropAt(ev.clientX, ev.clientY, moving, accept);
    if (d.kind !== 'canvas' && d.kind !== 'column') return;
    const p = screenToWorld(ev.clientX, ev.clientY);
    if (src.kind === 'tool') {
      const t = src.type as any;
      if (t === 'audio') { set({ modal: { kind: 'record', at: { x: p.x - 140, y: p.y - 40 } } }); return; }
      if (t === 'upload' || t === 'image') {
        const files = await pickFiles(t === 'image' ? 'image/*' : '*/*');
        if (files.length) insertFiles(files, { x: p.x - 140, y: p.y - 40 }, d.kind === 'column' ? d.cardId : undefined, d.index);
        return;
      }
      const w = ({ board: 120, column: 300, heading: 420, color: 130, table: 420, document: 210 } as any)[t] || 280;
      createCard(t, t === 'line' ? p.x : p.x - w / 2, t === 'line' ? p.y : p.y - 24, d.kind === 'column' ? { parent: d.cardId, index: d.index } : {});
    } else {
      const id = src.cardId;
      if (d.kind === 'column') { insertIntoColumn([id], d.cardId!, d.index!); }
      else {
        const s = get();
        const c = s.cards[id];
        const w = c?.w || 280;
        mutate(dr => { const k = dr.cards[id]; if (!k) return; k.parent = s.boardId; k.x = Math.round(p.x - w / 2); k.y = Math.round(p.y - 20); k.z = maxZ(s.boardId) + 1; });
      }
      set({ selection: [id] });
    }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/** Ajoute une carte du type donné au centre de la vue (clic sur un outil). */
export async function addAtCenter(type: CardType | 'upload' | 'audio') {
  if (get().readOnly) return;
  if (type === 'audio') { set({ modal: { kind: 'record', at: null } }); return; }
  if (type === 'upload' || type === 'image') {
    const files = await pickFiles(type === 'image' ? 'image/*' : '*/*');
    if (files.length) { const p = freeSpotNearCenter(); insertFiles(files, p); }
    return;
  }
  const w = ({ board: 120, column: 300, heading: 420, color: 130, table: 420, document: 210, line: 0 } as any)[type] ?? 280;
  const p = type === 'line' ? viewCenterWorld() : freeSpotNearCenter(w);
  createCard(type, p.x, p.y);
}

export { UNSORTED, childrenOf, checkpoint };
