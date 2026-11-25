import { toPng } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { get, set, toast, collectPayload, pastePayload, topCardsOf, makeCard, mutate, addCardDraft, maxZ, flushSave, uid, type ClipPayload } from './store';
import { contentBounds, viewCenterWorld } from './interaction';
import { blobGet, blobSet, blobToDataUrl, dataUrlToBlob, blobKeys } from './db';
import { downloadBlob, pickFiles } from './files';
import { APP_NAME, ROOT_ID } from './types';
import { milanoteToAtelier } from './milanote';

const PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

function safeName(s: string) { return (s || 'planche').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80); }

async function renderBoardPng(): Promise<{ url: string; w: number; h: number } | null> {
  const world = document.querySelector('.world') as HTMLElement | null;
  const b = contentBounds();
  if (!world || !b) { toast('La planche est vide'); return null; }
  const prevSel = get().selection;
  set({ selection: [], editingId: null });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pad = 40;
  const w = Math.ceil(b.w + pad * 2), h = Math.ceil(b.h + pad * 2);
  const maxSide = 12000;
  const ratio = Math.min(2, maxSide / Math.max(w, h));
  const cv = document.querySelector('[data-canvas]') as HTMLElement | null;
  const cvBg = cv ? getComputedStyle(cv).backgroundColor : '';
  const bg = (cvBg && cvBg !== 'rgba(0, 0, 0, 0)' ? cvBg : '') || getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#f3f2ef';
  try {
    const url = await toPng(world, {
      width: w, height: h, pixelRatio: ratio, backgroundColor: bg, imagePlaceholder: PLACEHOLDER, cacheBust: false,
      style: { transform: `translate(${-b.x + pad}px, ${-b.y + pad}px) scale(1)`, transformOrigin: '0 0' },
      filter: (n: any) => !(n.classList && (n.classList.contains('resize-handle') || n.classList.contains('connector') || n.classList.contains('line-hit') || n.classList.contains('line-sel') || n.classList.contains('line-handle') || n.classList.contains('marquee') || n.classList.contains('guide'))),
    });
    return { url, w, h };
  } catch (e) {
    console.error(e);
    toast("L'export a échoué");
    return null;
  } finally {
    set({ selection: prevSel });
  }
}

export async function exportPng() {
  toast('Préparation de l\'image…');
  const r = await renderBoardPng();
  if (!r) return;
  downloadBlob(await dataUrlToBlob(r.url), `${safeName(get().boards[get().boardId]?.title)}.png`);
  toast('Image exportée');
}

export async function exportPdf() {
  toast('Préparation du PDF…');
  const r = await renderBoardPng();
  if (!r) return;
  const pdf = new jsPDF({ orientation: r.w >= r.h ? 'landscape' : 'portrait', unit: 'px', format: [r.w, r.h], hotfixes: ['px_scaling'] });
  pdf.addImage(r.url, 'PNG', 0, 0, r.w, r.h);
  pdf.save(`${safeName(get().boards[get().boardId]?.title)}.pdf`);
  toast('PDF exporté');
}

async function collectBlobs(cards: any[], boards: any[] = []) {
  const blobs: Record<string, string> = {};
  const ids = [...cards.map(c => c.data?.blobId), ...boards.flatMap(b => [b?.cover, b?.bgImage])].filter(Boolean);
  for (const id of ids) {
    if (!blobs[id]) { const b = await blobGet(id); if (b) blobs[id] = await blobToDataUrl(b); }
  }
  return blobs;
}

export async function exportBoardJson(boardId: string) {
  const s = get();
  const board = s.boards[boardId];
  const ids = topCardsOf(boardId).map(c => c.id);
  const payload = collectPayload(ids);
  const blobs = await collectBlobs(payload.cards, [...payload.boards, board]);
  const file = { format: 'atelier-board', version: 1, app: APP_NAME, board: { title: board.title, icon: board.icon, color: board.color, cover: board.cover || null, bgColor: board.bgColor || null, bgImage: board.bgImage || null }, payload, blobs, exportedAt: new Date().toISOString() };
  downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${safeName(board.title)}.planche.json`);
  toast('Planche exportée');
}

async function restoreBlobs(blobs: Record<string, string>, payload: ClipPayload) {
  // nouveaux identifiants pour éviter toute collision
  const map = new Map<string, string>();
  for (const [oldId, dataUrl] of Object.entries(blobs || {})) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) continue;
    const nid = uid();
    await blobSet(nid, await dataUrlToBlob(dataUrl));
    map.set(oldId, nid);
  }
  for (const c of payload.cards) if (c.data?.blobId) c.data.blobId = map.get(c.data.blobId) || null;
  for (const b of payload.boards as any[]) { if (b.cover && !/^https?:/.test(b.cover)) b.cover = map.get(b.cover) || null; if (b.bgImage) b.bgImage = map.get(b.bgImage) || null; }
  return map;
}

function validPayload(p: any): p is ClipPayload {
  return p && Array.isArray(p.cards) && Array.isArray(p.boards) && Array.isArray(p.roots);
}

export async function importBoardJson() {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  try {
    let file = JSON.parse(await f.text());
    if (file.format === 'milanote-dump') { toast('Conversion de la planche Milanote…'); file = milanoteToAtelier(file); }
    if (file.format !== 'atelier-board' || !validPayload(file.payload)) throw new Error('format');
    const bmap = await restoreBlobs(file.blobs, file.payload);
    const s = get();
    const at = viewCenterWorld();
    const bc = makeCard('board', s.boardId, at.x - 60, at.y - 60);
    bc.z = maxZ(s.boardId) + 1;
    mutate(d => { addCardDraft(d, bc, { title: String(file.board?.title || 'Planche importée'), icon: String(file.board?.icon || '✦').slice(0, 4), color: String(file.board?.color || '#4a86c7'), cover: bmap.get(file.board?.cover) || null, bgColor: typeof file.board?.bgColor === 'string' ? file.board.bgColor : null, bgImage: bmap.get(file.board?.bgImage) || null }); });
    const newBoardId = get().cards[bc.id].data.boardId;
    pastePayload(file.payload, newBoardId, null, { x: 0, y: 0 });
    set({ selection: [bc.id] });
    toast(`« ${file.board?.title || 'Planche'} » importée`);
  } catch (e) {
    console.error(e);
    toast("Ce fichier n'est pas une planche valide");
  }
}

export async function exportBackup() {
  toast('Préparation de la sauvegarde…');
  const s = get();
  const blobs: Record<string, string> = {};
  for (const k of await blobKeys()) { const b = await blobGet(String(k)); if (b) blobs[String(k)] = await blobToDataUrl(b); }
  const file = { format: 'atelier-backup', version: 1, app: APP_NAME, boards: s.boards, cards: s.cards, settings: s.settings, blobs, exportedAt: new Date().toISOString() };
  const date = new Date().toISOString().slice(0, 10);
  downloadBlob(new Blob([JSON.stringify(file)], { type: 'application/json' }), `${safeName(APP_NAME)}-sauvegarde-${date}.json`);
  toast('Sauvegarde téléchargée');
}

export async function importBackup() {
  const [f] = await pickFiles('.json,application/json', false);
  if (!f) return;
  try {
    const file = JSON.parse(await f.text());
    if (file.format !== 'atelier-backup' || !file.boards || !file.cards || !file.boards[ROOT_ID]) throw new Error('format');
    if (!confirm('Remplacer TOUT le contenu actuel par cette sauvegarde ? Le contenu actuel sera perdu.')) return;
    for (const [id, dataUrl] of Object.entries(file.blobs || {})) {
      if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) await blobSet(id, await dataUrlToBlob(dataUrl));
    }
    set({ boards: file.boards, cards: file.cards, settings: { ...get().settings, ...(file.settings || {}) }, past: [], future: [], selection: [], editingId: null, viewports: {}, boardId: ROOT_ID });
    location.hash = '#/b/root';
    flushSave();
    toast('Sauvegarde restaurée');
  } catch (e) {
    console.error(e);
    toast("Ce fichier n'est pas une sauvegarde valide");
  }
}
