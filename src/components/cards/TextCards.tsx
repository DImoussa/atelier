import React, { useEffect, useRef, useState } from 'react';
import type { CardProps } from '../CardView';
import { RichText, PlainText } from '../RichText';
import { updateData, updateCard, get, set, uid, useStore, checkpoint } from '../../store';
import { htmlToText } from '../../sanitize';
import { Icon } from '../../icons';

// ---------- Note ----------
export function NoteCard({ card, editing }: CardProps) {
  return (
    <div className="card-pad">
      <RichText html={card.data.html} editing={editing} placeholder="Écrivez quelque chose…" onChange={html => updateData(card.id, { html }, false)} />
    </div>
  );
}

// ---------- Titre ----------
export function HeadingCard({ card, editing }: CardProps) {
  return (
    <div style={{ fontSize: card.data.size || 36, color: card.data.textColor || undefined, textAlign: card.data.align || undefined }}>
    <PlainText className="heading-text" value={card.data.text} editing={editing} focusOnEdit placeholder="Titre"
      onChange={text => updateData(card.id, { text }, false)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); set({ editingId: null }); } }} />
    </div>
  );
}

// ---------- Commentaire ----------
function initials(n: string) { return (n || '?').split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase(); }
function hue(n: string) { let h = 0; for (const ch of n || '') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "à l'instant";
  if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  return new Date(t).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export function CommentCard({ card, editing }: CardProps) {
  const thread: { id: string; author: string; text: string; at: number }[] = card.data.thread || [];
  const user = useStore(s => s.settings.userName);
  const readOnly = useStore(s => s.readOnly);
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (editing) requestAnimationFrame(() => taRef.current?.focus()); }, [editing]);
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    updateData(card.id, { thread: [...thread, { id: uid(), author: user, text, at: Date.now() }] });
    setDraft('');
  };
  return (
    <div className={'card-pad comment' + (card.data.resolved ? ' resolved' : '')}>
      {thread.length === 0 && !editing && <div className="muted">Double-cliquez pour commenter</div>}
      {thread.map(m => (
        <div className="comment-msg" key={m.id}>
          <div className="avatar" style={{ background: `hsl(${hue(m.author)} 45% 55%)` }}>{initials(m.author)}</div>
          <div className="comment-body">
            <div className="comment-meta"><b>{m.author}</b> <span>{timeAgo(m.at)}</span>
              {editing && m.author === user && <button data-nodrag className="link-btn" onClick={() => updateData(card.id, { thread: thread.filter(x => x.id !== m.id) })}>Supprimer</button>}
            </div>
            <div className="comment-text">{m.text}</div>
          </div>
        </div>
      ))}
      {editing && !readOnly && (
        <div className="comment-input">
          <textarea ref={taRef} value={draft} rows={2} placeholder={thread.length ? 'Répondre…' : 'Écrire un commentaire…'}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape') { set({ editingId: null }); }
            }} />
          <div className="comment-actions">
            <button data-nodrag className="link-btn" onClick={() => updateData(card.id, { resolved: !card.data.resolved })}>{card.data.resolved ? 'Rouvrir' : 'Marquer comme résolu'}</button>
            <button data-nodrag className="btn small primary" onClick={send} disabled={!draft.trim()}>Envoyer</button>
          </div>
        </div>
      )}
      {card.data.resolved && !editing && <div className="resolved-tag"><Icon name="check" size={12} /> Résolu</div>}
    </div>
  );
}

// ---------- Document ----------
export function DocumentCard({ card }: CardProps) {
  const excerpt = htmlToText(card.data.html || '').slice(0, 140);
  return (
    <div className="card-pad doc-card">
      <div className="doc-icon"><Icon name="document" size={26} /></div>
      <div className="doc-title">{card.data.title || 'Document sans titre'}</div>
      {excerpt && <div className="doc-excerpt">{excerpt}</div>}
      <button className="link-btn" data-nodrag onClick={() => set({ modal: { kind: 'document', cardId: card.id } })}>Ouvrir</button>
    </div>
  );
}

export { updateCard };
