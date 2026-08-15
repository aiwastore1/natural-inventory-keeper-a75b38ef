const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("posSync", {
  start: (opts) => ipcRenderer.invoke("sync:start", opts),
  stop: () => ipcRenderer.invoke("sync:stop"),
  discover: () => ipcRenderer.invoke("sync:discover"),
  getStatus: () => ipcRenderer.invoke("sync:status"),
  send: (message) => ipcRenderer.send("sync:send", message),
  onMessage: (cb) => ipcRenderer.on("sync:message", (_e, payload) => cb(payload)),
  onStatus: (cb) => ipcRenderer.on("sync:status", (_e, payload) => cb(payload)),
});
