import React, { useEffect, useState } from 'react';
import type { CardProps } from '../CardView';
import { PlainText } from '../RichText';
import { updateData, set, useStore, checkpoint } from '../../store';
import { blobUrl, cachedBlobUrl, blobGet } from '../../db';
import { youtubeId, vimeoId, domainOf, formatSize, normalizeUrl, downloadBlob } from '../../files';
import { Icon } from '../../icons';
import { strokePath } from '../modals/SketchModal';

export function useBlobUrl(id?: string | null) {
  const [url, setUrl] = useState<string | null>(id ? cachedBlobUrl(id) : null);
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    blobUrl(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}

// ---------- Image ----------
export function ImageCard({ card, editing }: CardProps) {
  const url = useBlobUrl(card.data.blobId) || card.data.src;
  const ratio = card.data.ratio || 0.66;
  return (
    <div className="image-card">
      <div className="image-box" style={{ paddingBottom: `${ratio * 100}%` }}>
        {url ? <img src={url} alt={card.data.caption || card.data.name || ''} draggable={false} /> : <div className="image-missing"><Icon name="image" size={28} /></div>}
      </div>
      {(card.data.caption || editing) && (
        <PlainText className="caption" value={card.data.caption} editing={editing} placeholder="Ajouter une légende…"
          onChange={caption => updateData(card.id, { caption }, false)} />
      )}
    </div>
  );
}

// ---------- Fichier ----------
export async function downloadCardFile(card: any) {
  if (!card.data.blobId) return;
  const b = await blobGet(card.data.blobId);
  if (b) downloadBlob(b, card.data.name || 'fichier');
}

export function FileCard({ card }: CardProps) {
  const { name, size, mime } = card.data;
  const url = useBlobUrl(card.data.blobId);
  const ext = (name || '').split('.').pop()?.toUpperCase().slice(0, 4) || 'FICHIER';
  const isAudio = mime?.startsWith('audio/');
  const isVideo = mime?.startsWith('video/');
  const canOpen = mime === 'application/pdf' || mime?.startsWith('text/');
  return (
    <div className="card-pad file-card">
      {isVideo && url && <video src={url} controls preload="metadata" className="file-video" />}
      <div className="file-row">
        <div className="file-icon"><Icon name="file" size={30} /><span>{ext}</span></div>
        <div className="file-meta">
          <div className="file-name" title={name}>{name}</div>
          <div className="muted">{formatSize(size)}</div>
        </div>
        <div className="file-actions">
          {canOpen && url && <a className="icon-btn" href={url} target="_blank" rel="noopener noreferrer" title="Ouvrir" data-nodrag><Icon name="eye" size={16} /></a>}
          <button className="icon-btn" title="Télécharger" data-nodrag onClick={() => downloadCardFile(card)}><Icon name="download" size={16} /></button>
        </div>
      </div>
      {isAudio && url && <audio src={url} controls preload="metadata" className="file-audio" />}
    </div>
  );
}

// ---------- Lien ----------
export function LinkCard({ card, editing }: CardProps) {
  const { url, title, description } = card.data;
  const [playing, setPlaying] = useState(false);
  const yt = url ? youtubeId(url) : null;
  const vm = url ? vimeoId(url) : null;
  const domain = url ? domainOf(url) : '';
  const readOnly = useStore(s => s.readOnly);
  const [draftUrl, setDraftUrl] = useState(url || '');
  useEffect(() => { setDraftUrl(url || ''); }, [url]);

  const commitUrl = () => {
    const u = normalizeUrl(draftUrl);
    if (u !== url) { checkpoint(); updateData(card.id, { url: u }, false); }
  };

  if (!url && editing) {
    return (
      <div className="card-pad link-empty">
        <Icon name="link" size={18} />
        <input autoFocus className="link-input" placeholder="Collez ou tapez un lien, puis Entrée" value={draftUrl}
          onChange={e => setDraftUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { commitUrl(); set({ editingId: null }); } if (e.key === 'Escape') set({ editingId: null }); }}
          onBlur={commitUrl} />
      </div>
    );
  }
  if (!url) return <div className="card-pad link-empty muted"><Icon name="link" size={18} /> Lien vide — double-cliquez pour le saisir</div>;

  return (
    <div className="link-card">
      {(yt || vm) && (
        <div className="link-media" style={{ paddingBottom: '56.25%' }}>
          {playing ? (
            <iframe src={yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1` : `https://player.vimeo.com/video/${vm}?autoplay=1`}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen title={title || 'Vidéo'} />
          ) : (
            <>
              {yt && <img src={`https://img.youtube.com/vi/${yt}/hqdefault.jpg`} alt="" draggable={false} />}
              {!yt && <div className="video-placeholder" />}
              <button className="play-btn" data-nodrag onClick={() => setPlaying(true)} aria-label="Lire la vidéo"><Icon name="play" size={26} /></button>
            </>
          )}
        </div>
      )}
      <div className="card-pad">
        <div className="link-domain">
          <img className="favicon" src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`} alt="" draggable={false} />
          <span>{domain}</span>
          <a className="icon-btn small" href={url} target="_blank" rel="noopener noreferrer" title="Ouvrir le lien" data-nodrag><Icon name="export" size={14} /></a>
        </div>
        <PlainText className="link-title" value={title} editing={editing} placeholder={editing ? 'Titre du lien' : url}
          onChange={t => updateData(card.id, { title: t }, false)} />
        {(description || editing) && (
          <PlainText className="link-desc" value={description} editing={editing} placeholder="Description (facultative)"
            onChange={t => updateData(card.id, { description: t }, false)} />
        )}
        {editing && !readOnly && (
          <input className="link-input small" value={draftUrl} onChange={e => setDraftUrl(e.target.value)} onBlur={commitUrl}
            onKeyDown={e => { if (e.key === 'Enter') commitUrl(); }} placeholder="https://" />
        )}
      </div>
    </div>
  );
}

// ---------- Dessin ----------
export function SketchCard({ card }: CardProps) {
  const { strokes = [], width = 600, height = 400 } = card.data;
  return (
    <div className="sketch-card">
      {strokes.length ? (
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', display: 'block' }}>
          {strokes.map((s: any, i: number) => (
            <path key={i} d={strokePath(s.points)} stroke={s.color} strokeWidth={s.size} strokeOpacity={s.opacity ?? 1}
              fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </svg>
      ) : (
        <div className="sketch-empty"><Icon name="sketch" size={26} /><span>Double-cliquez pour dessiner</span></div>
      )}
    </div>
  );
}

// ---------- Couleur ----------
export function ColorCard({ card, editing }: CardProps) {
  const { hex, name } = card.data;
  const [copied, setCopied] = useState(false);
  const rgb = hexToRgb(hex);
  return (
    <div className="color-card">
      <div className="swatch" style={{ background: hex }}>
        {editing && <input type="color" value={hex} data-nodrag onChange={e => updateData(card.id, { hex: e.target.value }, false)} onFocus={() => checkpoint()} title="Choisir la couleur" />}
      </div>
      <div className="card-pad small">
        <PlainText className="color-name" value={name} editing={editing} placeholder="Nom" onChange={n => updateData(card.id, { name: n }, false)} />
        <button className="color-hex" data-nodrag title="Copier" onClick={() => { navigator.clipboard?.writeText(hex); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? 'Copié !' : hex.toUpperCase()}
        </button>
        {rgb && <div className="muted tiny">RVB {rgb.join(', ')}</div>}
      </div>
    </div>
  );
}

function hexToRgb(h: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || '');
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}
