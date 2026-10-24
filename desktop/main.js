import { cpSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Notification, session, shell } from 'electron';

// Separate editions while preserving the existing desktop data on first launch.
const legacyDataPath = join(app.getPath('appData'), 'luban-ai-mvp');
const editionDataPath = join(app.getPath('appData'), 'luban-advanced');
if (!existsSync(editionDataPath) && existsSync(legacyDataPath)) {
  cpSync(legacyDataPath, editionDataPath, { recursive: true });
}
app.setPath('userData', editionDataPath);

const gotSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let localServer = null;
let closeDatabase = null;
let localOrigin = '';
let platformOrigin = '';
let stopRuntime = null;
let stopTaskRunner = null;
let shuttingDown = false;
const activeNotifications = new Map();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(startDesktopApp).catch(showStartupError);
}

async function startDesktopApp() {
  configureRuntimePaths();
  await startLocalServer();
  protectLocalServerRequests();
  setupNotificationBridge();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}

function configureRuntimePaths() {
  process.env.LUBAN_EDITION = 'local';
  process.env.LUBAN_DATA_DIR = app.getPath('userData');
  process.env.LUBAN_PLATFORM_INSTANCE_DIR = join(app.getPath('userData'), 'agent-runtime');
  process.env.LUBAN_WORKSPACE_DIR = join(app.getPath('documents'), 'Luban');
  process.env.LUBAN_PUBLIC_DIR = join(app.getAppPath(), 'public');
  process.env.LUBAN_DESKTOP_TOKEN = randomBytes(32).toString('hex');
}

async function startLocalServer() {
  const [{ initDb, closeDb }, { createAppServer }] = await Promise.all([
    import('../src/storage/db.js'),
    import('../src/server.js')
  ]);

  await initDb();
  closeDatabase = closeDb;
  const { ensurePlatformService, closePlatformService } = await import('../src/agent/platform-service.js');
  stopRuntime = closePlatformService;
  const runtime = await ensurePlatformService();
  platformOrigin = runtime.url;
  const { resolveLubanAgent } = await import('../src/agent/agent-resolver.js');
  await resolveLubanAgent({ store: runtime.service.store });
  const { startScheduledTaskRunner, stopScheduledTaskRunner } = await import('../src/services/scheduled-task-runner.js');
  startScheduledTaskRunner();
  stopTaskRunner = stopScheduledTaskRunner;
  localServer = createAppServer();

  await new Promise((resolve, reject) => {
    localServer.once('error', reject);
    localServer.listen(0, '127.0.0.1', resolve);
  });

  const address = localServer.address();
  if (!address || typeof address === 'string') throw new Error('无法确定本地服务端口。');
  localOrigin = `http://127.0.0.1:${address.port}`;
}

function protectLocalServerRequests() {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    if ([localOrigin, platformOrigin].some(origin => origin && details.url.startsWith(`${origin}/`))) {
      requestHeaders['X-Luban-Desktop-Token'] = process.env.LUBAN_DESKTOP_TOKEN;
    }
    callback({ requestHeaders });
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    backgroundColor: '#f7f4ed',
    title: '鲁班高级版',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(app.getAppPath(), 'desktop/preload.js')
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if ([localOrigin, platformOrigin].some(origin => origin && url.startsWith(`${origin}/`))) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      } };
    }
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${localOrigin}/`)) event.preventDefault();
  });

  void mainWindow.loadURL(localOrigin);
}

function setupNotificationBridge() {
  app.setAppUserModelId('ai.luban.desktop');
  ipcMain.handle('notifications:request-permission', () => {
    return Notification.isSupported() ? 'granted' : 'unsupported';
  });
  ipcMain.handle('notifications:show', (event, options = {}) => {
    if (!Notification.isSupported()) return null;
    const notificationId = String(options.id || randomBytes(8).toString('hex'));
    const notification = new Notification({
      title: options.title || '定时提醒',
      body: options.body || '提醒已触发。',
      silent: false
    });
    activeNotifications.set(notificationId, notification);
    notification.on('click', () => {
      event.sender.send('notifications:action', { id: notificationId, type: 'click' });
      mainWindow?.show();
      mainWindow?.focus();
      notification.close();
    });
    notification.on('close', () => {
      activeNotifications.delete(notificationId);
      event.sender.send('notifications:action', { id: notificationId, type: 'close' });
    });
    notification.show();
    return notificationId;
  });
  ipcMain.handle('notifications:close', (_event, id) => {
    const notification = activeNotifications.get(String(id));
    if (!notification) return false;
    activeNotifications.delete(String(id));
    notification.close();
    return true;
  });
}

async function showStartupError(error) {
  console.error('[desktop] 启动失败：', error);
  await app.whenReady();
  await stopDesktopApp().catch(() => {});
  dialog.showErrorBox('鲁班高级版启动失败', error?.message || String(error));
  app.exit(1);
}

async function stopDesktopApp() {
  stopTaskRunner?.();
  await stopRuntime?.();
  stopRuntime = null;
  if (localServer) {
    await Promise.race([
      new Promise((resolve) => localServer.close(resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000))
    ]);
    localServer = null;
  }
  if (closeDatabase) {
    await closeDatabase();
    closeDatabase = null;
  }
}

app.on('before-quit', (event) => {
  if (shuttingDown) return;
  event.preventDefault();
  shuttingDown = true;
  stopDesktopApp()
    .catch((error) => console.error('[desktop] 关闭失败：', error))
    .finally(() => app.quit());
});
