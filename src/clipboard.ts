import { collectPayload, pastePayload, get, trashCards, cardText, type ClipPayload } from './store';
import { screenToWorld, viewCenterWorld } from './interaction';

let last: { text: string; payload: ClipPayload } | null = null;
export let lastPointer: { x: number; y: number } | null = null;
window.addEventListener('pointermove', e => { lastPointer = { x: e.clientX, y: e.clientY }; }, { passive: true });

export function hasInternalClip() { return !!last; }

export function copySelection(e?: ClipboardEvent) {
  const s = get();
  const ids = s.selection.filter(id => s.cards[id] && !s.cards[id].trashed);
  if (!ids.length) return false;
  const payload = collectPayload(ids);
  const text = ids.map(id => cardText(s.cards[id])).filter(Boolean).join('\n\n') || `[${ids.length} carte(s)]`;
  last = { text, payload };
  if (e?.clipboardData) { e.clipboardData.setData('text/plain', text); e.preventDefault(); }
  else navigator.clipboard?.writeText(text).catch(() => {});
  return true;
}

export function cutSelection(e?: ClipboardEvent) {
  if (copySelection(e)) trashCards(get().selection);
}

/** Point de collage : sous la souris si elle est sur le canevas, sinon au centre. */
export function pastePoint() {
  const canvas = document.querySelector('[data-canvas]') as HTMLElement | null;
  if (lastPointer && canvas) {
    const r = canvas.getBoundingClientRect();
    if (lastPointer.x > r.left && lastPointer.x < r.right && lastPointer.y > r.top && lastPointer.y < r.bottom) return screenToWorld(lastPointer.x, lastPointer.y);
  }
  return viewCenterWorld();
}

/** Colle les cartes copiées en interne si le texte correspond. Renvoie true si fait. */
export function pasteInternal(text: string | null, at?: { x: number; y: number }) {
  if (!last) return false;
  if (text !== null && text !== last.text) return false;
  pastePayload(last.payload, get().boardId, at || pastePoint());
  return true;
}
