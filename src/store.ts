import { create } from 'zustand';
import { produce, Draft } from 'immer';
import {
  Board, Card, CardType, Doc, Settings, Viewport, ROOT_ID, UNSORTED, DEFAULT_W, BOARD_COLORS,
} from './types';
import { kvGet, kvSet, blobDel } from './db';
import { cardRect, lineGeometry } from './geometry';
import { htmlToText } from './sanitize';

export type Panel = null | 'unsorted' | 'trash' | 'search';
export type Modal =
  | null
  | { kind: 'sketch'; cardId: string }
  | { kind: 'document'; cardId: string }
  | { kind: 'lightbox'; cardId: string }
  | { kind: 'crop'; cardId: string }
  | { kind: 'record'; at?: { x: number; y: number } | null }
  | { kind: 'share' }
  | { kind: 'settings' }
  | { kind: 'shortcuts' }
  | { kind: 'icon'; boardId: string }
  | { kind: 'move'; ids: string[] }
  | { kind: 'templates'; boardId: string };

export interface Menu { x: number; y: number; target: 'canvas' | 'cards'; world?: { x: number; y: number } }

export interface State extends Doc {
  loaded: boolean;
  boardId: string;
  readOnly: boolean;
  selection: string[];
  editingId: string | null;
  editPoint: { x: number; y: number } | null;
  viewports: Record<string, Viewport>;
  settings: Settings;
  past: Doc[];
  future: Doc[];
  dropTarget: string | null;
  columnDrop: { columnId: string; index: number } | null;
  guides: { v: number[]; h: number[] };
  panel: Panel;
  modal: Modal;
  menu: Menu | null;
  sizeTick: number;
  flashId: string | null;
  toast: string | null;
  dragging: boolean;
}

const emptyDoc = (): Doc => ({
  boards: { [ROOT_ID]: { id: ROOT_ID, title: 'Accueil', icon: '🏠', color: '#2f3a45', createdAt: Date.now() } },
  cards: {},
});

export const useStore = create<State>(() => ({
  ...emptyDoc(),
  loaded: false,
  boardId: ROOT_ID,
  readOnly: false,
  selection: [],
  editingId: null,
  editPoint: null,
  viewports: {},
  settings: { userName: 'Moi', theme: 'light' },
  past: [],
  future: [],
  dropTarget: null,
  columnDrop: null,
  guides: { v: [], h: [] },
  panel: null,
  modal: null,
  menu: null,
  sizeTick: 0,
  flashId: null,
  toast: null,
  dragging: false,
}));

export const get = () => useStore.getState();
export const set = (p: Partial<State>) => useStore.setState(p);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// ---------- Historique ----------
const MAX_HISTORY = 150;
const docOf = (s: State): Doc => ({ boards: s.boards, cards: s.cards });

/** Applique une modification du document. history=false pour les modifs en direct (glisser). */
export function mutate(fn: (d: Draft<Doc>) => void, history = true) {
  const s = get();
  if (s.readOnly) return;
  const prev = docOf(s);
  const next = produce(prev, fn);
  if (next === prev) return;
  if (history) set({ ...next, past: [...s.past.slice(-MAX_HISTORY), prev], future: [] });
  else set({ ...next });
}

/** Enregistre l'état courant dans l'historique (avant une série de modifs en direct). */
export function checkpoint() {
  const s = get();
  if (s.readOnly) return;
  set({ past: [...s.past.slice(-MAX_HISTORY), docOf(s)], future: [] });
}

export function undo() {
  const s = get();
  if (!s.past.length) return;
  const prev = s.past[s.past.length - 1];
  set({ ...prev, past: s.past.slice(0, -1), future: [docOf(s), ...s.future], editingId: null });
  cleanSelection();
}
export function redo() {
  const s = get();
  if (!s.future.length) return;
  const nxt = s.future[0];
  set({ ...nxt, future: s.future.slice(1), past: [...s.past, docOf(s)], editingId: null });
  cleanSelection();
}
function cleanSelection() {
  const s = get();
  set({ selection: s.selection.filter(id => s.cards[id] && !s.cards[id].trashed) });
}

// ---------- Persistance ----------
let saveTimer: any = null;
let lastSaved: any = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}
export function flushSave() {
  clearTimeout(saveTimer);
  const s = get();
  if (!s.loaded || s.readOnly && false) return;
  const payload = { boards: s.boards, cards: s.cards, settings: s.settings, viewports: s.viewports, v: 1 };
  if (lastSaved && lastSaved.boards === s.boards && lastSaved.cards === s.cards && lastSaved.settings === s.settings && lastSaved.viewports === s.viewports) return;
  lastSaved = payload;
  if (hooks.saveTarget) { hooks.saveTarget(payload); return; }
  kvSet('doc', payload).catch(err => { console.error(err); toast('Erreur de sauvegarde locale'); });
  hooks.afterSave?.(payload);
}

/** Points d'accroche pour la synchronisation en ligne (voir cloud.ts). */
export const hooks: { saveTarget: null | ((p: any) => void); afterSave: null | ((p: any) => void); forceReadOnly: boolean } = { saveTarget: null, afterSave: null, forceReadOnly: false };

/** Remplace le document affiché par une version venue du serveur, sans créer d'entrée d'annulation. */
export function applyRemote(doc: { boards: any; cards: any; settings?: any; viewports?: any }) {
  const s = get();
  const cards = { ...doc.cards };
  if (s.editingId && s.cards[s.editingId]) cards[s.editingId] = s.cards[s.editingId];
  const next: any = { boards: doc.boards, cards };
  if (doc.settings) next.settings = { ...s.settings, ...doc.settings };
  if (doc.viewports) next.viewports = { ...s.viewports, ...doc.viewports };
  lastSaved = { boards: next.boards, cards: next.cards, settings: next.settings || s.settings, viewports: next.viewports || s.viewports };
  set(next);
  if (!hooks.saveTarget) kvSet('doc', { ...lastSaved, v: 1 }).catch(console.error);
  if (!next.boards[s.boardId]) applyHash();
}

export async function loadDoc(seed: (d: Doc) => void, preset?: any) {
  let saved: any = preset || null;
  if (!preset) try { saved = await kvGet('doc'); } catch (e) { console.error(e); }
  if (saved && saved.boards && saved.cards) {
    set({ boards: saved.boards, cards: saved.cards, settings: { ...get().settings, ...(saved.settings || {}) }, viewports: saved.viewports || {}, loaded: true });
    lastSaved = { boards: saved.boards, cards: saved.cards, settings: get().settings, viewports: get().viewports };
  } else {
    const d = produce(emptyDoc(), seed);
    set({ ...d, loaded: true });
    flushSave();
  }
  useStore.subscribe((s, p) => {
    // une note ou un lien laissé vide disparaît à la fin de l'édition
    if (p.editingId && s.editingId !== p.editingId) {
      const c = s.cards[p.editingId];
      const emptyNote = c && c.type === 'note' && !(c.data.html || '').replace(/<(?!img)[^>]*>|&nbsp;|\s/g, '');
      const emptyLink = c && c.type === 'link' && !c.data.url;
      if (emptyNote || emptyLink) {
        const id = c.id;
        queueMicrotask(() => {
          const st = get();
          if (st.cards[id] && st.editingId !== id) set({ cards: Object.fromEntries(Object.entries(st.cards).filter(([k]) => k !== id)), selection: st.selection.filter(x => x !== id) });
        });
      }
    }
    if (s.boards !== p.boards || s.cards !== p.cards || s.settings !== p.settings || s.viewports !== p.viewports) scheduleSave();
  });
  window.addEventListener('beforeunload', flushSave);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
}

// ---------- Utilitaires ----------
let toastTimer: any;
export function toast(msg: string) {
  clearTimeout(toastTimer);
  set({ toast: msg });
  toastTimer = setTimeout(() => set({ toast: null }), 2600);
}

export function liveCards(s: State = get()) {
  return Object.values(s.cards).filter(c => !c.trashed);
}

export function childrenOf(parent: string, s: State | Doc = get()) {
  return Object.values(s.cards).filter(c => c.parent === parent && !c.trashed).sort((a, b) => a.order - b.order);
}

export function topCardsOf(boardId: string, s: State | Doc = get()) {
  return Object.values(s.cards).filter(c => c.parent === boardId && !c.trashed);
}

export function maxZ(boardId: string) {
  let z = 0;
  for (const c of Object.values(get().cards)) if (c.parent === boardId && c.z > z) z = c.z;
  return z;
}

/** Compte le contenu d'une planche : nombre de planches et de cartes (lignes exclues). */
export function boardCounts(boardId: string, doc: Doc) {
  let boards = 0, cards = 0;
  for (const c of Object.values(doc.cards)) {
    if (c.trashed || c.type === 'line') continue;
    let p = c.parent;
    if (p !== boardId) {
      const parent = doc.cards[p];
      if (!parent || parent.type !== 'column' || parent.parent !== boardId || parent.trashed) continue;
    }
    if (c.type === 'board') boards++; else cards++;
  }
  return { boards, cards };
}

export function countLabel(boardId: string, doc: Doc) {
  const { boards, cards } = boardCounts(boardId, doc);
  const parts: string[] = [];
  if (boards) parts.push(`${boards} planche${boards > 1 ? 's' : ''}`);
  if (cards || !boards) parts.push(`${cards} carte${cards > 1 ? 's' : ''}`);
  return parts.join(', ');
}

/** Planche qui contient une carte (en remontant les colonnes). */
export function boardOfCard(c: Card, doc: Doc): string {
  let cur: Card | undefined = c;
  let guard = 0;
  while (cur && guard++ < 50) {
    if (doc.boards[cur.parent] || cur.parent === UNSORTED) return cur.parent;
    cur = doc.cards[cur.parent];
  }
  return ROOT_ID;
}

/** Carte "planche" qui pointe vers boardId. */
export function boardCardFor(boardId: string, doc: Doc): Card | undefined {
  return Object.values(doc.cards).find(c => c.type === 'board' && c.data.boardId === boardId);
}

/** Chemin Accueil → ... → boardId */
export function boardPath(boardId: string, doc: Doc): Board[] {
  const path: Board[] = [];
  let cur = boardId;
  let guard = 0;
  while (cur && guard++ < 50) {
    const b = doc.boards[cur];
    if (!b) break;
    path.unshift(b);
    if (cur === ROOT_ID) break;
    const bc = boardCardFor(cur, doc);
    if (!bc) break;
    const parent = boardOfCard(bc, doc);
    if (parent === UNSORTED) { path.unshift({ id: UNSORTED, title: 'À trier', icon: '', color: '', createdAt: 0 }); break; }
    cur = parent;
  }
  if (path[0]?.id !== ROOT_ID && path[0]?.id !== UNSORTED && doc.boards[ROOT_ID]) path.unshift(doc.boards[ROOT_ID]);
  return path;
}

/** Planches atteignables (non supprimées). */
export function reachableBoards(doc: Doc): Set<string> {
  const out = new Set<string>([ROOT_ID]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Object.values(doc.cards)) {
      if (c.type !== 'board' || c.trashed || out.has(c.data.boardId)) continue;
      const b = boardOfCard(c, doc);
      const parentCol = doc.cards[c.parent];
      if (parentCol && parentCol.trashed) continue;
      if (out.has(b) || b === UNSORTED) { out.add(c.data.boardId); changed = true; }
    }
  }
  return out;
}

export function cardText(c: Card): string {
  const d = c.data || {};
  switch (c.type) {
    case 'note': return htmlToText(d.html);
    case 'document': return (d.title || '') + '\n' + htmlToText(d.html);
    case 'heading': return d.text || '';
    case 'todo': return [d.title, ...(d.items || []).map((i: any) => i.text)].filter(Boolean).join('\n');
    case 'link': return [d.title, d.url, d.description].filter(Boolean).join('\n');
    case 'image': return [d.caption, d.name].filter(Boolean).join('\n');
    case 'file': return d.name || '';
    case 'column': return d.title || '';
    case 'board': return get().boards[d.boardId]?.title || '';
    case 'color': return [d.name, d.hex].filter(Boolean).join(' ');
    case 'table': return (d.rows || []).map((r: string[]) => r.join(' ')).join('\n');
    case 'comment': return (d.thread || []).map((m: any) => m.text).join('\n');
    case 'line': return d.label || '';
    default: return '';
  }
}

// ---------- Création ----------
export function defaultData(type: CardType): any {
  switch (type) {
    case 'note': return { html: '' };
    case 'todo': return { title: '', items: [{ id: uid(), text: '', done: false }] };
    case 'link': return { url: '', title: '', description: '' };
    case 'image': return { blobId: null, src: null, ratio: 0.66, caption: '', name: '' };
    case 'file': return { blobId: null, name: 'Fichier', size: 0, mime: '' };
    case 'column': return { title: '', collapsed: false };
    case 'heading': return { text: '' };
    case 'color': return { hex: '#e9643b', name: '' };
    case 'sketch': return { strokes: [], width: 600, height: 400 };
    case 'table': return { rows: [['', '', ''], ['', '', ''], ['', '', '']], header: true };
    case 'comment': return { thread: [], resolved: false };
    case 'document': return { title: '', html: '' };
    case 'line': return { from: { x: 0, y: 0 }, to: { x: 200, y: 0 }, curve: { x: 0, y: 0 }, color: '#5d6b78', width: 2, arrowEnd: true, arrowStart: false, dashed: false, label: '' };
    default: return {};
  }
}

export function makeCard(type: CardType, parent: string, x: number, y: number, data?: any, extra?: Partial<Card>): Card {
  const now = Date.now();
  return {
    id: uid(), type, parent, x: Math.round(x), y: Math.round(y), w: DEFAULT_W[type], z: 0, order: 0,
    color: null, data: { ...defaultData(type), ...(data || {}) }, createdAt: now, updatedAt: now, trashed: null, ...(extra || {}),
  };
}

/** Ajoute une carte dans le brouillon ; pour une planche, crée aussi l'entité planche. */
export function addCardDraft(d: Draft<Doc>, card: Card, boardInit?: Partial<Board>) {
  if (card.type === 'board' && !card.data.boardId) {
    const b: Board = {
      id: uid(), title: boardInit?.title ?? 'Nouvelle planche', icon: boardInit?.icon ?? '✦',
      color: boardInit?.color ?? BOARD_COLORS[Math.floor(Math.random() * BOARD_COLORS.length)], createdAt: Date.now(),
    };
    d.boards[b.id] = b;
    card.data.boardId = b.id;
  }
  d.cards[card.id] = card as any;
  return card;
}

const TEXT_START: CardType[] = ['note', 'todo', 'heading', 'column', 'board', 'comment', 'table', 'link'];

/** Crée une carte au point monde (x,y) dans la planche courante ou une colonne. */
export function createCard(type: CardType, x: number, y: number, opts: { parent?: string; index?: number; data?: any; edit?: boolean; boardInit?: Partial<Board> } = {}) {
  const s = get();
  const parent = opts.parent || s.boardId;
  const card = makeCard(type, parent, x, y, opts.data);
  if (type === 'line') {
    card.data.from = { x: x - 100, y };
    card.data.to = { x: x + 100, y };
  }
  card.z = maxZ(parent) + 1;
  mutate(d => {
    if (s.cards[parent]?.type === 'column') {
      const kids = childrenOf(parent, s).filter(k => k.id !== card.id);
      const idx = opts.index ?? kids.length;
      kids.splice(idx, 0, card);
      kids.forEach((k, i) => { if (k.id === card.id) card.order = i; else d.cards[k.id].order = i; });
    }
    addCardDraft(d, card, opts.boardInit);
  });
  const edit = opts.edit ?? TEXT_START.includes(type);
  set({ selection: [card.id], editingId: edit ? card.id : null, editPoint: null });
  if (type === 'sketch' && !opts.data) set({ modal: { kind: 'sketch', cardId: card.id }, editingId: null });
  if (type === 'document' && !opts.data) set({ modal: { kind: 'document', cardId: card.id }, editingId: null });
  return card.id;
}

export function updateCard(id: string, patch: Partial<Card> | ((c: Draft<Card>) => void), history = true) {
  mutate(d => {
    const c = d.cards[id];
    if (!c) return;
    if (typeof patch === 'function') patch(c); else Object.assign(c, patch);
    c.updatedAt = Date.now();
  }, history);
}

export function updateData(id: string, patch: any, history = true) {
  updateCard(id, c => { c.data = { ...c.data, ...patch }; }, history);
}

export function updateBoard(id: string, patch: Partial<Board>) {
  mutate(d => { if (d.boards[id]) Object.assign(d.boards[id], patch); });
}

// ---------- Suppression / corbeille ----------
export function trashCards(ids: string[]) {
  if (!ids.length) return;
  mutate(d => {
    for (const id of ids) {
      const c = d.cards[id];
      if (c) { c.trashed = { at: Date.now() }; }
    }
  });
  set({ selection: [], editingId: null });
  toast(ids.length > 1 ? `${ids.length} éléments placés dans la corbeille` : 'Placé dans la corbeille');
}

export function restoreCard(id: string) {
  mutate(d => {
    const c = d.cards[id];
    if (!c) return;
    c.trashed = null;
    const p = d.cards[c.parent];
    const validParent = d.boards[c.parent] || c.parent === UNSORTED || (p && !p.trashed && p.type === 'column');
    if (!validParent) { c.parent = ROOT_ID; }
  });
}

function collectDescendants(ids: string[], doc: Doc) {
  const cardIds = new Set<string>();
  const boardIds = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (cardIds.has(id)) continue;
    const c = doc.cards[id];
    if (!c) continue;
    cardIds.add(id);
    for (const k of Object.values(doc.cards)) if (k.parent === id) stack.push(k.id);
    if (c.type === 'board' && c.data.boardId && !boardIds.has(c.data.boardId)) {
      boardIds.add(c.data.boardId);
      for (const k of Object.values(doc.cards)) if (k.parent === c.data.boardId) stack.push(k.id);
    }
  }
  return { cardIds, boardIds };
}

export function deleteForever(ids: string[]) {
  const s = get();
  const { cardIds, boardIds } = collectDescendants(ids, s);
  const blobs = new Set<string>();
  for (const id of cardIds) { const b = s.cards[id]?.data?.blobId; if (b) blobs.add(b); }
  mutate(d => {
    for (const id of cardIds) delete d.cards[id];
    for (const id of boardIds) if (id !== ROOT_ID) delete d.boards[id];
  });
  // supprime les fichiers plus référencés par aucune carte (y compris dans l'historique récent, on garde par prudence ceux de l'historique)
  const still = new Set<string>();
  for (const doc of [get(), ...get().past.slice(-30)]) for (const c of Object.values(doc.cards)) if (c.data?.blobId) still.add(c.data.blobId);
  for (const b of blobs) if (!still.has(b)) blobDel(b).catch(() => {});
}

export function emptyTrash() {
  const ids = Object.values(get().cards).filter(c => c.trashed).map(c => c.id);
  deleteForever(ids);
}

// ---------- Copier / coller / dupliquer ----------
export interface ClipPayload { cards: Card[]; boards: Board[]; roots: string[] }

export function collectPayload(ids: string[]): ClipPayload {
  const s = get();
  const { cardIds, boardIds } = collectDescendants(ids, s);
  const lookup = (id: string) => s.cards[id];
  const cards = [...cardIds].map(id => {
    const c = JSON.parse(JSON.stringify(s.cards[id])) as Card;
    if (c.type === 'line') {
      // mémorise les positions absolues des extrémités pour le cas où la carte attachée n'est pas copiée
      const g = lineGeometry(s.cards[id], lookup, s.cards[id].parent);
      if (g) { c.data.from = { ...c.data.from, x: g.A.x, y: g.A.y }; c.data.to = { ...c.data.to, x: g.B.x, y: g.B.y }; }
    }
    return c;
  });
  return { cards, boards: [...boardIds].map(id => JSON.parse(JSON.stringify(s.boards[id]))), roots: ids.filter(id => cardIds.has(id)) };
}

/** Colle un payload dans `parent`. Les cartes racines sont décalées pour que leur coin haut-gauche soit à `at`. */
export function pastePayload(p: ClipPayload, parent: string, at: { x: number; y: number } | null, offset = { x: 24, y: 24 }) {
  const s = get();
  const cmap = new Map<string, string>();
  const bmap = new Map<string, string>();
  p.cards.forEach(c => cmap.set(c.id, uid()));
  p.boards.forEach(b => bmap.set(b.id, uid()));
  const roots = p.cards.filter(c => p.roots.includes(c.id));
  let dx = offset.x, dy = offset.y;
  if (at && roots.length) {
    const minX = Math.min(...roots.map(r => r.type === 'line' ? Math.min(r.data.from.x, r.data.to.x) : r.x));
    const minY = Math.min(...roots.map(r => r.type === 'line' ? Math.min(r.data.from.y, r.data.to.y) : r.y));
    dx = at.x - minX; dy = at.y - minY;
  }
  let z = maxZ(parent);
  const newRoots: string[] = [];
  const isColumn = s.cards[parent]?.type === 'column';
  let order = isColumn ? childrenOf(parent).length : 0;
  mutate(d => {
    for (const b of p.boards) d.boards[bmap.get(b.id)!] = { ...b, id: bmap.get(b.id)! };
    for (const src of p.cards) {
      const c: Card = JSON.parse(JSON.stringify(src));
      c.id = cmap.get(src.id)!;
      c.createdAt = c.updatedAt = Date.now();
      c.trashed = null;
      const isRoot = p.roots.includes(src.id);
      if (isRoot) {
        if (isColumn && c.type !== 'column') { c.parent = parent; c.order = order++; }
        else {
          c.parent = isColumn ? s.cards[parent].parent : parent;
          c.x = Math.round(c.x + dx); c.y = Math.round(c.y + dy);
        }
        c.z = ++z;
        newRoots.push(c.id);
      } else {
        c.parent = cmap.get(src.parent) || bmap.get(src.parent) || src.parent;
      }
      if (c.type === 'board' && c.data.boardId) c.data.boardId = bmap.get(c.data.boardId) || c.data.boardId;
      if (c.type === 'line') {
        for (const k of ['from', 'to'] as const) {
          const e = c.data[k];
          if (e.cardId && cmap.has(e.cardId)) e.cardId = cmap.get(e.cardId);
          else e.cardId = null;
          if (isRoot) { e.x += dx; e.y += dy; }
        }
      }
      d.cards[c.id] = c;
    }
  });
  const ordered = p.roots.map(r => cmap.get(r)!).filter(id => newRoots.includes(id));
  set({ selection: ordered, editingId: null });
  return ordered;
}

export function duplicate(ids: string[]) {
  if (!ids.length) return;
  const s = get();
  const p = collectPayload(ids);
  const first = s.cards[ids[0]];
  if (first && s.cards[first.parent]?.type === 'column' && ids.length === 1) {
    const newIds = pastePayload(p, first.parent, null);
    // place juste après l'original
    const kids = childrenOf(first.parent).filter(k => k.id !== newIds[0]);
    const idx = kids.findIndex(k => k.id === first.id);
    kids.splice(idx + 1, 0, get().cards[newIds[0]]);
    mutate(d => kids.forEach((k, i) => { d.cards[k.id].order = i; }), false);
    return;
  }
  pastePayload(p, s.boardId, null);
}

// ---------- Déplacements ----------
export function moveToBoard(ids: string[], boardId: string) {
  const s = get();
  const existing = topCardsOf(boardId).filter(c => c.type !== 'line');
  let baseX = 80, baseY = 80;
  if (existing.length) {
    const maxY = Math.max(...existing.map(c => cardRect(c).y + cardRect(c).h));
    const minX = Math.min(...existing.map(c => c.x));
    baseX = minX; baseY = maxY + 60;
  }
  const movers = ids.map(id => s.cards[id]).filter(Boolean).filter(c => !(c.type === 'board' && c.data.boardId === boardId));
  if (!movers.length) return;
  const minX = Math.min(...movers.map(c => c.x)), minY = Math.min(...movers.map(c => c.y));
  let z = maxZ(boardId);
  mutate(d => {
    for (const m of movers) {
      const c = d.cards[m.id];
      const fromColumn = s.cards[c.parent]?.type === 'column';
      c.parent = boardId;
      c.x = fromColumn ? baseX : baseX + (m.x - minX);
      c.y = fromColumn ? baseY : baseY + (m.y - minY);
      c.z = ++z;
      if (c.type === 'line') {
        for (const k of ['from', 'to'] as const) { c.data[k].cardId = ids.includes(c.data[k].cardId) ? c.data[k].cardId : null; }
      }
    }
  });
  set({ selection: [], editingId: null });
  const title = boardId === UNSORTED ? 'À trier' : s.boards[boardId]?.title;
  toast(`Déplacé vers « ${title} »`);
}

/** Insère des cartes dans une colonne à l'index donné. */
export function insertIntoColumn(ids: string[], columnId: string, index: number, history = true) {
  const s = get();
  const kids = childrenOf(columnId, s).filter(k => !ids.includes(k.id));
  const movers = ids.map(id => s.cards[id]).filter(c => c && c.type !== 'column' && c.type !== 'line');
  kids.splice(Math.max(0, Math.min(index, kids.length)), 0, ...movers);
  mutate(d => {
    kids.forEach((k, i) => { d.cards[k.id].order = i; d.cards[k.id].parent = columnId; });
  }, history);
}

export function bringToFront(ids: string[]) {
  const s = get();
  let z = maxZ(s.boardId);
  mutate(d => ids.forEach(id => { if (d.cards[id]) d.cards[id].z = ++z; }));
}
export function sendToBack(ids: string[]) {
  const s = get();
  let z = Math.min(0, ...topCardsOf(s.boardId).map(c => c.z));
  mutate(d => ids.slice().reverse().forEach(id => { if (d.cards[id]) d.cards[id].z = --z; }));
}

// ---------- Alignement ----------
export function arrange(ids: string[], mode: 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom' | 'hdist' | 'vdist' | 'grid') {
  const s = get();
  const cs = ids.map(id => s.cards[id]).filter(c => c && c.type !== 'line' && c.parent === s.boardId);
  if (cs.length < 2) return;
  const rects = new Map(cs.map(c => [c.id, cardRect(c)]));
  const R = (c: Card) => rects.get(c.id)!;
  const minX = Math.min(...cs.map(c => R(c).x)), maxX = Math.max(...cs.map(c => R(c).x + R(c).w));
  const minY = Math.min(...cs.map(c => R(c).y)), maxY = Math.max(...cs.map(c => R(c).y + R(c).h));
  mutate(d => {
    const put = (c: Card, x: number | null, y: number | null) => { if (x !== null) d.cards[c.id].x = Math.round(x); if (y !== null) d.cards[c.id].y = Math.round(y); };
    if (mode === 'left') cs.forEach(c => put(c, minX, null));
    if (mode === 'right') cs.forEach(c => put(c, maxX - R(c).w, null));
    if (mode === 'hcenter') cs.forEach(c => put(c, (minX + maxX) / 2 - R(c).w / 2, null));
    if (mode === 'top') cs.forEach(c => put(c, null, minY));
    if (mode === 'bottom') cs.forEach(c => put(c, null, maxY - R(c).h));
    if (mode === 'vmiddle') cs.forEach(c => put(c, null, (minY + maxY) / 2 - R(c).h / 2));
    if (mode === 'hdist') {
      const sorted = [...cs].sort((a, b) => R(a).x - R(b).x);
      const total = sorted.reduce((t, c) => t + R(c).w, 0);
      const gap = (maxX - minX - total) / (sorted.length - 1);
      let x = minX; sorted.forEach(c => { put(c, x, null); x += R(c).w + gap; });
    }
    if (mode === 'vdist') {
      const sorted = [...cs].sort((a, b) => R(a).y - R(b).y);
      const total = sorted.reduce((t, c) => t + R(c).h, 0);
      const gap = (maxY - minY - total) / (sorted.length - 1);
      let y = minY; sorted.forEach(c => { put(c, null, y); y += R(c).h + gap; });
    }
    if (mode === 'grid') {
      const sorted = [...cs].sort((a, b) => (R(a).y - R(b).y) || (R(a).x - R(b).x));
      const cols = Math.ceil(Math.sqrt(sorted.length));
      const colW = Math.max(...sorted.map(c => R(c).w)) + 24;
      let y = minY, rowH = 0;
      sorted.forEach((c, i) => {
        if (i && i % cols === 0) { y += rowH + 24; rowH = 0; }
        put(c, minX + (i % cols) * colW, y);
        rowH = Math.max(rowH, R(c).h);
      });
    }
  });
}

// ---------- Navigation ----------
export function navigate(boardId: string, opts: { readOnly?: boolean } = {}) {
  const hash = `#/b/${boardId}${opts.readOnly ? '?lecture=1' : ''}`;
  if (location.hash !== hash) location.hash = hash;
  else applyHash();
}

export function applyHash() {
  const m = location.hash.match(/^#\/b\/([^?]+)(\?lecture=1)?/);
  const s = get();
  let id = m ? decodeURIComponent(m[1]) : ROOT_ID;
  if (id !== UNSORTED && !s.boards[id]) id = ROOT_ID;
  if (id === UNSORTED) id = ROOT_ID;
  set({ boardId: id, readOnly: hooks.forceReadOnly || !!(m && m[2]), selection: [], editingId: null, menu: null, panel: s.panel === 'search' ? null : s.panel });
}

export function setViewport(v: Viewport) {
  const s = get();
  set({ viewports: { ...s.viewports, [s.boardId]: v } });
}

/** Duplique une planche entière (avec son contenu et ses sous-planches) à côté de l'originale. */
export function duplicateBoard(boardId: string) {
  const s = get();
  if (boardId === ROOT_ID) return null;
  const bc = boardCardFor(boardId, s);
  if (!bc) return null;
  const parent = bc.parent;
  const p = collectPayload([bc.id]);
  const isColumn = s.cards[parent]?.type === 'column';
  const at = isColumn ? null : { x: bc.x + 140, y: bc.y };
  const [newId] = pastePayload(p, parent, at, { x: 0, y: 0 });
  const nc = get().cards[newId];
  if (nc) mutate(d => { const b = d.boards[nc.data.boardId]; if (b) b.title = `${b.title} (copie)`; }, false);
  toast('Planche dupliquée');
  return nc?.data.boardId as string | undefined;
}
