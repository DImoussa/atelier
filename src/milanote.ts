// Import depuis Milanote.
// 1. Un favori (« bookmarklet ») lancé sur une planche Milanote lit les éléments que l'app Milanote a en
//    mémoire, ouvre une à une les sous-planches pas encore chargées, récupère les images, puis télécharge
//    un fichier « milanote-dump ». Tout se passe dans le navigateur de la personne, avec sa propre session.
// 2. Atelier convertit ce fichier en planche (menu ⋯ → Importer une planche).
import { DEFAULT_W } from './types';

const G = 9; // une unité de grille Milanote ≈ 9 px

// ---------- 1. Favori : code exécuté sur app.milanote.com ----------
async function exportFromMilanote() {
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:999999;top:16px;left:0;right:0;margin:auto;width:fit-content;max-width:90vw;background:#2f3a45;color:#fff;font:14px system-ui;padding:12px 18px;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.3)';
  document.body.appendChild(box);
  const say = (t: string) => { box.textContent = 'Export vers Atelier : ' + t; };
  try {
    let store: any = null;
    for (const el of Array.from(document.querySelectorAll('body, body *')).slice(0, 80)) {
      const k = Object.keys(el).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
      if (!k) continue;
      let f: any = (el as any)[k];
      if (f && f.stateNode && f.stateNode.current) f = f.stateNode.current;
      const stack = [f]; let n = 0;
      while (stack.length && n++ < 20000 && !store) {
        const x = stack.pop(); if (!x) continue;
        const p = x.memoizedProps;
        if (p && p.store && p.store.getState) store = p.store;
        else if (p && p.value && p.value.store && p.value.store.getState) store = p.value.store;
        if (x.child) stack.push(x.child); if (x.sibling) stack.push(x.sibling);
      }
      if (store) break;
    }
    if (!store) throw new Error('ouvrez une planche Milanote puis relancez le favori');
    const all = (): Record<string, any> => { const e = store.getState().get('elements'); return e && e.toJS ? e.toJS() : e; };
    const idOf = (e: any) => e._id || e.id;
    const kids = (E: Record<string, any>, id: string) => Object.values(E).filter((e: any) => e.location && e.location.parentId === id);
    const start = location.pathname + location.search;
    const root = location.pathname.split('/')[1];
    const go = (path: string) => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate', { state: {} })); };

    // ouvre chaque sous-planche pour que Milanote charge son contenu
    const queue = [root], seen = new Set<string>();
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      say(`lecture des planches (${seen.size})…`);
      let k = kids(all(), id);
      if (!k.length && id !== root) {
        go('/' + id);
        for (let t = 0; t < 24 && !k.length; t++) { await sleep(250); k = kids(all(), id); }
      }
      const E = all();
      const scan = (list: any[]) => { for (const e of list) { if (e.elementType === 'BOARD') queue.push(idOf(e)); if (e.elementType === 'COLUMN') scan(kids(E, idOf(e))); } };
      scan(k);
    }
    go(start);

    // tous les éléments de l'arbre
    const E = all();
    const out: any[] = [];
    const take = (id: string) => { for (const e of kids(E, id)) { out.push(e); if (e.elementType === 'BOARD' || e.elementType === 'COLUMN') take(idOf(e)); } };
    take(root);

    // les images restent sur les serveurs de Milanote (adresses publiques) : le fichier reste léger
    const blobs: Record<string, string> = {};
    const rootEl = E[root];
    const title = (rootEl && rootEl.content && rootEl.content.title) || document.title.replace(/ - Milanote$/, '') || 'Milanote';
    const file = { format: 'milanote-dump', version: 1, root, title, elements: out, blobs, exportedAt: new Date().toISOString() };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
    a.download = title.replace(/[\\/:*?"<>|]+/g, '-') + '.milanote.json';
    document.body.appendChild(a); a.click(); a.remove();
    say(`terminé : ${out.length} éléments sur ${seen.size} planches. Importez le fichier dans Atelier (⋯ → Importer une planche).`);
    setTimeout(() => box.remove(), 15000);
  } catch (err: any) {
    say('erreur : ' + (err && err.message || err));
    setTimeout(() => box.remove(), 15000);
  }
}

export const bookmarkletCode = 'javascript:(' + exportFromMilanote.toString() + ')();void 0';

// ---------- 2. Conversion dans Atelier ----------
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function pmText(n: any): string {
  if (!n) return '';
  if (n.type === 'text') return n.text || '';
  if (n.type === 'hardBreak') return '\n';
  return (n.content || []).map(pmText).join(n.type === 'doc' ? '\n' : '');
}

function pmInline(n: any): string {
  if (n.type === 'hardBreak') return '<br>';
  if (n.type !== 'text') return (n.content || []).map(pmInline).join('');
  let h = esc(n.text || '');
  for (const m of n.marks || []) {
    if (m.type === 'bold' || m.type === 'strong') h = `<b>${h}</b>`;
    else if (m.type === 'italic' || m.type === 'em') h = `<i>${h}</i>`;
    else if (m.type === 'underline') h = `<u>${h}</u>`;
    else if (m.type === 'strike' || m.type === 'strikethrough') h = `<s>${h}</s>`;
    else if (m.type === 'code') h = `<code>${h}</code>`;
    else if (m.type === 'link' && /^https?:\/\//.test(m.attrs?.href || '')) h = `<a href="${esc(m.attrs.href)}">${h}</a>`;
  }
  return h;
}

function pmHtml(n: any): string {
  if (!n) return '';
  const inner = () => (n.content || []).map(pmHtml).join('');
  switch (n.type) {
    case 'doc': return inner();
    case 'paragraph': return `<p>${(n.content || []).map(pmInline).join('') || '<br>'}</p>`;
    case 'heading': { const l = Math.min(3, Math.max(1, n.attrs?.level || 2)); return `<h${l}>${(n.content || []).map(pmInline).join('')}</h${l}>`; }
    case 'bulletList': return `<ul>${inner()}</ul>`;
    case 'orderedList': return `<ol>${inner()}</ol>`;
    case 'listItem': return `<li>${inner()}</li>`;
    case 'blockquote': return `<blockquote>${inner()}</blockquote>`;
    case 'taskList': return `<ul>${inner()}</ul>`;
    case 'taskItem': return `<li>${n.attrs?.checked ? '☑' : '☐'} ${(n.content || []).map(c => (c.content || []).map(pmInline).join('')).join(' ')}</li>`;
    case 'taskListTitle': return `<p><b>${(n.content || []).map(pmInline).join('')}</b></p>`;
    case 'text': case 'hardBreak': return pmInline(n);
    default: return inner();
  }
}

function tasks(doc: any) {
  const items: any[] = [];
  let title = '';
  const walk = (n: any) => {
    if (!n) return;
    if (n.type === 'taskListTitle') title = pmText(n);
    else if (n.type === 'taskItem') items.push({ id: n.attrs?.taskId || Math.random().toString(36).slice(2), text: pmText(n).trim(), done: !!n.attrs?.checked, due: n.attrs?.dueDate || null, assignee: null });
    else (n.content || []).forEach(walk);
  };
  walk(doc);
  return { title, items };
}

/** Convertit un fichier « milanote-dump » en fichier « atelier-board » importable. */
export function milanoteToAtelier(dump: any) {
  const els: any[] = dump.elements || [];
  const idOf = (e: any) => e._id || e.id;
  const byId = new Map(els.map(e => [idOf(e), e]));
  const blobs: Record<string, string> = dump.blobs || {};
  const now = Date.now();
  const boards: any[] = [];
  const cards: any[] = [];
  const roots: string[] = [];

  // tri par « score » Milanote : sert d'ordre d'empilement et d'ordre dans les colonnes
  const score = (e: any) => e.location?.position?.score ?? e.location?.position?.index ?? 0;
  const sorted = [...els].sort((a, b) => score(a) - score(b));

  // les éléments « à trier » (INBOX) d'une planche sont rangés dans une colonne créée pour eux
  const inboxCol = new Map<string, string>();
  const inboxOf = (boardId: string) => {
    if (!inboxCol.has(boardId)) {
      const id = 'inbox-' + boardId;
      inboxCol.set(boardId, id);
      const siblings = els.filter(e => e.location?.parentId === boardId && e.location?.section === 'CANVAS');
      const minX = siblings.length ? Math.min(...siblings.map(e => e.location?.position?.x ?? 0)) * G : 0;
      const minY = siblings.length ? Math.min(...siblings.map(e => e.location?.position?.y ?? 0)) * G : 0;
      cards.push({ id, type: 'column', parent: 'b-' + boardId, x: minX - 320, y: minY, w: DEFAULT_W.column, z: 0, order: 0, color: null, data: { title: 'À trier (Milanote)', collapsed: false }, createdAt: now, updatedAt: now, trashed: null });
      if (boardId === dump.root) roots.push(id);
    }
    return inboxCol.get(boardId)!;
  };

  let z = 0;
  const orderIn = new Map<string, number>();
  for (const e of sorted) {
    const id = idOf(e);
    const loc = e.location || {};
    const c = e.content || {};
    const parentEl = byId.get(loc.parentId);
    // une planche et sa carte ont des identifiants distincts (« b-… » pour la planche)
    const parentIsColumn = parentEl?.elementType === 'COLUMN';
    let parent = parentIsColumn ? loc.parentId : 'b-' + loc.parentId;
    let inColumn = parentIsColumn;
    if (loc.section === 'INBOX' && !parentIsColumn) { parent = inboxOf(loc.parentId); inColumn = true; }
    const pos = loc.position || {};
    const base = {
      id, parent, x: Math.round((pos.x || 0) * G), y: Math.round((pos.y || 0) * G), z: ++z,
      order: inColumn ? (orderIn.set(parent, (orderIn.get(parent) || 0) + 1), orderIn.get(parent)!) : 0,
      color: null, createdAt: e.meta?.createdTime || now, updatedAt: now, trashed: null,
    };
    const width = (t: string) => (c.width ? Math.max(120, Math.round(c.width * G)) : (DEFAULT_W as any)[t]);
    let card: any = null;
    switch (e.elementType) {
      case 'CARD':
        card = { ...base, type: 'note', w: width('note'), data: { html: pmHtml(c.textContent) || '<p><br></p>' } };
        break;
      case 'TASK_LIST': {
        const t = tasks(c.textContent);
        card = { ...base, type: 'todo', w: width('todo'), data: { title: c.title || t.title || '', items: t.items.length ? t.items : [{ id: 'x' + id, text: '', done: false }] } };
        break;
      }
      case 'LINK':
        card = { ...base, type: 'link', w: width('link'), data: { url: c.link?.url || c.url || '', title: c.title || c.link?.title || '', description: c.description || '' } };
        break;
      case 'IMAGE': {
        const img = c.image || {};
        card = { ...base, type: 'image', w: width('image'), data: { blobId: blobs[id] ? id : null, src: blobs[id] ? null : (img.large || img.regular || img.original || null), ratio: img.width && img.height ? img.height / img.width : 0.66, caption: c.caption ? pmText(c.caption) : '', name: c.file?.filename || '' } };
        break;
      }
      case 'FILE':
        // le fichier reste chez Milanote : on garde un lien pour le télécharger
        card = { ...base, type: 'link', w: width('link'), data: { url: c.file?.url || '', title: '📎 ' + (c.file?.filename || 'Fichier'), description: c.file?.size ? `${Math.round(c.file.size / 1e5) / 10} Mo` : '' } };
        break;
      case 'COLUMN':
        card = { ...base, type: 'column', w: width('column'), data: { title: c.title || '', collapsed: c.inbox === 'CLOSED' && false } };
        break;
      case 'BOARD':
        // icône et photo de couverture de la planche : on garde les adresses d'origine
        boards.push({ id: 'b-' + id, title: c.title || 'Planche', icon: c.icon?.png || '✦', color: c.color || '#4a86c7', createdAt: base.createdAt, cover: c.image?.regular || c.image?.original || null });
        card = { ...base, type: 'board', w: width('board'), data: { boardId: 'b-' + id } };
        break;
      case 'DOCUMENT':
        card = { ...base, type: 'document', w: width('document'), data: { title: c.title || 'Document', html: pmHtml(c.textContent) } };
        break;
      case 'TABLE': {
        const rows = (c.tableContent?.data || []).map((r: any[]) => r.map(cell => String(cell?.value ?? '')));
        card = { ...base, type: 'table', w: width('table'), data: { rows: rows.length ? rows : [['']], header: true } };
        break;
      }
      case 'LINE': {
        const end = (p: any) => ({ cardId: p?.elementId && byId.has(p.elementId) ? p.elementId : null, x: Math.round(((pos.x || 0) + (p?.x || 0)) * G), y: Math.round(((pos.y || 0) + (p?.y || 0)) * G) });
        card = { ...base, type: 'line', w: 0, data: { from: end(c.start), to: end(c.end), curve: { x: 0, y: 0 }, color: '#5d6b78', width: c.lineWeight || 2, arrowEnd: c.endStyle === 'ARROW', arrowStart: c.startStyle === 'ARROW', dashed: !!c.lineStyle && c.lineStyle !== 'SOLID', label: '' } };
        break;
      }
      case 'ALIAS':
        card = { ...base, type: 'note', w: width('note'), data: { html: `<p>↪ ${esc(c.caption ? pmText(c.caption) : 'Raccourci vers une planche Milanote')}</p>` } };
        break;
    }
    if (!card) continue;
    cards.push(card);
    if (parent === 'b-' + dump.root) roots.push(id);
  }
  // les lignes rattachées à une carte non importée gardent leurs coordonnées
  const ids = new Set(cards.map(c => c.id));
  for (const c of cards) if (c.type === 'line') for (const k of ['from', 'to']) if (c.data[k].cardId && !ids.has(c.data[k].cardId)) c.data[k].cardId = null;
  return {
    format: 'atelier-board', version: 1,
    board: { title: dump.title || 'Import Milanote', icon: '✦', color: '#4a86c7' },
    payload: { cards, boards, roots },
    blobs: Object.fromEntries(Object.entries(blobs).filter(([k]) => ids.has(k))),
  };
}
