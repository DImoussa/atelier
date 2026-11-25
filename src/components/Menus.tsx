import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  useStore, set, get, mutate, duplicate, trashCards, bringToFront, sendToBack, arrange, moveToBoard, navigate, createCard, updateCard, updateData, undo, redo,
} from '../store';
import { Icon } from '../icons';
import { CARD_COLORS, LINE_COLORS, UNSORTED, EDITABLE_TYPES, type Card } from '../types';
import { copySelection, cutSelection, hasInternalClip, pasteInternal } from '../clipboard';
import { fitToContent, getCanvas, currentVp, zoomToSelection } from '../interaction';
import { cardRect, boundsOf, lineGeometry } from '../geometry';
import { downloadCardFile } from './cards/MediaCards';
import { insertImageFromUrl } from '../files';

const COLORABLE = new Set(['note', 'todo', 'link', 'column', 'comment', 'table', 'file', 'document']);

function ColorRow({ cards }: { cards: Card[] }) {
  const current = cards.length === 1 ? cards[0].color ?? null : undefined;
  return (
    <div className="color-row">
      {CARD_COLORS.map(c => (
        <button key={String(c.id)} className={'color-dot' + (current === c.id ? ' on' : '')} title={c.label}
          style={{ background: c.id ? c.bg : 'var(--card)' }}
          onClick={() => { const ids = cards.map(k => k.id); mutate(d => ids.forEach(id => { d.cards[id].color = c.id; })); }} />
      ))}
    </div>
  );
}

// ---------- Menu contextuel ----------
export function ContextMenu() {
  const menu = useStore(s => s.menu);
  const selection = useStore(s => s.selection);
  const cards = useStore(s => s.cards);
  const readOnly = useStore(s => s.readOnly);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu || !ref.current) { setPos(null); return; }
    const r = ref.current.getBoundingClientRect();
    setPos({ x: Math.min(menu.x, innerWidth - r.width - 8), y: Math.min(menu.y, innerHeight - r.height - 8) });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) set({ menu: null }); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') set({ menu: null }); };
    setTimeout(() => window.addEventListener('pointerdown', close), 0);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [menu]);

  if (!menu) return null;
  const close = () => set({ menu: null });
  const item = (icon: string, label: string, fn: () => void, kbd?: string, cls = '') => (
    <button className={'menu-item ' + cls} onClick={() => { close(); fn(); }}><Icon name={icon} size={16} /><span>{label}</span>{kbd && <kbd>{kbd}</kbd>}</button>
  );

  let content: React.ReactNode;
  if (menu.target === 'canvas') {
    const w = menu.world!;
    content = readOnly ? (
      <>{item('fit', 'Tout afficher', () => fitToContent(1.5), 'Ctrl 1')}</>
    ) : (
      <>
        {item('note', 'Nouvelle note ici', () => createCard('note', w.x, w.y))}
        {item('board', 'Nouvelle planche ici', () => createCard('board', w.x, w.y))}
        {item('column', 'Nouvelle colonne ici', () => createCard('column', w.x, w.y))}
        {item('photo', 'Image depuis une adresse web…', () => { const u = prompt("Adresse de l'image (https://…) :"); if (u) insertImageFromUrl(u, w); })}
        {hasInternalClip() && item('copy', 'Coller ici', () => pasteInternal(null, w), 'Ctrl V')}
        <div className="menu-sep" />
        {item('template', 'Tout sélectionner', () => set({ selection: Object.values(get().cards).filter(c => c.parent === get().boardId && !c.trashed).map(c => c.id) }), 'Ctrl A')}
        {item('fit', 'Tout afficher', () => fitToContent(1.5), 'Ctrl 1')}
        <div className="menu-sep" />
        {item('undo', 'Annuler', undo, 'Ctrl Z')}
        {item('redo', 'Rétablir', redo, 'Ctrl Maj Z')}
      </>
    );
  } else {
    const sel = selection.map(id => cards[id]).filter(Boolean);
    const one = sel.length === 1 ? sel[0] : null;
    const colorable = sel.filter(c => COLORABLE.has(c.type));
    content = (
      <>
        {one?.type === 'board' && item('board', 'Ouvrir la planche', () => navigate(one.data.boardId, { readOnly }))}
        {one?.type === 'image' && item('eye', 'Agrandir', () => set({ modal: { kind: 'lightbox', cardId: one.id } }))}
        {one?.type === 'image' && !readOnly && item('crop', 'Recadrer / pivoter', () => set({ modal: { kind: 'crop', cardId: one.id } }))}
        {one?.type === 'document' && item('document', 'Ouvrir le document', () => set({ modal: { kind: 'document', cardId: one.id } }))}
        {!readOnly && <>
          {one && EDITABLE_TYPES.includes(one.type) && item('pen', 'Modifier', () => set({ editingId: one.id, editPoint: null }), 'Entrée')}
          {one?.type === 'sketch' && item('sketch', 'Modifier le dessin', () => set({ modal: { kind: 'sketch', cardId: one.id } }))}
          {one?.type === 'board' && item('color', 'Apparence de la planche', () => set({ modal: { kind: 'icon', boardId: one.data.boardId } }))}
          {one?.type === 'line' && item('label', one.data.label ? 'Modifier le libellé' : 'Ajouter un libellé', () => set({ editingId: one.id }))}
          {one?.type === 'line' && item('line', 'Redresser la ligne', () => updateData(one.id, { curve: { x: 0, y: 0 } }))}
          {one?.type === 'column' && item(one.data.collapsed ? 'expand' : 'collapse', one.data.collapsed ? 'Déplier' : 'Replier', () => updateData(one.id, { collapsed: !one.data.collapsed }))}
        </>}
        {(one?.type === 'image' || one?.type === 'file') && one.data.blobId && item('download', 'Télécharger', () => downloadCardFile(one))}
        {!readOnly && <>
          {colorable.length > 0 && <><div className="menu-label">Couleur</div><ColorRow cards={colorable} /></>}
          <div className="menu-sep" />
          {item('copy', 'Dupliquer', () => duplicate(selection), 'Ctrl D')}
          {item('copy', 'Copier', () => copySelection(), 'Ctrl C')}
          {item('close', 'Couper', () => cutSelection(), 'Ctrl X')}
          <div className="menu-sep" />
          {item('fit', 'Zoomer sur la sélection', () => zoomToSelection(), 'Maj 2')}
          {item('collapse', 'Premier plan', () => bringToFront(selection), 'Ctrl ]')}
          {item('expand', 'Arrière-plan', () => sendToBack(selection), 'Ctrl [')}
          {sel.length > 1 && <><div className="menu-label">Aligner</div><AlignRow ids={selection} after={close} /></>}
          <div className="menu-sep" />
          {item('move', 'Déplacer vers une planche…', () => set({ modal: { kind: 'move', ids: selection } }))}
          {sel.every(c => c.parent !== UNSORTED) && item('inbox', 'Envoyer dans « À trier »', () => moveToBoard(selection, UNSORTED))}
          <div className="menu-sep" />
          {item('trash', 'Supprimer', () => trashCards(selection), 'Suppr', 'danger')}
        </>}
        {readOnly && item('copy', 'Copier', () => copySelection(), 'Ctrl C')}
      </>
    );
  }
  return (
    <div className="context-menu dropdown" ref={ref} data-ui style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={e => e.preventDefault()}>
      {content}
    </div>
  );
}

function AlignRow({ ids, after }: { ids: string[]; after?: () => void }) {
  const b = (mode: any, title: string, glyph: React.ReactNode) => (
    <button className="icon-btn small" title={title} onClick={() => { arrange(ids, mode); after?.(); }}>{glyph}</button>
  );
  const svg = (d: string) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d={d} /></svg>;
  return (
    <div className="align-row">
      {b('left', 'Aligner à gauche', svg('M4 3v18M8 7h10M8 13h6M8 17h12'))}
      {b('hcenter', 'Centrer horizontalement', svg('M12 3v18M6 7h12M9 12h6M5 17h14'))}
      {b('right', 'Aligner à droite', svg('M20 3v18M6 7h10M10 12h6M4 17h12'))}
      {b('top', 'Aligner en haut', svg('M3 4h18M7 8v10M12 8v6M17 8v12'))}
      {b('vmiddle', 'Centrer verticalement', svg('M3 12h18M7 6v12M12 9v6M17 5v14'))}
      {b('bottom', 'Aligner en bas', svg('M3 20h18M7 6v10M12 10v6M17 4v12'))}
      {b('hdist', 'Répartir horizontalement', svg('M4 4v16M20 4v16M10 8v8M14 8v8'))}
      {b('vdist', 'Répartir verticalement', svg('M4 4h16M4 20h16M8 10h8M8 14h8'))}
      {b('grid', 'Ranger en grille', svg('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'))}
    </div>
  );
}

// ---------- Barre flottante de sélection ----------
export function SelectionToolbar() {
  const selection = useStore(s => s.selection);
  const cards = useStore(s => s.cards);
  const editingId = useStore(s => s.editingId);
  const dragging = useStore(s => s.dragging);
  const readOnly = useStore(s => s.readOnly);
  const boardId = useStore(s => s.boardId);
  const vp = useStore(s => s.viewports[s.boardId]);
  const modal = useStore(s => s.modal);
  useStore(s => s.sizeTick);
  const [showAlign, setShowAlign] = useState(false);
  useEffect(() => setShowAlign(false), [selection.join()]);
  const tbRef = useRef<HTMLDivElement>(null);
  const [tw, setTw] = useState(300);
  useLayoutEffect(() => { const w = tbRef.current?.offsetWidth; if (w && Math.abs(w - tw) > 2) setTw(w); });

  const sel = selection.map(id => cards[id]).filter(c => c && !c.trashed && (c.parent === boardId || cards[c.parent]?.parent === boardId));
  if (!sel.length || dragging || readOnly || modal) return null;
  const editing = editingId ? cards[editingId] : null;
  if (editing && (editing.type === 'note' || editing.type === 'line')) return null;
  const canvas = getCanvas();
  if (!canvas) return null;
  const cr = canvas.getBoundingClientRect();
  const v = vp || currentVp();
  // rectangle à l'écran de la sélection
  const rects = sel.map(c => {
    if (c.type === 'line') {
      const g = lineGeometry(c, id => cards[id], boardId);
      return g ? { x: Math.min(g.A.x, g.B.x, g.handle.x), y: Math.min(g.A.y, g.B.y, g.handle.y), w: Math.abs(g.A.x - g.B.x), h: Math.abs(g.A.y - g.B.y) } : null;
    }
    if (c.parent !== boardId) {
      const el = document.querySelector(`[data-card-id="${c.id}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: (r.left - cr.left - v.x) / v.zoom, y: (r.top - cr.top - v.y) / v.zoom, w: r.width / v.zoom, h: r.height / v.zoom };
    }
    return cardRect(c);
  }).filter(Boolean) as any[];
  const b = boundsOf(rects);
  if (!b) return null;
  const sx = cr.left + (b.x + b.w / 2) * v.zoom + v.x;
  const sy = cr.top + b.y * v.zoom + v.y - (sel.some(c => c.type === 'line') ? 14 : 0);
  const top = Math.max(cr.top + 56, sy - 16);
  const left = Math.max(cr.left + tw / 2 + 8, Math.min(sx, cr.right - tw / 2 - 8));

  const lines = sel.filter(c => c.type === 'line');
  const colorable = sel.filter(c => COLORABLE.has(c.type));
  const one = sel.length === 1 ? sel[0] : null;
  const setLines = (patch: any) => mutate(d => lines.forEach(l => { d.cards[l.id].data = { ...d.cards[l.id].data, ...patch }; }));
  const L = lines[0]?.data;

  return (
    <div className="sel-toolbar" ref={tbRef} data-ui style={{ left, top }} onPointerDown={e => e.stopPropagation()}>
      {colorable.length > 0 && lines.length === 0 && <ColorRow cards={colorable} />}
      {lines.length > 0 && (
        <>
          <div className="color-row">
            {LINE_COLORS.map(c => <button key={c} className={'color-dot' + (L.color === c ? ' on' : '')} style={{ background: c }} onClick={() => setLines({ color: c })} title={c} />)}
          </div>
          <span className="tb-sep" />
          {[1, 2, 4].map(w => (
            <button key={w} className={'icon-btn small' + ((L.width || 2) === w ? ' active' : '')} title={`Épaisseur ${w}`} onClick={() => setLines({ width: w })}>
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M2 9h14" stroke="currentColor" strokeWidth={w} strokeLinecap="round" /></svg>
            </button>
          ))}
          <span className="tb-sep" />
          <button className={'icon-btn small' + (L.arrowStart ? ' active' : '')} title="Flèche au début" onClick={() => setLines({ arrowStart: !L.arrowStart })}><Icon name="arrowStart" size={16} /></button>
          <button className={'icon-btn small' + (L.arrowEnd ? ' active' : '')} title="Flèche à la fin" onClick={() => setLines({ arrowEnd: !L.arrowEnd })}><Icon name="arrowEnd" size={16} /></button>
          <button className={'icon-btn small' + (L.dashed ? ' active' : '')} title="Pointillés" onClick={() => setLines({ dashed: !L.dashed })}><Icon name="dashed" size={16} /></button>
          {one && <button className="icon-btn small" title="Libellé" onClick={() => set({ editingId: one.id })}><Icon name="label" size={16} /></button>}
        </>
      )}
      {one?.type === 'heading' && <HeadingTools card={one} />}
      {one?.type === 'board' && <button className="btn small ghost" onClick={() => set({ modal: { kind: 'icon', boardId: one.data.boardId } })}><Icon name="color" size={14} /> Apparence</button>}
      {one?.type === 'board' && <button className="btn small ghost" onClick={() => navigate(one.data.boardId)}>Ouvrir</button>}
      {one?.type === 'image' && <button className="btn small ghost" onClick={() => set({ modal: { kind: 'crop', cardId: one.id } })}><Icon name="crop" size={14} /> Recadrer</button>}
      {one?.type === 'sketch' && <button className="btn small ghost" onClick={() => set({ modal: { kind: 'sketch', cardId: one.id } })}><Icon name="sketch" size={14} /> Dessiner</button>}
      {one?.type === 'document' && <button className="btn small ghost" onClick={() => set({ modal: { kind: 'document', cardId: one.id } })}>Ouvrir</button>}
      {sel.length > 1 && (
        <div className="align-wrap">
          <button className={'btn small ghost' + (showAlign ? ' active' : '')} onClick={() => setShowAlign(s => !s)}>Aligner</button>
          {showAlign && <div className="align-pop"><AlignRow ids={selection} /></div>}
        </div>
      )}
      <span className="tb-sep" />
      <button className="icon-btn small" title="Dupliquer (Ctrl D)" onClick={() => duplicate(selection)}><Icon name="copy" size={16} /></button>
      <button className="icon-btn small" title="Supprimer (Suppr)" onClick={() => trashCards(selection)}><Icon name="trash" size={16} /></button>
      <button className="icon-btn small" title="Plus d'actions" onClick={e => set({ menu: { x: e.clientX, y: e.clientY + 16, target: 'cards' } })}><Icon name="more" size={16} /></button>
    </div>
  );
}

// ---------- Outils des titres ----------
const HEADING_SIZES = [{ l: 'S', v: 20 }, { l: 'M', v: 28 }, { l: 'L', v: 36 }, { l: 'XL', v: 56 }, { l: 'XXL', v: 88 }];
const HEADING_COLORS: (string | null)[] = [null, '#5d6b78', '#e9643b', '#d9a03f', '#3e9e8f', '#4a86c7', '#7c63c4', '#c4588f'];
function HeadingTools({ card }: { card: Card }) {
  const size = card.data.size || 36;
  const setSize = (n: number) => {
    const ns = Math.max(12, Math.min(240, Math.round(n)));
    updateCard(card.id, c => { c.w = Math.max(120, Math.round(c.w * ns / size)); c.data = { ...c.data, size: ns }; });
  };
  const alignSvg = (d: string) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d={d} /></svg>;
  const al = card.data.align || 'left';
  return (
    <div className="heading-tools">
      <button className="icon-btn small" title="Réduire le titre" onClick={() => setSize(size / 1.2)}><b style={{ fontSize: 11 }}>A−</b></button>
      <span className="size-label">{size}</span>
      <button className="icon-btn small" title="Agrandir le titre" onClick={() => setSize(size * 1.2)}><b style={{ fontSize: 14 }}>A+</b></button>
      {HEADING_SIZES.map(p => <button key={p.l} className={'btn small ghost' + (size === p.v ? ' active' : '')} style={{ padding: '0 6px' }} onClick={() => setSize(p.v)}>{p.l}</button>)}
      <span className="tb-sep" />
      <div className="color-row">
        {HEADING_COLORS.map(c => <button key={String(c)} className={'color-dot' + ((card.data.textColor || null) === c ? ' on' : '')} title={c ? c : 'Par défaut'} style={{ background: c || 'var(--text)' }} onClick={() => updateData(card.id, { textColor: c })} />)}
      </div>
      <span className="tb-sep" />
      <button className={'icon-btn small' + (al === 'left' ? ' active' : '')} title="Aligner à gauche" onClick={() => updateData(card.id, { align: 'left' })}>{alignSvg('M4 6h16M4 12h10M4 18h13')}</button>
      <button className={'icon-btn small' + (al === 'center' ? ' active' : '')} title="Centrer" onClick={() => updateData(card.id, { align: 'center' })}>{alignSvg('M4 6h16M7 12h10M5.5 18h13')}</button>
      <button className={'icon-btn small' + (al === 'right' ? ' active' : '')} title="Aligner à droite" onClick={() => updateData(card.id, { align: 'right' })}>{alignSvg('M4 6h16M10 12h10M7 18h13')}</button>
    </div>
  );
}

// ---------- Barre de mise en forme du texte ----------
const TEXT_COLORS = ['#1f2328', '#6b7280', '#e9643b', '#c2410c', '#ca8a04', '#15803d', '#0f766e', '#1d4ed8', '#7c3aed', '#be185d'];
const HL_COLORS = ['transparent', '#fde68a', '#fecaca', '#bbf7d0', '#bfdbfe', '#e9d5ff', '#fbcfe8'];

export function FormatBar({ floating = true }: { floating?: boolean }) {
  const editingId = useStore(s => s.editingId);
  const cards = useStore(s => s.cards);
  const vp = useStore(s => s.viewports[s.boardId]);
  const [pop, setPop] = useState<null | 'color' | 'hl'>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force(x => x + 1);
    document.addEventListener('selectionchange', f);
    return () => document.removeEventListener('selectionchange', f);
  }, []);
  const card = editingId ? cards[editingId] : null;
  if (floating && (!card || card.type !== 'note')) return null;

  let style: React.CSSProperties = {};
  if (floating) {
    const el = document.querySelector(`[data-card-id="${card!.id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    style = { left: Math.max(240, Math.min(r.left + r.width / 2, innerWidth - 240)), top: Math.max(60, r.top - 50) };
  }
  void vp;
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); emitInput(); };
  const block = (tag: string) => {
    const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
    exec('formatBlock', cur === tag ? 'p' : tag);
  };
  const isOn = (cmd: string) => { try { return document.queryCommandState(cmd); } catch { return false; } };
  const curBlock = (() => { try { return (document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch { return ''; } })();
  const btn = (icon: string, title: string, fn: () => void, on = false) => (
    <button className={'icon-btn small' + (on ? ' active' : '')} title={title} onMouseDown={e => { e.preventDefault(); fn(); }}><Icon name={icon} size={16} /></button>
  );
  return (
    <div className={'format-bar' + (floating ? ' floating' : '')} data-ui style={style} onPointerDown={e => e.stopPropagation()}>
      {btn('bold', 'Gras (Ctrl B)', () => exec('bold'), isOn('bold'))}
      {btn('italic', 'Italique (Ctrl I)', () => exec('italic'), isOn('italic'))}
      {btn('underline', 'Souligné (Ctrl U)', () => exec('underline'), isOn('underline'))}
      {btn('strike', 'Barré', () => exec('strikeThrough'), isOn('strikeThrough'))}
      <span className="tb-sep" />
      {btn('h1', 'Grand titre (# + espace)', () => block('h1'), curBlock === 'h1')}
      {btn('h2', 'Sous-titre (## + espace)', () => block('h2'), curBlock === 'h2')}
      {btn('ul', 'Liste à puces (- + espace)', () => exec('insertUnorderedList'), isOn('insertUnorderedList'))}
      {btn('ol', 'Liste numérotée (1. + espace)', () => exec('insertOrderedList'), isOn('insertOrderedList'))}
      {btn('quote', 'Citation (> + espace)', () => block('blockquote'), curBlock === 'blockquote')}
      {btn('code', 'Code', () => block('pre'), curBlock === 'pre')}
      <span className="tb-sep" />
      {btn('link', 'Lien (Ctrl K)', () => { const u = prompt('Adresse du lien :', 'https://'); if (u) exec('createLink', u); })}
      <div className="pop-wrap">
        {btn('textcolor', 'Couleur du texte', () => setPop(p => p === 'color' ? null : 'color'))}
        {pop === 'color' && <div className="mini-pop">{TEXT_COLORS.map(c => <button key={c} className="color-dot" style={{ background: c }} onMouseDown={e => { e.preventDefault(); exec('foreColor', c); setPop(null); }} />)}</div>}
      </div>
      <div className="pop-wrap">
        {btn('highlight', 'Surligner', () => setPop(p => p === 'hl' ? null : 'hl'))}
        {pop === 'hl' && <div className="mini-pop">{HL_COLORS.map(c => <button key={c} className="color-dot" style={{ background: c === 'transparent' ? 'var(--card)' : c }} title={c === 'transparent' ? 'Aucun' : ''} onMouseDown={e => { e.preventDefault(); exec('hiliteColor', c); setPop(null); }} />)}</div>}
      </div>
      {btn('clear', 'Effacer la mise en forme', () => { exec('removeFormat'); exec('formatBlock', 'p'); })}
    </div>
  );
}

function emitInput() {
  const el = document.activeElement as HTMLElement | null;
  if (el?.isContentEditable) el.dispatchEvent(new Event('input', { bubbles: true }));
}
