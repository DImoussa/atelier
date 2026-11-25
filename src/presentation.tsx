import React, { useEffect } from 'react';
import { create } from 'zustand';
import { get, set, navigate, topCardsOf, childrenOf } from './store';
import { fitToContent } from './interaction';
import { Icon } from './icons';
import type { Viewport } from './types';

interface Pres { slides: string[]; index: number; returnTo: string; savedViewports: Record<string, Viewport> }
export const usePresentation = create<{ pres: Pres | null }>(() => ({ pres: null }));

/** Planche courante puis ses sous-planches, dans l'ordre de lecture (haut → bas, gauche → droite). */
function collectSlides(boardId: string, out: string[] = [], seen = new Set<string>()) {
  if (seen.has(boardId) || out.length > 200) return out;
  seen.add(boardId);
  out.push(boardId);
  const cards = topCardsOf(boardId).sort((a, b) => (Math.abs(a.y - b.y) < 30 ? a.x - b.x : a.y - b.y));
  for (const c of cards) {
    if (c.type === 'board') collectSlides(c.data.boardId, out, seen);
    if (c.type === 'column') for (const k of childrenOf(c.id)) if (k.type === 'board') collectSlides(k.data.boardId, out, seen);
  }
  return out;
}

function show(id: string) {
  navigate(id, { readOnly: true });
  // on cadre une fois la planche affichée et mesurée
  requestAnimationFrame(() => requestAnimationFrame(() => fitToContent(1.6)));
  setTimeout(() => fitToContent(1.6), 250);
}

export function startPresentation() {
  const s = get();
  const slides = collectSlides(s.boardId);
  usePresentation.setState({ pres: { slides, index: 0, returnTo: s.boardId, savedViewports: s.viewports } });
  set({ panel: null, menu: null, selection: [], editingId: null, modal: null });
  document.documentElement.requestFullscreen?.().catch(() => {});
  show(slides[0]);
}

export function goSlide(delta: number) {
  const p = usePresentation.getState().pres;
  if (!p) return;
  const index = Math.max(0, Math.min(p.slides.length - 1, p.index + delta));
  if (index === p.index) return;
  usePresentation.setState({ pres: { ...p, index } });
  show(p.slides[index]);
}

export function stopPresentation() {
  const p = usePresentation.getState().pres;
  if (!p) return;
  usePresentation.setState({ pres: null });
  set({ viewports: p.savedViewports });
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  navigate(p.returnTo);
}

export function PresentationControls() {
  const pres = usePresentation(s => s.pres);
  const boards = get().boards;
  useEffect(() => {
    if (!pres) return;
    const key = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); goSlide(1); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); goSlide(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stopPresentation(); }
      else if (e.key === 'Home') { e.preventDefault(); goSlide(-1e6); }
      else if (e.key === 'End') { e.preventDefault(); goSlide(1e6); }
    };
    const fs = () => { if (!document.fullscreenElement && usePresentation.getState().pres) stopPresentation(); };
    window.addEventListener('keydown', key, true);
    document.addEventListener('fullscreenchange', fs);
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('fullscreenchange', fs); };
  }, [!!pres]);
  if (!pres) return null;
  const cur = boards[pres.slides[pres.index]];
  return (
    <div className="pres-bar" data-ui>
      <button className="icon-btn light" disabled={pres.index === 0} onClick={() => goSlide(-1)} title="Précédente (←)"><Icon name="chevron" style={{ transform: 'rotate(180deg)' }} /></button>
      <div className="pres-title"><b>{cur?.title}</b><span>{pres.index + 1} / {pres.slides.length}</span></div>
      <button className="icon-btn light" disabled={pres.index === pres.slides.length - 1} onClick={() => goSlide(1)} title="Suivante (→ ou espace)"><Icon name="chevron" /></button>
      <span className="pres-sep" />
      <button className="icon-btn light" onClick={stopPresentation} title="Quitter (Échap)"><Icon name="close" /></button>
    </div>
  );
}
