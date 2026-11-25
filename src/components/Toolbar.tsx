import React, { useEffect, useState } from 'react';
import { useStore, set } from '../store';
import { Icon } from '../icons';
import { startGhostDrag, addAtCenter } from '../interaction';
import type { CardType } from '../types';

type Tool = { type: CardType | 'upload'; icon: string; label: string; hint: string };
// Comme Milanote : les outils principaux, puis un bouton « … » qui ouvre les autres.
const TOOLS: Tool[] = [
  { type: 'note', icon: 'note', label: 'Note', hint: 'Texte avec mise en forme' },
  { type: 'link', icon: 'link', label: 'Lien', hint: 'Lien web ou vidéo' },
  { type: 'todo', icon: 'todo', label: 'Tâches', hint: 'Liste de cases à cocher' },
  { type: 'line', icon: 'line', label: 'Ligne', hint: 'Flèche pour relier des cartes' },
  { type: 'board', icon: 'board', label: 'Planche', hint: 'Planche imbriquée' },
];
const MORE: Tool[] = [
  { type: 'sketch', icon: 'sketch', label: 'Croquis', hint: 'Dessiner à main levée' },
  { type: 'color', icon: 'color', label: 'Nuancier', hint: 'Palette de couleurs' },
  { type: 'document', icon: 'document', label: 'Document', hint: 'Texte long, plein écran' },
  { type: 'audio' as any, icon: 'mic', label: 'Audio', hint: 'Enregistrer un mémo vocal' },
  { type: 'link', icon: 'play', label: 'Vidéo', hint: 'Coller un lien YouTube ou Vimeo' },
  { type: 'heading', icon: 'heading', label: 'Titre', hint: 'Gros titre sans fond' },
  { type: 'table', icon: 'table', label: 'Tableau', hint: 'Lignes et colonnes' },
  { type: 'comment', icon: 'comment', label: 'Commentaire', hint: 'Fil de discussion' },
  { type: 'column', icon: 'column', label: 'Colonne', hint: 'Empiler des cartes' },
];
const TOOLS2: Tool[] = [
  { type: 'image', icon: 'image', label: 'Images', hint: 'Ajouter des images' },
  { type: 'upload', icon: 'upload', label: 'Importer', hint: 'Ajouter des fichiers' },
];

export function Toolbar() {
  const readOnly = useStore(s => s.readOnly);
  const trashCount = useStore(s => Object.values(s.cards).filter(c => c.trashed).length);
  const dropTarget = useStore(s => s.dropTarget);
  const panel = useStore(s => s.panel);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!more) return;
    const close = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('[data-more]')) setMore(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [more]);
  if (readOnly) return null;
  const tool = (t: Tool, inMore = false) => (
    <button key={t.label} className={inMore ? 'more-item' : 'tool'} title={`${t.label} — ${t.hint}\nCliquez ou glissez sur la planche`}
      onPointerDown={e => { startGhostDrag(e, { kind: 'tool', type: t.type }, t.label, t.icon, () => addAtCenter(t.type)); if (inMore) setTimeout(() => setMore(false), 0); }}>
      <Icon name={t.icon} size={inMore ? 26 : 22} />
      <span>{t.label}</span>
    </button>
  );
  return (
    <aside className="toolbar" data-ui>
      <div className="tools">
        {TOOLS.map(t => tool(t))}
        <div data-more style={{ position: 'relative' }}>
          <button className={'tool' + (more ? ' active' : '')} title="Plus d'outils" onClick={() => setMore(m => !m)}>
            <Icon name="more" size={22} />
          </button>
          {more && (
            <div className="more-pop" data-more>
              {MORE.map(t => tool(t, true))}
            </div>
          )}
        </div>
        <div className="tool-sep" />
        {TOOLS2.map(t => tool(t))}
      </div>
      <button className={'tool trash-tool' + (dropTarget === 'trash' ? ' drop-target' : '') + (panel === 'trash' ? ' active' : '')} data-drop="trash"
        title="Corbeille — glissez des cartes ici pour les supprimer" onClick={() => set({ panel: panel === 'trash' ? null : 'trash' })}>
        <Icon name="trash" size={22} />
        <span>Corbeille{trashCount ? ` (${trashCount})` : ''}</span>
      </button>
    </aside>
  );
}
