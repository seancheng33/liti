import { contextBridge, ipcRenderer } from 'electron';

let violationCb: (() => void) | null = null;
ipcRenderer.on('exam:blurred', () => {
  violationCb?.();
});

contextBridge.exposeInMainWorld('liti', {
  examGuard: {
    start: () => ipcRenderer.invoke('exam:start'),
    stop: () => ipcRenderer.invoke('exam:stop'),
    onViolation: (cb: () => void) => {
      violationCb = cb;
    },
  },
});
