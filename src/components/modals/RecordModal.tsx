import React, { useEffect, useRef, useState } from 'react';
import { get, set, makeCard, mutate, addCardDraft, maxZ, uid, toast } from '../../store';
import { blobSet } from '../../db';
import { freeSpotNearCenter } from '../../interaction';
import { Icon } from '../../icons';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Enregistrement d'un mémo vocal, ajouté à la planche comme carte fichier audio. */
export function RecordModal({ at }: { at?: { x: number; y: number } | null }) {
  const [state, setState] = useState<'idle' | 'rec' | 'done' | 'error'>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<any>(null);
  const raf = useRef<number>(0);

  const cleanup = () => {
    clearInterval(timer.current);
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
  };
  useEffect(() => () => { cleanup(); if (url) URL.revokeObjectURL(url); }, []);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mr = new MediaRecorder(s);
      const chunks: Blob[] = [];
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        const b = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
        setBlob(b);
        setUrl(URL.createObjectURL(b));
        setState('done');
        cleanup();
      };
      mr.start();
      rec.current = mr;
      setSecs(0);
      setState('rec');
      const t0 = Date.now();
      timer.current = setInterval(() => setSecs((Date.now() - t0) / 1000), 250);
      // vu-mètre
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); setLevel(m / 128); raf.current = requestAnimationFrame(loop); };
      loop();
    } catch (e: any) {
      setErr(e?.name === 'NotAllowedError' ? "L'accès au micro a été refusé. Autorisez-le dans le navigateur puis réessayez." : "Aucun micro disponible sur cet appareil.");
      setState('error');
    }
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();

  const save = async () => {
    if (!blob) return;
    const id = uid();
    await blobSet(id, blob);
    const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
    const d = new Date();
    const name = `Mémo vocal ${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.${ext}`;
    const s = get();
    const p = at || freeSpotNearCenter(280, 120);
    const card = makeCard('file', s.boardId, p.x, p.y, { blobId: id, name, size: blob.size, mime: blob.type || 'audio/webm' });
    card.z = maxZ(s.boardId) + 1;
    mutate(dr => { addCardDraft(dr, card); });
    set({ modal: null, selection: [card.id] });
    toast('Mémo vocal ajouté');
  };

  const close = () => { stop(); cleanup(); set({ modal: null }); };

  return (
    <div className="modal-backdrop" data-ui onPointerDown={e => { if (e.target === e.currentTarget && state !== 'rec') close(); }}>
      <div className="dialog record-dialog" style={{ width: 380 }}>
        <div className="dialog-head"><h2>Mémo vocal</h2><button className="icon-btn" onClick={close} title="Fermer"><Icon name="close" /></button></div>
        <div className="dialog-body record-body">
          {state === 'error' && <p className="muted">{err}</p>}
          {state !== 'done' && state !== 'error' && (
            <>
              <div className="rec-time">{fmt(secs)}</div>
              <div className="rec-meter"><div style={{ width: `${Math.min(100, level * 180)}%` }} /></div>
              {state === 'idle'
                ? <button className="rec-btn" onClick={start} title="Démarrer l'enregistrement"><span className="rec-dot" /></button>
                : <button className="rec-btn recording" onClick={stop} title="Arrêter"><span className="rec-square" /></button>}
              <p className="muted tiny">{state === 'idle' ? 'Cliquez pour commencer à enregistrer.' : 'Enregistrement en cours… cliquez pour arrêter.'}</p>
            </>
          )}
          {state === 'done' && url && (
            <>
              <audio src={url} controls style={{ width: '100%' }} />
              <div className="row-gap" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="btn" onClick={() => { setBlob(null); setUrl(null); setState('idle'); setSecs(0); }}>Recommencer</button>
                <button className="btn primary" onClick={save}>Ajouter à la planche</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
