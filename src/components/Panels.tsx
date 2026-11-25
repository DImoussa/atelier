import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useStore, set, get, restoreCard, deleteForever, emptyTrash, cardText, boardOfCard, reachableBoards, navigate, makeCard, mutate, addCardDraft, maxZ,
} from '../store';
import { Icon } from '../icons';
import { CardView } from './CardView';
import { startGhostDrag, centerOn } from '../interaction';
import { TYPE_LABEL, UNSORTED, ROOT_ID, type Card } from '../types';
import { timeAgo } from './cards/TextCards';

const TYPE_ICON: Record<string, string> = {
  note: 'note', todo: 'todo', link: 'link', image: 'image', file: 'file', column: 'column', board: 'board', line: 'line',
  heading: 'heading', color: 'color', sketch: 'sketch', table: 'table', comment: 'comment', document: 'document',
};

export function SidePanel() {
  const panel = useStore(s => s.panel);
  if (!panel) return null;
  return (
    <aside className="side-panel" data-ui data-drop={panel === 'unsorted' ? 'unsorted' : undefined}>
      {panel === 'unsorted' && <UnsortedPanel />}
      {panel === 'trash' && <TrashPanel />}
      {panel === 'search' && <SearchPanel />}
    </aside>
  );
}

function PanelHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <h2>{title}</h2>
      {children}
      <button className="icon-btn" onClick={() => set({ panel: null })} title="Fermer"><Icon name="close" size={18} /></button>
    </div>
  );
}

// ---------- À trier ----------
function UnsortedPanel() {
  const cards = useStore(s => s.cards);
  const selection = useStore(s => s.selection);
  const editingId = useStore(s => s.editingId);
  const dropTarget = useStore(s => s.dropTarget);
  const list = useMemo(() => Object.values(cards).filter(c => c.parent === UNSORTED && !c.trashed).sort((a, b) => b.createdAt - a.createdAt), [cards]);
  const addNote = () => {
    const c = makeCard('note', UNSORTED, 0, 0);
    c.z = maxZ(UNSORTED) + 1;
    mutate(d => { addCardDraft(d, c); });
    set({ selection: [c.id], editingId: c.id, editPoint: null });
  };
  return (
    <div className={'panel-body unsorted' + (dropTarget === 'unsorted' ? ' drop-target' : '')}>
      <PanelHead title="À trier" />
      <p className="panel-help">Un endroit pour déposer vos idées en vrac. Glissez-les ensuite sur une planche.</p>
      <button className="btn small" onClick={addNote}><Icon name="plus" size={14} /> Nouvelle note</button>
      <div className="unsorted-list" data-scroll>
        {list.length === 0 && <div className="panel-empty">Rien à trier. Glissez une carte ici pour la mettre de côté.</div>}
        {list.map(c => (
          <div key={c.id} className="unsorted-item"
            onPointerDown={e => {
              if ((e.target as HTMLElement).closest('[contenteditable="true"],[contenteditable="plaintext-only"],input,textarea,button')) return;
              set({ selection: [c.id] });
              startGhostDrag(e, { kind: 'existing', cardId: c.id }, TYPE_LABEL[c.type], TYPE_ICON[c.type], () => {
                if (['note', 'todo', 'heading', 'table', 'comment', 'column', 'link', 'color'].includes(c.type)) set({ editingId: c.id, editPoint: { x: e.clientX, y: e.clientY } });
              });
            }}>
            <CardView card={c} inColumn selected={selection.includes(c.id)} editing={editingId === c.id} />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Corbeille ----------
function TrashPanel() {
  const cards = useStore(s => s.cards);
  const boards = useStore(s => s.boards);
  const list = useMemo(() => Object.values(cards).filter(c => c.trashed && !(cards[c.parent]?.trashed)).sort((a, b) => b.trashed!.at - a.trashed!.at), [cards]);
  return (
    <div className="panel-body">
      <PanelHead title="Corbeille">
        {list.length > 0 && <button className="link-btn danger" onClick={() => { if (confirm(`Supprimer définitivement ${list.length} élément(s) ? Cette action est irréversible.`)) emptyTrash(); }}>Vider</button>}
      </PanelHead>
      <div className="trash-list" data-scroll>
        {list.length === 0 && <div className="panel-empty">La corbeille est vide.</div>}
        {list.map(c => {
          const from = boards[boardOfCard(c, { cards, boards })];
          const text = c.type === 'board' ? boards[c.data.boardId]?.title : cardText(c);
          return (
            <div className="trash-item" key={c.id}>
              <Icon name={TYPE_ICON[c.type]} size={18} />
              <div className="trash-meta">
                <div className="trash-text">{(text || TYPE_LABEL[c.type]).slice(0, 80)}</div>
                <div className="muted tiny">{TYPE_LABEL[c.type]} · {from?.title || 'À trier'} · {timeAgo(c.trashed!.at)}</div>
              </div>
              <button className="icon-btn small" title="Restaurer" onClick={() => restoreCard(c.id)}><Icon name="restore" size={16} /></button>
              <button className="icon-btn small danger" title="Supprimer définitivement" onClick={() => { if (confirm('Supprimer définitivement cet élément ? Cette action est irréversible.')) deleteForever([c.id]); }}><Icon name="close" size={16} /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Recherche ----------
function SearchPanel() {
  const cards = useStore(s => s.cards);
  const boards = useStore(s => s.boards);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return [];
    const doc = { cards, boards };
    const reach = reachableBoards(doc);
    const out: { card?: Card; boardId: string; title: string; snippet: string; kind: string }[] = [];
    for (const b of Object.values(boards)) {
      if (b.id !== ROOT_ID && reach.has(b.id) && b.title.toLowerCase().includes(query)) out.push({ boardId: b.id, title: b.title, snippet: 'Planche', kind: 'board' });
    }
    for (const c of Object.values(cards)) {
      if (c.trashed || c.type === 'board') continue;
      const bid = boardOfCard(c, doc);
      if (bid !== UNSORTED && !reach.has(bid)) continue;
      if (c.parent !== bid && cards[c.parent]?.trashed) continue;
      const t = cardText(c);
      const i = t.toLowerCase().indexOf(query);
      if (i < 0) continue;
      const start = Math.max(0, i - 30);
      out.push({ card: c, boardId: bid, title: TYPE_LABEL[c.type], snippet: (start ? '…' : '') + t.slice(start, i + query.length + 60).replace(/\n/g, ' '), kind: c.type });
      if (out.length > 200) break;
    }
    return out;
  }, [q, cards, boards]);

  const open = (r: typeof results[number]) => {
    if (r.kind === 'board') { navigate(r.boardId); set({ panel: null }); return; }
    if (r.boardId === UNSORTED) { set({ panel: 'unsorted', selection: [r.card!.id] }); return; }
    navigate(r.boardId);
    const id = r.card!.parent === r.boardId ? r.card!.id : r.card!.parent;
    setTimeout(() => {
      centerOn(id);
      set({ selection: [r.card!.id], flashId: r.card!.id });
      setTimeout(() => { if (get().flashId === r.card!.id) set({ flashId: null }); }, 1600);
    }, 60);
  };

  return (
    <div className="panel-body">
      <PanelHead title="Rechercher" />
      <div className="search-box">
        <Icon name="search" size={16} />
        <input ref={inputRef} value={q} placeholder="Rechercher dans toutes les planches…" onChange={e => { setQ(e.target.value); setActive(0); }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
            if (e.key === 'Enter' && results[active]) open(results[active]);
            if (e.key === 'Escape') set({ panel: null });
          }} />
      </div>
      <div className="search-results" data-scroll>
        {q && results.length === 0 && <div className="panel-empty">Aucun résultat pour « {q} »</div>}
        {results.map((r, i) => (
          <button key={(r.card?.id || r.boardId) + i} className={'search-item' + (i === active ? ' active' : '')} onClick={() => open(r)} onMouseEnter={() => setActive(i)}>
            <Icon name={TYPE_ICON[r.kind] || 'board'} size={16} />
            <div>
              <div className="search-snippet"><Highlight text={r.kind === 'board' ? r.title : r.snippet} q={q} /></div>
              <div className="muted tiny">{r.kind === 'board' ? 'Planche' : `${r.title} · ${r.boardId === UNSORTED ? 'À trier' : boards[r.boardId]?.title}`}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.trim().toLowerCase());
  if (i < 0 || !q.trim()) return <>{text}</>;
  const n = q.trim().length;
  return <>{text.slice(0, i)}<mark>{text.slice(i, i + n)}</mark>{text.slice(i + n)}</>;
}
