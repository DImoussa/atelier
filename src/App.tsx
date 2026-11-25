import React, { useEffect } from 'react';
import {
  useStore, get, set, undo, redo, trashCards, duplicate, bringToFront, sendToBack, navigate, mutate, boardCardFor, boardOfCard, applyHash,
} from './store';
import { TopBar } from './components/TopBar';
import { Toolbar } from './components/Toolbar';
import { Canvas } from './components/Canvas';
import { SidePanel } from './components/Panels';
import { ContextMenu, SelectionToolbar, FormatBar } from './components/Menus';
import { Modals } from './components/modals/Modals';
import { useGhost, zoomAt, fitToContent, currentVp, addAtCenter, zoomToSelection } from './interaction';
import { copySelection, cutSelection, pasteInternal, pastePoint } from './clipboard';
import { insertFiles, insertText } from './files';
import { Icon } from './icons';
import { Safe } from './components/Safe';
import { usePresentation, PresentationControls } from './presentation';
import { APP_NAME, EDITABLE_TYPES, ROOT_ID, UNSORTED } from './types';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

export function App() {
  const theme = useStore(s => s.settings.theme);
  const board = useStore(s => s.boards[s.boardId]);
  const toast = useStore(s => s.toast);
  const ghost = useGhost(s => s.ghost);
  const presenting = usePresentation(s => !!s.pres);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.title = board ? `${board.id === ROOT_ID ? 'Accueil' : board.title} — ${APP_NAME}` : APP_NAME; }, [board?.title]);

  useEffect(() => {
    const onHash = () => applyHash();
    window.addEventListener('hashchange', onHash);

    const onKey = (e: KeyboardEvent) => {
      const s = get();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (s.modal) return;
      // raccourcis valables même pendant la saisie
      if (mod && k === 'k') { e.preventDefault(); if (!s.editingId) { set({ panel: s.panel === 'search' ? null : 'search' }); return; } }
      if (isTyping(e.target)) return;
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(currentVp().zoom * 1.25); return; }
      if (mod && (k === '-' || k === '_')) { e.preventDefault(); zoomAt(currentVp().zoom / 1.25); return; }
      if (mod && k === '0') { e.preventDefault(); zoomAt(1); return; }
      if (mod && k === '1') { e.preventDefault(); fitToContent(1.5); return; }
      if (e.shiftKey && (e.code === 'Digit2' || e.key === '@') && s.selection.length) { e.preventDefault(); zoomToSelection(); return; }
      if (mod && k === 'a') { e.preventDefault(); set({ selection: Object.values(s.cards).filter(c => c.parent === s.boardId && !c.trashed).map(c => c.id) }); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowLeft') && s.boardId !== ROOT_ID) {
        e.preventDefault();
        const bc = boardCardFor(s.boardId, s);
        const parent = bc ? boardOfCard(bc, s) : ROOT_ID;
        navigate(parent === UNSORTED ? ROOT_ID : parent, { readOnly: s.readOnly });
        return;
      }
      if (e.key === 'Escape') { set({ selection: [], editingId: null, menu: null, panel: s.panel === 'search' ? null : s.panel }); return; }
      if (e.key === '?') { set({ modal: { kind: 'shortcuts' } }); return; }
      if (s.readOnly) return;
      const sel = s.selection.filter(id => s.cards[id] && !s.cards[id].trashed);
      if (mod && k === 'd') { e.preventDefault(); duplicate(sel); return; }
      if (mod && e.key === ']') { e.preventDefault(); bringToFront(sel); return; }
      if (mod && e.key === '[') { e.preventDefault(); sendToBack(sel); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); trashCards(sel); return; }
      if (e.key === 'Enter' && sel.length === 1) {
        const c = s.cards[sel[0]];
        e.preventDefault();
        if (c.type === 'board') navigate(c.data.boardId);
        else if (c.type === 'document') set({ modal: { kind: 'document', cardId: c.id } });
        else if (c.type === 'sketch') set({ modal: { kind: 'sketch', cardId: c.id } });
        else if (c.type === 'line' || EDITABLE_TYPES.includes(c.type)) set({ editingId: c.id, editPoint: null });
        return;
      }
      if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        mutate(d => sel.forEach(id => {
          const c = d.cards[id];
          if (c.parent !== s.boardId) return;
          if (c.type === 'line') { for (const end of ['from', 'to'] as const) if (!c.data[end].cardId) { c.data[end].x += dx; c.data[end].y += dy; } }
          else { c.x += dx; c.y += dy; }
        }), !e.repeat);
        return;
      }
      if (!mod && !e.altKey && !s.editingId) {
        const map: Record<string, any> = { n: 'note', t: 'todo', l: 'link', b: 'board', c: 'column', h: 'heading', d: 'document', a: 'audio' };
        if (map[k]) { e.preventDefault(); addAtCenter(map[k]); }
      }
    };

    const onCopy = (e: ClipboardEvent) => { if (isTyping(e.target) || get().modal) return; copySelection(e); };
    const onCut = (e: ClipboardEvent) => { if (isTyping(e.target) || get().modal || get().readOnly) return; cutSelection(e); };
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e.target) || get().modal || get().readOnly) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const at = pastePoint();
      const files = Array.from(dt.files || []);
      e.preventDefault();
      if (files.length) { insertFiles(files, { x: at.x - 140, y: at.y - 40 }); return; }
      const text = dt.getData('text/plain');
      if (pasteInternal(text, at)) return;
      if (text) insertText(text, { x: at.x - 140, y: at.y - 20 });
    };

    window.addEventListener('keydown', onKey);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);

  return (
    <div className={'app' + (presenting ? ' presenting' : '')}>
      <Safe name="TopBar"><TopBar /></Safe>
      <div className="main">
        <Safe name="Toolbar"><Toolbar /></Safe>
        <Safe name="Canvas"><Canvas /></Safe>
        <Safe name="SidePanel"><SidePanel /></Safe>
      </div>
      <Safe name="SelectionToolbar"><SelectionToolbar /></Safe>
      <Safe name="FormatBar"><FormatBar /></Safe>
      <Safe name="ContextMenu"><ContextMenu /></Safe>
      <Safe name="Modals"><Modals /></Safe>
      {ghost && (
        <div className="drag-ghost" data-ghost style={{ left: ghost.x, top: ghost.y }}>
          <Icon name={ghost.icon} size={18} /> {ghost.label}
        </div>
      )}
      <PresentationControls />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
