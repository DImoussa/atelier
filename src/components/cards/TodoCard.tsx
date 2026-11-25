import React, { useEffect, useRef, useState } from 'react';
import type { CardProps } from '../CardView';
import { PlainText } from '../RichText';
import { updateData, get, uid, useStore, checkpoint } from '../../store';
import { Icon } from '../../icons';
import type { TodoItem } from '../../types';

// ---------- Dates ----------
const pad = (n: number) => String(n).padStart(2, '0');
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };

export function formatDue(due: string) {
  const today = isoDay(new Date());
  if (due === today) return "Aujourd'hui";
  if (due === addDays(1)) return 'Demain';
  if (due === addDays(-1)) return 'Hier';
  const d = new Date(due + 'T12:00:00');
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
export function dueState(due: string | null | undefined, done: boolean) {
  if (!due || done) return '';
  const today = isoDay(new Date());
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  return '';
}

/** Noms déjà utilisés (vous, personnes assignées, auteurs de commentaires). */
function knownNames(): string[] {
  const s = get();
  const set = new Set<string>([s.settings.userName]);
  for (const c of Object.values(s.cards)) {
    if (c.type === 'todo') for (const i of c.data.items || []) if (i.assignee) set.add(i.assignee);
    if (c.type === 'comment') for (const m of c.data.thread || []) if (m.author) set.add(m.author);
  }
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

function initials(n: string) { return (n || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase(); }
function hue(n: string) { let h = 0; for (const ch of n || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }

export function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(name)} 45% 55%)` }}>{initials(name)}</span>;
}

// ---------- Fenêtre échéance / personne ----------
function ItemPopover({ item, kind, onChange, onClose }: { item: TodoItem; kind: 'due' | 'who'; onChange: (p: Partial<TodoItem>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState(item.assignee || '');
  const names = useRef(knownNames()).current;
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    setTimeout(() => window.addEventListener('pointerdown', down), 0);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key, true); };
  }, []);
  const pick = (p: Partial<TodoItem>) => { onChange(p); onClose(); };
  return (
    <div className="todo-pop" ref={ref} data-ui onPointerDown={e => e.stopPropagation()}>
      {kind === 'due' ? (
        <>
          <div className="pop-title">Échéance</div>
          <input type="date" autoFocus value={item.due || ''} onChange={e => onChange({ due: e.target.value || null })} />
          <div className="pop-quick">
            <button onClick={() => pick({ due: addDays(0) })}>Aujourd'hui</button>
            <button onClick={() => pick({ due: addDays(1) })}>Demain</button>
            <button onClick={() => pick({ due: addDays(7) })}>Dans 1 semaine</button>
          </div>
          {item.due && <button className="link-btn danger" onClick={() => pick({ due: null })}>Retirer l'échéance</button>}
        </>
      ) : (
        <>
          <div className="pop-title">Assigner à</div>
          <form onSubmit={e => { e.preventDefault(); pick({ assignee: name.trim() || null }); }}>
            <input autoFocus value={name} placeholder="Nom de la personne" onChange={e => setName(e.target.value)} />
          </form>
          <div className="pop-names">
            {names.filter(n => !name || n.toLowerCase().includes(name.toLowerCase())).map(n => (
              <button key={n} className={n === item.assignee ? 'on' : ''} onClick={() => pick({ assignee: n })}><Avatar name={n} /> {n}</button>
            ))}
          </div>
          {item.assignee && <button className="link-btn danger" onClick={() => pick({ assignee: null })}>Retirer</button>}
        </>
      )}
    </div>
  );
}

// ---------- Carte liste de tâches ----------
export function TodoCard({ card, editing }: CardProps) {
  const items: TodoItem[] = card.data.items || [];
  const hideDone = !!card.data.hideDone;
  const refs = useRef(new Map<string, HTMLElement>());
  const [focusId, setFocusId] = useState<{ id: string; atEnd: boolean } | null>(null);
  const [pop, setPop] = useState<{ id: string; kind: 'due' | 'who' } | null>(null);
  const readOnly = useStore(s => s.readOnly);

  useEffect(() => {
    if (!focusId || !editing) return;
    const el = refs.current.get(focusId.id);
    if (el) {
      el.focus();
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(!focusId.atEnd);
      const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
    }
    setFocusId(null);
  }, [focusId, editing, items.length]);

  useEffect(() => {
    if (editing && !card.data.title && items.length === 1 && !items[0].text && !get().editPoint) setFocusId({ id: items[0].id, atEnd: true });
    if (!editing) setPop(null);
  }, [editing]);

  const setItems = (next: TodoItem[], history = false) => updateData(card.id, { items: next }, history);
  const setItem = (id: string, p: Partial<TodoItem>) => setItems(items.map(x => x.id === id ? { ...x, ...p } : x), true);
  const done = items.filter(i => i.done).length;
  const visible = hideDone && !editing ? items.filter(i => !i.done) : items;

  const onItemKey = (e: React.KeyboardEvent<HTMLElement>, idx: number) => {
    const it = items[idx];
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      checkpoint();
      const n: TodoItem = { id: uid(), text: '', done: false };
      const next = [...items]; next.splice(idx + 1, 0, n);
      setItems(next);
      setFocusId({ id: n.id, atEnd: true });
    } else if (e.key === 'Backspace' && !((e.target as HTMLElement).textContent || '').replace(/\n/g, '') && items.length > 1) {
      e.preventDefault();
      checkpoint();
      setItems(items.filter(x => x.id !== it.id));
      setFocusId({ id: items[Math.max(0, idx - 1)].id, atEnd: true });
    } else if (e.key === 'ArrowUp' && e.altKey && idx > 0) {
      e.preventDefault(); checkpoint();
      const next = [...items]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; setItems(next); setFocusId({ id: it.id, atEnd: true });
    } else if (e.key === 'ArrowDown' && e.altKey && idx < items.length - 1) {
      e.preventDefault(); checkpoint();
      const next = [...items]; [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]]; setItems(next); setFocusId({ id: it.id, atEnd: true });
    } else if (e.key === 'ArrowUp' && idx > 0 && caretAtStart()) {
      e.preventDefault(); setFocusId({ id: items[idx - 1].id, atEnd: true });
    } else if (e.key === 'ArrowDown' && idx < items.length - 1 && caretAtEnd(e.target as HTMLElement)) {
      e.preventDefault(); setFocusId({ id: items[idx + 1].id, atEnd: false });
    }
  };

  return (
    <div className="card-pad todo">
      <div className="todo-head">
        <PlainText className="todo-title" value={card.data.title} editing={editing} placeholder="Liste de tâches"
          onChange={title => updateData(card.id, { title }, false)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setFocusId({ id: items[0]?.id, atEnd: false }); } }} />
        {items.length > 0 && <span className="todo-progress">{done}/{items.length}</span>}
      </div>
      {items.length > 1 && <div className="todo-bar"><div style={{ width: `${(done / items.length) * 100}%` }} /></div>}
      <ul className="todo-list">
        {visible.map(it => {
          const idx = items.indexOf(it);
          const ds = dueState(it.due, it.done);
          return (
            <li key={it.id} className={it.done ? 'done' : ''}>
              <button className={'check' + (it.done ? ' on' : '')} data-nodrag disabled={readOnly} aria-label={it.done ? 'Décocher' : 'Cocher'}
                onClick={() => setItem(it.id, { done: !it.done })}>
                {it.done && <Icon name="check" size={12} />}
              </button>
              <div className="todo-main">
                <PlainText className="todo-text" value={it.text} editing={editing} placeholder="À faire…"
                  inputRef={el => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id); }}
                  onChange={text => setItems(items.map(x => x.id === it.id ? { ...x, text } : x))}
                  onKeyDown={e => onItemKey(e, idx)} />
                {(it.due || it.assignee) && (
                  <div className="todo-meta">
                    {it.due && (
                      <button className={'chip ' + ds} data-nodrag disabled={readOnly} title="Modifier l'échéance" onClick={() => setPop({ id: it.id, kind: 'due' })}>
                        <Icon name="calendar" size={12} /> {formatDue(it.due)}
                      </button>
                    )}
                    {it.assignee && (
                      <button className="chip" data-nodrag disabled={readOnly} title="Modifier la personne" onClick={() => setPop({ id: it.id, kind: 'who' })}>
                        <Avatar name={it.assignee} size={15} /> {it.assignee}
                      </button>
                    )}
                  </div>
                )}
              </div>
              {editing && !readOnly && (
                <div className="todo-item-tools">
                  <button className="icon-btn small" data-nodrag title="Échéance" onClick={() => setPop({ id: it.id, kind: 'due' })}><Icon name="calendar" size={14} /></button>
                  <button className="icon-btn small" data-nodrag title="Assigner" onClick={() => setPop({ id: it.id, kind: 'who' })}><Icon name="user" size={14} /></button>
                </div>
              )}
              {pop?.id === it.id && <ItemPopover item={it} kind={pop.kind} onChange={p => setItem(it.id, p)} onClose={() => setPop(null)} />}
            </li>
          );
        })}
      </ul>
      {hideDone && !editing && done > 0 && <div className="muted tiny">{done} tâche{done > 1 ? 's' : ''} terminée{done > 1 ? 's' : ''} masquée{done > 1 ? 's' : ''}</div>}
      {editing && (
        <div className="todo-foot">
          <button className="todo-add" data-nodrag onClick={() => { checkpoint(); const n: TodoItem = { id: uid(), text: '', done: false }; setItems([...items, n]); setFocusId({ id: n.id, atEnd: true }); }}>
            <Icon name="plus" size={14} /> Ajouter une tâche
          </button>
          <button className="link-btn" data-nodrag onClick={() => updateData(card.id, { hideDone: !hideDone })}>{hideDone ? 'Afficher les terminées' : 'Masquer les terminées'}</button>
        </div>
      )}
    </div>
  );
}

function caretAtStart() {
  const s = window.getSelection();
  return !!s && s.isCollapsed && s.anchorOffset === 0;
}
function caretAtEnd(el: HTMLElement) {
  const s = window.getSelection();
  if (!s || !s.isCollapsed) return false;
  const r = document.createRange(); r.selectNodeContents(el); r.setStart(s.anchorNode!, s.anchorOffset);
  return r.toString().length === 0;
}
