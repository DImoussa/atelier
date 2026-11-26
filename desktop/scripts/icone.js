// Génère build/icon.png (1024 px, fond transparent) à partir de build/logo.svg, avec le moteur d'Electron.
// electron-builder en tire automatiquement l'icône Windows (.ico) et Mac (.icns).
// Usage : npm run icone
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const TAILLE = 1024;
const FICHIERS = [['logo.svg', 'icon.png'], ['logo-noel-app.svg', 'icon-noel.png']];

app.whenReady().then(async () => {
  const fenetre = new BrowserWindow({ show: false });
  await fenetre.loadURL('data:text/html,<html></html>');
  for (const [source, sortie] of FICHIERS) {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'build', source), 'utf8');
  // Le SVG est dessiné dans un canvas à la taille exacte : pas d'étirement ni de marge.
  const dataUrl = await fenetre.webContents.executeJavaScript(`new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = ${TAILLE};
      c.getContext('2d').drawImage(img, 0, 0, ${TAILLE}, ${TAILLE});
      ok(c.toDataURL('image/png'));
    };
    img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
  })`);
  fs.writeFileSync(path.join(__dirname, '..', 'build', sortie), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`build/${sortie} écrit`);
  }
  app.exit(0);
});
