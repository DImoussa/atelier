import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CardProps } from '../CardView';
import { CardView } from '../CardView';
import { PlainText } from '../RichText';
import { updateData, updateBoard, useStore, countLabel, set, checkpoint, navigate, get } from '../../store';
import { Icon } from '../../icons';
import { useBlobUrl } from './MediaCards';
import type { Board } from '../../types';

/** Vignette de planche : image de couverture si définie, sinon icône sur fond coloré. */
export function BoardIcon({ board, size }: { board: Board; size?: number }) {
  const cover = useBlobUrl(board.cover);
  const st: React.CSSProperties = { background: board.color, ...(size ? { width: size, height: size, fontSize: size * 0.47 } : {}) };
  if (cover) Object.assign(st, { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' });
  return (
    <div className={'board-icon' + (cover ? ' has-cover' : '')} style={st} title="Double-cliquez pour ouvrir">
      {!cover && <span>{board.icon}</span>}
    </div>
  );
}

// ---------- Colonne ----------
export function ColumnCard({ card, editing }: CardProps) {
  const cards = useStore(s => s.cards);
  const selection = useStore(s => s.selection);
  const editingId = useStore(s => s.editingId);
  const columnDrop = useStore(s => s.columnDrop);
  const kids = useMemo(() => Object.values(cards).filter(c => c.parent === card.id && !c.trashed).sort((a, b) => a.order - b.order), [cards, card.id]);
  const dropIdx = columnDrop?.columnId === card.id ? columnDrop.index : -1;
  const collapsed = !!card.data.collapsed;
  return (
    <div className={'column' + (dropIdx >= 0 ? ' column-drop' : '')}>
      <div className="column-head">
        <PlainText className="column-title" value={card.data.title} editing={editing} placeholder="Sans titre"
          onChange={title => updateData(card.id, { title }, false)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); set({ editingId: null }); } }} />
        <span className="column-count">{kids.length}</span>
        <button className="icon-btn small" data-nodrag title={collapsed ? 'Déplier' : 'Replier'} onClick={() => updateData(card.id, { collapsed: !collapsed })}>
          <Icon name={collapsed ? 'expand' : 'collapse'} size={14} />
        </button>
      </div>
      {!collapsed && (
        <div className="column-body">
          {kids.map((k, i) => (
            <Fragment key={k.id}>
              {dropIdx === i && <div className="column-insert" />}
              <CardView card={k} inColumn selected={selection.includes(k.id)} editing={editingId === k.id} />
            </Fragment>
          ))}
          {dropIdx >= kids.length && <div className="column-insert" />}
          {kids.length === 0 && dropIdx < 0 && <div className="column-empty">Glissez des cartes ici</div>}
        </div>
      )}
      {collapsed && kids.length > 0 && <div className="column-collapsed">{kids.length} carte{kids.length > 1 ? 's' : ''} masquée{kids.length > 1 ? 's' : ''}</div>}
    </div>
  );
}

// ---------- Planche ----------
export function BoardCard({ card, editing }: CardProps) {
  const board = useStore(s => s.boards[card.data.boardId]);
  const label = useStore(s => countLabel(card.data.boardId, s));
  const readOnly = useStore(s => s.readOnly);
  if (!board) return <div className="board-card missing">Planche introuvable</div>;
  return (
    <div className="board-card">
      <BoardIcon board={board} />
      <PlainText className="board-title" value={board.title} editing={editing} placeholder="Sans titre"
        onChange={title => updateBoard(board.id, { title })}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); set({ editingId: null }); } }} />
      <div className="board-count">{label}</div>
    </div>
  );
}

// ---------- Tableau ----------
export function TableCard({ card, editing }: CardProps) {
  const rows: string[][] = card.data.rows || [['']];
  const header = card.data.header !== false;
  const refs = useRef(new Map<string, HTMLElement>());
  const [focus, setFocus] = useState<[number, number] | null>(null);
  useEffect(() => {
    if (!focus || !editing) return;
    const el = refs.current.get(focus.join(':'));
    if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    setFocus(null);
  }, [focus, editing, rows.length]);

  const setRows = (next: string[][], history = true) => updateData(card.id, { rows: next }, history);
  const setCell = (r: number, c: number, v: string) => setRows(rows.map((row, i) => i === r ? row.map((x, j) => j === c ? v : x) : row), false);
  const cols = Math.max(...rows.map(r => r.length));

  const onKey = (e: React.KeyboardEvent, r: number, c: number) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      let nr = r, nc = c + (e.shiftKey ? -1 : 1);
      if (nc >= cols) { nc = 0; nr++; }
      if (nc < 0) { nc = cols - 1; nr--; }
      if (nr >= rows.length) { checkpoint(); setRows([...rows, Array(cols).fill('')], false); }
      if (nr >= 0) setFocus([nr, nc]);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (r + 1 >= rows.length) { checkpoint(); setRows([...rows, Array(cols).fill('')], false); }
      setFocus([r + 1, c]);
    } else if (e.key === 'ArrowUp' && r > 0) { e.preventDefault(); setFocus([r - 1, c]); }
    else if (e.key === 'ArrowDown' && r < rows.length - 1) { e.preventDefault(); setFocus([r + 1, c]); }
  };

  return (
    <div className="table-card">
      <div className="table-scroll">
        <table>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className={header && r === 0 ? 'th' : ''}>
                {Array.from({ length: cols }).map((_, c) => (
                  <td key={c}>
                    <PlainText value={row[c] || ''} editing={editing} onChange={v => setCell(r, c, v)} onKeyDown={e => onKey(e, r, c)}
                      inputRef={el => { if (el) refs.current.set(`${r}:${c}`, el); else refs.current.delete(`${r}:${c}`); }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && (
        <div className="table-tools" data-nodrag>
          <button className="link-btn" onClick={() => setRows([...rows, Array(cols).fill('')])}>+ Ligne</button>
          <button className="link-btn" onClick={() => setRows(rows.map(r => [...r, '']))}>+ Colonne</button>
          <button className="link-btn" disabled={rows.length <= 1} onClick={() => setRows(rows.slice(0, -1))}>− Ligne</button>
          <button className="link-btn" disabled={cols <= 1} onClick={() => setRows(rows.map(r => r.slice(0, cols - 1)))}>− Colonne</button>
          <label className="check-label"><input type="checkbox" checked={header} onChange={e => updateData(card.id, { header: e.target.checked })} /> En-tête</label>
        </div>
      )}
    </div>
  );
}
