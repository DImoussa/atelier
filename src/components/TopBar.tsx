import React, { useEffect, useRef, useState } from 'react';
import { useStore, boardPath, navigate, updateBoard, set, undo, redo, get, duplicateBoard } from '../store';
import { Icon, AppLogo } from '../icons';
import { APP_NAME, ROOT_ID, UNSORTED } from '../types';
import { exportMarkdown, exportWord } from '../exportText';
import { startPresentation } from '../presentation';
import { exportPng, exportPdf, exportBoardJson, importBoardJson, exportBackup, importBackup } from '../exporter';
import { useMilanote } from './CloudPanel';

export function TopBar() {
  const boardId = useStore(s => s.boardId);
  const boards = useStore(s => s.boards);
  const cards = useStore(s => s.cards);
  const readOnly = useStore(s => s.readOnly);
  const panel = useStore(s => s.panel);
  const canUndo = useStore(s => s.past.length > 0);
  const canRedo = useStore(s => s.future.length > 0);
  const dropTarget = useStore(s => s.dropTarget);
  const path = boardPath(boardId, { boards, cards });
  const board = boards[boardId];
  const unsortedCount = Object.values(cards).filter(c => c.parent === UNSORTED && !c.trashed).length;
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menuOpen]);

  const item = (icon: string, label: string, fn: () => void, kbd?: string) => (
    <button className="menu-item" onClick={() => { setMenuOpen(false); fn(); }}>
      <Icon name={icon} size={16} /><span>{label}</span>{kbd && <kbd>{kbd}</kbd>}
    </button>
  );

  return (
    <header className="topbar" data-ui>
      <div className="tb-left">
        <button className="logo-btn" onClick={() => navigate(ROOT_ID, { readOnly })} title={`${APP_NAME} — Accueil`}><AppLogo /></button>
        <nav className="crumbs">
          {path.slice(0, -1).map(b => (
            <React.Fragment key={b.id}>
              <button className={'crumb' + (dropTarget === 'crumb:' + b.id ? ' drop-target' : '')} data-drop={b.id !== UNSORTED ? 'crumb:' + b.id : undefined} title="Ouvrir — ou glissez des cartes ici pour les y envoyer" onClick={() => b.id !== UNSORTED && navigate(b.id, { readOnly })}>{b.id === ROOT_ID ? 'Accueil' : b.title || 'Sans titre'}</button>
              <Icon name="chevron" size={12} className="crumb-sep" />
            </React.Fragment>
          ))}
          <span className="crumb current">{board?.title || 'Sans titre'}</span>
        </nav>
      </div>

      <div className="tb-center">
        {editingTitle && !readOnly ? (
          <input className="board-title-input" autoFocus defaultValue={board?.title}
            onBlur={e => { updateBoard(boardId, { title: e.target.value.trim() || 'Sans titre' }); setEditingTitle(false); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
        ) : (
          <h1 className="board-heading" onClick={() => !readOnly && setEditingTitle(true)} title={readOnly ? '' : 'Renommer la planche'}>{board?.title || 'Sans titre'}</h1>
        )}
      </div>

      <div className="tb-right">
        {readOnly ? (
          <>
            <span className="ro-badge"><Icon name="eye" size={14} /> Lecture seule</span>
            <button className="btn small" onClick={() => navigate(boardId)}>Modifier</button>
          </>
        ) : (
          <>
            <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Annuler (Ctrl Z)"><Icon name="undo" size={18} /></button>
            <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Rétablir (Ctrl Maj Z)"><Icon name="redo" size={18} /></button>
            <span className="tb-sep" />
            <button className={'icon-btn' + (panel === 'search' ? ' active' : '')} onClick={() => set({ panel: panel === 'search' ? null : 'search' })} title="Rechercher (Ctrl K)"><Icon name="search" size={18} /></button>
            <button className={'unsorted-btn' + (panel === 'unsorted' ? ' active' : '') + (dropTarget === 'unsorted' ? ' drop-target' : '')} data-drop="unsorted"
              onClick={() => set({ panel: panel === 'unsorted' ? null : 'unsorted' })} title="Cartes à trier">
              <b>{unsortedCount}</b> À trier
            </button>
            <button className="icon-btn" onClick={startPresentation} title="Présenter (plein écran)"><Icon name="present" size={18} /></button>
            <button className="btn small primary" onClick={() => set({ modal: { kind: 'share' } })}><Icon name="share" size={14} /> Partager</button>
          </>
        )}
        <div className="menu-wrap" ref={menuRef}>
          <button className="icon-btn" onClick={() => setMenuOpen(o => !o)} title="Plus d'options"><Icon name="more" size={18} /></button>
          {menuOpen && (
            <div className="dropdown">
              <div className="menu-label">Exporter cette planche</div>
              {item('image', 'Image PNG', () => exportPng())}
              {item('document', 'Document PDF', () => exportPdf())}
              {item('markdown', 'Texte Markdown (.md)', () => exportMarkdown(boardId))}
              {item('word', 'Document Word (.doc)', () => exportWord(boardId))}
              {item('export', 'Fichier de planche (.json)', () => exportBoardJson(boardId))}
              {!readOnly && <>
                <div className="menu-sep" />
                {item('import', 'Importer une planche (.json)', () => importBoardJson())}
                {item('import', 'Importer depuis Milanote…', () => useMilanote.setState({ open: true }))}
                {item('template', 'Appliquer un modèle', () => set({ modal: { kind: 'templates', boardId } }))}
                {item('color', 'Apparence de la planche', () => set({ modal: { kind: 'icon', boardId } }))}
                {boardId !== ROOT_ID && item('copy', 'Dupliquer la planche', () => { const id = duplicateBoard(boardId); if (id) navigate(id); })}
              </>}
              <div className="menu-sep" />
              {item('eye', readOnly ? 'Quitter la lecture seule' : 'Voir en lecture seule', () => navigate(boardId, { readOnly: !readOnly }))}
              {item('present', 'Présenter en plein écran', () => startPresentation())}
              {item('trash', 'Corbeille', () => set({ panel: 'trash' }))}
              {item('keyboard', 'Raccourcis clavier', () => set({ modal: { kind: 'shortcuts' } }), '?')}
              {item('settings', 'Réglages', () => set({ modal: { kind: 'settings' } }))}
              <div className="menu-sep" />
              {item('download', 'Sauvegarde complète', () => exportBackup())}
              {item('restore', 'Restaurer une sauvegarde', () => importBackup())}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
