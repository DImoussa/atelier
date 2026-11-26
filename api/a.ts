// API unique d'Atelier (fonction Vercel). Route : /api/a?x=<action>
// Connexion Google -> cookie de session signé ; données dans MongoDB.
//
// Stockage : une carte = un document (atelier_cards), une planche = un document (atelier_boards).
// Aucune limite de taille globale : un projet peut grossir sans jamais être renvoyé en entier.
// Les suppressions ne retirent rien de la base : elles posent un marqueur (d:true), donc récupérable.
import { MongoClient, Db } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'crypto';
import { gzipSync, gunzipSync } from 'zlib';

const ROOT = 'root';
/** Préfixe des collections (Atelier partage la base du CRM). */
const P = process.env.COLLECTION_PREFIX ?? 'atelier_';
let dbp: Promise<Db> | null = null;
function db(): Promise<Db> {
  if (!dbp) dbp = new MongoClient(process.env.MONGODB_URI!).connect().then(async c => {
    const d = c.db(process.env.MONGODB_DB || 'atelier');
    // index pour lire vite « ce qui a changé » (sans eux, ça marche mais devient lent avec des milliers de cartes)
    await Promise.all([
      d.collection(P + 'cards').createIndex({ o: 1, s: 1 }),
      d.collection(P + 'boards').createIndex({ o: 1, s: 1 }),
      d.collection(P + 'cards').createIndex({ o: 1, d: 1 }),
    ]).catch(e => console.error('index', e.message));
    return d;
  }).catch(e => { dbp = null; throw e; });
  return dbp;
}
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-only-secret-change-me');
const gclient = new OAuth2Client();

type User = { id: string; email: string; name: string; picture?: string };
type Doc = { boards: Record<string, any>; cards: Record<string, any> };

// ---------- utilitaires HTTP ----------
function send(res: any, code: number, body: any, headers: Record<string, string> = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  const json = Buffer.from(JSON.stringify(body));
  // Vercel limite les réponses à 4,5 Mo : les gros blocs sont compressés (le navigateur décompresse seul).
  if (json.length > 200_000 && /gzip/.test(String(res.req?.headers?.['accept-encoding'] || ''))) {
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    return res.end(gzipSync(json));
  }
  res.end(json);
}
async function readBody(req: any): Promise<any> {
  if (req.headers['x-gz']) {
    // corps compressé par le navigateur
    let raw: Buffer;
    if (Buffer.isBuffer(req.body)) raw = req.body;
    else { const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer); raw = Buffer.concat(chunks); }
    return JSON.parse(gunzipSync(raw).toString('utf8') || '{}');
  }
  if (req.body !== undefined) return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const t = Buffer.concat(chunks).toString('utf8');
  return t ? JSON.parse(t) : {};
}
function cookie(req: any, name: string) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
async function currentUser(req: any): Promise<User | null> {
  const t = cookie(req, 'atl_s');
  if (!t) return null;
  try { const { payload } = await jwtVerify(t, secret()); return payload.u as User; } catch { return null; }
}
const secure = () => (process.env.VERCEL ? '; Secure' : '');

// ---------- stockage ----------
const col = (d: Db, n: string) => d.collection(P + n);
/** Horloge serveur croissante : sert de curseur pour ne renvoyer que ce qui a changé. */
/** (millisecondes × 1000 reste sous 2^53 : exact en JavaScript, contrairement à ×10000) */
let lastBase = 0;
function nextBase(count: number) { const b = Math.max(Date.now() * 1000, lastBase); lastBase = b + count + 10; return b; }
const ignoreDup = (e: any) => { if (!(e && (e.code === 11000 || (e.writeErrors && e.writeErrors.every((w: any) => w.code === 11000))))) throw e; };

/** Écrit des cartes/planches et pose des marqueurs de suppression. La version la plus récente d'une carte gagne. */
async function writeDoc(d: Db, owner: string, cards: any[], boards: any[], deleted: string[]) {
  const base = nextBase(cards.length + boards.length + 2);
  let n = 0;
  for (let i = 0; i < cards.length; i += 1000) {
    const ops = cards.slice(i, i + 1000).map(c => ({
      updateOne: {
        filter: { _id: `${owner}:${c.id}` as any, $or: [{ u: { $lte: c.updatedAt || 0 } }, { u: { $exists: false } }] },
        update: { $set: { o: owner, id: c.id, c, u: c.updatedAt || 0, s: base + n++, d: false } },
        upsert: true,
      },
    }));
    if (ops.length) await col(d, 'cards').bulkWrite(ops, { ordered: false }).catch(ignoreDup);
  }
  for (let i = 0; i < boards.length; i += 1000) {
    const ops = boards.slice(i, i + 1000).map(b => ({
      updateOne: { filter: { _id: `${owner}:${b.id}` as any }, update: { $set: { o: owner, id: b.id, b, s: base + n++, d: false } }, upsert: true },
    }));
    if (ops.length) await col(d, 'boards').bulkWrite(ops, { ordered: false }).catch(ignoreDup);
  }
  if (deleted.length) {
    const keys = deleted.map(id => `${owner}:${id}`);
    const stamp = { d: true, u: Date.now(), s: base + n++ };
    await col(d, 'cards').updateMany({ _id: { $in: keys } as any }, { $set: stamp });
    await col(d, 'boards').updateMany({ _id: { $in: keys } as any }, { $set: stamp });
  }
}

/** Document complet d'un propriétaire (cartes et planches non supprimées). */
async function loadFull(d: Db, owner: string): Promise<Doc> {
  const cards: Record<string, any> = {}, boards: Record<string, any> = {};
  for await (const x of col(d, 'cards').find({ o: owner, d: { $ne: true } })) cards[x.id] = x.c;
  for await (const x of col(d, 'boards').find({ o: owner, d: { $ne: true } })) boards[x.id] = x.b;
  return { boards, cards };
}

/** Ancien format (un seul gros document par personne) : on le convertit une fois. */
async function migrate(d: Db, owner: string) {
  const ws: any = await col(d, 'workspaces').findOne({ _id: owner as any });
  if (!ws || !ws.doc) return;
  await writeDoc(d, owner, Object.values(ws.doc.cards || {}), Object.values(ws.doc.boards || {}), []);
  await col(d, 'workspaces').updateOne({ _id: owner as any }, { $set: { settings: ws.doc.settings ?? null, viewports: ws.doc.viewports ?? null }, $unset: { doc: '' } });
}
const bump = (d: Db, owner: string, extra: any = {}) =>
  col(d, 'workspaces').findOneAndUpdate({ _id: owner as any }, { $inc: { rev: 1 }, $set: { updatedAt: new Date(), ...extra } }, { upsert: true, returnDocument: 'after' });

// ---------- logique des planches ----------
/** Planche d'une carte : son parent, ou la planche de sa colonne. */
function boardOf(c: any, doc: Doc) {
  const p = doc.cards[c.parent];
  return p && p.type === 'column' ? p.parent : c.parent;
}
/** Ids des planches incluses dans b (b et ses sous-planches). */
function subBoards(doc: Doc, b: string) {
  const out = new Set([b]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of Object.values(doc.cards)) {
      if (c.type === 'board' && c.data?.boardId && !out.has(c.data.boardId) && out.has(boardOf(c, doc))) { out.add(c.data.boardId); changed = true; }
    }
  }
  return out;
}
/** Extrait la planche b et son contenu ; b est renommée "root" pour le visiteur. */
function extract(doc: Doc, b: string): Doc {
  const set = subBoards(doc, b);
  const map = (id: string) => (id === b ? ROOT : id);
  const boards: any = {}, cards: any = {};
  for (const id of set) if (doc.boards[id]) boards[map(id)] = { ...doc.boards[id], id: map(id) };
  for (const c of Object.values(doc.cards)) if (set.has(boardOf(c, doc)) || set.has(c.parent)) cards[c.id] = { ...c, parent: map(c.parent) };
  return { boards, cards };
}
/** Modifications faites par une personne invitée : ce qui est autorisé à être écrit dans le document du propriétaire. */
function sharedChanges(owner: Doc, b: string, incoming: Doc, deleted: string[]) {
  const back = (id: string) => (id === ROOT ? b : id);
  const inc: Doc = { boards: {}, cards: {} };
  for (const [id, v] of Object.entries(incoming.boards || {})) inc.boards[back(id)] = { ...(v as any), id: back(id) };
  for (const c of Object.values(incoming.cards || {})) inc.cards[(c as any).id] = { ...(c as any), parent: back((c as any).parent) };
  const both: Doc = { boards: owner.boards, cards: { ...owner.cards, ...inc.cards } };
  const allowed = subBoards(both, b);
  for (const id of Object.keys(inc.cards)) { const c = inc.cards[id]; if (!allowed.has(boardOf(c, both)) && !allowed.has(c.parent)) delete inc.cards[id]; }
  for (const id of Object.keys(inc.boards)) if (!allowed.has(id) || id === b) delete inc.boards[id];
  const inSub = extract(owner, b);
  const del = (deleted || []).filter(id => inSub.cards[id] && !incoming.cards?.[id]);
  return { cards: Object.values(inc.cards), boards: Object.values(inc.boards), del };
}

async function loadShare(req: any, token: string) {
  const d = await db();
  const sh: any = await col(d, 'shares').findOne({ _id: token as any });
  if (!sh) return { error: 404 as const };
  if (sh.emails?.length) {
    const u = await currentUser(req);
    if (!u) return { error: 401 as const };
    if (u.id !== sh.owner && !sh.emails.includes(u.email.toLowerCase())) return { error: 403 as const };
  }
  return { sh, d };
}

// ---------- routes ----------
export default async function handler(req: any, res: any) {
  try {
    const url = new URL(req.url, 'http://x');
    const x = url.searchParams.get('x');
    const method = req.method;

    if (x === 'config') return send(res, 200, { googleClientId: process.env.GOOGLE_CLIENT_ID || null });

    if (x === 'login' && method === 'POST') {
      const { credential } = await readBody(req);
      const ticket = await gclient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      const p = ticket.getPayload();
      if (!p?.sub || !p.email_verified) return send(res, 401, { error: 'Compte Google non vérifié' });
      const u: User = { id: p.sub, email: p.email!.toLowerCase(), name: p.name || p.email!, picture: p.picture };
      await col(await db(), 'users').updateOne({ _id: u.id as any }, { $set: { ...u, lastLogin: new Date() } }, { upsert: true });
      const jwt = await new SignJWT({ u }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('30d').sign(secret());
      return send(res, 200, { user: u }, { 'Set-Cookie': `atl_s=${jwt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure()}` });
    }
    if (x === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': `atl_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}` });

    // ---- planche partagée (lien) ----
    if (x === 'share') {
      const token = url.searchParams.get('t') || '';
      const r = await loadShare(req, token);
      if ('error' in r) return send(res, r.error, { error: r.error === 401 ? 'Connexion requise' : r.error === 403 ? 'Accès refusé' : 'Lien introuvable' });
      const { sh, d } = r;
      await migrate(d, sh.owner);
      const ws: any = await col(d, 'workspaces').findOne({ _id: sh.owner });
      if (method === 'GET') {
        if (ws && url.searchParams.get('rev') === String(ws.rev)) return send(res, 200, { same: true, rev: ws.rev });
        const full = await loadFull(d, sh.owner);
        if (!full.boards[sh.board]) return send(res, 404, { error: 'Planche supprimée' });
        return send(res, 200, { role: sh.role, doc: extract(full, sh.board), rev: ws?.rev || 0 });
      }
      if (method === 'PUT') {
        if (sh.role !== 'edit') return send(res, 403, { error: 'Lecture seule' });
        const body = await readBody(req);
        const full = await loadFull(d, sh.owner);
        if (!full.boards[sh.board]) return send(res, 404, { error: 'Planche supprimée' });
        const ch = sharedChanges(full, sh.board, body.doc, body.deleted);
        await writeDoc(d, sh.owner, ch.cards, ch.boards, ch.del);
        const after = await bump(d, sh.owner);
        const fresh = await loadFull(d, sh.owner);
        return send(res, 200, { doc: extract(fresh, sh.board), rev: (after as any)?.rev });
      }
    }
    if (x === 'blob' && method === 'GET') {
      const id = url.searchParams.get('id') || '';
      const token = url.searchParams.get('t');
      let owner: string | null = null;
      if (token) { const r = await loadShare(req, token); if ('error' in r) return send(res, r.error, {}); owner = r.sh.owner; }
      else owner = (await currentUser(req))?.id || null;
      if (!owner) return send(res, 401, {});
      const b: any = await col(await db(), 'blobs').findOne({ _id: `${owner}:${id}` as any });
      if (!b) return send(res, 404, {});
      res.statusCode = 200;
      res.setHeader('Content-Type', b.type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return res.end(Buffer.from(b.data.buffer ?? b.data));
    }

    // ---- tout le reste demande d'être connecté ----
    const u = await currentUser(req);
    if (x === 'me') return send(res, 200, { user: u });
    if (!u) return send(res, 401, { error: 'Connexion requise' });
    const d = await db();

    // Aperçu d'un lien : titre, description et image de la page (réservé aux comptes connectés)
    if (x === 'unfurl') {
      try {
        const target = new URL(url.searchParams.get('u') || '');
        if (!/^https?:$/.test(target.protocol)) return send(res, 400, {});
        const { lookup } = await import('dns/promises');
        const ip = (await lookup(target.hostname)).address;
        if (/^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|f[cd])/i.test(ip)) return send(res, 400, {});
        const r = await fetch(target.href, { redirect: 'follow', signal: AbortSignal.timeout(6000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Twitterbot/1.0)', 'Accept-Language': 'fr,en;q=0.8' } });
        const html = (await r.text()).slice(0, 400_000);
        const meta = (k: string) => {
          const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${k}["'][^>]*content=["']([^"']*)["']`, 'i')) || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${k}["']`, 'i'));
          return m ? m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'") : '';
        };
        let image = meta('og:image') || meta('twitter:image');
        if (image) { try { image = new URL(image, target.href).href; } catch { image = ''; } }
        const title = meta('og:title') || meta('twitter:title') || (html.match(/<title[^>]*>([^<]*)/i)?.[1] || '').trim();
        return send(res, 200, { title, description: meta('og:description') || meta('description'), image });
      } catch { return send(res, 200, {}); }
    }

    // App de bureau : remet la session au petit serveur local de l'app (127.0.0.1 uniquement, côté navigateur).
    if (x === 'handoff') return send(res, 200, { t: cookie(req, 'atl_s') });

    if (x === 'doc') {
      await migrate(d, u.id);
      if (method === 'GET') {
        // Ne renvoie que ce qui a changé depuis le curseur (sc pour les cartes, sb pour les planches), par blocs.
        const sc = Number(url.searchParams.get('sc') || 0), sb = Number(url.searchParams.get('sb') || 0);
        const LIMIT = 1500;
        const cs = await col(d, 'cards').find({ o: u.id, s: { $gt: sc } }).sort({ s: 1 }).limit(LIMIT).toArray();
        const bs = await col(d, 'boards').find({ o: u.id, s: { $gt: sb } }).sort({ s: 1 }).limit(LIMIT).toArray();
        const ws: any = await col(d, 'workspaces').findOne({ _id: u.id as any });
        return send(res, 200, {
          cards: cs.filter(x => !x.d).map(x => x.c), boards: bs.filter(x => !x.d).map(x => x.b),
          deleted: [...cs, ...bs].filter(x => x.d).map(x => x.id),
          sc: cs.length ? cs[cs.length - 1].s : sc, sb: bs.length ? bs[bs.length - 1].s : sb,
          more: cs.length === LIMIT || bs.length === LIMIT,
          settings: ws?.settings ?? null, viewports: ws?.viewports ?? null, rev: ws?.rev || 0,
        });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        await writeDoc(d, u.id, body.cards || [], body.boards || [], body.deleted || []);
        const extra: any = { email: u.email };
        if (body.settings !== undefined) extra.settings = body.settings;
        if (body.viewports !== undefined) extra.viewports = body.viewports;
        const ws: any = await bump(d, u.id, extra);
        return send(res, 200, { rev: ws?.rev });
      }
    }
    if (x === 'blobs' && method === 'POST') {
      // liste des fichiers déjà envoyés
      const { ids } = await readBody(req);
      const have = await col(d, 'blobs').find({ _id: { $in: (ids || []).map((i: string) => `${u.id}:${i}`) } as any }, { projection: { _id: 1 } }).toArray();
      return send(res, 200, { have: have.map(h => String(h._id).split(':').slice(1).join(':')) });
    }
    if (x === 'blob' && method === 'PUT') {
      const { id, type, data } = await readBody(req);
      await col(d, 'blobs').updateOne({ _id: `${u.id}:${id}` as any }, { $set: { owner: u.id, type, data: Buffer.from(data, 'base64') } }, { upsert: true });
      return send(res, 200, { ok: true });
    }
    if (x === 'shares') {
      const c = col(d, 'shares');
      if (method === 'GET') {
        const board = url.searchParams.get('board');
        const list = await c.find({ owner: u.id, ...(board ? { board } : {}) }).toArray();
        return send(res, 200, { shares: list.map(s => ({ token: s._id, board: s.board, role: s.role, emails: s.emails })) });
      }
      if (method === 'POST') {
        const { board, role, emails } = await readBody(req);
        const token = randomBytes(12).toString('base64url');
        const clean = (emails || []).map((e: string) => e.trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e));
        await c.insertOne({ _id: token as any, owner: u.id, board, role: role === 'edit' ? 'edit' : 'view', emails: clean, createdAt: new Date() });
        return send(res, 200, { token });
      }
      if (method === 'DELETE') {
        await c.deleteOne({ _id: url.searchParams.get('t') as any, owner: u.id });
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Action inconnue' });
  } catch (e: any) {
    console.error(e);
    return send(res, 500, { error: 'Erreur serveur' });
  }
}
