import React, { memo, useEffect, useRef } from 'react';
import type { Card } from '../types';
import { colorStyle } from '../types';
import { sizes } from '../geometry';
import { get, set, useStore } from '../store';
import { Safe } from './Safe';
import { NoteCard, HeadingCard, CommentCard, DocumentCard } from './cards/TextCards';
import { TodoCard } from './cards/TodoCard';
import { ImageCard, FileCard, LinkCard, SketchCard, ColorCard } from './cards/MediaCards';
import { ColumnCard, BoardCard, TableCard } from './cards/StructureCards';

let tickPending = false;
function bumpSizes() {
  if (tickPending) return;
  tickPending = true;
  requestAnimationFrame(() => { tickPending = false; set({ sizeTick: get().sizeTick + 1 }); });
}

const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(entries => {
  let changed = false;
  for (const e of entries) {
    const el = e.target as HTMLElement;
    const id = el.dataset.cardId!;
    if (el.dataset.colChild) continue;
    const w = el.offsetWidth, h = el.offsetHeight;
    const prev = sizes.get(id);
    if (!prev || prev.w !== w || prev.h !== h) { sizes.set(id, { w, h }); changed = true; }
  }
  if (changed) bumpSizes();
}) : null;

export interface CardProps { card: Card; editing: boolean; selected: boolean; inColumn?: boolean }

const BODIES: Record<string, React.FC<CardProps>> = {
  note: NoteCard, heading: HeadingCard, todo: TodoCard, comment: CommentCard, document: DocumentCard,
  image: ImageCard, file: FileCard, link: LinkCard, sketch: SketchCard, color: ColorCard,
  column: ColumnCard, board: BoardCard, table: TableCard,
};

const NO_RESIZE = new Set(['board', 'document']);

export const CardView = memo(function CardView({ card, selected, editing, dropping, inColumn }: {
  card: Card; selected: boolean; editing: boolean; dropping?: boolean; inColumn?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const flash = useStore(s => s.flashId === card.id);
  const readOnly = useStore(s => s.readOnly);

  useEffect(() => {
    const el = ref.current!;
    if (inColumn || !ro) return;
    ro.observe(el);
    sizes.set(card.id, { w: el.offsetWidth, h: el.offsetHeight });
    bumpSizes();
    return () => { ro.unobserve(el); };
  }, [inColumn, card.id]);

  // À l'entrée en mode édition : curseur à l'endroit cliqué, sinon dans le premier champ.
  useEffect(() => {
    if (!editing) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && el.contains(active)) return;
      const pt = get().editPoint;
      const sel = window.getSelection();
      if (pt && (document as any).caretRangeFromPoint) {
        const r: Range | null = (document as any).caretRangeFromPoint(pt.x, pt.y);
        const host = r && (r.startContainer.nodeType === 1 ? r.startContainer as HTMLElement : r.startContainer.parentElement)?.closest('[contenteditable="true"],[contenteditable="plaintext-only"]') as HTMLElement | null;
        if (r && host && el.contains(host)) { host.focus({ preventScroll: true }); sel?.removeAllRanges(); sel?.addRange(r); return; }
      }
      const first = el.querySelector('[contenteditable="true"],[contenteditable="plaintext-only"],textarea,input') as HTMLElement | null;
      if (first) {
        first.focus({ preventScroll: true });
        if (first.isContentEditable) { const r = document.createRange(); r.selectNodeContents(first); r.collapse(false); sel?.removeAllRanges(); sel?.addRange(r); }
      }
    }));
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  const Body = BODIES[card.type];
  if (!Body) return null;
  const style: React.CSSProperties = inColumn ? {} : { left: card.x, top: card.y, width: card.w, zIndex: card.z };
  const colored = colorStyle(card.color);
  const bgTypes = !['board', 'heading', 'color', 'image', 'line'].includes(card.type);
  const cls = [
    'card', `card-${card.type}`,
    selected && 'selected', editing && 'editing', dropping && 'drop-target', flash && 'flash',
    inColumn && 'in-column', card.color && bgTypes && 'colored', card.color === 'dark' && 'dark-card',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={ref}
      className={cls}
      style={{ ...style, ...(bgTypes ? colored : card.type === 'heading' && card.color ? { color: colored.background } : {}) }}
      data-card-id={card.id}
      data-col-child={inColumn ? card.parent : undefined}
    >
      <Safe name={card.type} fallback={<div className="card-pad muted">Carte illisible</div>}><Body card={card} editing={editing} selected={selected} inColumn={inColumn} /></Safe>
      {!inColumn && !readOnly && !editing && !NO_RESIZE.has(card.type) && <div className="resize-handle" data-resize={card.id} title={card.type === 'heading' ? 'Glissez pour agrandir le titre (Maj : largeur seule)' : 'Redimensionner'} />}
      {!inColumn && !readOnly && !editing && (['t', 'r', 'b', 'l'] as const).map(side => (
        <div key={side} className={'connector c-' + side} data-connector={card.id} title="Glissez pour tracer une flèche" />
      ))}
    </div>
  );
});
