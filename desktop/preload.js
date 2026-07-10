import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lubanDesktopNotifications', {
  requestPermission: () => ipcRenderer.invoke('notifications:request-permission'),
  show: (options) => ipcRenderer.invoke('notifications:show', options),
  close: (id) => ipcRenderer.invoke('notifications:close', id),
  onAction: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('notifications:action', listener);
    return () => ipcRenderer.removeListener('notifications:action', listener);
  }
});
