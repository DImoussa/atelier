import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useStore, set, get, updateData, updateBoard, checkpoint, moveToBoard, reachableBoards, boardCardFor, boardOfCard, toast, navigate,
} from '../../store';
import { Icon } from '../../icons';
import { RichText } from '../RichText';
import { FormatBar } from '../Menus';
import { SketchModal } from './SketchModal';
import { CropModal } from './CropModal';
import { RecordModal } from './RecordModal';
import { useBlobUrl, downloadCardFile } from '../cards/MediaCards';
import { APP_NAME, BOARD_COLORS, BG_COLORS, ROOT_ID, UNSORTED } from '../../types';
import { BoardIcon } from '../cards/StructureCards';
import { pickFiles } from '../../files';
import { blobSet } from '../../db';
import { uid } from '../../store';
import { TEMPLATES, TEMPLATE_CATS, applyTemplate, templateInNewBoard } from '../../templates';
import { freeSpotNearCenter, fitToContent } from '../../interaction';
import { exportMarkdown, exportWord } from '../../exportText';
import { exportBoardJson, exportPdf, exportPng } from '../../exporter';
import { htmlToText } from '../../sanitize';

export function Modals() {
  const modal = useStore(s => s.modal);
  useEffect(() => {
    if (!modal || modal.kind === 'sketch' || modal.kind === 'document' || modal.kind === 'crop' || modal.kind === 'record') return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ modal: null }); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [modal]);
  if (!modal) return null;
  switch (modal.kind) {
    case 'sketch': return <SketchModal cardId={modal.cardId} />;
    case 'document': return <DocumentModal cardId={modal.cardId} />;
    case 'lightbox': return <Lightbox cardId={modal.cardId} />;
    case 'crop': return <CropModal cardId={modal.cardId} />;
    case 'record': return <RecordModal at={modal.at} />;
    case 'share': return <ShareModal />;
    case 'settings': return <SettingsModal />;
    case 'shortcuts': return <ShortcutsModal />;
    case 'icon': return <IconModal boardId={modal.boardId} />;
    case 'move': return <MoveModal ids={modal.ids} />;
    case 'templates': return <TemplatesModal boardId={modal.boardId} />;
    default: return null;
  }
}

function Dialog({ title, children, width = 480, onClose }: { title: string; children: React.ReactNode; width?: number; onClose?: () => void }) {
  const close = onClose || (() => set({ modal: null }));
  return (
    <div className="modal-backdrop" data-ui onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="dialog" style={{ width }} role="dialog" aria-label={title}>
        <div className="dialog-head"><h2>{title}</h2><button className="icon-btn" onClick={close} title="Fermer"><Icon name="close" /></button></div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}

// ---------- Document plein écran ----------
function DocumentModal({ cardId }: { cardId: string }) {
  const card = useStore(s => s.cards[cardId]);
  const readOnly = useStore(s => s.readOnly);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (card && !card.data.title && !readOnly) titleRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); set({ modal: null }); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);
  if (!card) return null;
  const words = htmlToText(card.data.html || '').split(/\s+/).filter(Boolean).length;
  return (
    <div className="modal-backdrop doc-backdrop" data-ui>
      <div className="doc-modal">
        <div className="doc-top">
          {!readOnly && <FormatBar floating={false} />}
          <div style={{ flex: 1 }} />
          <span className="muted tiny">{words} mot{words > 1 ? 's' : ''}</span>
          <button className="btn small" onClick={() => set({ modal: null })}>Fermer</button>
        </div>
        <div className="doc-page" data-scroll>
          <input ref={titleRef} className="doc-title-input" value={card.data.title} placeholder="Titre du document" readOnly={readOnly}
            onFocus={() => checkpoint()} onChange={e => updateData(cardId, { title: e.target.value }, false)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (document.querySelector('.doc-page .rich') as HTMLElement)?.focus(); } }} />
          <RichText html={card.data.html} editing={!readOnly} autoFocusPoint={false} autoFocus={!!card.data.title} placeholder="Commencez à écrire…" className="doc-rich"
            onChange={html => updateData(cardId, { html }, false)} />
        </div>
      </div>
    </div>
  );
}

// ---------- Visionneuse d'images ----------
function Lightbox({ cardId }: { cardId: string }) {
  const cards = useStore(s => s.cards);
  const boardId = useStore(s => s.boardId);
  const images = useMemo(() => Object.values(cards).filter(c => c.type === 'image' && !c.trashed && (c.parent === boardId || cards[c.parent]?.parent === boardId)).sort((a, b) => (a.y - b.y) || (a.x - b.x)), [cards, boardId]);
  const [id, setId] = useState(cardId);
  const idx = images.findIndex(i => i.id === id);
  const card = cards[id];
  const url = useBlobUrl(card?.data.blobId) || card?.data.src;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && idx < images.length - 1) setId(images[idx + 1].id);
      if (e.key === 'ArrowLeft' && idx > 0) setId(images[idx - 1].id);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [idx, images]);
  if (!card) return null;
  return (
    <div className="modal-backdrop lightbox" data-ui onPointerDown={e => { if (e.target === e.currentTarget) set({ modal: null }); }}>
      <div className="lb-top">
        <span>{card.data.caption || card.data.name}</span>
        <span className="muted">{idx + 1} / {images.length}</span>
        <div style={{ flex: 1 }} />
        {card.data.blobId && <button className="icon-btn light" title="Télécharger" onClick={() => downloadCardFile(card)}><Icon name="download" /></button>}
        <button className="icon-btn light" title="Fermer (Échap)" onClick={() => set({ modal: null })}><Icon name="close" /></button>
      </div>
      {idx > 0 && <button className="lb-nav prev" onClick={() => setId(images[idx - 1].id)} aria-label="Précédente"><Icon name="chevron" size={28} style={{ transform: 'rotate(180deg)' }} /></button>}
      {url && <img src={url} alt={card.data.caption || ''} className="lb-img" />}
      {idx < images.length - 1 && <button className="lb-nav next" onClick={() => setId(images[idx + 1].id)} aria-label="Suivante"><Icon name="chevron" size={28} /></button>}
    </div>
  );
}

// ---------- Partage ----------
function ShareModal() {
  const boardId = useStore(s => s.boardId);
  const board = useStore(s => s.boards[s.boardId]);
  const link = `${location.origin}${location.pathname}#/b/${boardId}?lecture=1`;
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title={`Partager « ${board?.title} »`} width={520}>
      <p className="muted">Cette version de {APP_NAME} enregistre tout dans votre navigateur, sans serveur. Pour partager avec quelqu'un d'autre, envoyez-lui un export.</p>
      <div className="share-block">
        <div className="share-title"><Icon name="eye" size={16} /> Vue en lecture seule</div>
        <p className="tiny muted">Ouvre cette planche sans possibilité de la modifier (sur cet appareil).</p>
        <div className="share-row">
          <input readOnly value={link} onFocus={e => e.target.select()} />
          <button className="btn small" onClick={() => { navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? 'Copié !' : 'Copier'}</button>
          <button className="btn small" onClick={() => { set({ modal: null }); navigate(boardId, { readOnly: true }); }}>Ouvrir</button>
        </div>
      </div>
      <div className="share-block">
        <div className="share-title"><Icon name="export" size={16} /> Envoyer une copie</div>
        <div className="share-actions">
          <button className="btn" onClick={() => exportBoardJson(boardId)}><Icon name="export" size={14} /> Fichier planche (.json)</button>
          <button className="btn" onClick={() => exportPdf()}><Icon name="document" size={14} /> PDF</button>
          <button className="btn" onClick={() => exportPng()}><Icon name="image" size={14} /> Image PNG</button>
          <button className="btn" onClick={() => exportMarkdown(boardId)}><Icon name="markdown" size={14} /> Markdown</button>
          <button className="btn" onClick={() => exportWord(boardId)}><Icon name="word" size={14} /> Word</button>
        </div>
        <p className="tiny muted">Le fichier .json contient toute la planche (sous-planches, images et fichiers compris). Il s'importe via le menu ⋯ → Importer une planche.</p>
      </div>
    </Dialog>
  );
}

// ---------- Réglages ----------
function SettingsModal() {
  const settings = useStore(s => s.settings);
  const [usage, setUsage] = useState<string>('');
  useEffect(() => {
    navigator.storage?.estimate?.().then(e => setUsage(`${((e.usage || 0) / 1024 / 1024).toFixed(1)} Mo utilisés sur ${((e.quota || 0) / 1024 / 1024 / 1024).toFixed(1)} Go disponibles`));
  }, []);
  const upd = (p: any) => set({ settings: { ...get().settings, ...p } });
  return (
    <Dialog title="Réglages">
      <label className="field"><span>Votre nom (affiché dans les commentaires)</span>
        <input value={settings.userName} onChange={e => upd({ userName: e.target.value })} />
      </label>
      <div className="field"><span>Thème</span>
        <div className="seg">
          <button className={settings.theme === 'light' ? 'on' : ''} onClick={() => upd({ theme: 'light' })}>Clair</button>
          <button className={settings.theme === 'dark' ? 'on' : ''} onClick={() => upd({ theme: 'dark' })}>Sombre</button>
        </div>
      </div>
      <div className="field"><span>Stockage local</span><div className="muted tiny">{usage || '…'}</div></div>
      <button className="btn small" onClick={async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? 'Stockage protégé contre le nettoyage automatique' : 'Le navigateur a refusé la protection du stockage'); }}>Protéger mes données contre le nettoyage du navigateur</button>
    </Dialog>
  );
}

// ---------- Raccourcis ----------
const SHORTCUTS: [string, string][] = [
  ['Double-clic sur le fond', 'Nouvelle note'], ['Double-clic sur une carte', 'Modifier / ouvrir'], ['Entrée', 'Modifier la carte sélectionnée'], ['Échap', 'Terminer / désélectionner'],
  ['Ctrl Z / Ctrl Maj Z', 'Annuler / rétablir'], ['Ctrl C / X / V', 'Copier / couper / coller'], ['Ctrl D', 'Dupliquer'], ['Alt + glisser', 'Dupliquer en déplaçant'],
  ['Suppr / Retour arrière', 'Mettre à la corbeille'], ['Ctrl A', 'Tout sélectionner'], ['Maj + clic', 'Ajouter à la sélection'], ['Flèches (Maj)', 'Déplacer de 1 px (10 px)'],
  ['Ctrl K', 'Rechercher'], ['Glisser un point bleu', 'Tracer une flèche depuis une carte'], ['Présentation : ← → Échap', 'Naviguer / quitter'], ['Pincer (tactile)', 'Zoomer'], ['Espace + glisser / clic molette', 'Se déplacer'], ['Molette', 'Défiler'], ['Ctrl + molette', 'Zoomer'],
  ['Ctrl + / Ctrl −', 'Zoom avant / arrière'], ['Ctrl 0', 'Zoom 100 %'], ['Ctrl 1', 'Tout afficher'], ['Ctrl glisser', 'Désactiver l\'aimantation'],
  ['Alt ↑ / Alt ←', 'Planche parente'], ['Ctrl ] / Ctrl [', 'Premier plan / arrière-plan'], ['N T L B C H D A', 'Ajouter note, tâches, lien, planche, colonne, titre, document, audio'], ['Maj 2', 'Zoomer sur la sélection'], ['Glisser sur le fil d’Ariane', 'Envoyer dans une planche parente'], ['Poignée d’un titre', 'Agrandir le titre (Maj : largeur seule)'], ['?', 'Cette aide'],
  ['# + espace', 'Titre (dans une note)'], ['- + espace', 'Liste à puces'], ['1. + espace', 'Liste numérotée'], ['Ctrl B / I / U', 'Gras / italique / souligné'],
];
function ShortcutsModal() {
  return (
    <Dialog title="Raccourcis clavier" width={640}>
      <div className="shortcuts">
        {SHORTCUTS.map(([k, v]) => <div key={k} className="sc-row"><kbd>{k}</kbd><span>{v}</span></div>)}
      </div>
    </Dialog>
  );
}

// ---------- Icône de planche ----------
const EMOJIS = ['✦', '🏠', '🎬', '🎥', '📷', '🎨', '🖌️', '✏️', '✍️', '📚', '📖', '📝', '📋', '📌', '📎', '💡', '🧠', '🚀', '⭐', '❤️', '🔥', '🌱', '🌍', '🌙', '☀️', '🎵', '🎧', '🎤', '🎮', '🧩', '🛠️', '⚙️', '💼', '📈', '💰', '🛒', '✈️', '🗺️', '🏔️', '🍳', '☕', '🎁', '👕', '🏋️', '⚽', '🐾', '👶', '💬', '📣', '🔒', '🧪', '🖥️', '📱', '🎯', '🗂️', '📅', '⏱️', '✅', '❓', '👻'];
function IconModal({ boardId }: { boardId: string }) {
  const board = useStore(s => s.boards[boardId]);
  const bgUrl = useBlobUrl(board?.bgImage);
  if (!board) return null;
  const pickImage = async (field: 'cover' | 'bgImage') => {
    const [f] = await pickFiles('image/*', false);
    if (!f) return;
    const id = uid();
    await blobSet(id, f);
    updateBoard(boardId, { [field]: id } as any);
  };
  return (
    <Dialog title="Apparence de la planche" width={520}>
      <div className="icon-preview"><BoardIcon board={board} />
        <input className="icon-title" value={board.title} onFocus={() => checkpoint()} onChange={e => updateBoard(boardId, { title: e.target.value })} placeholder="Nom de la planche" />
      </div>

      <div className="appearance-section">
        <div className="menu-label">Couleur de la vignette</div>
        <div className="color-row big">{BOARD_COLORS.map(c => <button key={c} className={'color-dot' + (board.color === c ? ' on' : '')} style={{ background: c }} onClick={() => updateBoard(boardId, { color: c })} />)}
          <label className="color-dot custom" title="Couleur personnalisée"><input type="color" value={board.color} onChange={e => updateBoard(boardId, { color: e.target.value })} />+</label>
        </div>
      </div>

      <div className="appearance-section">
        <div className="menu-label">Image de couverture</div>
        <div className="row-gap">
          <button className="btn small" onClick={() => pickImage('cover')}><Icon name="photo" size={14} /> {board.cover ? "Changer l'image" : 'Choisir une image'}</button>
          {board.cover && <button className="link-btn danger" onClick={() => updateBoard(boardId, { cover: null })}>Retirer la couverture</button>}
        </div>
      </div>

      {!board.cover && (
        <div className="appearance-section">
          <div className="menu-label">Icône</div>
          <div className="emoji-grid">{EMOJIS.map(e => <button key={e} className={board.icon === e ? 'on' : ''} onClick={() => updateBoard(boardId, { icon: e })}>{e}</button>)}</div>
          <label className="field inline"><span>Ou n'importe quel emoji / caractère</span>
            <input maxLength={4} value={board.icon} onChange={e => updateBoard(boardId, { icon: e.target.value || '✦' })} style={{ width: 70 }} />
          </label>
        </div>
      )}

      <div className="appearance-section">
        <div className="menu-label">Fond de la planche</div>
        <div className="bg-row">
          {BG_COLORS.map(c => (
            <button key={String(c.id)} title={c.label} className={'bg-swatch' + ((board.bgColor ?? null) === c.id && !board.bgImage ? ' on' : '')}
              style={{ background: c.value }} onClick={() => updateBoard(boardId, { bgColor: c.id, bgImage: null })} />
          ))}
          <button className={'bg-swatch image' + (board.bgImage ? ' on' : '')} title="Image de fond" style={bgUrl ? { backgroundImage: `url("${bgUrl}")` } : {}} onClick={() => pickImage('bgImage')}>
            {!bgUrl && <Icon name="photo" size={16} />}
          </button>
        </div>
        {board.bgImage && <button className="link-btn danger" onClick={() => updateBoard(boardId, { bgImage: null })}>Retirer l'image de fond</button>}
      </div>
    </Dialog>
  );
}

// ---------- Déplacer vers ----------
function MoveModal({ ids }: { ids: string[] }) {
  const cards = useStore(s => s.cards);
  const boards = useStore(s => s.boards);
  const current = useStore(s => s.boardId);
  const [q, setQ] = useState('');
  const tree = useMemo(() => {
    const doc = { cards, boards };
    const reach = reachableBoards(doc);
    // planches qu'on déplace (et leurs descendantes) exclues pour éviter les cycles
    const excluded = new Set<string>();
    const stack = ids.map(id => cards[id]).filter(c => c?.type === 'board').map(c => c.data.boardId);
    while (stack.length) {
      const b = stack.pop()!;
      if (excluded.has(b)) continue;
      excluded.add(b);
      for (const c of Object.values(cards)) if (c.type === 'board' && !c.trashed && boardOfCard(c, doc) === b) stack.push(c.data.boardId);
    }
    const out: { id: string; depth: number }[] = [];
    const walk = (id: string, depth: number) => {
      if (excluded.has(id)) return;
      out.push({ id, depth });
      const kids = Object.values(cards).filter(c => c.type === 'board' && !c.trashed && boardOfCard(c, doc) === id && reach.has(c.data.boardId)).sort((a, b) => a.y - b.y || a.x - b.x);
      kids.forEach(k => walk(k.data.boardId, depth + 1));
    };
    walk(ROOT_ID, 0);
    return out;
  }, [cards, boards, ids]);
  const shown = tree.filter(t => !q || boards[t.id]?.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Dialog title={`Déplacer ${ids.length > 1 ? `${ids.length} éléments` : "l'élément"} vers…`} width={420}>
      <input className="search-input" autoFocus placeholder="Filtrer les planches…" value={q} onChange={e => setQ(e.target.value)} />
      <div className="move-list" data-scroll>
        <button className="move-item" onClick={() => { moveToBoard(ids, UNSORTED); set({ modal: null }); }}><Icon name="inbox" size={16} /> À trier</button>
        {shown.map(t => {
          const b = boards[t.id];
          return (
            <button key={t.id} className="move-item" disabled={t.id === current} style={{ paddingLeft: 12 + (q ? 0 : t.depth * 18) }}
              onClick={() => { moveToBoard(ids, t.id); set({ modal: null }); }}>
              <span className="mini-icon" style={{ background: b.color }}>{b.icon}</span> {b.title}{t.id === current && <span className="muted tiny"> (planche actuelle)</span>}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

// ---------- Galerie de modèles ----------
function TemplatesModal({ boardId }: { boardId: string }) {
  const [cat, setCat] = useState<string>('Tous');
  const [q, setQ] = useState('');
  const list = TEMPLATES.filter(t => (cat === 'Tous' || t.cat === cat) && (!q || (t.name + ' ' + t.desc).toLowerCase().includes(q.toLowerCase())));
  const fitSoon = () => requestAnimationFrame(() => requestAnimationFrame(() => fitToContent(1)));
  const here = (id: string) => { applyTemplate(boardId, id); set({ modal: null }); fitSoon(); };
  const inNew = (id: string) => {
    const spot = freeSpotNearCenter(120, 130);
    const nb = templateInNewBoard(id, { x: spot.x + 60, y: spot.y + 60 });
    set({ modal: null });
    if (nb) navigate(nb);
  };
  return (
    <Dialog title="Galerie de modèles" width={860}>
      <div className="tpl-layout">
        <nav className="tpl-cats">
          {['Tous', ...TEMPLATE_CATS].map(c => (
            <button key={c} className={c === cat ? 'on' : ''} onClick={() => setCat(c)}>
              {c} <span className="muted tiny">{c === 'Tous' ? TEMPLATES.length : TEMPLATES.filter(t => t.cat === c).length}</span>
            </button>
          ))}
        </nav>
        <div className="tpl-main">
          <input className="search-input" placeholder="Rechercher un modèle…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          <div className="templates" data-scroll>
            {list.map(t => (
              <div key={t.id} className="template">
                <span className="template-icon">{t.icon}</span>
                <b>{t.name}</b>
                <span className="muted tiny">{t.desc}</span>
                <div className="template-actions">
                  <button className="btn small primary" onClick={() => inNew(t.id)}>Nouvelle planche</button>
                  <button className="btn small" onClick={() => here(t.id)}>Ici</button>
                </div>
              </div>
            ))}
            {list.length === 0 && <div className="panel-empty">Aucun modèle trouvé.</div>}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export { boardCardFor };
