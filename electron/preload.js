const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('neuralab', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  setupHost: () => ipcRenderer.invoke('config:setupHost'),
  setupClient: (url) => ipcRenderer.invoke('config:setupClient', url),
  reload: () => ipcRenderer.invoke('app:reload'),
  reset: () => ipcRenderer.invoke('app:reset')
});
