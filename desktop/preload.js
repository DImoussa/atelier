// Pont entre le site et l'app de bureau (connexion Google par le navigateur, mises à jour).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atelierDesktop', {
  version: () => ipcRenderer.invoke('version'),
  connexion: () => ipcRenderer.invoke('connexion'),
  majEtat: () => ipcRenderer.invoke('maj-etat'),
  majInstaller: () => ipcRenderer.invoke('maj-installer'),
  surMaj: (fn) => ipcRenderer.on('maj', (_e, info) => fn(info)),
});
