const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("familyTreeDesktop", {
  platform: process.platform,
  isDesktop: true,
  loadSnapshot: () => ipcRenderer.invoke("family-data:load"),
  saveSnapshot: (snapshot) => ipcRenderer.invoke("family-data:save", snapshot),
  backupSnapshot: (snapshot) => ipcRenderer.invoke("family-data:backup", snapshot),
  restoreSnapshot: () => ipcRenderer.invoke("family-data:restore"),
  publishToGitHub: (snapshot) => ipcRenderer.invoke("family-publish:github", snapshot),
  getAuthRedirectUrl: () => ipcRenderer.invoke("auth:get-redirect-url"),
  openExternalAuthUrl: (url) => ipcRenderer.invoke("auth:open-external", url),
  onAuthCallbackUrl: (callback) => {
    const listener = (_event, url) => callback(url);
    ipcRenderer.on("auth:callback-url", listener);
    return () => ipcRenderer.removeListener("auth:callback-url", listener);
  },
  closeWindow: () => ipcRenderer.invoke("window-control:close"),
  minimizeWindow: () => ipcRenderer.invoke("window-control:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window-control:toggle-maximize"),
  onUndoRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:undo", listener);
    return () => ipcRenderer.removeListener("menu:undo", listener);
  },
  onSaveRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("menu:save", listener);
    return () => ipcRenderer.removeListener("menu:save", listener);
  },
});
