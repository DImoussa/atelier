// App de bureau Atelier : une fenêtre qui affiche le site en ligne, avec mises à jour automatiques
// (même mécanique que SSD Drive Sync : src/maj.js et src/maj-mac.js).
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const maj = require('./src/maj');

const SITE = 'https://atelier-one-bay.vercel.app';

if (!app.requestSingleInstanceLock()) app.quit();

let fenetre = null;
function afficher() {
  if (!fenetre) return creer();
  if (fenetre.isMinimized()) fenetre.restore();
  fenetre.show();
  fenetre.focus();
}
app.on('second-instance', () => { afficher(); maj.reverifier(); });

function creer() {
  fenetre = new BrowserWindow({
    width: 1280, height: 820, minWidth: 720, minHeight: 480, autoHideMenuBar: true, title: 'Atelier',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  fenetre.loadURL(SITE);
  // Les liens vers d'autres sites (et les liens de partage) s'ouvrent dans le navigateur.
  fenetre.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  fenetre.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(SITE)) { e.preventDefault(); shell.openExternal(url); }
  });
  fenetre.on('focus', () => maj.reverifier());
  fenetre.on('closed', () => { fenetre = null; });
}

// ---------- Connexion Google ----------
// Google refuse la connexion dans une fenêtre intégrée : on l'ouvre dans le navigateur de l'ordinateur.
// Le site renvoie ensuite la session vers un petit serveur local (127.0.0.1), qui la donne à l'app.
let serveurConnexion = null;
function connexion() {
  if (serveurConnexion) serveurConnexion.close();
  const etat = crypto.randomBytes(16).toString('hex');
  return new Promise((ok) => {
    const serveur = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/cb') { res.writeHead(404); return res.end(); }
      const t = url.searchParams.get('t');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (url.searchParams.get('state') !== etat || !t) return res.end('<p>Lien de connexion invalide.</p>');
      await session.defaultSession.cookies.set({
        url: SITE, name: 'atl_s', value: t, httpOnly: true, secure: true, sameSite: 'lax',
        expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      });
      res.end('<html><body style="font:16px system-ui;text-align:center;padding:60px">Connecté à Atelier ✅<br><br>Vous pouvez fermer cet onglet et revenir dans l’app.</body></html>');
      serveur.close();
      serveurConnexion = null;
      if (fenetre) { fenetre.reload(); afficher(); }
      ok(true);
    });
    serveur.listen(0, '127.0.0.1', () => {
      const port = serveur.address().port;
      shell.openExternal(`${SITE}/?bureau=${port}&state=${etat}`);
    });
    serveurConnexion = serveur;
    setTimeout(() => { if (serveurConnexion === serveur) { serveur.close(); serveurConnexion = null; ok(false); } }, 10 * 60 * 1000);
  });
}

ipcMain.handle('version', () => app.getVersion());
ipcMain.handle('connexion', () => connexion());
ipcMain.handle('maj-etat', () => maj.etat());
ipcMain.handle('maj-installer', () => maj.installer());

app.whenReady().then(() => {
  creer();
  maj.demarrer((info) => { if (fenetre) fenetre.webContents.send('maj', info); });
});
app.on('activate', afficher);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
