import React from 'react';
import type { Card } from '../types';
import { useStore, updateData, set, checkpoint } from '../store';
import { lineGeometry, arrowHead } from '../geometry';

export function LinesLayer({ lines }: { lines: Card[] }) {
  const cards = useStore(s => s.cards);
  const boardId = useStore(s => s.boardId);
  useStore(s => s.sizeTick); // recalcul quand une carte change de taille
  const selection = useStore(s => s.selection);
  const editingId = useStore(s => s.editingId);
  const readOnly = useStore(s => s.readOnly);
  const lookup = (id: string) => cards[id];

  const items = lines.map(l => ({ l, g: lineGeometry(l, lookup, boardId) })).filter(x => x.g);

  return (
    <>
      <svg className="lines-layer" width="1" height="1">
        {items.map(({ l, g }) => {
          const d = l.data;
          const sel = selection.includes(l.id);
          const w = d.width || 2;
          const size = 7 + w * 2;
          // tangentes pour les flèches
          const endFrom = g!.curved ? g!.ctrl : g!.A;
          const startFrom = g!.curved ? g!.ctrl : g!.B;
          return (
            <g key={l.id} className={'line' + (sel ? ' selected' : '')} style={{ zIndex: l.z } as any}>
              <path d={g!.d} className="line-hit" data-line-id={l.id} fill="none" stroke="transparent" />
              <path d={g!.d} stroke={d.color} strokeWidth={w} fill="none" strokeLinecap="round" strokeDasharray={d.dashed ? `${w * 4} ${w * 3}` : undefined} pointerEvents="none" />
              {sel && <path d={g!.d} className="line-sel" stroke="currentColor" strokeWidth={w + 6} fill="none" pointerEvents="none" />}
              {d.arrowEnd && <path d={arrowHead(g!.B, endFrom, size)} fill={d.color} pointerEvents="none" />}
              {d.arrowStart && <path d={arrowHead(g!.A, startFrom, size)} fill={d.color} pointerEvents="none" />}
            </g>
          );
        })}
      </svg>
      {items.map(({ l, g }) => {
        const sel = selection.includes(l.id);
        const editing = editingId === l.id;
        return (
          <React.Fragment key={l.id}>
            {(l.data.label || editing) && (
              <div className={'line-label' + (sel ? ' selected' : '')} style={{ left: g!.handle.x, top: g!.handle.y }} data-line-id={l.id}>
                {editing && !readOnly ? (
                  <input autoFocus defaultValue={l.data.label} placeholder="Libellé"
                    onFocus={() => checkpoint()}
                    onChange={e => updateData(l.id, { label: e.target.value }, false)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') set({ editingId: null }); }}
                    onBlur={() => set({ editingId: null })} />
                ) : <span>{l.data.label}</span>}
              </div>
            )}
            {sel && !readOnly && (
              <>
                <div className="line-handle end" data-line-handle="from" data-line-id={l.id} style={{ left: g!.A.x, top: g!.A.y }} title="Glissez sur une carte pour l'attacher" />
                <div className="line-handle end" data-line-handle="to" data-line-id={l.id} style={{ left: g!.B.x, top: g!.B.y }} title="Glissez sur une carte pour l'attacher" />
                {!l.data.label && !editing && <div className="line-handle mid" data-line-handle="mid" data-line-id={l.id} style={{ left: g!.handle.x, top: g!.handle.y }} title="Glissez pour courber — double-clic pour redresser" />}
              </>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}
