// Synchronisation en ligne : connexion Google, copie du document sur le serveur, planches partagées.
import { create } from 'zustand';
import { useStore, hooks, applyRemote, loadDoc, applyHash, toast } from './store';
import { remote, blobKeys, blobGet } from './db';

type Status = 'off' | 'sync' | 'ok' | 'err';
export const useCloud = create<{
  user: any; status: Status; clientId: string | null; ready: boolean;
  share: null | { token: string; role: 'view' | 'edit' }; needLogin: boolean; shareError: string | null;
}>(() => ({ user: null, status: 'off', clientId: null, ready: false, share: null, needLogin: false, shareError: null }));
const setC = useCloud.setState;

export async function api(x: string, opts: RequestInit = {}) {
  const r = await fetch('/api/a?x=' + x, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { status: r.status });
  return j;
}

let synced = new Set<string>();
let dirty = false, pushing = false, again = false, pushTimer: any = null;
const idsOf = (d: any) => [...Object.keys(d.cards || {}), ...Object.keys(d.boards || {})];
const target = () => (useCloud.getState().share ? 'share&t=' + useCloud.getState().share!.token : 'doc');
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

function schedulePush() {
  dirty = true;
  setC({ status: 'sync' });
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}

async function push() {
  if (pushing) { again = true; return; }
  pushing = true;
  try {
    const s = useStore.getState();
    const owner = !useCloud.getState().share;
    const doc: any = { boards: s.boards, cards: s.cards };
    if (owner) { doc.settings = s.settings; doc.viewports = s.viewports; }
    const cur = new Set(idsOf(doc));
    const deleted = [...synced].filter(i => !cur.has(i));
    const r = await api(target(), { method: 'PUT', body: JSON.stringify({ doc, deleted }) });
    synced = new Set(idsOf(r.doc));
    const now = useStore.getState();
    if (now.cards === s.cards && now.boards === s.boards) {
      dirty = false;
      if (!same(r.doc.cards, s.cards) || !same(r.doc.boards, s.boards)) applyRemote({ boards: r.doc.boards, cards: r.doc.cards });
    }
    setC({ status: 'ok' });
    if (owner) uploadBlobs();
  } catch (e: any) {
    console.error(e);
    setC({ status: 'err' });
  } finally {
    pushing = false;
    if (again) { again = false; push(); }
  }
}

/** Récupère régulièrement les modifications faites ailleurs (autre appareil, personne invitée). */
async function pull() {
  if (dirty || pushing || document.hidden) return;
  try {
    const s = useStore.getState();
    const r = await api(target());
    if (!r.doc || dirty || pushing) return;
    const now = useStore.getState();
    if (now.cards !== s.cards || now.boards !== s.boards) return;
    synced = new Set(idsOf(r.doc));
    if (!same(r.doc.cards, s.cards) || !same(r.doc.boards, s.boards)) applyRemote({ boards: r.doc.boards, cards: r.doc.cards });
    setC({ status: 'ok' });
  } catch { /* réseau : on réessaiera */ }
}
let pullTimer: any = null;
function startPull() {
  clearInterval(pullTimer);
  pullTimer = setInterval(pull, 8000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
}

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
  setC({ status: 'sync' });
  try {
    const { doc } = await api('doc');
    const key = 'atl_linked_' + u.id;
    const s = useStore.getState();
    if (doc && !localStorage.getItem(key)) {
      const merge = confirm('Votre compte contient déjà des planches.\n\nOK : ajouter aussi les planches de ce navigateur à votre compte.\nAnnuler : afficher seulement celles du compte.');
      if (!merge) { applyRemote(doc); synced = new Set(idsOf(doc)); }
    } else if (doc) {
      applyRemote({ boards: doc.boards, cards: doc.cards });
      synced = new Set(idsOf(doc));
    }
    localStorage.setItem(key, '1');
    void s;
    hooks.afterSave = schedulePush;
    remoteBlobs();
    await push();
    startPull();
  } catch (e) { console.error(e); setC({ status: 'err' }); }
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
  setC({ share: { token, role: r.role }, ready: true });
  hooks.forceReadOnly = r.role !== 'edit';
  hooks.saveTarget = r.role === 'edit' ? schedulePush : () => { /* lecture seule */ };
  remoteBlobs(token);
  await loadDoc(seed, r.doc);
  synced = new Set(idsOf(r.doc));
  if (!location.hash.startsWith('#/b/')) location.hash = '#/b/root';
  applyHash();
  startPull();
  return true;
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
  clearInterval(pullTimer);
  setC({ user: null, status: 'off' });
  if (useCloud.getState().share) location.reload();
}

export const shareUrl = (token: string) => `${location.origin}/?partage=${token}`;
