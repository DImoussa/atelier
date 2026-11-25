import type { Card, LineEnd } from './types';

/** Tailles mesurées (en unités monde) de chaque carte rendue. */
export const sizes = new Map<string, { w: number; h: number }>();

export interface Rect { x: number; y: number; w: number; h: number }

export function cardRect(c: Card): Rect {
  const s = sizes.get(c.id);
  return { x: c.x, y: c.y, w: s?.w ?? c.w, h: s?.h ?? 60 };
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const r of rects) { x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y); x2 = Math.max(x2, r.x + r.w); y2 = Math.max(y2, r.y + r.h); }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Point où un segment partant du centre du rectangle vers `toward` sort du rectangle. */
export function clipToRect(r: Rect, toward: { x: number; y: number }, gap = 6) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx !== 0 ? (r.w / 2) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (r.h / 2) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  const len = Math.hypot(dx, dy);
  return { x: cx + dx * t + (dx / len) * gap, y: cy + dy * t + (dy / len) * gap };
}

export type CardLookup = (id: string) => Card | undefined;

/** Calcule les points de début/fin/contrôle d'une ligne. Renvoie null si une extrémité attachée est invisible. */
export function lineGeometry(line: Card, lookup: CardLookup, boardId: string) {
  const { from, to, curve } = line.data as { from: LineEnd; to: LineEnd; curve: { x: number; y: number } };
  const resolve = (e: LineEnd) => {
    if (!e.cardId) return { rect: null as Rect | null, p: { x: e.x, y: e.y } };
    const c = lookup(e.cardId);
    if (!c || c.trashed || c.parent !== boardId) return null;
    const r = cardRect(c);
    return { rect: r, p: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
  };
  const a = resolve(from), b = resolve(to);
  if (!a || !b) return null;
  const mid0 = { x: (a.p.x + b.p.x) / 2, y: (a.p.y + b.p.y) / 2 };
  const cv = curve || { x: 0, y: 0 };
  const curved = Math.abs(cv.x) > 0.5 || Math.abs(cv.y) > 0.5;
  // point par lequel passe la courbe (poignée du milieu)
  const through = { x: mid0.x + cv.x, y: mid0.y + cv.y };
  // point de contrôle quadratique pour passer par `through` à t=0.5
  let ctrl = { x: 2 * through.x - mid0.x, y: 2 * through.y - mid0.y };
  const A = a.rect ? clipToRect(a.rect, curved ? ctrl : b.p) : a.p;
  const B = b.rect ? clipToRect(b.rect, curved ? ctrl : a.p) : b.p;
  const midR = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  if (curved) ctrl = { x: 2 * through.x - midR.x, y: 2 * through.y - midR.y };
  else ctrl = midR;
  const d = curved ? `M${A.x},${A.y} Q${ctrl.x},${ctrl.y} ${B.x},${B.y}` : `M${A.x},${A.y} L${B.x},${B.y}`;
  const handle = curved ? through : midR;
  return { A, B, ctrl, d, handle, curved, rawMid: mid0 };
}

export function arrowHead(tip: { x: number; y: number }, from: { x: number; y: number }, size: number) {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  const a1 = ang + Math.PI - 0.45, a2 = ang + Math.PI + 0.45;
  return `M${tip.x},${tip.y} L${tip.x + Math.cos(a1) * size},${tip.y + Math.sin(a1) * size} L${tip.x + Math.cos(a2) * size},${tip.y + Math.sin(a2) * size} Z`;
}
