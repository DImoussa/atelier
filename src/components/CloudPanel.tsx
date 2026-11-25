import React, { useEffect, useRef, useState } from 'react';
import { useCloud, onGoogleCredential, logout, api, shareUrl } from '../cloud';
import { useStore, toast } from '../store';

declare const google: any;
let gsiLoaded: Promise<void> | null = null;
function loadGsi() {
  if (!gsiLoaded) gsiLoaded = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res(); s.onerror = rej;
    document.head.appendChild(s);
  });
  return gsiLoaded;
}

const desktop: any = (window as any).atelierDesktop;

function GoogleButton() {
  if (desktop) return <DesktopLogin />;
  return <WebGoogleButton />;
}

/** App de bureau : la connexion se fait dans le navigateur de l'ordinateur. */
function DesktopLogin() {
  const [wait, setWait] = useState(false);
  return <button className="btn small" disabled={wait} onClick={async () => { setWait(true); await desktop.connexion(); setWait(false); }}>
    {wait ? 'Terminez la connexion dans votre navigateur…' : 'Se connecter avec Google'}
  </button>;
}

/** Bandeau « Nouvelle version disponible » de l'app de bureau (comme SSD Drive Sync). */
function MajBanner() {
  const [info, setInfo] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!desktop) return; desktop.majEtat().then(setInfo); desktop.surMaj(setInfo); }, []);
  if (!info) return null;
  return (
    <div style={{ ...box, left: 'auto', right: 12, maxWidth: 380 }}>
      <span style={{ flex: 1 }}><b>Nouvelle version {info.version} disponible</b><br />
        {err || (info.prete ? 'Elle est déjà téléchargée.' : 'Ouvre le fichier téléchargé et glisse l’app dans Applications.')}</span>
      <button className="btn small" disabled={busy} onClick={async () => {
        if (info.prete) setBusy(true);
        const r = await desktop.majInstaller();
        if (r && r.erreur) { setErr(r.erreur); setBusy(false); }
      }}>{busy ? 'Installation…' : err ? 'Réessayer' : info.prete ? 'Redémarrer' : 'MAJ'}</button>
    </div>
  );
}

function WebGoogleButton() {
  const ref = useRef<HTMLDivElement>(null);
  const clientId = useCloud(s => s.clientId);
  useEffect(() => {
    if (!clientId) return;
    loadGsi().then(() => {
      google.accounts.id.initialize({ client_id: clientId, callback: (r: any) => onGoogleCredential(r.credential) });
      if (ref.current) google.accounts.id.renderButton(ref.current, { theme: 'outline', size: 'medium', text: 'signin_with', locale: 'fr' });
    }).catch(() => toast('Impossible de charger la connexion Google'));
  }, [clientId]);
  if (!clientId) return <span style={{ opacity: .7 }}>Connexion en ligne non configurée</span>;
  return <div ref={ref} />;
}

const box: React.CSSProperties = {
  position: 'fixed', left: 12, bottom: 12, zIndex: 900, display: 'flex', alignItems: 'center', gap: 8,
  background: 'var(--card, #fff)', color: 'var(--text, #222)', borderRadius: 10, padding: '6px 10px',
  boxShadow: '0 2px 10px rgba(0,0,0,.15)', font: '13px system-ui, sans-serif',
};
const dot = (st: string) => ({ width: 8, height: 8, borderRadius: 8, background: st === 'ok' ? '#3a9d5d' : st === 'sync' ? '#e0a100' : st === 'err' ? '#d0453b' : '#aaa' });
const label: Record<string, string> = { ok: 'Enregistré en ligne', sync: 'Synchronisation…', err: 'Hors ligne : enregistré sur cet appareil', off: '' };

export function CloudPanel() {
  const { user, status, share, needLogin, shareError, ready } = useCloud();
  const [open, setOpen] = useState(false);
  if (!ready) return null;

  if (needLogin || shareError) return (
    <div style={{ ...box, left: '50%', top: '40%', bottom: 'auto', transform: 'translateX(-50%)', flexDirection: 'column', padding: 24, gap: 14, maxWidth: 360, textAlign: 'center' }}>
      <b>Atelier</b>
      <span>{shareError}</span>
      {needLogin && <GoogleButton />}
    </div>
  );

  return (
    <>
      <div style={box}>
        {share && <span><b>Planche partagée</b> · {share.role === 'edit' ? 'modification' : 'lecture seule'}</span>}
        {user ? (
          <>
            <span style={dot(status)} title={label[status]} />
            {user.picture && <img src={user.picture} alt="" width={22} height={22} style={{ borderRadius: 22 }} referrerPolicy="no-referrer" />}
            <span title={user.email}>{user.name}</span>
            {!share && <button className="btn small" onClick={() => setOpen(true)}>Partager</button>}
            <button className="btn small" onClick={logout}>Déconnexion</button>
          </>
        ) : share ? null : <GoogleButton />}
      </div>
      {open && <ShareDialog onClose={() => setOpen(false)} />}
      <MajBanner />
    </>
  );
}

function ShareDialog({ onClose }: { onClose: () => void }) {
  const boardId = useStore(s => s.boardId);
  const title = useStore(s => s.boards[s.boardId]?.title || 'Planche');
  const [role, setRole] = useState<'view' | 'edit'>('view');
  const [emails, setEmails] = useState('');
  const [list, setList] = useState<any[]>([]);
  const refresh = () => api('shares&board=' + encodeURIComponent(boardId)).then(r => setList(r.shares)).catch(() => toast('Liste des liens indisponible'));
  useEffect(() => { refresh(); }, [boardId]);

  const copy = (t: string) => navigator.clipboard.writeText(shareUrl(t)).then(() => toast('Lien copié'), () => prompt('Copiez le lien :', shareUrl(t)));
  const create = async () => {
    try {
      const { token } = await api('shares', { method: 'POST', body: JSON.stringify({ board: boardId, role, emails: emails.split(/[\s,;]+/).filter(Boolean) }) });
      copy(token); setEmails(''); refresh();
    } catch (e: any) { toast('Erreur : ' + e.message); }
  };
  const revoke = async (t: string) => { await api('shares&t=' + t, { method: 'DELETE' }).catch(() => null); refresh(); };

  return (
    <div onMouseDown={onClose} style={{ position: 'fixed', inset: 0, zIndex: 950, background: 'rgba(0,0,0,.3)', display: 'grid', placeItems: 'center' }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ ...box, position: 'static', flexDirection: 'column', alignItems: 'stretch', width: 420, padding: 20, gap: 12 }}>
        <b style={{ fontSize: 15 }}>Partager « {title} »</b>
        <span style={{ opacity: .75 }}>Les sous-planches sont partagées avec elle.</span>
        <label>Droits&nbsp;
          <select value={role} onChange={e => setRole(e.target.value as any)}>
            <option value="view">Lecture seule</option>
            <option value="edit">Peut modifier</option>
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          Réserver à ces e-mails Google (facultatif : vide = toute personne qui a le lien)
          <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={2} placeholder="anne@gmail.com, paul@gmail.com" />
        </label>
        <button className="btn" onClick={create}>Créer le lien et le copier</button>
        {list.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(0,0,0,.1)', paddingTop: 10 }}>
          <b>Liens actifs</b>
          {list.map(s => (
            <div key={s.token} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ flex: 1 }}>{s.role === 'edit' ? 'Modification' : 'Lecture'} · {s.emails?.length ? s.emails.join(', ') : 'tout le monde'}</span>
              <button className="btn small" onClick={() => copy(s.token)}>Copier</button>
              <button className="btn small" onClick={() => revoke(s.token)}>Retirer</button>
            </div>
          ))}
        </div>}
        <button className="btn small" onClick={onClose}>Fermer</button>
      </div>
    </div>
  );
}
