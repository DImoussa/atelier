// API unique d'Atelier (fonction Vercel). Route : /api/a?x=<action>
// Connexion Google -> cookie de session signÃ© ; donnÃ©es dans MongoDB (base "atelier").
import { MongoClient, Db } from 'mongodb';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes } from 'crypto';

const ROOT = 'root';
/** Préfixe des collections (Atelier partage la base du CRM). */
const P = process.env.COLLECTION_PREFIX ?? 'atelier_';
let dbp: Promise<Db> | null = null;
function db(): Promise<Db> {
  if (!dbp) dbp = new MongoClient(process.env.MONGODB_URI!).connect().then(c => c.db(process.env.MONGODB_DB || 'atelier')).catch(e => { dbp = null; throw e; });
  return dbp;
}
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-only-secret-change-me');
const gclient = new OAuth2Client();

type User = { id: string; email: string; name: string; picture?: string };
type Doc = { boards: Record<string, any>; cards: Record<string, any>; settings?: any; viewports?: any };

// ---------- utilitaires HTTP ----------
function send(res: any, code: number, body: any, headers: Record<string, string> = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}
async function readBody(req: any): Promise<any> {
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

// ---------- logique des planches ----------
/** Planche d'une carte : son parent, ou la planche de sa colonne. */
function boardOf(c: any, doc: Doc) {
  const p = doc.cards[c.parent];
  return p && p.type === 'column' ? p.parent : c.parent;
}
/** Ids des planches incluses dans B (B et ses sous-planches). */
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
/** Extrait la planche B et son contenu ; B est renommÃ©e "root" pour le visiteur. */
function extract(doc: Doc, b: string): Doc {
  const set = subBoards(doc, b);
  const map = (id: string) => (id === b ? ROOT : id);
  const boards: any = {}, cards: any = {};
  for (const id of set) if (doc.boards[id]) boards[map(id)] = { ...doc.boards[id], id: map(id) };
  for (const c of Object.values(doc.cards)) if (set.has(boardOf(c, doc)) || set.has(c.parent)) cards[c.id] = { ...c, parent: map(c.parent) };
  return { boards, cards };
}
/** Fusion carte par carte : la plus rÃ©cente gagne ; les ids supprimÃ©s par le client sont retirÃ©s. */
function merge(base: Doc, incoming: Doc, deleted: string[]): Doc {
  const cards = { ...base.cards };
  for (const id of deleted || []) if (!incoming.cards[id]) delete cards[id];
  for (const c of Object.values(incoming.cards || {})) {
    const old = cards[c.id];
    if (!old || (c.updatedAt || 0) >= (old.updatedAt || 0)) cards[c.id] = c;
  }
  const boards = { ...base.boards, ...(incoming.boards || {}) };
  for (const id of deleted || []) if (!incoming.boards?.[id] && boards[id] && id !== ROOT) delete boards[id];
  return { ...base, boards, cards, settings: incoming.settings ?? base.settings, viewports: incoming.viewports ?? base.viewports };
}
/** RÃ©injecte dans le document du propriÃ©taire une planche partagÃ©e modifiÃ©e. */
function mergeShared(owner: Doc, b: string, incoming: Doc, deleted: string[]): Doc {
  const back = (id: string) => (id === ROOT ? b : id);
  const inc: Doc = { boards: {}, cards: {} };
  for (const [id, v] of Object.entries(incoming.boards || {})) inc.boards[back(id)] = { ...v, id: back(id) };
  for (const c of Object.values(incoming.cards || {})) inc.cards[c.id] = { ...c, parent: back(c.parent) };
  const allowed = subBoards({ ...owner, cards: { ...owner.cards, ...inc.cards } }, b);
  for (const id of Object.keys(inc.cards)) { const c = inc.cards[id]; if (!allowed.has(boardOf(c, { ...owner, cards: { ...owner.cards, ...inc.cards } })) && !allowed.has(c.parent)) delete inc.cards[id]; }
  for (const id of Object.keys(inc.boards)) if (!allowed.has(id)) delete inc.boards[id];
  const inSub = extract(owner, b);
  const del = (deleted || []).filter(id => inSub.cards[id]);
  return merge(owner, inc, del);
}

async function loadShare(req: any, token: string) {
  const d = await db();
  const sh = await d.collection(P + 'shares').findOne({ _id: token as any });
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
      if (!p?.sub || !p.email_verified) return send(res, 401, { error: 'Compte Google non vÃ©rifiÃ©' });
      const u: User = { id: p.sub, email: p.email!.toLowerCase(), name: p.name || p.email!, picture: p.picture };
      await (await db()).collection(P + 'users').updateOne({ _id: u.id as any }, { $set: { ...u, lastLogin: new Date() } }, { upsert: true });
      const jwt = await new SignJWT({ u }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('30d').sign(secret());
      return send(res, 200, { user: u }, { 'Set-Cookie': `atl_s=${jwt}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure()}` });
    }
    if (x === 'logout') return send(res, 200, { ok: true }, { 'Set-Cookie': `atl_s=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure()}` });

    // ---- planche partagÃ©e (lien) ----
    if (x === 'share') {
      const token = url.searchParams.get('t') || '';
      const r = await loadShare(req, token);
      if ('error' in r) return send(res, r.error, { error: r.error === 401 ? 'Connexion requise' : r.error === 403 ? 'AccÃ¨s refusÃ©' : 'Lien introuvable' });
      const { sh, d } = r;
      const ws = await d.collection(P + 'workspaces').findOne({ _id: sh.owner });
      if (!ws || !ws.doc.boards[sh.board]) return send(res, 404, { error: 'Planche supprimÃ©e' });
      if (method === 'GET') return send(res, 200, { role: sh.role, doc: extract(ws.doc, sh.board), rev: ws.rev });
      if (method === 'PUT') {
        if (sh.role !== 'edit') return send(res, 403, { error: 'Lecture seule' });
        const body = await readBody(req);
        const doc = mergeShared(ws.doc, sh.board, body.doc, body.deleted);
        await d.collection(P + 'workspaces').updateOne({ _id: sh.owner }, { $set: { doc, updatedAt: new Date() }, $inc: { rev: 1 } });
        return send(res, 200, { doc: extract(doc, sh.board), rev: ws.rev + 1 });
      }
    }
    if (x === 'blob' && method === 'GET') {
      const id = url.searchParams.get('id') || '';
      const token = url.searchParams.get('t');
      let owner: string | null = null;
      if (token) { const r = await loadShare(req, token); if ('error' in r) return send(res, r.error, {}); owner = r.sh.owner; }
      else owner = (await currentUser(req))?.id || null;
      if (!owner) return send(res, 401, {});
      const b = await (await db()).collection(P + 'blobs').findOne({ _id: `${owner}:${id}` as any });
      if (!b) return send(res, 404, {});
      res.statusCode = 200;
      res.setHeader('Content-Type', b.type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      return res.end(Buffer.from(b.data.buffer ?? b.data));
    }

    // ---- tout le reste demande d'Ãªtre connectÃ© ----
    const u = await currentUser(req);
    if (x === 'me') return send(res, 200, { user: u });
    if (!u) return send(res, 401, { error: 'Connexion requise' });
    const d = await db();

    if (x === 'doc') {
      const ws = await d.collection(P + 'workspaces').findOne({ _id: u.id as any });
      if (method === 'GET') return send(res, 200, { doc: ws?.doc || null, rev: ws?.rev || 0 });
      if (method === 'PUT') {
        const body = await readBody(req);
        const doc = ws ? merge(ws.doc, body.doc, body.deleted) : body.doc;
        const rev = (ws?.rev || 0) + 1;
        await d.collection(P + 'workspaces').updateOne({ _id: u.id as any }, { $set: { doc, rev, email: u.email, updatedAt: new Date() } }, { upsert: true });
        return send(res, 200, { doc, rev });
      }
    }
    if (x === 'blobs' && method === 'POST') {
      // liste des fichiers dÃ©jÃ  envoyÃ©s
      const { ids } = await readBody(req);
      const have = await d.collection(P + 'blobs').find({ _id: { $in: (ids || []).map((i: string) => `${u.id}:${i}`) } as any }, { projection: { _id: 1 } }).toArray();
      return send(res, 200, { have: have.map(h => String(h._id).split(':').slice(1).join(':')) });
    }
    if (x === 'blob' && method === 'PUT') {
      const { id, type, data } = await readBody(req);
      await d.collection(P + 'blobs').updateOne({ _id: `${u.id}:${id}` as any }, { $set: { owner: u.id, type, data: Buffer.from(data, 'base64') } }, { upsert: true });
      return send(res, 200, { ok: true });
    }
    if (x === 'shares') {
      const col = d.collection(P + 'shares');
      if (method === 'GET') {
        const board = url.searchParams.get('board');
        const list = await col.find({ owner: u.id, ...(board ? { board } : {}) }).toArray();
        return send(res, 200, { shares: list.map(s => ({ token: s._id, board: s.board, role: s.role, emails: s.emails })) });
      }
      if (method === 'POST') {
        const { board, role, emails } = await readBody(req);
        const token = randomBytes(12).toString('base64url');
        const clean = (emails || []).map((e: string) => e.trim().toLowerCase()).filter((e: string) => /.+@.+\..+/.test(e));
        await col.insertOne({ _id: token as any, owner: u.id, board, role: role === 'edit' ? 'edit' : 'view', emails: clean, createdAt: new Date() });
        return send(res, 200, { token });
      }
      if (method === 'DELETE') {
        await col.deleteOne({ _id: url.searchParams.get('t') as any, owner: u.id });
        return send(res, 200, { ok: true });
      }
    }
    return send(res, 404, { error: 'Action inconnue' });
  } catch (e: any) {
    console.error(e);
    return send(res, 500, { error: 'Erreur serveur' });
  }
}
