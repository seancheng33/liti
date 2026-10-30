import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
// 本文件编译后位于 electron/dist，工作区根目录为上两级
const projectRoot = path.join(__dirname, '..', '..');

let serverProc: ChildProcess | null = null;
let win: BrowserWindow | null = null;
let guardActive = false;

function waitForServer(timeoutMs: number): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('后端服务启动超时'));
        } else {
          setTimeout(poll, 500);
        }
      });
    };
    poll();
  });
}

async function startServer(): Promise<void> {
  const node = process.env.LITI_NODE || 'node';
  const serverEntry = path.join(projectRoot, 'server', 'dist', 'server.js');
  serverProc = spawn(node, [serverEntry], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(PORT),
      SQLITE_PATH: process.env.SQLITE_PATH ?? path.join(projectRoot, 'data', 'app.db'),
    },
    stdio: 'ignore',
  });
  serverProc.on('exit', () => {
    serverProc = null;
  });
  await waitForServer(30000);
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadURL(`http://127.0.0.1:${PORT}`);

  // 考试期间失焦 → 通知渲染进程并强制拉回
  win.on('blur', () => {
    if (guardActive && win) {
      win.webContents.send('exam:blurred');
      win.setAlwaysOnTop(true, 'screen-saver');
      win.show();
      win.focus();
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

ipcMain.handle('exam:start', () => {
  guardActive = true;
  if (win) {
    win.setFullScreen(true);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setMenuBarVisibility(false);
  }
  return true;
});

ipcMain.handle('exam:stop', () => {
  guardActive = false;
  if (win) {
    win.setFullScreen(false);
    win.setAlwaysOnTop(false);
    win.setMenuBarVisibility(true);
  }
  return true;
});

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();
  } catch (err) {
    console.error('启动失败:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (serverProc) serverProc.kill();
  app.quit();
});
