import { blobSet } from './db';
import { addCardDraft, get, makeCard, maxZ, mutate, set, toast, uid, childrenOf } from './store';
import { textToHtml } from './sanitize';
import type { Card } from './types';

export function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
export function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(\d+)/);
  return m ? m[1] : null;
}
// Adresse « intégrable » (aperçu dans la carte) pour les sites qui l'autorisent ; h = hauteur en % de la largeur, ou px fixes.
export function embedInfo(url: string): { src: string; ratio?: number; px?: number } | null {
  const yt = youtubeId(url); if (yt) return { src: `https://www.youtube-nocookie.com/embed/${yt}`, ratio: 56.25 };
  const vm = vimeoId(url); if (vm) return { src: `https://player.vimeo.com/video/${vm}`, ratio: 56.25 };
  let m = url.match(/open\.spotify\.com\/(?:intl-\w+\/)?(track|album|playlist|episode|show|artist)\/([\w]+)/);
  if (m) return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, px: m[1] === 'track' || m[1] === 'episode' ? 152 : 352 };
  if (/^https?:\/\/(www\.)?soundcloud\.com\/[^/]+\/[^/]+/.test(url)) return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}`, px: 166 };
  m = url.match(/pinterest\.[a-z.]+\/pin\/(\d+)/); if (m) return { src: `https://assets.pinterest.com/ext/embed.html?id=${m[1]}`, ratio: 140 };
  m = url.match(/loom\.com\/(?:share|embed)\/([\w]+)/); if (m) return { src: `https://www.loom.com/embed/${m[1]}`, ratio: 56.25 };
  m = url.match(/dailymotion\.com\/video\/(\w+)/); if (m) return { src: `https://www.dailymotion.com/embed/video/${m[1]}`, ratio: 56.25 };
  if (/^https?:\/\/(www\.)?figma\.com\/(file|design|proto|board)\//.test(url)) return { src: `https://www.figma.com/embed?embed_host=atelier&url=${encodeURIComponent(url)}`, ratio: 75 };
  m = url.match(/^(https?:\/\/docs\.google\.com\/(?:document|spreadsheets|presentation)\/d\/[\w-]+)/); if (m) return { src: `${m[1]}/preview`, ratio: 75 };
  m = url.match(/^(https?:\/\/drive\.google\.com)\/file\/d\/([\w-]+)/); if (m) return { src: `${m[1]}/file/d/${m[2]}/preview`, ratio: 75 };
  return null;
}
export function isUrl(s: string) {
  return /^https?:\/\/\S+$/i.test(s.trim());
}
export function normalizeUrl(s: string) {
  s = s.trim();
  if (!s) return s;
  if (!/^[a-z]+:\/\//i.test(s)) s = 'https://' + s;
  return s;
}
export function domainOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
export function formatSize(n: number) {
  if (!n) return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}

function imageRatio(blob: Blob): Promise<number> {
  return new Promise(res => {
    const u = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { res(img.naturalHeight / img.naturalWidth || 0.66); URL.revokeObjectURL(u); };
    img.onerror = () => { res(0.66); URL.revokeObjectURL(u); };
    img.src = u;
  });
}

const MAX_FILE = 200 * 1024 * 1024;

/** Construit une carte (non insérée) à partir d'un fichier. */
export async function cardFromFile(file: File, parent: string, x: number, y: number): Promise<Card | null> {
  if (file.size > MAX_FILE) { toast(`« ${file.name} » dépasse 200 Mo`); return null; }
  const blobId = uid();
  await blobSet(blobId, file);
  if (file.type.startsWith('image/')) {
    const ratio = await imageRatio(file);
    return makeCard('image', parent, x, y, { blobId, ratio, name: file.name, caption: '' });
  }
  return makeCard('file', parent, x, y, { blobId, name: file.name, size: file.size, mime: file.type });
}

/** Insère plusieurs fichiers (glisser-déposer ou import) en cascade. */
export async function insertFiles(files: File[], at: { x: number; y: number }, parent?: string, index?: number) {
  const s = get();
  const target = parent || s.boardId;
  const isColumn = s.cards[target]?.type === 'column';
  const cards: Card[] = [];
  let i = 0;
  for (const f of files) {
    const c = await cardFromFile(f, target, at.x + (i % 4) * 300, at.y + Math.floor(i / 4) * 260);
    if (c) cards.push(c);
    i++;
  }
  if (!cards.length) return;
  let z = maxZ(target);
  mutate(d => {
    if (isColumn) {
      const kids = childrenOf(target, s);
      kids.splice(index ?? kids.length, 0, ...cards);
      kids.forEach((k, j) => { if (d.cards[k.id]) d.cards[k.id].order = j; else (k as Card).order = j; });
    }
    cards.forEach(c => { c.z = ++z; addCardDraft(d, c); });
  });
  set({ selection: cards.map(c => c.id), editingId: null });
}

export const IMAGE_URL = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?\S*)?$/i;

/** Ajoute une image depuis une adresse web. Elle est copiée en local si le site l'autorise. */
export async function insertImageFromUrl(url: string, at: { x: number; y: number }) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) { toast("Adresse d'image invalide"); return; }
  const s = get();
  let ratio = 0.66, blobId: string | null = null, ok = false;
  try {
    const r = await fetch(url);
    if (r.ok) {
      const b = await r.blob();
      if (b.type.startsWith('image/')) { blobId = uid(); await blobSet(blobId, b); ratio = await imageRatio(b); ok = true; }
    }
  } catch { /* le site bloque la copie : on garde le lien */ }
  if (!ok) {
    const loaded = await new Promise<number | null>(res => {
      const i = new Image();
      const t = setTimeout(() => res(null), 8000);
      i.onload = () => { clearTimeout(t); res(i.naturalHeight / i.naturalWidth || 0.66); };
      i.onerror = () => { clearTimeout(t); res(null); };
      i.src = url;
    });
    if (loaded === null) { toast("Impossible de charger cette image"); return; }
    ratio = loaded;
  }
  const name = decodeURIComponent(url.split('/').pop()?.split('?')[0] || 'image');
  const card = makeCard('image', s.boardId, at.x, at.y, { blobId, src: blobId ? null : url, ratio, name, caption: '' });
  card.z = maxZ(s.boardId) + 1;
  mutate(d => { addCardDraft(d, card); });
  set({ selection: [card.id], editingId: null });
  if (!blobId) toast("Image liée depuis le web (le site n'autorise pas la copie locale)");
}

export function insertText(text: string, at: { x: number; y: number }) {
  const s = get();
  text = text.trim();
  if (!text) return;
  if (IMAGE_URL.test(text)) { insertImageFromUrl(text, at); return; }
  let card: Card;
  if (isUrl(text)) card = makeCard('link', s.boardId, at.x, at.y, { url: text, title: '' });
  else card = makeCard('note', s.boardId, at.x, at.y, { html: textToHtml(text) });
  card.z = maxZ(s.boardId) + 1;
  mutate(d => { addCardDraft(d, card); });
  set({ selection: [card.id], editingId: null });
}

/** Ouvre le sélecteur de fichiers du système. */
export function pickFiles(accept: string, multiple = true): Promise<File[]> {
  return new Promise(res => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = accept;
    inp.multiple = multiple;
    inp.onchange = () => res(Array.from(inp.files || []));
    inp.click();
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 5000);
}
