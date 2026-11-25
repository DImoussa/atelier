import React from 'react';
import { useStore, set } from '../store';
import { Icon } from '../icons';
import { startGhostDrag, addAtCenter } from '../interaction';
import type { CardType } from '../types';

const TOOLS: { type: CardType | 'upload'; icon: string; label: string; hint: string }[] = [
  { type: 'note', icon: 'note', label: 'Note', hint: 'Texte avec mise en forme' },
  { type: 'link', icon: 'link', label: 'Lien', hint: 'Lien web ou vidéo' },
  { type: 'todo', icon: 'todo', label: 'Tâches', hint: 'Liste de cases à cocher' },
  { type: 'line', icon: 'line', label: 'Ligne', hint: 'Flèche pour relier des cartes' },
  { type: 'board', icon: 'board', label: 'Planche', hint: 'Planche imbriquée' },
  { type: 'column', icon: 'column', label: 'Colonne', hint: 'Empiler des cartes' },
  { type: 'comment', icon: 'comment', label: 'Commentaire', hint: 'Fil de discussion' },
  { type: 'table', icon: 'table', label: 'Tableau', hint: 'Lignes et colonnes' },
  { type: 'heading', icon: 'heading', label: 'Titre', hint: 'Gros titre sans fond' },
  { type: 'document', icon: 'document', label: 'Document', hint: 'Texte long, plein écran' },
];
const TOOLS2: { type: CardType | 'upload'; icon: string; label: string; hint: string }[] = [
  { type: 'image', icon: 'image', label: 'Image', hint: 'Ajouter des images' },
  { type: 'upload', icon: 'upload', label: 'Importer', hint: 'Ajouter des fichiers' },
  { type: 'sketch', icon: 'sketch', label: 'Dessin', hint: 'Dessiner à main levée' },
  { type: 'color', icon: 'color', label: 'Couleur', hint: 'Nuancier' },
  { type: 'audio' as any, icon: 'mic', label: 'Audio', hint: 'Enregistrer un mémo vocal' },
];

export function Toolbar() {
  const readOnly = useStore(s => s.readOnly);
  const trashCount = useStore(s => Object.values(s.cards).filter(c => c.trashed).length);
  const dropTarget = useStore(s => s.dropTarget);
  const panel = useStore(s => s.panel);
  if (readOnly) return null;
  const tool = (t: typeof TOOLS[number]) => (
    <button key={t.type} className="tool" title={`${t.label} — ${t.hint}\nCliquez ou glissez sur la planche`}
      onPointerDown={e => startGhostDrag(e, { kind: 'tool', type: t.type }, t.label, t.icon, () => addAtCenter(t.type))}>
      <Icon name={t.icon} size={22} />
      <span>{t.label}</span>
    </button>
  );
  return (
    <aside className="toolbar" data-ui>
      <div className="tools">
        {TOOLS.map(tool)}
        <div className="tool-sep" />
        {TOOLS2.map(tool)}
      </div>
      <button className={'tool trash-tool' + (dropTarget === 'trash' ? ' drop-target' : '') + (panel === 'trash' ? ' active' : '')} data-drop="trash"
        title="Corbeille — glissez des cartes ici pour les supprimer" onClick={() => set({ panel: panel === 'trash' ? null : 'trash' })}>
        <Icon name="trash" size={22} />
        <span>Corbeille{trashCount ? ` (${trashCount})` : ''}</span>
      </button>
    </aside>
  );
}
