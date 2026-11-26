// HoloGesture as a desktop app. Electron opens the same web app in its own
// window, serves its files from inside the app bundle (so it works offline),
// handles the camera permission, saves calibration recordings, and puts
// snapshots and recordings in the Downloads folder.
const { app, BrowserWindow, protocol, session, systemPreferences, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'app://hologesture';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.task': 'application/octet-stream',
};

// A privileged, secure scheme: ES modules, fetch, WebAssembly and the camera
// all work as they would on https.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function calibrationDir() {
  return path.join(app.getPath('userData'), 'calibration');
}

async function handleRequest(request) {
  const url = new URL(request.url);

  // The Calibrate button posts its recording here.
  if (request.method === 'POST' && url.pathname === '/calibration') {
    const body = await request.text();
    try {
      JSON.parse(body);
    } catch {
      return new Response('Bad JSON', { status: 400 });
    }
    const dir = calibrationDir();
    await fs.promises.mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const file = path.join(dir, `calibration-${stamp}.json`);
    await fs.promises.writeFile(file, body);
    return Response.json({ file });
  }

  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fs.promises.readFile(file);
    return new Response(data, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 620,
    title: 'HoloGesture',
    backgroundColor: '#03060c',
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // Links that would open a new window go to the normal browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.loadURL(`${ORIGIN}/index.html`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    protocol.handle('app', handleRequest);

    const ses = session.defaultSession;
    // Camera: allowed for this app's own pages; macOS asks the user once.
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      const own = (details.requestingUrl || '').startsWith(ORIGIN);
      if (permission === 'media' && own) {
        if (process.platform === 'darwin') systemPreferences.askForMediaAccess('camera').then(callback, () => callback(false));
        else callback(true);
        return;
      }
      callback(permission === 'fullscreen' && own);
    });
    ses.setPermissionCheckHandler((wc, permission, origin) => (permission === 'media' || permission === 'fullscreen') && String(origin).startsWith(ORIGIN));

    // Snapshots and recordings go straight to Downloads, no save dialog.
    ses.on('will-download', (event, item) => {
      item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
    });

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
