import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { loadDoc, applyHash, useStore } from './store';
import { seed } from './templates';
import { initCloud, startShared } from './cloud';
import { CloudPanel } from './components/CloudPanel';
import './styles.css';

try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* ignoré */ }

const root = createRoot(document.getElementById('root')!);
const cloudEl = document.createElement('div');
document.body.appendChild(cloudEl);
createRoot(cloudEl).render(<CloudPanel />);

const shareToken = new URLSearchParams(location.search).get('partage');
if (shareToken) {
  startShared(shareToken, seed).then(ok => { if (ok) root.render(<App />); });
} else {
  loadDoc(seed).then(() => {
    applyHash();
    root.render(<App />);
    initCloud();
  });
}

// accès console pour le débogage (uniquement en développement)
if (import.meta.env.DEV) {
  (window as any).__store = useStore;
  import('./store').then(m => { (window as any).__api = m; });
}
