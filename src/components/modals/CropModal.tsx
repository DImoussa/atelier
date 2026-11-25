import React, { useEffect, useRef, useState } from 'react';
import { get, set, updateData, uid, toast } from '../../store';
import { blobGet, blobSet } from '../../db';
import { Icon } from '../../icons';

type R = { x: number; y: number; w: number; h: number }; // fractions 0..1 de l'image affichée
const RATIOS: { label: string; v: number | null }[] = [
  { label: 'Libre', v: null }, { label: '1:1', v: 1 }, { label: '4:3', v: 4 / 3 }, { label: '3:4', v: 3 / 4 }, { label: '16:9', v: 16 / 9 }, { label: '9:16', v: 9 / 16 },
];
const MAX_SIDE = 4000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

export function CropModal({ cardId }: { cardId: string }) {
  const card = get().cards[cardId];
  const [src, setSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<R>({ x: 0, y: 0, w: 1, h: 1 });
  const [ratio, setRatio] = useState<number | null>(null);
  const [mime, setMime] = useState('image/png');
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: string; sx: number; sy: number; start: R } | null>(null);

  // charge l'image en local (blob) pour pouvoir la retravailler
  useEffect(() => {
    (async () => {
      try {
        let blob: Blob | undefined;
        if (card.data.blobId) blob = await blobGet(card.data.blobId);
        else if (card.data.src) blob = await (await fetch(card.data.src)).blob();
        if (!blob) throw new Error('image');
        setMime(blob.type === 'image/jpeg' ? 'image/jpeg' : blob.type === 'image/webp' ? 'image/webp' : 'image/png');
        const u = URL.createObjectURL(blob);
        setSrc(u);
        setImg(await loadImage(u));
      } catch {
        toast("Impossible de modifier cette image (le site d'origine bloque l'accès)");
        set({ modal: null });
      }
    })();
  }, []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); set({ modal: null }); } if (e.key === 'Enter') apply(); };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  });

  const natW = img?.naturalWidth || 1, natH = img?.naturalHeight || 1;

  const applyRatio = (v: number | null) => {
    setRatio(v);
    if (!v) return;
    // plus grand cadre centré au bon ratio
    const target = v * natH / natW; // w/h en fractions
    let w = 1, h = 1;
    if (target > 1) h = 1 / target; else w = target;
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
  };

  const rotate = async (deg: 90 | -90) => {
    if (!img) return;
    const c = document.createElement('canvas');
    c.width = natH; c.height = natW;
    const g = c.getContext('2d')!;
    g.translate(c.width / 2, c.height / 2);
    g.rotate(deg * Math.PI / 180);
    g.drawImage(img, -natW / 2, -natH / 2);
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), mime, 0.92));
    const u = URL.createObjectURL(blob);
    setSrc(u);
    setImg(await loadImage(u));
    setCrop({ x: 0, y: 0, w: 1, h: 1 });
    setRatio(null);
  };

  const onDown = (e: React.PointerEvent, mode: string) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, start: crop };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const dx = (e.clientX - d.sx) / r.width, dy = (e.clientY - d.sy) / r.height;
    let { x, y, w, h } = d.start;
    const min = 0.04;
    if (d.mode === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx)); y = Math.min(1 - h, Math.max(0, y + dy));
    } else {
      if (d.mode.includes('l')) { const nx = Math.min(x + w - min, Math.max(0, x + dx)); w += x - nx; x = nx; }
      if (d.mode.includes('r')) w = Math.min(1 - x, Math.max(min, w + dx));
      if (d.mode.includes('t')) { const ny = Math.min(y + h - min, Math.max(0, y + dy)); h += y - ny; y = ny; }
      if (d.mode.includes('b')) h = Math.min(1 - y, Math.max(min, h + dy));
      if (ratio) {
        // conserve le ratio en ajustant la hauteur
        const hFromW = (w * natW / ratio) / natH;
        if (d.mode.includes('t')) y = y + h - hFromW;
        h = hFromW;
        if (y < 0) { h += y; y = 0; w = (h * natH * ratio) / natW; }
        if (y + h > 1) { h = 1 - y; w = (h * natH * ratio) / natW; if (d.mode.includes('l')) x = d.start.x + d.start.w - w; }
      }
    }
    setCrop({ x, y, w, h });
  };
  const onUp = () => { drag.current = null; };

  async function apply() {
    if (!img || busy) return;
    setBusy(true);
    const sx = crop.x * natW, sy = crop.y * natH, sw = Math.max(1, crop.w * natW), sh = Math.max(1, crop.h * natH);
    const scale = Math.min(1, MAX_SIDE / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    c.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise(r => c.toBlob(b => r(b!), mime, 0.92));
    const id = uid();
    await blobSet(id, blob);
    const d = get().cards[cardId]?.data || {};
    updateData(cardId, { blobId: id, src: null, ratio: c.height / c.width, originalBlobId: d.originalBlobId || d.blobId || null });
    set({ modal: null });
    toast('Image modifiée');
  }

  const restore = async () => {
    const orig = card.data.originalBlobId;
    if (!orig) return;
    const b = await blobGet(orig);
    if (!b) return;
    const i = await loadImage(URL.createObjectURL(b));
    updateData(cardId, { blobId: orig, originalBlobId: null, ratio: i.naturalHeight / i.naturalWidth });
    set({ modal: null });
    toast('Image d\'origine rétablie');
  };

  const handles = ['tl', 't', 'tr', 'r', 'br', 'b', 'bl', 'l'];
  return (
    <div className="modal-backdrop" data-ui>
      <div className="crop-modal">
        <div className="sketch-tools">
          <button className="icon-btn" title="Pivoter à gauche" onClick={() => rotate(-90)}><Icon name="rotate" style={{ transform: 'scaleX(-1)' }} /></button>
          <button className="icon-btn" title="Pivoter à droite" onClick={() => rotate(90)}><Icon name="rotate" /></button>
          <span className="tb-sep" />
          {RATIOS.map(r => <button key={r.label} className={'btn small ghost' + (ratio === r.v ? ' active' : '')} onClick={() => applyRatio(r.v)}>{r.label}</button>)}
          <div style={{ flex: 1 }} />
          {card.data.originalBlobId && <button className="link-btn" onClick={restore}>Rétablir l'original</button>}
          <button className="btn" onClick={() => set({ modal: null })}>Annuler</button>
          <button className="btn primary" disabled={!img || busy} onClick={apply}>Appliquer</button>
        </div>
        <div className="crop-area">
          {src && img && (
            <div className="crop-box" ref={boxRef} style={{ aspectRatio: `${natW} / ${natH}` }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
              <img src={src} alt="" draggable={false} />
              <div className="crop-rect" style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
                onPointerDown={e => onDown(e, 'move')}>
                <div className="crop-grid" />
                {handles.map(h => <div key={h} className={'crop-h h-' + h} onPointerDown={e => onDown(e, h)} />)}
              </div>
            </div>
          )}
          {!img && <div className="muted">Chargement…</div>}
        </div>
        <div className="crop-info muted tiny">{Math.round(crop.w * natW)} × {Math.round(crop.h * natH)} px</div>
      </div>
    </div>
  );
}
