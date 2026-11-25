// Synchronisation en ligne : connexion Google, copie du document sur le serveur, planches partagées.
//
// Principe : seules les cartes MODIFIÉES sont envoyées, et seules celles qui ont changé ailleurs sont reçues.
// Le travail de cet appareil n'est jamais écrasé : une carte modifiée ici et pas encore envoyée reste telle quelle.
import { create } from 'zustand';
import { useStore, hooks, applyRemote, loadDoc, applyHash, toast } from './store';
import { remote, blobKeys, blobGet, kvGet, kvSet } from './db';

type Status = 'off' | 'sync' | 'ok' | 'err';
export const useCloud = create<{
  user: any; status: Status; clientId: string | null; ready: boolean;
  share: null | { token: string; role: 'view' | 'edit' }; needLogin: boolean; shareError: string | null;
}>(() => ({ user: null, status: 'off', clientId: null, ready: false, share: null, needLogin: false, shareError: null }));
const setC = useCloud.setState;

export async function api(x: string, opts: RequestInit = {}) {
  const init: RequestInit = { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts };
  // gros envoi : on compresse (limite de 4,5 Mo côté serveur)
  if (typeof init.body === 'string' && init.body.length > 100_000 && typeof CompressionStream !== 'undefined') {
    const gz = await new Response(new Blob([init.body]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    init.body = gz;
    init.headers = { 'Content-Type': 'application/octet-stream', 'x-gz': '1' };
  }
  const r = await fetch('/api/a?x=' + x, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
  return j;
}

// ---------- état de synchronisation ----------
let dirty = false, pushing = false, again = false, pushTimer: any = null, pullTimer: any = null;
let mode: 'owner' | 'shared' | null = null;

/** Empreinte d'un objet : sert à savoir si une carte a changé depuis le dernier envoi. */
const hashCache = new WeakMap<object, string>();
function hash(o: any): string {
  if (o && typeof o === 'object') { const c = hashCache.get(o); if (c) return c; }
  const s = JSON.stringify(o);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  const r = h + ':' + s.length;
  if (o && typeof o === 'object') hashCache.set(o, r);
  return r;
}
let uid = '';
/** id → empreinte de ce que le serveur possède (préfixe c: carte, b: planche) */
let known: Record<string, string> = {};
let cursor = { sc: 0, sb: 0 };
let metaHash = '';
const saveState = () => kvSet('sync:' + uid, { known, cursor, metaHash }).catch(() => null);

function schedulePush() {
  dirty = true;
  setC({ status: 'sync' });
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}

// ---------- propriétaire : envoi des seules modifications ----------
async function pushOwner() {
  const s = useStore.getState();
  const cards: any[] = [], boards: any[] = [];
  const present = new Set<string>();
  for (const c of Object.values(s.cards)) { present.add('c:' + c.id); if (known['c:' + c.id] !== hash(c)) cards.push(c); }
  for (const b of Object.values(s.boards)) { present.add('b:' + b.id); if (known['b:' + b.id] !== hash(b)) boards.push(b); }
  // supprimé ici ⇒ supprimé en ligne (marqué, pas effacé : récupérable côté serveur)
  const deleted = Object.keys(known).filter(k => !present.has(k)).map(k => k.slice(2));
  const meta = { settings: s.settings, viewports: s.viewports };
  const mh = hash(meta);
  if (!cards.length && !boards.length && !deleted.length && mh === metaHash) return;

  const BATCH = 800;
  const total = Math.max(1, Math.ceil(cards.length / BATCH));
  for (let i = 0; i < total; i++) {
    const last = i === total - 1;
    const part = cards.slice(i * BATCH, (i + 1) * BATCH);
    await api('doc', { method: 'PUT', body: JSON.stringify({
      cards: part, boards: i === 0 ? boards : [], deleted: last ? deleted : [],
      ...(last ? meta : {}),
    }) });
    for (const c of part) known['c:' + c.id] = hash(c);
    if (i === 0) for (const b of boards) known['b:' + b.id] = hash(b);
    if (last) { for (const id of deleted) { delete known['c:' + id]; delete known['b:' + id]; } metaHash = mh; }
    if (total > 1) setC({ status: 'sync' });
  }
  await saveState();
}

/** Reçoit ce qui a changé ailleurs. Ce qui est modifié ici et pas encore envoyé n'est jamais écrasé. */
async function pullOwner(initial = false) {
  const OVERLAP = 5 * 1000 * 1000; // revoit les 5 dernières secondes : aucune modification ne peut être manquée
  let { sc, sb } = cursor;
  if (!initial) { sc = Math.max(0, sc - OVERLAP); sb = Math.max(0, sb - OVERLAP); }
  const gotCards: any[] = [], gotBoards: any[] = [], gone: string[] = [];
  let meta: any = null, next = { sc: cursor.sc, sb: cursor.sb };
  for (let guard = 0; guard < 500; guard++) {
    const r = await api(`doc&sc=${sc}&sb=${sb}`);
    gotCards.push(...r.cards); gotBoards.push(...r.boards); gone.push(...r.deleted);
    if (!meta) meta = { settings: r.settings, viewports: r.viewports };
    sc = r.sc; sb = r.sb;
    next = { sc: Math.max(next.sc, r.sc), sb: Math.max(next.sb, r.sb) };
    if (!r.more) break;
  }
  const cur = useStore.getState();
  const cards = { ...cur.cards }, boards = { ...cur.boards };
  let changed = false;
  for (const c of gotCards) {
    const h = hash(c);
    if (known['c:' + c.id] === h) continue;                              // déjà identique
    const local = cards[c.id];
    if (local && known['c:' + c.id] !== hash(local)) continue;            // modifié ici, pas encore envoyé : on garde le local
    cards[c.id] = c; known['c:' + c.id] = h; changed = true;
  }
  for (const b of gotBoards) {
    const h = hash(b);
    if (known['b:' + b.id] === h) continue;
    const local = boards[b.id];
    if (local && known['b:' + b.id] !== hash(local)) continue;
    boards[b.id] = b; known['b:' + b.id] = h; changed = true;
  }
  for (const id of gone) {
    if (cards[id] && known['c:' + id] === hash(cards[id])) { delete cards[id]; changed = true; }
    if (boards[id] && known['b:' + id] === hash(boards[id])) { delete boards[id]; changed = true; }
    delete known['c:' + id]; delete known['b:' + id];
  }
  cursor = next;
  const withMeta = initial && meta && meta.settings ? { settings: meta.settings, viewports: meta.viewports || undefined } : {};
  if (changed || (withMeta as any).settings) applyRemote({ boards, cards, ...(withMeta as any) });
  await saveState();
}

// ---------- planche partagée : sous-ensemble, envoyé en entier ----------
let shareRev: number | null = null;
let sharedKnown = '';
async function pushShared() {
  const s = useStore.getState();
  const token = useCloud.getState().share!.token;
  const prevIds = new Set(sharedIds);
  const doc = { boards: s.boards, cards: s.cards };
  const cur = new Set([...Object.keys(s.cards), ...Object.keys(s.boards)]);
  const deleted = [...prevIds].filter(i => !cur.has(i));
  const r = await api('share&t=' + token, { method: 'PUT', body: JSON.stringify({ doc, deleted }) });
  sharedIds = new Set([...Object.keys(r.doc.cards), ...Object.keys(r.doc.boards)]);
  shareRev = r.rev;
  sharedKnown = hash({ b: r.doc.boards, c: r.doc.cards });
}
let sharedIds = new Set<string>();

async function push() {
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    if (mode === 'shared') await pushShared(); else await pushOwner();
    const s = useStore.getState();
    dirty = false;
    setC({ status: 'ok' });
    if (mode === 'owner') { uploadBlobs(); }
    void s;
  } catch (e: any) {
    console.error(e);
    setC({ status: 'err' });
    dirty = true; // les modifications restent à envoyer : on réessaie bientôt, sans jamais écraser le local
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, 15000);
  } finally {
    pushing = false;
    if (again) { again = false; push(); }
  }
}

async function pull() {
  if (dirty || pushing || document.hidden) return;
  try {
    if (mode === 'shared') {
      const token = useCloud.getState().share!.token;
      const r = await api('share&t=' + token + (shareRev !== null ? '&rev=' + shareRev : ''));
      if (r.same || dirty || pushing) return;
      shareRev = r.rev;
      sharedIds = new Set([...Object.keys(r.doc.cards), ...Object.keys(r.doc.boards)]);
      applyRemote({ boards: r.doc.boards, cards: r.doc.cards });
    } else if (mode === 'owner') {
      await pullOwner();
    }
    setC({ status: 'ok' });
  } catch { /* réseau : on réessaiera */ }
}
function startPull() {
  clearInterval(pullTimer);
  pullTimer = setInterval(pull, 8000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && mode) pull(); });
window.addEventListener('online', () => { if (mode && dirty) push(); });

// ---------- fichiers (images, sons…) ----------
let blobsBusy = false, warnedBig = false;
async function toB64(b: Blob) {
  const u8 = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
async function uploadBlobs() {
  if (blobsBusy) return;
  blobsBusy = true;
  try {
    const keys = (await blobKeys()).map(String);
    if (!keys.length) return;
    const { have } = await api('blobs', { method: 'POST', body: JSON.stringify({ ids: keys }) });
    for (const id of keys.filter(k => !have.includes(k))) {
      const b = await blobGet(id);
      if (!b) continue;
      if (b.size > 3_200_000) { if (!warnedBig) { warnedBig = true; toast('Un fichier de plus de 3 Mo reste seulement sur cet appareil'); } continue; }
      await api('blob', { method: 'PUT', body: JSON.stringify({ id, type: b.type, data: await toB64(b) }) });
    }
  } catch (e) { console.error(e); } finally { blobsBusy = false; }
}
function remoteBlobs(token?: string) {
  remote.fetch = async id => {
    const r = await fetch(`/api/a?x=blob&id=${encodeURIComponent(id)}${token ? '&t=' + token : ''}`, { credentials: 'same-origin' });
    return r.ok ? r.blob() : null;
  };
}

// ---------- démarrage ----------
async function config() {
  try { const c = await api('config'); setC({ clientId: c.googleClientId }); } catch { /* API absente */ }
}

/** Mode normal : document local, synchronisé si l'utilisateur est connecté. */
export async function initCloud() {
  await config();
  try { const { user } = await api('me'); if (user) { setC({ user }); await firstSync(); } } catch { /* hors ligne */ }
  setC({ ready: true });
}

async function firstSync() {
  const u = useCloud.getState().user;
  uid = u.id;
  mode = 'owner';
  setC({ status: 'sync' });
  try {
    const st: any = await kvGet('sync:' + uid).catch(() => null);
    if (st) { known = st.known || {}; cursor = st.cursor || { sc: 0, sb: 0 }; metaHash = st.metaHash || ''; }
    remoteBlobs();
    // 1) on envoie d'abord le travail de cet appareil, 2) puis on reçoit ce qui a changé ailleurs.
    // Si l'envoi échoue, rien n'est écrasé : le travail local reste intact et sera renvoyé.
    try { await pushOwner(); } catch (e) { console.error(e); setC({ status: 'err' }); dirty = true; pushTimer = setTimeout(push, 15000); }
    await pullOwner(true);
    hooks.afterSave = schedulePush;
    if (!dirty) setC({ status: 'ok' });
    uploadBlobs();
    startPull();
  } catch (e) { console.error(e); setC({ status: 'err' }); hooks.afterSave = schedulePush; startPull(); }
}

/** Mode lien partagé : on n'affiche que la planche partagée, sans toucher aux données locales du visiteur. */
export async function startShared(token: string, seed: any) {
  await config();
  try { const { user } = await api('me'); setC({ user }); } catch { /* ignoré */ }
  let r: any;
  try { r = await api('share&t=' + token); } catch (e: any) {
    setC({ ready: true, needLogin: e.status === 401, shareError: e.status === 401 ? 'Connectez-vous avec le compte Google invité pour ouvrir cette planche.' : e.message });
    return false;
  }
  mode = 'shared';
  setC({ share: { token, role: r.role }, ready: true });
  hooks.forceReadOnly = r.role !== 'edit';
  hooks.saveTarget = r.role === 'edit' ? schedulePush : () => { /* lecture seule */ };
  remoteBlobs(token);
  await loadDoc(seed, r.doc);
  sharedIds = new Set([...Object.keys(r.doc.cards), ...Object.keys(r.doc.boards)]);
  shareRev = r.rev;
  void sharedKnown;
  if (!location.hash.startsWith('#/b/')) location.hash = '#/b/root';
  applyHash();
  startPull();
  return true;
}

/** Page ouverte par l'app de bureau dans le navigateur : on connecte puis on renvoie la session à l'app. */
export async function startDesktopHandoff(port: string, state: string) {
  await config();
  const go = async () => {
    const { t } = await api('handoff');
    location.replace(`http://127.0.0.1:${encodeURIComponent(port)}/cb?state=${encodeURIComponent(state)}&t=${encodeURIComponent(t)}`);
  };
  try {
    const { user } = await api('me');
    if (user) { setC({ ready: true, shareError: 'Connexion à l’app Atelier…' }); return go(); }
  } catch { /* ignoré */ }
  setC({ ready: true, needLogin: true, shareError: 'Connectez-vous avec Google pour ouvrir votre compte dans l’app Atelier.' });
}

export async function onGoogleCredential(credential: string) {
  try {
    const { user } = await api('login', { method: 'POST', body: JSON.stringify({ credential }) });
    setC({ user });
    if (useCloud.getState().share || useCloud.getState().needLogin) return location.reload();
    toast('Connecté : ' + user.email);
    await firstSync();
  } catch (e: any) { toast('Connexion impossible : ' + e.message); }
}

export async function logout() {
  await api('logout').catch(() => null);
  hooks.afterSave = null;
  remote.fetch = null;
  mode = null;
  clearInterval(pullTimer);
  setC({ user: null, status: 'off' });
  if (useCloud.getState().share) location.reload();
}

export const shareUrl = (token: string) => `${location.origin}/?partage=${token}`;
